"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Shuffle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { DrinkPicks, PairingSuggestions } from "@/components/Pairings";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, EmptyState, Panel, PanelHeader, Segmented, useToast } from "@/components/ui";
import {
  activeFilterCount,
  applyFilters,
  emptyFilters,
  suggestable,
  type Filters,
  type Pool,
} from "@/lib/matching";
import { COURSE_LABEL, WHEEL_COURSES, courseOf } from "@/lib/pairing";
import { useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { formatMinutes, haptic, plural, shuffle } from "@/lib/utils";

/**
 * Звідки брати страви. Чотири джерела замість шести зі списку фільтрів:
 * крутити «збережені» чи «хочу приготувати» сенсу мало — там і так десяток
 * страв, які ти й без колеса памʼятаєш.
 */
const WHEEL_POOLS: Array<{ value: Pool; label: string }> = [
  { value: "all", label: "Усі" },
  { value: "mine", label: "Мої" },
  { value: "community", label: "Спільнота" },
  { value: "following", label: "Підписки" },
];

const SEGMENTS = 8;
const SEG = 360 / SEGMENTS;
const R = 150;
const CX = 160;
const CY = 160;

function polar(deg: number, radius: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: CX + radius * Math.cos(a), y: CY + radius * Math.sin(a) };
}

function segmentPath(i: number) {
  const start = polar(i * SEG, R);
  const end = polar((i + 1) * SEG, R);
  return `M ${CX} ${CY} L ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y} Z`;
}

