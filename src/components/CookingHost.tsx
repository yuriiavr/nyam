"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Pause, Timer } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NAV_HEIGHT, useNavHidden } from "./BottomNav";
import { useToast } from "./ui";
import {
  alarmText,
  alarmWritten,
  CAUGHT_UP_MS,
  cancelAlarm,
  cancelPending,
  deviceEndpoint,
  flushCancels,
  knownAlarm,
  queueAlarm,
  rememberAlarm,
  showLocalAlarm,
} from "@/lib/cook-alarms";
import {
  adoptAlarm,
  anyRunning,
  pruneSessions,
  setStep,
  startedSessions,
  takeDueTimers,
  timerLeft,
  timersByUrgency,
  useCooking,
  type CookSession,
  type DueTimer,
} from "@/lib/cooking";
import { recipeById, useApp } from "@/lib/store";
import { fetchTimerPushes } from "@/lib/supabase/api";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { alarmUrl, parseAlarmUrl, TIMER_STALE_MS } from "@/lib/timer-push";
import { cn, formatClock, haptic, plural } from "@/lib/utils";

/** Як часто перевіряти дедлайни. 250 мс — щоб число не «стрибало» після повернення в застосунок. */
const TICK_MS = 250;

/** Раз на стільки прибираємо давно продзвонене й покинуте. */
const PRUNE_MS = 10 * 60_000;

/**
 * Перемальовує компонент, поки `active`, — для живого відліку на екрані.
 * Сам час тримає дедлайн, тож пропущений тік нічого не зсуває.
 */
export function useNow(active: boolean, every = TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const refresh = () => setNow(Date.now());
    const timer = setInterval(refresh, every);
    // Повернення в застосунок — одразу справжній час, не чекаючи тіку.
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, every]);
  return now;
}

/** Адреса сторінки готування — без кроку: крок живе в сесії. */
export const cookPath = (recipeId: string) => `/recipe/${recipeId}/cook`;

/**
 * Веде всі таймери готування — на будь-якій сторінці застосунку.
 *
 * Раніше таймер жив у сторінці готування і дзвонив лише, поки вона відкрита.
 * Тепер він у сховищі (src/lib/cooking.ts), а цей компонент стоїть в оболонці
 * поруч із навігацією: перевіряє дедлайни, дзвонить, повертає загублені
 * будильники з бази й показує панель «готуєш зараз».
 */
export function CookingHost() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const toast = useToast();
  const ready = useCooking((s) => s.ready);
  const running = useCooking((s) => anyRunning(s.sessions));

  // Свіжі значення для слухачів, що живуть довше за рендер.
  const live = useRef({ pathname, toast });
  live.current = { pathname, toast };

  /*
   * Друга вкладка застосунку (компʼютер) пише в те саме сховище. Без цього
   * вона тримала б у памʼяті старий стан і першим же записом стерла б таймер,
   * запущений у сусідній.
   */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "nyam-cooking") void useCooking.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* Тік: дедлайни всіх таймерів. Лише поки хоч один іде. */
  useEffect(() => {
    if (!ready || !running) return;
    const tick = () => {
      for (const due of takeDueTimers(Date.now())) ring(due, live.current.pathname, live.current.toast);
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    // Повернення на вкладку — одразу підтягуємо реальний час, не чекаючи тіку.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, running]);

  useEffect(() => {
    if (!ready) return;
    pruneSessions(Date.now());
    const timer = setInterval(() => pruneSessions(Date.now()), PRUNE_MS);
    return () => clearInterval(timer);
  }, [ready]);

  /*
   * Натиск на сповіщення, коли застосунок уже стоїть на сторінці цього
   * рецепта, — service worker лише піднімає вікно й каже, на який крок (див.
   * public/sw.js). Перезавантажувати сторінку заради цього не треба.
   */
  useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type !== "nyam:open" || typeof data.url !== "string" || !data.url.startsWith("/")) return;
      const target = parseAlarmUrl(data.url);
      if (!target) {
        router.push(data.url);
        return;
      }
      setStep(target.recipeId, target.step);
      if (live.current.pathname !== cookPath(target.recipeId)) router.push(cookPath(target.recipeId));
    };
    sw.addEventListener("message", onMessage);
    return () => sw.removeEventListener("message", onMessage);
  }, [router]);

  /*
   * Звірка з базою — щойно відомий акаунт і рецепти. Не одразу при відкритті:
   * акаунт піднімається із сесії вже після першого рендеру, а без нього ні
   * пошук, ні скасування не пройдуть RLS. Рецепти — щоб знайдений будильник
   * було на який крок повернути.
   *
   * Заразом доганяємо скасування, що не дійшли минулого разу: застосунок могли
   * закрити раніше, ніж повернулась мережа.
   */
  const accountId = useApp((s) => s.account?.id ?? null);
  const recipesReady = useApp((s) => s.remoteReady || !isSupabaseConfigured);
  const reconciledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !accountId || !recipesReady || !isSupabaseConfigured) return;
    if (reconciledFor.current === accountId) return;
    reconciledFor.current = accountId;
    forgetLegacyRuns();

    flushCancels();
    queueAlarm(async () => {
      // Лише будильники цього пристрою. Браузер не підписаний — то й дзвонити
      // сюди сервер не міг, шукати нічого.
      const endpoint = await deviceEndpoint();
      if (!endpoint) return;
      for (const row of await fetchTimerPushes(endpoint)) {
        if (knownAlarm(row.id) || cancelPending(row.id)) continue;
        const target = parseAlarmUrl(row.url);
        // Будильник старої версії (адреса без кроку) — не наш, щоб судити:
        // хай продзвонить, якщо має.
        if (!target) continue;
        const recipe = recipeById(useApp.getState(), target.recipeId);
        if (adoptAlarm(row.id, row.fireAt, recipe, target.recipeId, target.step)) continue;
        rememberAlarm(row.id, row.fireAt, true);
        cancelAlarm(row.id);
      }
    });
  }, [ready, accountId, recipesReady]);

  return <CookDock pathname={pathname} />;
}

