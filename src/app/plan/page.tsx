"use client";

import { Check, ChevronRight, Dices, Plus, Search, ShoppingBasket, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { RecipeMedia, RecipeRow } from "@/components/RecipeCard";
import { Button, Panel, PanelHeader, Segmented, Sheet, TILE_BUTTON, useToast } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { applyFilters, byAisle, emptyFilters, generateWeekPlan, shoppingListFor } from "@/lib/matching";
import { pickQuantity } from "@/lib/shopping";
import { allRecipes, pantryTypes, recipeById, useApp } from "@/lib/store";
import type { MealType, PlanSlot } from "@/lib/types";
import { cn, dateKey, formatMinutes, haptic, MEAL_LABEL, newId, pick, plural, startOfWeek } from "@/lib/utils";

const SLOTS: PlanSlot[] = ["breakfast", "lunch", "dinner"];

/** Повні назви днів — для заголовків панелей (у WEEKDAYS лише «Пн», «Вт»). */
const DAY_NAMES = ["Понеділок", "Вівторок", "Середа", "Четвер", "Пʼятниця", "Субота", "Неділя"];
/** Короткі — для вузьких колонок тижня на планшеті. */
const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

export default function PlanPage() {
  const plan = useApp((s) => s.plan);
  const pantry = useApp((s) => s.pantry);
  const customIngredients = useApp((s) => s.customIngredients);
  // Правка типу картки товару переписує тип рядків комори — список закупівлі теж.
  const products = useApp((s) => s.products);
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
      return { key: dateKey(d), date: d, weekday: DAY_NAMES[i] };
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
    // Різновид у коморі закриває потребу: безлактозне молоко — молоко не купуємо.
    () => (hydrated ? shoppingListFor(plannedRecipes, pantryTypes(useApp.getState())) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, plannedRecipes, pantry, customIngredients, products],
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
              className={TILE_BUTTON}
            >
              <Trash2 size={17} />
            </button>
          ) : undefined
        }
      />

      {/*
        Планшет (lg): тиждень — сім колонок по три прийоми їжі, як на холодильнику.
        Над ними в один рядок перемикач, генератор і покупки (покупки поставлені
        у перший рядок явно, хоча в коді вони після днів).
      */}
      <div className="flex flex-col gap-2.5 px-4 md:px-6 lg:grid lg:grid-cols-7 lg:items-start lg:gap-2">
        {/* Перемикач тижнів */}
        <Segmented
          className="lg:col-span-2"
          value={String(weekOffset)}
          onChange={(v) => setWeekOffset(Number(v))}
          options={[
            { value: "0", label: "Цей тиждень" },
            { value: "1", label: "Наступний" },
          ]}
        />

        {/* Генератор */}
        <Panel className="lg:col-span-3">
          <PanelHeader
            label="Меню на тиждень"
            tone="brand"
            icon={<Sparkles size={13} strokeWidth={2.4} />}
            aside={`${filledCount} з 21 заповнено`}
          />
          <div className="flex flex-col gap-2.5 border-t border-line px-3.5 pb-3.5 pt-3">
            <p className="text-[12.5px] font-semibold leading-snug text-muted">
              Врахує твій смак, різноманітність і не поставить одну страву двічі
            </p>
            <Button full onClick={generate}>
              <Sparkles size={17} />
              Згенерувати меню
            </Button>
          </div>
        </Panel>

        {/* Сітка днів */}
        {days.map((day) => {
          const isToday = day.key === todayKey;
          const filled = SLOTS.filter((s) => plan[day.key]?.[s]).length;
          return (
            <div
              key={day.key}
              className={cn(
                "overflow-hidden rounded-[10px] border bg-surface",
                isToday ? "border-brand/35" : "border-line",
              )}
            >
              <PanelHeader
                label={
                  // Одним рядком: заголовок панелі — flex із проміжком, і окремі шматки розʼїхались би.
                  <span className="truncate">
                    <span className="lg:hidden">{day.weekday}</span>
                    {/* У вузькій колонці планшета — «Пн · 3.11» */}
                    <span className="hidden lg:inline">{DAY_SHORT[DAY_NAMES.indexOf(day.weekday)]}</span>
                    {` · ${day.date.getDate()}.${String(day.date.getMonth() + 1).padStart(2, "0")}`}
                  </span>
                }
                tone={isToday ? "brand" : undefined}
                className="lg:pl-2.5 lg:pr-2"
                aside={
                  <span className="flex shrink-0 items-center gap-1.5">
                    {isToday && (
                      <span className="flex h-5 items-center rounded-[5px] bg-brand/15 px-1.5 text-[10.5px] font-extrabold text-brand lg:hidden">
                        сьогодні
                      </span>
                    )}
                    <span className="text-[11.5px] font-bold text-faint">{filled}/3</span>
                  </span>
                }
              />

              {SLOTS.map((slot) => {
                const id = plan[day.key]?.[slot];
                const recipe = id && hydrated ? recipeById(useApp.getState(), id) : undefined;
                return (
                  <div
                    key={slot}
                    className="flex h-16 items-center gap-1 border-t border-line pr-2 lg:relative lg:h-[124px] lg:flex-col lg:items-stretch lg:gap-0 lg:pr-0"
                  >
                    {recipe ? (
                      <>
                        <Link
                          href={`/recipe/${recipe.id}`}
                          className="flex min-w-0 flex-1 items-center gap-3 self-stretch pl-3.5 active:bg-surface-2 lg:flex-col lg:items-start lg:gap-1.5 lg:p-2.5"
                        >
                          <RecipeMedia
                            recipe={recipe}
                            className="h-11 w-11 shrink-0 lg:h-[38px] lg:w-[38px]"
                            rounded="rounded-[8px]"
                            emojiSize="text-[22px]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-bold leading-tight lg:line-clamp-3 lg:whitespace-normal lg:text-[12.5px]">
                              {recipe.title}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] font-semibold text-faint lg:hidden">
                              {MEAL_LABEL[slot]} · {formatMinutes(recipe.timeMin)}
                            </span>
                          </span>
                        </Link>
                        <button
                          onClick={() => {
                            haptic(8);
                            setPlanSlot(day.key, slot, null);
                          }}
                          aria-label="Прибрати"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-faint active:bg-surface-2 lg:absolute lg:right-1 lg:top-1 lg:h-7 lg:w-7"
                        >
                          <X size={14} strokeWidth={2.2} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            haptic(8);
                            setQuery("");
                            setPicking({ day: day.key, slot });
                          }}
                          className="flex min-w-0 flex-1 items-center gap-3 self-stretch pl-3.5 text-left active:bg-surface-2 lg:flex-col lg:items-start lg:gap-1.5 lg:p-2.5"
                        >
                          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[8px] border-[1.5px] border-dashed border-line-strong text-brand lg:h-[38px] lg:w-[38px]">
                            <Plus size={16} strokeWidth={2.4} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-bold text-brand lg:hidden">Обрати страву</span>
                            <span className="mt-0.5 block truncate text-[12px] font-semibold text-faint lg:mt-0">
                              {MEAL_LABEL[slot]}
                            </span>
                          </span>
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
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-surface-2 text-muted active:bg-line lg:absolute lg:right-1.5 lg:top-1.5 lg:h-7 lg:w-7"
                        >
                          <Dices size={16} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Що треба докупити на цей тиждень */}
        <Panel className="lg:col-span-2 lg:col-start-6 lg:row-start-1">
          <PanelHeader label="Покупки" />
          {shoppingList.length > 0 && (
            <button
              onClick={() => {
                haptic(12);
                // Наперед позначаємо все: людина відкрила це, щоб узяти список,
                // а не щоб зібрати його заново по галочці.
                setChosen(new Set(shoppingList.map((i) => i.key)));
                setShopOpen(true);
              }}
              className="flex h-12 w-full items-center gap-2.5 border-t border-line px-3.5 text-left active:bg-surface-2"
            >
              <ShoppingBasket size={17} className="text-brand" />
              <span className="flex-1 text-[14px] font-bold text-brand">Зібрати список на тиждень</span>
              <span className="text-[12px] font-bold text-faint">{shoppingList.length}</span>
            </button>
          )}
          <Link
            href="/shopping"
            onClick={() => haptic(8)}
            className="flex h-12 items-center gap-2.5 border-t border-line px-3.5 active:bg-surface-2"
          >
            <span className="flex-1 text-[14px] font-semibold">Відкрити список покупок</span>
            <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
          </Link>
        </Panel>
      </div>

      {/* Вибір страви у слот */}
      <Sheet
        open={!!picking}
        onClose={() => setPicking(null)}
        title={picking ? `Обери: ${MEAL_LABEL[picking.slot].toLowerCase()}` : ""}
      >
        <div className="sticky top-0 z-10 -mx-5 mb-2 bg-bg-elev px-5 pb-3">
          <div className="flex h-[46px] items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5">
            <Search size={18} className="shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Пошук страви…"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-semibold placeholder:text-faint"
            />
          </div>
        </div>

        <div className="pb-4">
          {searchResults.length > 0 ? (
            <Panel>
              <PanelHeader label={query || !picking ? "Знайдено" : MEAL_LABEL[picking.slot]} />
              {searchResults.map((r) => (
                <RecipeRow
                  key={r.id}
                  recipe={r}
                  flat
                  right={<Plus size={16} strokeWidth={2.4} className="shrink-0 text-brand" />}
                  onClick={() => {
                    if (!picking) return;
                    haptic(12);
                    setPlanSlot(picking.day, picking.slot, r.id);
                    setPicking(null);
                  }}
                />
              ))}
            </Panel>
          ) : (
            <p className="py-8 text-center text-[13px] font-semibold text-muted">Нічого не знайшлось</p>
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
        <p className="pb-3 text-[12.5px] font-semibold leading-snug text-muted">
          Зібрано з {plannedRecipes.length} страв цього тижня, у порядку обходу магазину. Те, що
          вже є в коморі, не показуємо. Зніми позначку з того, чого брати не треба.
        </p>
        <div className="flex flex-col gap-2.5 pb-4">
          {shoppingAisles.map(({ cat, label: aisle, items }) => (
            <Panel key={cat}>
              <PanelHeader
                label={aisle}
                aside={`${items.filter((x) => chosen.has(x.key)).length}/${items.length}`}
              />
              {items.map(({ key, label: qtyLabel, count }) => {
                const def = ing(key);
                const checked = chosen.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => {
                      haptic(8);
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                    aria-pressed={checked}
                    className="flex min-h-[50px] w-full items-center gap-3 border-t border-line px-3.5 py-2 text-left active:bg-surface-2"
                  >
                    <span
                      className={cn(
                        "grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] transition-colors",
                        checked ? "border-brand bg-brand text-brand-ink" : "border-line-strong",
                      )}
                    >
                      {checked && <Check size={12} strokeWidth={3.5} />}
                    </span>
                    <span className="text-[17px]">{def.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span
                        /* Позначка тут означає «беремо», тож викреслюємо,
                           навпаки, те, що людина зі списку зняла. */
                        className={cn(
                          "block truncate text-[14px] font-semibold",
                          checked ? "text-ink" : "text-faint line-through",
                        )}
                      >
                        {def.label}
                      </span>
                      {count > 1 && (
                        <span className="block truncate text-[11.5px] font-semibold text-faint">
                          для {count} страв
                        </span>
                      )}
                    </span>
                    {qtyLabel && (
                      <span className="shrink-0 text-[12.5px] font-bold text-muted">{qtyLabel}</span>
                    )}
                  </button>
                );
              })}
            </Panel>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
