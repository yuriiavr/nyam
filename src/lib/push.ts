"use client";

import {
  deletePushSubscription,
  hasPushSubscription,
  savePushSubscription,
} from "./supabase/api";
import { useApp, type PushOfferOutcome, type PushOfferRecord } from "./store";

/**
 * Пуш-сповіщення: підписка пристрою.
 *
 * Сам показ робить service worker, сервер лише надсилає. Тут — три речі:
 * спитати дозвіл, підписати пристрій і записати підписку в базу, щоб було
 * кому надсилати.
 *
 * Підписка належить пристрою, а не людині: з телефона й з ноутбука це два
 * різні рядки, і відписка на одному не глушить інший.
 */

/**
 * Публічний ключ беремо з сервера, а не зі змінної оточення.
 *
 * У браузер Next віддає лише змінні з префіксом NEXT_PUBLIC_, а таку змінну
 * не можна позначити sensitive у Vercel — і навпаки. Запит знімає це
 * протиріччя: ключ публічний за призначенням, і його однаково отримує кожен
 * пристрій, що підписується.
 */
let keyCache: string | null = null;

async function vapidKey(): Promise<string> {
  if (keyCache) return keyCache;
  try {
    const res = await fetch("/api/push/key", { headers: { Accept: "application/json" } });
    const data = (await res.json()) as { key?: string };
    // Порожнє не запамʼятовуємо: одна невдала спроба на слабкій мережі
    // інакше на всю сесію переконувала б застосунок, що сповіщень не буває.
    if (data.key) keyCache = data.key;
    return data.key ?? "";
  } catch {
    return "";
  }
}

/** Чи вміє цей браузер пуш. Чи налаштований сервер — питаємо окремо. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Чи є на сервері ключ — незалежно від того, що вміє цей браузер.
 *
 * Окремо від pushConfigured для айфона у вкладці Safari: браузер там пуша не
 * вміє, але радити «додай на Початковий екран заради сповіщень» є сенс лише тоді,
 * коли сервер справді готовий їх слати.
 */
export async function pushServerReady(): Promise<boolean> {
  return (await vapidKey()).length > 0;
}

/** Чи є на сервері ключ, тобто чи є взагалі що вмикати. */
export async function pushConfigured(): Promise<boolean> {
  if (!pushSupported()) return false;
  return pushServerReady();
}

export function pushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * Ключ сервера у вигляді, якого хоче pushManager.
 *
 * base64url з пʼятьма-шістьма символами — це той самий ключ, але браузер
 * приймає лише сирі байти, тож переводимо руками.
 */
function keyToBytes(base64url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);

  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  // Саме ArrayBuffer, а не Uint8Array: підпис pushManager вимагає цього типу.
  return bytes.buffer as ArrayBuffer;
}

/**
 * Реєстрація service worker — з підстраховкою.
 *
 * Раніше тут просто чекали на `navigator.serviceWorker.ready`, і це була
 * найдорожча стрічка в усьому пуші: коли реєстрації немає, ця обіцянка не
 * настає ніколи. Не помилка, не відмова — вічне очікування, від якого кнопка
 * крутиться без кінця, а екран налаштувань не показує взагалі нічого.
 *
 * Тому: якщо реєстрації немає — робимо її самі, а на очікування кладемо
 * таймер. Краще чесне «не вдалося», ніж мовчазна вічність.
 */
const READY_TIMEOUT_MS = 8000;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;

  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (!existing) await navigator.serviceWorker.register("/sw.js");

    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

/** Чи підписаний цей пристрій просто зараз. */
export async function pushActive(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await registration();
  return Boolean(await reg?.pushManager.getSubscription());
}

/**
 * Чим скінчилась спроба увімкнути.
 *
 * denied і dismissed — різні речі, хоч обидві «не вийшло». denied — дозвіл
 * заблоковано, і повернути його може лише сама людина в налаштуваннях
 * телефона чи браузера. dismissed — вікно просто закрили (або Chrome його
 * навіть не показав), і спитати ще раз цілком можна. Раніше обидва випадки
 * відправляли людину в налаштування телефона, де нічого не було заблоковано.
 */
