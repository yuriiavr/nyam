"use client";

import { useMemo } from "react";
import {
  COURSE_LABEL,
  PAIR_HEADING,
  courseOf,
  suggestDrinks,
  suggestPairs,
} from "@/lib/pairing";
import { allRecipes, useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RecipeRow } from "./RecipeCard";

/**
 * Що подати разом і що до цього випити.
 *
 * Живе окремим компонентом, бо потрібне у двох місцях: на сторінці рецепта
 * і одразу після рулетки. Випав гарнір — питання «а до чого він?» виникає
 * саме там, і відправляти по відповідь в інший екран безглуздо.
 */

export function PairingSuggestions({
  recipe,
  limit = 3,
  className,
}: {
  recipe: Recipe;
  limit?: number;
  className?: string;
}) {
  const hydrated = useApp((s) => s.hydrated);
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);
  const cooked = useApp((s) => s.cooked);
  const pantry = useApp((s) => s.pantry);

  const pairs = useMemo(() => {
    if (!hydrated) return [];
    const snapshot = useApp.getState();
    return suggestPairs(snapshot, recipe, allRecipes(snapshot), limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, recipe.id, limit, myRecipes, remoteRecipes, cooked, pantry]);

  const heading = PAIR_HEADING[courseOf(recipe)];
  if (!heading || pairs.length === 0) return null;

  return (
    <section className={cn("pt-7", className)}>
      <h2 className="mb-3 font-display text-[17px] font-bold">{heading}</h2>
      <div className="flex flex-col gap-2">
        {pairs.map(({ recipe: pair, reason }) => (
          <RecipeRow
            key={pair.id}
            recipe={pair}
            href={`/recipe/${pair.id}`}
            subtitle={
              <span className="text-[11.5px] text-brand">
                {COURSE_LABEL[courseOf(pair)].toLowerCase()} · {reason}
              </span>
            }
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Напої — не рецепти, і так і підписані.
 *
 * Сік чи мінералку ніхто не «готує»: їх ставлять на стіл. Тому це картки
 * без посилань — порада, а не ще один екран, куди треба йти.
 */
export function DrinkPicks({
  recipe,
  limit = 3,
  className,
}: {
  recipe: Recipe;
  limit?: number;
  className?: string;
}) {
  const hydrated = useApp((s) => s.hydrated);
  const pantry = useApp((s) => s.pantry);

  const picks = useMemo(() => {
    if (!hydrated) return [];
    return suggestDrinks(useApp.getState(), recipe, limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, recipe.id, limit, pantry]);

  if (picks.length === 0) return null;

  return (
    <section className={cn("pt-7", className)}>
      <h2 className="mb-1 font-display text-[17px] font-bold">
        Що до цього випити
      </h2>
      <p className="mb-3 text-[11.5px] leading-snug text-faint">
        Це не рецепти: таке купують або роблять за хвилину.
      </p>
      <div className="flex gap-2">
        {picks.map(({ drink, reason, home }) => (
          <div
            key={drink.key}
            className="flex flex-1 flex-col items-center rounded-2xl border border-line bg-surface px-2 py-3 text-center"
          >
            <span className="text-2xl">{drink.emoji}</span>
            <p className="mt-1.5 text-[12.5px] font-bold leading-tight">
              {drink.label}
            </p>
            <p className="mt-1 text-[10.5px] leading-snug text-muted">
              {reason}
            </p>
            {home && (
              <span className="mt-1.5 rounded-full bg-mint/15 px-2 py-0.5 text-[9.5px] font-bold text-mint">
                є вдома
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
