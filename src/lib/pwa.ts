export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();
let attached = false;

/**
 * Слухачі події встановлення — один раз і на весь час життя сторінки.
 *
 * Chrome надсилає beforeinstallprompt лише раз за завантаження. Раніше слухач
 * ставив ефект у Providers, тобто вже після гідратації, — і подія, що
 * встигала раніше, губилась до наступного відкриття: кнопка «Встановити»
 * лишалась сірою, хоч браузер був готовий. Тому чіпляємось ще під час
 * виконання модуля, а initInstallPrompt лише підстраховує.
 */
function attach() {
  if (attached || typeof window === "undefined") return;
  attached = true;

  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn(true));
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((fn) => fn(false));
  });
}

attach();

/**
 * Перехоплює подію встановлення один раз на весь застосунок.
 *
 * Прибирати нічого: слухачі живуть стільки ж, скільки сторінка, і повторний
 * виклик (StrictMode монтує двічі) нічого не додає.
 */
export function initInstallPrompt() {
  attach();
  return () => {};
}

export function canInstall(): boolean {
  return deferred !== null;
}

export function onInstallAvailability(fn: (available: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Показує системне вікно встановлення.
 *
 * Кликати прямо з натиску, без await перед цим: prompt() без дотику браузер
 * відкидає. Подію можна використати лише раз, тож після відповіді її
 * забуваємо — хоч «так», хоч «ні».
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  const event = deferred;
  deferred = null;
  listeners.forEach((fn) => fn(false));
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    // Подію вже використали в іншому місці (скажімо, в налаштуваннях) — вікна не буде.
    return "unavailable";
  }
}

/** Чи запущено як встановлений застосунок (standalone). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/* ── Де відкрито: чисті функції від рядка браузера ────────────────────── */

/*
 * Усе нижче приймає рядок браузера й дотики параметрами, а не читає navigator
 * саме: так таблицю справжніх рядків можна перевірити без браузера (див.
 * scripts/check-push.mjs). Обгортки для живої сторінки — в кінці.
 */

export type AppleDevice = "iPhone" | "iPad";

/**
 * iPhone, iPad чи ні те, ні інше.
 *
 * iPad з iPadOS 13 у Safari називає себе Mac-ом — щоб сайти віддавали йому
 * повну версію, а не мобільну. За рядком браузера його не впізнати, тож
 * дивимось на дотик: Mac-ів із сенсорним екраном не буває. Без цього iPad
 * отримував «браузер не вміє сповіщень» замість підказки додати Ням на
 * Початковий екран — єдиного, що там справді допомагає.
 */
export function appleDevice(ua: string, maxTouchPoints: number): AppleDevice | null {
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "iPad";
  return null;
}

/**
 * Вбудовані браузери застосунків — і як їх назвати людині.
 *
 * Звідти на Початковий екран не додати нічого: пункту немає ні в меню, ні в
 * «Поширити». Порядок має значення — Messenger несе в рядку й токени
 * Facebook, тож він перевіряється раніше.
 */
