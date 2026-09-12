"use client";

import { motion } from "framer-motion";
import {
  Bookmark,
  ChefHat,
  ChevronLeft,
  Clock,
  Flame,
  Heart,
  Minus,
  Pencil,
  Plus,
  Share2,
  ShoppingBasket,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DrinkPicks, PairingSuggestions } from "@/components/Pairings";
import { RecipeMedia, RecipeRow } from "@/components/RecipeCard";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Sheet,
  Stars,
  useToast,
} from "@/components/ui";
import { ing } from "@/data/ingredients";
import type { Recipe, RecipeComment } from "@/lib/types";
import { matchRecipe } from "@/lib/matching";
import { itemsForRecipe } from "@/lib/shopping";
import {
  allRecipes,
  effectiveStats,
  profileById,
  recipeById,
  useApp,
} from "@/lib/store";
import {
  avgRating,
  compactNumber,
  plural,
  DIFFICULTY_LABEL,
  formatMinutes,
  haptic,
  MEAL_LABEL,
  MOOD_META,
  timeAgo,
} from "@/lib/utils";
import * as api from "@/lib/supabase/api";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { recipeCost } from "@/lib/cost";
import { macroShares, recipeNutrition } from "@/lib/nutrition";
import { ingredientQtyLabel } from "@/lib/units";

