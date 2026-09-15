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
import { useEffect, useMemo, useRef, useState } from "react";
import { cookPath, useNow } from "@/components/CookingHost";
import { Button, EmptyState, Sheet, Stars, useToast } from "@/components/ui";
import { ing } from "@/data/ingredients";
import {
  anyRunning,
  endSession,
  isRunning,
  leaveSession,
  openSession,
  pauseTimer,
  resetTimer,
  setCustomTime,
  setStep,
  startedSessions,
  startTimer,
  stepSeconds,
  timerLeft,
  timersByUrgency,
  toggleChecked,
  useCooking,
  type CookSession,
  type StepTimer,
} from "@/lib/cooking";
import type { Consumed } from "@/lib/pantry";
import { enablePushFromTimer } from "@/lib/push";
import { recipeById, useApp } from "@/lib/store";
import type { PantryItem } from "@/lib/types";
import { cn, formatClock, haptic } from "@/lib/utils";

/*
 * Сторінка готування — лише екран. Крок, позначені продукти, свій час і
 * таймери живуть у src/lib/cooking.ts, а ведуться й дзвонять у CookingHost —
 * тож вийти звідси можна будь-коли: хрестиком, навігацією, закривши
 * застосунок. Повернення відкриває той самий крок, а таймери весь цей час
 * ідуть. Таймер належить кроку: перейшов на наступний — попередній рахує
 * далі, і його видно в рядку таймерів угорі.
 */

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

  const ready = useCooking((s) => s.ready);
  const session = useCooking((s) => s.sessions[params.id]);
  const [done, setDone] = useState(false);
  const [rating, setRating] = useState(0);
  const [timerSheet, setTimerSheet] = useState(false);

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

  /*
   * Відкриваємо готування — або підхоплюємо те, що лишили. Після «Готово!»
   * сесії вже немає, і відкривати її наново не можна.
   *
   * `?step=` приходить зі сповіщення «час вийшов», коли застосунок був
   * закритий: одразу на крок, чий таймер продзвонив. Читаємо раз і прибираємо
   * з адреси, щоб оновлення сторінки не перекидало туди знову.
   */
  const urlStepRead = useRef(false);
  useEffect(() => {
    if (!recipe || !ready || done) return;
    openSession(recipe);
    if (urlStepRead.current) return;
    urlStepRead.current = true;
    const raw = new URLSearchParams(window.location.search).get("step");
    if (raw == null) return;
    const step = Number(raw);
    if (Number.isInteger(step) && step >= 0 && step < recipe.steps.length) setStep(recipe.id, step);
    router.replace(cookPath(recipe.id));
  }, [recipe, ready, done, router]);

  const step = session?.step ?? -1;
  const currentStep = recipe && step >= 0 ? recipe.steps[step] : null;
  /*
   * Нуль у customSec — це «Без таймера», а не таймер на нуль секунд: інакше
   * замість кнопки «Поставити таймер» лишався мертвий червоний 0:00.
   */
  const baseSec = session ? stepSeconds(session, recipe, step) : null;
  const timer: StepTimer | undefined = session?.timers[step];
  const running = isRunning(timer);
  const ticking = useCooking((s) => anyRunning(s.sessions));
  const now = useNow(ticking);
  const remaining = timer ? timerLeft(timer, now) : baseSec;

  /** Запускає або ставить на паузу таймер цього кроку. */
  const toggleTimer = () => {
    haptic(12);
    if (!recipe || !session) return;
    if (running) {
      pauseTimer(recipe.id, step);
      return;
    }

    const seconds = remaining && remaining > 0 ? remaining : (baseSec ?? timer?.base ?? 0);
    if (seconds <= 0) return;
    const rearm = startTimer(recipe.id, step, seconds, baseSec ?? timer?.base ?? seconds);

    // Дозвіл питаємо саме тут — у момент, коли користувач сам запускає
    // таймер, тобто запит очікуваний. Погодився — підписуємо й кажемо про це;
    // «не зараз», «не пропонувати» й «вимкнено в налаштуваннях» поважаються
    // всередині.
    try {
      enablePushFromTimer(() => {
        toast("Сповіщення увімкнено", "🔔");
        rearm();
      });
    } catch {
      /* не критично */
    }
  };

  const resetStepTimer = () => {
    haptic(10);
    if (recipe) resetTimer(recipe.id, step);
  };

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

  /**
   * Вихід хрестиком — не кінець готування: крок і таймери лишаються, а
   * повернутись можна з панелі над навігацією чи зі сторінки рецепта.
   */
  const exitCooking = () => {
    haptic(10);
    const hadTimers = session ? Object.values(session.timers).some(isRunning) : false;
    leaveSession(params.id);
    if (hadTimers) toast("Таймери йдуть — повернешся з панелі внизу", "⏱️");
    router.push(`/recipe/${params.id}`);
  };

  const goNext = () => {
    if (!recipe || !session) return;
    haptic(12);
    if (step + 1 < recipe.steps.length) {
      setStep(recipe.id, step + 1);
      return;
    }
    // Страва готова — таймери цього рецепта, якщо ще йдуть, уже ні до чого.
    setDone(true);
    endSession(recipe.id);
    markCooked(recipe.id);
    // Комора має відповідати холодильнику: продукти, що пішли на страву,
    // з неї зникають. Знімок «до» лишаємо, щоб списання можна було
    // скасувати — помилитись кроком у готуванні легко.
    const before = useApp.getState().pantry;
    const changes = consumePantry(recipe);
    if (changes.length > 0) {
      setConsumed(changes);
      // Лише зачеплені рядки і саме за id: ключ типу не розрізняє пачок (D9).
      setPantryBefore(before.filter((p) => changes.some((c) => c.id === p.id)));
    }
    haptic([30, 60, 30, 60, 50]);
  };

  const goPrev = () => {
    haptic(8);
    if (recipe) setStep(recipe.id, Math.max(-1, step - 1));
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

  // Сховище ще читається або сесія от-от відкриється.
  if (!session) return <div className="min-h-dvh bg-bg" />;

  /* ── Підготовка ───────────────────────────────────────────────────── */
  if (step === -1) {
    // Рецепт могли змінити після того, як продукти позначили: рахуємо лише наявні.
    const checkedCount = recipe.ingredients.filter((i) => session.checked.includes(i.key)).length;
    const allChecked = checkedCount === recipe.ingredients.length;
    return (
      <div className="flex min-h-dvh flex-col">
        <CookHeader
          title="Підготовка"
          subtitle={recipe.title}
          onExit={exitCooking}
        />
        <TimersStrip session={session} now={now} onStep={(n) => setStep(recipe.id, n)} />

        <div className="flex-1 px-4 pt-4">
          <p className="text-[13.5px] leading-relaxed text-muted">
            Познач, що вже дістав із холодильника. Так нічого не забудеш посеред готування.
          </p>

          <div className="mt-4 flex flex-col gap-2">
            {recipe.ingredients.map((item) => {
              const def = ing(item.key);
              const isChecked = session.checked.includes(item.key);
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    haptic(10);
                    toggleChecked(recipe.id, item.key);
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
          <Button full size="lg" onClick={() => setStep(recipe.id, 0)}>
            {allChecked ? "Все на місці — почали" : "Почати готувати"}
            <ChevronRight size={19} />
          </Button>
          <p className="mt-2 text-center text-[11.5px] text-muted">
            {checkedCount} з {recipe.ingredients.length} готово
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

      <TimersStrip session={session} now={now} onStep={(n) => setStep(recipe.id, n)} />

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
                onClick={resetStepTimer}
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
        {running && (
          <p className="mt-2 text-center text-[11.5px] text-faint">
            Можна йти на інший крок чи вийти — таймер іде далі.
          </p>
        )}
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
        // Свій ключ на крок — щоб поле показувало час саме цього кроку. Не голий
        // step: той уже ключ картки кроку поруч, і React сплутав би їх.
        key={`timer-sheet:${step}`}
        open={timerSheet}
        current={baseSec ?? currentStep?.timerSec ?? 0}
        onClose={() => setTimerSheet(false)}
        onApply={(seconds) => {
          setCustomTime(recipe.id, step, seconds);
          setTimerSheet(false);
          toast(seconds > 0 ? "Час оновлено" : "Таймер прибрано", "⏱️");
        }}
      />
    </div>
  );
}

/**
 * Таймери, яких не видно на цьому екрані: інших кроків цього рецепта й інших
 * рецептів, які готуєш паралельно. Натиск — туди, де таймер.
 */
function TimersStrip({
  session,
  now,
  onStep,
}: {
  session: CookSession;
  now: number;
  onStep: (step: number) => void;
}) {
  const router = useRouter();
  const sessions = useCooking((s) => s.sessions);

  const own = timersByUrgency(session).filter((t) => t.step !== session.step);
  const others = startedSessions(sessions).filter((s) => s.recipeId !== session.recipeId);
  if (own.length === 0 && others.length === 0) return null;

  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-line px-4 py-2.5">
      {own.map(({ step, timer }) => (
        <TimerChip
          key={`step:${step}`}
          label={`Крок ${step + 1}`}
          timer={timer}
          now={now}
          onClick={() => {
            haptic(8);
            onStep(step);
          }}
        />
      ))}
      {others.map((other) => {
        const top = timersByUrgency(other)[0];
        const title = other.title.length > 16 ? `${other.title.slice(0, 15)}…` : other.title;
        return (
          <TimerChip
            key={`recipe:${other.recipeId}`}
            label={`${other.emoji} ${title}`}
            timer={top?.timer}
            fallback={other.step >= 0 ? `крок ${other.step + 1}` : "підготовка"}
            now={now}
            onClick={() => {
              haptic(8);
              router.push(cookPath(other.recipeId));
            }}
          />
        );
      })}
    </div>
  );
}

function TimerChip({
  label,
  timer,
  fallback,
  now,
  onClick,
}: {
  label: string;
  timer: StepTimer | undefined;
  fallback?: string;
  now: number;
  onClick: () => void;
}) {
  const rang = timer?.rangAt != null;
  const going = isRunning(timer);
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-bold",
        rang
          ? "border-berry/50 bg-berry/10 text-berry"
          : going
            ? "border-brand/40 bg-brand/10"
            : "border-line bg-surface text-muted",
      )}
    >
      <span>{label}</span>
      {timer ? (
        <span className="flex items-center gap-1 tabular-nums">
          {rang ? (
            "· час вийшов"
          ) : (
            <>
              {going ? <Timer size={13} className="text-brand" /> : <Pause size={13} />}
              {formatClock(timerLeft(timer, now))}
            </>
          )}
        </span>
      ) : (
        fallback && <span className="font-semibold text-faint">· {fallback}</span>
      )}
    </button>
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
