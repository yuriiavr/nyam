"use client";

import { motion } from "framer-motion";
import { Clock, RotateCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, Card, EmptyState } from "@/components/ui";
import { buildTaste, recommend } from "@/lib/matching";
import { useApp } from "@/lib/store";
import { formatMinutes, haptic, MOOD_META } from "@/lib/utils";

export default function ForYouPage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const [seed, setSeed] = useState(0);

  const recs = useMemo(
    () => (hydrated ? recommend(state, { limit: 15 }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, seed, state.likes, state.saved, state.cooked, state.pantry, state.ratings],
  );

  const taste = useMemo(() => (hydrated ? buildTaste(state) : null), [hydrated, state]);

  const signalCount =
    state.likes.length + state.saved.length + state.cooked.length + Object.keys(state.ratings).length;

  const topCuisines = taste
    ? [...taste.cuisines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];
  const topMoods = taste
    ? [...taste.moods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];

  return (
    <div className="pb-8">
      <TopBar
        title="Для тебе"
        subtitle="Алгоритм на основі твоєї поведінки"
        right={
          <button
            onClick={() => {
              haptic(12);
              setSeed((s) => s + 1);
            }}
            aria-label="Оновити добірку"
            className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2"
          >
            <RotateCw size={17} />
          </button>
        }
      />

      {/* Профіль смаку */}
      {hydrated && (
        <section className="px-4 pt-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-brand" />
              <h2 className="text-[13px] font-bold">Твій профіль смаку</h2>
            </div>

            {signalCount < 3 ? (
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                Поки що мало даних. Постав лайки, збережи кілька рецептів або познач приготовані —
                і добірка стане точною.
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {topCuisines.map(([c]) => (
                    <span
                      key={c}
                      className="rounded-full bg-brand/12 px-2.5 py-1 text-[12px] font-bold text-brand"
                    >
                      {c}
                    </span>
                  ))}
                  {topMoods.map(([m]) => (
                    <span
                      key={m}
                      className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-semibold"
                    >
                      {MOOD_META[m]?.emoji} {MOOD_META[m]?.label ?? m}
                    </span>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Stat label="лайків" value={state.likes.length} />
                  <Stat label="збережено" value={state.saved.length} />
                  <Stat label="приготовано" value={state.cooked.length} />
                </div>
                {taste?.avgTime != null && (
                  <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
                    <Clock size={12} />
                    Зазвичай обираєш страви приблизно на {Math.round(taste.avgTime)} хв
                  </p>
                )}
              </>
            )}
          </Card>
        </section>
      )}

      {/* Добірка */}
      <section className="px-4 pt-6">
        <h2 className="mb-3 font-display text-[17px] font-bold">Рекомендації</h2>

        {!hydrated ? null : recs.length === 0 ? (
          <EmptyState emoji="🔮" title="Немає що порекомендувати" />
        ) : (
          <div className="flex flex-col gap-2.5">
            {recs.map((rec, i) => (
              <motion.div
                key={rec.recipe.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.4) }}
              >
                <Link href={`/recipe/${rec.recipe.id}`}>
                  <div className="flex gap-3 rounded-2xl border border-line bg-surface p-2.5">
                    <div className="relative">
                      <RecipeMedia
                        recipe={rec.recipe}
                        className="h-[68px] w-[68px] shrink-0"
                        rounded="rounded-2xl"
                        emojiSize="text-3xl"
                      />
                      {i < 3 && (
                        <span className="absolute -left-1 -top-1 grid h-6 w-6 place-items-center rounded-full brand-gradient text-[11px] font-extrabold text-brand-ink">
                          {i + 1}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-[14.5px] font-bold">{rec.recipe.title}</h4>
                      <p className="text-[11.5px] text-muted">
                        {formatMinutes(rec.recipe.timeMin)} · {rec.recipe.cuisine}
                      </p>
                      {rec.reasons.length > 0 && (
                        <p className="mt-1.5 line-clamp-2 text-[11.5px] font-semibold leading-snug text-brand">
                          ✦ {rec.reasons.join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}

        <Button
          variant="secondary"
          full
          className="mt-4"
          onClick={() => {
            haptic(12);
            setSeed((s) => s + 1);
          }}
        >
          <RotateCw size={16} />
          Показати інші
        </Button>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-surface-2 py-2.5">
      <p className="font-display text-[17px] font-extrabold leading-none">{value}</p>
      <p className="mt-1 text-[10.5px] text-muted">{label}</p>
    </div>
  );
}
