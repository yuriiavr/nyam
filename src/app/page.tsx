"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ChefHat, ChevronRight, Clock, Flame, Heart, Plus, Settings2, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useMemo } from "react";
import { cookPath, useNow } from "@/components/CookingHost";
import { FeedCard, RecipeMedia, RecipeScroller, TileBadge } from "@/components/RecipeCard";
import { Avatar, MacroGrid, Panel, PanelHeader, Skeleton, TILE_BUTTON, formatKcal } from "@/components/ui";
import { startedSessions, timerLeft, timersByUrgency, useCooking } from "@/lib/cooking";
import { allRecipes, cookStreak, diaryUserId, effectiveStats, profileById, recipeById, useApp } from "@/lib/store";
import {
  ZERO,
  addNutrition,
  entriesOn,
  entryNutrition,
  recipeMealNutrition,
  roundNutrition,
  settingsOf,
  sumEntries,
  unloggedCooks,
} from "@/lib/diary";
import type { Nutrition, Recipe } from "@/lib/types";
import { recommend, topBy } from "@/lib/matching";
import { refreshIfStale } from "@/lib/session";
import { cn, compactNumber, dateKey, formatClock, formatMinutes, greeting, haptic, plural } from "@/lib/utils";

export default function HomePage() {
  /*
   * Стрічка читає своє, а не весь стор: інакше вона перемальовувалась від
   * будь-якої зміни — від кількості солі в коморі теж.
   */
  const hydrated = useApp((s) => s.hydrated);
  const profile = useApp((s) => s.profile);
  const followingIds = useApp((s) => s.following);
  const likes = useApp((s) => s.likes);
  const saved = useApp((s) => s.saved);
  const cooked = useApp((s) => s.cooked);
  const myRecipes = useApp((s) => s.myRecipes);
  const pantry = useApp((s) => s.pantry);
  // Добірка «для тебе» дивиться в комору з родоводом типів — а він міняється
  // разом із каталогом дописаних продуктів.
  const customIngredients = useApp((s) => s.customIngredients);
  /*
   * Картки товарів (products) навмисно НЕ в залежностях: вартості й «є 1,9 л»
   * тут немає, а тип рядка після правки картки стор переписує в самій коморі —
   * новий масив pantry і так перерахує добірку. Зайвий перерахунок тут
   * шкодить: у «Для тебе» є випадковий шум, і кеш карток, що оновлюється при
   * кожному завантаженні, тасував би картки під пальцем.
   */

  /*
   * У стрічку заходять частіше, ніж будь-куди, і чекають там свіже. Але
   * перечитувати базу на кожен перехід між вкладками не треба: realtime
   * приносить чуже нове сам, тож оновлюємось, лише якщо дані підстаркуваті.
   */
  useEffect(() => {
    void refreshIfStale();
  }, []);

  const data = useMemo(() => {
    if (!hydrated) return null;
    const all = allRecipes(useApp.getState());
    const trending = topBy(useApp.getState(), all, "trending").slice(0, 10);
    const forYou = recommend(useApp.getState(), { limit: 8, respectPantry: true });
    const following = all
      .filter((r) => followingIds.includes(r.authorId))
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    const rest = topBy(useApp.getState(), all, "popular").filter(
      (r) => !following.some((f) => f.id === r.id),
    );
    return { trending, forYou, feed: [...following, ...rest].slice(0, 14) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, likes, saved, cooked, followingIds, myRecipes, pantry, customIngredients]);

  if (!hydrated || !data) return <HomeSkeleton />;

  const streak = cookStreak(useApp.getState());
  const today = new Date().toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "long" });

  return (
    <div className="pb-6">
      {/*
        Шапка прикріплена до верху, як і TopBar на решті сторінок.
        Вона єдина в застосунку горталася разом зі сторінкою, і на айфонах з
        островом це виглядало зламано.

        Відступ під виріз лишається на самій шапці, а видимі відступи — на
        внутрішньому рядку, і саме тому вони розділені. Обидва задають
        padding-top, і коли вони стояли поруч, перемагав pt-3: він іде
        пізніше в згенерованому CSS. Вміст шапки опинявся за дванадцять
        пікселів від краю екрана, тобто просто під островом, поверх годинника.
      */}
      <header className="pad-safe-t sticky top-0 z-30 bg-bg md:static md:bg-transparent">
        <div className="flex h-[60px] items-center gap-3 pl-5 pr-4 md:h-[76px] md:gap-3.5 md:px-6">
          {/* На планшеті аватар уже є в рейці зліва. */}
          <Link href="/me" className="shrink-0 md:hidden">
            <Avatar emoji={profile.emoji} gradient={profile.gradient} src={profile.avatar} size={40} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-muted md:text-[13px]">{greeting()}</p>
            <h1 className="truncate font-display text-[17px] font-bold leading-[1.2] md:mt-0.5 md:text-[24px] md:font-extrabold">
              Що будемо їсти?
            </h1>
          </div>
          {streak > 0 && (
            <span
              title="Днів поспіль готуєш"
              className="flex h-[30px] items-center gap-1 rounded-[8px] border border-line bg-surface px-[9px] text-[12.5px] font-extrabold md:h-10 md:gap-1.5 md:border-brand/30 md:bg-brand/10 md:px-3.5 md:text-[14px] md:text-brand"
            >
              <Flame size={14} strokeWidth={2.2} className="text-brand" />
              {streak}
              <span className="hidden md:inline">{plural(streak, "день", "дні", "днів")}</span>
            </span>
          )}
          <span className="hidden h-10 items-center rounded-[10px] border border-line bg-surface px-3.5 text-[14px] font-bold text-muted lg:flex">
            {today}
          </span>
          <Link href="/settings" aria-label="Налаштування" className={cn(TILE_BUTTON, "md:h-12 md:w-12 md:rounded-[14px]")}>
            <Settings2 size={18} className="md:h-5 md:w-5" />
          </Link>
        </div>
      </header>

      {/*
        Телефон: одна колонка в порядку order-*. Планшет (lg): основна колонка
        і бічна на 300 px — обгортки з display: contents на телефоні не існують,
        і їхні діти стають у спільну колонку.
      */}
      <div className="flex flex-col gap-2.5 px-4 pt-1.5 md:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-4 lg:pt-0">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          {/* Не можеш обрати — лише на планшеті: на телефоні це центральна кнопка навігації */}
          <DecideHero />

          {/* Тренди */}
          <Panel className="order-2 lg:order-none">
            <PanelHeader
              label="Зараз готують"
              className="pr-2.5"
              aside={
                <Link href="/explore" className="flex items-center gap-0.5 text-[12px] font-bold text-brand">
                  Усе
                  <ChevronRight size={14} strokeWidth={2.4} />
                </Link>
              }
            />
            <div className="border-t border-line">
              <RecipeScroller
                recipes={data.trending}
                renderBadge={(_, i) =>
                  i < 3 ? (
                    <TileBadge>
                      <TrendingUp size={10} strokeWidth={3} className="text-brand-2" />#{i + 1}
                    </TileBadge>
                  ) : null
                }
              />
            </div>
          </Panel>

          {/* Стрічка: на телефоні великі картки, на планшеті — сітка у дві колонки */}
          <div className="order-4 flex flex-col gap-2.5 lg:order-none lg:grid lg:grid-cols-2 lg:gap-3">
            {data.feed.map((r) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.32 }}
              >
                <div className="lg:hidden">
                  <FeedCard recipe={r} />
                </div>
                <FeedTile recipe={r} />
              </motion.div>
            ))}
          </div>
        </div>

        <aside className="contents lg:sticky lg:top-4 lg:flex lg:flex-col lg:gap-3">
          {/* Готуєш зараз — на телефоні це панель над навігацією */}
          <CookingNow />

          {/* Скільки зʼїдено сьогодні */}
          <div className="order-1 lg:order-none">
            <TodayNutrition />
          </div>

          {/* Персональна добірка */}
          {data.forYou.length > 0 && (
            <Panel className="order-3 lg:order-none">
              <PanelHeader label="Схоже на твій смак" />
              {data.forYou.slice(0, 3).map(({ recipe, reasons }) => (
                <Link
                  key={recipe.id}
                  href={`/recipe/${recipe.id}`}
                  className="flex h-[58px] items-center gap-3 border-t border-line px-3.5 active:bg-surface-2"
                >
                  <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[8px] bg-surface-2 text-[20px]">
                    {recipe.emoji}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[14px] font-bold">{recipe.title}</span>
                    <span className="truncate text-[12px] font-semibold text-faint">
                      {reasons[0] ?? `${formatMinutes(recipe.timeMin)} · ${recipe.cuisine}`}
                    </span>
                  </span>
                  <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-faint" />
                </Link>
              ))}
            </Panel>
          )}

          {/* Додати свій рецепт */}
          <Link
            href="/new"
            onClick={() => haptic(12)}
            className="order-5 flex h-[60px] items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 active:bg-surface-2 lg:order-none"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] brand-gradient text-brand-ink">
              <Plus size={18} strokeWidth={2.6} />
            </span>
            <span className="flex-1 text-[14px] font-bold">Додати свій рецепт</span>
            <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
          </Link>
        </aside>
      </div>
    </div>
  );
}

