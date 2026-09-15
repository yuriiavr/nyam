/* ── Будильник із сервера ─────────────────────────────────────────────────
 *
 * На iPhone застосунок з екрана «Домів», щойно його згорнули, заморожується
 * цілком: setInterval не доходить до нуля, і будильник дзвонив лише тоді,
 * коли застосунок відкривали знову. Пуш із сервера приходить і в закритий,
 * тож кожен запущений таймер ще й записує в базу «коли дзвонити» і «куди» —
 * підписку саме цього пристрою (timer_pushes), а сервер у ту секунду надсилає
 * туди сповіщення з тим самим тегом, що й місцевий будильник: встигли обидва —
 * на екрані одне. Інші пристрої акаунта мовчать: макарони на цій плиті.
 *
 * Таймерів тепер кілька — по одному на крок, і в кількох рецептах разом, —
 * тож і тег у кожного свій (timerTag): спільний тег ховав би перший «час
 * вийшов» під другим.
 *
 * Пауза, скидання, «Готово!» і скидання готування будильник скасовують. А от
 * вийти зі сторінки чи перейти на інший крок — ні: таймер іде далі, і дзвінок
 * тоді потрібен якраз найбільше. Самі таймери живуть у src/lib/cooking.ts, у
 * localStorage, — тож і після того, як iPhone вивантажив застосунок, екран
 * знає про кожен будильник у базі. А якщо й сховище загубилось, CookingHost
 * знаходить будильники цього пристрою в базі й повертає їх на екран
 * (adoptAlarm) — за адресою, в якій записано рецепт і крок.
 *
 * Тут — лише дроти до бази: черга запитів, запис, скасування, що переживає
 * збій мережі. Що саме запущено — вирішує cooking.ts.
 */

import { pushServerReady } from "@/lib/push";
import { useApp } from "@/lib/store";
import {
  cancelTimerPush,
  hasPushSubscription,
  scheduleTimerPush,
  TimerPushError,
  type TimerPush,
} from "@/lib/supabase/api";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { TIMER_STALE_MS, timerTag } from "@/lib/timer-push";

/**
 * Скільки часу після дедлайну означає «повернулись, коли давно продзвонило».
 *
 * Тоді системне сповіщення вже не показуємо — але лише коли будильник точно
 * лежав на сервері: серверне, найімовірніше, щойно було, і друге таке саме
 * лише задзвонило б ще раз.
 */
export const CAUGHT_UP_MS = 3000;

/**
 * Скільки після строку ще є сенс скасовувати будильник.
 *
 * Здоровий сервер забирає рядок за 2 секунди до строку, і скасовувати вже
 * нічого. Але розсилка, що відстала, ще може надіслати будильник, прострочений
 * до TIMER_STALE_MS (10 хвилин), — стільки й чекаємо. Саме число, а не копія:
 * межа, до якої сервер ще дзвонить, і межа, до якої є сенс скасовувати, — одна.
 */
const CANCEL_USEFUL_MS = TIMER_STALE_MS;

/** Будильники, про які знає ця сесія, — з моментом дзвінка. */
const fireAtOf = new Map<string, number>();

/**
 * Будильники, запис яких почався. Рядок міг дійти до бази, навіть коли
 * відповідь загубилась, — тож скасовувати треба кожен такий, а не лише
 * підтверджені.
 */
const tried = new Set<string>();

/** Будильники, запис яких база підтвердила: сервер про них точно знає. */
const written = new Set<string>();

/**
 * Будильник із попереднього життя застосунку — зі сховища таймерів чи
 * знайдений у базі. Чи дійшов запис, напевно не знаємо, тож скасовувати
 * вважаємо за потрібне, а «сервер уже продзвонив» — лише з підтвердженням.
 */
export function rememberAlarm(id: string, fireAt: number, armed: boolean): void {
  fireAtOf.set(id, fireAt);
  tried.add(id);
  if (armed) written.add(id);
}

/** Чи знає сесія цей будильник — поставлений, відновлений чи вже скасовуваний. */
export function knownAlarm(id: string): boolean {
  return fireAtOf.has(id);
}

/** Чи база підтвердила запис: тоді сервер дзвонив і без сторінки. */
export function alarmWritten(id: string): boolean {
  return written.has(id);
}

/*
 * Запис і скасування — по черзі, в тому порядку, в якому їх попросили.
 * Запити летять незалежно, і «пауза» одразу після «старту» могла б дійти до
 * бази раніше за сам запис — тоді на сервері лишився б будильник на паузі.
 * Черга спільна на весь застосунок. Кожен запит у ній обмежений у часі
 * (див. api.ts), щоб один завислий не тримав за собою скасування.
 */
