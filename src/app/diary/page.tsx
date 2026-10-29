"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Mic, Plus, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { NAV_HEIGHT } from "@/components/BottomNav";
import { PeopleSwitch, personName, usePeople } from "@/components/diary/people";
import { EntrySheet } from "@/components/diary/EntrySheet";
import { PantryTakeSheet } from "@/components/diary/PantryTakeSheet";
import { useFoodFlows } from "@/components/diary/useFoodFlows";
import { TopBar } from "@/components/TopBar";
import { Button, Card, EmptyState, MacroBar, Skeleton } from "@/components/ui";
import {
  SLOT_META,
  SLOT_ORDER,
  ZERO,
  addNutrition,
  entriesOn,
  entryNutrition,
  isFreshCook,
  leftoverServings,
  leftovers,
  mealFromRecipe,
  pantryPending,
  portionLabel,
  recipeMealNutrition,
  roundNutrition,
  settingsOf,
  slotAt,
  sumEntries,
  unloggedCooks,
  type DayTotals,
} from "@/lib/diary";
import { diaryUserId, recipeById, useApp } from "@/lib/store";
import type { CookEvent, FoodEntry, MealSlot, Nutrition, Recipe } from "@/lib/types";
import { formatNumber } from "@/lib/units";
import { cn, dateKey, haptic, newId, plural } from "@/lib/utils";

/**
 * Щоденник харчування: що зʼїв сьогодні і скільки це калорій.
 *
 * Записує людина — сканом, пошуком, описом словами — або кухар за всю
 * сімʼю одним поділом страви. Старі готування без поділу (до щоденника)
 * рахуються як раніше: одна порція на приготування, з позначкою «оцінка»,
 * а свіжі — питають «хто їв?», бо тепер є точніша відповідь.
 */

const CHART_DAYS = 14;

/** Готування без запису, показане рядком дня: одна порція, поки не уточнили. */
interface CookRow {
  event: CookEvent;
  recipe: Recipe;
  nutrition?: Nutrition;
  slot: MealSlot;
}

