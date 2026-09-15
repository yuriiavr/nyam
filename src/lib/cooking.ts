/**
 * Готування, яке переживає вихід зі сторінки.
 *
 * Раніше все жило в стані сторінки готування: вийшов — і крок, позначені
 * продукти й таймер зникали, а таймер на сторінці був один. Але на кухні так
 * не буває. Макарони варяться, поки ріжеш соус; суп доходить, поки печеться
 * пиріг з іншого рецепта. Тож тепер:
 *
 * - Кожен рецепт, який почали готувати, — сесія: крок, де зупинились,
 *   позначені продукти, свій час на кроки. Вийти можна будь-коли, повернутись
 *   — туди ж. Сесій може бути кілька: два рецепти одночасно.
 * - Таймер належить кроку, а не екрану. Поставив на кроці 2, пішов на крок
 *   3 — таймер кроку 2 іде далі. Перехід між кроками його не скидає.
 * - Час рахується від дедлайну, а не тіком (браузер у фоні душить
 *   setInterval), а вести й дзвонити всі таймери разом — справа CookingHost,
 *   який живе на кожній сторінці застосунку.
 *
 * Окреме сховище, а не поле в useApp: це стан одного пристрою (макарони на цій
 * плиті), його не синхронізують з акаунтом і не мігрують разом зі схемою
 * застосунку. localStorage, а не sessionStorage: iPhone вивантажує згорнутий
 * застосунок без попередження, і sessionStorage зникає разом із ним.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  alarmText,
  armAlarm,
  cancelAlarm,
  newAlarmId,
  rememberAlarm,
  type AlarmDraft,
} from "@/lib/cook-alarms";
import { useApp } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { alarmUrl } from "@/lib/timer-push";
import type { Recipe } from "@/lib/types";

export interface StepTimer {
  /** Повний час кроку — з нього «скинути» і повторний старт. */
  base: number;
  /** Мить дзвінка, поки таймер іде; null — на паузі або вже продзвонив. */
  deadline: number | null;
  /** Скільки секунд лишалось у мить паузи (після дзвінка — 0). */
  left: number;
  /** Будильник на сервері для поточного відліку; він же — тег сповіщення. */
  alarmId: string | null;
  /** База підтвердила запис будильника — сервер продзвонить і без сторінки. */
  armed: boolean;
  /** Коли мав продзвонити; поки таймер не прибрали — на екрані червоні 0:00. */
  rangAt: number | null;
}

export interface CookSession {
  recipeId: string;
  /** Назва й емодзі на мить відкриття — для панелі й сповіщень, коли рецепт ще не підвантажився. */
  title: string;
  emoji: string;
  stepCount: number;
  /** -1 — підготовка. */
  step: number;
  checked: string[];
  /**
   * Власний час для кроку, заданий на ходу. Нуль — «Без таймера». Живе рівно
   * стільки, скільки це готування: рецепт від того не змінюється.
   */
  customSec: Record<number, number>;
  timers: Record<number, StepTimer>;
  touchedAt: number;
}

interface CookingState {
  sessions: Record<string, CookSession>;
  /** Сховище прочитане — до того «сесії немає» ще нічого не означає. */
  ready: boolean;
}

/** Продзвонений таймер, якого так і не прибрали, зникає сам через стільки. */
const RANG_KEEP_MS = 2 * 3_600_000;

/** Покинуте готування без запущених таймерів зникає через стільки. */
const IDLE_KEEP_MS = 24 * 3_600_000;

export const useCooking = create<CookingState>()(
  persist((): CookingState => ({ sessions: {}, ready: false }), {
    name: "nyam-cooking",
    // Версію не піднімаємо ніколи — з тієї ж причини, що й у nyam-v1 (D5):
    // усе, чого нова форма вимагає від старих даних, робить normalizeSessions.
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: ({ sessions }) => ({ sessions }) as CookingState,
    merge: (persisted, current) => ({
      ...current,
      sessions: normalizeSessions((persisted as { sessions?: unknown } | undefined)?.sessions),
    }),
    /** Читаємо вручну після монтування (див. Providers) — як і головне сховище. */
    skipHydration: true,
    onRehydrateStorage: () => (state) => {
      // Будильники з попереднього життя застосунку: скасування мусить знати їх.
      for (const session of Object.values(state?.sessions ?? {})) {
        for (const timer of Object.values(session.timers)) {
          if (timer.alarmId && timer.deadline != null) {
            rememberAlarm(timer.alarmId, timer.deadline, timer.armed);
          }
        }
      }
      if (!useCooking.getState().ready) useCooking.setState({ ready: true });
    },
  }),
);

