"use client";

import { useEffect, useMemo, useState } from "react";
import { cachedMenu, loadMenu, type RestaurantId, type RestaurantMenu } from "@/data/restaurants";
import { portionLabel } from "@/lib/diary";
import { dishById, portionsOfEntry, restaurantOfProductId } from "@/lib/restaurants";
import type { FoodEntry } from "@/lib/types";
import { formatNumber } from "@/lib/units";

export type LoadedMenus = Partial<Record<RestaurantId, RestaurantMenu>>;

/**
 * Меню закладів, потрібні екрану: вантажить ті, яких ще немає, і
 * перемальовує, коли доїхали. Поки вантажаться — їх просто немає в обʼєкті.
 */
export function useRestaurantMenus(ids: readonly RestaurantId[]): LoadedMenus {
  const key = [...new Set(ids)].sort().join(",");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    for (const id of key.split(",") as RestaurantId[]) {
      if (cachedMenu(id)) continue;
      loadMenu(id)
        .then(() => alive && setTick((t) => t + 1))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [key]);

  return useMemo(() => {
    const out: LoadedMenus = {};
    for (const id of (key ? key.split(",") : []) as RestaurantId[]) {
      const menu = cachedMenu(id);
      if (menu) out[id] = menu;
    }
    return out;
    // tick — щоб перечитати кеш, коли меню доїхало.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
}

/** Заклади, страви яких є серед записів. */
export function restaurantIdsOf(entries: readonly Pick<FoodEntry, "productId">[]): RestaurantId[] {
  return entries.flatMap((e) => restaurantOfProductId(e.productId)?.id ?? []);
}

/**
 * Підпис запису зі страви закладу: «McDonald's · 2 порції». Поки меню не
 * доїхало (або страву з меню прибрали) — заклад і грами з самого запису.
 */
export function restaurantEntryLabel(entry: FoodEntry, menus: LoadedMenus): string | null {
  const restaurant = restaurantOfProductId(entry.productId);
  if (!restaurant || !entry.productId) return null;
  const menu = menus[restaurant.id];
  const dish = menu ? dishById(menu, restaurant.id, entry.productId) : undefined;
  if (dish) return `${restaurant.name} · ${portionLabel(portionsOfEntry(dish, entry))}`;
  return entry.grams != null ? `${restaurant.name} · ${formatNumber(entry.grams, 0)} г` : restaurant.name;
}
