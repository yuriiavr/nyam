"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  Bell,
  Check,
  Copy,
  Download,
  Maximize2,
  MessageCircle,
  Refrigerator,
  Timer,
  WifiOff,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavHidden } from "./BottomNav";
import { Button, Sheet, anySheetOpen, useToast } from "./ui";
import {
  enablePush,
  peekPushDevice,
  pushConfigured,
  pushOfferStep,
  pushOutcome,
  pushServerReady,
  rememberPushOwner,
} from "@/lib/push";
import {
  canInstall,
  currentAppleDevice,
  currentBrowserName,
  currentInstallEnvironment,
  currentShareSpot,
  installWaitDue,
  onInstallAvailability,
  promptInstall,
  type InstallEnvironment,
  type ShareSpot,
} from "@/lib/pwa";
import { useApp, type PushOfferOutcome } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Пропозиції при відкритті застосунку: встановити Ням і увімкнути сповіщення.
 *
 * Сповіщення без людини не ввімкнути: дозвіл дає лише системне вікно, а Safari
 * й Firefox показують його тільки у відповідь на натиск. Питати ж системним
 * вікном просто на старті — найпевніший спосіб отримати «заблокувати»
 * назавжди: людина ще не знає, про що її питають. Тому спершу свій аркуш із
 * поясненням, а системне вікно — лише коли вона сама натиснула «Увімкнути».
 *
 * Встановлення — так само: на Android і компʼютері браузер дає справжнє вікно
 * (але лише з натиску), а на iPhone кнопки, яка поставила б сайт на екран,
 * Apple не дає зовсім — там можна лише показати, куди тиснути.
 *
 * Що відповіли про сповіщення, пам'ятає pushOffer у сховищі — окремо для
 * кожного пристрою. Про встановлення — позначка INSTALL_HINT_KEY.
 */

/** Пауза після готовності: дати екрану домалюватись, а людині — роздивитись. */
const OFFER_DELAY_MS = 2000;
/** Як часто перевіряти, чи закрився чужий аркуш або чи повернулись у вкладку. */
const RETRY_MS = 1500;
/**
 * Скільки чекати на вікно встановлення від Chrome, перш ніж перейти до
 * сповіщень. Воно зазвичай приходить за секунду-дві після завантаження;
 * довше тримати пропозицію сповіщень заради нього не варто — решту ловить
 * слухач onInstallAvailability.
 */
const INSTALL_WAIT_MS = 5000;

/**
 * Позначка «підказку про встановлення вже показували».
 *
 * Не в сховищі застосунку й не в pushOffer: це не відповідь про сповіщення, а
 * факт про цей браузер. Встановлений на iPhone застосунок має власне сховище,
 * тож там позначки не буде — і пропозиція сповіщень прийде вже по-справжньому.
 * Так само окреме сховище у вбудованого браузера Instagram і в Safari: після
 * «відкрий у Safari» підказка там покажеться знову, уже з кроками для Safari.
 */
const INSTALL_HINT_KEY = "nyam-install-hint";

/**
 * Коли очікування на вікно встановлення востаннє скінчилось нічим.
 *
 * Без цього в браузері, де вікна не буде ніколи (Ням уже встановлено, а
 * відкрили вкладку), кожен запуск чекав би INSTALL_WAIT_MS — див. installWaitDue.
 */
const INSTALL_WAITED_KEY = "nyam-install-waited";

/**
 * Для кого вже вирішували в цьому запуску — id акаунта або GUEST.
 *
 * У модулі, а не в стані компонента: публічні сторінки (умови, політика)
 * знімають його з екрана, і без цього кожне повернення з них питало б знову.
 */
let decidedFor: string | null = null;
const GUEST = "guest";

/**
 * Чи показували вже якийсь аркуш за цей запуск.
 *
 * Один на запуск: встановлення й сповіщення одне за одним — це вже допит, а не
 * пропозиція. Хто щойно вирішував про встановлення, про сповіщення почує при
 * наступному відкритті.
 */
let shownThisLaunch = false;

/** Середовища, де є що сказати про встановлення. */
export type InstallKind = Exclude<InstallEnvironment, "standalone" | "unsupported">;

type Offer = { kind: "push" } | { kind: "install"; env: InstallKind; push: boolean };

