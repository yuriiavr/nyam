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
import { recipeById, useApp } from "@/lib/store";
import type { PantryItem } from "@/lib/types";
import { formatClock, haptic } from "@/lib/utils";

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
  const baseSec = customSec[step] ?? currentStep?.timerSec ?? null;

  // Скидаємо таймер при зміні кроку
  useEffect(() => {
    setRunning(false);
    deadlineRef.current = null;
    firedRef.current = false;
    setRemaining(baseSec);
  }, [step, baseSec]);

  const finish = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    setRunning(false);
    deadlineRef.current = null;
    setRemaining(0);
    haptic([200, 100, 200, 100, 300]);
    toast("Час вийшов!", "⏰");

    /*
     * Якщо застосунок згорнули — просимо систему докласти голосу.
     *
     * Через service worker, а не `new Notification()`: на телефоні той
     * конструктор заборонений і кидає помилку, тобто цей будильник не дзвонив
     * саме там, де він потрібен, — коли екран згас і застосунок у фоні.
     *
     * Без дозволу просто мовчимо: набридати запитом посеред готування не варто.
     */
    void (async () => {
      try {
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.showNotification("Ням", {
          body: "Час вийшов — перевір страву",
          icon: "/api/icon?size=192",
          badge: "/api/icon?size=192",
          tag: "nyam-timer",
          requireInteraction: true,
          // Вібрація в кишені важить більше за звук: на кухні шумно.
          vibrate: [200, 100, 200, 100, 300],
          data: { url: window.location.pathname },
        } as NotificationOptions);
      } catch {
        /* не критично: тост і вібрація вже спрацювали */
      }
    })();
  }, [toast]);

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

  /** Запускає або ставить на паузу, перераховуючи дедлайн. */
  const toggleTimer = useCallback(() => {
    haptic(12);
    setRunning((was) => {
      if (was) {
        // Пауза: лишаємо на екрані те, що дійсно лишилось.
        const deadline = deadlineRef.current;
        if (deadline != null) {
          setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
        }
        deadlineRef.current = null;
        return false;
      }
      const base = remaining && remaining > 0 ? remaining : (baseSec ?? 0);
      if (base <= 0) return false;
      firedRef.current = false;
      deadlineRef.current = Date.now() + base * 1000;
      setRemaining(base);

      // Дозвіл питаємо один раз і саме тут — у момент, коли користувач сам
      // запускає таймер, тобто запит очікуваний.
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          void Notification.requestPermission();
        }
      } catch {
        /* не критично */
      }
      return true;
    });
  }, [remaining, baseSec]);

  /** Що списали з комори — показуємо на екрані завершення. */
  const [consumed, setConsumed] = useState<Consumed[]>([]);
  const [pantryBefore, setPantryBefore] = useState<PantryItem[]>([]);

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
  }, [baseSec]);

  const goNext = useCallback(() => {
    if (!recipe) return;
    haptic(12);
    if (step + 1 >= recipe.steps.length) {
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
        setPantryBefore(before.filter((p) => changes.some((c) => c.key === p.key)));
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
              {consumed.map((c) => (
                <li key={c.key} className="flex items-baseline gap-1.5 text-[12.5px]">
                  <span>{c.emoji}</span>
                  <span className="font-semibold">{c.label}</span>
                  <span className="text-muted">−{c.used}</span>
                  <span className={`ml-auto ${c.left ? "text-faint" : "text-berry"}`}>
                    {c.left ? `лишилось ${c.left}` : "закінчилось"}
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={undoConsume}
              className="mt-2.5 text-[12px] font-semibold text-muted underline"
            >
              Скасувати списання
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
          onExit={() => router.push(`/recipe/${recipe.id}`)}
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
        onExit={() => router.push(`/recipe/${recipe.id}`)}
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
