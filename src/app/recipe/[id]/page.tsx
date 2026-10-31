"use client";

import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  Star,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useNow } from "@/components/CookingHost";
import { DrinkPicks, PairingSuggestions } from "@/components/Pairings";
import { RecipeMedia, RecipeRow } from "@/components/RecipeCard";
import {
  Avatar,
  Button,
  EmptyState,
  formatKcal,
  Panel,
  PanelHeader,
  Sheet,
  Stars,
  useToast,
} from "@/components/ui";
import { canonicalKey, ing, satisfies } from "@/data/ingredients";
import type { Product } from "@/lib/product-types";
import type { PantryItem, Recipe, RecipeComment } from "@/lib/types";
import { endSession, isStarted, timerLeft, timersByUrgency, useCooking } from "@/lib/cooking";
import { matchRecipe } from "@/lib/matching";
import { availableFor } from "@/lib/pantry";
import { itemsForRecipe } from "@/lib/shopping";
import { useFoodFlows } from "@/components/diary/useFoodFlows";
import { mealFromRecipe, slotAt } from "@/lib/diary";
import {
  allRecipes,
  diaryUserId,
  effectiveStats,
  pantryTypes,
  profileById,
  recipeById,
  useApp,
} from "@/lib/store";
import {
  avgRating,
  cn,
  compactNumber,
  plural,
  formatClock,
  formatMinutes,
  haptic,
  newId,
  timeAgo,
} from "@/lib/utils";
import * as api from "@/lib/supabase/api";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { recipeCost } from "@/lib/cost";
import { recipeNutrition } from "@/lib/nutrition";
import { formatSummed, ingredientQtyLabel } from "@/lib/units";

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
  /*
   * Що є — разом із загальнішими типами: безлактозне молоко закриває
   * «Молоко» в складі. Селектор кешований на масив комори й версію каталогу,
   * тож новий батько в дописаному типі перераховує збіг без перезапуску.
   */
  const have = useApp(pantryTypes);
  const customIngredients = useApp((s) => s.customIngredients);
  /*
   * Картки товарів — для «є 1,9 л»: штучна пачка рахується у грами через свою
   * картку, тож підпис міняється, коли картка приїхала чи змінилась.
   */
  const products = useApp((s) => s.products);
  const toggleLike = useApp((s) => s.toggleLike);
  const toggleSave = useApp((s) => s.toggleSave);
  const toggleFollow = useApp((s) => s.toggleFollow);
  const deleteRecipe = useApp((s) => s.deleteRecipe);
  const rate = useApp((s) => s.rate);
  const addShopping = useApp((s) => s.addShopping);
  const hydrated = useApp((s) => s.hydrated);
  const account = useApp((s) => s.account);
  const toast = useToast();
  // «Зʼїв»: страва з рецепта і поділ на тих, хто їв, — як після готування.
  const flows = useFoodFlows();
  /** Готування цього рецепта, яке почали й не закінчили (src/lib/cooking.ts). */
  const cooking = useCooking((s) => s.sessions[params.id]);
  const cookTimer = cooking ? timersByUrgency(cooking)[0] : undefined;
  const cookNow = useNow(cookTimer?.timer.deadline != null, 500);

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

  // Калорії для метрик угорі — ті самі, що в картці «На порцію».
  const nutrition = useMemo(
    () => (recipe ? recipeNutrition(recipe) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recipe, customIngredients],
  );

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

  const match = matchRecipe(recipe, have);

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

  const following = followingIds.includes(author.id);
  const haveCount = recipe.ingredients.length - match.missing.length;
  const kcal = nutrition ? Math.round(nutrition.perServing.kcal) : null;

  const addMissing = () => {
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
  };

  return (
    <div className="pb-8 lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:pb-0">
      {/* Герой: на планшеті — ліва колонка на всю висоту, що не гортається */}
      <div className="relative lg:sticky lg:top-4 lg:m-4 lg:mr-0 lg:h-[calc(100dvh-32px)] lg:overflow-hidden lg:rounded-[16px]">
        <RecipeMedia
          recipe={recipe}
          className="h-[300px] w-full lg:h-full"
          rounded="rounded-none"
          emojiSize="text-[110px] lg:text-[140px]"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[90px] lg:hidden"
          style={{ backgroundImage: "linear-gradient(180deg, transparent, var(--bg))" }}
        />

        <div className="pad-safe-t absolute inset-x-0 top-0 flex items-center gap-2 px-4 pt-2.5">
          <button onClick={() => router.back()} aria-label="Назад" className={HERO_BUTTON}>
            <ChevronLeft size={20} strokeWidth={2.2} />
          </button>
          <span className="flex-1" />
          <button onClick={share} aria-label="Поділитись" className={HERO_BUTTON}>
            <Share2 size={17} />
          </button>
          <button
            onClick={() => {
              haptic(14);
              toggleSave(recipe.id);
              toast(saved ? "Прибрано зі збережених" : "Збережено", "🔖");
            }}
            aria-label={saved ? "Прибрати зі збережених" : "Зберегти"}
            aria-pressed={saved}
            className={HERO_BUTTON}
          >
            <Bookmark size={18} className={saved ? "fill-current" : ""} />
          </button>
        </div>
      </div>

      <div className="relative -mt-[18px] flex flex-col gap-2.5 px-4 md:px-6 lg:mt-0 lg:min-w-0 lg:gap-3 lg:pb-4 lg:pl-[22px] lg:pt-4">
        {/* Заголовок */}
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[22px] font-bold leading-[1.25] lg:text-[28px] lg:font-extrabold lg:leading-[1.15]">
            {recipe.title}
          </h1>
          <div className="flex items-center gap-2">
            <Link
              href={isMine ? "/me" : `/u/${author.id}`}
              className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] font-semibold text-muted"
            >
              <Avatar emoji={author.emoji} gradient={author.gradient} src={author.avatar} size={22} />
              <span className="truncate">
                {author.name}
                {recipe.cuisine ? ` · ${recipe.cuisine}` : ""}
              </span>
            </Link>
            {!isMine && (
              <button
                onClick={() => {
                  haptic(10);
                  toggleFollow(author.id);
                  toast(following ? "Відписано" : `Підписка на ${author.name}`, "👋");
                }}
                className={cn(
                  "h-7 shrink-0 rounded-[8px] px-2.5 text-[12px] font-extrabold",
                  following ? "bg-surface-2 text-muted" : "bg-brand/15 text-brand",
                )}
              >
                {following ? "Стежу" : "Стежити"}
              </button>
            )}
          </div>
          {recipe.description && (
            <p className="text-[13.5px] leading-relaxed text-muted">{recipe.description}</p>
          )}
          {/* Копіювати рецепти більше не можна: чужий рецепт зберігають, а не
              розмножують. Підпис лишається заради копій, зроблених раніше. */}
          {recipe.sourceId && (
            <p className="text-[12px] font-semibold text-faint">
              Копія рецепта —{" "}
              <Link href={`/recipe/${recipe.sourceId}`} className="font-bold text-brand">
                оригінал тут
              </Link>
            </p>
          )}
        </div>

        {/* Метрики */}
        <Panel className="grid grid-cols-4">
          <Metric value={formatMinutes(recipe.timeMin)} label="час" />
          <Metric value={kcal != null ? String(kcal) : "—"} label="ккал" />
          <Metric
            value={rating > 0 ? `★ ${rating.toFixed(1).replace(".", ",")}` : "—"}
            label={`${compactNumber(stats.ratingCount)} ${plural(stats.ratingCount, "оцінка", "оцінки", "оцінок")}`}
            onClick={() => setRateOpen(true)}
          />
          <Metric value={String(recipe.ingredients.length)} label="продуктів" />
        </Panel>

        {/* Дії: оцінка і «зʼїв» */}
        <Panel className="grid grid-cols-2 gap-px bg-line">
          <button
            onClick={() => setRateOpen(true)}
            className="flex h-11 items-center justify-center gap-2 bg-surface text-[13.5px] font-bold active:bg-surface-2"
          >
            <Star size={16} className={myRating ? "fill-brand-2 text-brand-2" : "text-muted"} />
            {myRating ? `Твоя оцінка ${myRating}` : "Оцінити"}
          </button>
          <button
            onClick={() => {
              haptic(10);
              flows.split({
                meal: mealFromRecipe(recipe, {
                  id: newId(),
                  ownerId: diaryUserId({ account }),
                  cookedAt: new Date().toISOString(),
                }),
                isNew: true,
                source: "cook",
                slot: slotAt(),
                // Без готування за кроками — тож що було в тарілці, людина скаже тут.
                portionEdit: true,
              });
            }}
            className="flex h-11 items-center justify-center gap-2 bg-surface text-[13.5px] font-bold active:bg-surface-2"
          >
            <UtensilsCrossed size={16} className="text-muted" />
            Зʼїв — у щоденник
          </button>
        </Panel>

        {/* Інгредієнти */}
        <Panel>
          <div className="flex h-[46px] items-center gap-2 pl-3.5 pr-2">
            <span className="flex-1 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">
              Інгредієнти
              {pantryItems.length > 0 && ` · є ${haveCount} з ${recipe.ingredients.length}`}
            </span>
            <button
              onClick={() => {
                haptic(8);
                setServings(Math.max(1, currentServings - 1));
              }}
              aria-label="Менше порцій"
              className={STEP_BUTTON}
            >
              <Minus size={15} strokeWidth={2.4} />
            </button>
            <span className="w-16 text-center text-[13px] font-extrabold">
              {currentServings} {plural(currentServings, "порція", "порції", "порцій")}
            </span>
            <button
              onClick={() => {
                haptic(8);
                setServings(Math.min(20, currentServings + 1));
              }}
              aria-label="Більше порцій"
              className={STEP_BUTTON}
            >
              <Plus size={15} strokeWidth={2.4} />
            </button>
          </div>
          <div className="lg:grid lg:grid-cols-2">
          {recipe.ingredients.map((item) => {
            const def = ing(item.key);
            // Базове позначається наявним лише тоді, коли воно справді в коморі.
            const inStock = have.has(canonicalKey(item.key));
            const stockNote = inStock ? pantryNote(item.key, pantryItems, products) : "";
            // Різновид називаємо: інакше людина шукала б звичайне молоко, якого немає.
            const variant = stockNote.startsWith("є:") ? stockNote : "";
            return (
              <div
                key={item.key}
                title={stockNote || undefined}
                className="flex min-h-[46px] items-center gap-3 border-t border-line px-3.5 py-2 lg:even:border-l"
              >
                <span
                  className={cn(
                    "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px]",
                    inStock ? "border-brand bg-brand text-brand-ink" : "border-line-strong",
                  )}
                >
                  {inStock && <Check size={11} strokeWidth={3.5} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[14px] font-semibold", inStock ? "text-ink" : "text-muted")}>
                    {item.label ?? def.label}
                    {item.optional && <span className="ml-1.5 text-[11px] font-semibold text-faint">за бажанням</span>}
                  </span>
                  {variant && <span className="block truncate text-[11px] font-semibold text-faint">{variant}</span>}
                </span>
                <span className="shrink-0 text-[12.5px] font-bold text-muted">{ingredientQtyLabel(item, factor)}</span>
              </div>
            );
          })}
          </div>
          {match.missing.length > 0 && (
            <button
              onClick={addMissing}
              className="flex h-12 w-full items-center gap-2.5 border-t border-line px-3.5 text-left active:bg-surface-2"
            >
              <Plus size={16} strokeWidth={2.4} className="text-brand" />
              <span className="flex-1 text-[14px] font-bold text-brand">Відсутнє — у список покупок</span>
              <span className="text-[12px] font-bold text-faint">{match.missing.length}</span>
            </button>
          )}
        </Panel>

        {/* Кроки */}
        <Panel>
          <PanelHeader label="Кроки" aside={recipe.steps.length} />
          {recipe.steps.map((step, i) => (
            <div key={i} className="flex gap-3 border-t border-line px-3.5 py-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-surface-2 text-[12px] font-extrabold text-brand">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] leading-[1.5] text-ink/85">{step.text}</p>
                {step.tip && (
                  <p className="mt-1.5 text-[12.5px] leading-snug text-muted">💡 {step.tip}</p>
                )}
                {step.timerSec && (
                  <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-bold text-brand">
                    <Clock size={11} />
                    {Math.round(step.timerSec / 60)} хв
                  </p>
                )}
              </div>
            </div>
          ))}
        </Panel>

        {/* Харчова цінність і ціна */}
        <NutritionCard recipe={recipe} servings={currentServings} />
        <CostCard recipe={recipe} servings={currentServings} />
        <PairingSuggestions recipe={recipe} />
        <DrinkPicks recipe={recipe} />

        {/* Керування власним рецептом */}
        {isMine && (
          <Panel>
            <Link
              href={`/new?edit=${recipe.id}`}
              className="flex h-12 items-center gap-2.5 px-3.5 active:bg-surface-2"
            >
              <Pencil size={16} className="text-muted" />
              <span className="flex-1 text-[14px] font-semibold">Редагувати рецепт</span>
              <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
            </Link>
            <button
              onClick={() => {
                if (confirm(`Видалити «${recipe.title}»?`)) {
                  deleteRecipe(recipe.id);
                  toast("Рецепт видалено", "🗑️");
                  router.push("/me");
                }
              }}
              className="flex h-12 w-full items-center gap-2.5 border-t border-line px-3.5 text-left active:bg-surface-2"
            >
              <Trash2 size={16} className="text-berry" />
              <span className="flex-1 text-[14px] font-semibold text-berry">Видалити рецепт</span>
            </button>
          </Panel>
        )}

        <CommentsSection recipe={recipe} />

        {/* Схожі */}
        {similar.length > 0 && (
          <Panel>
            <PanelHeader label="Схожі страви" />
            {similar.map((r) => (
              <RecipeRow key={r.id} recipe={r} href={`/recipe/${r.id}`} flat />
            ))}
          </Panel>
        )}

        {/*
          Липка кнопка «Готувати». Готування, яке лишили посеред кроків, —
          «Продовжити» з тим самим кроком і таймерами; поруч «скинути», щоб
          почати наново. Над панеллю «готуєш зараз», якщо вона є (--cook-dock).
        */}
        <div
          className="fixed inset-x-0 z-30 mx-auto flex w-full max-w-[560px] gap-2 px-4 md:left-[92px] md:max-w-[720px] md:px-6 lg:sticky lg:inset-x-auto lg:mx-0 lg:mt-1 lg:max-w-none lg:px-0 bottom-[calc(84px_+_env(safe-area-inset-bottom)_+_var(--cook-dock,0px))] md:bottom-[calc(16px_+_var(--cook-dock,0px))] lg:bottom-4"
        >
          <button
            onClick={() => {
              haptic(14);
              toggleLike(recipe.id);
            }}
            aria-label={liked ? "Прибрати вподобання" : "Вподобати"}
            aria-pressed={liked}
            className={cn(
              "grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[12px] border border-line-strong bg-surface-2",
              liked ? "text-brand" : "text-ink",
            )}
          >
            <Heart size={20} className={liked ? "fill-current" : ""} />
          </button>
          <Link
            href={`/recipe/${recipe.id}/cook`}
            onClick={() => haptic(12)}
            className="flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-[12px] px-4 brand-gradient text-[15.5px] font-extrabold text-brand-ink shadow-[0_14px_36px_-12px_rgb(255_107_53_/_0.6)]"
          >
            {cooking && isStarted(cooking) ? (
              <span className="truncate">
                Продовжити
                {cooking.step >= 0 ? ` · крок ${cooking.step + 1}` : ""}
                {cookTimer &&
                  (cookTimer.timer.rangAt != null
                    ? " · час вийшов"
                    : ` · ${formatClock(timerLeft(cookTimer.timer, cookNow))}`)}
              </span>
            ) : (
              "Почати готувати"
            )}
          </Link>
          {cooking && isStarted(cooking) && (
            <button
              className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[12px] border border-line-strong bg-surface-2"
              aria-label="Скинути готування й почати спочатку"
              onClick={() => {
                const timers = Object.keys(cooking.timers).length;
                const note = timers > 0 ? " Таймери цього рецепта зупиняться." : "";
                if (!confirm(`Скинути готування «${recipe.title}»?${note}`)) return;
                endSession(recipe.id);
                toast("Готування скинуто", "↩️");
              }}
            >
              <RotateCcw size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="h-20 lg:hidden" />

      {flows.ui}

      {/* Оцінка */}
      <Sheet open={rateOpen} onClose={() => setRateOpen(false)} title="Оціни страву">
        <div className="flex flex-col items-center gap-4 py-4">
          <p className="text-center text-[13.5px] text-muted">Наскільки вдалася «{recipe.title}»?</p>
          <Stars
            value={myRating ?? 0}
            size={34}
            onChange={(v) => {
              rate(recipe.id, v);
              toast("Дякуємо за оцінку", "⭐");
              setTimeout(() => setRateOpen(false), 420);
            }}
          />
          {myRating && <p className="text-[12px] text-muted">Твоя поточна оцінка: {myRating} з 5</p>}
        </div>
      </Sheet>
    </div>
  );
}

