"use client";

import { motion } from "framer-motion";
import { AtSign, Search, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { RecipeTile, TileBadge } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Avatar, Panel, PanelHeader, Segmented, Spinner } from "@/components/ui";
import { activeFilterCount, applyFilters, emptyFilters, topBy, type Filters } from "@/lib/matching";
import { allProfiles, allRecipes, useApp } from "@/lib/store";
import { searchProfiles } from "@/lib/supabase/api";
import type { Profile } from "@/lib/types";
import { cn, compactNumber, haptic, plural } from "@/lib/utils";

type Sort = "trending" | "popular" | "new" | "rating";

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

  const following = useApp((s) => s.following);
  const toggleFollow = useApp((s) => s.toggleFollow);
  const me = useApp((s) => s.account?.id);

  const chefRow = (profile: Profile, meta: string) => {
    const on = following.includes(profile.id);
    const self = profile.id === me;
    return (
      <div key={profile.id} className="flex h-[58px] items-center gap-3 border-t border-line px-3.5">
        <Link href={`/u/${profile.id}`} onClick={() => haptic(8)} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar emoji={profile.emoji} gradient={profile.gradient} src={profile.avatar} size={38} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{profile.name}</span>
            <span className="block truncate text-[11.5px] font-semibold text-faint">{meta}</span>
          </span>
        </Link>
        {!self && (
          <button
            onClick={() => {
              haptic(10);
              toggleFollow(profile.id);
            }}
            className={cn(
              "flex h-8 shrink-0 items-center rounded-[8px] px-3 text-[12.5px] font-extrabold",
              on ? "bg-surface-2 text-muted" : "brand-gradient text-brand-ink",
            )}
          >
            {on ? "Стежу" : "Стежити"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="pb-8">
      <TopBar back={false} title="Пошук" />

      <div className="flex flex-col gap-2.5 px-4 md:px-6">
        {/* Пошук і сортування — на планшеті в один рядок */}
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-3">
        <div className="flex gap-2 lg:flex-1">
          <div className="flex h-[46px] flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5">
            <Search size={18} className="shrink-0 text-muted" />
            <input
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder="Борщ, паста, курка, «швидко»…"
              className="h-full min-w-0 flex-1 text-[15px] font-semibold"
            />
            {filters.query && (
              <button onClick={() => setFilters((f) => ({ ...f, query: "" }))} aria-label="Очистити">
                <X size={16} className="text-muted" />
              </button>
            )}
          </div>
          <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
        </div>

        {/* Сортування */}
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: "trending", label: "У тренді" },
            { value: "popular", label: "Топ" },
            { value: "new", label: "Нове" },
            { value: "rating", label: "Оцінки" },
          ]}
          className="lg:w-[440px] lg:shrink-0"
        />
        </div>

        {/* Результати */}
        {results.length === 0 ? (
          <p className="py-10 text-center text-[14px] font-bold text-muted">Нічого не знайшлось</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 pt-1 md:grid-cols-4 lg:grid-cols-6 lg:gap-x-3.5 lg:gap-y-4">
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
                      <TileBadge>
                        <TrendingUp size={10} strokeWidth={3} className="text-brand-2" />#{i + 1}
                      </TileBadge>
                    ) : undefined
                  }
                />
              </motion.div>
            ))}
          </div>
        )}

        {/* Кухарі */}
        <Panel className="mt-1.5">
          <PanelHeader label="Кухарі спільноти" />
          <label className="flex h-11 items-center gap-2 border-t border-line px-3.5">
            <AtSign size={16} className="shrink-0 text-faint" />
            <input
              value={cookQuery}
              onChange={(e) => setCookQuery(e.target.value)}
              placeholder="Знайти кухаря за ніком або імʼям"
              className="h-full min-w-0 flex-1 text-[14px] font-semibold"
            />
            {cookSearching && <Spinner className="h-4 w-4" />}
            {cookQuery && !cookSearching && (
              <button onClick={() => setCookQuery("")} aria-label="Очистити пошук кухарів">
                <X size={16} className="text-muted" />
              </button>
            )}
          </label>
          {cookHits !== null ? (
            cookHits.length === 0 ? (
              <p className="border-t border-line px-3.5 py-3 text-[12.5px] font-semibold text-muted">
                Кухаря з таким ніком немає. Перевір написання — нік без «@».
              </p>
            ) : (
              cookHits.map((profile) => chefRow(profile, `@${profile.handle} · ${compactNumber(profile.followers)} підп.`))
            )
          ) : cooks.length === 0 ? (
            <p className="border-t border-line px-3.5 py-3 text-[12.5px] font-semibold text-muted">
              Тут поки нікого. Кухарі зʼявляться, щойно хтось опублікує рецепт.
            </p>
          ) : (
            cooks
              .slice(0, 8)
              .map(({ profile, recipes }) =>
                chefRow(
                  profile,
                  `${recipes} ${plural(recipes, "рецепт", "рецепти", "рецептів")} · ${compactNumber(profile.followers)} підп.`,
                ),
              )
          )}
        </Panel>
      </div>

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