/** Три найчастіші способи вибору — великою панеллю на планшеті. */
const QUICK = [
  { href: "/decide/roulette", label: "Рулетка", emoji: "🎡" },
  { href: "/decide/fridge", label: "Холодильник", emoji: "🧊" },
  { href: "/decide/rescue", label: "Врятувати", emoji: "🆘" },
];

function DecideHero() {
  return (
    <Panel className="hidden lg:flex lg:gap-4 lg:p-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-brand">Не можеш обрати?</p>
        <h2 className="mt-1.5 font-display text-[20px] font-bold leading-[1.2]">Дозволь застосунку вирішити</h2>
        <p className="mt-1.5 text-[13.5px] font-semibold leading-snug text-muted">
          7 способів обрати страву — від холодильника до рулетки.
        </p>
        <div className="flex-1" />
        <Link
          href="/decide"
          className="mt-3.5 flex h-11 items-center gap-2 self-start rounded-[10px] bg-surface-2 px-4 text-[14px] font-bold active:bg-line"
        >
          <Sparkles size={16} className="text-brand" />
          Усі способи вибору
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {QUICK.map((q) => (
          <Link
            key={q.href}
            href={q.href}
            onClick={() => haptic(10)}
            className="flex w-24 flex-col items-center justify-center gap-2.5 rounded-[10px] border border-line bg-bg-elev active:bg-surface-2"
          >
            <span className="text-[26px]">{q.emoji}</span>
            <span className="text-[13px] font-bold">{q.label}</span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

/** Картка стрічки для планшета: компактна, щоб у дві колонки влізло більше. */
function FeedTile({ recipe }: { recipe: Recipe }) {
  const author = profileById(useApp.getState(), recipe.authorId);
  const stats = effectiveStats(useApp.getState(), recipe);
  return (
    <Link
      href={`/recipe/${recipe.id}`}
      className="hidden gap-3 rounded-[10px] border border-line bg-surface p-3 active:bg-surface-2 lg:flex"
    >
      <RecipeMedia recipe={recipe} className="h-24 w-24 shrink-0" rounded="rounded-[8px]" emojiSize="text-[42px]" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12px] font-semibold text-faint">{author.name}</span>
        <span className="mt-0.5 line-clamp-2 text-[15px] font-bold leading-tight">{recipe.title}</span>
        <span className="flex-1" />
        <span className="flex items-center gap-3.5 text-[12.5px] font-bold text-muted">
          <span className="flex items-center gap-1.5">
            <Heart size={15} />
            {compactNumber(stats.likes)}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={15} />
            {formatMinutes(recipe.timeMin)}
          </span>
        </span>
      </span>
    </Link>
  );
}

/**
 * «Готуєш зараз» у бічній колонці планшета: крок і найближчий таймер.
 * На телефоні те саме показує панель над навігацією (CookingHost).
 */
function CookingNow() {
  const sessions = useCooking((s) => s.sessions);
  const active = startedSessions(sessions)[0];
  const top = active ? timersByUrgency(active)[0] : undefined;
  const now = useNow(top?.timer.deadline != null);
  if (!active) return null;

  const progress = active.stepCount ? ((active.step + 1) / active.stepCount) * 100 : 0;
  return (
    <Link
      href={cookPath(active.recipeId)}
      className="hidden flex-col gap-3 rounded-[12px] p-4 brand-gradient text-brand-ink shadow-[0_20px_50px_-20px_rgb(255_107_53_/_0.55)] lg:flex"
    >
      <span className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-[rgb(26_13_5_/_0.15)] text-[26px]">
          {active.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-extrabold uppercase tracking-[0.06em]">Готуєш зараз</span>
          <span className="block truncate text-[16px] font-extrabold">{active.title}</span>
        </span>
      </span>
      <span className="flex items-end justify-between">
        <span className="text-[13px] font-bold">
          {active.step >= 0 ? `Крок ${active.step + 1} з ${active.stepCount}` : "Підготовка"}
        </span>
        {top && (
          <span className="font-display text-[26px] font-bold leading-none tabular-nums">
            {top.timer.rangAt != null ? "0:00" : formatClock(timerLeft(top.timer, now))}
          </span>
        )}
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-[rgb(26_13_5_/_0.18)]">
        <span className="block h-full rounded-full bg-brand-ink" style={{ width: `${Math.max(0, progress)}%` }} />
      </span>
    </Link>
  );
}

function HomeSkeleton() {
  return (
    // Відступ під виріз окремо від видимого — інакше pt-4 його затирає.
    <div className="pad-safe-t">
      <div className="flex items-center gap-3 px-4 pt-4">
        <Skeleton className="h-11 w-11 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="mt-5 h-52 w-full rounded-[10px]" />
      <div className="mt-6 flex gap-3">
        <Skeleton className="h-40 w-[148px] rounded-[10px]" />
        <Skeleton className="h-40 w-[148px] rounded-[10px]" />
        <Skeleton className="h-40 w-[148px] rounded-[10px]" />
      </div>
      <Skeleton className="mt-6 h-80 w-full rounded-[10px]" />
      <div className="mt-6 flex items-center justify-center gap-2 text-muted">
        <ChefHat size={16} />
        <span className="text-[12px]">Готуємо стрічку…</span>
      </div>
    </div>
  );
}

/**
 * Сьогодні в щоденнику: скільки зʼїдено з цілі. Порожній день — тонкий рядок
 * «що зʼїв сьогодні?»: саме звідси найзручніше записати сніданок.
 *
 * Готування без поділу «хто їв» рахуються як раніше — одна порція.
 */
function TodayNutrition() {
  const hydrated = useApp((s) => s.hydrated);
  const account = useApp((s) => s.account);
  const foodLog = useApp((s) => s.foodLog);
  const meals = useApp((s) => s.meals);
  const cooked = useApp((s) => s.cooked);
  const settings = useApp((s) => s.diarySettings);
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);

  const me = diaryUserId({ account });
  const totals = useMemo(() => {
    if (!hydrated) return null;
    const state = useApp.getState();
    const byId = new Map(meals.map((m) => [m.id, m]));
    const recipeOf = (id: string) => recipeById(state, id);
    const today = dateKey();
    const base = sumEntries(entriesOn(foodLog, me, today), (e) => entryNutrition(e, (id) => byId.get(id), recipeOf));
    const cooks = unloggedCooks(cooked, meals).filter((c) => dateKey(new Date(c.at)) === today);
    const extra = cooks.reduce<Nutrition>((sum, c) => {
      const recipe = recipeOf(c.recipeId);
      const n = recipe ? recipeMealNutrition(recipe, 1) : undefined;
      return n ? addNutrition(sum, n) : sum;
    }, ZERO);
    return { ...roundNutrition(addNutrition(base, extra)), entries: base.entries + cooks.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, foodLog, meals, cooked, me, myRecipes, remoteRecipes]);

  if (!totals) return null;
  const goals = settingsOf(settings, me);
  const goal = goals.kcalGoal;

  return (
    <Link href="/diary" onClick={() => haptic(10)} className="block">
      <Panel>
        <PanelHeader
          label="Сьогодні"
          className="pr-2.5"
          aside={
            <span className="flex items-center gap-0.5 text-[12px] font-bold text-muted">
              Щоденник
              <ChevronRight size={14} strokeWidth={2.4} />
            </span>
          }
        />
        <div className="flex flex-col gap-3 border-t border-line px-3.5 pb-3.5 pt-3">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-[24px] font-bold leading-none">{formatKcal(totals.kcal)}</span>
            <span className="text-[13px] font-bold text-muted">{goal ? `з ${formatKcal(goal)} ккал` : "ккал"}</span>
          </div>
          {goal ? (
            <div className="h-2 overflow-hidden rounded-[4px] bg-surface-2">
              <div
                className="h-full rounded-[4px]"
                style={{
                  width: `${Math.min(100, (totals.kcal / goal) * 100)}%`,
                  background: totals.kcal > goal ? "var(--berry)" : "linear-gradient(90deg, var(--brand), var(--brand-2))",
                }}
              />
            </div>
          ) : null}
          <MacroGrid
            nutrition={totals}
            goals={{ protein: goals.proteinGoal, fat: goals.fatGoal, carbs: goals.carbsGoal }}
          />
        </div>
      </Panel>
    </Link>
  );
}