const HERO_BUTTON =
  "grid h-[38px] w-[38px] place-items-center rounded-[10px] bg-[rgb(8_8_10_/_0.55)] text-white backdrop-blur-md";
const STEP_BUTTON = "grid h-[30px] w-[30px] place-items-center rounded-[8px] bg-surface-2 active:bg-line";

function Metric({ value, label, onClick }: { value: string; label: string; onClick?: () => void }) {
  const cls = "flex min-w-0 flex-col items-center gap-[3px] py-2.5 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-line";
  const inner = (
    <>
      <span className="max-w-full truncate px-1 text-[15px] font-extrabold">{value}</span>
      <span className="max-w-full truncate px-1 text-[11px] font-semibold text-faint">{label}</span>
    </>
  );
  return onClick ? (
    <button onClick={onClick} className={cn(cls, "active:bg-surface-2")}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/**
 * Калорії та БЖВ: від ШІ, а поки його числа немає — з інгредієнтів.
 *
 * Під числом кажемо, звідки воно: у ШІ — з головним припущенням («олії
 * лишилась половина»), у довідника — з покриттям. Якщо половина складу без
 * даних, число оманливе, і чесніше сказати про це, ніж робити вигляд точності.
 */
function NutritionCard({ recipe, servings }: { recipe: Recipe; servings: number }) {
  // КБЖВ дописаного різновиду без власних чисел береться з батька — з каталогу.
  const customIngredients = useApp((s) => s.customIngredients);
  const n = useMemo(() => recipeNutrition(recipe), [recipe, customIngredients]);
  if (!n) return null;

  const per = {
    kcal: Math.round(n.perServing.kcal),
    protein: Math.round(n.perServing.protein * 10) / 10,
    fat: Math.round(n.perServing.fat * 10) / 10,
    carbs: Math.round(n.perServing.carbs * 10) / 10,
  };
  const low = n.coverage < 0.6;
  // Рецепт у базі — отже, ШІ його порахує (чи вже рахує); демо-набір без бекенду — ні.
  const aiPending = n.source === "catalog" && isSupabaseConfigured && api.isUuid(recipe.id);

  return (
    <Panel>
      <div className="flex h-9 items-center justify-between px-3.5">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">На порцію</span>
        <span className="text-[13px] font-extrabold">{formatKcal(per.kcal)} ккал</span>
      </div>
      <div className="grid grid-cols-3 gap-2.5 border-t border-line px-3.5 py-3">
        <MacroCell label="Білки" color="var(--macro-protein)" value={per.protein} />
        <MacroCell label="Жири" color="var(--macro-fat)" value={per.fat} />
        <MacroCell label="Вуглеводи" color="var(--macro-carbs)" value={per.carbs} />
      </div>
      <p className="border-t border-line px-3.5 py-2.5 text-[11px] font-semibold leading-relaxed text-faint">
        {servings} {plural(servings, "порція", "порції", "порцій")} · {formatKcal(per.kcal * servings)} ккал разом.{" "}
        {n.source === "ai" ? (
          <>
            Порахував ШІ за складом і кроками.
            {n.note && ` ${n.note}`}
          </>
        ) : (
          <>
            {aiPending
              ? "Поки це оцінка за довідником — ШІ порахує точніше за складом і кроками."
              : low
                ? `Оцінка приблизна: пораховано лише ${Math.round(n.coverage * 100)}% складу.`
                : "Оцінка за довідковими даними, без утрат при готуванні."}
            {aiPending && low && ` Пораховано лише ${Math.round(n.coverage * 100)}% складу.`}
            {n.skipped.length > 0 && ` Без даних: ${n.skipped.slice(0, 4).join(", ")}.`}
          </>
        )}
      </p>
    </Panel>
  );
}

function MacroCell({ label, color, value }: { label: string; color: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-[5px] text-[11.5px] font-bold text-muted">
        <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: color }} />
        {label}
      </span>
      <span className="text-[15px] font-extrabold">{String(value).replace(".", ",")} г</span>
    </div>
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
  useApp((s) => s.remoteProfiles);

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
    <Panel>
      <PanelHeader label="Враження" aside={comments?.length || undefined} />
      <div className="border-t border-line px-3.5 py-2.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
          rows={2}
          placeholder="Як вийшло? Що змінив би наступного разу?"
          className="w-full resize-none bg-transparent text-[14px] leading-relaxed"
        />
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold text-faint">{draft.length}/1000</span>
          <Button size="sm" onClick={send} disabled={!draft.trim()} loading={sending}>
            Надіслати
          </Button>
        </div>
      </div>

      {comments === null ? (
        <p className="border-t border-line px-3.5 py-3 text-[12.5px] font-semibold text-muted">Читаю коментарі…</p>
      ) : comments.length === 0 ? (
        <p className="border-t border-line px-3.5 py-3 text-[12.5px] font-semibold text-muted">
          Ще ніхто не писав. Приготуєш — розкажи, як вийшло.
        </p>
      ) : (
        comments.map((comment) => {
          const author = profileById(useApp.getState(), comment.authorId);
          // Прибрати може той, хто написав, і автор рецепта у себе під стравою.
          const canRemove = comment.authorId === account.id || recipe.authorId === profile.id;

          return (
            <div key={comment.id} className="flex gap-2.5 border-t border-line px-3.5 py-3">
              <Avatar emoji={author.emoji} gradient={author.gradient} src={author.avatar} size={32} />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2 text-[13px] font-bold">
                  <span className="truncate">{author.name}</span>
                  <span className="shrink-0 text-[11px] font-semibold text-faint">{timeAgo(comment.createdAt)}</span>
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink/85">
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
            </div>
          );
        })
      )}
    </Panel>
  );
}

