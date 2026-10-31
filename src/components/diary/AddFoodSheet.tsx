"use client";

import { Barcode, ChevronRight, MessageSquareText, Search, Store } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { Panel, PanelHeader, Sheet } from "@/components/ui";
import { RESTAURANTS } from "@/data/restaurants";
import { ing } from "@/data/ingredients";
import {
  leftoverServings,
  leftovers,
  mealNutrition,
  portionLabel,
  recentProducts,
  scaleNutrition,
} from "@/lib/diary";
import { isBareStaple, pantryDisplayName } from "@/lib/pantry";
import { shortProductName } from "@/lib/products";
import { diaryUserId, recipeById, useApp } from "@/lib/store";
import type { Meal } from "@/lib/types";
import { haptic } from "@/lib/utils";
import type { FoodTarget } from "./AmountSheet";
import { ProductThumb } from "./ProductThumb";
import { RestaurantLogo } from "./RestaurantSheet";

/**
 * «Додати їжу» — усі шляхи в одному місці, від найшвидшого:
 * сканер (батончик), пошук (йогурт), опис словами (картопля з сосисками),
 * страва з меню закладу (Біг Мак), залишок учорашньої страви, щойно
 * зʼїдене ще раз, щось із комори.
 */
export function AddFoodSheet({
  open,
  onClose,
  title = "Додати їжу",
  onScan,
  onSearch,
  onDescribe,
  onRestaurant,
  onPick,
  onLeftover,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  onScan: () => void;
  onSearch: () => void;
  onDescribe: () => void;
  /** «З закладу»: меню McDonald's, KFC… */
  onRestaurant: () => void;
  onPick: (target: FoodTarget) => void;
  onLeftover: (meal: Meal) => void;
}) {
  const account = useApp((s) => s.account);
  const foodLog = useApp((s) => s.foodLog);
  const meals = useApp((s) => s.meals);
  const pantry = useApp((s) => s.pantry);
  const products = useApp((s) => s.products);

  const me = diaryUserId({ account });
  const rest = useMemo(() => (open ? leftovers(meals, foodLog) : []), [open, meals, foodLog]);
  const recent = useMemo(
    () => (open ? recentProducts(foodLog, me).filter((r) => products[r.productId]) : []),
    [open, foodLog, me, products],
  );

  /** З комори: товари й типи з кількістю, свіжі покупки першими, без повторів. */
  const fromPantry = useMemo(() => {
    if (!open) return [];
    const seen = new Set<string>();
    return [...pantry]
      .filter((row) => !isBareStaple(row) && row.amount != null)
      .sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""))
      .filter((row) => {
        const key = row.productId ?? `type:${row.key}:${row.label ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12);
  }, [open, pantry]);

  const pick = (target: FoodTarget) => {
    haptic(10);
    onPick(target);
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-3 pb-3">
        <div className="grid grid-cols-3 gap-2">
          <Tile icon={<Barcode size={22} />} label="Сканувати" onClick={onScan} />
          <Tile icon={<Search size={22} />} label="Знайти" onClick={onSearch} />
          <Tile icon={<MessageSquareText size={22} />} label="Описати" onClick={onDescribe} />
        </div>

        <Panel>
          <button
            onClick={() => {
              haptic(10);
              onRestaurant();
            }}
            className="flex h-[58px] w-full items-center gap-3 px-3.5 text-left active:bg-surface-2"
          >
            <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[8px] bg-surface-2 text-brand">
              <Store size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold">З закладу</span>
              <span className="block truncate text-[12px] font-semibold text-faint">
                {RESTAURANTS.map((r) => r.name).join(", ")}
              </span>
            </span>
            <span className="flex shrink-0 -space-x-2" aria-hidden>
              {RESTAURANTS.map((r) => (
                <RestaurantLogo
                  key={r.id}
                  restaurant={r}
                  className="h-7 w-7 rounded-full border-2 border-surface p-[3px]"
                />
              ))}
            </span>
            <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-faint" />
          </button>
        </Panel>

        {rest.length > 0 && (
          <Panel>
            <PanelHeader label="Залишки" />
            {rest.map((meal) => {
              const total = mealNutrition(meal, meal.recipeId ? recipeById(useApp.getState(), meal.recipeId) : undefined);
              const portion = total ? Math.round(scaleNutrition(total, 1 / meal.servings).kcal) : null;
              return (
                <button
                  key={meal.id}
                  onClick={() => {
                    haptic(10);
                    onLeftover(meal);
                  }}
                  className="flex h-[54px] w-full items-center gap-3 border-t border-line px-3.5 text-left active:bg-surface-2"
                >
                  <span className="w-6 shrink-0 text-center text-[20px]">{meal.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{meal.title}</span>
                    <span className="block truncate text-[11.5px] font-semibold text-faint">
                      лишилось {portionLabel(leftoverServings(meal, foodLog))}
                      {portion != null && ` · ${portion} ккал/порція`}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] font-extrabold text-brand">Доїсти</span>
                </button>
              );
            })}
          </Panel>
        )}

        {recent.length > 0 && (
          <Panel>
            <PanelHeader label="Нещодавнє" />
            <div className="no-scrollbar flex gap-2 overflow-x-auto border-t border-line p-3">
              {recent.map((r) => {
                const product = products[r.productId];
                return (
                  <button
                    key={r.productId}
                    onClick={() => pick({ kind: "product", product, grams: r.grams })}
                    className="flex w-[96px] shrink-0 flex-col gap-1.5 text-left"
                  >
                    <ProductThumb product={product} className="aspect-square w-full rounded-[8px]" />
                    <span className="line-clamp-2 text-[12px] font-semibold leading-tight">{product.name}</span>
                  </button>
                );
              })}
            </div>
          </Panel>
        )}

        {fromPantry.length > 0 && (
          <Panel>
            <PanelHeader label="З комори" />
            {fromPantry.map((row) => {
              const product = row.productId ? products[row.productId] : undefined;
              const name = shortProductName(pantryDisplayName(row, products), row.key);
              const kcal = product?.nutrition?.kcal ?? ing(row.key).nutrition?.kcal;
              return (
                <button
                  key={row.id}
                  onClick={() =>
                    pick(product ? { kind: "product", product } : { kind: "type", typeKey: row.key, label: name })
                  }
                  className="flex h-[52px] w-full items-center gap-3 border-t border-line px-3.5 text-left active:bg-surface-2"
                >
                  <ProductThumb
                    product={product}
                    typeKey={row.key}
                    className="h-[34px] w-[34px] shrink-0 rounded-[8px]"
                    emojiClass="text-[18px]"
                  />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{name}</span>
                  {kcal != null && (
                    <span className="shrink-0 text-[12px] font-semibold text-faint">{Math.round(kcal)} ккал/100</span>
                  )}
                  <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-faint" />
                </button>
              );
            })}
          </Panel>
        )}
      </div>
    </Sheet>
  );
}

/** Плитка способу додати — як у макеті: темна, з помаранчевою іконкою. */
function Tile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={() => {
        haptic(10);
        onClick();
      }}
      className="flex h-[76px] flex-col items-center justify-center gap-2 rounded-[10px] border border-line bg-surface text-[12.5px] font-bold active:bg-surface-2"
    >
      <span className="text-brand">{icon}</span>
      {label}
    </motion.button>
  );
}