export type PushResult =
  | { state: "on" }
  | { state: "denied" }
  | { state: "dismissed" }
  | { state: "unsupported"; reason: string }
  | { state: "failed"; reason: string };

/**
 * Чи знає про цей пристрій сервер.
 *
 * Питання не зайве: підписка живе у двох місцях — у браузері й у базі, — і
 * розійтись вони можуть тихо. Досі застосунок питав лише браузер, тож після
 * однієї невдалої відправки телефон назавжди показував «увімкнено», а
 * надсилати не було кому.
 */
export async function pushState(): Promise<{ browser: boolean; server: boolean }> {
  if (!pushSupported()) return { browser: false, server: false };

  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return { browser: false, server: false };

  const known = await hasPushSubscription(subscription.endpoint).catch(() => false);
  return { browser: true, server: known };
}

/**
 * Тихо відновлює запис про цей пристрій.
 *
 * Потрібно, бо адреса підписки з часом змінюється сама, а на iPhone події
 * про це не існує взагалі — там це єдиний спосіб полагодити. Виконується при
 * запуску: якщо браузер підписаний, а в базі його немає, дописуємо.
 */
export async function syncPushSubscription(userId: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;

  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

  await savePushSubscription({
    userId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    agent: navigator.userAgent.slice(0, 200),
  }).catch(() => undefined);
}

/**
 * Акаунт, який востаннє сам вмикав сповіщення на цьому пристрої.
 *
 * Запис pushOffer — про пристрій, а не про людину, і після виходу з акаунта
 * лишається «enabled». Без власника таймер наступного, хто увійде на тому ж
 * планшеті, мовчки відновив би підписку вже на нього (див. timerPushStep): дозвіл
 * у браузері «granted», вікна не буде, і сповіщення про чужі — для нього —
 * коментарі й комору почали б приходити без жодного його «так».
 *
 * На виході власника не стираємо (disablePush його не чіпає): інакше після
 * повторного входу не впізнати й того, хто вмикав сам. Записуємо лише там, де
 * людина справді сказала «так» (enablePush) або де база підтвердила, що
 * підписка цього пристрою — її.
 */
const PUSH_OWNER_KEY = "nyam-push-owner";

export function rememberPushOwner(userId: string): void {
  try {
    localStorage.setItem(PUSH_OWNER_KEY, userId);
  } catch {
    /* сховище недоступне — тоді просто не відновлюємо мовчки */
  }
}

function pushOwner(): string | null {
  try {
    return localStorage.getItem(PUSH_OWNER_KEY);
  } catch {
    return null;
  }
}

/**
 * Вмикає сповіщення на цьому пристрої.
 *
 * Дозвіл питаємо лише тут, у відповідь на натиск — браузери давно карають
 * за питання «просто так», а людина, яку спитали без приводу, тисне «ні»
 * назавжди.
 */
