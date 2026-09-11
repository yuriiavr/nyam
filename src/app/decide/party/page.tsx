"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Plus, Trophy, Users, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, Card, EmptyState } from "@/components/ui";
import { activeFilterCount, applyFilters, emptyFilters, type Filters } from "@/lib/matching";
import { useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { formatMinutes, haptic, plural, shuffle } from "@/lib/utils";

type Phase = "setup" | "handoff" | "voting" | "result";

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
    () => (hydrated ? applyFilters(useApp.getState(), filters) : []),
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
        subtitle={
          phase === "voting"
            ? `${names[voterIndex]} · ${cardIndex + 1}/${deck.length}`
            : phase === "result"
              ? "Результат"
              : "Один телефон на всіх"
        }
        right={
          phase === "setup" ? (
            <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
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
            className="px-4 pt-5"
          >
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <Users size={17} className="text-brand" />
                <h2 className="font-display text-[16px] font-bold">Хто обирає?</h2>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                Кожен по черзі голосує за страви на цьому ж телефоні. Наприкінці покажемо, на чому
                зійшлись усі.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {names.map((n, i) => (
                  <span
                    key={`${n}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-2 pl-3 pr-2 text-[13px] font-semibold"
                  >
                    <span>{AVATARS[i % AVATARS.length]}</span>
                    {n}
                    {names.length > 2 && (
                      <button
                        onClick={() => setNames((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Прибрати ${n}`}
                      >
                        <X size={13} className="text-faint" />
                      </button>
                    )}
                  </span>
                ))}
              </div>

              {names.length < 8 && (
                <div className="mt-3 flex gap-2">
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
                    className="h-11 flex-1 rounded-2xl border border-line bg-bg-elev px-4 text-[15px]"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (!draft.trim()) return;
                      haptic(10);
                      setNames((p) => [...p, draft.trim()]);
                      setDraft("");
                    }}
                    className="w-12 px-0"
                    aria-label="Додати учасника"
                  >
                    <Plus size={18} />
                  </Button>
                </div>
              )}
            </Card>

            <Button full size="lg" className="mt-4" onClick={start}>
              Почати голосування
              <ArrowRight size={18} />
            </Button>
            <p className="mt-2.5 text-center text-[12px] text-muted">
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
            <div className="floaty text-7xl">{AVATARS[voterIndex % AVATARS.length]}</div>
            <h2 className="mt-5 font-display text-2xl font-extrabold leading-tight">
              Передай телефон
            </h2>
            <p className="mt-1 font-display text-2xl font-extrabold text-gradient">
              {names[voterIndex]}
            </p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
              Голосуй чесно і не підглядай за іншими. Твої відповіді нікому не покажемо — лише
              спільний результат.
            </p>
            <Button
              size="lg"
              className="mt-7 w-full max-w-xs"
              onClick={() => {
                haptic(12);
                setPhase("voting");
              }}
            >
              Я {names[voterIndex]}, почали
            </Button>
            <p className="mt-3 text-[12px] text-muted">
              Учасник {voterIndex + 1} з {names.length}
            </p>
          </motion.div>
        )}

        {/* ── Голосування ──────────────────────────────────────────── */}
        {phase === "voting" && deck[cardIndex] && (
          <motion.div
            key="voting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-1 flex-col px-4 pt-4"
          >
            <div className="flex gap-1">
              {deck.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full ${i <= cardIndex ? "bg-brand" : "bg-line"}`}
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
                className="mt-4 flex-1 overflow-hidden rounded-xl4 border border-line bg-surface"
              >
                <RecipeMedia
                  recipe={deck[cardIndex]}
                  className="h-[58%] w-full"
                  rounded="rounded-none"
                  emojiSize="text-8xl"
                />
                <div className="p-4">
                  <h2 className="font-display text-[19px] font-extrabold leading-tight">
                    {deck[cardIndex].title}
                  </h2>
                  <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">
                    {deck[cardIndex].description}
                  </p>
                  <p className="mt-2 text-[12px] font-bold text-brand">
                    {formatMinutes(deck[cardIndex].timeMin)} · {deck[cardIndex].cuisine}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="flex gap-3 py-4">
              <Button variant="secondary" size="lg" className="flex-1" onClick={() => vote(false)}>
                <X size={20} />
                Ні
              </Button>
              <Button size="lg" className="flex-1" onClick={() => vote(true)}>
                <Check size={20} />
                Так
              </Button>
            </div>
          </motion.div>
        )}

        {/* ── Результат ────────────────────────────────────────────── */}
        {phase === "result" && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-4 pt-6"
          >
            <div className="text-center">
              <div className="pop-in text-5xl">{unanimous.length ? "🎉" : "🤝"}</div>
              <h2 className="mt-3 font-display text-xl font-extrabold">
                {unanimous.length
                  ? `Одностайно: ${unanimous.length} ${plural(unanimous.length, "страва", "страви", "страв")}`
                  : "Повного збігу немає"}
              </h2>
              <p className="mt-1 text-[13px] text-muted">
                {unanimous.length
                  ? "Усі сказали «так» цим стравам."
                  : "Ось рейтинг за кількістю голосів — беріть верхню."}
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-2.5">
              {ranked.map(({ recipe, count }, i) => {
                const isTop = count > 0 && count === ranked[0].count;
                return (
                  <Link key={recipe.id} href={`/recipe/${recipe.id}`}>
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={`flex items-center gap-3 rounded-2xl border p-2.5 ${
                        isTop ? "border-brand/40 bg-brand/5" : "border-line bg-surface"
                      }`}
                    >
                      <RecipeMedia
                        recipe={recipe}
                        className="h-14 w-14 shrink-0"
                        rounded="rounded-2xl"
                        emojiSize="text-2xl"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-[14px] font-bold">{recipe.title}</h4>
                        <p className="text-[11.5px] text-muted">
                          {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isTop && <Trophy size={14} className="text-brand" />}
                        <span
                          className={`rounded-full px-2.5 py-1 text-[12px] font-extrabold ${
                            count === 0 ? "bg-surface-2 text-faint" : "bg-brand/15 text-brand"
                          }`}
                        >
                          {count}/{names.length}
                        </span>
                      </div>
                    </motion.div>
                  </Link>
                );
              })}
            </div>

            <div className="mt-5 flex gap-2 pb-4">
              <Button variant="secondary" className="flex-1" onClick={reset}>
                Ще раунд
              </Button>
              {ranked[0] && (
                <Link href={`/recipe/${ranked[0].recipe.id}/cook`} className="flex-1">
                  <Button full>Готувати переможця</Button>
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
