"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Timer,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, Sheet, Stars, useToast } from "@/components/ui";
import { ing } from "@/data/ingredients";
import type { Consumed } from "@/lib/pantry";
import { enablePushFromTimer, pushServerReady } from "@/lib/push";
import { recipeById, useApp } from "@/lib/store";
import {
  cancelTimerPush,
  fetchTimerPushes,
  hasPushSubscription,
  scheduleTimerPush,
  TimerPushError,
  type TimerPush,
} from "@/lib/supabase/api";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { TIMER_STALE_MS } from "@/lib/timer-push";
import type { PantryItem } from "@/lib/types";
import { formatClock, haptic } from "@/lib/utils";

/* ── Будильник із сервера ─────────────────────────────────────────────────
 *
 * На iPhone застосунок з екрана «Домів», щойно його згорнули, заморожується
 * цілком: setInterval не доходить до нуля, і будильник дзвонив лише тоді,
 * коли застосунок відкривали знову. Пуш із сервера приходить і в закритий,
 * тож запущений таймер ще й записує в базу «коли дзвонити» і «куди» — підписку
 * саме цього пристрою (timer_pushes), а сервер у ту секунду надсилає туди
 * сповіщення з тим самим тегом, що й місцевий будильник: встигли обидва — на
 * екрані одне. Інші пристрої акаунта мовчать: макарони на цій плиті.
 *
 * Пауза, скидання, інший крок, «Готово!» і вихід хрестиком будильник
 * скасовують. А от просто піти зі сторінки — ні: зварити макарони можна й
 * гортаючи стрічку, і дзвінок тоді потрібен якраз найбільше. Щоб при
 * поверненні не лишився «привид» — будильник на сервері при таймері, якого на
 * екрані вже немає, — запущений таймер памʼятається в localStorage, і
 * сторінка, відкрита знову, підхоплює його: той самий крок, той самий відлік,
 * той самий рядок у базі. Саме localStorage: iPhone вивантажує згорнутий
 * застосунок без попередження, а sessionStorage зникає разом із ним — і
 * будильник у базі лишався б таким, якого вже ніщо не скасує.
 *
 * Якщо ж і сховище загубилось (стерли дані сайту, застосунок перевстановили),
 * сторінка питає базу, чи немає будильників цього рецепта на цьому пристрої,
 * про які ніхто не памʼятає. Такі не чіпаємо одразу — вони можуть бути
 * правдою, макарони ж варяться, — а прибираємо при першій дії з таймером:
 * старт, пауза, скидання, хрестик, «Готово!». Таймер на сторінці один, тож
 * екран тоді — остаточна правда, але лише для свого пристрою: будильник
 * телефона, заблокованого біля плити, ноутбук не бачить і не скасовує.
 */

/**
 * Скільки часу після дедлайну означає «повернулись, коли давно продзвонило».
 *
 * Тоді системне сповіщення вже не показуємо — але лише коли будильник точно
 * лежав на сервері: серверне, найімовірніше, щойно було, і друге таке саме
 * лише задзвонило б ще раз.
 */
const CAUGHT_UP_MS = 3000;

/**
 * Скільки після строку ще є сенс скасовувати будильник.
 *
 * Здоровий сервер забирає рядок за 2 секунди до строку, і скасовувати вже
 * нічого. Але розсилка, що відстала, ще може надіслати будильник, прострочений
 * до TIMER_STALE_MS (10 хвилин), — стільки й чекаємо. Саме число, а не копія:
 * межа, до якої сервер ще дзвонить, і межа, до якої є сенс скасовувати, — одна.
 */
const CANCEL_USEFUL_MS = TIMER_STALE_MS;

/** Будильники, які просили поставити в цій сесії, — з моментом дзвінка. */
const fireAtOf = new Map<string, number>();

/**
 * Будильники, запис яких почався. Рядок міг дійти до бази, навіть коли
 * відповідь загубилась, — тож скасовувати треба кожен такий, а не лише
 * підтверджені.
 */
const tried = new Set<string>();

/** Будильники, запис яких база підтвердила: сервер про них точно знає. */
const written = new Set<string>();

/*
 * Запис і скасування — по черзі, в тому порядку, в якому їх попросили.
 * Запити летять незалежно, і «пауза» одразу після «старту» могла б дійти до
 * бази раніше за сам запис — тоді на сервері лишився б будильник на паузі.
 * Черга спільна на весь модуль: переживає й перехід між сторінками. Кожен
 * запит у ній обмежений у часі (див. api.ts), щоб один завислий не тримав
 * за собою скасування.
 */