const IN_APP: Array<[RegExp, string]> = [
  [/FBAN\/Messenger|MessengerForiOS|FB_IAB\/(?:MESSENGER|Orca-Android)/i, "Messenger"],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/Telegram/i, "Telegram"],
  [/Viber/i, "Viber"],
  [/musical_ly|Bytedance|TikTok|trill_/i, "TikTok"],
  [/LinkedInApp/i, "LinkedIn"],
  [/Snapchat/i, "Snapchat"],
  // З пробілом і скісною: інакше «Linux» у рядку Android теж ставав би LINE.
  [/\sLine\//, "LINE"],
  [/MicroMessenger/i, "WeChat"],
  // Застосунок Google на iPhone — теж вбудований перегляд, хоч і схожий на Safari.
  [/\bGSA\//, "Google"],
];

export function inAppName(ua: string): string | null {
  for (const [re, name] of IN_APP) if (re.test(ua)) return name;
  return null;
}

/** Інші браузери на iPhone й iPad. Усі вони всередині — той самий WebKit. */
const IOS_BROWSERS: Array<[RegExp, string]> = [
  [/CriOS\//, "Chrome"],
  [/FxiOS\//, "Firefox"],
  [/EdgiOS\//, "Edge"],
  [/OPiOS\/|OPT\//, "Opera"],
  [/YaBrowser\//, "Yandex"],
  [/DuckDuckGo\/|Ddg\//, "DuckDuckGo"],
];

export function iosBrowserName(ua: string): string | null {
  for (const [re, name] of IOS_BROWSERS) if (re.test(ua)) return name;
  return null;
}

/**
 * Де цю сторінку відкрито — з погляду «чи можна поставити Ням на телефон».
 *
 * - standalone — уже встановлено, казати нічого.
 * - ios-safari / ipad-safari — Safari: лише вручну, через «Поширити» (так ця
 *   кнопка зветься в українській iOS; «Поділитись» людина там не знайде).
 * - ios-other-browser — Chrome, Firefox, Edge на iPhone чи iPad. З iOS 16.4
 *   вони теж уміють «На Початковий екран» у своєму меню «Поширити», але
 *   старіші версії й дрібні браузери — ні, тож Safari лишаємо запасним шляхом.
 * - in-app — вбудований браузер Instagram, Telegram тощо: звідти не можна.
 * - prompt — Chromium (Chrome, Edge, Samsung, Opera) на Android чи на
 *   компʼютері: там є справжнє вікно встановлення (beforeinstallprompt).
 *   Чи браузер його вже дав — окреме питання, див. canInstall.
 * - unsupported — решта: Firefox, Safari на Mac. Кнопки не буде.
 *
 * bridge — ознака вбудованого перегляду, якої немає в рядку браузера: Telegram
 * на iPhone відкриває сторінки у власному перегляді з рядком, як у Safari, але
 * лишає в window свій міст.
 */
export type InstallEnvironment =
  | "standalone"
  | "ios-safari"
  | "ipad-safari"
  | "ios-other-browser"
  | "in-app"
  | "prompt"
  | "unsupported";

export function installEnvironment(
  ua: string,
  maxTouchPoints: number,
  standalone: boolean,
  bridge = false,
): InstallEnvironment {
  if (standalone) return "standalone";
  if (bridge || inAppName(ua)) return "in-app";

  const device = appleDevice(ua, maxTouchPoints);
  if (device) {
    if (iosBrowserName(ua)) return "ios-other-browser";
    /*
     * Safari і SFSafariViewController завжди пишуть «Safari/» наприкінці. Голий
     * WKWebView — ні: так виглядають вбудовані браузери, які не назвались.
     * (Встановлений застосунок теж без «Safari/», але його відсіяв standalone.)
     */
    if (!/Safari\//.test(ua)) return "in-app";
    return device === "iPad" ? "ipad-safari" : "ios-safari";
  }

  // Android WebView позначає себе «; wv)» — це завжди чийсь вбудований перегляд.
  if (/Android/i.test(ua) && /;\s*wv\)/.test(ua)) return "in-app";
  if (/Firefox\//.test(ua)) return "unsupported";
  if (/Chrome\/|Chromium\//.test(ua)) return "prompt";
  return "unsupported";
}

/** Основна версія Safari з рядка («Version/26.0» → 26). */
export function safariVersion(ua: string): number | null {
  const match = /Version\/(\d+)/.exec(ua);
  return match ? Number(match[1]) : null;
}

/**
 * Де шукати «Поширити» у Safari.
 *
 * - toolbar — iPhone до iOS 26: кнопка посередині панелі внизу.
 * - more-menu — iPhone з iOS 26: у компактній панелі кнопки немає, вона
 *   ховається в меню «•••» праворуч унизу. Версію iOS рядок уже не каже
 *   (там застигло 18_6), тож дивимось на версію Safari.
 * - top-right — iPad: панель угорі, «Поширити» праворуч.
 */
export type ShareSpot = "toolbar" | "more-menu" | "top-right";

export function iosShareSpot(ua: string, maxTouchPoints: number): ShareSpot {
  if (appleDevice(ua, maxTouchPoints) === "iPad") return "top-right";
  return (safariVersion(ua) ?? 0) >= 26 ? "more-menu" : "toolbar";
}

/**
 * Скільки днів не чекати на вікно встановлення після того, як воно не прийшло.
 *
 * Chrome може не дати його ніколи: Ням уже встановлено, а відкрили вкладку із
 * закладки; Custom Tabs; браузери, що лише називають себе Chrome. Без паузи
 * кожен запуск там на кілька секунд відкладав би все інше — а підказка так і
 * не показувалась би, тож і позначки, що зупинила б очікування, не з'явилось би.
 */
export const INSTALL_WAIT_PAUSE_DAYS = 7;

/**
 * Чи варто на цьому запуску чекати на вікно встановлення.
 *
 * lastTimeout — коли очікування востаннє скінчилось нічим. Зіпсована дата чи
 * дата з майбутнього (переведений годинник) паузи не дають: інакше можна
 * застрягти без очікування надовго, а одне зайве очікування — дрібниця.
 * Запізніле вікно ловить слухач і без очікування, тож пауза нічого не губить.
 */
export function installWaitDue(lastTimeout: string | null, now: number): boolean {
  if (!lastTimeout) return true;
  const days = (now - Date.parse(lastTimeout)) / 86_400_000;
  return !(days >= 0 && days < INSTALL_WAIT_PAUSE_DAYS);
}

/* ── Обгортки для живої сторінки ──────────────────────────────────────── */

function userAgent(): { ua: string; touch: number } {
  if (typeof navigator === "undefined") return { ua: "", touch: 0 };
  return { ua: navigator.userAgent, touch: navigator.maxTouchPoints ?? 0 };
}

export function currentAppleDevice(): AppleDevice | null {
  const { ua, touch } = userAgent();
  return appleDevice(ua, touch);
}

export function currentInstallEnvironment(): InstallEnvironment {
  const { ua, touch } = userAgent();
  const bridge =
    typeof window !== "undefined" && ("TelegramWebviewProxy" in window || "TelegramWebview" in window);
  return installEnvironment(ua, touch, isStandalone(), bridge);
}

export function currentShareSpot(): ShareSpot {
  const { ua, touch } = userAgent();
  return iosShareSpot(ua, touch);
}

export function currentBrowserName(): string | null {
  const { ua } = userAgent();
  return inAppName(ua) ?? iosBrowserName(ua);
}