export async function enablePush(userId: string): Promise<PushResult> {
  if (!pushSupported()) return { state: "unsupported", reason: "браузер не вміє пуша" };

  /*
   * Дозвіл питаємо ПЕРШИМ, ще до будь-якого запиту в мережу.
   *
   * Safari дозволяє питати лише поки триває «дотик» — і будь-яке очікування
   * перед цим його з'їдає. Раніше тут спершу йшли по ключ на сервер, і на
   * iPhone вікно з дозволом просто не з'являлось: натиснув, кнопка блимнула,
   * нічого не сталось.
   */
  const permission = await Notification.requestPermission();
  if (permission === "denied") return { state: "denied" };
  if (permission !== "granted") return { state: "dismissed" };

  const key = await vapidKey();
  if (!key) return { state: "unsupported", reason: "сервер не віддав ключ" };

  try {
    const reg = await registration();
    if (!reg) return { state: "failed", reason: "service worker не зареєструвався" };

    const existing = await reg.pushManager.getSubscription();
    const subscription =
      existing ??
      (await reg.pushManager.subscribe({
        // Без цього браузер не доставить нічого, крім повідомлень із тілом,
        // а Chrome такі підписки просто не створює.
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(key),
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { state: "failed", reason: "браузер не дав ключів підписки" };
    }

    await savePushSubscription({
      userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      agent: navigator.userAgent.slice(0, 200),
    });
    rememberPushOwner(userId);
    return { state: "on" };
  } catch (error) {
    /*
     * Кажемо, що саме сталось. Раніше тут було просто «не вдалося» — і
     * через це порожня таблиця підписок місяцями виглядала б як «мабуть,
     * телефон не підтримує».
     */
    return {
      state: "failed",
      reason: error instanceof Error ? error.message : "невідома помилка",
    };
  }
}

/**
 * Підписка цього браузера — без реєстрації й без очікування.
 *
 * registration() тут не годиться: вона сама реєструє service worker і чекає до
 * восьми секунд. Щоб лише подивитись, чи підписка є, це зайве — немає
 * реєстрації, то немає й підписки, — а на виході з акаунта ці вісім секунд
 * були б кнопкою, яка не виходить.
 */
async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Скільки чекати на видалення рядка з бази.
 *
 * Недовго, бо головне на цей момент уже зроблено: браузер відписано, і
 * служба пуша на цю адресу більше не доставить. Рядок, що лишився, сервер
 * прибере сам на першій же відправці — вона повернеться з «адреси немає».
 */
const FORGET_TIMEOUT_MS = 4000;

/**
 * Вимикає на цьому пристрої — і в браузері, і в базі.
 *
 * Викликається й перед виходом з акаунта (див. signOut): рядок у базі може
 * видалити лише його власник, тож після виходу він так і лишився б чужим, а
 * пристрій — отримувати сповіщення попереднього акаунта.
 */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const subscription = await currentSubscription();
  if (!subscription) return;

  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => undefined);
  await Promise.race([
    deletePushSubscription(endpoint).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, FORGET_TIMEOUT_MS)),
  ]);
}

/* ── Пропозиція увімкнути ─────────────────────────────────────────────── */

/**
 * Стан цього пристрою для рішення «пропонувати чи ні».
 *
 * Дешевий: лише те, що вже є, без реєстрації service worker і без очікування —
 * перевірка йде при кожному запуску, і сама по собі нічого не має змінювати.
 */
export interface PushDevice {
  permission: NotificationPermission;
  /** Чи підписаний браузер. */
  browser: boolean;
  /** Чи бачить цю підписку база від імені поточного акаунта. */
  server: boolean;
}

export async function peekPushDevice(): Promise<PushDevice | null> {
  if (!pushSupported()) return null;

  const subscription = await currentSubscription();
  const server = subscription
    ? await hasPushSubscription(subscription.endpoint).catch(() => false)
    : false;
  // Дозвіл читаємо після очікувань: за цей час його могли змінити в іншій вкладці.
  return { permission: Notification.permission, browser: Boolean(subscription), server };
}

/** Через скільки днів «не зараз» можна спитати знову. */
export const OFFER_PAUSE_DAYS = 7;
/**
 * Після скількох «не зараз» поспіль мовчимо назовсім. Два — це перша
 * пропозиція і ще одна, через паузу: двічі відкладене — вже відповідь.
 */
export const OFFER_LATER_LIMIT = 2;

/** Чи не минула ще пауза після «не зараз». */
function laterPaused(record: PushOfferRecord, now: number): boolean {
  const days = (now - Date.parse(record.at)) / 86_400_000;
  // Зіпсована дата дає NaN — і тоді теж мовчимо: краще не спитати, ніж спитати двічі.
  return !(days >= OFFER_PAUSE_DAYS);
}

/**
 * Чи можна застосунку спитати самому — не з картки в налаштуваннях, куди
 * людина прийшла сама.
 *
 * Одна відповідь і для пропозиції на старті, і для таймера готування: інакше
 * відмова в одному місці не діяла б в іншому, і «не зараз» на аркуші
 * наздоганяло б вікном дозволу біля плити.
 */
