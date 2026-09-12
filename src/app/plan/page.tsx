"use client";

import { motion } from "framer-motion";
import { Check, Dices, Search, ShoppingBasket, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { RecipeMedia } from "@/components/RecipeCard";
import { Button, Card, Sheet, useToast } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { applyFilters, byAisle, emptyFilters, generateWeekPlan, shoppingListFor } from "@/lib/matching";
import { pickQuantity } from "@/lib/shopping";
import { allRecipes, recipeById, useApp } from "@/lib/store";
import type { MealType, PlanSlot } from "@/lib/types";
import { dateKey, haptic, MEAL_LABEL, newId, pick, plural, startOfWeek, WEEKDAYS } from "@/lib/utils";

const SLOTS: PlanSlot[] = ["breakfast", "lunch", "dinner"];

export default function PlanPage() {
  const plan = useApp((s) => s.plan);
  const pantry = useApp((s) => s.pantry);
  const myRecipes = useApp((s) => s.myRecipes);
  const setPlanSlot = useApp((s) => s.setPlanSlot);
  const addShopping = useApp((s) => s.addShopping);
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const [weekOffset, setWeekOffset] = useState(0);
  const [picking, setPicking] = useState<{ day: string; slot: PlanSlot } | null>(null);
  const [query, setQuery] = useState("");
  const [shopOpen, setShopOpen] = useState(false);
  /*
   * Позначки тут означають «беремо», а не «купив»: цей аркуш лише збирає
   * список із плану, а сам похід живе на окремій сторінці, де галочки
   * переживають перезапуск застосунку.
   */
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const days = useMemo(() => {
    const start = startOfWeek();
    start.setDate(start.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { key: dateKey(d), date: d, weekday: WEEKDAYS[i] };
    });
  }, [weekOffset]);

  const todayKey = dateKey();

  const plannedRecipes = useMemo(() => {
    if (!hydrated) return [];
    const ids = days.flatMap((d) => SLOTS.map((s) => plan[d.key]?.[s]).filter(Boolean));
    return [...new Set(ids as string[])]
      .map((id) => recipeById(useApp.getState(), id))
      .filter((r) => r != null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, plan, days, myRecipes]);

  const shoppingList = useMemo(
    () => (hydrated ? shoppingListFor(plannedRecipes, pantry.map((p) => p.key)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, plannedRecipes, pantry],
  );

  // Той самий список, розкладений по відділах у порядку обходу магазину.
  const shoppingAisles = useMemo(() => byAisle(shoppingList), [shoppingList]);

  const filledCount = days.reduce(
    (n, d) => n + SLOTS.filter((s) => plan[d.key]?.[s]).length,
    0,
  );

  const generate = () => {
    haptic([16, 40, 16]);
    const generated = generateWeekPlan(
      useApp.getState(),
      days.map((d) => d.key),
      SLOTS,
    );
    for (const day of days) {
      for (const slot of SLOTS) {
        setPlanSlot(day.key, slot, generated[day.key]?.[slot] ?? null);
      }
    }
    toast("Меню на тиждень готове", "✨");
  };

  const searchResults = useMemo(() => {
    if (!hydrated || !picking) return [];
    const list = applyFilters(useApp.getState(), {
      ...emptyFilters,
      query,
      meals: query ? [] : ([picking.slot] as MealType[]),
    });
    return list.slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, picking, query, myRecipes]);

  return (
    <div className="pb-8">
      <TopBar
        title="План на тиждень"
        subtitle={`${filledCount} з 21 слоту заповнено`}
        right={
          filledCount > 0 ? (
            <button
              onClick={() => {
                if (confirm("Очистити план цього тижня?")) {
                  days.forEach((d) => SLOTS.forEach((s) => setPlanSlot(d.key, s, null)));
                  toast("План очищено", "🧹");
                }
              }}
              aria-label="Очистити план"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2 text-muted"
            >
              <Trash2 size={17} />
            </button>
          ) : undefined
        }
      />

      {/* Перемикач тижнів */}
      <div className="flex items-center gap-2 px-4 pt-4">
        {[0, 1].map((off) => (
          <button
            key={off}
            onClick={() => {
              haptic(8);
              setWeekOffset(off);
            }}
            className={`flex-1 rounded-2xl border py-2.5 text-[13px] font-bold ${
              weekOffset === off ? "border-brand bg-brand/10 text-brand" : "border-line bg-surface text-muted"
            }`}
          >
            {off === 0 ? "Цей тиждень" : "Наступний"}
          </button>
        ))}
      </div>

      {/* Генератор */}
      <div className="px-4 pt-3">
        <Button full size="lg" onClick={generate}>
          <Sparkles size={18} />
          Згенерувати меню
        </Button>
        <p className="mt-2 text-center text-[11.5px] text-muted">
          Врахує твій смак, різноманітність і не поставить одну страву двічі
        </p>
      </div>

      {/* Сітка днів */}
      <section className="flex flex-col gap-3 px-4 pt-5">
        {days.map((day) => {
          const isToday = day.key === todayKey;
          return (
            <Card
              key={day.key}
              className={`overflow-hidden p-0 ${isToday ? "border-brand/40" : ""}`}
            >
              <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
                <span
                  className={`text-[13px] font-extrabold ${isToday ? "text-brand" : ""}`}
                >
                  {day.weekday}
                </span>
                <span className="text-[12px] text-muted">
                  {day.date.getDate()}.{String(day.date.getMonth() + 1).padStart(2, "0")}
                </span>
                {isToday && (
                  <span className="ml-auto rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-extrabold text-brand">
                    сьогодні
                  </span>
                )}
              </div>

              <div className="divide-y divide-line">
                {SLOTS.map((slot) => {
                  const id = plan[day.key]?.[slot];
                  const recipe = id && hydrated ? recipeById(useApp.getState(), id) : undefined;
                  return (
                    <div key={slot} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="w-[62px] shrink-0 text-[11.5px] font-bold text-muted">
                        {MEAL_LABEL[slot]}
                      </span>

                      {recipe ? (
                        <>
                          <Link
                            href={`/recipe/${recipe.id}`}
                            className="flex min-w-0 flex-1 items-center gap-2.5"
                          >
                            <RecipeMedia
                              recipe={recipe}
                              className="h-10 w-10 shrink-0"
                              rounded="rounded-xl"
                              emojiSize="text-lg"
                            />
                            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                              {recipe.title}
                            </span>
                          </Link>
                          <button
                            onClick={() => {
                              haptic(8);
                              setPlanSlot(day.key, slot, null);
                            }}
                            aria-label="Прибрати"
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-faint"
                          >
                            <X size={15} />
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-1 gap-2">
                          <button
                            onClick={() => {
                              haptic(8);
                              setQuery("");
                              setPicking({ day: day.key, slot });
                            }}
                            className="flex-1 rounded-xl border border-dashed border-line py-2 text-[12.5px] font-semibold text-muted"
                          >
                            + обрати страву
                          </button>
                          <button
                            onClick={() => {
                              haptic(12);
                              const pool = applyFilters(useApp.getState(), {
                                ...emptyFilters,
                                meals: [slot as MealType],
                              });
                              const r = pick(pool);
                              if (r) setPlanSlot(day.key, slot, r.id);
                            }}
                            aria-label="Випадкова страва"
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted"
                          >
                            <Dices size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </section>

      {/* Що треба докупити на цей тиждень */}
      <section className="flex flex-col gap-2 px-4 pt-6">
        {shoppingList.length > 0 && (
          <Button
            variant="secondary"
            full
            size="lg"
            onClick={() => {
              haptic(12);
              // Наперед позначаємо все: людина відкрила це, щоб узяти список,
              // а не щоб зібрати його заново по галочці.
              setChosen(new Set(shoppingList.map((i) => i.key)));
              setShopOpen(true);
            }}
          >
            <ShoppingBasket size={18} />
            Зібрати список на тиждень · {shoppingList.length}
          </Button>
        )}
        <Link href="/shopping" onClick={() => haptic(8)}>
          <Button variant="ghost" full>
            Відкрити список покупок
          </Button>
        </Link>
      </section>

      {/* Вибір страви у слот */}
      <Sheet
        open={!!picking}
        onClose={() => setPicking(null)}
        title={picking ? `Обери: ${MEAL_LABEL[picking.slot].toLowerCase()}` : ""}
      >
        <div className="sticky top-0 z-10 -mx-5 mb-2 bg-bg-elev px-5 pb-3">
          <div className="flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5">
            <Search size={17} className="shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Пошук страви…"
              className="h-full flex-1 text-[15px]"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 pb-4">
          {searchResults.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                if (!picking) return;
                haptic(12);
                setPlanSlot(picking.day, picking.slot, r.id);
                setPicking(null);
              }}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 text-left active:bg-surface-2"
            >
              <RecipeMedia
                recipe={r}
                className="h-12 w-12 shrink-0"
                rounded="rounded-xl"
                emojiSize="text-xl"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold">{r.title}</p>
                <p className="truncate text-[11.5px] text-muted">
                  {r.timeMin} хв · {r.cuisine}
                </p>
              </div>
            </button>
          ))}
          {searchResults.length === 0 && (
            <p className="py-8 text-center text-[13px] text-muted">Нічого не знайшлось</p>
          )}
        </div>
      </Sheet>

      {/* Список покупок */}
      <Sheet
        open={shopOpen}
        onClose={() => setShopOpen(false)}
        title="Список покупок"
        footer={
          <Button
            full
            onClick={() => {
              haptic(14);
              const items = shoppingList
                .filter((entry) => chosen.has(entry.key))
                .map((entry) => {
                  /*
                   * Коли міри не звелись («500 г» і «2 ст. л.»), у списку
                   * лишається вагова: саме нею міряють у магазині. Вигадана
                   * сума гірша за неповну правду, а сам продукт потрібен у
                   * будь-якому разі.
                   */
                  const q = pickQuantity(entry.quantities);
                  return {
                    id: newId(),
                    key: entry.key,
                    amount: q?.amount,
                    unit: q?.unit,
                    done: false,
                    addedAt: new Date().toISOString(),
                    source: "plan" as const,
                  };
                });

              const { fresh, merged } = addShopping(items);
              toast(
                fresh > 0
                  ? `${fresh} ${plural(fresh, "позиція", "позиції", "позицій")} у списку покупок`
                  : merged > 0
                    ? "Усе це вже в списку — кількості долито"
                    : "Усе це вже в списку покупок",
                "🛒",
              );
              setShopOpen(false);
            }}
            disabled={chosen.size === 0}
          >
            Додати в список покупок ({chosen.size})
          </Button>
        }
      >
        <p className="pb-3 text-[12.5px] leading-snug text-muted">
          Зібрано з {plannedRecipes.length} страв цього тижня, у порядку обходу магазину. Те, що
          вже є в коморі, не показуємо. Зніми позначку з того, чого брати не треба.
        </p>
        <div className="flex flex-col gap-5 pb-4">
          {shoppingAisles.map(({ cat, label: aisle, items }) => (
            <div key={cat}>
              <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-muted">
                {aisle}
              </h3>
              <div className="flex flex-col gap-2">
              {items.map(({ key, label: qtyLabel, count }) => {
                const def = ing(key);
                const checked = chosen.has(key);
                return (
                  <motion.button
                    key={key}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      haptic(8);
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                    className={`flex items-center gap-3 rounded-2xl border p-3 text-left ${
                      checked ? "border-mint/40 bg-mint/8" : "border-line bg-surface"
                    }`}
                  >
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                        checked ? "border-mint bg-mint text-bg" : "border-line"
                      }`}
                    >
                      {checked && <Check size={13} strokeWidth={3} />}
                    </span>
                    <span className="text-lg">{def.emoji}</span>
                    <span
                      /* Позначка тут означає «беремо», тож викреслюємо,
                         навпаки, те, що людина зі списку зняла. */
                      className={`min-w-0 flex-1 text-[14px] font-semibold ${checked ? "" : "line-through opacity-50"}`}
                    >
                      {def.label}
                      {count > 1 && (
                        <span className="ml-1.5 text-[11px] font-normal text-muted">
                          для {count} страв
                        </span>
                      )}
                    </span>
                    {qtyLabel && (
                      <span className="shrink-0 text-[12px] font-semibold text-muted">{qtyLabel}</span>
                    )}
                  </motion.button>
                );
              })}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
