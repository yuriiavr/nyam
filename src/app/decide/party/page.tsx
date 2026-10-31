"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Plus, Trophy, Users, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { EmptyState, Panel, PanelHeader } from "@/components/ui";
import {
  activeFilterCount,
  applyFilters,
  emptyFilters,
  suggestable,
  type Filters,
} from "@/lib/matching";
import { useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { cn, formatMinutes, haptic, plural, shuffle } from "@/lib/utils";

type Phase = "setup" | "handoff" | "voting" | "result";

const PRIMARY =
  "flex h-[52px] items-center justify-center gap-2 rounded-[12px] brand-gradient text-[15px] font-extrabold text-brand-ink";
const SECONDARY =
  "flex h-[52px] items-center justify-center gap-2 rounded-[12px] bg-surface-2 text-[15px] font-bold active:bg-line";

const AVATARS = ["🦊", "🐼", "🐸", "🐙", "🦄", "🐯", "🐨", "🦖"];
const ROUND_SIZE = 8;

export default function PartyPage() {
  const myRecipes = useApp((s) => s.myRecipes);
  const saved = useApp((s) => s.saved);
  const following = useApp((s) => s.following);
  const hydrated = useApp((s) => s.hydrated);

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [phase, setPhase] = useState<Phase>("setup");
  const [names, setNames] = useState<string[]>(["Я", "Друг"]);
  const [draft, setDraft] = useState("");
  const [deck, setDeck] = useState<Recipe[]>([]);
  const [voterIndex, setVoterIndex] = useState(0);
  const [cardIndex, setCardIndex] = useState(0);
  /** votes[recipeId] = кількість голосів «за» */
  const [votes, setVotes] = useState<Record<string, number>>({});

  const pool = useMemo(
    () =>
      hydrated
        ? applyFilters(useApp.getState(), filters, suggestable(useApp.getState()))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, filters, myRecipes, saved, following],
  );

  const start = () => {
    if (names.length < 2 || pool.length < 2) return;
    haptic(14);
    setDeck(shuffle(pool).slice(0, Math.min(ROUND_SIZE, pool.length)));
    setVotes({});
    setVoterIndex(0);
    setCardIndex(0);
    setPhase("handoff");
  };

  const vote = (yes: boolean) => {
    const recipe = deck[cardIndex];
    haptic(yes ? [14, 24, 14] : 10);
    if (yes) setVotes((v) => ({ ...v, [recipe.id]: (v[recipe.id] ?? 0) + 1 }));

    if (cardIndex + 1 < deck.length) {
      setCardIndex((i) => i + 1);
    } else if (voterIndex + 1 < names.length) {
      setVoterIndex((i) => i + 1);
      setCardIndex(0);
      setPhase("handoff");
    } else {
      haptic([30, 60, 30]);
      setPhase("result");
    }
  };

  const ranked = useMemo(
    () =>
      deck
        .map((r) => ({ recipe: r, count: votes[r.id] ?? 0 }))
        .sort((a, b) => b.count - a.count),
    [deck, votes],
  );

  const unanimous = ranked.filter((r) => r.count === names.length);

  const reset = () => {
    setPhase("setup");
    setVotes({});
    setVoterIndex(0);
    setCardIndex(0);
  };

  if (hydrated && pool.length < 2) {
    return (
      <div>
        <TopBar title="Разом" />
        <EmptyState emoji="👥" title="Замало страв" note="Послаб фільтри, щоб було з чого обирати." />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col pb-8">
      <TopBar
        title="Обираємо разом"
        right={
          phase === "setup" ? (
            <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
          ) : phase === "voting" ? (
            <span className="max-w-[140px] shrink-0 truncate text-[12px] font-bold text-faint">
              {names[voterIndex]} · {cardIndex + 1}/{deck.length}
            </span>
          ) : phase === "result" ? (
            <span className="shrink-0 text-[12px] font-bold text-faint">Результат</span>
          ) : undefined
        }
      />

      <AnimatePresence mode="wait">
        {/* ── Налаштування ─────────────────────────────────────────── */}
        {phase === "setup" && (
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-2.5 px-4"
          >
            <Panel>
              <PanelHeader
                label="Хто обирає?"
                tone="brand"
                icon={<Users size={13} strokeWidth={2.4} />}
                aside="Один телефон на всіх"
              />
              <p className="border-t border-line px-3.5 py-3 text-[13px] font-semibold leading-relaxed text-muted">
                Кожен по черзі голосує за страви на цьому ж телефоні. Наприкінці покажемо, на чому
                зійшлись усі.
              </p>

              {names.map((n, i) => (
                <div key={`${n}-${i}`} className="flex h-12 items-center gap-3 border-t border-line px-3.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[17px]">
                    {AVATARS[i % AVATARS.length]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{n}</span>
                  {names.length > 2 && (
                    <button
                      onClick={() => setNames((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`Прибрати ${n}`}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-faint active:bg-surface-2"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}

              {names.length < 8 && (
                <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && draft.trim()) {
                        setNames((p) => [...p, draft.trim()]);
                        setDraft("");
                      }
                    }}
                    placeholder="Імʼя учасника"
                    className="h-10 min-w-0 flex-1 rounded-[8px] bg-surface-2 px-3 text-[15px] font-semibold"
                  />
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    onClick={() => {
                      if (!draft.trim()) return;
                      haptic(10);
                      setNames((p) => [...p, draft.trim()]);
                      setDraft("");
                    }}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] brand-gradient text-brand-ink"
                    aria-label="Додати учасника"
                  >
                    <Plus size={18} strokeWidth={2.6} />
                  </motion.button>
                </div>
              )}
            </Panel>

            <motion.button whileTap={{ scale: 0.97 }} onClick={start} className={PRIMARY}>
              Почати голосування
              <ArrowRight size={18} />
            </motion.button>
            <p className="text-center text-[11.5px] font-semibold text-faint">
              {Math.min(ROUND_SIZE, pool.length)} страв ·{" "}
              {names.length} {plural(names.length, "учасник", "учасники", "учасників")}
            </p>
          </motion.div>
        )}

        {/* ── Передача телефону ────────────────────────────────────── */}
        {phase === "handoff" && (
          <motion.div
            key={`handoff-${voterIndex}`}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-1 flex-col items-center justify-center px-8 text-center"
          >
            <div className="floaty grid h-24 w-24 place-items-center rounded-full bg-surface-2 text-[52px]">
              {AVATARS[voterIndex % AVATARS.length]}
            </div>
            <p className="mt-5 text-[11px] font-extrabold uppercase tracking-[0.07em] text-faint">
              Учасник {voterIndex + 1} з {names.length}
            </p>
            <h2 className="mt-1.5 font-display text-[22px] font-bold leading-tight">Передай телефон</h2>
            <p className="mt-0.5 font-display text-[22px] font-bold leading-tight text-brand">
              {names[voterIndex]}
            </p>
            <p className="mt-3 text-[13.5px] font-semibold leading-relaxed text-muted">
              Голосуй чесно і не підглядай за іншими. Твої відповіді нікому не покажемо — лише
              спільний результат.
            </p>
            <motion.button
              whileTap={{ scale: 0.97 }}
              className={cn(PRIMARY, "mt-7 w-full max-w-xs")}
              onClick={() => {
                haptic(12);
                setPhase("voting");
              }}
            >
              Я {names[voterIndex]}, почали
            </motion.button>
          </motion.div>
        )}

        {/* ── Голосування ──────────────────────────────────────────── */}
        {phase === "voting" && deck[cardIndex] && (
          <motion.div
            key="voting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-1 flex-col px-4 pt-1"
          >
            <div className="flex gap-1">
              {deck.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-[2px] ${i <= cardIndex ? "bg-brand" : "bg-surface-2"}`}
                />
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={deck[cardIndex].id}
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -24, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                className="mt-3 flex-1 overflow-hidden rounded-[12px] border border-line bg-surface"
              >
                <RecipeMedia
                  recipe={deck[cardIndex]}
                  className="h-[58%] w-full"
                  rounded="rounded-none"
                  emojiSize="text-8xl"
                />
                <div className="border-t border-line px-3.5 pb-3.5 pt-3">
                  <h2 className="text-[18px] font-extrabold leading-tight">{deck[cardIndex].title}</h2>
                  <p className="mt-1.5 line-clamp-3 text-[13.5px] leading-relaxed text-muted">
                    {deck[cardIndex].description}
                  </p>
                  <p className="mt-2 text-[12px] font-bold text-brand">
                    {formatMinutes(deck[cardIndex].timeMin)} · {deck[cardIndex].cuisine}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="flex gap-2 py-3">
              <motion.button
                whileTap={{ scale: 0.96 }}
                className={cn(SECONDARY, "flex-1")}
                onClick={() => vote(false)}
              >
                <X size={19} strokeWidth={2.4} />
                Ні
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.96 }}
                className={cn(PRIMARY, "flex-1")}
                onClick={() => vote(true)}
              >
                <Check size={19} strokeWidth={2.6} />
                Так
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ── Результат ────────────────────────────────────────────── */}
        {phase === "result" && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-2.5 px-4"
          >
            <Panel>
              <PanelHeader
                label="Рейтинг"
                tone="brand"
                icon={<Trophy size={13} strokeWidth={2.4} />}
                aside={`${names.length} ${plural(names.length, "учасник", "учасники", "учасників")}`}
              />
              <div className="flex items-center gap-3 border-t border-line px-3.5 py-3">
                <span className="pop-in grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-brand/15 text-[21px]">
                  {unanimous.length ? "🎉" : "🤝"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-extrabold leading-tight">
                    {unanimous.length
                      ? `Одностайно: ${unanimous.length} ${plural(unanimous.length, "страва", "страви", "страв")}`
                      : "Повного збігу немає"}
                  </span>
                  <span className="mt-0.5 block text-[12px] font-semibold leading-snug text-muted">
                    {unanimous.length
                      ? "Усі сказали «так» цим стравам."
                      : "Ось рейтинг за кількістю голосів — беріть верхню."}
                  </span>
                </span>
              </div>

              {ranked.map(({ recipe, count }, i) => {
                const isTop = count > 0 && count === ranked[0].count;
                return (
                  <motion.div
                    key={recipe.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Link
                      href={`/recipe/${recipe.id}`}
                      className={cn(
                        "flex h-16 items-center gap-3 border-t border-line px-3.5 active:bg-surface-2",
                        isTop && "bg-brand/[0.06]",
                      )}
                    >
                      <RecipeMedia
                        recipe={recipe}
                        className="h-11 w-11 shrink-0"
                        rounded="rounded-[8px]"
                        emojiSize="text-[22px]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">{recipe.title}</span>
                        <span className="block truncate text-[12px] font-semibold text-faint">
                          {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {isTop && <Trophy size={14} className="text-brand" />}
                        <span
                          className={cn(
                            "flex h-6 items-center rounded-[6px] px-2 text-[12px] font-extrabold",
                            count === 0 ? "bg-surface-2 text-faint" : "bg-brand/15 text-brand",
                          )}
                        >
                          {count}/{names.length}
                        </span>
                      </span>
                    </Link>
                  </motion.div>
                );
              })}
            </Panel>

            <div className="flex gap-2 pb-4">
              <motion.button
                whileTap={{ scale: 0.97 }}
                className={cn(SECONDARY, "flex-1")}
                onClick={() => {
                  haptic(10);
                  reset();
                }}
              >
                Ще раунд
              </motion.button>
              {ranked[0] && (
                <Link
                  href={`/recipe/${ranked[0].recipe.id}/cook`}
                  onClick={() => haptic(10)}
                  className={cn(PRIMARY, "flex-1 px-2")}
                >
                  Готувати переможця
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <FilterSheet
        suggesting
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        value={filters}
        onChange={setFilters}
        resultCount={pool.length}
      />
    </div>
  );
}