function installHintShown(): boolean {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) !== null;
  } catch {
    // Сховище недоступне (приватний режим) — краще промовчати, ніж щоразу показувати.
    return true;
  }
}

function markInstallHint() {
  try {
    localStorage.setItem(INSTALL_HINT_KEY, new Date().toISOString());
  } catch {
    /* не критично */
  }
}

function installWaitedAt(): string | null {
  try {
    return localStorage.getItem(INSTALL_WAITED_KEY);
  } catch {
    return null;
  }
}

function markInstallWaited() {
  try {
    localStorage.setItem(INSTALL_WAITED_KEY, new Date().toISOString());
  } catch {
    /* не критично */
  }
}

/**
 * Чи дасть браузер вікно встановлення — з коротким очікуванням на нього.
 *
 * Чекаємо не щоразу: якщо нещодавно вже чекали й марно, одразу кажемо «ні».
 * Запізніле вікно однаково не загубиться — його підхопить слухач у PushOffer.
 */
function installAvailable(): Promise<boolean> {
  if (canInstall()) return Promise.resolve(true);
  if (!installWaitDue(installWaitedAt(), Date.now())) return Promise.resolve(false);
  return new Promise((resolve) => {
    const stop = onInstallAvailability((available) => {
      if (!available) return;
      clearTimeout(timer);
      stop();
      resolve(true);
    });
    const timer = setTimeout(() => {
      stop();
      markInstallWaited();
      resolve(false);
    }, INSTALL_WAIT_MS);
  });
}

/**
 * Чи закриває сторінку повноекранний шар, який не є аркушем, — скажімо, сканер.
 *
 * anySheetOpen бачить лише Sheet, а сканер штрихкодів — власний шар поверх
 * усього. Спитати його самого нема як, тож дивимось, що лежить посеред екрана:
 * фіксований шар на весь екран — це те, чим людина зараз зайнята, і аркуш
 * під ним (а потім і аркуш із результатом сканування над ним) — два аркуші
 * разом. Фонові декорації сюди не потрапляють: вони pointer-events-none, і
 * elementFromPoint їх пропускає.
 */
function overlayOpen(): boolean {
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let el = document.elementFromPoint(w / 2, h / 2); el && el !== document.body; el = el.parentElement) {
    if (getComputedStyle(el).position !== "fixed") continue;
    const box = el.getBoundingClientRect();
    if (box.width >= w * 0.9 && box.height >= h * 0.9) return true;
  }
  return false;
}

/**
 * Підказка про встановлення — якщо вона тут доречна.
 *
 * iPhone, iPad і вбудовані браузери — ще до входу. На iPhone застосунок з
 * Початкового екрана має окреме від Safari сховище, тож поставити Ням туди
 * до входу — це увійти один раз, а не двічі. А з вбудованого браузера
 * Instagram чи Telegram вхід через Google часто не пускає зовсім: сказати
 * «відкрий у браузері» після входу — вже запізно.
 *
 * Справжнє вікно встановлення (Android, компʼютер) — лише після входу: там
 * сховище спільне, і поспішати нема куди, а людина хай спершу побачить, що
 * встановлює.
 */
async function decideInstall(signedIn: boolean): Promise<Offer | null> {
  if (installHintShown()) return null;

  const env = currentInstallEnvironment();
  if (env === "standalone" || env === "unsupported") return null;

  if (env === "prompt") {
    if (!signedIn || !(await installAvailable())) return null;
    return { kind: "install", env, push: false };
  }

  // Про сповіщення на iPhone згадуємо, лише коли сервер справді готовий їх слати.
  const push = env !== "in-app" && (await pushServerReady());
  return { kind: "install", env, push };
}

/**
 * Що показати цьому пристрою просто зараз.
 *
 * Усе, що потребує мережі чи очікування, — тут, до аркуша. У натиску
 * «Увімкнути» чекати вже нічого не можна: Safari не покаже вікно дозволу.
 * pushConfigured заодно кладе ключ сервера в кеш, і enablePush по нього в
 * мережу вже не піде.
 */
