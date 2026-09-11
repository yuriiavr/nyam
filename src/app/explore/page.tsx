"use client";

import { motion } from "framer-motion";
import { AtSign, Search, TrendingUp, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { RecipeTile } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Avatar, Chip, EmptyState, Segmented, Spinner } from "@/components/ui";
import { activeFilterCount, applyFilters, emptyFilters, topBy, type Filters } from "@/lib/matching";
import { allProfiles, allRecipes, useApp } from "@/lib/store";
import { searchProfiles } from "@/lib/supabase/api";
import type { Mood, Profile } from "@/lib/types";
import { compactNumber, haptic, MOOD_META, plural } from "@/lib/utils";

type Sort = "trending" | "popular" | "new" | "rating";

const QUICK_MOODS: Mood[] = ["fast", "comfort", "healthy", "cheap", "spicy", "sweet"];

export default function ExplorePage() {
  const myRecipes = useApp((s) => s.myRecipes);
  const likes = useApp((s) => s.likes);
  const saved = useApp((s) => s.saved);
  const cooked = useApp((s) => s.cooked);
  const remoteRecipes = useApp((s) => s.remoteRecipes);
  const remoteProfiles = useApp((s) => s.remoteProfiles);

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<Sort>("trending");

  const results = useMemo(() => {
    const snapshot = useApp.getState();
    return topBy(snapshot, applyFilters(snapshot, filters), sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort, myRecipes, likes, saved, cooked, remoteRecipes]);

  /* Пошук кухаря за ніком — окремо від пошуку страв.
     Питаємо сервер, бо у вибірку стрічки потрапляють не всі профілі. */
  const [cookQuery, setCookQuery] = useState("");
  const [cookHits, setCookHits] = useState<Profile[] | null>(null);
  const [cookSearching, setCookSearching] = useState(false);

  useEffect(() => {
    const q = cookQuery.trim();
    if (q.length < 2) {
      setCookHits(null);
      setCookSearching(false);
      return;
    }
    setCookSearching(true);
    let alive = true;
    const timer = setTimeout(() => {
      void searchProfiles(q)
        .then((list) => {
          if (alive) setCookHits(list);
        })
        .catch(() => {
          if (alive) setCookHits([]);
        })
        .finally(() => {
          if (alive) setCookSearching(false);
        });
    }, 280);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [cookQuery]);

  const toggleMood = (m: Mood) =>
    setFilters((f) => ({
      ...f,
      moods: f.moods.includes(m) ? f.moods.filter((x) => x !== m) : [...f.moods, m],
    }));

  const cooks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of allRecipes(useApp.getState())) {
      counts.set(r.authorId, (counts.get(r.authorId) ?? 0) + 1);
    }
    return allProfiles(useApp.getState())
      .map((p) => ({ profile: p, recipes: counts.get(p.id) ?? 0 }))
      .sort((a, b) => b.profile.followers - a.profile.followers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRecipes, remoteRecipes, remoteProfiles]);

  return (
    <div className="pb-8">
      <TopBar back={false} title="Відкривай нове" subtitle="Рецепти всієї спільноти" />

      {/* Пошук */}
      <div className="px-4 pt-3">
        <div className="flex gap-2">
          <div className="flex h-11 flex-1 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5">
            <Search size={17} className="shrink-0 text-muted" />
            <input
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder="Борщ, паста, курка, «швидко»…"
              className="h-full flex-1 text-[15px]"
            />
            {filters.query && (
              <button onClick={() => setFilters((f) => ({ ...f, query: "" }))} aria-label="Очистити">
                <X size={16} className="text-muted" />
              </button>
            )}
          </div>
          <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
        </div>
      </div>

      {/* Швидкі настрої */}
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4">
        {QUICK_MOODS.map((m) => (
          <Chip key={m} active={filters.moods.includes(m)} onClick={() => toggleMood(m)}>
            <span>{MOOD_META[m].emoji}</span>
            {MOOD_META[m].label}
          </Chip>
        ))}
      </div>

      {/* Сортування */}
      <div className="px-4 pt-4">
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: "trending", label: "У тренді" },
            { value: "popular", label: "Топ" },
            { value: "new", label: "Нове" },
            { value: "rating", label: "Оцінки" },
          ]}
        />
      </div>

      {/* Результати */}
      <section className="px-4 pt-4">
        {results.length === 0 ? (
          <EmptyState
            emoji="🔍"
            title="Нічого не знайшлось"
            note="Спробуй інший запит або скинь фільтри."
          />
        ) : (
          <>
            <p className="mb-3 text-[12px] text-muted">
              {results.length} {plural(results.length, "страва", "страви", "страв")}
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-5">
              {results.map((r, i) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.35) }}
                >
                  <RecipeTile
                    recipe={r}
                    badge={
                      sort === "trending" && i < 3 ? (
                        <span className="glass inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold text-brand">
                          <TrendingUp size={9} />#{i + 1}
                        </span>
                      ) : undefined
                    }
                  />
                </motion.div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Кухарі */}
      <section className="pt-8">
        <div className="mb-3 flex items-center gap-2 px-4">
          <Users size={16} className="text-brand" />
          <h2 className="font-display text-[17px] font-bold">Кухарі спільноти</h2>
        </div>

        <div className="px-4">
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5">
            <AtSign size={16} className="shrink-0 text-muted" />
            <input
              value={cookQuery}
              onChange={(e) => setCookQuery(e.target.value)}
              placeholder="Знайти кухаря за ніком або імʼям"
              className="h-full flex-1 text-[15px]"
            />
            {cookSearching && <Spinner className="h-4 w-4" />}
            {cookQuery && !cookSearching && (
              <button onClick={() => setCookQuery("")} aria-label="Очистити пошук кухарів">
                <X size={16} className="text-muted" />
              </button>
            )}
          </div>
        </div>

        {cookHits !== null ? (
          cookHits.length === 0 ? (
            <p className="px-4 pt-4 text-[13px] text-muted">
              Кухаря з таким ніком немає. Перевір написання — нік без «@».
            </p>
          ) : (
            <div className="space-y-2 px-4 pt-3">
              {cookHits.map((profile) => (
                <Link
                  key={profile.id}
                  href={`/u/${profile.id}`}
                  onClick={() => haptic(8)}
                  className="flex items-center gap-3 rounded-xl3 border border-line bg-surface p-3"
                >
                  <Avatar
                    emoji={profile.emoji}
                    gradient={profile.gradient}
                    src={profile.avatar}
                    size={44}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-bold">{profile.name}</p>
                    <p className="truncate text-[12px] text-muted">@{profile.handle}</p>
                  </div>
                  <span className="shrink-0 text-[11.5px] text-faint">
                    {compactNumber(profile.followers)} підп.
                  </span>
                </Link>
              ))}
            </div>
          )
        ) : cooks.length === 0 ? (
          <p className="px-4 pt-4 text-[13px] text-muted">
            Тут поки нікого. Кухарі зʼявляться, щойно хтось опублікує рецепт.
          </p>
        ) : (
          <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto px-4">
            {cooks.map(({ profile, recipes }) => (
              <Link
                key={profile.id}
                href={`/u/${profile.id}`}
                onClick={() => haptic(8)}
                className="w-[150px] shrink-0 rounded-xl3 border border-line bg-surface p-3.5 text-center"
              >
                <div className="flex justify-center">
                  <Avatar
                    emoji={profile.emoji}
                    gradient={profile.gradient}
                    src={profile.avatar}
                    size={54}
                  />
                </div>
                <p className="mt-2.5 truncate text-[13.5px] font-bold">{profile.name}</p>
                <p className="truncate text-[11px] text-muted">@{profile.handle}</p>
                <p className="mt-1.5 text-[11px] font-semibold text-brand">
                  {compactNumber(profile.followers)} підписників
                </p>
                <p className="text-[10.5px] text-muted">
                  {recipes} {plural(recipes, "рецепт", "рецепти", "рецептів")}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        value={filters}
        onChange={setFilters}
        resultCount={results.length}
      />
    </div>
  );
}
