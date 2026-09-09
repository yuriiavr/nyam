"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RotateCw, Swords, Trophy } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, EmptyState, Segmented, useToast } from "@/components/ui";
import { activeFilterCount, applyFilters, emptyFilters, type Filters } from "@/lib/matching";
import { useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { formatMinutes, haptic, shuffle } from "@/lib/utils";

type Size = 4 | 8 | 16;

const ROUND_NAME: Record<number, string> = {
  16: "1/8 фіналу",
  8: "Чвертьфінал",
  4: "Півфінал",
  2: "Фінал",
};

export default function DuelPage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [size, setSize] = useState<Size>(8);

  const [round, setRound] = useState<Recipe[]>([]);
  const [nextRound, setNextRound] = useState<Recipe[]>([]);
  const [pairIndex, setPairIndex] = useState(0);
  const [champion, setChampion] = useState<Recipe | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const pool = useMemo(
    () => (hydrated ? applyFilters(state, filters) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, filters, state.myRecipes, state.saved, state.following, state.cooked],
  );

  const start = useCallback(
    (n: Size = size) => {
      const contenders = shuffle(pool).slice(0, Math.min(n, pool.length));
      setRound(contenders);
      setNextRound([]);
      setPairIndex(0);
      setChampion(null);
      setPicked(null);
    },
    [pool, size],
  );

  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length, size]);

  const left = round[pairIndex * 2];
  const right = round[pairIndex * 2 + 1];
  const totalPairs = Math.floor(round.length / 2);

  const choose = (winner: Recipe) => {
    if (picked) return;
    haptic([16, 30, 16]);
    setPicked(winner.id);

    setTimeout(() => {
      const advanced = [...nextRound, winner];
      const isLastPair = pairIndex + 1 >= totalPairs;

      if (isLastPair) {
        // непарний учасник проходить далі автоматично
        const bye = round.length % 2 === 1 ? [round[round.length - 1]] : [];
        const upcoming = [...advanced, ...bye];
        if (upcoming.length === 1) {
          setChampion(upcoming[0]);
          state.toggleWish(upcoming[0].id);
          haptic([30, 60, 30, 60, 40]);
        } else {
          setRound(upcoming);
          setNextRound([]);
          setPairIndex(0);
        }
      } else {
        setNextRound(advanced);
        setPairIndex((i) => i + 1);
      }
      setPicked(null);
    }, 340);
  };

  if (hydrated && pool.length < 2) {
    return (
      <div>
        <TopBar title="Дуель страв" />
        <EmptyState
          emoji="⚔️"
          title="Замало страв для турніру"
          note="Потрібно щонайменше дві. Послаб фільтри або додай рецепти."
          action={<Button onClick={() => setFilters(emptyFilters)}>Скинути фільтри</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col pb-6">
      <TopBar
        title="Дуель страв"
        subtitle={
          champion
            ? "Переможець визначено"
            : round.length
              ? `${ROUND_NAME[round.length] ?? `Раунд із ${round.length}`} · пара ${pairIndex + 1}/${totalPairs}`
              : ""
        }
        right={
          <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
        }
      />

      {champion ? (
        <ChampionScreen champion={champion} onRestart={() => start()} />
      ) : (
        <>
          <div className="px-4 pt-4">
            <Segmented
              value={String(size) as "4" | "8" | "16"}
              onChange={(v) => setSize(Number(v) as Size)}
              options={[
                { value: "4", label: "4 страви" },
                { value: "8", label: "8 страв" },
                { value: "16", label: "16 страв" },
              ]}
            />
          </div>

          {/* Прогрес */}
          <div className="flex gap-1 px-4 pt-4">
            {Array.from({ length: totalPairs }).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full ${i < pairIndex ? "bg-brand" : i === pairIndex ? "bg-brand/50" : "bg-line"}`}
              />
            ))}
          </div>

          <p className="px-4 pt-4 text-center text-[13px] font-semibold text-muted">
            Що б ти обрав зараз?
          </p>

          <div className="relative flex flex-1 flex-col gap-3 px-4 pt-3">
            {left && (
              <Contender recipe={left} picked={picked} onPick={() => choose(left)} align="top" />
            )}

            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
              <div className="grid h-12 w-12 place-items-center rounded-full border-4 border-bg bg-surface-2">
                <Swords size={20} className="text-brand" />
              </div>
            </div>

            {right && (
              <Contender
                recipe={right}
                picked={picked}
                onPick={() => choose(right)}
                align="bottom"
              />
            )}
          </div>

          <div className="px-4 pt-4">
            <Button
              variant="ghost"
              full
              onClick={() => {
                start();
                toast("Новий турнір", "🔄");
              }}
            >
              <RotateCw size={16} />
              Інші учасники
            </Button>
          </div>
        </>
      )}

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

function Contender({
  recipe,
  picked,
  onPick,
  align,
}: {
  recipe: Recipe;
  picked: string | null;
  onPick: () => void;
  align: "top" | "bottom";
}) {
  const isWinner = picked === recipe.id;
  const isLoser = picked !== null && !isWinner;

  return (
    <motion.button
      layout
      onClick={onPick}
      whileTap={{ scale: 0.97 }}
      animate={{
        scale: isWinner ? 1.02 : isLoser ? 0.94 : 1,
        opacity: isLoser ? 0.35 : 1,
      }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      className={`relative flex-1 overflow-hidden rounded-xl3 border text-left ${
        isWinner ? "border-brand" : "border-line"
      } bg-surface`}
    >
      <RecipeMedia
        recipe={recipe}
        className="absolute inset-0 h-full w-full"
        rounded="rounded-none"
        emojiSize="text-7xl"
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(to ${align === "top" ? "top" : "bottom"}, rgba(0,0,0,.82), rgba(0,0,0,.15))`,
        }}
      />
      <div
        className={`relative flex h-full min-h-[150px] flex-col p-4 ${align === "top" ? "justify-end" : "justify-start"}`}
      >
        <h3 className="font-display text-[18px] font-extrabold leading-tight text-white">
          {recipe.title}
        </h3>
        <p className="mt-1 text-[12px] font-semibold text-white/75">
          {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
        </p>
      </div>

      <AnimatePresence>
        {isWinner && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full brand-gradient text-brand-ink"
          >
            <Trophy size={18} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function ChampionScreen({ champion, onRestart }: { champion: Recipe; onRestart: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center px-4 pt-8">
      <motion.div
        initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="text-6xl"
      >
        🏆
      </motion.div>
      <h2 className="mt-3 font-display text-xl font-extrabold">Чемпіон вечері</h2>
      <p className="mt-1 text-center text-[13px] text-muted">
        Страва пройшла весь турнір — сумнівів більше немає.
      </p>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="mt-6 w-full overflow-hidden rounded-xl3 border border-brand/30 bg-surface"
      >
        <RecipeMedia recipe={champion} className="aspect-[16/10] w-full" rounded="rounded-none" emojiSize="text-7xl" />
        <div className="p-4">
          <h3 className="font-display text-[18px] font-extrabold leading-tight">{champion.title}</h3>
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
            {champion.description}
          </p>
          <div className="mt-4 flex gap-2">
            <Link href={`/recipe/${champion.id}`} className="flex-1">
              <Button variant="secondary" full>
                Рецепт
              </Button>
            </Link>
            <Link href={`/recipe/${champion.id}/cook`} className="flex-1">
              <Button full>Готувати</Button>
            </Link>
          </div>
        </div>
      </motion.div>

      <Button variant="ghost" full className="mt-4" onClick={onRestart}>
        <RotateCw size={16} />
        Ще один турнір
      </Button>
    </div>
  );
}