export default function RecipePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);
  const remoteProfiles = useApp((s) => s.remoteProfiles);
  const profile = useApp((s) => s.profile);
  const likes = useApp((s) => s.likes);
  const saves = useApp((s) => s.saved);
  const ratings = useApp((s) => s.ratings);
  const followingIds = useApp((s) => s.following);
  const pantryItems = useApp((s) => s.pantry);
  const toggleLike = useApp((s) => s.toggleLike);
  const toggleSave = useApp((s) => s.toggleSave);
  const toggleFollow = useApp((s) => s.toggleFollow);
  const deleteRecipe = useApp((s) => s.deleteRecipe);
  const rate = useApp((s) => s.rate);
  const addShopping = useApp((s) => s.addShopping);
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const [servings, setServings] = useState<number | null>(null);
  const [rateOpen, setRateOpen] = useState(false);

  const recipe = recipeById(useApp.getState(), params.id);

  const similar = useMemo(() => {
    if (!recipe) return [];
    return allRecipes(useApp.getState())
      .filter(
        (r) =>
          r.id !== recipe.id &&
          (r.cuisine === recipe.cuisine ||
            r.moods.some((m) => recipe.moods.includes(m))),
      )
      .slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id, myRecipes, remoteRecipes]);

  // Власні рецепти живуть у localStorage — до рехідрації їх ще не видно.
  if (!recipe && !hydrated) return <div className="min-h-dvh" />;

  if (!recipe) {
    return (
      <div>
        <EmptyState
          emoji="🍽️"
          title="Рецепт не знайдено"
          note="Можливо, його видалили або посилання застаріло."
          action={<Button onClick={() => router.push("/")}>На головну</Button>}
        />
      </div>
    );
  }

  const author = profileById(useApp.getState(), recipe.authorId);
  const stats = effectiveStats(useApp.getState(), recipe);
  const rating = avgRating({ ...recipe, stats });
  const myRating = ratings[recipe.id];
  const liked = likes.includes(recipe.id);
  const saved = saves.includes(recipe.id);
  const isMine = !!recipe.mine || recipe.authorId === profile.id;

  const currentServings = servings ?? recipe.servings;
  const factor = currentServings / recipe.servings;

  const pantry = new Set(pantryItems.map((p) => p.key));
  const match = matchRecipe(recipe, pantry);

  const share = async () => {
    haptic(12);
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({
          title: recipe.title,
          text: recipe.description,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        toast("Посилання скопійовано", "🔗");
      }
    } catch {
      /* користувач скасував */
    }
  };

  return (
    <div className="pb-8">
      {/* Герой */}
      <div className="relative">
        <RecipeMedia
          recipe={recipe}
          className="aspect-[4/3] w-full"
          rounded="rounded-none"
          emojiSize="text-8xl"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-32"
          style={{
            backgroundImage: "linear-gradient(to top, var(--bg), transparent)",
          }}
        />

        <div className="pad-safe-t absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <button
            onClick={() => router.back()}
            aria-label="Назад"
            className="grid h-11 w-11 place-items-center rounded-2xl bg-black/40 text-white backdrop-blur-md"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="flex gap-2">
            <button
              onClick={share}
              aria-label="Поділитись"
              className="grid h-11 w-11 place-items-center rounded-2xl bg-black/40 text-white backdrop-blur-md"
            >
              <Share2 size={18} />
            </button>
            <button
              onClick={() => {
                haptic(14);
                toggleSave(recipe.id);
                toast(
                  saved ? "Прибрано зі збережених" : "Збережено в галерею",
                  "🔖",
                );
              }}
              aria-label="Зберегти"
              className={`grid h-11 w-11 place-items-center rounded-2xl backdrop-blur-md ${
                saved
                  ? "brand-gradient text-brand-ink"
                  : "bg-black/40 text-white"
              }`}
            >
              <Bookmark size={18} className={saved ? "fill-current" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Заголовок */}
      <div className="relative -mt-6 px-4">
        <div className="flex flex-wrap gap-1.5">
          {recipe.mealTypes.map((m) => (
            <span
              key={m}
              className="rounded-full bg-brand/15 px-2.5 py-1 text-[11px] font-bold text-brand"
            >
              {MEAL_LABEL[m]}
            </span>
          ))}
          {recipe.moods.slice(0, 2).map((m) => (
            <span
              key={m}
              className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-muted"
            >
              {MOOD_META[m]?.emoji} {MOOD_META[m]?.label}
            </span>
          ))}
        </div>

        <h1 className="mt-3 font-display text-[26px] font-extrabold leading-tight">
          {recipe.title}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          {recipe.description}
        </p>

        {/* Автор */}
        <div className="mt-4 flex items-center gap-3">
          <Link
            href={isMine ? "/me" : `/u/${author.id}`}
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <Avatar
              emoji={author.emoji}
              gradient={author.gradient}
              src={author.avatar}
              size={40}
            />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-bold">{author.name}</p>
              <p className="truncate text-[11.5px] text-muted">
                @{author.handle}
              </p>
            </div>
          </Link>
          {!isMine && (
            <Button
              size="sm"
              variant={
                followingIds.includes(author.id) ? "secondary" : "primary"
              }
              onClick={() => {
                toggleFollow(author.id);
                toast(
                  followingIds.includes(author.id)
                    ? "Відписано"
                    : `Підписка на ${author.name}`,
                  "👋",
                );
              }}
            >
              {followingIds.includes(author.id)
                ? "Ви підписані"
                : "Підписатись"}
            </Button>
          )}
        </div>

        {/* Метрики */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          <Metric
            icon={<Clock size={15} />}
            value={formatMinutes(recipe.timeMin)}
            label="час"
          />
          <Metric
            icon={<ChefHat size={15} />}
            value={DIFFICULTY_LABEL[recipe.difficulty]}
            label="складність"
          />
          <Metric
            icon={<Star size={15} />}
            value={rating > 0 ? rating.toFixed(1) : "—"}
            label={`${compactNumber(stats.ratingCount)} оцінок`}
          />
          <Metric
            icon={<Flame size={15} />}
            value={compactNumber(stats.cooks)}
            label="готували"
          />
        </div>

        {/* Соціальні дії */}
        <div className="mt-3 flex gap-2">
          <Button
            variant={liked ? "danger" : "secondary"}
            className="flex-1"
            onClick={() => {
              haptic(14);
              toggleLike(recipe.id);
            }}
          >
            <Heart size={17} className={liked ? "fill-current" : ""} />
            {compactNumber(stats.likes)}
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setRateOpen(true)}
          >
            <Star
              size={17}
              className={myRating ? "fill-brand-2 text-brand-2" : ""}
            />
            {myRating ? `Твоя оцінка ${myRating}` : "Оцінити"}
          </Button>
        </div>

        {/* Копіювати рецепти більше не можна: чужий рецепт зберігають, а не
            розмножують. Підпис лишається заради копій, зроблених раніше. */}
        {recipe.sourceId && (
          <p className="mt-2.5 text-[12px] text-muted">
            Копія рецепта{" "}
            <Link
              href={`/recipe/${recipe.sourceId}`}
              className="font-bold text-brand"
            >
              оригінал тут
            </Link>
          </p>
        )}
      </div>

      {/* Інгредієнти */}
      <section className="px-4 pt-7">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-[17px] font-bold">Інгредієнти</h2>
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-1">
            <button
              onClick={() => {
                haptic(8);
                setServings(Math.max(1, currentServings - 1));
              }}
              aria-label="Менше порцій"
              className="grid h-7 w-7 place-items-center rounded-full bg-surface-2"
            >
              <Minus size={13} />
            </button>
            <span className="flex items-center gap-1 px-1.5 text-[12.5px] font-bold">
              <Users size={12} />
              {currentServings}
            </span>
            <button
              onClick={() => {
                haptic(8);
                setServings(Math.min(20, currentServings + 1));
              }}
              aria-label="Більше порцій"
              className="grid h-7 w-7 place-items-center rounded-full bg-surface-2"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>

        {pantryItems.length > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 py-2.5">
            <span className="text-lg">{match.pct === 100 ? "✅" : "🧊"}</span>
            <p className="flex-1 text-[12.5px] leading-snug">
              {match.pct === 100 ? (
                <span className="font-bold text-mint">
                  Усе є в коморі — можна готувати
                </span>
              ) : (
                <>
                  Збіг з коморою{" "}
                  <span className="font-bold text-brand">{match.pct}%</span>,
                  бракує {match.missing.length}
                </>
              )}
            </p>
            <Link href="/pantry" className="text-[12px] font-bold text-brand">
              Комора
            </Link>
          </div>
        )}

        {match.missing.length > 0 && (
          <div className="mb-3">
            <Button
              full
              variant="secondary"
              onClick={() => {
                haptic(12);
                const items = itemsForRecipe(recipe, match.missing, factor);
                const { fresh, merged } = addShopping(items);
                toast(
                  fresh > 0
                    ? `${fresh} ${plural(fresh, "позиція", "позиції", "позицій")} у списку покупок`
                    : merged > 0
                      ? "Усе це вже в списку — кількості долито"
                      : "Усе це вже в списку покупок",
                  "🛒",
                );
              }}
            >
              <ShoppingBasket size={17} />
              Додати в список покупок · {match.missing.length}
            </Button>
            <p className="mt-1.5 text-center text-[11px] text-faint">
              Кількості — на {currentServings}{" "}
              {plural(currentServings, "порцію", "порції", "порцій")}
            </p>
          </div>
        )}

        <Card className="divide-y divide-line p-0">
          {recipe.ingredients.map((item) => {
            const def = ing(item.key);
            // Базове позначається наявним лише тоді, коли воно справді в коморі.
            const have = pantry.has(item.key);
            return (
              <div
                key={item.key}
                className="flex items-center gap-3 px-3.5 py-3"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-lg">
                  {item.label ? "🏷️" : def.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">
                    {item.label ?? def.label}
                    {item.optional && (
                      <span className="ml-1.5 text-[11px] font-normal text-faint">
                        (за бажанням)
                      </span>
                    )}
                  </p>
                  {pantryItems.length > 0 && (
                    <p
                      className={`text-[11px] ${have ? "text-mint" : "text-faint"}`}
                    >
                      {have
                        ? pantry.has(item.key)
                          ? "є в коморі"
                          : "базовий продукт"
                        : "треба купити"}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-[13px] font-bold text-muted">
                  {ingredientQtyLabel(item, factor)}
                </span>
              </div>
            );
          })}
        </Card>
      </section>

      {/* Харчова цінність */}
      <NutritionCard recipe={recipe} servings={currentServings} />
      <CostCard recipe={recipe} servings={currentServings} />
      <PairingSuggestions recipe={recipe} className="px-4" />
      <DrinkPicks recipe={recipe} className="px-4" />

      {/* Кроки */}
      <section className="px-4 pt-7">
        <h2 className="mb-3 font-display text-[17px] font-bold">
          Приготування · {recipe.steps.length} кроків
        </h2>
        <div className="flex flex-col gap-2.5">
          {recipe.steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3 }}
              className="flex gap-3 rounded-2xl border border-line bg-surface p-3.5"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full brand-gradient text-[12px] font-extrabold text-brand-ink">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-relaxed">{step.text}</p>
                {step.tip && (
                  <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-[12.5px] leading-snug text-muted">
                    💡 {step.tip}
                  </p>
                )}
                {step.timerSec && (
                  <p className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-bold text-brand">
                    <Clock size={11} />
                    {Math.round(step.timerSec / 60)} хв
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Керування власним рецептом */}
      {isMine && (
        <section className="px-4 pt-6">
          <div className="flex gap-2">
            <Link href={`/new?edit=${recipe.id}`} className="flex-1">
              <Button variant="secondary" full>
                <Pencil size={16} />
                Редагувати
              </Button>
            </Link>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm(`Видалити «${recipe.title}»?`)) {
                  deleteRecipe(recipe.id);
                  toast("Рецепт видалено", "🗑️");
                  router.push("/me");
                }
              }}
              className="w-12 px-0"
              aria-label="Видалити"
            >
              <Trash2 size={16} />
            </Button>
          </div>
        </section>
      )}

      <CommentsSection recipe={recipe} />

      {/* Схожі */}
      {similar.length > 0 && (
        <section className="px-4 pt-7">
          <h2 className="mb-3 font-display text-[17px] font-bold">
            Схожі страви
          </h2>
          <div className="flex flex-col gap-2.5">
            {similar.map((r) => (
              <RecipeRow key={r.id} recipe={r} href={`/recipe/${r.id}`} />
            ))}
          </div>
        </section>
      )}

      {/* Липка кнопка «Готувати» */}
      <div
        className="fixed inset-x-0 z-30 mx-auto w-full max-w-[560px] px-4"
        style={{ bottom: "calc(84px + env(safe-area-inset-bottom))" }}
      >
        <Link href={`/recipe/${recipe.id}/cook`}>
          <Button full size="lg" className="shadow-[var(--shadow-pop)]">
            <ChefHat size={19} />
            Готувати покроково
          </Button>
        </Link>
      </div>
      <div className="h-16" />

      {/* Оцінка */}
      <Sheet
        open={rateOpen}
        onClose={() => setRateOpen(false)}
        title="Оціни страву"
      >
        <div className="flex flex-col items-center gap-4 py-4">
          <p className="text-center text-[13.5px] text-muted">
            Наскільки вдалася «{recipe.title}»?
          </p>
          <Stars
            value={myRating ?? 0}
            size={34}
            onChange={(v) => {
              rate(recipe.id, v);
              toast("Дякуємо за оцінку", "⭐");
              setTimeout(() => setRateOpen(false), 420);
            }}
          />
          {myRating && (
            <p className="text-[12px] text-muted">
              Твоя поточна оцінка: {myRating} з 5
            </p>
          )}
        </div>
      </Sheet>
    </div>
  );
}