function mayAsk(record: PushOfferRecord | null, now: number): boolean {
  /*
   * «enabled» тут — пристрій, який вмикали, а потім вийшли з акаунта (вихід
   * відписує), або підписка чи дозвіл самі зникли. Людина вже казала «так»,
   * тож спитати знову — не нав'язливість, а повернення її вибору. Якщо ж
   * увійшов уже хтось інший, для нього це звичайне питання, а не мовчазне
   * ввімкнення: мовчки відновлює лише таймер, і лише власникові.
   */
  if (!record || record.outcome === "enabled") return true;
  if (record.outcome !== "later") return false;
  return !laterPaused(record, now) && record.count < OFFER_LATER_LIMIT;
}

export type PushOfferStep = "offer" | "record-enabled" | "skip";

/**
 * Що робити з пропозицією на цьому пристрої.
 *
 * Чиста функція, щоб таблицю рішень можна було перевірити без браузера.
 */
export function pushOfferStep(
  device: PushDevice,
  record: PushOfferRecord | null,
  now = Date.now(),
): PushOfferStep {
  // Заблоковано — питати марно: браузер відповість «ні», не показавши нічого.
  // Не записуємо: дозвіл сам по собі і є записом, і якщо людина розблокує його
  // в налаштуваннях, це її свідомий крок, після якого можна й спитати.
  if (device.permission === "denied") return "skip";

  if (device.browser) {
    /*
     * Браузер підписаний, а база цього не бачить: або підписка чужого акаунта
     * на цьому ж пристрої, або запис не долетів. Пропонувати «увімкнути» тут
     * нечесно — воно вже ніби увімкнено. Про розбіжність чесно каже картка в
     * налаштуваннях, а не долетілий запис дописує usePushRepair.
     */
    if (!device.server) return "skip";
    return record?.outcome === "enabled" ? "skip" : "record-enabled";
  }

  // Підписки немає — тож усе вирішує відповідь, яку цей пристрій уже давав.
  return mayAsk(record, now) ? "offer" : "skip";
}

/**
 * Як результат спроби лягає у відповідь про сповіщення.
 *
 * null — записувати нічого. Або відповіді не було (зламалось щось у нас чи в
 * браузері, і людина тут ні до чого), або відповідь уже записав сам браузер:
 * «заблокувати» — це Notification.permission === "denied", і pushOfferStep
 * та таймер мовчать, поки воно так.
 *
 * Раніше блок ставав остаточним «never». Але дозвіл людина може розблокувати
 * в налаштуваннях телефона — і тоді «never» лишався б назавжди: ні пропозиції
 * на старті, ні навіть вікна дозволу біля таймера, хоч сама вона вже
 * передумала. До того ж «denied» дає й Chrome, коли тимчасово глушить сайт
 * після кількох закритих вікон, — людина там не блокувала нічого. «never» —
 * лише свідома кнопка «Більше не пропонувати».
 */
export function pushOutcome(result: PushResult): PushOfferOutcome | null {
  switch (result.state) {
    case "on":
      return "enabled";
    case "dismissed":
      return "later";
    default:
      return null;
  }
}

/**
 * Чи питати дозвіл із таймера готування.
 *
 * Лише коли вікно з дозволом справді зараз з'явиться, тобто дозвіл ще
 * «default». Уже «granted» — будильникові більше нічого не треба, а підписати
 * пристрій мовчки означало б без жодного питання ввімкнути коментарі й
 * комору тому, хто на аркуші щойно сказав «не зараз». Таке «так» зібрав
 * здебільшого старий таймер, який просив лише дозвіл, — і воно було про
 * будильник, а не про все інше. (Виняток — «enabled»: там людина вмикала
 * сама, і таймер лише відновлює її підписку, див. timerPushStep.)
 *
 * Далі — та сама відповідь, що й для пропозиції на старті, з паузою й
 * лімітом: кроків із таймером на страву буває пʼять, і кожен не має
 * перепитувати.
 */