let alarmQueue: Promise<void> = Promise.resolve();

function queueAlarm(op: () => Promise<void>): void {
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
 * знову на екрані, раз на 10 секунд — і при наступному відкритті сторінки,
 * якщо застосунок устигли закрити.
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

/** Скасовує будильник, поставлений у цій сесії чи знайдений у базі. */
function cancelAlarm(id: string): void {
  const fireAt = fireAtOf.get(id);
  if (fireAt == null) return;
  const list = readCancels();
  if (!list.some((c) => c.id === id)) {
    writeCancels([...list, { id, until: fireAt + CANCEL_USEFUL_MS }]);
  }
  flushCancels(id);
}

function flushCancels(only?: string): void {
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

/** Раз на весь застосунок: слухачі живуть і після виходу зі сторінки готування. */
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
type AlarmDraft = Omit<TimerPush, "endpoint">;

/**
 * Ставить будильник на сервері.
 *
 * `push` готують у мить старту — з адресою й текстом саме того відліку. Другий
 * виклик приходить аж після вікна дозволу й підписки, коли людина могла вже
 * піти на іншу сторінку, і адреса, прочитана тоді, вела б натиск на сповіщення
 * не туди.
 *
 * `current` — чи цей відлік досі живий: перевірки, що ставити є сенс, чекають
 * мережі, а за цей час таймер могли поставити на паузу.
 */
function armAlarm(push: AlarmDraft, recipeId: string, current: () => boolean): void {
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

    // Позначка й для збереженого відліку: сторінка, відкрита знову, має знати,
    // чи сервер уже дзвонив за неї (див. finish).
    const saved = readRun(recipeId);
    if (saved?.alarmId === push.id && !saved.armed) saveRun(recipeId, { ...saved, armed: true });
  });
}

/** Скільки чекати відповіді про ключі сервера, перш ніж вирішити «не дійде». */
const REACH_TIMEOUT_MS = 5000;

