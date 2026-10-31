"use client";

import { motion } from "framer-motion";
import { ChevronRight, Plus, ScanBarcode, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, EmptyState, Segmented } from "@/components/ui";
import { ing, knownIngredient, satisfies } from "@/data/ingredients";
import { fridgeMatches, suggestable } from "@/lib/matching";
import { pantryCounts } from "@/lib/pantry";
import { pantryTypes, useApp } from "@/lib/store";
import type { MatchResult } from "@/lib/types";
import { cn, formatMinutes, plural } from "@/lib/utils";

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
  /*
   * Типи комори разом із загальнішими: безлактозне молоко відкриває рецепти з
   * молоком. Набір залежить і від каталогу дописаних — там живуть батьки.
   */
  const have = useApp(pantryTypes);
  const customIngredients = useApp((s) => s.customIngredients);
  // Правка типу картки товару переписує тип рядків комори — з нею й збіги.
  const products = useApp((s) => s.products);
  const [mode, setMode] = useState<Mode>("almost");
  /*
   * «Рецепти з цим» з групи комори (F1): лише страви, яким годиться цей тип —
   * сам або як різновид потрібного («Молоко безлактозне» → рецепти з молоком).
   * Читаємо з адреси після монтування, без useSearchParams: тому потрібна
   * межа Suspense, а сторінка статична.
   */
  const [withKey, setWithKey] = useState<string | null>(null);
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("with");
    if (key && knownIngredient(key)) setWithKey(key);
  }, []);

  const matches = useMemo(() => {
    if (!hydrated || pantry.length === 0) return [];
    // Бібліотеці потрібен увесь стан, але перемальовування — ні: беремо
    // знімок у момент обчислення, а залежності перелічені нижче.
    return fridgeMatches(suggestable(useApp.getState()), have);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, pantry, have, myRecipes, customIngredients, products]);

  const withType = useMemo(
    () => (withKey ? matches.filter((m) => m.recipe.ingredients.some((i) => satisfies(withKey, i.key))) : matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches, withKey, customIngredients],
  );

  const filtered = useMemo(() => {
    if (mode === "ready") return withType.filter((m) => m.missing.length === 0);
    if (mode === "almost") return withType.filter((m) => m.missing.length <= 2);
    return withType;
  }, [withType, mode]);

  const counts = useMemo(
    () => ({
      ready: withType.filter((m) => m.missing.length === 0).length,
      almost: withType.filter((m) => m.missing.length <= 2).length,
      all: withType.length,
    }),
    [withType],
  );
  // Рядки комори, а не ключі: дві пачки молока — два продукти; «Сіль» у двох членів сімʼї — одна.
  const rows = useMemo(() => pantryCounts(pantry).items, [pantry]);

  if (hydrated && pantry.length === 0) {
    return (
      <div>
        <TopBar title="Холодильник" />
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
        title="Холодильник"
        right={
          <span className="text-[12px] font-bold text-faint">
            {rows} {plural(rows, "продукт", "продукти", "продуктів")}
          </span>
        }
      />

      <div className="flex flex-col gap-2.5 px-4">
        {withKey && (
          <button
            onClick={() => setWithKey(null)}
            className="flex h-10 items-center gap-2 self-start rounded-[10px] border border-brand/40 bg-brand/10 px-3 text-[13px] font-bold text-brand"
          >
            {ing(withKey).emoji} Лише з «{ing(withKey).label}» <X size={14} />
          </button>
        )}

        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "ready", label: "Готово", count: counts.ready },
            { value: "almost", label: "Майже", count: counts.almost },
            { value: "all", label: "Усе", count: counts.all },
          ]}
        />

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

        <Link
          href="/pantry"
          className="flex h-12 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 active:bg-surface-2"
        >
          <Plus size={16} strokeWidth={2.4} className="text-brand" />
          <span className="flex-1 text-[14px] font-semibold text-brand">Додати продукти в комору</span>
          <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
        </Link>
      </div>
    </div>
  );
}

function MatchCard({ match, index }: { match: MatchResult; index: number }) {
  const { recipe, pct, missing } = match;
  const full = missing.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
    >
      <Link
        href={`/recipe/${recipe.id}`}
        className="block overflow-hidden rounded-[10px] border border-line bg-surface active:bg-surface-2"
      >
        <div className="flex items-center gap-3 px-3.5 py-3">
          <RecipeMedia recipe={recipe} className="h-[52px] w-[52px] shrink-0" rounded="rounded-[8px]" emojiSize="text-[26px]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-extrabold">{recipe.title}</span>
            <span className="block truncate text-[12px] font-semibold text-muted">
              {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
            </span>
          </span>
          <span className={cn("font-display text-[16px] font-bold", full ? "text-brand" : "text-ink")}>{pct}%</span>
        </div>
        <div className="flex flex-col gap-2 px-3.5 pb-3">
          <div className="h-1 overflow-hidden rounded-[2px] bg-surface-2">
            <motion.div
              className={cn("h-full rounded-[2px]", full ? "brand-gradient" : "bg-muted")}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
          <p className={cn("text-[12px] font-semibold", full ? "text-brand" : "text-faint")}>
            {full ? "Усе є вдома" : `Бракує: ${missing.map((k) => ing(k).label.toLowerCase()).join(", ")}`}
          </p>
        </div>
      </Link>
    </motion.div>
  );
}