/**
 * Дзвінок одного таймера.
 *
 * Системне сповіщення — на випадок, якщо застосунок згорнули; тост і
 * вібрація — якщо ні.
 */
function ring(due: DueTimer, pathname: string, toast: (text: string, emoji?: string) => void): void {
  const { session, step, deadline, alarmId: id } = due;
  const now = Date.now();

  /*
   * Застосунок проспав дзвінок надовго (вивантажений iPhone відкрили за пів
   * години). Сервер уже продзвонив або вже не продзвонить; «час вийшов» зараз
   * — лише плутанина. Таймер однаково лишається червоним на панелі.
   */
  if (now - deadline > TIMER_STALE_MS) return;

  const onThisStep =
    pathname === cookPath(session.recipeId) && useCooking.getState().sessions[session.recipeId]?.step === step;
  haptic([200, 100, 200, 100, 300]);
  const title = session.title.length > 28 ? `${session.title.slice(0, 27)}…` : session.title;
  toast(onThisStep ? "Час вийшов!" : `Час вийшов: «${title}», крок ${step + 1}`, "⏰");

  const visible = document.visibilityState === "visible";
  const late = now - deadline > CAUGHT_UP_MS;
  /*
   * Чи сервер уже продзвонив за нас. Питання не в тому, чи видно сторінку, а
   * в тому, чи лежав будильник у базі: без нього (не ввійшли, пуш цьому
   * пристрою недоступний, запис не пройшов) місцеве сповіщення — єдине, хоч
   * би як пізно ми отямились. А з ним пізній тік у фоні — браузер будить
   * приспану вкладку раз на хвилину — показав би «час вийшов» удруге, вже
   * після того, як людина закрила серверний.
   */
  const serverRang = late && id != null && alarmWritten(id);

  /*
   * Застосунок на екрані — дзвінок уже відбувся тут, і серверний був би
   * другим. У фоні ж скасовуємо лише тоді, коли система справді показала
   * місцеве сповіщення: згорнутому застосунку вона може й відмовити. А коли
   * сервер уже продзвонив, у фоні не чіпаємо нічого: якщо розсилка
   * забарилась, її будильник — останній, що лишився.
   */
  if (visible) cancelAlarm(id);
  if (serverRang || !id) return;

  void showLocalAlarm(id, alarmText(session.title, step), alarmUrl(session.recipeId, step)).then((shown) => {
    if (shown && !visible) cancelAlarm(id);
  });
}

/**
 * Таймер сторінки до появи кількох таймерів — ключ `nyam-cook-timer:<рецепт>`.
 * Нова сторінка його не читає, а будильник у базі за ним і так продзвонить.
 */
