"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ChefHat,
  ChevronRight,
  Dices,
  Flame,
  Heart,
  Plus,
  Refrigerator,
  Settings2,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useMemo } from "react";
import { FeedCard, RecipeScroller } from "@/components/RecipeCard";
import { Avatar, Card, MacroBar, SectionTitle, Skeleton } from "@/components/ui";
import { allRecipes, cookStreak, recipeById, useApp } from "@/lib/store";
import { dayTotals } from "@/lib/nutrition";
import { recommend, topBy } from "@/lib/matching";
import { greeting, haptic, MEAL_LABEL, currentMeal, plural } from "@/lib/utils";

export default function HomePage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);

  const data = useMemo(() => {
    if (!hydrated) return null;
    const all = allRecipes(state);
    const trending = topBy(state, all, "trending").slice(0, 10);
    const forYou = recommend(state, { limit: 8, respectPantry: true });
    const following = all
      .filter((r) => state.following.includes(r.authorId))
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    const rest = topBy(state, all, "popular").filter(
      (r) => !following.some((f) => f.id === r.id),
    );
    return { trending, forYou, feed: [...following, ...rest].slice(0, 14) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, state.likes, state.saved, state.cooked, state.following, state.myRecipes, state.pantry]);

  if (!hydrated || !data) return <HomeSkeleton />;

  const streak = cookStreak(state);
  const meal = currentMeal();

  return (
    <div className="pb-6">
      {/* Шапка */}
      <header className="pad-safe-t px-4 pt-3">
        <div className="flex items-center gap-3">
          <Link href="/me" className="shrink-0">
            <Avatar
              emoji={state.profile.emoji}
              gradient={state.profile.gradient}
              src={state.profile.avatar}
              size={44}
            />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-muted">{greeting()}</p>
            <h1 className="truncate font-display text-[19px] font-extrabold leading-tight">
              Що будемо їсти?
            </h1>
          </div>
          {streak > 0 && (
            <div className="flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1.5">
              <Flame size={14} className="text-brand" />
              <span className="text-[12px] font-extrabold text-brand">{streak}</span>
            </div>
          )}
          <Link
            href="/settings"
            aria-label="Налаштування"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-surface-2"
          >
            <Settings2 size={18} />
          </Link>
        </div>
      </header>

      {/* Скільки зʼїдено сьогодні */}
      <TodayNutrition />

      {/* Головний CTA */}
      <section className="px-4 pt-4">
        <Card className="overflow-hidden border-brand/25 p-0">
          <div
            className="relative p-4"
            style={{
              backgroundImage:
                "linear-gradient(135deg, color-mix(in oklab, var(--brand) 22%, transparent), transparent 65%)",
            }}
          >
            <p className="text-[12px] font-bold uppercase tracking-wide text-brand">
              {MEAL_LABEL[meal]} · не можеш обрати?
            </p>
            <h2 className="mt-1 font-display text-[20px] font-extrabold leading-tight">
              Дозволь застосунку вирішити
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              10 способів обрати страву — від холодильника до рулетки.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <QuickAction href="/decide/roulette" icon={<Dices size={19} />} label="Рулетка" />
              <QuickAction
                href="/decide/fridge"
                icon={<Refrigerator size={19} />}
                label="Холодильник"
              />
              <QuickAction href="/decide/swipe" icon={<Heart size={19} />} label="Свайп" />
            </div>

            <Link
              href="/decide"
              onClick={() => haptic(12)}
              className="mt-2.5 flex items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface/60 py-2.5 text-[13px] font-bold"
            >
              <Sparkles size={15} className="text-brand" />
              Усі способи вибору
            </Link>
          </div>
        </Card>
      </section>

      {/* Тренди */}
      <section className="pt-7">
        <SectionTitle
          title="Зараз готують"
          note="Найпопулярніше за останні дні"
          action={
            <Link href="/explore" className="text-[12px] font-bold text-brand">
              Усе
            </Link>
          }
        />
        <RecipeScroller
          recipes={data.trending}
          renderBadge={(_, i) =>
            i < 3 ? (
              <span className="glass inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold text-brand">
                <TrendingUp size={9} />#{i + 1}
              </span>
            ) : null
          }
        />
      </section>

      {/* Персональна добірка */}
      {data.forYou.length > 0 && (
        <section className="pt-7">
          <SectionTitle
            title="Схоже на твій смак"
            note="Підібрано з твоїх лайків, комори і часу доби"
            action={
              <Link href="/decide/foryou" className="text-[12px] font-bold text-brand">
                Більше
              </Link>
            }
          />
          <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
            {data.forYou.slice(0, 6).map(({ recipe, reasons }) => (
              <Link
                key={recipe.id}
                href={`/recipe/${recipe.id}`}
                className="w-[210px] shrink-0 rounded-xl3 border border-line bg-surface p-3"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl"
                    style={{
                      backgroundImage: `linear-gradient(140deg, ${recipe.gradient[0]}, ${recipe.gradient[1]})`,
                    }}
                  >
                    {recipe.emoji}
                  </div>
                  <h4 className="line-clamp-2 text-[13.5px] font-bold leading-tight">
                    {recipe.title}
                  </h4>
                </div>
                {reasons.length > 0 && (
                  <p className="mt-2.5 line-clamp-2 text-[11.5px] leading-snug text-brand">
                    ✦ {reasons[0]}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Стрічка */}
      <section className="pt-7">
        <SectionTitle
          title="Стрічка"
          note={`Від ${state.following.length} ${plural(state.following.length, "кухаря", "кухарів", "кухарів")}, на яких ти підписаний`}
        />
        <div className="flex flex-col gap-4 px-4">
          {data.feed.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.32 }}
            >
              <FeedCard recipe={r} />
            </motion.div>
          ))}
        </div>
      </section>

      {/* Додати свій рецепт */}
      <section className="px-4 pt-6">
        <Link
          href="/new"
          onClick={() => haptic(12)}
          className="flex items-center gap-3 rounded-xl3 border border-dashed border-line bg-surface/50 p-4"
        >
          <div className="grid h-11 w-11 place-items-center rounded-2xl brand-gradient text-brand-ink">
            <Plus size={20} strokeWidth={2.6} />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-bold">Додати свій рецепт</p>
            <p className="text-[12px] text-muted">Фото, кроки, інгредієнти — і він у твоїй галереї</p>
          </div>
        </Link>
      </section>
    </div>
  );
}

function QuickAction({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link href={href} onClick={() => haptic(12)}>
      <motion.div
        whileTap={{ scale: 0.95 }}
        className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-bg-elev py-3"
      >
        <span className="text-brand">{icon}</span>
        <span className="text-[11.5px] font-bold">{label}</span>
      </motion.div>
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div className="pad-safe-t px-4 pt-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="mt-5 h-52 w-full rounded-xl3" />
      <div className="mt-6 flex gap-3">
        <Skeleton className="h-40 w-[148px] rounded-xl3" />
        <Skeleton className="h-40 w-[148px] rounded-xl3" />
        <Skeleton className="h-40 w-[148px] rounded-xl3" />
      </div>
      <Skeleton className="mt-6 h-80 w-full rounded-xl3" />
      <div className="mt-6 flex items-center justify-center gap-2 text-muted">
        <ChefHat size={16} />
        <span className="text-[12px]">Готуємо стрічку…</span>
      </div>
    </div>
  );
}

/**
 * Підсумок за день з історії готувань. Зʼявляється лише коли сьогодні щось
 * готували — порожня картка «0 ккал» щодня не додає нічого корисного.
 */
function TodayNutrition() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);

  const totals = useMemo(
    () => (hydrated ? dayTotals(state.cooked, (id) => recipeById(state, id)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, state.cooked, state.myRecipes, state.remoteRecipes],
  );

  if (!totals || totals.meals === 0) return null;

  return (
    <section className="px-4 pt-4">
      <Card className="p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[12px] text-muted">Сьогодні приготовано</p>
            <p className="mt-0.5 font-display text-[26px] font-extrabold leading-none">
              {totals.kcal} <span className="text-[14px] font-bold text-muted">ккал</span>
            </p>
          </div>
          <p className="text-right text-[11.5px] leading-snug text-faint">
            {totals.meals} {plural(totals.meals, "страва", "страви", "страв")}
            {totals.unknown > 0 && (
              <>
                <br />
                {totals.unknown} без даних
              </>
            )}
          </p>
        </div>

        <MacroBar nutrition={totals} className="mt-3" />

        <Link
          href="/diary"
          onClick={() => haptic(10)}
          className="mt-3 flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2 text-[12.5px] font-semibold"
        >
          Щоденник за два тижні
          <ChevronRight size={15} className="text-muted" />
        </Link>
      </Card>
    </section>
  );
}