let alarmQueue: Promise<void> = Promise.resolve();

export function queueAlarm(op: () => Promise<void>): void {
  alarmQueue = alarmQueue.then(op).catch((error: unknown) => {
    // Будильник із сервера — підстраховка, а не головний дзвінок: місцевий
    // таймер працює й без нього, тож людині про збій не кажемо.
    if (process.env.NODE_ENV !== "production") console.warn("[timer-push]", error);
  });
}

/* ── Скасування, що не дійшли ─────────────────────────────────────────── */

/*
 * Скасування спершу записуємо в localStorage, а вже потім шлемо. Кухонний
 * Wi-Fi пропав якраз на паузі — і забуте скасування означало б «час вийшов»
 * для таймера, що давно стоїть. Тож зі списку воно зникає лише тоді, коли
 * база відповіла; до того повторюємо: щойно мережа повернулась, застосунок
 * знову на екрані, раз на 10 секунд — і при наступному запуску, якщо
 * застосунок устигли закрити.
 */
interface PendingCancel {
  id: string;
  /** Після цього скасовувати пізно: див. CANCEL_USEFUL_MS. */
  until: number;
}

const CANCELS_KEY = "nyam-timer-cancels";
const RETRY_MS = 10_000;

/** Скасування, що вже стоять у черзі, — щоб повтор не ставив їх удруге. */
const cancelling = new Set<string>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retriesHooked = false;

function readCancels(): PendingCancel[] {
  try {
    const list = JSON.parse(localStorage.getItem(CANCELS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    return list.filter(
      (c): c is PendingCancel =>
        typeof c?.id === "string" && typeof c?.until === "number" && c.until > now,
    );
  } catch {
    return [];
  }
}

function writeCancels(list: PendingCancel[]): void {
  try {
    if (list.length) localStorage.setItem(CANCELS_KEY, JSON.stringify(list));
    else localStorage.removeItem(CANCELS_KEY);
  } catch {
    /* приватний режим — лишається повтор, поки сторінка жива */
  }
}

/**
 * Чи чекає будильник на скасування, що ще не дійшло. Такий рядок у базі — не
 * загублений таймер, а поставлений на паузу: повертати його на екран не можна.
 */
export function cancelPending(id: string): boolean {
  return readCancels().some((c) => c.id === id);
}

/** Скасовує будильник, поставлений у цій сесії чи відомий з попередньої. */
export function cancelAlarm(id: string | null | undefined): void {
  if (!id) return;
  const fireAt = fireAtOf.get(id);
  if (fireAt == null) return;
  const list = readCancels();
  if (!list.some((c) => c.id === id)) {
    writeCancels([...list, { id, until: fireAt + CANCEL_USEFUL_MS }]);
  }
  flushCancels(id);
}

export function flushCancels(only?: string): void {
  // Без входу RLS видалить нуль рядків і відповість «успіх» — і скасування
  // зникло б зі списку, так і не спрацювавши.
  if (!isSupabaseConfigured || !useApp.getState().account) return;
  hookRetries();

  const list = readCancels();
  writeCancels(list); // заразом викидаємо прострочені
  for (const { id } of list) {
    if ((only && id !== only) || cancelling.has(id)) continue;
    cancelling.add(id);
    queueAlarm(async () => {
      try {
        // Поставлений у цій сесії, але до запису так і не дійшло (пуш цьому
        // пристрою недоступний) — у базі нема чого видаляти. Решту, зокрема
        // спадок попередньої сесії, видаляємо завжди: зайве видалення нічого
        // не коштує.
        if (!fireAtOf.has(id) || tried.has(id)) await cancelTimerPush(id);
        forgetCancel(id);
      } catch (error) {
        // Відмова бази (4xx) не мине від повтору — скажімо, таблиці немає.
        if (error instanceof TimerPushError && error.rejected) forgetCancel(id);
        else retrySoon();
        throw error;
      } finally {
        cancelling.delete(id);
      }
    });
  }
}

function forgetCancel(id: string): void {
  tried.delete(id);
  written.delete(id);
  writeCancels(readCancels().filter((c) => c.id !== id));
}

function retrySoon(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    flushCancels();
  }, RETRY_MS);
}

/** Раз на весь застосунок. */
function hookRetries(): void {
  if (retriesHooked) return;
  retriesHooked = true;
  window.addEventListener("online", () => flushCancels());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") flushCancels();
  });
}

/* ── Запис ────────────────────────────────────────────────────────────── */

/**
 * Будильник, яким його знає мить старту. Без адреси пристрою: її дізнаємось
 * лише в мить запису — до вікна дозволу підписки ще могло не бути зовсім.
 */
export type AlarmDraft = Omit<TimerPush, "endpoint">;

