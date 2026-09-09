"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  Check,
  GripVertical,
  ImagePlus,
  Plus,
  Search,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Button, Card, Chip, Sheet, useToast } from "@/components/ui";
import { CAT_LABEL, CAT_ORDER, INGREDIENTS, ing, searchIngredients } from "@/data/ingredients";
import { recipeById, useApp } from "@/lib/store";
import type {
  IngredientCat,
  MealType,
  Mood,
  Recipe,
  RecipeIngredient,
  RecipeStep,
  Unit,
} from "@/lib/types";
import { UNIT_GROUPS, unitLabel } from "@/lib/units";
import { compressImage, haptic, MEAL_LABEL, MOOD_META, newId } from "@/lib/utils";

const EMOJIS = [
  "🍲", "🍝", "🍜", "🥗", "🍕", "🍔", "🌮", "🍣", "🥘", "🍛",
  "🥞", "🍳", "🥟", "🍚", "🍰", "🥧", "🍪", "🥤", "🫕", "🥙",
];

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
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [gradient, setGradient] = useState<[string, string]>(GRADIENTS[0]);
  const [image, setImage] = useState<string | null>(null);
  const [cuisine, setCuisine] = useState("Домашня");
  const [mealTypes, setMealTypes] = useState<MealType[]>(["dinner"]);
  const [moods, setMoods] = useState<Mood[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [timeMin, setTimeMin] = useState(30);
  const [servings, setServings] = useState(2);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(1);
  const [costLevel, setCostLevel] = useState<1 | 2 | 3>(1);
  const [kcal, setKcal] = useState("");
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [steps, setSteps] = useState<RecipeStep[]>([{ text: "" }]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [styleOpen, setStyleOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Завантаження рецепта для редагування
  useEffect(() => {
    if (!hydrated || loaded) return;
    if (editId) {
      const r = recipeById(state, editId);
      if (r) {
        setTitle(r.title);
        setDescription(r.description);
        setEmoji(r.emoji);
        setGradient(r.gradient);
        setImage(r.image ?? null);
        setCuisine(r.cuisine);
        setMealTypes(r.mealTypes);
        setMoods(r.moods);
        setTags(r.tags);
        setTimeMin(r.timeMin);
        setServings(r.servings);
        setDifficulty(r.difficulty);
        setCostLevel(r.costLevel);
        setKcal(r.kcal ? String(r.kcal) : "");
        setIngredients(r.ingredients);
        setSteps(r.steps.length ? r.steps : [{ text: "" }]);
      }
    }
    setLoaded(true);
  }, [hydrated, editId, loaded, state]);

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

    const cleanSteps = steps.filter((s) => s.text.trim());
    const base = {
      title: title.trim(),
      description: description.trim() || "Без опису — але точно смачно.",
      emoji,
      gradient,
      image,
      cuisine: cuisine.trim() || "Домашня",
      mealTypes: mealTypes.length ? mealTypes : (["dinner"] as MealType[]),
      moods,
      tags,
      timeMin,
      servings,
      difficulty,
      costLevel,
      kcal: kcal ? Number(kcal) : undefined,
      ingredients,
      steps: cleanSteps,
    };

    if (editId && recipeById(state, editId)) {
      state.updateRecipe(editId, base);
      toast("Рецепт оновлено", "✅");
      router.replace(`/recipe/${editId}`);
    } else {
      const recipe: Recipe = {
        ...base,
        id: newId(),
        authorId: state.profile.id,
        createdAt: new Date().toISOString(),
        stats: { likes: 0, saves: 0, cooks: 0, ratingSum: 0, ratingCount: 0 },
        mine: true,
      };
      state.addRecipe(recipe);
      toast("Рецепт додано в галерею", "🎉");
      router.replace(`/recipe/${recipe.id}`);
    }
  };

  const toggle = <T,>(arr: T[], v: T, set: (v: T[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="pb-32">
      <TopBar
        title={editId ? "Редагувати рецепт" : "Новий рецепт"}
        subtitle={title || "Розкажи, що ти готуєш"}
      />

      {/* Обкладинка */}
      <section className="px-4 pt-4">
        <div
          className="relative aspect-[16/10] overflow-hidden rounded-xl3 border border-line"
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
            <div className="grid h-full place-items-center text-7xl">{emoji}</div>
          )}

          <div className="absolute inset-x-0 bottom-0 flex gap-2 bg-gradient-to-t from-black/70 to-transparent p-3">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-2xl bg-black/50 px-3 py-2 text-[12.5px] font-bold text-white backdrop-blur"
            >
              <Camera size={15} />
              {image ? "Змінити фото" : "Додати фото"}
            </button>
            <button
              onClick={() => setStyleOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl bg-black/50 px-3 py-2 text-[12.5px] font-bold text-white backdrop-blur"
            >
              <ImagePlus size={15} />
              Стиль
            </button>
            {image && (
              <button
                onClick={() => setImage(null)}
                aria-label="Прибрати фото"
                className="ml-auto grid h-9 w-9 place-items-center rounded-2xl bg-black/50 text-white backdrop-blur"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
      </section>

      {/* Основне */}
      <section className="px-4 pt-5">
        <Field label="Назва страви">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Наприклад: Паста з грибами"
            maxLength={70}
            className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px]"
          />
        </Field>

        <Field label="Короткий опис">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Чим ця страва особлива? Одне-два речення."
            rows={3}
            maxLength={220}
            className="w-full resize-none rounded-2xl border border-line bg-surface p-4 text-[15px] leading-relaxed"
          />
        </Field>

        <Field label="Кухня">
          <input
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
            placeholder="Українська, італійська, азійська…"
            className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px]"
          />
        </Field>
      </section>

      {/* Параметри */}
      <section className="px-4 pt-2">
        <Field label="Коли це їдять">
          <div className="flex flex-wrap gap-2">
            {MEALS.map((m) => (
              <Chip
                key={m}
                active={mealTypes.includes(m)}
                onClick={() => toggle(mealTypes, m, setMealTypes)}
              >
                {MEAL_LABEL[m]}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Настрій страви">
          <div className="flex flex-wrap gap-2">
            {MOODS.map((m) => (
              <Chip key={m} active={moods.includes(m)} onClick={() => toggle(moods, m, setMoods)}>
                <span>{MOOD_META[m].emoji}</span>
                {MOOD_META[m].label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Теги">
          <div className="mb-2 flex flex-wrap gap-2">
            {tags.map((t) => (
              <button
                key={t}
                onClick={() => setTags((p) => p.filter((x) => x !== t))}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-2 pl-3 pr-2 text-[13px] font-semibold"
              >
                {t}
                <X size={13} className="text-faint" />
              </button>
            ))}
          </div>
          <div className="flex gap-2">
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
              className="h-11 flex-1 rounded-2xl border border-line bg-surface px-4 text-[15px]"
            />
            <Button
              variant="secondary"
              className="w-12 px-0"
              aria-label="Додати тег"
              onClick={() => {
                if (!tagDraft.trim()) return;
                setTags((p) => [...new Set([...p, tagDraft.trim()])]);
                setTagDraft("");
              }}
            >
              <Plus size={18} />
            </Button>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <Field label="Час, хв">
            <NumberInput value={timeMin} onChange={setTimeMin} min={1} max={600} step={5} />
          </Field>
          <Field label="Порцій">
            <NumberInput value={servings} onChange={setServings} min={1} max={20} step={1} />
          </Field>
        </div>

        <Field label="Складність">
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((d) => (
              <Chip key={d} active={difficulty === d} onClick={() => setDifficulty(d)}>
                {["", "Просто", "Середньо", "Складно"][d]}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Бюджет">
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((c) => (
              <Chip key={c} active={costLevel === c} onClick={() => setCostLevel(c)}>
                {"₴".repeat(c)}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Калорії на порцію (необовʼязково)">
          <input
            value={kcal}
            onChange={(e) => setKcal(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="350"
            className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px]"
          />
        </Field>
      </section>

      {/* Інгредієнти */}
      <section className="px-4 pt-4">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="font-display text-[16px] font-bold">
            Інгредієнти{ingredients.length > 0 && ` · ${ingredients.length}`}
          </h2>
          <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
            <Plus size={15} />
            Додати
          </Button>
        </div>

        {ingredients.length === 0 ? (
          <button
            onClick={() => setPickerOpen(true)}
            className="w-full rounded-xl3 border border-dashed border-line bg-surface/40 p-6 text-center"
          >
            <p className="text-[13.5px] font-semibold">Додай перший інгредієнт</p>
            <p className="mt-1 text-[12px] text-muted">
              Це потрібно, щоб рецепт зʼявлявся в підборі за холодильником
            </p>
          </button>
        ) : (
          <Card className="divide-y divide-line p-0">
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
                    className="flex items-center gap-2.5 px-3 py-2.5"
                  >
                    <span className="text-lg">{def.emoji}</span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                      {def.label}
                    </span>
                    <input
                      value={item.amount ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.replace(",", ".");
                        const amount = raw === "" ? undefined : Number(raw);
                        setIngredients((prev) =>
                          prev.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  amount: Number.isFinite(amount) ? amount : undefined,
                                  // Старий вільний текст більше не потрібен, щойно
                                  // зʼявились число й одиниця — інакше вони конфліктують.
                                  qty: undefined,
                                }
                              : x,
                          ),
                        );
                      }}
                      inputMode="decimal"
                      placeholder="200"
                      disabled={item.unit === "taste"}
                      className="h-9 w-[62px] rounded-xl bg-surface-2 px-2 text-center text-[13px] disabled:opacity-40"
                    />
                    <select
                      value={item.unit ?? def.defaultUnit ?? "g"}
                      onChange={(e) =>
                        setIngredients((prev) =>
                          prev.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  unit: e.target.value as Unit,
                                  amount: e.target.value === "taste" ? undefined : x.amount,
                                  qty: undefined,
                                }
                              : x,
                          ),
                        )
                      }
                      aria-label={`Одиниця для ${def.label}`}
                      className="h-9 w-[76px] shrink-0 rounded-xl bg-surface-2 px-1.5 text-center text-[12px] font-semibold"
                    >
                      {UNIT_GROUPS.map((group) => (
                        <optgroup key={group.title} label={group.title}>
                          {group.units.map((u) => (
                            <option key={u} value={u}>
                              {unitLabel(u)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        setIngredients((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, optional: !x.optional } : x)),
                        )
                      }
                      aria-label="За бажанням"
                      title="За бажанням"
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[10px] font-extrabold ${
                        item.optional ? "bg-brand/20 text-brand" : "bg-surface-2 text-faint"
                      }`}
                    >
                      опц
                    </button>
                    <button
                      onClick={() => setIngredients((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Прибрати"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-faint"
                    >
                      <Trash2 size={15} />
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </Card>
        )}
      </section>

      {/* Кроки */}
      <section className="px-4 pt-6">
        <h2 className="mb-2.5 font-display text-[16px] font-bold">Кроки приготування</h2>
        <div className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <Card key={i} className="p-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full brand-gradient text-[12px] font-extrabold text-brand-ink">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <textarea
                    value={step.text}
                    onChange={(e) =>
                      setSteps((prev) =>
                        prev.map((s, j) => (j === i ? { ...s, text: e.target.value } : s)),
                      )
                    }
                    placeholder={`Що робимо на кроці ${i + 1}?`}
                    rows={2}
                    className="w-full resize-none rounded-xl bg-surface-2 p-3 text-[14px] leading-relaxed"
                  />

                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex h-9 flex-1 items-center gap-1.5 rounded-xl bg-surface-2 px-2.5">
                      <Timer size={14} className="shrink-0 text-muted" />
                      <input
                        value={step.timerSec ? String(Math.round(step.timerSec / 60)) : ""}
                        onChange={(e) => {
                          const min = Number(e.target.value.replace(/\D/g, ""));
                          setSteps((prev) =>
                            prev.map((s, j) =>
                              j === i ? { ...s, timerSec: min ? min * 60 : undefined } : s,
                            ),
                          );
                        }}
                        inputMode="numeric"
                        placeholder="таймер, хв"
                        className="h-full w-full text-[13px]"
                      />
                    </div>
                    {steps.length > 1 && (
                      <button
                        onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                        aria-label="Видалити крок"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-faint"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>

                  <input
                    value={step.tip ?? ""}
                    onChange={(e) =>
                      setSteps((prev) =>
                        prev.map((s, j) =>
                          j === i ? { ...s, tip: e.target.value || undefined } : s,
                        ),
                      )
                    }
                    placeholder="💡 Порада до кроку (необовʼязково)"
                    className="mt-2 h-9 w-full rounded-xl bg-surface-2 px-3 text-[13px]"
                  />
                </div>
                <GripVertical size={16} className="mt-2 shrink-0 text-faint" />
              </div>
            </Card>
          ))}
        </div>

        <Button
          variant="secondary"
          full
          className="mt-3"
          onClick={() => {
            haptic(10);
            setSteps((p) => [...p, { text: "" }]);
          }}
        >
          <Plus size={17} />
          Додати крок
        </Button>
      </section>

      {/* Збереження */}
      <div className="pad-safe-b fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[560px] glass border-t border-line p-4">
        <Button full size="lg" disabled={!valid} loading={saving} onClick={save}>
          <Check size={19} />
          {editId ? "Зберегти зміни" : "Опублікувати рецепт"}
        </Button>
        {!valid && (
          <p className="mt-2 text-center text-[11.5px] text-muted">
            Потрібні назва, хоча б один інгредієнт і один крок
          </p>
        )}
      </div>

      {/* Вибір стилю обкладинки */}
      <Sheet open={styleOpen} onClose={() => setStyleOpen(false)} title="Стиль обкладинки">
        <div className="pb-4">
          <h3 className="mb-2.5 text-[12px] font-bold uppercase tracking-wide text-muted">Емодзі</h3>
          <div className="grid grid-cols-8 gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  haptic(8);
                  setEmoji(e);
                }}
                className={`grid aspect-square place-items-center rounded-2xl text-2xl ${
                  emoji === e ? "bg-brand/20 ring-2 ring-brand" : "bg-surface-2"
                }`}
              >
                {e}
              </button>
            ))}
          </div>

          <h3 className="mb-2.5 mt-5 text-[12px] font-bold uppercase tracking-wide text-muted">
            Градієнт
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {GRADIENTS.map((g) => (
              <button
                key={g.join()}
                onClick={() => {
                  haptic(8);
                  setGradient(g);
                }}
                style={{ backgroundImage: `linear-gradient(140deg, ${g[0]}, ${g[1]})` }}
                className={`aspect-[3/2] rounded-2xl ${
                  gradient.join() === g.join() ? "ring-2 ring-ink ring-offset-2 ring-offset-bg" : ""
                }`}
              />
            ))}
          </div>
        </div>
      </Sheet>

      {/* Вибір інгредієнта */}
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
      />
    </div>
  );
}

/* ── Допоміжні ────────────────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pb-4">
      <label className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-muted">
        {label}
      </label>
      {children}
    </div>
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
    <div className="flex h-12 items-center rounded-2xl border border-line bg-surface px-2">
      <button
        onClick={() => {
          haptic(8);
          onChange(Math.max(min, value - step));
        }}
        aria-label="Менше"
        className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 text-lg font-bold"
      >
        −
      </button>
      <input
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          onChange(Math.min(max, Math.max(min, n || min)));
        }}
        inputMode="numeric"
        className="h-full min-w-0 flex-1 text-center text-[16px] font-bold"
      />
      <button
        onClick={() => {
          haptic(8);
          onChange(Math.min(max, value + step));
        }}
        aria-label="Більше"
        className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 text-lg font-bold"
      >
        +
      </button>
    </div>
  );
}

function IngredientPicker({
  open,
  onClose,
  onPick,
  exclude,
  query,
  onQueryChange,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (key: string) => void;
  exclude: string[];
  query: string;
  onQueryChange: (v: string) => void;
}) {
  const list = useMemo(() => {
    const base = query.trim() ? searchIngredients(query) : INGREDIENTS;
    return base.filter((d) => !exclude.includes(d.key));
  }, [query, exclude]);

  const grouped = useMemo(() => {
    const map = new Map<IngredientCat, typeof INGREDIENTS>();
    for (const d of list) map.set(d.cat, [...(map.get(d.cat) ?? []), d]);
    return CAT_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [list]);

  return (
    <Sheet open={open} onClose={onClose} title="Додати інгредієнт">
      <div className="sticky top-0 z-10 -mx-5 mb-2 bg-bg-elev px-5 pb-3">
        <div className="flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5">
          <Search size={17} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Пошук продукту…"
            className="h-full flex-1 text-[15px]"
          />
        </div>
      </div>

      {list.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">Нічого не знайшлось</p>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-muted">
                {CAT_LABEL[cat]}
              </h3>
              <div className="flex flex-wrap gap-2">
                {items.map((def) => (
                  <button
                    key={def.key}
                    onClick={() => onPick(def.key)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-2 px-3 text-[13px] font-semibold active:bg-surface-2"
                  >
                    <span>{def.emoji}</span>
                    {def.label}
                    <Plus size={13} className="text-brand" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