export function timerMayAsk(
  permission: NotificationPermission,
  record: PushOfferRecord | null,
  now = Date.now(),
): boolean {
  // Чий запис — для «ask» байдуже: вікно дозволу й так спитає саму людину.
  return timerPushStep(permission, record, false, now) === "ask";
}

/**
 * Що робити з пушем, коли запускають таймер готування.
 *
 * - ask — спитати дозвіл (див. timerMayAsk) і, якщо «так», підписати.
 * - restore — людина вже вмикала на цьому пристрої й дозвіл досі є, тож
 *   питати нічого; треба лише перевірити, чи жива підписка, і відновити її,
 *   якщо ні. Зникає вона без жодного вікна: вихід з акаунта відписує пристрій,
 *   а запис «enabled» лишається. syncPushSubscription тут не рятує — він
 *   лише дописує в базу наявну підписку, створити нову не вміє, — і без цього
 *   сервер дзвонив би за таймер на порожнечу.
 *   Лише для того самого акаунта (owner): «enabled» після чужого виходу — не
 *   згода того, хто увійшов тепер, а вікна, яке спитало б його, вже не буде.
 * - none — нічого.
 */
export type TimerPushStep = "ask" | "restore" | "none";

export function timerPushStep(
  permission: NotificationPermission,
  record: PushOfferRecord | null,
  owner: boolean,
  now = Date.now(),
): TimerPushStep {
  if (permission === "default") return mayAsk(record, now) ? "ask" : "none";
  if (permission === "granted" && record?.outcome === "enabled" && owner) return "restore";
  return "none";
}

/**
 * Питає дозвіл із таймера готування — у тому самому натиску, що запускає
 * таймер — і, якщо людина погодилась, одразу підписує.
 *
 * Раніше таймер просив лише дозвіл, і пристрій лишався «дозволено, але не
 * підписано»: людина у вікні сказала сповіщенням «так», а з сервера не
 * приходило нічого, і картка в налаштуваннях показувала «вимкнено». Тож і
 * вмикаємо чесно, і кажемо про це тостом (onEnabled): вікно з'явилось біля
 * таймера, і без тосту легко вирішити, що дозвіл був лише для нього.
 *
 * onEnabled кличемо й тоді, коли підписку відновлено (restore): пристрій до
 * цього моменту справді нічого не отримував, тож тост каже правду, а
 * будильник для щойно запущеного відліку сервер ще не записав.
 *
 * Синхронна навмисно: enablePush має стартувати ще в натиску, інакше Safari
 * вікна з дозволом не покаже. Відповідь пишемо тим самим записом, що й
 * пропозиція, тож і відмова тут діє на старті.
 */
export function enablePushFromTimer(onEnabled?: () => void): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;

  const { account, pushOffer } = useApp.getState();
  const owner = Boolean(account) && pushOwner() === account?.id;
  const step = timerPushStep(Notification.permission, pushOffer, owner);
  if (step === "none") return;

  if (step === "restore") {
    if (!pushSupported() || !account) return;
    const userId = account.id;
    /*
     * Тут чекати можна: дозвіл уже «granted», і requestPermission усередині
     * enablePush відповість одразу, без вікна, — тож натиск Safari не потрібен.
     */
    void currentSubscription()
      .then(async (subscription) => {
        if (subscription) return;
        const result = await enablePush(userId);
        if (result.state === "on") onEnabled?.();
      })
      .catch(() => undefined);
    return;
  }

  // Браузер без пуша чи без акаунта: будильнику досить самого дозволу, як і раніше.
  if (!pushSupported() || !account) {
    void Notification.requestPermission();
    return;
  }

  void enablePush(account.id)
    .then((result) => {
      // Блок не записуємо (див. pushOutcome): розблокує — таймер спитає знову.
      const outcome = pushOutcome(result);
      if (outcome) useApp.getState().setPushOffer(outcome);
      if (result.state === "on") onEnabled?.();
    })
    .catch(() => undefined);
}