/* ── Читання ──────────────────────────────────────────────────────────── */

export function sessionOf(recipeId: string): CookSession | undefined {
  return useCooking.getState().sessions[recipeId];
}

/** Скільки секунд лишилось. */
export function timerLeft(timer: StepTimer, now: number): number {
  return timer.deadline != null ? Math.max(0, Math.ceil((timer.deadline - now) / 1000)) : timer.left;
}

export const isRunning = (timer: StepTimer | undefined): boolean => timer?.deadline != null;

/** Час кроку з урахуванням заданого на ходу; null — таймера на кроці немає. */
export function stepSeconds(session: CookSession, recipe: Recipe | undefined, step: number): number | null {
  if (step in session.customSec) return session.customSec[step] || null;
  return recipe?.steps[step]?.timerSec ?? null;
}

/**
 * Готування, яке справді почалось: людина дійшла до кроків або запустила
 * таймер. Просто глянути підготовку й вийти — ще не «готуєш».
 */
export function isStarted(session: CookSession): boolean {
  return session.step >= 0 || Object.keys(session.timers).length > 0;
}

export function startedSessions(sessions: Record<string, CookSession>): CookSession[] {
  return Object.values(sessions).filter(isStarted);
}

export function anyRunning(sessions: Record<string, CookSession>): boolean {
  return Object.values(sessions).some((s) => Object.values(s.timers).some(isRunning));
}

/**
 * Таймери сесії за важливістю: продзвонені, далі ті, що йдуть (найближчий
 * першим), далі на паузі.
 */
export function timersByUrgency(session: CookSession): Array<{ step: number; timer: StepTimer }> {
  const rank = (t: StepTimer) => (t.rangAt != null ? 0 : t.deadline != null ? 1 : 2);
  return Object.entries(session.timers)
    .map(([step, timer]) => ({ step: Number(step), timer }))
    .sort(
      (a, b) =>
        rank(a.timer) - rank(b.timer) ||
        (a.timer.deadline ?? 0) - (b.timer.deadline ?? 0) ||
        a.step - b.step,
    );
}

/* ── Запис ────────────────────────────────────────────────────────────── */

function put(recipeId: string, session: CookSession | null): void {
  const sessions = { ...useCooking.getState().sessions };
  if (session) sessions[recipeId] = { ...session, touchedAt: Date.now() };
  else delete sessions[recipeId];
  useCooking.setState({ sessions });
}

function withTimer(session: CookSession, step: number, timer: StepTimer | null): CookSession {
  const timers = { ...session.timers };
  if (timer) timers[step] = timer;
  else delete timers[step];
  return { ...session, timers };
}

function freshSession(recipe: Recipe): CookSession {
  return {
    recipeId: recipe.id,
    title: recipe.title,
    emoji: recipe.emoji,
    stepCount: recipe.steps.length,
    step: -1,
    checked: [],
    customSec: {},
    timers: {},
    touchedAt: Date.now(),
  };
}

/**
 * Відкриває готування рецепта: наявне — там, де лишили, нове — з підготовки.
 *
 * Рецепт за цей час могли змінити: кроків поменшало — таймери зниклих кроків
 * уже ні до чого, а крок, на якому зупинились, стає останнім.
 */
export function openSession(recipe: Recipe): void {
  const existing = sessionOf(recipe.id);
  if (!existing) {
    put(recipe.id, freshSession(recipe));
    return;
  }

  const count = recipe.steps.length;
  let next: CookSession = { ...existing, title: recipe.title, emoji: recipe.emoji, stepCount: count };
  for (const key of Object.keys(existing.timers)) {
    const step = Number(key);
    if (step < count) continue;
    cancelAlarm(existing.timers[step].alarmId);
    next = withTimer(next, step, null);
  }
  if (next.step >= count) next.step = count - 1;

  const changed =
    next.title !== existing.title ||
    next.emoji !== existing.emoji ||
    next.stepCount !== existing.stepCount ||
    next.step !== existing.step ||
    next.timers !== existing.timers;
  if (changed) put(recipe.id, next);
}

/**
 * Перехід на інший крок. Таймери не чіпаємо — крім продзвоненого на кроці,
 * з якого йдемо: «час вийшов» людина вже побачила.
 */
export function setStep(recipeId: string, step: number): void {
  const session = sessionOf(recipeId);
  if (!session || session.step === step) return;
  let next: CookSession = { ...session, step };
  if (session.timers[session.step]?.rangAt != null) next = withTimer(next, session.step, null);
  put(recipeId, next);
}

export function toggleChecked(recipeId: string, key: string): void {
  const session = sessionOf(recipeId);
  if (!session) return;
  const checked = session.checked.includes(key)
    ? session.checked.filter((k) => k !== key)
    : [...session.checked, key];
  put(recipeId, { ...session, checked });
}