/** uuid для рядка. randomUUID немає поза https — а телефон у локальній мережі саме там. */
function newAlarmId(): string {
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
 * Будильник на сторінці працює в усіх цих випадках однаково.
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
async function deviceEndpoint(): Promise<string | null> {
  if (!("PushManager" in window)) return null;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

/** Текст будильника — один для місцевого й серверного, щоб заміна була непомітна. */
function alarmText(recipeTitle: string, stepIndex: number): string {
  const title = recipeTitle.length > 60 ? `${recipeTitle.slice(0, 59)}…` : recipeTitle;
  return `Час вийшов — перевір страву. «${title}», крок ${stepIndex + 1}`;
}

/** Запущений таймер, який переживає вихід зі сторінки. */
interface SavedRun {
  step: number;
  deadline: number;
  /** Повний час кроку — щоб «скинути» після повернення давало свій час, а не авторський. */
  base: number;
  alarmId: string | null;
  /** База підтвердила запис будильника — сервер продзвонить і без сторінки. */
  armed: boolean;
}

const runKey = (recipeId: string) => `nyam-cook-timer:${recipeId}`;

/*
 * localStorage, а не sessionStorage — див. нагорі файлу. Застарілим відлік
 * стати не може: той, чий строк минув, при відкритті сторінки просто
 * викидається.
 */
function readRun(recipeId: string): SavedRun | null {
  try {
    const raw = localStorage.getItem(runKey(recipeId));
    if (!raw) return null;
    const run = JSON.parse(raw) as Partial<SavedRun>;
    if (
      typeof run.step !== "number" ||
      typeof run.deadline !== "number" ||
      typeof run.base !== "number"
    ) {
      return null;
    }
    return {
      step: run.step,
      deadline: run.deadline,
      base: run.base,
      alarmId: typeof run.alarmId === "string" ? run.alarmId : null,
      armed: run.armed === true,
    };
  } catch {
    return null;
  }
}

function saveRun(recipeId: string, run: SavedRun | null): void {
  try {
    if (run) localStorage.setItem(runKey(recipeId), JSON.stringify(run));
    else localStorage.removeItem(runKey(recipeId));
  } catch {
    /* приватний режим — тоді просто не відновимо */
  }
}

export default function CookPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);
  const restorePantry = useApp((s) => s.restorePantry);
  const markCooked = useApp((s) => s.markCooked);
  const consumePantry = useApp((s) => s.consumePantry);
  const rate = useApp((s) => s.rate);
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const recipe = useMemo(
    () => (hydrated ? recipeById(useApp.getState(), params.id) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, params.id, myRecipes, remoteRecipes],
  );

  const [step, setStep] = useState(-1); // -1 = екран підготовки
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);
  const [rating, setRating] = useState(0);

  /* Таймер.
     Лічильник тримаємо не як «мінус секунда щотику», а як абсолютний момент
     завершення. Браузер у фоні душить setInterval (аж до повної зупинки), і
     на старій схемі таймер «ставав на паузу», коли вийти із застосунку.
     З дедлайном час іде за годинником, а тік лише перемальовує число. */
  const [remaining, setRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const deadlineRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Будильник на сервері для поточного відліку (див. нагорі файлу). */
  const alarmIdRef = useRef<string | null>(null);
  /** Відлік, збережений до виходу зі сторінки, — чекає, поки крок стане тим самим. */
  const restoreRef = useRef<SavedRun | null>(null);

  // Не давати екрану гаснути
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    let released = false;
    const request = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {
        /* не критично */
      }
    };
    request();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !released) request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      wakeRef.current?.release().catch(() => {});
    };
  }, []);

  const currentStep = recipe && step >= 0 ? recipe.steps[step] : null;

  /*
   * Власний час для кроку, заданий на ходу. Рецепт каже «варити 10 хвилин»,
   * але макарони бувають різні, і міняти заради цього сам рецепт безглуздо:
   * зміна живе рівно стільки, скільки триває це готування.
   */
  const [customSec, setCustomSec] = useState<Record<number, number>>({});
  const [timerSheet, setTimerSheet] = useState(false);
  // Нуль у customSec — це «Без таймера», а не таймер на нуль секунд: інакше
  // замість кнопки «Поставити таймер» лишався мертвий червоний 0:00.
  const baseSec = step in customSec ? customSec[step] || null : (currentStep?.timerSec ?? null);

  /** Будильники цього рецепта й пристрою в базі, про які не памʼятає жоден екран (див. нагорі файлу). */
  const lostRef = useRef<string[]>([]);

  /*
   * Прибирає загублені будильники — теж через чергу: пошук у базі міг ще не
   * повернутись, і тоді список прочитаємо вже після нього, а не порожнім.
   */
  const dropLost = useCallback(() => {
    queueAlarm(async () => {
      for (const id of lostRef.current.splice(0)) cancelAlarm(id);
    });
  }, []);

  /** Відлік зупинено назовсім: ні дзвінка з сервера, ні відновлення при поверненні. */
  const dropRun = useCallback(() => {
    const id = alarmIdRef.current;
    alarmIdRef.current = null;
    if (id) cancelAlarm(id);
    dropLost();
    saveRun(params.id, null);
  }, [dropLost, params.id]);

  /*
   * Повернення на сторінку, де лишили запущений таймер.
   *
   * Раз на рецепт: список рецептів у сховищі оновлюється й сам, і кожне
   * оновлення не має перекидати людину на збережений крок.
   */
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!recipe || restoredFor.current === recipe.id) return;
    restoredFor.current = recipe.id;

    const saved = readRun(params.id);
    if (!saved) return;

    if (saved.deadline - Date.now() < 1000) {
      // Час уже вийшов — відновлювати нічого. Будильник на сервері не чіпаємо:
      // якщо він ще не продзвонив, то продзвонить за мить, і це правда.
      saveRun(params.id, null);
      return;
    }

    // Чи дійшов запис до бази, не знаємо напевно — тож скасовувати вважаємо
    // за потрібне, а «сервер уже продзвонив» — лише з підтвердженням.
    if (saved.alarmId) {
      fireAtOf.set(saved.alarmId, saved.deadline);
      tried.add(saved.alarmId);
      if (saved.armed) written.add(saved.alarmId);
    }

    const savedStep = recipe.steps[saved.step];
    if (!savedStep) {
      // Рецепт за цей час змінився, і кроку більше немає — дзвонити нема про що.
      saveRun(params.id, null);
      if (saved.alarmId) cancelAlarm(saved.alarmId);
      return;
    }

    restoreRef.current = saved;
    if (saved.base !== savedStep.timerSec) setCustomSec({ [saved.step]: saved.base });
    setStep(saved.step);
  }, [recipe, params.id]);

  /*
   * Звірка з базою — щойно відомий акаунт. Не одразу при відкритті: акаунт
   * піднімається із сесії вже після першого рендеру, а без нього ні пошук, ні
   * скасування не пройдуть RLS.
   *
   * Заразом доганяємо скасування, що не дійшли минулого разу: застосунок могли
   * закрити раніше, ніж повернулась мережа.
   */
  const accountId = useApp((s) => s.account?.id ?? null);
  const reconciledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!recipe || !accountId || !isSupabaseConfigured) return;
    const key = `${recipe.id}:${accountId}`;
    if (reconciledFor.current === key) return;
    reconciledFor.current = key;

    flushCancels();
    const url = window.location.pathname;
    queueAlarm(async () => {
      // Лише будильники цього пристрою (див. fetchTimerPushes). Браузер не
      // підписаний — то й дзвонити сюди сервер не міг, шукати нічого.
      const endpoint = await deviceEndpoint();
      if (!endpoint) return;
      for (const row of await fetchTimerPushes(url, endpoint)) {
        // Про цей будильник сесія знає сама: відновлений відлік, щойно
        // запущений або вже скасовуваний.
        if (fireAtOf.has(row.id)) continue;
        fireAtOf.set(row.id, row.fireAt);
        tried.add(row.id);
        lostRef.current.push(row.id);
      }
    });
  }, [recipe, accountId]);

  // Скидаємо таймер при зміні кроку — або підхоплюємо збережений відлік.
  useEffect(() => {
    const restore = restoreRef.current;
    if (restore && restore.step === step) {
      restoreRef.current = null;
      alarmIdRef.current = restore.alarmId;
      deadlineRef.current = restore.deadline;
      firedRef.current = false;
      setRemaining(Math.max(0, Math.ceil((restore.deadline - Date.now()) / 1000)));
      setRunning(true);
      return;
    }
    // Крок чи його час змінили посеред відліку — старий будильник уже ні до чого.
    if (deadlineRef.current != null) dropRun();
    setRunning(false);
    deadlineRef.current = null;
    firedRef.current = false;
    setRemaining(baseSec);
  }, [step, baseSec, dropRun]);

  const finish = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const deadline = deadlineRef.current;
    setRunning(false);
    deadlineRef.current = null;
    setRemaining(0);
    haptic([200, 100, 200, 100, 300]);
    toast("Час вийшов!", "⏰");
    saveRun(params.id, null);

    const id = alarmIdRef.current;
    alarmIdRef.current = null;
    const visible = document.visibilityState === "visible";
    const late = deadline != null && Date.now() - deadline > CAUGHT_UP_MS;
    /*
     * Чи сервер уже продзвонив за нас. Питання не в тому, чи видно сторінку, а
     * в тому, чи лежав будильник у базі: без нього (не ввійшли, пуш цьому
     * пристрою недоступний, запис не пройшов) місцеве сповіщення — єдине, хоч
     * би як пізно ми отямились. А з ним пізній тік у фоні — браузер будить
     * приспану вкладку раз на хвилину — показав би «час вийшов» удруге, вже
     * після того, як людина закрила серверний.
     */
    const serverRang = late && id != null && written.has(id);

    /*
     * Застосунок на екрані — дзвінок уже відбувся тут, і серверний був би
     * другим. У фоні ж скасовуємо лише тоді, коли система справді показала
     * місцеве сповіщення (нижче): згорнутому застосунку вона може й відмовити.
     * А коли сервер уже продзвонив, у фоні не чіпаємо нічого: якщо розсилка
     * забарилась, її будильник — останній, що лишився.
     */
    if (visible && id) cancelAlarm(id);
    if (serverRang) return;

    /*
     * Просимо систему докласти голосу — на випадок, якщо застосунок згорнули.
     *
     * Через service worker, а не `new Notification()`: на телефоні той
     * конструктор заборонений і кидає помилку, тобто цей будильник не дзвонив
     * саме там, де він потрібен, — коли екран згас і застосунок у фоні.
     *
     * Без дозволу просто мовчимо: набридати запитом посеред готування не варто.
     */
    const body = recipe && step >= 0 ? alarmText(recipe.title, step) : "Час вийшов — перевір страву";
    void (async () => {
      try {
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const reg = await navigator.serviceWorker?.getRegistration();
        if (!reg) return;
        await reg.showNotification("Ням", {
          body,
          icon: "/api/icon?size=192",
          badge: "/api/icon?size=192",
          tag: "nyam-timer",
          requireInteraction: true,
          // Вібрація в кишені важить більше за звук: на кухні шумно.
          vibrate: [200, 100, 200, 100, 300],
          data: { url: window.location.pathname },
        } as NotificationOptions);
        if (!visible && id) cancelAlarm(id);
      } catch {
        /* не критично: тост і вібрація вже спрацювали, а сервер ще продзвонить */
      }
    })();
  }, [toast, params.id, recipe, step]);

  /* Один тік: перерахунок від дедлайну. Частота 250 мс, щоб число не «стрибало»
     через півсекунди після повернення у застосунок. */
  const tick = useCallback(() => {
    const deadline = deadlineRef.current;
    if (deadline == null) return;
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setRemaining(left);
    if (left === 0) finish();
  }, [finish]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(tick, 250);
    // Повернення на вкладку — одразу підтягуємо реальний час, не чекаючи тіку.
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [running, tick]);

  /**
   * Запускає або ставить на паузу, перераховуючи дедлайн.
   *
   * Стан читаємо з рендеру, а не з функції-оновлювача setRunning: тут
   * побічні дії — запис у базу, вікно дозволу, — а оновлювач React вправі
   * викликати двічі.
   */
  const toggleTimer = useCallback(() => {
    haptic(12);
    if (running) {
      // Пауза: лишаємо на екрані те, що дійсно лишилось.
      const deadline = deadlineRef.current;
      if (deadline != null) {
        setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
      }
      deadlineRef.current = null;
      setRunning(false);
      dropRun();
      return;
    }

    const base = remaining && remaining > 0 ? remaining : (baseSec ?? 0);
    if (base <= 0) return;
    firedRef.current = false;
    const deadline = Date.now() + base * 1000;
    deadlineRef.current = deadline;
    setRemaining(base);
    setRunning(true);

    // Новий відлік — новий рядок: після паузи дедлайн уже інший.
    const id = newAlarmId();
    alarmIdRef.current = id;
    const current = () => alarmIdRef.current === id;

    /*
     * Будильник готуємо зараз, а не в мить запису: див. armAlarm. Лише з
     * акаунтом — рядок у базі належить людині, і без входу його нікому
     * записати.
     */
    const account = useApp.getState().account;
    const push: AlarmDraft | null =
      recipe && isSupabaseConfigured && account
        ? {
            id,
            userId: account.id,
            fireAt: new Date(deadline).toISOString(),
            title: "Ням",
            body: alarmText(recipe.title, step),
            url: window.location.pathname,
          }
        : null;
    if (push) armAlarm(push, params.id, current);
    // Новий таймер на екрані — загублені будильники цього рецепта вже ні до чого.
    dropLost();
    saveRun(params.id, { step, deadline, base: baseSec ?? base, alarmId: id, armed: false });

    // Дозвіл питаємо саме тут — у момент, коли користувач сам запускає
    // таймер, тобто запит очікуваний. Погодився — підписуємо й кажемо про це;
    // «не зараз», «не пропонувати» й «вимкнено в налаштуваннях» поважаються
    // всередині.
    try {
      enablePushFromTimer(() => {
        toast("Сповіщення увімкнено", "🔔");
        /*
         * Будильник на сервері ставився ще до відповіді у вікні дозволу — і
         * тоді пристрій пуша не вмів, тож запис не відбувся. Тепер уміє:
         * ставимо той самий рядок для цього ж відліку, якщо він ще йде.
         */
        if (push && current()) armAlarm(push, params.id, current);
      });
    } catch {
      /* не критично */
    }
  }, [running, remaining, baseSec, step, recipe, params.id, dropRun, dropLost, toast]);

  /** Що списали з комори — показуємо на екрані завершення. */
  const [consumed, setConsumed] = useState<Consumed[]>([]);
  const [pantryBefore, setPantryBefore] = useState<PantryItem[]>([]);

  /*
   * «Повернути в комору» — рядки рівно такими, якими були до списання, за id:
   * у коморі по товару дві пачки молока — два рядки, і повернути треба саме ту
   * пачку, з якої списали, а не «молоко взагалі».
   */
  const undoConsume = () => {
    haptic(12);
    restorePantry(pantryBefore);
    setConsumed([]);
    toast("Продукти повернуто в комору", "↩️");
  };

  const resetTimer = useCallback(() => {
    haptic(10);
    setRunning(false);
    deadlineRef.current = null;
    firedRef.current = false;
    setRemaining(baseSec ?? 0);
    dropRun();
  }, [baseSec, dropRun]);

  /** Вихід хрестиком — свідомий: таймер цього готування більше не потрібен. */
  const exitCooking = () => {
    if (deadlineRef.current != null) {
      deadlineRef.current = null;
      setRunning(false);
    }
    dropRun();
    router.push(`/recipe/${params.id}`);
  };

  const goNext = useCallback(() => {
    if (!recipe) return;
    haptic(12);
    if (step + 1 >= recipe.steps.length) {
      // Страва готова — відлік останнього кроку, якщо йшов, уже ні до чого.
      if (deadlineRef.current != null) {
        deadlineRef.current = null;
        setRunning(false);
      }
      dropRun();
      setDone(true);
      markCooked(recipe.id);
      // Комора має відповідати холодильнику: продукти, що пішли на страву,
      // з неї зникають. Знімок «до» лишаємо, щоб списання можна було
      // скасувати — помилитись кроком у готуванні легко.
      // Знімок комори до списання — щоб було що повернути, якщо скасують.
      const before = useApp.getState().pantry;
      const changes = consumePantry(recipe);
      if (changes.length > 0) {
        setConsumed(changes);
        // Лише зачеплені рядки і саме за id: ключ типу не розрізняє пачок (D9).
        setPantryBefore(before.filter((p) => changes.some((c) => c.id === p.id)));
      }
      haptic([30, 60, 30, 60, 50]);
    } else {
      setStep((s) => s + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, step]);

  const goPrev = () => {
    haptic(8);
    setStep((s) => Math.max(-1, s - 1));
  };

  if (!hydrated) return <div className="min-h-dvh bg-bg" />;

  if (!recipe) {
    return (
      <EmptyState
        emoji="🍽️"
        title="Рецепт не знайдено"
        action={<Button onClick={() => router.push("/")}>На головну</Button>}
      />
    );
  }

  /* ── Завершення ───────────────────────────────────────────────────── */
  if (done) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className="text-7xl"
        >
          🎉
        </motion.div>
        <h1 className="mt-4 font-display text-2xl font-extrabold leading-tight">Смачного!</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          «{recipe.title}» додано в історію приготувань.
        </p>

        {consumed.length > 0 && (
          <div className="mt-6 w-full max-w-xs rounded-xl3 border border-line bg-surface p-4 text-left">
            <p className="text-[13px] font-bold">Списано з комори</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {consumed.map((c, i) => (
                // Один рядок комори може закрити дві потреби рецепта — id не унікальний.
                <li key={`${c.id}:${i}`} className="flex items-baseline gap-1.5 text-[12.5px] leading-snug">
                  <span>{c.emoji}</span>
                  {/* «Молоко Галичина 2,5%: −500 мл, лишилось 400 мл» — назва пачки, а не типу. */}
                  <span className="min-w-0">
                    <span className="font-semibold">{c.label}:</span>{" "}
                    <span className="text-muted">−{c.used}</span>
                    {", "}
                    <span className={c.left ? "text-faint" : "text-berry"}>
                      {c.left ? `лишилось ${c.left}` : "закінчилось"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={undoConsume}
              className="mt-2.5 text-[12px] font-semibold text-muted underline"
            >
              Повернути в комору
            </button>
          </div>
        )}

        <div className="mt-7 w-full max-w-xs rounded-xl3 border border-line bg-surface p-4">
          <p className="text-[13px] font-bold">Як вийшло?</p>
          <div className="mt-2 flex justify-center">
            <Stars
              value={rating}
              size={32}
              onChange={(v) => {
                setRating(v);
                rate(recipe.id, v);
                toast("Оцінку збережено", "⭐");
              }}
            />
          </div>
        </div>

        <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
          <Link href={`/recipe/${recipe.id}`}>
            <Button full variant="secondary">
              До рецепта
            </Button>
          </Link>
          <Link href="/decide">
            <Button full>Обрати наступну страву</Button>
          </Link>
        </div>
      </div>
    );
  }

  /* ── Підготовка ───────────────────────────────────────────────────── */
  if (step === -1) {
    const allChecked = checked.size === recipe.ingredients.length;
    return (
      <div className="flex min-h-dvh flex-col">
        <CookHeader
          title="Підготовка"
          subtitle={recipe.title}
          onExit={exitCooking}
        />

        <div className="flex-1 px-4 pt-4">
          <p className="text-[13.5px] leading-relaxed text-muted">
            Познач, що вже дістав із холодильника. Так нічого не забудеш посеред готування.
          </p>

          <div className="mt-4 flex flex-col gap-2">
            {recipe.ingredients.map((item) => {
              const def = ing(item.key);
              const isChecked = checked.has(item.key);
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    haptic(10);
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.key)) next.delete(item.key);
                      else next.add(item.key);
                      return next;
                    });
                  }}
                  className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                    isChecked ? "border-mint/40 bg-mint/8" : "border-line bg-surface"
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${
                      isChecked ? "border-mint bg-mint text-bg" : "border-line"
                    }`}
                  >
                    {isChecked && <Check size={15} strokeWidth={3} />}
                  </span>
                  <span className="text-lg">{def.emoji}</span>
                  <span
                    className={`flex-1 text-[14px] font-semibold ${isChecked ? "text-muted line-through" : ""}`}
                  >
                    {def.label}
                  </span>
                  <span className="text-[12.5px] font-bold text-muted">{item.qty}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pad-safe-b sticky bottom-0 glass border-t border-line p-4">
          <Button full size="lg" onClick={() => setStep(0)}>
            {allChecked ? "Все на місці — почали" : "Почати готувати"}
            <ChevronRight size={19} />
          </Button>
          <p className="mt-2 text-center text-[11.5px] text-muted">
            {checked.size} з {recipe.ingredients.length} готово
          </p>
        </div>
      </div>
    );
  }

  /* ── Крок ─────────────────────────────────────────────────────────── */
  const progress = ((step + 1) / recipe.steps.length) * 100;

  return (
    <div className="flex min-h-dvh flex-col">
      <CookHeader
        title={`Крок ${step + 1} з ${recipe.steps.length}`}
        subtitle={recipe.title}
        onExit={exitCooking}
      />

      <div className="h-1 bg-line">
        <motion.div
          className="h-full brand-gradient"
          animate={{ width: `${progress}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 30 }}
        />
      </div>

      <motion.div
        key={step}
        data-no-pull
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.35}
        onDragEnd={(_, info) => {
          if (info.offset.x < -110) goNext();
          else if (info.offset.x > 110) goPrev();
        }}
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex flex-1 flex-col justify-center px-6 py-8"
      >
        <span className="font-display text-[64px] font-extrabold leading-none text-line">
          {String(step + 1).padStart(2, "0")}
        </span>
        <p className="mt-4 text-[21px] font-semibold leading-relaxed">{currentStep?.text}</p>

        {currentStep?.tip && (
          <div className="mt-5 flex gap-2.5 rounded-2xl border border-brand/25 bg-brand/8 p-3.5">
            <Lightbulb size={17} className="mt-0.5 shrink-0 text-brand" />
            <p className="text-[13.5px] leading-relaxed text-muted">{currentStep.tip}</p>
          </div>
        )}

        {/* Таймер */}
        <AnimatePresence>
          {remaining == null && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => {
                haptic(10);
                setTimerSheet(true);
              }}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl3 border border-line bg-surface p-3.5 text-[13.5px] font-semibold text-muted"
            >
              <Timer size={17} />
              Поставити таймер на цей крок
            </motion.button>
          )}

          {remaining != null && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-6 flex items-center gap-3 rounded-xl3 border border-line bg-surface p-4"
            >
              <Timer size={20} className={running ? "text-brand" : "text-muted"} />
              <span
                className={`flex-1 font-display text-3xl font-extrabold tabular-nums ${
                  remaining === 0 ? "text-berry" : ""
                }`}
              >
                {formatClock(remaining)}
              </span>
              <button
                onClick={() => {
                  haptic(10);
                  setTimerSheet(true);
                }}
                aria-label="Змінити час"
                className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2 text-muted"
              >
                <SlidersHorizontal size={17} />
              </button>
              <button
                onClick={resetTimer}
                aria-label="Скинути таймер"
                className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2 text-muted"
              >
                <RotateCcw size={17} />
              </button>
              <button
                onClick={toggleTimer}
                aria-label={running ? "Пауза" : "Старт"}
                className="grid h-12 w-12 place-items-center rounded-2xl brand-gradient text-brand-ink"
              >
                {running ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="pad-safe-b sticky bottom-0 glass border-t border-line p-4">
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" onClick={goPrev} className="w-14 px-0" aria-label="Назад">
            <ChevronLeft size={20} />
          </Button>
          <Button full size="lg" onClick={goNext} className="flex-1">
            {step + 1 >= recipe.steps.length ? (
              <>
                <Check size={19} />
                Готово!
              </>
            ) : (
              <>
                Далі
                <ChevronRight size={19} />
              </>
            )}
          </Button>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted">
          Можна гортати кроки свайпом. Екран не згасне під час готування.
        </p>
      </div>

      {/* Свій час на цей крок */}
      <TimerSheet
        open={timerSheet}
        current={baseSec ?? currentStep?.timerSec ?? 0}
        onClose={() => setTimerSheet(false)}
        onApply={(seconds) => {
          setCustomSec((prev) => ({ ...prev, [step]: seconds }));
          setTimerSheet(false);
          toast(seconds > 0 ? "Час оновлено" : "Таймер прибрано", "⏱️");
        }}
      />
    </div>
  );
}

