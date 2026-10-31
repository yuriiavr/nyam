"use client";

import { AnimatePresence, motion, Reorder, useDragControls } from "framer-motion";
import {
  Camera,
  Check,
  GripVertical,
  ImagePlus,
  Loader2,
  Minus,
  Plus,
  Refrigerator,
  ScanBarcode,
  Search,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Panel, PanelHeader, QuantityInput, Segmented, Sheet, Spinner, useToast } from "@/components/ui";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FridgePicker } from "@/components/FridgePicker";
import {
  CAT_LABEL,
  CAT_ORDER,
  allIngredients,
  ing,
  isOwnKey,
  knownIngredient,
  searchIngredients,
} from "@/data/ingredients";
import { catalogDeps } from "@/components/pantry/catalog";
import { resolveBarcode } from "@/lib/resolve";
import { recipeById, useApp } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import type {
  Course,
  IngredientCat,
  IngredientDef,
  MealType,
  Mood,
  Recipe,
  RecipeIngredient,
  RecipeStep,
} from "@/lib/types";
import { EditTypeButton } from "@/components/EditTypeButton";
import { NewIngredientSheet } from "@/components/NewIngredientSheet";
import { FOOD_EMOJI } from "@/data/emoji";
import { COURSE_LABEL, COURSE_ORDER, courseOf } from "@/lib/pairing";
import { cn, compressImage, haptic, MEAL_LABEL, MOOD_META, newId } from "@/lib/utils";


/** Міри таймера. Зберігаємо в секундах, показуємо в зручній. */
type TimerUnit = "sec" | "min" | "hour";
const TIMER_UNITS: Record<TimerUnit, number> = { sec: 1, min: 60, hour: 3600 };

const GRADIENTS: Array<[string, string]> = [
  ["#ff6b35", "#ffb020"],
  ["#f43f6a", "#ff6b35"],
  ["#34d399", "#38bdf8"],
  ["#a78bfa", "#f43f6a"],
  ["#fbbf24", "#fb7185"],
  ["#16a34a", "#eab308"],
  ["#0ea5e9", "#a78bfa"],
  ["#78350f", "#d97706"],
];

const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert", "drink"];
const MOODS: Mood[] = [
  "fast", "comfort", "healthy", "hearty", "spicy", "sweet", "fancy", "cheap", "cozy", "fresh",
];

export default function NewRecipePage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <RecipeForm />
    </Suspense>
  );
}

function RecipeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const profile = useApp((s) => s.profile);
  const myRecipes = useApp((s) => s.myRecipes);
  const updateRecipe = useApp((s) => s.updateRecipe);
  const addRecipe = useApp((s) => s.addRecipe);
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState(FOOD_EMOJI[0]);
  const [gradient, setGradient] = useState<[string, string]>(GRADIENTS[0]);
  const [image, setImage] = useState<string | null>(null);
  const [cuisine, setCuisine] = useState("Домашня");
  const [mealTypes, setMealTypes] = useState<MealType[]>(["dinner"]);
  const [course, setCourse] = useState<Course>("whole");
  const [moods, setMoods] = useState<Mood[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [timeMin, setTimeMin] = useState(30);
  const [servings, setServings] = useState(2);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(1);
  const [costLevel, setCostLevel] = useState<1 | 2 | 3>(1);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [steps, setSteps] = useState<FormStep[]>([{ uid: newId(), text: "" }]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [fridgeOpen, setFridgeOpen] = useState(false);
  const hasPantry = useApp((s) => s.pantry.length > 0);
  const [pickerQuery, setPickerQuery] = useState("");
  /** Назва для картки власного продукту; null — картка закрита. */
  const [creating, setCreating] = useState<string | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Завантаження рецепта для редагування
  useEffect(() => {
    if (!hydrated || loaded) return;
    if (editId) {
      const r = recipeById(useApp.getState(), editId);
      if (r) {
        setTitle(r.title);
        setDescription(r.description);
        setEmoji(r.emoji);
        setGradient(r.gradient);
        setImage(r.image ?? null);
        setCuisine(r.cuisine);
        setMealTypes(r.mealTypes);
        setCourse(courseOf(r));
        setMoods(r.moods);
        setTags(r.tags);
        setTimeMin(r.timeMin);
        setServings(r.servings);
        setDifficulty(r.difficulty);
        setCostLevel(r.costLevel);
        setIngredients(r.ingredients);
        setSteps(
          (r.steps.length ? r.steps : [{ text: "" }]).map((step) => ({ ...step, uid: newId() })),
        );
      }
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, editId, loaded, myRecipes]);

  const valid =
    title.trim().length >= 2 &&
    ingredients.length > 0 &&
    steps.some((s) => s.text.trim().length > 0);

  const pickImage = async (file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      setImage(dataUrl);
      haptic(12);
    } catch {
      toast("Не вдалося обробити фото", "⚠️");
    }
  };

  const save = () => {
    if (!valid) return;
    setSaving(true);
    haptic([16, 40, 16]);

    // Ключ порядку — суто екранна річ: у рецепт він не їде.
    const cleanSteps: RecipeStep[] = steps
      .filter((s) => s.text.trim())
      .map(({ uid: _uid, ...step }) => step);
    const base = {
      title: title.trim(),
      description: description.trim() || "Без опису — але точно смачно.",
      emoji,
      gradient,
      image,
      cuisine: cuisine.trim() || "Домашня",
      mealTypes: mealTypes.length ? mealTypes : (["dinner"] as MealType[]),
      course,
      moods,
      tags,
      timeMin,
      servings,
      difficulty,
      costLevel,
      ingredients,
      steps: cleanSteps,
    };

    if (editId && recipeById(useApp.getState(), editId)) {
      updateRecipe(editId, base);
      toast("Рецепт оновлено", "✅");
      router.replace(`/recipe/${editId}`);
    } else {
      const recipe: Recipe = {
        ...base,
        id: newId(),
        authorId: profile.id,
        createdAt: new Date().toISOString(),
        stats: { likes: 0, saves: 0, cooks: 0, ratingSum: 0, ratingCount: 0 },
        mine: true,
      };
      addRecipe(recipe);
      toast("Рецепт додано в галерею", "🎉");
      router.replace(`/recipe/${recipe.id}`);
    }
  };

  const toggle = <T,>(arr: T[], v: T, set: (v: T[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  /**
   * Додає товар зі штрихкоду (D10).
   *
   * Рецепт спільний, тож рядок складу — завжди тип, а не конкретна пачка:
   * ключ — тип картки товару (чи тип, який знає база або Open Food Facts), а
   * назва й КБЖВ — з картки чи етикетки, бо стосуються саме цього товару, а
   * не усередненої категорії. Синтетичний ключ `barcode:…` лишається тільки
   * тоді, коли ні товару, ні типу не знає ніхто: інакше рядок не зливався б із
   * рецептами й списком покупок.
   */
  const onScanned = async (code: string) => {
    setScanOpen(false);
    setScanBusy(true);
    try {
      const res = await resolveBarcode(code, catalogDeps());
      if (!res.ean) {
        toast("Це не штрихкод товару — обери продукт зі списку", "ℹ️");
        return;
      }

      const product = res.product;
      if (product) useApp.getState().upsertProducts([product], res.hit ? [res.hit] : undefined);
      const typeKey = product?.typeKey ?? (res.typeKey && knownIngredient(res.typeKey) ? res.typeKey : undefined);
      const name = product?.name ?? (res.draft?.name || undefined);
      const nutrition = product?.nutrition ?? res.draft?.nutrition;

      if (!typeKey && !name) {
        toast(
          res.error === "offline"
            ? "Без звʼязку штрихкод не прочитати — обери продукт зі списку"
            : "Цього штрихкоду ніхто не знає — обери продукт зі списку",
          "⚠️",
        );
        return;
      }

      const key = typeKey ?? `barcode:${res.ean}`;
      if (ingredients.some((i) => i.key === key)) {
        toast("Цей продукт уже в списку", "ℹ️");
        return;
      }

      const def = typeKey ? ing(typeKey) : null;
      setIngredients((prev) => [
        ...prev,
        {
          key,
          unit: def?.defaultUnit ?? "g",
          // Назва товару уточнює тип («Молоко безлактозне Галичина 2,5%»); без неї — назва типу.
          label: name && name !== def?.label ? name : undefined,
          nutrition,
          ...(product ? { productId: product.id } : {}),
        },
      ]);

      haptic(14);
      const shown = name ?? def?.label ?? "Товар";
      toast(
        nutrition ? `${shown} — КБЖВ з етикетки` : `${shown} — без даних про склад`,
        nutrition ? "✅" : "⚠️",
      );
    } catch {
      toast("Не вдалося прочитати товар", "⚠️");
    } finally {
      setScanBusy(false);
    }
  };

  return (
    <div className="pb-32">
      <TopBar
        title={editId ? "Редагувати рецепт" : "Новий рецепт"}
        subtitle={title || "Розкажи, що ти готуєш"}
      />

      <div className="flex flex-col gap-2.5 px-4">
        {/* Обкладинка */}
        <Panel>
          <PanelHeader label="Обкладинка" />
          <div
            className="relative aspect-[16/10] border-t border-line"
            style={
              image
                ? undefined
                : { backgroundImage: `linear-gradient(140deg, ${gradient[0]}, ${gradient[1]})` }
            }
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-[76px] leading-none">{emoji}</div>
            )}

            {image && (
              <button
                onClick={() => setImage(null)}
                aria-label="Прибрати фото"
                className="absolute right-2.5 top-2.5 grid h-[34px] w-[34px] place-items-center rounded-[8px] bg-[rgb(8_8_10_/_0.55)] text-white backdrop-blur-md"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
            <button onClick={() => fileRef.current?.click()} className={GRID_ACTION}>
              <Camera size={16} className="text-muted" />
              {image ? "Змінити фото" : "Додати фото"}
            </button>
            <button onClick={() => setStyleOpen(true)} className={GRID_ACTION}>
              <ImagePlus size={16} className="text-muted" />
              Стиль
            </button>
          </div>
          {/*
            Без `capture`: саме цей атрибут змушував телефон одразу відкривати
            камеру, і зняти фото було єдиним способом. Тепер система пропонує
            вибір — галерея, камера або файл.
          */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pickImage(e.target.files?.[0])}
          />
        </Panel>

        {/* Основне */}
        <Panel>
          <PanelHeader label="Про страву" />
          <Field label="Назва страви">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Наприклад: Паста з грибами"
              maxLength={70}
              className={INPUT}
            />
          </Field>

          <Field label="Короткий опис">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Чим ця страва особлива? Одне-два речення."
              rows={3}
              maxLength={220}
              className="w-full resize-none rounded-[8px] bg-surface-2 px-3 py-2.5 text-[14px] font-medium leading-relaxed placeholder:text-faint"
            />
          </Field>

          <Field label="Кухня">
            <input
              value={cuisine}
              onChange={(e) => setCuisine(e.target.value)}
              placeholder="Українська, італійська, азійська…"
              className={INPUT}
            />
          </Field>
        </Panel>

        {/* Параметри */}
        <Panel>
          <PanelHeader label="Параметри" />
          <div className={STEPPER_ROW}>
            <span className="min-w-0 flex-1 text-[14px] font-semibold">Час, хв</span>
            <NumberInput value={timeMin} onChange={setTimeMin} min={1} max={600} step={5} />
          </div>
          <div className={STEPPER_ROW}>
            <span className="min-w-0 flex-1 text-[14px] font-semibold">Порцій</span>
            <NumberInput value={servings} onChange={setServings} min={1} max={20} step={1} />
          </div>

          <div className="flex flex-col gap-2 border-t border-line px-3.5 pb-3 pt-2.5">
            <span className="text-[14px] font-semibold">Складність</span>
            {/* Значення з префіксом: у двох перемикачів однакові «1,2,3», а
                повзунок Segmented шукає свій перемикач саме за значеннями. */}
            <Segmented
              value={`d${difficulty}`}
              onChange={(v) => setDifficulty(Number(v.slice(1)) as 1 | 2 | 3)}
              className="bg-bg-elev"
              options={([1, 2, 3] as const).map((d) => ({
                value: `d${d}`,
                label: ["", "Просто", "Середньо", "Складно"][d],
              }))}
            />
          </div>

          <div className="flex min-h-[52px] items-center gap-2 border-t border-line py-2 pl-3.5 pr-2">
            <span className="min-w-0 flex-1 text-[14px] font-semibold">Бюджет</span>
            <Segmented
              value={`c${costLevel}`}
              onChange={(v) => setCostLevel(Number(v.slice(1)) as 1 | 2 | 3)}
              className="w-[176px] shrink-0 bg-bg-elev"
              options={([1, 2, 3] as const).map((c) => ({ value: `c${c}`, label: "₴".repeat(c) }))}
            />
          </div>

          {/* Калорій руками більше не просимо: ШІ рахує їх точніше, бо читає й кроки. */}
          <p className="border-t border-line px-3.5 py-2.5 text-[11.5px] font-semibold leading-relaxed text-faint">
            {isSupabaseConfigured
              ? "Калорії й БЖВ порахує ШІ за складом і кроками — щойно рецепт збережеться."
              : "Калорії й БЖВ порахуються самі — зі складу рецепта."}
          </p>
        </Panel>

        {/* Чим страва є на столі — від цього залежать і фільтри, і підказки
            «до цього підійде…». Одне значення, а не набір: страва не буває
            одночасно гарніром і супом. */}
        <Panel>
          <PanelHeader label="Що це за страва" />
          <div className={PILLS}>
            {COURSE_ORDER.map((c) => (
              <Pill key={c} active={course === c} onClick={() => setCourse(c)}>
                {COURSE_LABEL[c]}
              </Pill>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader label="Коли це їдять" />
          <div className={PILLS}>
            {MEALS.map((m) => (
              <Pill
                key={m}
                active={mealTypes.includes(m)}
                onClick={() => toggle(mealTypes, m, setMealTypes)}
              >
                {MEAL_LABEL[m]}
              </Pill>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader label="Настрій страви" />
          <div className={PILLS}>
            {MOODS.map((m) => (
              <Pill key={m} active={moods.includes(m)} onClick={() => toggle(moods, m, setMoods)}>
                <span>{MOOD_META[m].emoji}</span>
                {MOOD_META[m].label}
              </Pill>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader label="Теги" aside={tags.length || undefined} />
          {tags.length > 0 && (
            <div className={PILLS}>
              {tags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTags((p) => p.filter((x) => x !== t))}
                  className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-surface-2 pl-2.5 pr-1.5 text-[12.5px] font-bold active:bg-line"
                >
                  {t}
                  <X size={13} strokeWidth={2.4} className="text-faint" />
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5">
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagDraft.trim()) {
                  setTags((p) => [...new Set([...p, tagDraft.trim()])]);
                  setTagDraft("");
                }
              }}
              placeholder="швидко, на компанію, без духовки…"
              className="h-10 min-w-0 flex-1 rounded-[8px] bg-surface-2 px-3 text-[14px] font-semibold placeholder:text-faint"
            />
            <button
              aria-label="Додати тег"
              onClick={() => {
                haptic(10);
                if (!tagDraft.trim()) return;
                setTags((p) => [...new Set([...p, tagDraft.trim()])]);
                setTagDraft("");
              }}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-surface-2 text-brand active:bg-line"
            >
              <Plus size={17} strokeWidth={2.4} />
            </button>
          </div>
        </Panel>

        {/* Інгредієнти */}
        <Panel>
          <PanelHeader label="Інгредієнти" aside={ingredients.length || undefined} />

          {ingredients.length === 0 ? (
            <button
              onClick={() => setPickerOpen(true)}
              className="flex w-full flex-col items-center gap-1 border-t border-line px-6 py-5 text-center active:bg-surface-2"
            >
              <span className="text-[14px] font-bold">Додай перший інгредієнт</span>
              <span className="text-[12px] font-semibold leading-snug text-faint">
                Це потрібно, щоб рецепт зʼявлявся в підборі за холодильником
              </span>
              <span className="mt-1 text-[11.5px] font-semibold text-brand">
                Або скануй штрихкод — калорії підтягнуться з етикетки
              </span>
            </button>
          ) : (
            <AnimatePresence initial={false}>
              {ingredients.map((item, i) => {
                const def = ing(item.key);
                return (
                  <motion.div
                    key={item.key}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden border-t border-line"
                  >
                    <div className="flex flex-col gap-2 py-2.5 pl-3.5 pr-2">
                      {/* Назва — окремим рядком: поруч із кількістю й кнопками
                          їй лишалось кілька літер. */}
                      <div className="flex min-h-6 items-center gap-2.5 pr-1.5">
                        <span className="w-6 shrink-0 text-center text-[18px] leading-none">
                          {item.label ? "🏷️" : def.emoji}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                          {item.label ?? def.label}
                        </span>
                        {item.nutrition && (
                          <span className="shrink-0 text-[11.5px] font-bold text-brand">
                            {item.nutrition.kcal} ккал/100 г
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <QuantityInput
                          amount={item.amount}
                          unit={item.unit}
                          defaultUnit={def.defaultUnit}
                          label={item.label ?? def.label}
                          onChange={({ amount, unit }) =>
                            setIngredients((prev) =>
                              prev.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      amount,
                                      unit,
                                      // Старий вільний текст більше не потрібен, щойно
                                      // зʼявились число й одиниця — інакше вони конфліктують.
                                      qty: undefined,
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        <button
                          onClick={() =>
                            setIngredients((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, optional: !x.optional } : x)),
                            )
                          }
                          aria-label="За бажанням"
                          aria-pressed={!!item.optional}
                          title="За бажанням"
                          className={cn(
                            "h-9 shrink-0 rounded-[8px] px-2.5 text-[12px] font-bold transition-colors",
                            item.optional ? "bg-brand/15 text-brand" : "bg-surface-2 text-faint",
                          )}
                        >
                          за бажанням
                        </button>
                        <button
                          onClick={() => setIngredients((prev) => prev.filter((_, j) => j !== i))}
                          aria-label="Прибрати"
                          className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-faint active:bg-surface-2"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}

          <button
            onClick={() => {
              haptic(10);
              setPickerOpen(true);
            }}
            className={ACTION_ROW}
          >
            <Plus size={16} strokeWidth={2.4} className="text-brand" />
            <span className="flex-1 text-[14px] font-bold text-brand">Додати інгредієнт</span>
          </button>
          <div className={cn("grid gap-px border-t border-line bg-line", hasPantry ? "grid-cols-2" : "grid-cols-1")}>
            <button
              disabled={scanBusy}
              onClick={() => {
                haptic(10);
                setScanOpen(true);
              }}
              className={GRID_ACTION}
            >
              {scanBusy ? <Spinner className="h-4 w-4" /> : <ScanBarcode size={16} className="text-muted" />}
              Сканувати
            </button>
            {hasPantry && (
              <button
                onClick={() => {
                  haptic(10);
                  setFridgeOpen(true);
                }}
                className={GRID_ACTION}
              >
                <Refrigerator size={16} className="text-muted" />
                З холодильника
              </button>
            )}
          </div>
        </Panel>

        {/* Кроки */}
        <Panel>
          <PanelHeader label="Кроки приготування" aside={steps.length} />
          {/*
            Порядок кроків міняється перетягуванням за ручку праворуч. Саме за
            ручку, а не за картку: усередині текстові поля, і тягнути треба
            вміти так, щоб при цьому можна було й слово виділити.
          */}
          <Reorder.Group
            axis="y"
            values={steps}
            onReorder={setSteps}
            className="flex flex-col"
          >
            {steps.map((step, i) => (
              <StepCard
                key={step.uid}
                step={step}
                index={i}
                removable={steps.length > 1}
                onChange={(patch) =>
                  setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))
                }
                onRemove={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </Reorder.Group>

          <button
            onClick={() => {
              haptic(10);
              setSteps((p) => [...p, { uid: newId(), text: "" }]);
            }}
            className={ACTION_ROW}
          >
            <Plus size={16} strokeWidth={2.4} className="text-brand" />
            <span className="flex-1 text-[14px] font-bold text-brand">Додати крок</span>
          </button>
        </Panel>
      </div>

      {/* Збереження. Відступ під виріз і видимий відступ — на різних
          елементах: разом вони сперечалися б за padding-bottom. */}
      <div className="pad-safe-b fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[560px] border-t md:left-[92px] md:max-w-[720px] border-line bg-bg/90 backdrop-blur-md">
        <div className="px-4 pb-4 pt-3">
          <motion.button
            whileTap={{ scale: !valid || saving ? 1 : 0.95 }}
            transition={{ type: "spring", stiffness: 520, damping: 28 }}
            disabled={!valid || saving}
            onClick={() => {
              haptic(10);
              save();
            }}
            className="flex h-[52px] w-full select-none items-center justify-center gap-2 rounded-[12px] brand-gradient px-4 text-[15.5px] font-extrabold text-brand-ink shadow-[0_14px_36px_-12px_rgb(255_107_53_/_0.6)] disabled:opacity-45 disabled:shadow-none"
          >
            {saving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                <Check size={19} strokeWidth={2.6} />
                {editId ? "Зберегти зміни" : "Опублікувати рецепт"}
              </>
            )}
          </motion.button>
          {!valid && (
            <p className="mt-2 text-center text-[11.5px] font-semibold text-faint">
              Потрібні назва, хоча б один інгредієнт і один крок
            </p>
          )}
        </div>
      </div>

      {/* Вибір стилю обкладинки */}
      <Sheet open={styleOpen} onClose={() => setStyleOpen(false)} title="Стиль обкладинки">
        <div className="pb-4">
          <h3 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-[0.07em] text-faint">Емодзі</h3>
          <div className="grid grid-cols-8 gap-1.5">
            {FOOD_EMOJI.map((e) => (
              <button
                key={e}
                onClick={() => {
                  haptic(8);
                  setEmoji(e);
                }}
                aria-pressed={emoji === e}
                className={cn(
                  "grid aspect-square place-items-center rounded-[8px] text-2xl",
                  emoji === e ? "bg-brand/15 ring-[1.5px] ring-brand" : "bg-surface-2",
                )}
              >
                {e}
              </button>
            ))}
          </div>

          <h3 className="mb-2 mt-5 px-1 text-[11px] font-extrabold uppercase tracking-[0.07em] text-faint">
            Градієнт
          </h3>
          <div className="grid grid-cols-4 gap-1.5">
            {GRADIENTS.map((g) => (
              <button
                key={g.join()}
                onClick={() => {
                  haptic(8);
                  setGradient(g);
                }}
                aria-pressed={gradient.join() === g.join()}
                style={{ backgroundImage: `linear-gradient(140deg, ${g[0]}, ${g[1]})` }}
                className={cn(
                  "aspect-[3/2] rounded-[8px]",
                  gradient.join() === g.join() && "ring-2 ring-ink ring-offset-2 ring-offset-bg-elev",
                )}
              />
            ))}
          </div>
        </div>
      </Sheet>

      {/* Вибір інгредієнта */}
      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetect={onScanned}
      />

      <FridgePicker
        open={fridgeOpen}
        onClose={() => setFridgeOpen(false)}
        existing={ingredients}
        onPick={(items) => {
          setIngredients((p) => [...p, ...items]);
          toast(`Додано з холодильника: ${items.length}`, "🧊");
        }}
      />

      <IngredientPicker
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setPickerQuery("");
        }}
        query={pickerQuery}
        onQueryChange={setPickerQuery}
        exclude={ingredients.map((i) => i.key)}
        onPick={(key) => {
          haptic(10);
          // Одиниця за замовчуванням залежить від продукту: молоко в мл,
          // яйця в штуках, борошно в грамах — щоб не перемикати щоразу.
          setIngredients((p) => [...p, { key, unit: ing(key).defaultUnit ?? "g" }]);
        }}
        onCreate={(name) => {
          setPickerOpen(false);
          setPickerQuery("");
          setCreating(name);
        }}
      />

      {/* Продукт, якого в каталозі не було */}
      <NewIngredientSheet
        open={creating !== null}
        initialName={creating ?? ""}
        onClose={() => setCreating(null)}
        onCreated={(def, { existing }) => {
          setIngredients((p) => [
            ...p,
            {
              key: def.key,
              unit: def.defaultUnit ?? "g",
              // Назву дублюємо в сам рецепт: він їде у спільноту, і якщо опис
              // продукту чомусь не долетить, рядок покаже «Кокосове борошно»,
              // а не сирий ключ.
              label: def.label,
              nutrition: def.nutrition,
            },
          ]);
          // Обрали наявний тип замість нового — каталог той самий, змінився лише рецепт.
          toast(existing ? `«${def.label}» у рецепті` : `«${def.label}» тепер у каталозі`, "📦");
        }}
      />
    </div>
  );
}

/* ── Допоміжні ────────────────────────────────────────────────────────── */

/** Крок у формі. `uid` живе лише тут — щоб React не плутав кроки місцями. */
type FormStep = RecipeStep & { uid: string };

/**
 * Крок рецепта з ручкою для перенесення.
 *
 * Окремим компонентом не заради ладу, а тому, що кожному перетягуваному
 * елементу потрібні власні керування: тягнути можна лише за ручку, інакше
 * спроба виділити слово в тексті кроку зсувала б сам крок.
 */
function StepCard({
  step,
  index,
  removable,
  onChange,
  onRemove,
}: {
  step: FormStep;
  index: number;
  removable: boolean;
  onChange: (patch: Partial<RecipeStep>) => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={step}
      dragListener={false}
      dragControls={controls}
      // relative і власне тло: перетягуваний крок пливе поверх сусідів, а не крізь них.
      className="relative border-t border-line bg-surface py-3 pl-3.5 pr-1.5"
    >
      <div className="flex items-start gap-3">
        <span className="mt-2 grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-surface-2 text-[12px] font-extrabold text-brand">
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <textarea
            value={step.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder={`Що робимо на кроці ${index + 1}?`}
            rows={2}
            className="w-full resize-none rounded-[8px] bg-surface-2 px-3 py-2.5 text-[14px] leading-[1.5] placeholder:text-faint"
          />

          <div className="flex items-center gap-1.5">
            <TimerInput seconds={step.timerSec} onChange={(timerSec) => onChange({ timerSec })} />
            {removable && (
              <button
                onClick={onRemove}
                aria-label={`Видалити крок ${index + 1}`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-surface-2 text-faint active:bg-line"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>

          <input
            value={step.tip ?? ""}
            onChange={(e) => onChange({ tip: e.target.value || undefined })}
            placeholder="💡 Порада до кроку (необовʼязково)"
            className="h-9 w-full rounded-[8px] bg-surface-2 px-3 text-[13px] font-semibold placeholder:text-faint"
          />
        </div>

        <button
          onPointerDown={(e) => {
            haptic(8);
            controls.start(e);
          }}
          aria-label={`Перенести крок ${index + 1}`}
          // touch-none обовʼязкове: інакше браузер вважає рух пальця
          // прокруткою сторінки й перетягування не починається зовсім.
          className="mt-1 grid h-9 w-7 shrink-0 cursor-grab touch-none place-items-center text-faint active:cursor-grabbing"
        >
          <GripVertical size={16} />
        </button>
      </div>
    </Reorder.Item>
  );
}

/**
 * Таймер кроку: число плюс міра.
 *
 * Зберігаємо завжди в секундах, а показуємо в тій мірі, яка в цьому числі
 * читається найкраще: година лишається годиною, а не «60 хв», і навпаки —
 * сорок секунд не перетворюються на дріб. Хвилини за замовчуванням, бо в
 * рецептах їх майже завжди й пишуть.
 */
function TimerInput({
  seconds,
  onChange,
}: {
  seconds?: number;
  onChange: (seconds: number | undefined) => void;
}) {
  const guess = (value?: number): TimerUnit => {
    if (!value) return "min";
    if (value % 3600 === 0) return "hour";
    if (value % 60 === 0) return "min";
    return "sec";
  };

  const [unit, setUnit] = useState<TimerUnit>(() => guess(seconds));
  const size = TIMER_UNITS[unit];
  const shown = seconds ? String(Math.round((seconds / size) * 100) / 100) : "";

  return (
    <div className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-[8px] bg-surface-2 pl-2.5">
      <Timer size={14} className="shrink-0 text-muted" />
      <input
        value={shown}
        onChange={(e) => {
          const raw = Number(e.target.value.replace(/[^\d]/g, ""));
          onChange(raw > 0 ? raw * size : undefined);
        }}
        inputMode="numeric"
        placeholder="таймер"
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-semibold placeholder:text-faint"
      />
      <select
        value={unit}
        onChange={(e) => {
          const next = e.target.value as TimerUnit;
          // Число лишається тим самим, міняється його міра: «5 хв» на
          // перемиканні стає «5 год», а не «300 год».
          const value = seconds ? Math.round(seconds / size) : 0;
          setUnit(next);
          if (value > 0) onChange(value * TIMER_UNITS[next]);
        }}
        aria-label="Міра таймера"
        className="h-full shrink-0 rounded-r-[8px] bg-surface-2 px-2 text-[12px] font-bold text-muted"
      >
        <option value="sec">сек</option>
        <option value="min">хв</option>
        <option value="hour">год</option>
      </select>
    </div>
  );
}

/* Класи рядків панелей — однакові для всіх секцій форми. */
const INPUT =
  "h-11 w-full rounded-[8px] bg-surface-2 px-3 text-[15px] font-semibold placeholder:text-faint";
const STEPPER_ROW = "flex h-[52px] items-center gap-2 border-t border-line pl-3.5 pr-2";
const PILLS = "flex flex-wrap gap-1.5 border-t border-line px-3.5 py-3";
const ACTION_ROW =
  "flex h-12 w-full items-center gap-2.5 border-t border-line px-3.5 text-left active:bg-surface-2";
const GRID_ACTION =
  "flex h-11 items-center justify-center gap-2 bg-surface text-[13.5px] font-bold active:bg-surface-2 disabled:opacity-45";
const STEP_BUTTON =
  "grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-surface-2 active:bg-line";

/** Поле рядком панелі: підпис над ним. `label` — щоб натиск на підпис ставив курсор у поле. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 border-t border-line px-3.5 pb-3 pt-2.5">
      <span className="text-[12px] font-bold text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Чип вибору в групі: «Вечеря», «🌶️ Гостре». */
function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={() => {
        haptic(8);
        onClick();
      }}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 select-none items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px] font-bold transition-colors",
        active ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface text-muted",
      )}
    >
      {children}
    </motion.button>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={() => {
          haptic(8);
          onChange(Math.max(min, value - step));
        }}
        aria-label="Менше"
        className={STEP_BUTTON}
      >
        <Minus size={16} strokeWidth={2.4} />
      </button>
      <input
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          onChange(Math.min(max, Math.max(min, n || min)));
        }}
        inputMode="numeric"
        className="h-8 w-[56px] bg-transparent text-center text-[15px] font-extrabold"
      />
      <button
        onClick={() => {
          haptic(8);
          onChange(Math.min(max, value + step));
        }}
        aria-label="Більше"
        className={STEP_BUTTON}
      >
        <Plus size={16} strokeWidth={2.4} />
      </button>
    </div>
  );
}

function IngredientPicker({
  open,
  onClose,
  onPick,
  onCreate,
  exclude,
  query,
  onQueryChange,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (key: string) => void;
  /** Створити продукт, якого в каталозі немає. */
  onCreate: (name: string) => void;
  exclude: string[];
  query: string;
  onQueryChange: (v: string) => void;
}) {
  const list = useMemo(() => {
    const base = query.trim() ? searchIngredients(query) : allIngredients();
    // Обʼєднаний дописаний тип — лише псевдонім переможця: у рецепт кладемо переможця.
    return base.filter((d) => !exclude.includes(d.key) && !d.mergedInto);
  }, [query, exclude]);

  const grouped = useMemo(() => {
    const map = new Map<IngredientCat, IngredientDef[]>();
    for (const d of list) map.set(d.cat, [...(map.get(d.cat) ?? []), d]);
    return CAT_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [list]);

  return (
    <Sheet open={open} onClose={onClose} title="Додати інгредієнт">
      <div className="sticky top-0 z-10 -mx-5 mb-2 bg-bg-elev px-5 pb-3">
        <div className="flex h-[46px] items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5">
          <Search size={18} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Пошук продукту…"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-semibold placeholder:text-faint"
          />
        </div>
      </div>

      {query.trim() && (
        <button
          onClick={() => {
            onCreate(query.trim());
            onQueryChange("");
            onClose();
          }}
          className="mb-2.5 flex min-h-[54px] w-full items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-2 text-left active:bg-surface-2"
        >
          <span className="w-[22px] shrink-0 text-lg leading-none">📦</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold text-brand">
              Створити «{query.trim()}»
            </span>
            <span className="block text-[11.5px] font-semibold text-faint">
              Свій продукт — з мірою й калоріями
            </span>
          </span>
          <Plus size={16} strokeWidth={2.4} className="shrink-0 text-brand" />
        </button>
      )}

      {list.length === 0 ? (
        <p className="py-8 text-center text-[13px] font-semibold text-muted">
          Нічого не знайшлось — але продукт можна створити рядком вище
        </p>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <h3 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-[0.07em] text-faint">
                {CAT_LABEL[cat]}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {items.map((def) => {
                  const own = isOwnKey(def.key);
                  const pick = (
                    <button
                      key={def.key}
                      onClick={() => {
                        onPick(def.key);
                        // Продукт уже в списку — рядок пошуку більше не потрібен,
                        // а з ним наступний продукт довелось би шукати крізь
                        // залишки попереднього запиту.
                        onQueryChange("");
                      }}
                      className={
                        own
                          ? "inline-flex h-9 items-center gap-1.5 pl-3 pr-1 text-[13px] font-semibold"
                          : "inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-semibold active:bg-surface-2"
                      }
                    >
                      <span>{def.emoji}</span>
                      {def.label}
                      <Plus size={13} strokeWidth={2.4} className="text-brand" />
                    </button>
                  );
                  /*
                   * Дописаний тип із хибним батьком виправляють просто тут, де
                   * його й створили, — не чекаючи, поки хтось покладе його в комору.
                   */
                  return own ? (
                    <span
                      key={def.key}
                      className="inline-flex h-9 items-center rounded-[8px] border border-line bg-surface pr-1 active:bg-surface-2"
                    >
                      {pick}
                      <EditTypeButton typeKey={def.key} icon />
                    </span>
                  ) : (
                    pick
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
