"use client";

import { Barcode, ChevronRight, MessageSquareText, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { Sheet } from "@/components/ui";
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

/**
 * «Додати їжу» — усі шляхи в одному місці, від найшвидшого:
 * сканер (батончик), пошук (йогурт), опис словами (картопля з сосисками),
 * залишок учорашньої страви, щойно зʼїдене ще раз, щось із комори.
 */
export function AddFoodSheet({
  open,
  onClose,
  title = "Додати їжу",
  onScan,
  onSearch,
  onDescribe,
  onPick,
  onLeftover,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  onScan: () => void;
  onSearch: () => void;
  onDescribe: () => void;
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
      <div className="flex flex-col gap-5 pb-3">
        <div className="grid grid-cols-3 gap-2">
          <Tile icon={<Barcode size={24} />} label="Сканувати" onClick={onScan} accent />
          <Tile icon={<Search size={24} />} label="Знайти" onClick={onSearch} />
          <Tile icon={<MessageSquareText size={24} />} label="Описати" onClick={onDescribe} />
        </div>

        {rest.length > 0 && (
          <section>
            <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">Залишки</h3>
            <div className="flex flex-col gap-1.5">
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
                    className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5 text-left active:bg-line"
                  >
                    <span className="text-2xl">{meal.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold">{meal.title}</span>
                      <span className="block text-[12px] text-muted">
                        лишилось {portionLabel(leftoverServings(meal, foodLog))}
                        {portion != null && ` · ${portion} ккал/порція`}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-brand/10 px-2.5 py-1 text-[12px] font-bold text-brand">
                      Доїсти
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">Нещодавнє</h3>
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
              {recent.map((r) => {
                const product = products[r.productId];
                return (
                  <button
                    key={r.productId}
                    onClick={() => pick({ kind: "product", product, grams: r.grams })}
                    className="flex w-[104px] shrink-0 flex-col gap-1.5 text-left"
                  >
                    <ProductThumb product={product} className="aspect-square w-full rounded-2xl" />
                    <span className="line-clamp-2 text-[12px] font-semibold leading-tight">{product.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {fromPantry.length > 0 && (
          <section>
            <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">З комори</h3>
            <div className="flex flex-col">
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
                    className="flex items-center gap-3 border-b border-line py-2 text-left last:border-0"
                  >
                    <ProductThumb product={product} typeKey={row.key} className="h-10 w-10 shrink-0 rounded-xl" emojiClass="text-[20px]" />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{name}</span>
                    {kcal != null && <span className="shrink-0 text-[12px] text-muted">{Math.round(kcal)} ккал/100</span>}
                    <ChevronRight size={16} className="shrink-0 text-faint" />
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}

function Tile({
  icon,
  label,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={() => {
        haptic(10);
        onClick();
      }}
      className={
        accent
          ? "flex flex-col items-center gap-1.5 rounded-2xl brand-gradient px-2 py-4 text-[13px] font-bold text-brand-ink"
          : "flex flex-col items-center gap-1.5 rounded-2xl bg-surface-2 px-2 py-4 text-[13px] font-bold"
      }
    >
      {icon}
      {label}
    </motion.button>
  );
}