function Metric({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-2 py-2.5 text-center">
      <span className="mx-auto mb-1 grid w-fit place-items-center text-brand">
        {icon}
      </span>
      <p className="truncate text-[12.5px] font-bold leading-tight">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-muted">{label}</p>
    </div>
  );
}

/**
 * Калорії та БЖВ, пораховані з інгредієнтів.
 *
 * Показуємо разом із покриттям: якщо половина складу без даних, число
 * оманливе, і чесніше сказати про це, ніж робити вигляд точності.
 */
function NutritionCard({
  recipe,
  servings,
}: {
  recipe: Recipe;
  servings: number;
}) {
  const n = useMemo(() => recipeNutrition(recipe), [recipe]);
  if (!n) return null;

  const per = {
    kcal: Math.round(n.perServing.kcal),
    protein: Math.round(n.perServing.protein * 10) / 10,
    fat: Math.round(n.perServing.fat * 10) / 10,
    carbs: Math.round(n.perServing.carbs * 10) / 10,
  };
  const shares = macroShares(n.perServing);
  const low = n.coverage < 0.6;

  return (
    <section className="px-4 pt-7">
      <h2 className="mb-3 font-display text-[17px] font-bold">На порцію</h2>
      <Card className="p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-display text-[30px] font-extrabold leading-none">
              {per.kcal}
            </p>
            <p className="mt-1 text-[12px] text-muted">ккал у порції</p>
          </div>
          <p className="text-right text-[11.5px] leading-snug text-faint">
            {servings} {plural(servings, "порція", "порції", "порцій")} ·{" "}
            {Math.round(per.kcal * servings)} ккал разом
          </p>
        </div>

        {/* Смужка розподілу БЖВ за калоріями, а не за грамами:
            грам жиру дає вдвічі більше енергії за грам білка. */}
        <div className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full bg-surface-2">
          <div
            style={{
              width: `${shares.protein * 100}%`,
              background: "var(--macro-protein)",
            }}
            className="rounded-full"
          />
          <div
            style={{
              width: `${shares.fat * 100}%`,
              background: "var(--macro-fat)",
            }}
            className="rounded-full"
          />
          <div
            style={{
              width: `${shares.carbs * 100}%`,
              background: "var(--macro-carbs)",
            }}
            className="rounded-full"
          />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Macro label="Білки" value={per.protein} tone="text-macro-protein" />
          <Macro label="Жири" value={per.fat} tone="text-macro-fat" />
          <Macro label="Вуглеводи" value={per.carbs} tone="text-macro-carbs" />
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          {low
            ? `Оцінка приблизна: пораховано лише ${Math.round(n.coverage * 100)}% складу.`
            : "Оцінка за довідковими даними продуктів — без урахування втрат при готуванні."}
          {n.skipped.length > 0 &&
            ` Без даних: ${n.skipped.slice(0, 4).join(", ")}.`}
        </p>
      </Card>
    </section>
  );
}