async function decide(accountId: string | null): Promise<Offer | null> {
  /*
   * Встановлення — першим. На iPhone у вкладці Safari воно й замінює
   * пропозицію сповіщень: пуша там немає взагалі, і «увімкнути» було б
   * кнопкою, яка нічого не вмикає.
   */
  const install = await decideInstall(Boolean(accountId));
  if (install) return install;
  if (!accountId) return null;

  // Браузер без пуша (зокрема Safari-вкладка на iPhone) — нічого не показуємо
  // й нічого не записуємо: відповідати людині нема на що.
  if (!(await pushConfigured())) return null;

  const device = await peekPushDevice();
  if (!device) return null;

  const store = useApp.getState();
  const step = pushOfferStep(device, store.pushOffer);
  if (step === "record-enabled") {
    // Уже увімкнено (скажімо, ще до появи цієї пропозиції) — лише запамʼятовуємо.
    // База підтвердила, що підписка — цього акаунта, тож він і власник.
    store.setPushOffer("enabled");
    rememberPushOwner(accountId);
    return null;
  }
  return step === "offer" ? { kind: "push" } : null;
}

export function PushOffer() {
  const pathname = usePathname() || "/";
  const navHidden = useNavHidden(pathname);
  const hydrated = useApp((s) => s.hydrated);
  const authChecked = useApp((s) => s.authChecked);
  const accountId = useApp((s) => s.account?.id);
  const syncStatus = useApp((s) => s.syncStatus);
  const setPushOffer = useApp((s) => s.setPushOffer);
  const toast = useToast();

  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  /** Для закриття під час спроби: відповідь тоді запише сама спроба. */
  const busyRef = useRef(false);
  /** Лічильник запізнілих вікон встановлення: зміна перезапускає рішення. */
  const [installTick, setInstallTick] = useState(0);

  /*
   * Спокійний екран — той, де людина не посеред справи. Готування, створення
   * рецепта й сканер (там, де ховається навігація) до таких не належать, а в
   * налаштуваннях є свої картки встановлення й сповіщень, і аркуш поверх них —
   * повтор. До входу на екрані лише вхід, і він спокійний завжди.
   */
  const calm = !accountId || (!navHidden && pathname !== "/settings");
  /*
   * Чекаємо, поки дані завантажились: поки крутиться синхронізація, екран
   * ще перебудовується, і аркуш вискакував би поверх контенту, що
   * зʼявляється. Без бази немає ні акаунтів, ні куди записати підписку.
   */
  const ready =
    isSupabaseConfigured &&
    hydrated &&
    authChecked &&
    (accountId ? syncStatus === "ready" : true);
  const key = accountId ?? GUEST;

  /*
   * Chrome дає вікно встановлення не одразу: на першому відкритті — лише
   * після того, як людина трохи побула на сторінці. Якщо за цей запуск ще
   * нічого не показували, дати рішенню другий шанс — тепер уже з кнопкою.
   */
  useEffect(() => {
    if (!accountId) return;
    return onInstallAvailability((available) => {
      if (!available || shownThisLaunch || installHintShown()) return;
      decidedFor = null;
      setInstallTick((n) => n + 1);
    });
  }, [accountId]);

  useEffect(() => {
    if (!ready || !calm || shownThisLaunch || decidedFor === key) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /*
     * Поверх чужого аркуша не ліземо: людина в ньому щось заповнює. Так само
     * не вирішуємо у фоновій вкладці — аркуш, який ніхто не бачив, міг би
     * лишитись на екрані до повернення, уже без жодного приводу. І не під
     * сканером: він не аркуш, але зайнята людина там так само.
     */
    const busyElsewhere = () =>
      anySheetOpen() || document.visibilityState !== "visible" || overlayOpen();

    const attempt = async () => {
      if (cancelled) return;
      if (busyElsewhere()) {
        timer = setTimeout(() => void attempt(), RETRY_MS);
        return;
      }

      const next = await decide(accountId ?? null);
      // Поки перевіряли, могли піти на повноекранний маршрут чи вийти з акаунта:
      // тоді ефект перезапуститься сам, коли умови повернуться.
      if (cancelled || shownThisLaunch) return;
      if (next && busyElsewhere()) {
        timer = setTimeout(() => void attempt(), RETRY_MS);
        return;
      }

      decidedFor = key;
      if (!next) return;
      shownThisLaunch = true;
      if (next.kind === "install") markInstallHint();
      setOffer(next);
    };

    timer = setTimeout(() => void attempt(), OFFER_DELAY_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ready, calm, key, accountId, installTick]);

  /*
   * Встановили з меню браузера, поки аркуш із кнопкою на екрані, — кнопка
   * вже нічого не зробить, тож і аркуш ні до чого.
   */
  const promptOpen = offer?.kind === "install" && offer.env === "prompt";
  useEffect(() => {
    if (!promptOpen) return;
    return onInstallAvailability((available) => {
      if (!available) setOffer(null);
    });
  }, [promptOpen]);

  const answer = useCallback(
    (outcome: PushOfferOutcome) => {
      setOffer(null);
      // Під час спроби відповідь запише вона сама — і вона точніша за «не зараз».
      if (!busyRef.current) setPushOffer(outcome);
    },
    [setPushOffer],
  );

  const later = useCallback(() => answer("later"), [answer]);
  const closeInstall = useCallback(() => setOffer(null), []);

  const enable = () => {
    if (!accountId) return;
    busyRef.current = true;
    setBusy(true);

    /*
     * enablePush — перше, що відбувається в натиску, без жодного await перед
     * ним: Safari показує вікно дозволу лише поки триває сам натиск. Усе, що
     * потребувало мережі, зроблено ще до появи аркуша.
     */
    void enablePush(accountId)
      .then((result) => {
        const outcome = pushOutcome(result);
        if (outcome) setPushOffer(outcome);
        // Збій у нас чи в браузері — «не зараз», щоб не перепитувати щозапуску.
        // Блок не записуємо зовсім: його памʼятає сам дозвіл (див. pushOutcome).
        else if (result.state !== "denied") setPushOffer("later");

        if (result.state === "on") {
          toast("Сповіщення увімкнено", "🔔");
        } else if (result.state === "denied") {
          toast("Сповіщення заблоковано — увімкнути можна в налаштуваннях телефона", "🔕");
        } else if (result.state === "unsupported" || result.state === "failed") {
          // Кажемо, що саме не вийшло: інакше це виглядає як «телефон не вміє».
          toast(`Не вдалося: ${result.reason}`, "⚠️");
        }
        // dismissed — просто закрили вікно. Лякати тостом нема чим: спитаємо згодом.
      })
      .catch(() => setPushOffer("later"))
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
        setOffer(null);
      });
  };

  const install = () => {
    /*
     * promptInstall — першим і без await перед ним: вікно встановлення, як і
     * вікно дозволу, браузер показує лише з натиску. Аркуш прибираємо одразу —
     * поверх системного вікна він лише заважає.
     */
    const result = promptInstall();
    setOffer(null);
    void result.then((outcome) => {
      if (outcome === "accepted") toast("Готово — Ням встановлено", "🎉");
      else if (outcome === "unavailable") {
        toast("Вікно встановлення вже недоступне — спробуй з меню браузера", "ℹ️");
      }
      // dismissed — людина передумала. Нагадувати не будемо: підказка одна на пристрій.
    });
  };

  const installOffer = offer?.kind === "install" ? offer : null;

  return (
    <>
      {/*
        Відкритість прив'язана й до маршруту: якщо поки аркуш на екрані людина
        пішла назад у готування, він ховається, не записуючи відповіді, і
        повертається на спокійному екрані.
      */}
      <Sheet
        open={offer?.kind === "push" && calm}
        onClose={later}
        title="Сповіщення"
        footer={
          <div className="flex flex-col gap-1">
            <Button full onClick={enable} loading={busy}>
              <Bell size={17} />
              Увімкнути
            </Button>
            <Button full variant="ghost" onClick={later} disabled={busy}>
              Не зараз
            </Button>
            <button
              onClick={() => answer("never")}
              disabled={busy}
              className="mx-auto py-1.5 text-[12px] font-semibold text-faint disabled:opacity-45"
            >
              Більше не пропонувати
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl brand-gradient text-brand-ink">
              <Bell size={22} />
            </span>
            <p className="text-[14px] font-semibold leading-snug">
              Увімкни сповіщення — і Ням сам скаже, коли щось важливе.
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {/*
             * Таймер — тепер чесно. Дзвінок шле сервер (timer_pushes і
             * /api/push/timers), а не сторінка, тож він приходить і тоді, коли
             * застосунок згорнуто чи телефон заблоковано. Без увімкнених
             * сповіщень серверу нема куди дзвонити — це й є найвагоміша причина.
             */}
            <Reason icon={<Timer size={17} />}>
              Таймер готування продзвонить, навіть коли застосунок закрито
            </Reason>
            <Reason icon={<Refrigerator size={17} />}>
              Продукт у коморі доживає останній день
            </Reason>
            <Reason icon={<MessageCircle size={17} />}>Хтось прокоментував твій рецепт</Reason>
          </ul>

          <p className="text-[12px] leading-relaxed text-muted">
            Приходить лише на цей пристрій. Передумаєш — Налаштування → Сповіщення.
          </p>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(installOffer) && calm}
        onClose={closeInstall}
        title={installOffer ? installTitle(installOffer.env) : ""}
        footer={installOffer ? <InstallFooter env={installOffer.env} onInstall={install} onClose={closeInstall} /> : null}
      >
        {installOffer && (
          <div className="flex flex-col gap-4 pb-2">
            {installOffer.env === "prompt" ? (
              <PromptPitch />
            ) : (
              <InstallGuide env={installOffer.env} signedIn={Boolean(accountId)} />
            )}
            {installOffer.push && (
              <p className="flex items-start gap-2 rounded-2xl border border-brand/25 bg-brand/10 p-3 text-[12.5px] leading-relaxed">
                <Bell size={15} className="mt-0.5 shrink-0 text-brand" />
                <span>
                  Лише звідти приходять сповіщення — зокрема дзвінок таймера готування, коли{" "}
                  {currentAppleDevice() === "iPad" ? "iPad" : "телефон"} заблоковано. Відкрий Ням з
                  іконки — там і ввімкнеш.
                </span>
              </p>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

function installTitle(env: InstallKind): string {
  switch (env) {
    case "prompt":
      return "Встанови Ням";
    case "in-app":
      return "Відкрий Ням у браузері";
    default:
      return "Ням на Початковий екран";
  }
}

function InstallFooter({
  env,
  onInstall,
  onClose,
}: {
  env: InstallKind;
  onInstall: () => void;
  onClose: () => void;
}) {
  if (env === "prompt") {
    return (
      <div className="flex flex-col gap-1">
        <Button full onClick={onInstall}>
          <Download size={17} />
          Встановити
        </Button>
        <Button full variant="ghost" onClick={onClose}>
          Не зараз
        </Button>
      </div>
    );
  }

  if (env === "in-app" || env === "ios-other-browser") {
    return (
      <div className="flex flex-col gap-1">
        <CopyLinkButton />
        <Button full variant="ghost" onClick={onClose}>
          Зрозуміло
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Button full onClick={onClose}>
        Зрозуміло
      </Button>
      <ShareArrow spot={currentShareSpot()} />
    </div>
  );
}

/** Чим встановлений Ням кращий за вкладку — для справжньої кнопки «Встановити». */
function PromptPitch() {
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] brand-gradient text-3xl shadow-[var(--shadow-pop)]">
          🍲
        </span>
        <p className="text-[14px] font-semibold leading-snug">
          Один дотик — і Ням житиме окремою іконкою, як звичайний застосунок.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        <Reason icon={<Maximize2 size={17} />}>На весь екран, без адресного рядка й вкладок</Reason>
        <Reason icon={<WifiOff size={17} />}>Рецепти й комора відкриваються і без інтернету</Reason>
        <Reason icon={<Timer size={17} />}>Таймер готування під рукою, а не загублений серед вкладок</Reason>
      </ul>
    </>
  );
}

/**
 * Кроки встановлення вручну — для аркуша й для картки в налаштуваннях.
 *
 * Кнопки «додати на екран» сайт на iPhone не має і мати не може: Apple не дає
 * для цього жодного API, лише пункт у меню «Поширити». Тож найкраще, що
 * можна зробити, — показати ці три дотики так, щоб їх упізнати: значки
 * намальовані під ті, що людина побачить у Safari.
 *
 * Назви — дослівно як в українській iOS (посібник Apple uk-ua): «Поширити»,
 * «На Початковий екран», «Редагувати дії», «Відкрити як вебпрограму»,
 * «Додати». Кнопка, якої людина не знайде за назвою, ламає весь ланцюжок уже
 * на першому кроці, а значок поруч рятує не завжди.
 */
export function InstallGuide({
  env,
  signedIn,
  compact = false,
}: {
  env: Exclude<InstallKind, "prompt">;
  signedIn: boolean;
  compact?: boolean;
}) {
  const device = currentAppleDevice();
  const browser = currentBrowserName();
  const text = compact ? "text-[12.5px]" : "text-[13.5px]";

  const note = cn(compact ? "text-[11.5px]" : "text-[12px]", "leading-relaxed text-muted");

  if (env === "in-app") {
    const ios = device !== null;
    const target = ios ? "Safari" : "Chrome";
    return (
      <div className="flex flex-col gap-3">
        <p className={cn(text, "leading-relaxed text-muted")}>
          Ти у вбудованому браузері{browser ? ` ${browser}` : " застосунку"}. Звідси Ням на екран{" "}
          {device === "iPad" ? "iPad" : "телефона"} не додати
          {signedIn ? "" : ", а вхід через Google тут часто не пускає"} — відкрий сторінку в{" "}
          {target}.
        </p>
        {/*
          Один крок і запасний шлях під ним, без номера: «2. Такого пункту немає»
          читалось як наступна дія й як твердження, що пункту немає зовсім.
        */}
        <ol className="flex flex-col gap-2">
          <Step glyph={ios ? <MoreGlyph /> : <KebabGlyph />} compact={compact}>
            {ios ? (
              <>
                Торкнись «•••» — зазвичай угорі праворуч — і обери «Відкрити в Safari» чи
                «Відкрити в браузері».
              </>
            ) : (
              <>
                Торкнись «⋮» угорі праворуч і обери «Відкрити в Chrome» чи «Відкрити в
                браузері».
              </>
            )}
          </Step>
        </ol>
        <p className={note}>
          <Copy size={13} className="mr-1 inline align-[-2px] text-brand" />
          Немає такого пункту? Скопіюй посилання кнопкою нижче й встав його в адресний рядок{" "}
          {target}.
        </p>
        {compact && <CopyLinkButton />}
      </div>
    );
  }

  const ipad = env === "ipad-safari" || device === "iPad";
  const deviceName = ipad ? "iPad" : "iPhone";
  const spot: ShareSpot = ipad ? "top-right" : currentShareSpot();

  return (
    <div className="flex flex-col gap-3">
      <p className={cn(text, "leading-relaxed text-muted")}>
        {env === "ios-other-browser" ? (
          <>
            Кнопки, яка встановить сама, Apple сайтам не дає. Але {browser ?? "цей браузер"} на{" "}
            {deviceName} з iOS 16.4 уміє додати Ням на Початковий екран вручну:
          </>
        ) : (
          <>
            Кнопки, яка встановить сама, Apple сайтам не дає — на {deviceName} це три дотики в
            Safari:
          </>
        )}
      </p>

      <ol className="flex flex-col gap-2">
        {env === "ios-other-browser" ? (
          /*
           * Кнопку тут малює сам браузер, і назву дає він: у Chrome чи Firefox
           * українською це «Поділитися», а системне «Поширити» — у Safari.
           * Далі відкривається вже системний список, тож кроки 2–3 ті самі.
           */
          <Step n={1} glyph={<ShareGlyph />} compact={compact}>
            Знайди кнопку <ShareGlyph inline /> «Поділитися» чи «Поширити» — в адресному рядку
            або в меню браузера («•••» чи «≡»).
          </Step>
        ) : spot === "more-menu" ? (
          <Step n={1} glyph={<MoreGlyph />} compact={compact}>
            Торкнись «•••» праворуч унизу й обери «Поширити». Якщо кнопка <ShareGlyph inline />{" "}
            видна просто на панелі — тисни одразу її.
            <Hint>англійською — «Share»</Hint>
          </Step>
        ) : spot === "top-right" ? (
          <Step n={1} glyph={<ShareGlyph />} compact={compact}>
            Торкнись «Поширити» угорі праворуч, біля адресного рядка (або знайди її в меню
            «•••»).
            <Hint>англійською — «Share»</Hint>
          </Step>
        ) : (
          <Step n={1} glyph={<ShareGlyph />} compact={compact}>
            Торкнись «Поширити» на панелі внизу екрана (або в меню «•••», якщо панель
            компактна).
            <Hint>англійською — «Share»</Hint>
          </Step>
        )}

        <Step n={2} glyph={<AddSquareGlyph />} compact={compact}>
          Прокрути список дій і обери
          <span className="mt-1.5 flex items-center justify-between gap-2 rounded-xl border border-line bg-bg-elev px-3 py-2 font-semibold">
            На Початковий екран
            <AddSquareGlyph size={18} />
          </span>
          <Hint>англійською — «Add to Home Screen»</Hint>
          {/* Пункт можна прибрати зі списку — і тоді без цієї підказки крок 2 глухий кут. */}
          <Hint>
            Немає такого пункту? Прокрути до кінця, торкнись «Редагувати дії» й додай «На
            Початковий екран».
          </Hint>
        </Step>

        <Step n={3} glyph={<Check size={20} strokeWidth={2.4} />} compact={compact}>
          Натисни <b className="font-bold text-sky">Додати</b> угорі праворуч — і Ням зʼявиться
          серед застосунків.
          {/*
            З iOS 26 тут є перемикач «Відкрити як вебпрограму». Вимкнений — і
            іконка відкриває звичайну вкладку: без повного екрана й без
            сповіщень, хоч людина зробила все, що радили. На старіших iOS
            перемикача немає, тому й сказано умовно.
          */}
          <Hint>
            Якщо є перемикач «Відкрити як вебпрограму» — лиши його ввімкненим, інакше іконка
            відкриє звичайну вкладку, де не буде сповіщень.
          </Hint>
        </Step>
      </ol>

      {env === "ios-other-browser" && (
        <p className={note}>
          Не знайшов такого пункту? Відкрий Ням у Safari — там він є завжди. Посилання можна
          скопіювати {compact ? "тут" : "нижче"}.
        </p>
      )}
      {env === "ios-other-browser" && compact && <CopyLinkButton />}
    </div>
  );
}

/** Дрібний рядок під кроком: англійська назва чи запасний шлях. */
function Hint({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-[11.5px] leading-snug text-faint">{children}</span>;
}

/** Крок інструкції. Без n — єдиний крок, і номер там лише заважав би. */
function Step({
  n,
  glyph,
  compact,
  children,
}: {
  n?: number;
  glyph: React.ReactNode;
  compact: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3">
      <span className="relative mt-px shrink-0">
        <span
          className={cn(
            "grid place-items-center rounded-xl border border-line bg-bg-elev text-brand",
            compact ? "h-9 w-9" : "h-11 w-11",
          )}
        >
          {glyph}
        </span>
        {n !== undefined && (
          <span className="absolute -left-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full brand-gradient text-[11px] font-extrabold text-brand-ink">
            {n}
          </span>
        )}
      </span>
      <span className={cn("min-w-0 flex-1 self-center leading-snug", compact ? "text-[12.5px]" : "text-[13px]")}>
        {children}
      </span>
    </li>
  );
}

/**
 * Стрілка до «Поширити» — під аркушем, там, де панель Safari.
 *
 * Лише на iPhone: на iPad кнопка вгорі, і стрілка з низу екрана вела б не
 * туди. Хто просив менше руху, отримує ту саму стрілку, але нерухому.
 */
function ShareArrow({ spot }: { spot: ShareSpot }) {
  const reduce = useReducedMotion();
  if (spot === "top-right") return null;

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none flex pt-2", spot === "toolbar" ? "justify-center" : "justify-end pr-2")}
    >
      <motion.span
        animate={reduce ? undefined : { y: [0, 6, 0] }}
        transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
        className="flex flex-col items-center text-brand"
      >
        <span className="text-[11px] font-bold">
          {spot === "toolbar" ? "«Поширити» — тут, унизу" : "«•••» — тут"}
        </span>
        <ArrowDown size={18} strokeWidth={2.6} />
      </motion.span>
    </div>
  );
}

/**
 * Копіює адресу сторінки.
 *
 * Вбудовані браузери часто ховають «відкрити в браузері», тож вставити
 * посилання в Safari чи Chrome руками — надійний запасний шлях. Clipboard API
 * у них теж буває вимкнене, тому є й старий спосіб, а сама адреса лишається
 * на екрані — її можна виділити пальцем.
 */
export function CopyLinkButton() {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  // Без хвоста з параметрами: там зазвичай мітки Instagram і Facebook, а не наші.
  const url = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;

  const copy = () => {
    // Без async перед copyText: старий спосіб працює лише в самому натиску.
    void copyText(url).then((ok) => {
      if (ok) {
        setCopied(true);
        toast("Посилання скопійовано", "📋");
      } else {
        toast("Не вийшло скопіювати — виділи адресу під кнопкою", "⚠️");
      }
    });
  };

  /*
   * На iOS select() у полі лише для читання нічого не виділяє — потрібен ще
   * setSelectionRange. І на дотик, а не лише на фокус: повторний дотик у вже
   * сфокусоване поле фокусу не дає.
   */
  const selectAll = (input: HTMLInputElement) => {
    input.select();
    input.setSelectionRange(0, input.value.length);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Button full onClick={copy}>
        {copied ? <Check size={17} /> : <Copy size={17} />}
        {copied ? "Скопійовано" : "Скопіювати посилання"}
      </Button>
      <input
        readOnly
        value={url}
        aria-label="Адреса Ням"
        onFocus={(e) => selectAll(e.currentTarget)}
        onClick={(e) => selectAll(e.currentTarget)}
        className="w-full select-all truncate rounded-xl bg-surface-2 px-3 py-1.5 text-center text-[12px] text-muted outline-none"
      />
    </div>
  );
}

/** Скільки чекати на Clipboard API, перш ніж чесно сказати «не вийшло». */
const CLIPBOARD_TIMEOUT_MS = 1500;

/**
 * Копіює текст — спершу старим способом, потім Clipboard API.
 *
 * Порядок навмисний. execCommand("copy") браузер виконує лише в самому натиску,
 * тож він має йти першим і синхронно. Навпаки — спершу чекати на writeText —
 * у вбудованих браузерах (WKWebView, частина Android WebView) означало б: API
 * відмовляє вже після паузи, натиск за цей час «вичахає», і старий спосіб теж
 * отримує «ні». А writeText, що не відповідає зовсім, лишав би кнопку без
 * жодного тосту — тому на нього ще й таймер.
 */
function copyText(text: string): Promise<boolean> {
  if (copyWithSelection(text)) return Promise.resolve(true);
  if (!navigator.clipboard?.writeText) return Promise.resolve(false);
  return Promise.race([
    navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CLIPBOARD_TIMEOUT_MS)),
  ]);
}

function copyWithSelection(text: string): boolean {
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  try {
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    // 16px — щоб iOS не наближав сторінку, фокусуючи поле.
    area.style.fontSize = "16px";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus?.({ preventScroll: true });
  }
}

function Reason({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3">
      <span className="mt-px shrink-0 text-brand">{icon}</span>
      <span className="text-[13px] leading-snug">{children}</span>
    </li>
  );
}

/* ── Значки Safari ────────────────────────────────────────────────────── */

/*
 * Намальовані тут, а не взяті з lucide: людина має впізнати саме ту кнопку,
 * яку побачить у Safari, — квадрат зі стрілкою вгору, а не три кружечки
 * «поділитись» з Android. Товщина й заокруглення — як у решти значків.
 */

function Glyph({ size = 22, inline, children }: { size?: number; inline?: boolean; children: React.ReactNode }) {
  return (
    <svg
      width={inline ? 15 : size}
      height={inline ? 15 : size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={inline ? "inline align-text-bottom text-brand" : undefined}
    >
      {children}
    </svg>
  );
}

/** «Поширити» у Safari: відкритий згори квадрат і стрілка з нього вгору. */
export function ShareGlyph({ size, inline }: { size?: number; inline?: boolean }) {
  return (
    <Glyph size={size} inline={inline}>
      <path d="M12 3.5v11" />
      <path d="M8 7.5l4-4 4 4" />
      <path d="M8.5 10.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-1.5" />
    </Glyph>
  );
}

/** «На Початковий екран»: заокруглений квадрат із плюсом. */
function AddSquareGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Glyph>
  );
}

/** «•••» у колі — меню компактної панелі Safari й вбудованих браузерів. */
function MoreGlyph() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8" cy="12" r="0.6" fill="currentColor" strokeWidth={1.6} />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" strokeWidth={1.6} />
      <circle cx="16" cy="12" r="0.6" fill="currentColor" strokeWidth={1.6} />
    </Glyph>
  );
}

/** «⋮» — меню вбудованих браузерів на Android. */
function KebabGlyph() {
  return (
    <Glyph>
      <circle cx="12" cy="5.5" r="0.8" fill="currentColor" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
      <circle cx="12" cy="18.5" r="0.8" fill="currentColor" />
    </Glyph>
  );
}