/**
 * Ставить будильник на сервері.
 *
 * `push` готують у мить старту — з адресою й текстом саме того відліку.
 * Другий виклик приходить аж після вікна дозволу й підписки.
 *
 * `current` — чи цей відлік досі живий: перевірки, що ставити є сенс, чекають
 * мережі, а за цей час таймер могли поставити на паузу.
 *
 * `onArmed` — база підтвердила запис: таймер у сховищі позначає, що сервер
 * дзвонитиме й без сторінки (див. CookingHost, ring).
 */
export function armAlarm(push: AlarmDraft, current: () => boolean, onArmed: () => void): void {
  fireAtOf.set(push.id, Date.parse(push.fireAt));
  queueAlarm(async () => {
    if (!current()) return;
    const endpoint = await alarmEndpoint();
    if (!endpoint || !current()) return;

    const first = !tried.has(push.id);
    tried.add(push.id);
    try {
      await scheduleTimerPush({ ...push, endpoint });
    } catch (error) {
      // Відмова означає «цей запис не пройшов», а не «рядка немає»: повторний
      // запис того самого будильника міг упасти після першого, що дійшов.
      if (error instanceof TimerPushError && error.rejected && first) tried.delete(push.id);
      throw error;
    }
    written.add(push.id);
    onArmed();
  });
}

/** Скільки чекати відповіді про ключі сервера, перш ніж вирішити «не дійде». */
const REACH_TIMEOUT_MS = 5000;

/** uuid для рядка. randomUUID немає поза https — а телефон у локальній мережі саме там. */
export function newAlarmId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Адреса, за якою пуш дійде саме до цього пристрою, — або null, якщо не дійде.
 *
 * Сервер дзвонить лише на пристрій, записаний у рядку будильника, тож мало
 * того, що браузер підписаний: цю підписку мусить знати база, і саме від
 * імені поточного акаунта. На спільному телефоні підписка браузера могла
 * лишитись записаною на іншу людину — тоді сервер не знайшов би її серед
 * наших і не надіслав би нічого, а тригер у базі такий запис і не прийме.
 * Сервер без ключів теж не надішле нічого, а рядки кликали б його даремно.
 * Місцевий будильник працює в усіх цих випадках однаково.
 */
async function alarmEndpoint(): Promise<string | null> {
  if (!("Notification" in window) || Notification.permission !== "granted") return null;
  const endpoint = await deviceEndpoint();
  if (!endpoint) return null;

  // Жоден із двох запитів сам не здається ніколи, а стоять вони в черзі перед паузою.
  const ready = await Promise.race([
    Promise.all([pushServerReady(), hasPushSubscription(endpoint)]).then(
      ([key, known]) => key && known,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), REACH_TIMEOUT_MS)),
  ]);
  return ready ? endpoint : null;
}

/**
 * Адреса пуш-підписки цього браузера — лише те, що знає він сам, без мережі.
 *
 * Нею будильник у базі й позначає пристрій: і для запису (alarmEndpoint), і
 * для пошуку загублених — щоб не зачепити будильник іншого пристрою акаунта.
 */
export async function deviceEndpoint(): Promise<string | null> {
  if (!("PushManager" in window)) return null;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

/* ── Текст і сповіщення ──────────────────────────────────────────────── */

/** Текст будильника — один для місцевого й серверного, щоб заміна була непомітна. */
export function alarmText(recipeTitle: string, stepIndex: number): string {
  const title = recipeTitle.length > 60 ? `${recipeTitle.slice(0, 59)}…` : recipeTitle;
  return title
    ? `Час вийшов — перевір страву. «${title}», крок ${stepIndex + 1}`
    : `Час вийшов — перевір страву. Крок ${stepIndex + 1}`;
}

/**
 * Системне сповіщення «час вийшов» — на випадок, якщо застосунок згорнули.
 *
 * Через service worker, а не `new Notification()`: на телефоні той
 * конструктор заборонений і кидає помилку, тобто будильник не дзвонив саме
 * там, де він потрібен, — коли екран згас і застосунок у фоні.
 *
 * Без дозволу просто мовчимо: набридати запитом посеред готування не варто.
 * Повертає, чи система справді показала сповіщення.
 */
export async function showLocalAlarm(id: string, body: string, url: string): Promise<boolean> {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return false;
    await reg.showNotification("Ням", {
      body,
      icon: "/api/icon?size=192",
      badge: "/api/icon?size=192",
      tag: timerTag(id),
      requireInteraction: true,
      // Вібрація в кишені важить більше за звук: на кухні шумно.
      vibrate: [200, 100, 200, 100, 300],
      data: { url },
    } as NotificationOptions);
    return true;
  } catch {
    return false;
  }
}