export default function RoulettePage() {
  /*
   * Читаємо саме те, від чого залежить вибірка. Підписка на весь стор
   * перемальовувала б сторінку від будь-якої зміни — хоч від кількості солі
   * в коморі, хоч від чужого лайка, що прилетів через realtime.
   */
  const myRecipes = useApp((s) => s.myRecipes);
  const saved = useApp((s) => s.saved);
  const wishlist = useApp((s) => s.wishlist);
  const following = useApp((s) => s.following);
  const cooked = useApp((s) => s.cooked);
  const toggleWish = useApp((s) => s.toggleWish);
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [wheel, setWheel] = useState<Recipe[]>([]);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<Recipe | null>(null);

  const pool = useMemo(() => {
    if (!hydrated) return [];
    const state = useApp.getState();
    const matched = applyFilters(state, filters, suggestable(state));
    /*
     * У барабан ідуть страви, а не доповнення до них: соус чи напій, що
     * випав замість вечері, — це не відповідь на питання «що готувати».
     * Але якщо частину страви обрано у фільтрах явно, слухаємось її.
     */
    if (filters.courses.length) return matched;
    return matched.filter((r) => WHEEL_COURSES.includes(courseOf(r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, filters, myRecipes, saved, wishlist, following, cooked]);

  /* Джерело має власний перемикач, тож у лічильнику фільтрів його не рахуємо. */
  const filterCount =
    activeFilterCount(filters) - (filters.pool === "all" ? 0 : 1);

  const reshuffle = useCallback(() => {
    setWheel(shuffle(pool).slice(0, SEGMENTS));
    setWinner(null);
  }, [pool]);

  useEffect(() => {
    reshuffle();
  }, [reshuffle]);

  const spin = () => {
    if (spinning || wheel.length === 0) return;
    haptic([10, 30, 10, 30, 20]);
    setWinner(null);
    setSpinning(true);

    const idx = Math.floor(Math.random() * wheel.length);
    const targetMod = ((-(idx * SEG + SEG / 2) % 360) + 360) % 360;
    const currentMod = ((rotation % 360) + 360) % 360;
    let delta = targetMod - currentMod;
    if (delta <= 0) delta += 360;

    setRotation(rotation + 360 * 5 + delta);
    // Переможець стане відомим у onAnimationComplete
    setTimeout(() => setWinner(wheel[idx]), 4200);
  };

  return (
    <div className="pb-8">
      <TopBar
        title="Рулетка"
        right={<FilterButton count={filterCount} onClick={() => setFiltersOpen(true)} />}
      />

      <div className="flex flex-col gap-3.5 px-4 md:px-6">
        <Segmented
          value={filters.pool}
          onChange={(pool) => setFilters((f) => ({ ...f, pool }))}
          options={WHEEL_POOLS}
        />

        {pool.length === 0 ? (
          <EmptyState
            emoji="🎡"
            title={filters.pool === "all" ? "Нічого не підходить" : "Тут поки порожньо"}
            note={
              filterCount > 0
                ? "Спробуй послабити умови — наприклад, прибрати обмеження часу."
                : "У цьому джерелі ще немає страв. Обери інше або додай свій рецепт."
            }
            action={
              filterCount > 0 ? (
                <Button onClick={() => setFilters({ ...emptyFilters, pool: filters.pool })}>Скинути фільтри</Button>
              ) : undefined
            }
          />
        ) : (
          /*
            Планшет (lg): колесо на темній сцені ліворуч, керування й результат —
            у бічній колонці на 340 px. На телефоні обгортки з display: contents
            зникають, і все стоїть однією колонкою по центру.
          */
          <div className="flex flex-col items-center gap-3.5 pt-1.5 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4 lg:pt-0">
            <div className="contents lg:sticky lg:top-4 lg:grid lg:h-[calc(100dvh-150px)] lg:min-h-[400px] lg:place-items-center lg:rounded-[10px] lg:border lg:border-line lg:bg-bg-elev lg:py-10">
            {/* Колесо */}
            <div className="relative aspect-square w-[300px] max-w-[80vw] lg:w-[min(400px,calc(100dvh-220px))] lg:max-w-none">
              {/* Стрілка */}
              <div
                className="absolute left-1/2 top-[-6px] z-20 h-0 w-0 -translate-x-1/2 drop-shadow-[0_4px_8px_rgb(255_107_53_/_0.5)]"
                style={{
                  borderLeft: "11px solid transparent",
                  borderRight: "11px solid transparent",
                  borderTop: "20px solid var(--brand)",
                }}
              />

              <motion.svg
                viewBox="0 0 320 320"
                animate={{ rotate: rotation }}
                transition={{ duration: 4.2, ease: [0.16, 0.9, 0.24, 1] }}
                onAnimationComplete={() => {
                  if (spinning) {
                    setSpinning(false);
                    haptic([30, 60, 30]);
                  }
                }}
                className="h-full w-full rounded-full border-2 border-line"
              >
                {wheel.map((r, i) => {
                  const mid = polar(i * SEG + SEG / 2, R * 0.68);
                  return (
                    <g key={r.id}>
                      <path d={segmentPath(i)} fill={i % 2 ? "var(--surface-2)" : "var(--surface)"} />
                      <text
                        x={mid.x}
                        y={mid.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={32}
                        transform={`rotate(${i * SEG + SEG / 2} ${mid.x} ${mid.y})`}
                      >
                        {r.emoji}
                      </text>
                    </g>
                  );
                })}
              </motion.svg>

              <div className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full brand-gradient text-[22px] shadow-[0_0_0_6px_var(--bg)]">
                🎲
              </div>
            </div>
            </div>

            <div className="contents lg:flex lg:flex-col lg:gap-3">
            {/* Що випаде — заглушка в бічній колонці, поки колесо не крутили */}
            {!winner && (
              <Panel className="hidden lg:block">
                <PanelHeader label="Що сьогодні?" tone="brand" />
                <div className="flex flex-col items-center gap-2 border-t border-line px-4 py-8 text-center">
                  <span className="text-[56px] leading-none">{spinning ? "🌀" : "🍽️"}</span>
                  <p className="text-[14px] font-bold">{spinning ? "Крутиться…" : "Крутни колесо — доля обере"}</p>
                  <p className="text-[12.5px] font-semibold text-faint">Тут зʼявиться страва, рецепт і що до неї подати</p>
                </div>
              </Panel>
            )}

            {/* Керування */}
            <div className="flex w-full gap-2">
              <button
                onClick={() => {
                  haptic(12);
                  reshuffle();
                }}
                disabled={spinning}
                aria-label="Перемішати страви на колесі"
                className="grid h-[50px] w-[54px] shrink-0 place-items-center rounded-[10px] bg-surface-2 active:bg-line disabled:opacity-40"
              >
                <Shuffle size={19} />
              </button>
              <button
                onClick={spin}
                disabled={spinning}
                className="h-[50px] flex-1 rounded-[10px] brand-gradient text-[15.5px] font-extrabold text-brand-ink transition-opacity disabled:opacity-60"
              >
                {spinning ? "Крутиться…" : winner ? "Ще раз" : "Крутити"}
              </button>
            </div>

            <p className="-mt-1 text-center text-[11.5px] font-semibold text-faint">
              На колесі 8 випадкових з {pool.length} {plural(pool.length, "страви", "страв", "страв")}
            </p>

            {/* Результат */}
            <AnimatePresence>
              {winner && !spinning && (
                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 300, damping: 24 }}
                  className="flex w-full flex-col gap-2.5"
                >
                  <Panel>
                    <PanelHeader
                      label="Доля обрала"
                      tone="brand"
                      aside={COURSE_LABEL[courseOf(winner)].toLowerCase()}
                    />
                    <Link
                      href={`/recipe/${winner.id}`}
                      className="flex items-center gap-3 border-t border-line px-3.5 pb-3 pt-2.5 active:bg-surface-2"
                    >
                      <RecipeMedia recipe={winner} className="h-14 w-14 shrink-0" rounded="rounded-[8px]" emojiSize="text-[28px]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-extrabold">{winner.title}</span>
                        <span className="block truncate text-[12px] font-semibold text-muted">
                          {formatMinutes(winner.timeMin)} · {winner.cuisine}
                        </span>
                      </span>
                      <span className="shrink-0 text-[13px] font-extrabold text-brand">Рецепт ›</span>
                    </Link>
                    <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
                      <button
                        onClick={() => {
                          toggleWish(winner.id);
                          toast("Додано в «хочу приготувати»", "📌");
                        }}
                        className="h-11 bg-surface text-[13.5px] font-bold text-muted active:bg-surface-2"
                      >
                        Пізніше
                      </button>
                      <Link
                        href={`/recipe/${winner.id}/cook`}
                        className="grid h-11 place-items-center bg-surface text-[13.5px] font-extrabold text-brand active:bg-surface-2"
                      >
                        Готувати зараз
                      </Link>
                    </div>
                  </Panel>
                  <PairingSuggestions recipe={winner} limit={2} />
                  <DrinkPicks recipe={winner} />
                </motion.div>
              )}
            </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      <FilterSheet
        suggesting
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        value={filters}
        onChange={setFilters}
        resultCount={pool.length}
        hidePool
      />
    </div>
  );
}