export default function DiaryPage() {
  const hydrated = useApp((s) => s.hydrated);
  const account = useApp((s) => s.account);
  const foodLog = useApp((s) => s.foodLog);
  const meals = useApp((s) => s.meals);
  const cooked = useApp((s) => s.cooked);
  const settings = useApp((s) => s.diarySettings);
  // Рецепти — лише як привід перерахувати: КБЖВ страви береться з них.
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);

  const people = usePeople();
  const me = diaryUserId({ account });
  const [viewed, setViewed] = useState<string | null>(null);
  const [day, setDay] = useState(() => dateKey());
  const [entry, setEntry] = useState<FoodEntry | null>(null);
  const [takeMeal, setTakeMeal] = useState<string | null>(null);

  /*
   * /diary?take=<id страви> — посилання від голосового помічника: «що взяли з
   * комори?». Читаємо після монтування, без useSearchParams (як /decide/fridge),
   * і прибираємо з адреси, щоб оновлення сторінки не відкривало аркуш знову.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("take");
    if (!id) return;
    setTakeMeal(id);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // Чужий щоденник — лише відкритий власником.
  const visible = people.filter((p) => p.me || p.shareDiary);
  const who = visible.find((p) => p.userId === viewed) ?? visible[0];
  const own = !who || who.me;
  const userId = who?.userId ?? me;

  const flows = useFoodFlows({ day, forUser: userId });
  const goals = settingsOf(settings, userId);
  const goal = goals.kcalGoal;
  const today = dateKey();

  const lookup = useMemo(() => {
    const state = useApp.getState();
    const byId = new Map(meals.map((m) => [m.id, m]));
    return {
      meal: (id: string) => byId.get(id),
      recipe: (id: string) => recipeById(state, id),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meals, myRecipes, remoteRecipes]);

  /** Готування без страви в щоденнику — лише в своєму: чужих готувань ми не знаємо. */
  const cooks = useMemo<CookRow[]>(() => {
    if (!own) return [];
    return unloggedCooks(cooked, meals).flatMap((event) => {
      const recipe = lookup.recipe(event.recipeId);
      if (!recipe) return [];
      return [{ event, recipe, nutrition: recipeMealNutrition(recipe, 1), slot: slotAt(new Date(event.at)) }];
    });
  }, [own, cooked, meals, lookup]);

  const totalsFor = (key: string): DayTotals & { entriesList: FoodEntry[]; cookRows: CookRow[] } => {
    const list = entriesOn(foodLog, userId, key);
    const cookRows = cooks.filter((c) => dateKey(new Date(c.event.at)) === key);
    const base = sumEntries(list, (e) => entryNutrition(e, lookup.meal, lookup.recipe));
    const extra = cookRows.reduce<Nutrition>((sum, c) => (c.nutrition ? addNutrition(sum, c.nutrition) : sum), ZERO);
    return {
      ...roundNutrition(addNutrition(base, extra)),
      entries: base.entries + cookRows.length,
      unknown: base.unknown + cookRows.filter((c) => !c.nutrition).length,
      entriesList: list,
      cookRows,
    };
  };

  const current = useMemo(
    () => totalsFor(day),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day, foodLog, userId, cooks, lookup],
  );

  const chart = useMemo(() => {
    const now = new Date();
    return Array.from({ length: CHART_DAYS }, (_, i) => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (CHART_DAYS - 1 - i));
      const key = dateKey(date);
      return { date, key, kcal: totalsFor(key).kcal };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodLog, userId, cooks, lookup]);

  const fresh = cooks.filter((c) => isFreshCook(c.event));
  const toConfirm = own ? pantryPending(meals, foodLog, me) : [];
  const rest = own ? leftovers(meals, foodLog) : [];

  const askWhoAte = (row: CookRow) => {
    haptic(10);
    flows.split({
      meal: mealFromRecipe(row.recipe, { id: newId(), ownerId: me, cookedAt: row.event.at }),
      isNew: true,
      source: "cook",
      slot: row.slot,
      day: dateKey(new Date(row.event.at)),
    });
  };

  const shiftDay = (delta: number) => {
    const [y, m, d] = day.split("-").map(Number);
    const next = dateKey(new Date(y, m - 1, d + delta));
    if (next > today) return;
    haptic(8);
    setDay(next);
  };

  if (!hydrated) {
    return (
      <div className="pb-8">
        <TopBar title="Щоденник" />
        <div className="flex flex-col gap-4 p-4">
          <Skeleton className="h-44 w-full rounded-xl3" />
          <Skeleton className="h-28 w-full rounded-xl3" />
          <Skeleton className="h-60 w-full rounded-xl3" />
        </div>
      </div>
    );
  }

  const empty = current.entries === 0;
  const peak = Math.max(...chart.map((d) => d.kcal), goal ?? 0, 1);

  return (
    <div className="pb-28">
      <TopBar
        title="Щоденник"
        subtitle={own ? "Що зʼїв і скільки це калорій" : `Щоденник: ${who ? personName(who) : ""}`}
        right={
          <Link
            href="/settings#diary"
            aria-label="Налаштування щоденника"
            className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2/80 active:bg-line"
          >
            <Settings2 size={19} />
          </Link>
        }
      />

      {visible.length > 1 && (
        <PeopleSwitch
          people={visible}
          value={userId}
          onChange={(id) => {
            haptic(8);
            setViewed(id);
          }}
          className="px-4 pt-3"
        />
      )}

      {/* День і підсумок */}
      <section className="px-4 pt-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <button
              aria-label="Попередній день"
              onClick={() => shiftDay(-1)}
              className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 active:bg-line"
            >
              <ChevronLeft size={18} />
            </button>
            <p className="font-display text-[15px] font-bold">{dayLabel(day, today)}</p>
            <button
              aria-label="Наступний день"
              onClick={() => shiftDay(1)}
              disabled={day >= today}
              className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 active:bg-line disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-4">
            <GoalRing kcal={current.kcal} goal={goal} />
            <div className="min-w-0 flex-1">
              {goal ? (
                current.kcal <= goal ? (
                  <>
                    <p className="text-[12px] text-muted">Лишилось</p>
                    <p className="font-display text-[22px] font-extrabold leading-tight">
                      {goal - current.kcal} <span className="text-[13px] font-bold text-muted">ккал</span>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[12px] text-muted">Понад ціль</p>
                    <p className="font-display text-[22px] font-extrabold leading-tight text-berry">
                      +{current.kcal - goal} <span className="text-[13px] font-bold text-muted">ккал</span>
                    </p>
                  </>
                )
              ) : (
                <>
                  <p className="text-[12px] text-muted">Ціль не задана</p>
                  {own && (
                    <Link href="/settings#diary" className="text-[13px] font-bold text-brand">
                      Задати денну ціль
                    </Link>
                  )}
                </>
              )}
              <p className="mt-1 text-[11.5px] text-faint">
                {current.entries} {plural(current.entries, "запис", "записи", "записів")}
                {current.unknown > 0 && ` · ${current.unknown} без КБЖВ`}
              </p>
            </div>
          </div>

          {current.kcal > 0 && (
            <MacroBar
              nutrition={current}
              goals={{ protein: goals.proteinGoal, fat: goals.fatGoal, carbs: goals.carbsGoal }}
              className="mt-4"
            />
          )}
        </Card>
      </section>

      {/* «Хто їв?» — свіжі готування без поділу */}
      {fresh.length > 0 && (
        <section className="flex flex-col gap-2 px-4 pt-4">
          {fresh.map((row) => (
            <motion.div key={`${row.event.recipeId}-${row.event.at}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="flex items-center gap-3 p-3">
                <span className="text-2xl">{row.recipe.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">{row.recipe.title}</p>
                  <p className="text-[12px] text-muted">Приготовано — хто скільки зʼїв?</p>
                </div>
                <Button size="sm" onClick={() => askWhoAte(row)}>
                  <Users size={15} />
                  Розділити
                </Button>
              </Card>
            </motion.div>
          ))}
        </section>
      )}

      {/* Записане голосом — що взяли з комори? */}
      {toConfirm.length > 0 && (
        <section className="flex flex-col gap-2 px-4 pt-4">
          {toConfirm.map((meal) => (
            <Card key={meal.id} className="flex items-center gap-3 p-3">
              <span className="text-2xl">{meal.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold">{meal.title}</p>
                <p className="flex items-center gap-1 text-[12px] text-muted">
                  <Mic size={12} />
                  Записано голосом — що взяли з комори?
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  haptic(10);
                  setTakeMeal(meal.id);
                }}
              >
                Перевірити
              </Button>
            </Card>
          ))}
        </section>
      )}

      {/* Залишки */}
      {rest.length > 0 && day === today && (
        <section className="px-4 pt-4">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {rest.map((meal) => (
              <button
                key={meal.id}
                onClick={() => {
                  haptic(10);
                  flows.split({ meal, isNew: false, source: "leftover", slot: slotAt(), day });
                }}
                className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-line bg-surface py-2 pl-2.5 pr-3.5 text-left"
              >
                <span className="text-xl">{meal.emoji}</span>
                <span>
                  <span className="block max-w-[150px] truncate text-[13px] font-bold">{meal.title}</span>
                  <span className="block text-[11.5px] text-muted">
                    лишилось {portionLabel(leftoverServings(meal, foodLog))} · <span className="font-bold text-brand">доїсти</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Прийоми їжі */}
      <section className="flex flex-col gap-3 px-4 pt-4">
        {empty && own && day === today ? (
          <Card className="p-2">
            <EmptyState
              emoji="🥣"
              title="Сьогодні ще нічого"
              note="Відскануй батончик, знайди йогурт або просто напиши «запечена картопля з сосисками» — калорії порахуються самі."
              action={
                <Button onClick={() => flows.add()}>
                  <Plus size={17} />
                  Додати їжу
                </Button>
              }
            />
          </Card>
        ) : (
          SLOT_ORDER.map((slot) => {
            const list = current.entriesList.filter((e) => e.slot === slot);
            const cookRows = current.cookRows.filter((c) => c.slot === slot);
            if (!own && list.length === 0) return null;
            const kcal =
              list.reduce((sum, e) => sum + (entryNutrition(e, lookup.meal, lookup.recipe)?.kcal ?? 0), 0) +
              cookRows.reduce((sum, c) => sum + (c.nutrition?.kcal ?? 0), 0);
            return (
              <Card key={slot} className="p-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{SLOT_META[slot].emoji}</span>
                  <h2 className="flex-1 font-display text-[15px] font-bold">{SLOT_META[slot].label}</h2>
                  {kcal > 0 && <span className="text-[13px] font-bold text-muted">{Math.round(kcal)} ккал</span>}
                  {own && (
                    <button
                      aria-label={`Додати: ${SLOT_META[slot].label}`}
                      onClick={() => flows.add(slot)}
                      className="grid h-8 w-8 place-items-center rounded-xl bg-surface-2 text-brand active:bg-line"
                    >
                      <Plus size={17} />
                    </button>
                  )}
                </div>

                {(list.length > 0 || cookRows.length > 0) && (
                  <div className="mt-2 flex flex-col">
                    {list.map((e) => {
                      const n = entryNutrition(e, lookup.meal, lookup.recipe);
                      const meal = e.mealId ? lookup.meal(e.mealId) : undefined;
                      const amount =
                        meal && e.share
                          ? portionLabel(Math.round(e.share * meal.servings * 4) / 4)
                          : e.grams != null
                            ? `${formatNumber(e.grams, 0)} г`
                            : "";
                      const byOther = e.loggedBy && e.loggedBy !== e.userId;
                      const author = byOther ? people.find((p) => p.userId === e.loggedBy) : undefined;
                      return (
                        <button
                          key={e.id}
                          onClick={() => {
                            haptic(8);
                            setEntry(e);
                          }}
                          className="flex items-center gap-3 border-t border-line py-2.5 text-left first:border-0"
                        >
                          <span className="text-xl">{e.emoji}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold">{e.title}</span>
                            <span className="block truncate text-[11.5px] text-muted">
                              {[amount, author ? (author.me ? "записано тобою" : `записано: ${personName(author)}`) : ""]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                          <span className="shrink-0 text-[13px] font-bold">{n ? `${n.kcal}` : "—"}</span>
                        </button>
                      );
                    })}
                    {cookRows.map((c) => (
                      <button
                        key={`${c.event.recipeId}-${c.event.at}`}
                        onClick={() => askWhoAte(c)}
                        className="flex items-center gap-3 border-t border-line py-2.5 text-left first:border-0"
                      >
                        <span className="text-xl">{c.recipe.emoji}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold">{c.recipe.title}</span>
                          <span className="block text-[11.5px] text-muted">приготовано · рахую 1 порцію, уточнити</span>
                        </span>
                        <span className="shrink-0 text-[13px] font-bold text-muted">
                          {c.nutrition ? `≈${c.nutrition.kcal}` : "—"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </section>

      {/* Два тижні */}
      <section className="px-4 pt-4">
        <Card className="p-4">
          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-muted">Два тижні</h2>
          <div className="relative flex h-[120px] items-end gap-[3px]">
            {goal && (
              <span
                aria-hidden
                // Над підписами днів (≈18 px) — там, де починаються стовпчики.
                style={{ bottom: `calc(18px + (100% - 18px) * ${goal / peak})` }}
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-faint/60"
              />
            )}
            {chart.map((d) => {
              const active = d.key === day;
              const height = d.kcal > 0 ? Math.max((d.kcal / peak) * 100, 4) : 0;
              return (
                <button
                  key={d.key}
                  onClick={() => {
                    haptic(8);
                    setDay(d.key);
                  }}
                  aria-label={`${d.date.toLocaleDateString("uk-UA", { day: "numeric", month: "long" })}: ${d.kcal} ккал`}
                  aria-pressed={active}
                  className="flex h-full flex-1 flex-col justify-end gap-1.5"
                >
                  <span className="relative flex h-full items-end">
                    <span
                      style={{
                        height: `${height}%`,
                        background: goal && d.kcal > goal ? "var(--berry)" : "var(--chart-bar)",
                        opacity: active ? 1 : 0.45,
                      }}
                      className="w-full rounded-t-[4px]"
                    />
                    {d.kcal === 0 && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-line" />}
                  </span>
                  <span
                    className={cn(
                      "text-[9.5px] font-bold",
                      active ? "text-ink" : d.key === today ? "text-brand" : "text-faint",
                    )}
                  >
                    {d.date.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      </section>

      {own && (
        <div
          style={{ bottom: `calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom) + var(--cook-dock, 0px) + 14px)` }}
          className="pointer-events-none fixed inset-x-0 z-[35] mx-auto flex max-w-[560px] justify-end px-4"
        >
          <Button className="pointer-events-auto rounded-full shadow-[var(--shadow-pop)]" onClick={() => flows.add()}>
            <Plus size={18} />
            Додати їжу
          </Button>
        </div>
      )}

      <EntrySheet entry={entry} onClose={() => setEntry(null)} />
      <PantryTakeSheet mealId={takeMeal} onClose={() => setTakeMeal(null)} />
      {flows.ui}
    </div>
  );
}

function dayLabel(day: string, today: string): string {
  if (day === today) return "Сьогодні";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === dateKey(yesterday)) return "Вчора";
  return date.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "long" });
}

/** Кільце «зʼїдено з цілі». Без цілі — просто число в колі. */
function GoalRing({ kcal, goal }: { kcal: number; goal?: number }) {
  const size = 112;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const share = goal ? Math.min(kcal / goal, 1) : 0;
  const over = goal != null && kcal > goal;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {goal && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={over ? "var(--berry)" : "var(--brand)"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={length}
            initial={false}
            animate={{ strokeDashoffset: length * (1 - share) }}
            transition={{ type: "spring", stiffness: 120, damping: 22 }}
          />
        )}
      </svg>
      <div className="absolute text-center">
        <p className="font-display text-[24px] font-extrabold leading-none">{kcal}</p>
        <p className="mt-0.5 text-[11px] text-muted">{goal ? `з ${goal}` : "ккал"}</p>
      </div>
    </div>
  );
}
