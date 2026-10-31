"use client";

import { motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  Scale,
  SlidersHorizontal,
  Timer,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cookPath, useNow } from "@/components/CookingHost";
import { CookedSheet, type CookedSave } from "@/components/diary/CookedSheet";
import { SplitSheet, type SplitRequest } from "@/components/diary/SplitSheet";
import { RecipeMedia } from "@/components/RecipeCard";
import { Button, EmptyState, Panel, PanelHeader, Sheet, Stars, useToast } from "@/components/ui";
import { WeighSheet } from "@/components/WeighSheet";
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
  setWeight,
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
import { stepIngredients, withWeights, type CookWeight } from "@/lib/cooked";
import type { Consumed } from "@/lib/pantry";
import { enablePushFromTimer } from "@/lib/push";
import { mealFromRecipe, slotAt } from "@/lib/diary";
import { diaryUserId, recipeById, useApp } from "@/lib/store";
import type { PantryItem, Recipe } from "@/lib/types";
import { formatQuantity, ingredientQtyLabel } from "@/lib/units";
import { cn, formatClock, haptic, newId, plural } from "@/lib/utils";

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
  const recookPantry = useApp((s) => s.recookPantry);
  const saveMeal = useApp((s) => s.saveMeal);
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
  /* «Хто скільки зʼїв» після готування: поділ страви між рідними. */
  const [split, setSplit] = useState<SplitRequest | null>(null);
  const [logged, setLogged] = useState(false);
  /* Страва цього готування: той самий id і до запису, і після — склад можна уточнити й тоді. */
  const [mealId] = useState(newId);
  /* Склад, як його справді зварили, — коли готували не за рецептом. */
  const [cooked, setCooked] = useState<CookedSave | null>(null);
  const [cookedOpen, setCookedOpen] = useState(false);
  /* Ваги, записані посеред готування: сесія після «Готово!» зникає, а склад із них ще складати. */
  const [weighed, setWeighed] = useState<Record<string, CookWeight>>({});
  /* Аркуш «зважити»: null — закритий; key null — спершу обрати продукт. */
  const [weigh, setWeigh] = useState<{ key: string | null } | null>(null);
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
    setPantryBefore([]);
    toast("Продукти повернуто в комору", "↩️");
  };

  /*
   * Склад уточнили: комору — за ним, а не за рецептом. Страва, яку вже
   * поділили, бере нове число одразу: записи в щоденниках рахуються з неї
   * (а в базі їх переписує тригер страви).
   */
  const applyCooked = (result: CookedSave) => {
    const { consumed: now, before } = recookPantry(pantryBefore, result.wants);
    setConsumed(now);
    setPantryBefore(before);
    setCooked(result);
    setCookedOpen(false);
    if (logged) {
      const meal = useApp.getState().meals.find((m) => m.id === mealId);
      if (meal) saveMeal({ ...meal, items: result.items, nutrition: result.nutrition, note: result.note });
    }
    toast(`Склад уточнено: ${result.nutrition.kcal} ккал на всю страву`, "✅");
  };

  /** Вага записана — назад до кроку: руки зайняті, зайвих дотиків не треба. */
  const saveWeight = (key: string, weight: CookWeight | null) => {
    if (!recipe) return;
    setWeight(recipe.id, key, weight);
    setWeigh(null);
    const label = recipe.ingredients.find((i) => i.key === key)?.label ?? ing(key).label;
    toast(
      weight ? `${label} — ${formatQuantity(weight.amount, weight.unit)}${weight.cooked ? " готового" : ""}` : `${label}: вагу прибрано`,
      "⚖️",
    );
  };

  const weighSheet = recipe && session && (
    <WeighSheet
      open={!!weigh}
      recipe={recipe}
      ingKey={weigh?.key ?? null}
      weights={session.weights}
      onPick={(key) => setWeigh({ key })}
      onSave={saveWeight}
      onClose={() => setWeigh(null)}
    />
  );

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
    // Ваги забираємо раніше, ніж сесія зникне.
    const weights = session.weights;
    setWeighed(weights);
    setDone(true);
    endSession(recipe.id);
    markCooked(recipe.id);
    // Комора має відповідати холодильнику: продукти, що пішли на страву,
    // з неї зникають — за вагами, якщо їх записували, інакше за рецептом.
    // Знімок «до» лишаємо, щоб списання можна було скасувати — помилитись
    // кроком у готуванні легко.
    const before = useApp.getState().pantry;
    const changes = consumePantry(withWeights(recipe, weights));
    if (changes.length > 0) {
      setConsumed(changes);
      // Лише зачеплені рядки і саме за id: ключ типу не розрізняє пачок (D9).
      setPantryBefore(before.filter((p) => changes.some((c) => c.id === p.id)));
    }
    // Зважували — склад уже майже готовий: відкриваємо його, лишилось порахувати.
    if (Object.keys(weights).length > 0) setCookedOpen(true);
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
    const weighedCount = Object.keys(weighed).length;
    return (
      <div className="flex min-h-dvh flex-col">
        <div className="flex flex-1 flex-col gap-2.5 px-4 pb-4 pt-[calc(18px+env(safe-area-inset-top))]">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            className="flex flex-col items-center gap-2 pb-2 pt-3.5"
          >
            <RecipeMedia recipe={recipe} className="h-24 w-24" rounded="rounded-[24px]" emojiSize="text-[52px]" />
            <h1 className="font-display text-[24px] font-bold">Смачного!</h1>
            <p className="text-center text-[12.5px] font-semibold text-faint">«{recipe.title}» — в історії приготувань</p>
          </motion.div>

          {consumed.length > 0 && (
            <Panel>
              <PanelHeader label="Списано з комори" />
              {consumed.map((c, i) => (
                // Один рядок комори може закрити дві потреби рецепта — id не унікальний.
                <div key={`${c.id}:${i}`} className="flex min-h-11 items-center gap-2.5 border-t border-line px-3.5 py-2">
                  <span className="text-[16px]">{c.emoji}</span>
                  {/* «Молоко Галичина 2,5%: −500 мл, лишилось 400 мл» — назва пачки, а не типу. */}
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{c.label}</span>
                  <span className="shrink-0 text-right text-[12.5px] font-bold text-muted">
                    −{c.used}
                    <span className={cn("block text-[11px] font-semibold", c.left ? "text-faint" : "text-berry")}>
                      {c.left ? `лишилось ${c.left}` : "закінчилось"}
                    </span>
                  </span>
                </div>
              ))}
              <button
                onClick={undoConsume}
                className="flex h-11 w-full items-center border-t border-line px-3.5 text-left text-[13.5px] font-bold text-muted active:bg-surface-2"
              >
                Повернути в комору
              </button>
            </Panel>
          )}

          {/* Склад, як його справді зварили */}
          <Panel>
            <PanelHeader label="Склад страви" aside={cooked ? `${cooked.nutrition.kcal} ккал` : undefined} />
            <p className="border-t border-line px-3.5 py-2.5 text-[12.5px] font-semibold leading-snug text-muted">
              {cooked
                ? "Як справді зварили — калорії й комора вже за цим складом."
                : weighedCount > 0
                  ? `Зважено на ходу: ${weighedCount} ${plural(weighedCount, "продукт", "продукти", "продуктів")}, решта — як у рецепті.`
                  : "Як у рецепті. Клали інакше — виправ, і калорії з коморою підлаштуються."}
            </p>
            <button
              onClick={() => {
                haptic(10);
                setCookedOpen(true);
              }}
              className="flex h-11 w-full items-center gap-2 border-t border-line px-3.5 text-left active:bg-surface-2"
            >
              <span className="flex-1 text-[13.5px] font-bold text-brand">
                {cooked ? "Змінити склад" : weighedCount > 0 ? "Порахувати за вагами" : "Уточнити, скільки чого пішло"}
              </span>
              <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
            </button>
          </Panel>

          {/* Хто скільки зʼїв */}
          {logged ? (
            <div className="flex h-14 items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5">
              <span className="text-[20px]">✅</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold">Записано в щоденник</span>
                <span className="block truncate text-[11.5px] font-semibold text-faint">Залишок доїсте одним дотиком</span>
              </span>
            </div>
          ) : (
            <button
              onClick={() => {
                const meal = mealFromRecipe(recipe, {
                  id: mealId,
                  ownerId: diaryUserId(useApp.getState()),
                  cookedAt: new Date().toISOString(),
                });
                setSplit({
                  // Уточнений склад — уже вся каструля: рецепт його не перебиває.
                  meal: cooked ? { ...meal, items: cooked.items, nutrition: cooked.nutrition, note: cooked.note } : meal,
                  isNew: true,
                  source: "cook",
                  slot: slotAt(),
                });
              }}
              className="flex h-14 items-center gap-3 rounded-[10px] border border-brand/35 bg-surface px-3.5 text-left active:bg-surface-2"
            >
              <span className="text-[20px]">🍽️</span>
              <span className="flex-1 text-[14px] font-bold">Хто скільки зʼїв — у щоденник</span>
              <span className="text-[13px] font-extrabold text-brand">›</span>
            </button>
          )}

          <Panel>
            <PanelHeader label="Як вийшло?" />
            <div className="flex justify-center border-t border-line pb-3.5 pt-2.5">
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
          </Panel>
        </div>

        <CookFooter>
          <div className="flex gap-2">
            <Link href={`/recipe/${recipe.id}`} aria-label="До рецепта" className={FOOTER_BACK}>
              <ChevronLeft size={20} strokeWidth={2.2} />
            </Link>
            <Link href="/decide" className={cn(FOOTER_MAIN, "flex-1")}>
              Обрати наступну страву
            </Link>
          </div>
        </CookFooter>

        <SplitSheet request={split} onClose={() => setSplit(null)} onDone={() => setLogged(true)} />
        <CookedSheet
          open={cookedOpen}
          recipe={recipe}
          pantryBefore={pantryBefore}
          draft={cooked?.lines}
          weights={weighed}
          onClose={() => setCookedOpen(false)}
          onSave={applyCooked}
        />
      </div>
    );
  }

  // Сховище ще читається або сесія от-от відкриється.
  if (!session) return <div className="min-h-dvh bg-bg" />;

  /** Рядок «дістав продукт» із вагою — у підготовці й у бічній колонці планшета. */
  const ingredientRow = (item: Recipe["ingredients"][number]) => {
    const def = ing(item.key);
    const isChecked = session.checked.includes(item.key);
    const w = session.weights[item.key];
    return (
      <div key={item.key} className="flex min-h-[52px] items-center border-t border-line">
        <button
          onClick={() => {
            haptic(10);
            toggleChecked(recipe.id, item.key);
          }}
          aria-pressed={isChecked}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch px-3.5 text-left"
        >
          <span
            className={cn(
              "grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors",
              isChecked ? "border-brand bg-brand text-brand-ink" : "border-line-strong",
            )}
          >
            {isChecked && <Check size={12} strokeWidth={3.5} />}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[14px] font-semibold",
              isChecked ? "text-faint line-through" : "text-ink",
            )}
          >
            {item.label ?? def.label}
          </span>
        </button>
        {/* Вага — окремою кнопкою: рядок сам позначає «дістав». */}
        <button
          onClick={() => {
            haptic(8);
            setWeigh({ key: item.key });
          }}
          aria-label={`Зважити: ${def.label}`}
          className={cn(
            "flex shrink-0 items-center gap-1.5 self-stretch px-3.5 text-[12.5px] font-bold",
            w ? "text-brand" : "text-muted",
          )}
        >
          {w ? `${formatQuantity(w.amount, w.unit)}${w.cooked ? " гот." : ""}` : ingredientQtyLabel(item)}
          <Scale size={14} />
        </button>
      </div>
    );
  };
  // Рецепт могли змінити після того, як продукти позначили: рахуємо лише наявні.
  const checkedCount = recipe.ingredients.filter((i) => session.checked.includes(i.key)).length;

  /* ── Підготовка ───────────────────────────────────────────────────── */
  if (step === -1) {
    const allChecked = checkedCount === recipe.ingredients.length;
    return (
      <div className="flex min-h-dvh flex-col">
        <CookHeader
          title="Підготовка"
          subtitle={recipe.title}
          onExit={exitCooking}
          progress={recipe.ingredients.length ? (checkedCount / recipe.ingredients.length) * 100 : 0}
        />
        <TimersStrip session={session} now={now} onStep={(n) => setStep(recipe.id, n)} />

        <div className="w-full flex-1 px-4 py-3.5 md:mx-auto md:max-w-[720px] md:px-6">
          <Panel>
            <div className="flex h-10 items-center justify-between px-3.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">Дістань продукти</span>
              <span className="text-[12px] font-bold text-faint">
                {checkedCount} з {recipe.ingredients.length}
              </span>
            </div>
            {recipe.ingredients.map(ingredientRow)}
          </Panel>
          <p className="px-1 pt-2.5 text-[11.5px] font-semibold leading-snug text-faint">
            Познач, що вже дістав. Зважив — тицни у вагу праворуч і запиши.
          </p>
        </div>

        <CookFooter>
          <button onClick={() => setStep(recipe.id, 0)} className={FOOTER_MAIN}>
            {allChecked ? "Все на місці — почали" : "Почати готувати"}
            <ChevronRight size={19} strokeWidth={2.4} />
          </button>
          <p className="text-center text-[11.5px] font-semibold text-faint">
            {checkedCount} з {recipe.ingredients.length} готово
          </p>
        </CookFooter>
        {weighSheet}
      </div>
    );
  }

  /* ── Крок ─────────────────────────────────────────────────────────── */
  const progress = ((step + 1) / recipe.steps.length) * 100;
  const mentioned = stepIngredients(recipe, step);

  return (
    <div className="flex min-h-dvh flex-col">
      <CookHeader
        title={`Крок ${step + 1} з ${recipe.steps.length}`}
        subtitle={recipe.title}
        onExit={exitCooking}
        progress={progress}
      />

      <TimersStrip session={session} now={now} onStep={(n) => setStep(recipe.id, n)} />

      {/* Планшет (lg): крок ліворуч, продукти — бічною колонкою на 300 px. */}
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-4 lg:px-5 lg:pt-4">
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
        className="flex flex-1 flex-col px-[22px] pb-4 pt-7 md:px-8 lg:rounded-[12px] lg:border lg:border-line lg:bg-surface lg:px-[26px] lg:pb-5 lg:pt-6"
      >
        <span className="font-display text-[64px] font-bold leading-none text-line lg:text-[48px]">
          {String(step + 1).padStart(2, "0")}
        </span>
        <p className="mt-4 text-[21px] font-semibold leading-[1.5] [text-wrap:pretty] lg:text-[26px] lg:font-bold lg:leading-[1.35]">
          {currentStep?.text}
        </p>

        {currentStep?.tip && (
          <div className="mt-[18px] flex gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-3">
            <span className="text-[15px]">💡</span>
            <p className="text-[13.5px] leading-[1.5] text-muted">{currentStep.tip}</p>
          </div>
        )}

        {/*
          Ваги того, що згадує крок: нарізав огірок — одразу записав 50 г.
          Перенос рядків, а не прокрутка: прокрутку вбік зʼїв би свайп кроків.
        */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {mentioned.map((item) => {
            const w = session.weights[item.key];
            return (
              <button
                key={item.key}
                onClick={() => {
                  haptic(8);
                  setWeigh({ key: item.key });
                }}
                className={cn(
                  "flex h-8 max-w-full items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px] font-bold",
                  w ? "border-brand/40 bg-brand/10" : "border-line bg-surface text-muted",
                )}
              >
                <span>{ing(item.key).emoji}</span>
                <span className="truncate">{item.label ?? ing(item.key).label}</span>
                {w ? (
                  <span className="shrink-0 text-brand">· {formatQuantity(w.amount, w.unit)}</span>
                ) : (
                  <Scale size={13} className="shrink-0" />
                )}
              </button>
            );
          })}
          <button
            onClick={() => {
              haptic(8);
              setWeigh({ key: null });
            }}
            className="flex h-8 items-center gap-1.5 rounded-[8px] border border-dashed border-line-strong px-2.5 text-[12.5px] font-bold text-muted"
          >
            <Scale size={13} />
            {mentioned.length ? "Інше" : "Записати вагу"}
          </button>
        </div>

        {/* Таймер */}
        <div className="mt-[22px] overflow-hidden rounded-[12px] border border-line bg-surface">
          {remaining == null ? (
            <div className="flex flex-col gap-2.5 px-3.5 py-3">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">Таймер на цей крок</span>
              <div className="grid grid-cols-4 gap-1.5">
                {TIMER_PRESETS.map((sec) => (
                  <button
                    key={sec}
                    onClick={() => {
                      haptic(10);
                      setCustomTime(recipe.id, step, sec);
                    }}
                    className="h-[38px] rounded-[8px] bg-surface-2 text-[13.5px] font-extrabold active:bg-line"
                  >
                    {sec / 60} хв
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  haptic(8);
                  setTimerSheet(true);
                }}
                className="self-start text-[12.5px] font-bold text-brand"
              >
                Свій час…
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 p-3.5">
              <span
                className={cn(
                  "flex-1 font-display text-[34px] font-bold tabular-nums",
                  remaining === 0 ? "text-berry" : running ? "text-ink" : "text-muted",
                )}
              >
                {formatClock(remaining)}
              </span>
              <button
                onClick={() => {
                  haptic(10);
                  setTimerSheet(true);
                }}
                aria-label="Змінити час"
                className={TIMER_TOOL}
              >
                <SlidersHorizontal size={17} />
              </button>
              <button onClick={resetStepTimer} aria-label="Скинути таймер" className={TIMER_TOOL}>
                <RotateCcw size={17} />
              </button>
              <button
                onClick={toggleTimer}
                aria-label={running ? "Пауза" : "Старт"}
                className="grid h-[52px] w-[52px] place-items-center rounded-[12px] brand-gradient text-brand-ink"
              >
                {running ? <Pause size={20} className="fill-current" /> : <Play size={20} className="ml-0.5 fill-current" />}
              </button>
            </div>
          )}
        </div>
        {running && (
          <p className="mt-2 text-center text-[11.5px] font-semibold text-faint">
            Можна йти на інший крок — таймер іде далі
          </p>
        )}
      </motion.div>

      <aside className="hidden lg:sticky lg:top-4 lg:block">
        <Panel>
          <div className="flex h-10 items-center justify-between px-3.5">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">Інгредієнти</span>
            <span className="text-[12px] font-bold text-faint">
              {checkedCount} з {recipe.ingredients.length}
            </span>
          </div>
          {recipe.ingredients.map(ingredientRow)}
        </Panel>
      </aside>
      </div>

      <CookFooter>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-4">
        <div className="flex gap-2">
          <button onClick={goPrev} aria-label="Назад" className={FOOTER_BACK}>
            <ChevronLeft size={20} strokeWidth={2.2} />
          </button>
          <button onClick={goNext} className={cn(FOOTER_MAIN, "flex-1")}>
            {step + 1 >= recipe.steps.length ? (
              <>
                <Check size={19} strokeWidth={2.6} />
                Готово!
              </>
            ) : (
              <>
                Далі
                <ChevronRight size={19} strokeWidth={2.4} />
              </>
            )}
          </button>
        </div>
        <span className="hidden items-center justify-center rounded-[12px] border border-dashed border-line-strong text-[13px] font-bold text-muted lg:flex">
          Свайп ← → між кроками
        </span>
        </div>
      </CookFooter>

      {weighSheet}

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

/** Швидкі таймери на крок без свого часу. */
const TIMER_PRESETS = [60, 180, 300, 600];
const TIMER_TOOL = "grid h-[42px] w-[42px] place-items-center rounded-[10px] bg-surface-2 text-muted active:bg-line";
const FOOTER_BACK = "grid h-[52px] w-[54px] shrink-0 place-items-center rounded-[12px] bg-surface-2 active:bg-line";
const FOOTER_MAIN =
  "flex h-[52px] min-w-0 items-center justify-center gap-1.5 rounded-[12px] brand-gradient text-[15.5px] font-extrabold text-brand-ink";

/** Низ екрана готування: головна дія завжди під пальцем. */
function CookFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="pad-safe-b sticky bottom-0 z-10 flex flex-col gap-2 border-t border-line bg-[rgb(7_7_9_/_0.9)] px-4 pb-4 pt-3 backdrop-blur-md md:px-6 lg:px-5">
      {children}
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
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5">
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
        "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border px-2.5 text-[12.5px] font-bold tabular-nums",
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
          className="h-16 w-full rounded-[10px] bg-surface-2 text-center font-display text-3xl font-bold tabular-nums"
        />
        <div className="mt-3 grid grid-cols-3 gap-2">
          {UNITS.map((u) => (
            <button
              key={u.key}
              onClick={() => {
                haptic(8);
                setUnit(u.key);
              }}
              className={`rounded-[8px] border py-2.5 text-[13px] font-bold ${
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
  progress,
}: {
  title: string;
  subtitle: string;
  onExit: () => void;
  /** Скільки пройдено, 0–100: смужка під шапкою. */
  progress: number;
}) {
  return (
    <header className="pad-safe-t sticky top-0 z-20 bg-bg">
      <div className="flex h-14 items-center gap-2.5 px-4 md:h-[72px] md:gap-3.5 md:px-5">
        <button
          onClick={onExit}
          aria-label="Вийти з режиму готування"
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-surface-2 active:bg-line"
        >
          <X size={18} strokeWidth={2.2} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[16px] font-bold leading-tight md:text-[19px] md:font-extrabold">{title}</p>
          <p className="truncate text-[12px] font-semibold text-faint">{subtitle}</p>
        </div>
      </div>
      <div className="h-[3px] bg-surface-2">
        <motion.div
          className="h-full brand-gradient"
          animate={{ width: `${progress}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 30 }}
        />
      </div>
    </header>
  );
}
