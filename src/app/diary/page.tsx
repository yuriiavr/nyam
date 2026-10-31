"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Mic, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PeopleSwitch, personName, usePeople } from "@/components/diary/people";
import { EntrySheet } from "@/components/diary/EntrySheet";
import { PantryTakeSheet } from "@/components/diary/PantryTakeSheet";
import { useFoodFlows } from "@/components/diary/useFoodFlows";
import { restaurantEntryLabel, restaurantIdsOf, useRestaurantMenus } from "@/components/diary/useRestaurantMenus";
import { TopBar } from "@/components/TopBar";
import { MacroGrid, Panel, Skeleton, TILE_BUTTON, TILE_BUTTON_BRAND, formatKcal } from "@/components/ui";
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
  /** Меню закладів, страви з яких є серед записів дня: для підпису «McDonald's · 2 порції». */
  const menus = useRestaurantMenus(restaurantIdsOf(current.entriesList));

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
        <div className="flex flex-col gap-2.5 px-4 pt-1">
          <Skeleton className="h-11 w-full rounded-[10px]" />
          <Skeleton className="h-56 w-full rounded-[10px]" />
          <Skeleton className="h-28 w-full rounded-[10px]" />
          <Skeleton className="h-60 w-full rounded-[10px]" />
        </div>
      </div>
    );
  }

  const peak = Math.max(...chart.map((d) => d.kcal), goal ?? 0, 1);
  const over = goal != null && current.kcal > goal;

  return (
    <div className="pb-6">
      <TopBar
        title="Щоденник"
        railTab
        right={
          <>
            <Link href="/settings#diary" aria-label="Налаштування щоденника" className={TILE_BUTTON}>
              <Settings2 size={18} />
            </Link>
            {own && (
              <button aria-label="Додати їжу" onClick={() => flows.add()} className={TILE_BUTTON_BRAND}>
                <Plus size={19} strokeWidth={2.4} />
              </button>
            )}
          </>
        }
      />

      {/*
        Телефон — одна колонка. Планшет (lg): прийоми їжі сіткою у дві колонки,
        а день, підсумок і графік — у бічній колонці. Обгортки з display:
        contents на телефоні зникають, і порядок задають order-*.
      */}
      <div className="flex flex-col gap-2.5 px-4 md:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-4">
        <aside className="contents lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:flex lg:flex-col lg:gap-3">
        {visible.length > 1 && (
          <PeopleSwitch
            people={visible}
            value={userId}
            onChange={(id) => {
              haptic(8);
              setViewed(id);
            }}
            className="mb-0.5 mt-0.5"
          />
        )}

        {/* День і підсумок */}
        <Panel>
          <div className="flex h-[46px] items-center justify-between px-2">
            <button
              aria-label="Попередній день"
              onClick={() => shiftDay(-1)}
              className="grid h-8 w-8 place-items-center rounded-[8px] bg-surface-2 active:bg-line"
            >
              <ChevronLeft size={17} strokeWidth={2.2} />
            </button>
            <p className="font-display text-[14px] font-bold">{dayLabel(day, today)}</p>
            <button
              aria-label="Наступний день"
              onClick={() => shiftDay(1)}
              disabled={day >= today}
              className="grid h-8 w-8 place-items-center rounded-[8px] bg-surface-2 active:bg-line disabled:opacity-30"
            >
              <ChevronRight size={17} strokeWidth={2.2} />
            </button>
          </div>

          <div className="flex items-center gap-[18px] border-t border-line px-3.5 py-4">
            <GoalRing kcal={current.kcal} goal={goal} />
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              {goal ? (
                <>
                  <span className="text-[12px] font-semibold text-muted">{over ? "Понад ціль" : "Лишилось"}</span>
                  <span className={cn("font-display text-[22px] font-bold leading-tight", over && "text-berry")}>
                    {over ? `+${formatKcal(current.kcal - goal)}` : formatKcal(goal - current.kcal)}{" "}
                    <span className="font-sans text-[13px] font-bold text-muted">ккал</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[12px] font-semibold text-muted">Ціль не задана</span>
                  {own && (
                    <Link href="/settings#diary" className="text-[13.5px] font-bold text-brand">
                      Задати денну ціль
                    </Link>
                  )}
                </>
              )}
              <span className="mt-0.5 text-[11.5px] font-semibold text-faint">
                {current.entries} {plural(current.entries, "запис", "записи", "записів")}
                {current.unknown > 0 && ` · ${current.unknown} без КБЖВ`}
              </span>
            </div>
          </div>

          <MacroGrid
            nutrition={current}
            goals={{ protein: goals.proteinGoal, fat: goals.fatGoal, carbs: goals.carbsGoal }}
            className="border-t border-line px-3.5 pb-3.5 pt-3"
          />
        </Panel>

        {/* Два тижні */}
        <TwoWeeks chart={chart} peak={peak} goal={goal} day={day} today={today} onPick={setDay} />
        </aside>

        <div className="contents lg:col-start-1 lg:row-start-1 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3">

        {/* «Хто їв?» — свіжі готування без поділу */}
        {fresh.map((row) => (
          <motion.div
            key={`${row.event.recipeId}-${row.event.at}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="lg:col-span-2"
          >
            <PromptRow
              emoji={row.recipe.emoji}
              title={row.recipe.title}
              note="Приготовано — хто скільки зʼїв?"
              action="Розділити"
              accent
              onClick={() => askWhoAte(row)}
            />
          </motion.div>
        ))}

        {/* Записане голосом — що взяли з комори? */}
        {toConfirm.map((meal) => (
          <div key={meal.id} className="lg:col-span-2">
          <PromptRow
            emoji={meal.emoji}
            title={meal.title}
            note={
              <span className="flex items-center gap-1">
                <Mic size={12} strokeWidth={2.2} />
                Голосом — що взяли з комори?
              </span>
            }
            action="Перевірити"
            muted
            onClick={() => {
              haptic(10);
              setTakeMeal(meal.id);
            }}
          />
          </div>
        ))}

        {/* Залишки */}
        {day === today &&
          rest.map((meal) => (
            <div key={meal.id} className="lg:col-span-2">
            <PromptRow
              emoji={meal.emoji}
              title={meal.title}
              note={`Лишилось ${portionLabel(leftoverServings(meal, foodLog))}`}
              action="Доїсти"
              onClick={() => {
                haptic(10);
                flows.split({ meal, isNew: false, source: "leftover", slot: slotAt(), day });
              }}
            />
            </div>
          ))}

        {/* Прийоми їжі */}
        {SLOT_ORDER.map((slot) => {
          const list = current.entriesList.filter((e) => e.slot === slot);
          const cookRows = current.cookRows.filter((c) => c.slot === slot);
          if (!own && list.length === 0) return null;
          const kcal =
            list.reduce((sum, e) => sum + (entryNutrition(e, lookup.meal, lookup.recipe)?.kcal ?? 0), 0) +
            cookRows.reduce((sum, c) => sum + (c.nutrition?.kcal ?? 0), 0);
          return (
            <Panel key={slot} className="lg:min-h-[150px]">
              <div className="flex h-[46px] items-center gap-2.5 pl-3.5 pr-2">
                <span className="text-[17px]">{SLOT_META[slot].emoji}</span>
                <h2 className="flex-1 text-[14.5px] font-extrabold">{SLOT_META[slot].label}</h2>
                {kcal > 0 && <span className="text-[12.5px] font-bold text-muted">{formatKcal(kcal)} ккал</span>}
                {own && (
                  <button
                    aria-label={`Додати: ${SLOT_META[slot].label}`}
                    onClick={() => flows.add(slot)}
                    className="grid h-[30px] w-[30px] place-items-center rounded-[8px] bg-surface-2 text-brand active:bg-line"
                  >
                    <Plus size={16} strokeWidth={2.4} />
                  </button>
                )}
              </div>

              {list.map((e) => {
                const n = entryNutrition(e, lookup.meal, lookup.recipe);
                const meal = e.mealId ? lookup.meal(e.mealId) : undefined;
                const amount =
                  restaurantEntryLabel(e, menus) ??
                  (meal && e.share
                    ? portionLabel(Math.round(e.share * meal.servings * 4) / 4)
                    : e.grams != null
                      ? `${formatNumber(e.grams, 0)} г`
                      : "");
                const byOther = e.loggedBy && e.loggedBy !== e.userId;
                const author = byOther ? people.find((p) => p.userId === e.loggedBy) : undefined;
                return (
                  <button
                    key={e.id}
                    onClick={() => {
                      haptic(8);
                      setEntry(e);
                    }}
                    className="flex h-[54px] w-full items-center gap-3 border-t border-line px-3.5 text-left active:bg-surface-2"
                  >
                    <span className="w-6 shrink-0 text-center text-[20px]">{e.emoji}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[14px] font-semibold">{e.title}</span>
                      <span className="truncate text-[11.5px] font-semibold text-faint">
                        {[amount, author ? (author.me ? "записано тобою" : `записано: ${personName(author)}`) : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className={cn("shrink-0 text-[13.5px] font-extrabold", !n && "text-faint")}>
                      {n ? formatKcal(n.kcal) : "—"}
                    </span>
                  </button>
                );
              })}
              {cookRows.map((c) => (
                <button
                  key={`${c.event.recipeId}-${c.event.at}`}
                  onClick={() => askWhoAte(c)}
                  className="flex h-[54px] w-full items-center gap-3 border-t border-line px-3.5 text-left active:bg-surface-2"
                >
                  <span className="w-6 shrink-0 text-center text-[20px]">{c.recipe.emoji}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[14px] font-semibold">{c.recipe.title}</span>
                    <span className="truncate text-[11.5px] font-semibold text-faint">приготовано · рахую 1 порцію, уточнити</span>
                  </span>
                  <span className="shrink-0 text-[13.5px] font-extrabold text-muted">
                    {c.nutrition ? `≈${formatKcal(c.nutrition.kcal)}` : "—"}
                  </span>
                </button>
              ))}
            </Panel>
          );
        })}

        </div>
      </div>

      <EntrySheet entry={entry} onClose={() => setEntry(null)} />
      <PantryTakeSheet mealId={takeMeal} onClose={() => setTakeMeal(null)} />
      {flows.ui}
    </div>
  );
}

/** Рядок-підказка над прийомами їжі: «Грецький салат · Розділити ›». */
function PromptRow({
  emoji,
  title,
  note,
  action,
  accent,
  muted,
  onClick,
}: {
  emoji: string;
  title: string;
  note: React.ReactNode;
  action: string;
  /** Обвідка фірмовим — те, що чекає саме зараз. */
  accent?: boolean;
  /** Дія сірим — перевірка, а не головна справа. */
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex min-h-[60px] w-full items-center gap-3 rounded-[10px] border bg-surface px-3.5 py-2 text-left active:bg-surface-2",
        accent ? "border-brand/35" : "border-line",
      )}
    >
      <span className="text-[24px]">{emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold">{title}</span>
        <span className="block text-[12px] font-semibold text-muted">{note}</span>
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center gap-0.5 text-[13px]",
          muted ? "font-bold text-muted" : "font-extrabold text-brand",
        )}
      >
        {action}
        <ChevronRight size={14} strokeWidth={2.6} />
      </span>
    </button>
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
  const size = 104;
  const stroke = 10;
  const r = (size - stroke) / 2 - 0.5;
  const length = 2 * Math.PI * r;
  const share = goal ? Math.min(kcal / goal, 1) : 0;
  const over = goal != null && kcal > goal;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id="diary-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--brand)" />
            <stop offset="1" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        {goal && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={over ? "var(--berry)" : "url(#diary-ring)"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={length}
            initial={false}
            animate={{ strokeDashoffset: length * (1 - share) }}
            transition={{ type: "spring", stiffness: 120, damping: 22 }}
          />
        )}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-display text-[21px] font-bold leading-none">{formatKcal(kcal)}</span>
        <span className="mt-[3px] text-[11px] font-semibold text-muted">{goal ? `з ${formatKcal(goal)}` : "ккал"}</span>
      </div>
    </div>
  );
}

/** Два тижні стовпчиками: дотик — перейти на той день. */
function TwoWeeks({
  chart,
  peak,
  goal,
  day,
  today,
  onPick,
}: {
  chart: Array<{ key: string; date: Date; kcal: number }>;
  peak: number;
  goal?: number;
  day: string;
  today: string;
  onPick: (key: string) => void;
}) {
  return (
    <Panel className="order-last lg:order-none">
    <div className="flex h-10 items-center justify-between px-3.5">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">Два тижні</span>
      {goal ? (
        <span className="flex items-center gap-[5px] text-[11.5px] font-semibold text-faint">
          <span className="w-3 border-t-[1.5px] border-dashed border-faint" />
          ціль
        </span>
      ) : null}
    </div>
    <div className="border-t border-line px-3 pb-2.5 pt-3.5">
      <div className="relative flex h-[126px] items-end gap-1">
        {goal && (
          <span
            aria-hidden
            // Над підписами днів (≈18 px) — там, де починаються стовпчики.
            style={{ bottom: `calc(18px + (100% - 18px) * ${goal / peak})` }}
            className="pointer-events-none absolute inset-x-0 border-t-[1.5px] border-dashed border-line-strong"
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
                onPick(d.key);
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
                    opacity: active ? 1 : 0.4,
                  }}
                  className="w-full rounded-b-[2px] rounded-t-[4px] transition-[height,opacity] duration-300"
                />
                {d.kcal === 0 && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-line" />}
              </span>
              <span
                className={cn(
                  "text-center text-[10px] font-extrabold",
                  active ? "text-ink" : d.key === today ? "text-brand" : "text-faint",
                )}
              >
                {d.date.getDate()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
        </Panel>
  );
}