function forgetLegacyRuns(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith("nyam-cook-timer:")) localStorage.removeItem(key);
    }
  } catch {
    /* приватний режим */
  }
}

/* ── Панель «готуєш зараз» ────────────────────────────────────────────── */

/**
 * Над нижньою навігацією — по рядку на кожен рецепт, який готуєш: найближчий
 * таймер і крок, натиск — назад у готування.
 *
 * Лише там, де є навігація: на сторінці готування свої таймери показує сама
 * сторінка, а повноекранні форми панель лише закривала б. На сторінці рецепта
 * його власний рядок не дублюємо — там кнопка «Продовжити».
 *
 * Висоту панелі віддаємо змінною --cook-dock: на неї підіймаються відступ
 * оболонки й липкі кнопки сторінок, щоб панель нічого не закривала.
 */
function CookDock({ pathname }: { pathname: string }) {
  const router = useRouter();
  const sessions = useCooking((s) => s.sessions);
  const navHidden = useNavHidden(pathname);
  const here = pathname.match(/^\/recipe\/([^/]+)$/)?.[1];

  const rows = navHidden
    ? []
    : startedSessions(sessions)
        .filter((s) => s.recipeId !== here)
        .sort((a, b) => urgency(a) - urgency(b) || b.touchedAt - a.touchedAt);
  const now = useNow(rows.some((s) => Object.values(s.timers).some((t) => t.deadline != null)));

  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!el || rows.length === 0) {
      root.style.setProperty("--cook-dock", "0px");
      return;
    }
    const apply = () => root.style.setProperty("--cook-dock", `${el.offsetHeight + 8}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rows.length]);

  useEffect(() => () => document.documentElement.style.setProperty("--cook-dock", "0px"), []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[35] mx-auto w-full max-w-[560px] px-3"
      style={{ bottom: `calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom) + 6px)` }}
    >
      <div ref={ref} className="flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {rows.slice(0, 3).map((session) => (
            <DockRow
              key={session.recipeId}
              session={session}
              now={now}
              onOpen={() => {
                haptic(10);
                router.push(cookPath(session.recipeId));
              }}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Продзвонені першими, далі найближчий дедлайн, далі без таймерів. */
function urgency(session: CookSession): number {
  const top = timersByUrgency(session)[0]?.timer;
  if (!top) return Number.MAX_SAFE_INTEGER;
  if (top.rangAt != null) return -1;
  return top.deadline ?? Number.MAX_SAFE_INTEGER - 1;
}

function DockRow({ session, now, onOpen }: { session: CookSession; now: number; onOpen: () => void }) {
  const title = useApp((s) => recipeById(s, session.recipeId)?.title) ?? session.title;
  const timers = timersByUrgency(session);
  const top = timers[0];
  const rang = top?.timer.rangAt != null;
  const where = session.step >= 0 ? `Крок ${session.step + 1} з ${session.stepCount}` : "Підготовка";
  const more =
    timers.length > 1 ? ` · ще ${timers.length - 1} ${plural(timers.length - 1, "таймер", "таймери", "таймерів")}` : "";

  return (
    <motion.button
      layout
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 12, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      onClick={onOpen}
      aria-label={`Повернутись до готування «${title}»`}
      className={cn(
        "glass pointer-events-auto flex w-full items-center gap-3 rounded-2xl border py-2 pl-3 pr-2 text-left shadow-[var(--shadow-card)]",
        rang ? "border-berry/50" : "border-line",
      )}
    >
      <span className="text-xl leading-none">{session.emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold leading-tight">{title}</span>
        <span className="block truncate text-[11px] text-muted">
          {where}
          {more}
        </span>
      </span>
      {top && (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-display text-[15px] font-extrabold tabular-nums",
            rang ? "bg-berry/15 text-berry" : top.timer.deadline != null ? "bg-brand/12 text-ink" : "bg-surface-2 text-muted",
          )}
        >
          {rang ? (
            <span className="font-sans text-[12px] font-bold">Час вийшов · крок {top.step + 1}</span>
          ) : (
            <>
              {top.timer.deadline != null ? (
                <Timer size={14} className="text-brand" />
              ) : (
                <Pause size={14} />
              )}
              {formatClock(timerLeft(top.timer, now))}
            </>
          )}
        </span>
      )}
    </motion.button>
  );
}