/**
 * Свій час замість того, що написав автор.
 *
 * Міняє таймер лише на це готування й лише на цей крок: рецепт від того не
 * змінюється, бо десять хвилин у ньому — правда для чужої плити, а не
 * помилка. Міру обираєш сам: сорок секунд і півтори години тут однаково
 * доречні.
 */
function TimerSheet({
  open,
  current,
  onClose,
  onApply,
}: {
  open: boolean;
  current: number;
  onClose: () => void;
  onApply: (seconds: number) => void;
}) {
  const UNITS: Array<{ key: "sec" | "min" | "hour"; label: string; size: number }> = [
    { key: "sec", label: "секунди", size: 1 },
    { key: "min", label: "хвилини", size: 60 },
    { key: "hour", label: "години", size: 3600 },
  ];

  const [unit, setUnit] = useState<"sec" | "min" | "hour">(
    current > 0 && current % 3600 === 0 ? "hour" : current > 0 && current % 60 !== 0 ? "sec" : "min",
  );
  const size = UNITS.find((u) => u.key === unit)?.size ?? 60;
  const [value, setValue] = useState(current > 0 ? String(Math.round(current / size)) : "");

  const seconds = Math.max(0, Number(value.replace(/[^\d]/g, "")) || 0) * size;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Свій час"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => onApply(0)}>
            Без таймера
          </Button>
          <Button className="flex-1" onClick={() => onApply(seconds)} disabled={seconds <= 0}>
            Поставити {seconds > 0 ? formatClock(seconds) : ""}
          </Button>
        </div>
      }
    >
      <div className="pb-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          autoFocus
          placeholder="10"
          className="h-16 w-full rounded-2xl bg-surface-2 text-center font-display text-3xl font-extrabold tabular-nums"
        />
        <div className="mt-3 grid grid-cols-3 gap-2">
          {UNITS.map((u) => (
            <button
              key={u.key}
              onClick={() => {
                haptic(8);
                setUnit(u.key);
              }}
              className={`rounded-2xl border py-2.5 text-[13px] font-bold ${
                unit === u.key
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-line bg-surface text-muted"
              }`}
            >
              {u.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-faint">
          Зміна діє на цей крок і лише зараз — рецепт лишається таким, як його написав автор.
        </p>
      </div>
    </Sheet>
  );
}

function CookHeader({
  title,
  subtitle,
  onExit,
}: {
  title: string;
  subtitle: string;
  onExit: () => void;
}) {
  return (
    <header className="pad-safe-t glass sticky top-0 z-20 border-b border-line">
      <div className="flex h-14 items-center gap-3 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-bold leading-tight">{title}</p>
          <p className="truncate text-[11.5px] text-muted">{subtitle}</p>
        </div>
        <button
          onClick={onExit}
          aria-label="Вийти з режиму готування"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-surface-2"
        >
          <X size={19} />
        </button>
      </div>
    </header>
  );
}