/** Свій час на крок. Відлік, що йшов за старим часом, уже ні до чого. */
export function setCustomTime(recipeId: string, step: number, seconds: number): void {
  const session = sessionOf(recipeId);
  if (!session) return;
  cancelAlarm(session.timers[step]?.alarmId);
  const next = withTimer({ ...session, customSec: { ...session.customSec, [step]: seconds } }, step, null);
  put(recipeId, next);
}

/**
 * Запускає таймер кроку на `seconds` (з нуля чи після паузи).
 *
 * Повертає «поставити будильник ще раз» — для вікна дозволу на сповіщення:
 * будильник на сервері ставився ще до відповіді, і тоді пристрій пуша не
 * вмів, тож запис не відбувся. Після згоди ставимо той самий рядок для цього ж
 * відліку, якщо він ще йде.
 */
export function startTimer(recipeId: string, step: number, seconds: number, base: number): () => void {
  const session = sessionOf(recipeId);
  if (!session || seconds <= 0) return () => {};

  cancelAlarm(session.timers[step]?.alarmId);
  const deadline = Date.now() + seconds * 1000;
  // Новий відлік — новий рядок: після паузи дедлайн уже інший.
  const id = newAlarmId();
  put(
    recipeId,
    withTimer(session, step, { base, deadline, left: seconds, alarmId: id, armed: false, rangAt: null }),
  );

  const current = () => sessionOf(recipeId)?.timers[step]?.alarmId === id;
  const onArmed = () => {
    const now = sessionOf(recipeId);
    const timer = now?.timers[step];
    if (!now || timer?.alarmId !== id || timer.armed) return;
    put(recipeId, withTimer(now, step, { ...timer, armed: true }));
  };

  /*
   * Лише з акаунтом — рядок у базі належить людині, і без входу його нікому
   * записати. Будильник готуємо зараз, а не в мить запису: див. armAlarm.
   */
  const account = useApp.getState().account;
  const push: AlarmDraft | null =
    isSupabaseConfigured && account
      ? {
          id,
          userId: account.id,
          fireAt: new Date(deadline).toISOString(),
          title: "Ням",
          body: alarmText(session.title, step),
          url: alarmUrl(recipeId, step),
        }
      : null;
  if (push) armAlarm(push, current, onArmed);

  return () => {
    if (push && current()) armAlarm(push, current, onArmed);
  };
}

/** Пауза: лишаємо те, що дійсно лишилось. */
export function pauseTimer(recipeId: string, step: number): void {
  const session = sessionOf(recipeId);
  const timer = session?.timers[step];
  if (!session || !timer || timer.deadline == null) return;
  cancelAlarm(timer.alarmId);
  const left = timerLeft(timer, Date.now());
  put(recipeId, withTimer(session, step, { ...timer, deadline: null, left, alarmId: null, armed: false }));
}

/** Скидання: крок знову показує свій повний час. */
export function resetTimer(recipeId: string, step: number): void {
  const session = sessionOf(recipeId);
  if (!session?.timers[step]) return;
  cancelAlarm(session.timers[step].alarmId);
  put(recipeId, withTimer(session, step, null));
}

/** Готування закінчене чи скинуте: ні таймерів, ні дзвінків, ні прогресу. */
export function endSession(recipeId: string): void {
  const session = sessionOf(recipeId);
  if (!session) return;
  for (const timer of Object.values(session.timers)) cancelAlarm(timer.alarmId);
  put(recipeId, null);
}

/**
 * Вихід зі сторінки готування. Прогрес і таймери лишаються — окрім випадку,
 * коли готування ще не почалось: заглянув у підготовку й пішов.
 */
export function leaveSession(recipeId: string): void {
  const session = sessionOf(recipeId);
  if (session && !isStarted(session) && session.checked.length === 0) put(recipeId, null);
}

/* ── Для CookingHost ──────────────────────────────────────────────────── */

export interface DueTimer {
  session: CookSession;
  step: number;
  deadline: number;
  alarmId: string | null;
}

/**
 * Таймери, яким настав час, — одразу позначені продзвоненими. Одним записом:
 * кілька таймерів, що скінчились, поки застосунок спав, не мають
 * перезаписувати сховище кожен окремо.
 */
