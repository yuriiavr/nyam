"use client";

import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProductThumb } from "@/components/diary/ProductThumb";
import { Button, EmptyState, Sheet } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { isBareStaple, pantryDisplayName } from "@/lib/pantry";
import { shortProductName } from "@/lib/products";
import { useApp } from "@/lib/store";
import type { PantryItem, RecipeIngredient } from "@/lib/types";
import { formatQuantity } from "@/lib/units";
import { cn, haptic } from "@/lib/utils";

/**
 * «З холодильника» у формі рецепта: обрати кілька рядків комори разом.
 *
 * Інгредієнт отримує тип (щоб рецепт знаходився за холодильником), назву
 * товару й етикетку на 100 г — тож калорії рецепта рахуються з цього сиру,
 * а не з «сиру взагалі».
 */
export function FridgePicker({
  open,
  onClose,
  existing,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  existing: readonly RecipeIngredient[];
  onPick: (items: RecipeIngredient[]) => void;
}) {
  const pantry = useApp((s) => s.pantry);
  const products = useApp((s) => s.products);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setPicked(new Set());
  }, [open]);

  /** Рядки, які ще не в рецепті: той самий товар або той самий тип без товару. */
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return pantry
      .filter((row) => !isBareStaple(row))
      .filter((row) =>
        row.productId
          ? !existing.some((i) => i.productId === row.productId)
          : !existing.some((i) => i.key === row.key && !i.productId),
      )
      .filter((row) => {
        const id = row.productId ?? `type:${row.key}:${row.label ?? ""}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => ing(a.key).cat.localeCompare(ing(b.key).cat) || a.key.localeCompare(b.key));
  }, [pantry, existing]);

  const name = (row: PantryItem) => shortProductName(pantryDisplayName(row, products), row.key);

  const add = () => {
    const items = rows
      .filter((row) => picked.has(row.id))
      .map((row): RecipeIngredient => {
        const product = row.productId ? products[row.productId] : undefined;
        const def = ing(row.key);
        const label = product?.name ?? row.label;
        return {
          key: row.key,
          unit: def.defaultUnit ?? "g",
          ...(label && label !== def.label ? { label } : {}),
          ...(product?.nutrition ? { nutrition: product.nutrition } : {}),
          ...(product ? { productId: product.id } : {}),
        };
      });
    haptic(14);
    onPick(items);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="З холодильника"
      footer={
        rows.length > 0 ? (
          <Button full disabled={picked.size === 0} onClick={add}>
            {picked.size > 0 ? `Додати ${picked.size}` : "Обери продукти"}
          </Button>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState emoji="🧊" title="Нема що додати" note="Усе з комори вже в рецепті — або комора поки порожня." />
      ) : (
        <div className="mb-3 overflow-hidden rounded-[10px] border border-line bg-surface">
          {rows.map((row, i) => {
            const product = row.productId ? products[row.productId] : undefined;
            const on = picked.has(row.id);
            const kcal = product?.nutrition?.kcal ?? ing(row.key).nutrition?.kcal;
            return (
              <button
                key={row.id}
                onClick={() => {
                  haptic(8);
                  setPicked((s) => {
                    const next = new Set(s);
                    if (next.has(row.id)) next.delete(row.id);
                    else next.add(row.id);
                    return next;
                  });
                }}
                aria-pressed={on}
                className={cn(
                  "flex min-h-[58px] w-full items-center gap-3 px-3.5 py-2 text-left active:bg-surface-2",
                  i > 0 && "border-t border-line",
                )}
              >
                <ProductThumb product={product} typeKey={row.key} className="h-10 w-10 shrink-0 rounded-[10px]" emojiClass="text-[20px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{name(row)}</span>
                  <span className="block truncate text-[11.5px] font-semibold text-faint">
                    {[
                      row.amount != null && row.unit ? formatQuantity(row.amount, row.unit) : "",
                      kcal != null ? `${Math.round(kcal)} ккал/100 г${product?.nutrition ? "" : " · середнє"}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span
                  className={cn(
                    "grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px] border-[1.5px]",
                    on ? "border-brand bg-brand text-brand-ink" : "border-line-strong",
                  )}
                >
                  {on && <Check size={13} strokeWidth={3.5} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
