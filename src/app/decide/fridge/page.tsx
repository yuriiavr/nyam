"use client";

import { motion } from "framer-motion";
import { Plus, ScanBarcode, ShoppingBasket } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, Card, EmptyState, Segmented } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { fridgeMatches, suggestable } from "@/lib/matching";
import { useApp } from "@/lib/store";
import type { MatchResult } from "@/lib/types";
import { formatMinutes, plural } from "@/lib/utils";

type Mode = "ready" | "almost" | "all";

export default function FridgePage() {
  /*
   * Підписуємось на те, що справді читаємо. `useApp()` без селектора — це
   * підписка на весь стор: сторінка перемальовувалась би від будь-якої зміни,
   * хоч від кількості солі в коморі, хоч від чужого лайка через realtime.
   */
  const hydrated = useApp((s) => s.hydrated);
  const pantry = useApp((s) => s.pantry);
  const myRecipes = useApp((s) => s.myRecipes);
  const [mode, setMode] = useState<Mode>("almost");

  const pantryKeys = pantry.map((p) => p.key);

  const matches = useMemo(() => {
    if (!hydrated || pantryKeys.length === 0) return [];
    // Бібліотеці потрібен увесь стан, але перемальовування — ні: беремо
    // знімок у момент обчислення, а залежності перелічені нижче.
    return fridgeMatches(suggestable(useApp.getState()), pantryKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, pantry, myRecipes]);

  const filtered = useMemo(() => {
    if (mode === "ready") return matches.filter((m) => m.missing.length === 0);
    if (mode === "almost") return matches.filter((m) => m.missing.length <= 2);
    return matches;
  }, [matches, mode]);

  const counts = useMemo(
    () => ({
      ready: matches.filter((m) => m.missing.length === 0).length,
      almost: matches.filter((m) => m.missing.length <= 2).length,
      all: matches.length,
    }),
    [matches],
  );

  if (hydrated && pantryKeys.length === 0) {
    return (
      <div>
        <TopBar title="Що в холодильнику" />
        <EmptyState
          emoji="🧊"
          title="Спершу наповни комору"
          note="Додай продукти, які є вдома — сканером штрихкодів або вручну. Далі покажемо, що з них вийде."
          action={
            <Link href="/pantry">
              <Button>
                <ScanBarcode size={17} />
                До комори
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="pb-8">
      <TopBar
        title="Що в холодильнику"
        subtitle={`${pantryKeys.length} ${plural(pantryKeys.length, "продукт", "продукти", "продуктів")} у коморі`}
        right={
          <Link
            href="/pantry"
            aria-label="Комора"
            className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2"
          >
            <Plus size={18} />
          </Link>
        }
      />

      <div className="px-4 pt-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "ready", label: `Готово (${counts.ready})` },
            { value: "almost", label: `Майже (${counts.almost})` },
            { value: "all", label: `Усе (${counts.all})` },
          ]}
        />
      </div>

      <div className="flex flex-col gap-3 px-4 pt-4">
        {filtered.length === 0 ? (
          <EmptyState
            emoji="🤔"
            title={mode === "ready" ? "Повних збігів немає" : "Нічого не підійшло"}
            note="Додай ще кілька продуктів у комору або подивись вкладку «Усе» — там страви з більшою кількістю покупок."
            action={
              mode !== "all" ? (
                <Button variant="secondary" onClick={() => setMode("all")}>
                  Показати всі варіанти
                </Button>
              ) : undefined
            }
          />
        ) : (
          filtered.map((m, i) => <MatchCard key={m.recipe.id} match={m} index={i} />)
        )}
      </div>
    </div>
  );
}

function MatchCard({ match, index }: { match: MatchResult; index: number }) {
  const { recipe, pct, missing } = match;
  const color = pct === 100 ? "var(--mint)" : pct >= 70 ? "var(--brand-2)" : "var(--brand)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
    >
      <Card className="overflow-hidden p-0">
        <Link href={`/recipe/${recipe.id}`} className="flex gap-3 p-3">
          <RecipeMedia
            recipe={recipe}
            className="h-[72px] w-[72px] shrink-0"
            rounded="rounded-2xl"
            emojiSize="text-3xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 font-display text-[15px] font-bold leading-tight">
                {recipe.title}
              </h3>
              <Ring pct={pct} color={color} />
            </div>
            <p className="mt-1 text-[11.5px] text-muted">
              {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
            </p>

            {missing.length === 0 ? (
              <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-mint/15 px-2.5 py-1 text-[11.5px] font-bold text-mint">
                ✓ Усе є — можна готувати
              </p>
            ) : (
              <div className="mt-2">
                <p className="mb-1 flex items-center gap-1 text-[11px] font-bold text-muted">
                  <ShoppingBasket size={11} />
                  Бракує {missing.length}:
                </p>
                <div className="flex flex-wrap gap-1">
                  {missing.slice(0, 4).map((k) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold"
                    >
                      {ing(k).emoji} {ing(k).label}
                    </span>
                  ))}
                  {missing.length > 4 && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">
                      +{missing.length - 4}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </Link>
      </Card>
    </motion.div>
  );
}

function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-11 w-11 shrink-0 place-items-center">
      <svg width={44} height={44} viewBox="0 0 44 44" className="absolute -rotate-90">
        <circle cx={22} cy={22} r={r} fill="none" stroke="var(--line)" strokeWidth={4} />
        <motion.circle
          cx={22}
          cy={22}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * pct) / 100 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      </svg>
      <span className="relative text-[10.5px] font-extrabold" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}