export function takeDueTimers(now: number): DueTimer[] {
  const due: DueTimer[] = [];
  const state = useCooking.getState();
  let sessions: Record<string, CookSession> | null = null;

  for (const session of Object.values(state.sessions)) {
    let next = session;
    for (const [key, timer] of Object.entries(session.timers)) {
      if (timer.deadline == null || timer.deadline > now) continue;
      const step = Number(key);
      due.push({ session, step, deadline: timer.deadline, alarmId: timer.alarmId });
      next = withTimer(next, step, {
        ...timer,
        deadline: null,
        left: 0,
        alarmId: null,
        armed: false,
        rangAt: timer.deadline,
      });
    }
    if (next !== session) {
      sessions ??= { ...state.sessions };
      sessions[session.recipeId] = next;
    }
  }

  if (sessions) useCooking.setState({ sessions });
  return due;
}

/** Прибирає давно продзвонені таймери й покинуті готування. */
export function pruneSessions(now: number): void {
  const state = useCooking.getState();
  let changed = false;
  const sessions: Record<string, CookSession> = {};

  for (const session of Object.values(state.sessions)) {
    let next = session;
    for (const [key, timer] of Object.entries(session.timers)) {
      if (timer.rangAt != null && now - timer.rangAt > RANG_KEEP_MS) next = withTimer(next, Number(key), null);
    }
    const running = Object.values(next.timers).some(isRunning);
    if (!running && now - next.touchedAt > IDLE_KEEP_MS) {
      changed = true;
      continue;
    }
    if (next !== session) changed = true;
    sessions[session.recipeId] = next;
  }

  if (changed) useCooking.setState({ sessions });
}

/**
 * Будильник цього пристрою, знайдений у базі, про який не памʼятає сховище
 * (стерли дані сайту, застосунок перевстановили).
 *
 * Якщо його крок вільний — повертаємо таймер на екран: макарони ж, найімовірніше,
 * справді варяться, і людина має бачити, що саме задзвонить. Якщо ж на тому
 * кроці вже є інший таймер, екран — остаточна правда, і знайдений — «привид»:
 * відповідаємо false, і його скасовують.
 */
export function adoptAlarm(
  id: string,
  fireAt: number,
  recipe: Recipe | undefined,
  recipeId: string,
  step: number,
): boolean {
  const session = sessionOf(recipeId);
  const existing = session?.timers[step];
  if (existing) return existing.alarmId === id;
  if (!session && !recipe) return false;
  if (recipe && step >= recipe.steps.length) return false;

  const base = session ? stepSeconds(session, recipe, step) : (recipe?.steps[step]?.timerSec ?? null);
  const left = Math.max(1, Math.ceil((fireAt - Date.now()) / 1000));
  rememberAlarm(id, fireAt, true);
  const target: CookSession = session ?? { ...freshSession(recipe as Recipe), step };
  put(
    recipeId,
    withTimer(target, step, {
      base: base && base >= left ? base : left,
      deadline: fireAt,
      left,
      alarmId: id,
      armed: true,
      rangAt: null,
    }),
  );
  return true;
}

/* ── Сховище ──────────────────────────────────────────────────────────── */

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function normalizeTimer(raw: unknown): StepTimer | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<StepTimer>;
  if (!num(t.base) || !num(t.left)) return null;
  return {
    base: t.base,
    deadline: num(t.deadline) ? t.deadline : null,
    left: t.left,
    alarmId: typeof t.alarmId === "string" ? t.alarmId : null,
    armed: t.armed === true,
    rangAt: num(t.rangAt) ? t.rangAt : null,
  };
}

/** Зіпсоване чи чуже в сховищі не має валити застосунок — просто відкидаємо. */
function normalizeSessions(raw: unknown): Record<string, CookSession> {
  const out: Record<string, CookSession> = {};
  if (!raw || typeof raw !== "object") return out;

  for (const [recipeId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const s = value as Partial<CookSession>;
    if (!num(s.step)) continue;

    const timers: Record<number, StepTimer> = {};
    for (const [key, t] of Object.entries(s.timers ?? {})) {
      const timer = normalizeTimer(t);
      if (timer && /^\d+$/.test(key)) timers[Number(key)] = timer;
    }
    const customSec: Record<number, number> = {};
    for (const [key, v] of Object.entries(s.customSec ?? {})) {
      if (num(v) && /^\d+$/.test(key)) customSec[Number(key)] = v;
    }

    out[recipeId] = {
      recipeId,
      title: typeof s.title === "string" ? s.title : "",
      emoji: typeof s.emoji === "string" ? s.emoji : "🍳",
      stepCount: num(s.stepCount) ? s.stepCount : 0,
      step: s.step,
      checked: Array.isArray(s.checked) ? s.checked.filter((k): k is string => typeof k === "string") : [],
      customSec,
      timers,
      touchedAt: num(s.touchedAt) ? s.touchedAt : Date.now(),
    };
  }
  return out;
}
