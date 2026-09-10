"use client";

import { motion } from "framer-motion";
import { ChefHat } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Button, Card, EmptyState, MacroBar } from "@/components/ui";
import { dayTotals, servingKcal, type DayTotals } from "@/lib/nutrition";
import { recipeById, useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { dateKey, haptic, plural } from "@/lib/utils";

/**
 * Щоденник харчування, який не треба вести.
 *
 * Усе вже записано: застосунок знає, що і коли готували, а склад страви
 * переводиться в калорії з каталогу. Тобто єдине, чого бракувало, — це
 * подивитись на ті самі дані не за сьогодні, а за два тижні.
 *
 * Числа тут — оцінка, і саме так вони й підписані. Одне приготування
 * рахуємо за одну порцію: страву зазвичай готують на всіх, а зʼїдають свою
 * частку. Страви, склад яких порахувати не вдалося, показуємо окремо, а не
 * розчиняємо в загальній сумі — інакше щоденник тихо занижував би цифри.
 */

const DAYS = 14;

interface Day {
  date: Date;
  key: string;
  totals: DayTotals;
  dishes: Recipe[];
}

export default function DiaryPage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const [selected, setSelected] = useState<string | null>(null);

  const days = useMemo<Day[]>(() => {
    if (!hydrated) return [];
    const now = new Date();
    const out: Day[] = [];

    for (let back = DAYS - 1; back >= 0; back--) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
      const key = dateKey(date);
      const dishes = state.cooked
        .filter((event) => dateKey(new Date(event.at)) === key)
        .map((event) => recipeById(state, event.recipeId))
        .filter((r): r is Recipe => Boolean(r));

      out.push({
        date,
        key,
        totals: dayTotals(state.cooked, (id) => recipeById(state, id), date),
        dishes,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, state.cooked, state.myRecipes, state.remoteRecipes]);

  const cookedDays = days.filter((d) => d.totals.meals > 0);
  const peak = Math.max(...days.map((d) => d.totals.kcal), 1);

  /* Середнє рахуємо по днях, коли справді готували. Ділити на всі
     чотирнадцять означало б порахувати відпустку за дні голодування. */
  const average =
    cookedDays.length > 0
      ? Math.round(cookedDays.reduce((sum, d) => sum + d.totals.kcal, 0) / cookedDays.length)
      : 0;

  const active = days.find((d) => d.key === selected) ?? cookedDays[cookedDays.length - 1];

  if (hydrated && cookedDays.length === 0) {
    return (
      <div className="pb-8">
        <TopBar title="Щоденник" />
        <EmptyState
          emoji="📓"
          title="Ще нема що показати"
          note="Щоденник збирається сам з режиму готування: щойно приготуєш першу страву, тут зʼявляться калорії за день. Нічого вводити руками не треба."
          action={
            <Link href="/decide">
              <Button>
                <ChefHat size={17} />
                Обрати страву
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="pb-8">
      <TopBar title="Щоденник" subtitle="Два тижні · рахується саме" />

      {/* Підсумок періоду */}
      <section className="px-4 pt-4">
        <Card className="p-4">
          <p className="text-[12px] text-muted">У середньому за день готування</p>
          <p className="mt-0.5 font-display text-[30px] font-extrabold leading-none">
            {average} <span className="text-[15px] font-bold text-muted">ккал</span>
          </p>
          <p className="mt-2 text-[11.5px] leading-snug text-faint">
            {cookedDays.length} {plural(cookedDays.length, "день", "дні", "днів")} з {DAYS} ·{" "}
            {cookedDays.reduce((n, d) => n + d.totals.meals, 0)}{" "}
            {plural(cookedDays.reduce((n, d) => n + d.totals.meals, 0), "страва", "страви", "страв")}
          </p>
        </Card>
      </section>

      {/* Стовпчики по днях */}
      <section className="px-4 pt-4">
        <Card className="p-4">
          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-muted">
            Калорії за днями
          </h2>

          <div className="flex h-[132px] items-end gap-[3px]">
            {days.map((day) => {
              const isActive = active?.key === day.key;
              const isToday = day.key === dateKey(new Date());
              // Найменший видимий стовпчик: день, коли готували мало, має
              // відрізнятись від дня, коли не готували зовсім.
              const height = day.totals.kcal > 0 ? Math.max((day.totals.kcal / peak) * 100, 4) : 0;

              return (
                <button
                  key={day.key}
                  onClick={() => {
                    haptic(8);
                    setSelected(day.key);
                  }}
                  aria-label={`${day.date.toLocaleDateString("uk-UA", { day: "numeric", month: "long" })}: ${day.totals.kcal} ккал, ${day.totals.meals} ${plural(day.totals.meals, "страва", "страви", "страв")}`}
                  aria-pressed={isActive}
                  className="group flex h-full flex-1 flex-col justify-end gap-1.5"
                >
                  <span className="relative flex h-full items-end">
                    <span
                      style={{
                        height: `${height}%`,
                        background: day.totals.kcal > 0 ? "var(--chart-bar)" : "var(--line)",
                        opacity: day.totals.kcal > 0 && !isActive && active ? 0.45 : 1,
                      }}
                      className="w-full rounded-t-[4px]"
                    />
                    {day.totals.kcal === 0 && (
                      <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-line" />
                    )}
                  </span>
                  <span
                    className={`text-[9.5px] font-bold ${
                      isActive ? "text-ink" : isToday ? "text-brand" : "text-faint"
                    }`}
                  >
                    {day.date.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      </section>

      {/* Обраний день */}
      {active && (
        <motion.section
          key={active.key}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 pt-4"
        >
          <Card className="p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[12px] text-muted">
                  {active.key === dateKey(new Date())
                    ? "Сьогодні"
                    : active.date.toLocaleDateString("uk-UA", { day: "numeric", month: "long" })}
                </p>
                <p className="mt-0.5 font-display text-[26px] font-extrabold leading-none">
                  {active.totals.kcal} <span className="text-[14px] font-bold text-muted">ккал</span>
                </p>
              </div>
              <p className="text-right text-[11.5px] leading-snug text-faint">
                {active.totals.meals}{" "}
                {plural(active.totals.meals, "страва", "страви", "страв")}
                {active.totals.unknown > 0 && (
                  <>
                    <br />
                    {active.totals.unknown} без даних
                  </>
                )}
              </p>
            </div>

            {active.totals.kcal > 0 && <MacroBar nutrition={active.totals} className="mt-3" />}

            {active.dishes.length > 0 && (
              <div className="mt-4 flex flex-col gap-1.5">
                {active.dishes.map((recipe, i) => {
                  const kcal = servingKcal(recipe);
                  return (
                    <Link
                      key={`${recipe.id}-${i}`}
                      href={`/recipe/${recipe.id}`}
                      className="flex items-center gap-2.5 rounded-2xl bg-surface-2 px-3 py-2"
                    >
                      <span className="text-lg">{recipe.emoji}</span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                        {recipe.title}
                      </span>
                      <span className="shrink-0 text-[12px] font-bold text-muted">
                        {kcal != null ? `${kcal} ккал` : "—"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}

            <p className="mt-3 text-[11px] leading-snug text-faint">
              Оцінка зі складу страв, з розрахунку одна порція на приготування.
            </p>
          </Card>
        </motion.section>
      )}
    </div>
  );
}
