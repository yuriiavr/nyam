"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RotateCw, Shuffle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, EmptyState, useToast } from "@/components/ui";
import { activeFilterCount, applyFilters, emptyFilters, type Filters } from "@/lib/matching";
import { allRecipes, useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { formatMinutes, haptic, plural, shuffle } from "@/lib/utils";

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
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [wheel, setWheel] = useState<Recipe[]>([]);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<Recipe | null>(null);

  const pool = useMemo(
    () => (hydrated ? applyFilters(state, filters) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, filters, state.myRecipes, state.saved, state.wishlist, state.following, state.cooked],
  );

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
    const targetMod = (((-(idx * SEG + SEG / 2)) % 360) + 360) % 360;
    const currentMod = ((rotation % 360) + 360) % 360;
    let delta = targetMod - currentMod;
    if (delta <= 0) delta += 360;

    setRotation(rotation + 360 * 5 + delta);
    // Переможець стане відомим у onAnimationComplete
    setTimeout(() => setWinner(wheel[idx]), 4200);
  };

  if (hydrated && pool.length === 0) {
    return (
      <div>
        <TopBar
          title="Рулетка"
          right={
            <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
          }
        />
        <EmptyState
          emoji="🎡"
          title="Під фільтри нічого не підходить"
          note="Спробуй послабити умови — наприклад, прибрати обмеження часу."
          action={<Button onClick={() => setFilters(emptyFilters)}>Скинути фільтри</Button>}
        />
        <FilterSheet
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          value={filters}
          onChange={setFilters}
          resultCount={pool.length}
        />
      </div>
    );
  }

  return (
    <div className="pb-8">
      <TopBar
        title="Рулетка страв"
        subtitle={`${pool.length} ${plural(pool.length, "страва", "страви", "страв")} у барабані`}
        right={
          <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
        }
      />

      <div className="flex flex-col items-center px-4 pt-6">
        {/* Колесо */}
        <div className="relative">
          {/* Стрілка */}
          <div className="absolute left-1/2 top-[-6px] z-20 -translate-x-1/2">
            <div
              className="h-6 w-6 rounded-b-[3px] brand-gradient shadow-[var(--shadow-pop)]"
              style={{ clipPath: "polygon(50% 100%, 0 0, 100% 0)" }}
            />
          </div>

          <div className="rounded-full border-[6px] border-surface-2 bg-bg-elev p-1 shadow-[var(--shadow-card)]">
            <motion.svg
              width={320}
              height={320}
              viewBox="0 0 320 320"
              animate={{ rotate: rotation }}
              transition={{ duration: 4.2, ease: [0.16, 0.9, 0.24, 1] }}
              onAnimationComplete={() => {
                if (spinning) {
                  setSpinning(false);
                  haptic([30, 60, 30]);
                }
              }}
              className="max-w-[78vw]"
            >
              <defs>
                {wheel.map((r, i) => (
                  <linearGradient key={r.id} id={`seg-${i}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={r.gradient[0]} />
                    <stop offset="100%" stopColor={r.gradient[1]} />
                  </linearGradient>
                ))}
              </defs>

              {wheel.map((r, i) => {
                const mid = polar(i * SEG + SEG / 2, R * 0.66);
                return (
                  <g key={r.id}>
                    <path
                      d={segmentPath(i)}
                      fill={`url(#seg-${i})`}
                      stroke="var(--bg-elev)"
                      strokeWidth={2}
                      opacity={0.92}
                    />
                    <text
                      x={mid.x}
                      y={mid.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={34}
                      transform={`rotate(${i * SEG + SEG / 2} ${mid.x} ${mid.y})`}
                    >
                      {r.emoji}
                    </text>
                  </g>
                );
              })}

              <circle cx={CX} cy={CY} r={30} fill="var(--bg-elev)" stroke="var(--line)" strokeWidth={2} />
              <text
                x={CX}
                y={CY}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={22}
              >
                🍽️
              </text>
            </motion.svg>
          </div>
        </div>

        {/* Керування */}
        <div className="mt-6 flex w-full max-w-sm gap-2">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              haptic(12);
              reshuffle();
            }}
            disabled={spinning}
            className="w-14 px-0"
            aria-label="Оновити страви на колесі"
          >
            <Shuffle size={19} />
          </Button>
          <Button full size="lg" onClick={spin} loading={spinning} className="flex-1">
            <RotateCw size={19} />
            Крутити
          </Button>
        </div>

        <p className="mt-3 text-center text-[12px] text-muted">
          На колесі 8 випадкових страв із {pool.length}. Натисни «перемішати», щоб змінити склад.
        </p>

        {/* Результат */}
        <AnimatePresence>
          {winner && !spinning && (
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className="mt-6 w-full overflow-hidden rounded-xl3 border border-brand/30 bg-surface"
            >
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <span className="text-xl">🎉</span>
                <p className="text-[13px] font-bold">Доля обрала за тебе</p>
              </div>
              <Link href={`/recipe/${winner.id}`} className="flex gap-3 p-3.5">
                <RecipeMedia
                  recipe={winner}
                  className="h-20 w-20 shrink-0"
                  rounded="rounded-2xl"
                  emojiSize="text-4xl"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-[17px] font-extrabold leading-tight">
                    {winner.title}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-muted">
                    {winner.description}
                  </p>
                  <p className="mt-1.5 text-[12px] font-bold text-brand">
                    {formatMinutes(winner.timeMin)} · {winner.cuisine}
                  </p>
                </div>
              </Link>
              <div className="flex gap-2 px-3.5 pb-3.5">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    state.toggleWish(winner.id);
                    toast("Додано в «хочу приготувати»", "📌");
                  }}
                >
                  Пізніше
                </Button>
                <Link href={`/recipe/${winner.id}/cook`} className="flex-1">
                  <Button full>Готувати</Button>
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        value={filters}
        onChange={setFilters}
        resultCount={pool.length}
      />
    </div>
  );
}
