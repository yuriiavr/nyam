"use client";

import Link from "next/link";
import { ChevronRight, ShoppingBasket } from "lucide-react";
import { useMemo } from "react";
import { RecipeMedia } from "@/components/RecipeCard";
import { Panel, PanelHeader, useToast } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { fridgeMatches, matchRecipe, shoppingSuggestions } from "@/lib/matching";
import { catalogItem } from "@/lib/shopping";
import { allRecipes, pantryTypes, useApp } from "@/lib/store";
import { haptic, plural } from "@/lib/utils";

/**
 * Бічна колонка комори на планшеті: що докупити, щоб відкрились нові страви,
 * і що можна готувати вже зараз. На телефоні її немає — там ці відповіді
 * дають «Холодильник» і список покупок.
 */
export function PantryAside() {
  const hydrated = useApp((s) => s.hydrated);
  const pantry = useApp((s) => s.pantry);
  const shopping = useApp((s) => s.shopping);
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);
  const customIngredients = useApp((s) => s.customIngredients);
  const addShopping = useApp((s) => s.addShopping);
  const toast = useToast();

  const data = useMemo(() => {
    if (!hydrated) return null;
    const state = useApp.getState();
    const recipes = allRecipes(state);
    const have = pantryTypes(state);
    const listed = new Set(shopping.filter((x) => !x.done && x.key).map((x) => x.key));

    const top = shoppingSuggestions(recipes, have, 8).find((s) => !listed.has(s.key));
    const unlocked = top
      ? recipes
          .filter((r) => {
            const m = matchRecipe(r, have);
            return m.missing.length > 0 && m.missing.length <= 2 && m.missing.includes(top.key);
          })
          .slice(0, 3)
          .map((r) => r.title)
      : [];

    const ready = fridgeMatches(recipes, have, { minPct: 60 }).slice(0, 4);
    return { top, unlocked, ready };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, pantry, shopping, myRecipes, remoteRecipes, customIngredients]);

  if (!data) return null;
  const { top, unlocked, ready } = data;

  return (
    <aside className="hidden lg:sticky lg:top-4 lg:flex lg:flex-col lg:gap-3">
      {top && (
        <div className="overflow-hidden rounded-[10px] border border-brand/35 bg-surface">
          <div className="flex flex-col gap-1 px-3.5 pb-3 pt-3">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-brand">Що докупити</span>
            <span className="text-[15px] font-extrabold leading-snug">
              Купи {lowerFirst(ing(top.key).label)} — відкриється ще {top.unlocks}{" "}
              {plural(top.unlocks, "страва", "страви", "страв")}
            </span>
            {unlocked.length > 0 && (
              <span className="line-clamp-2 text-[12.5px] font-semibold text-muted">{unlocked.join(", ")}</span>
            )}
          </div>
          <button
            onClick={() => {
              haptic(12);
              const { fresh } = addShopping([catalogItem(top.key)]);
              toast(fresh ? `${ing(top.key).label} — у списку покупок` : "Уже є в списку", "🛒");
            }}
            className="flex h-11 w-full items-center gap-2.5 border-t border-line px-3.5 text-left active:bg-surface-2"
          >
            <ShoppingBasket size={16} className="text-brand" />
            <span className="flex-1 text-[13.5px] font-bold text-brand">У список покупок</span>
          </button>
        </div>
      )}

      <Panel>
        <PanelHeader label="Можна приготувати зараз" />
        {ready.length === 0 ? (
          <p className="border-t border-line px-3.5 py-4 text-[12.5px] font-semibold text-faint">
            Поки ні з чого — додай кілька продуктів, і тут зʼявляться страви.
          </p>
        ) : (
          ready.map((m) => (
            <Link
              key={m.recipe.id}
              href={`/recipe/${m.recipe.id}`}
              className="flex h-[58px] items-center gap-3 border-t border-line px-3.5 active:bg-surface-2"
            >
              <RecipeMedia recipe={m.recipe} className="h-[38px] w-[38px] shrink-0" rounded="rounded-[8px]" emojiSize="text-[20px]" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] font-bold">{m.recipe.title}</span>
                <span className="truncate text-[12px] font-semibold text-faint">
                  {m.missing.length === 0
                    ? "усе є"
                    : `бракує: ${m.missing.map((k) => lowerFirst(ing(k).label)).join(", ")}`}
                </span>
              </span>
              <span className="shrink-0 text-[12.5px] font-extrabold text-brand">{m.pct}%</span>
            </Link>
          ))
        )}
        <Link
          href="/decide/fridge"
          className="flex h-11 items-center gap-2.5 border-t border-line px-3.5 active:bg-surface-2"
        >
          <span className="flex-1 text-[13.5px] font-bold text-muted">Усе з комори</span>
          <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
        </Link>
      </Panel>
    </aside>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
