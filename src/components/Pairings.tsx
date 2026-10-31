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
import { Panel, PanelHeader } from "./ui";

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
  /*
   * Каталог дописаних — теж залежність: новий батько в дописаному типі міняє,
   * що «вже є в коморі», хоч сама комора не змінилась.
   */
  const customIngredients = useApp((s) => s.customIngredients);
  /*
   * Картки товарів: правка типу картки переписує тип рядків комори (D4), і
   * «вже є» мусить перерахуватись від неї, навіть коли масив комори той самий.
   */
  const products = useApp((s) => s.products);

  const pairs = useMemo(() => {
    if (!hydrated) return [];
    const snapshot = useApp.getState();
    return suggestPairs(snapshot, recipe, allRecipes(snapshot), limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, recipe.id, limit, myRecipes, remoteRecipes, cooked, pantry, customIngredients, products]);

  const heading = PAIR_HEADING[courseOf(recipe)];
  if (!heading || pairs.length === 0) return null;

  return (
    <Panel className={className}>
      <PanelHeader label={heading} />
      {pairs.map(({ recipe: pair, reason }) => (
        <RecipeRow
          key={pair.id}
          flat
          recipe={pair}
          href={`/recipe/${pair.id}`}
          subtitle={
            <span className="text-brand">
              {COURSE_LABEL[courseOf(pair)].toLowerCase()} · {reason}
            </span>
          }
        />
      ))}
    </Panel>
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
  const customIngredients = useApp((s) => s.customIngredients);
  const products = useApp((s) => s.products);

  const picks = useMemo(() => {
    if (!hydrated) return [];
    return suggestDrinks(useApp.getState(), recipe, limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, recipe.id, limit, pantry, customIngredients, products]);

  if (picks.length === 0) return null;

  return (
    <Panel className={className}>
      <PanelHeader label="Що до цього випити" />
      <div className={cn("grid gap-px border-t border-line bg-line", picks.length === 1 ? "grid-cols-1" : picks.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
        {picks.map(({ drink, reason, home }) => (
          <div key={drink.key} className="flex flex-col items-center bg-surface px-2 py-3 text-center">
            <span className="text-[24px]">{drink.emoji}</span>
            <p className="mt-1.5 text-[12.5px] font-extrabold leading-tight">{drink.label}</p>
            <p className="mt-1 text-[10.5px] font-semibold leading-snug text-faint">{reason}</p>
            {home && (
              <span className="mt-1.5 rounded-[5px] bg-brand/15 px-1.5 py-0.5 text-[9.5px] font-extrabold text-brand">
                є вдома
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="border-t border-line px-3.5 py-2 text-[11px] font-semibold leading-snug text-faint">
        Це не рецепти: таке купують або роблять за хвилину.
      </p>
    </Panel>
  );
}