/**
 * Враження тих, хто готував.
 *
 * Коментарі живуть у власному стані сторінки, а не в спільному сховищі: вони
 * стосуються одного рецепта, їх бувають сотні, і тягнути це все в
 * localStorage разом з усім іншим немає жодної причини.
 *
 * Без бази секції немає взагалі — у демо-режимі немає й людей, які могли б
 * щось написати.
 */
function CommentsSection({ recipe }: { recipe: Recipe }) {
  const account = useApp((s) => s.account);
  const profile = useApp((s) => s.profile);
  const remoteProfiles = useApp((s) => s.remoteProfiles);

  const [comments, setComments] = useState<RecipeComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!isSupabaseConfigured || !account) return;
    let alive = true;
    void api
      .fetchComments(recipe.id)
      .then((list) => alive && setComments(list))
      .catch(() => alive && setComments([]));
    return () => {
      alive = false;
    };
  }, [recipe.id, account]);

  if (!isSupabaseConfigured || !account) return null;

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const saved = await api.addComment(recipe.id, account.id, body);
      setComments((prev) => [saved, ...(prev ?? [])]);
      setDraft("");
      haptic(12);
    } catch {
      toast("Коментар не надіслався", "⚠️");
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    const kept = comments ?? [];
    setComments(kept.filter((c) => c.id !== id));
    try {
      await api.deleteComment(id);
    } catch {
      // Не вийшло — повертаємо на місце, щоб не вдавати, ніби видалено.
      setComments(kept);
      toast("Не вдалося видалити", "⚠️");
    }
  };

  return (
    <section className="px-4 pt-7">
      <h2 className="mb-3 font-display text-[17px] font-bold">
        Враження{comments?.length ? ` · ${comments.length}` : ""}
      </h2>

      <Card className="p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
          rows={2}
          placeholder="Як вийшло? Що змінив би наступного разу?"
          className="w-full resize-none bg-transparent text-[14px] leading-relaxed"
        />
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-[11px] text-faint">{draft.length}/1000</span>
          <Button
            size="sm"
            onClick={send}
            disabled={!draft.trim()}
            loading={sending}
          >
            Надіслати
          </Button>
        </div>
      </Card>

      {comments === null ? (
        <p className="mt-3 text-[12.5px] text-muted">Читаю коментарі…</p>
      ) : comments.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted">
          Ще ніхто не писав. Приготуєш — розкажи, як вийшло.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {comments.map((comment) => {
            const author = profileById(useApp.getState(), comment.authorId);
            // Прибрати може той, хто написав, і автор рецепта у себе під стравою.
            const canRemove =
              comment.authorId === account.id || recipe.authorId === profile.id;

            return (
              <Card key={comment.id} className="flex gap-2.5 p-3">
                <Avatar
                  emoji={author.emoji}
                  gradient={author.gradient}
                  src={author.avatar}
                  size={34}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2 text-[13px] font-bold">
                    <span className="truncate">{author.name}</span>
                    <span className="shrink-0 text-[11px] font-normal text-faint">
                      {timeAgo(comment.createdAt)}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
                    {comment.body}
                  </p>
                </div>
                {canRemove && (
                  <button
                    onClick={() => void remove(comment.id)}
                    aria-label="Прибрати коментар"
                    className="h-8 w-8 shrink-0 text-faint"
                  >
                    <Trash2 size={14} className="mx-auto" />
                  </button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Скільки страва коштує за цінами з твоїх чеків.
 *
 * Не «дешево / дорого» з картки рецепта — це рівень, який автор ставив на
 * око й для чужої кухні він майже нічого не означає. Тут гривні: з чека
 * відомо, скільки коштував кілограм саме цієї курки саме в тому магазині.
 *
 * Показуємо тільки тоді, коли ціни відомі бодай для третини складу, і
 * завжди пишемо, для якої частки. Число «12 ₴» при відомій чверті складу
 * гірше за відсутнє: воно виглядає точним.
 */
function CostCard({ recipe, servings }: { recipe: Recipe; servings: number }) {
  const pantry = useApp((s) => s.pantry);
  const cost = useMemo(() => recipeCost(recipe, pantry), [recipe, pantry]);
  if (!cost || cost.coverage < 0.34) return null;

  const partial = cost.coverage < 0.95;
  const perServing = Math.round(cost.perServing);
  const total = Math.round(cost.perServing * servings);

  return (
    <section className="px-4 pt-7">
      <h2 className="mb-3 font-display text-[17px] font-bold">
        Скільки коштує
      </h2>
      <Card className="p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-display text-[30px] font-extrabold leading-none">
              {partial && (
                <span className="text-[15px] font-bold text-muted">від </span>
              )}
              {perServing}{" "}
              <span className="text-[15px] font-bold text-muted">₴</span>
            </p>
            <p className="mt-1 text-[12px] text-muted">за порцію</p>
          </div>
          <p className="text-right text-[11.5px] leading-snug text-faint">
            {servings} {plural(servings, "порція", "порції", "порцій")} ·{" "}
            {total} ₴ разом
          </p>
        </div>

        {cost.top.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {cost.top.map((part) => (
              <div
                key={part.key}
                className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2"
              >
                <span className="text-base">{ing(part.key).emoji}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {ing(part.key).label}
                </span>
                <span className="shrink-0 text-[12.5px] font-bold text-muted">
                  {part.cost < 10
                    ? part.cost.toFixed(1)
                    : Math.round(part.cost)}{" "}
                  ₴
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          За цінами з твоїх чеків.{" "}
          {partial
            ? `Ціни відомі для ${Math.round(cost.coverage * 100)}% складу — решту не враховано.`
            : "Ціни відомі для всього складу."}
        </p>
      </Card>
    </section>
  );
}

function Macro({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-2xl bg-surface-2 py-2.5">
      <p
        className={`font-display text-[17px] font-extrabold leading-none ${tone}`}
      >
        {value} г
      </p>
      <p className="mt-1 text-[11px] text-muted">{label}</p>
    </div>
  );
}