/**
 * Підпис під рядком складу, коли потрібне вдома є: «є в коморі · 1,9 л».
 *
 * Якщо є лише різновид — називаємо саме його («є: Молоко безлактозне»):
 * інакше людина шукала б у холодильнику звичайне молоко, якого там немає.
 */
function pantryNote(needKey: string, pantry: PantryItem[], products: Record<string, Product>): string {
  const need = canonicalKey(needKey);
  const exact = pantry.some((p) => canonicalKey(p.key) === need);
  // Разом по всіх пачках, що годяться: Галичина 900 мл + Молокія 1 л — «1,9 л».
  const amount = formatSummed(availableFor(needKey, pantry, products));
  if (exact) return amount ? `є в коморі · ${amount}` : "є в коморі";
  const variants = [...new Set(pantry.filter((p) => satisfies(p.key, need)).map((p) => p.key))];
  const names = variants.map((key) => ing(key).label).join(", ");
  return amount ? `є: ${names} · ${amount}` : `є: ${names}`;
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
  // Ціну дає і рядок-різновид, а родовід живе в каталозі дописаних.
  const customIngredients = useApp((s) => s.customIngredients);
  // Грами штучної пачки знає її картка товару — без неї ціна грама не порахується.
  const products = useApp((s) => s.products);
  const cost = useMemo(
    () => recipeCost(recipe, pantry, products),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recipe, pantry, products, customIngredients],
  );
  if (!cost || cost.coverage < 0.34) return null;

  const partial = cost.coverage < 0.95;
  const perServing = Math.round(cost.perServing);
  const total = Math.round(cost.perServing * servings);

  return (
    <Panel>
      <div className="flex h-9 items-center justify-between px-3.5">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">Скільки коштує</span>
        <span className="text-[13px] font-extrabold">
          {partial && "від "}
          {perServing} ₴ / порція
        </span>
      </div>
      {cost.top.map((part) => (
        <div key={part.key} className="flex h-11 items-center gap-2.5 border-t border-line px-3.5">
          <span className="text-[17px]">{ing(part.key).emoji}</span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{ing(part.key).label}</span>
          <span className="shrink-0 text-[12.5px] font-bold text-muted">
            {part.cost < 10 ? part.cost.toFixed(1).replace(".", ",") : Math.round(part.cost)} ₴
          </span>
        </div>
      ))}
      <p className="border-t border-line px-3.5 py-2.5 text-[11px] font-semibold leading-relaxed text-faint">
        {servings} {plural(servings, "порція", "порції", "порцій")} · {total} ₴ разом. За цінами з твоїх чеків.{" "}
        {partial
          ? `Ціни відомі для ${Math.round(cost.coverage * 100)}% складу — решту не враховано.`
          : "Ціни відомі для всього складу."}
      </p>
    </Panel>
  );
}
