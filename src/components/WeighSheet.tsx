"use client";

import { Check, ChevronRight, Scale } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Sheet } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { defaultRow, pantryCandidates, rawWord, weighsCooked, type CookWeight } from "@/lib/cooked";
import { ingredientGrams } from "@/lib/nutrition";
import { pantryDisplayName } from "@/lib/pantry";
import { shortProductName } from "@/lib/products";
import { useApp } from "@/lib/store";
import type { PantryItem, Recipe, RecipeIngredient, Unit } from "@/lib/types";
import { formatNumber, formatQuantity, ingredientQtyLabel, quantityOf, unitDef, unitLabel } from "@/lib/units";
import { cn, haptic } from "@/lib/utils";

/**
 * «Огірок — 50 г» посеред готування.
 *
 * Нарізав, зважив — записав одразу: до кінця салату ваги всіх продуктів уже
 * не згадати. Тут лише число й міра, а для круп, пасти, мʼяса й риби — чи
 * зважено готовим. Пачку з комори аркуш пропонує сам, змінити — один дотик.
 * Після «Готово!» з цих ваг складається склад страви.
 *
 * Без `ingKey` — спершу обрати, що зважив: усі продукти рецепта з уже
 * записаним поруч.
 */
export function WeighSheet({
  open,
  recipe,
  ingKey,
  weights,
  onPick,
  onSave,
  onClose,
}: {
  open: boolean;
  recipe: Recipe;
  /** Що зважуємо; null — обрати з рецепта. */
  ingKey: string | null;
  weights: Readonly<Record<string, CookWeight>>;
  onPick: (key: string) => void;
  /** null — прибрати записану вагу. */
  onSave: (key: string, weight: CookWeight | null) => void;
  onClose: () => void;
}) {
  const pantry = useApp((s) => s.pantry);
  const products = useApp((s) => s.products);
  const item = ingKey ? recipe.ingredients.find((i) => i.key === ingKey) : undefined;
  const items = useMemo(
    () => recipe.ingredients.filter((i, n, all) => all.findIndex((j) => j.key === i.key) === n),
    [recipe.ingredients],
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        item ? (
          <span className="flex items-center gap-3">
            <span className="text-[26px] leading-none">{ing(item.key).emoji}</span>
            <span className="min-w-0 truncate">{item.label ?? ing(item.key).label}</span>
          </span>
        ) : (
          "Що зважив?"
        )
      }
    >
      {item ? (
        // Свій ключ на продукт: поля починають з його ваги, а не з попереднього.
        <WeighForm
          key={item.key}
          item={item}
          weight={weights[item.key]}
          rows={pantryCandidates(pantry, item.key, products)}
          rowName={(row) => shortProductName(pantryDisplayName(row, products), row.key)}
          onSave={(w) => onSave(item.key, w)}
        />
      ) : (
        <div className="mb-3 overflow-hidden rounded-[10px] border border-line bg-surface">
          {items.map((i, n) => {
            const w = weights[i.key];
            return (
              <button
                key={i.key}
                onClick={() => {
                  haptic(8);
                  onPick(i.key);
                }}
                className={cn(
                  "flex h-12 w-full items-center gap-3 px-3.5 text-left active:bg-surface-2",
                  n > 0 && "border-t border-line",
                )}
              >
                <span className="w-[22px] shrink-0 text-lg leading-none">{ing(i.key).emoji}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{i.label ?? ing(i.key).label}</span>
                {w ? (
                  <span className="shrink-0 text-[12.5px] font-bold text-brand">
                    {formatQuantity(w.amount, w.unit)}
                    {w.cooked ? " готового" : ""}
                  </span>
                ) : (
                  <span className="shrink-0 text-[12.5px] font-bold text-muted">{ingredientQtyLabel(i)}</span>
                )}
                <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-faint" />
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

function WeighForm({
  item,
  weight,
  rows,
  rowName,
  onSave,
}: {
  item: RecipeIngredient;
  weight?: CookWeight;
  rows: PantryItem[];
  rowName: (row: PantryItem) => string;
  onSave: (weight: CookWeight | null) => void;
}) {
  const q = quantityOf(item);
  const recipeUnit = q?.unit && q.unit !== "taste" ? q.unit : (ing(item.key).defaultUnit ?? "g");
  // Ваги показують грами — з них і починаємо; міра рецепта поруч, якщо інша («3 шт»).
  const units: Unit[] = recipeUnit === "g" ? ["g"] : ["g", recipeUnit];
  const weighable = weighsCooked(item.key);
  const raw = rawWord(item.key);

  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<Unit>(weight?.unit ?? "g");
  const [cooked, setCooked] = useState(!!weight?.cooked);
  // Зважене — отже, поклали: пачку пропонуємо й для необовʼязкового.
  const [rowId, setRowId] = useState<string | null>(() =>
    weight?.rowId && rows.some((r) => r.id === weight.rowId)
      ? weight.rowId
      : (defaultRow({ ...item, optional: false }, rows)?.id ?? null),
  );

  const amount = Number(value.replace(",", "."));
  const valid = amount > 0 && amount <= 100_000;
  const actualUnit: Unit = cooked ? "g" : unit;
  // Додати можна лише до того самого: «50 г» + «2 шт» — не сума.
  const sameKind = !!weight && weight.unit === actualUnit && !!weight.cooked === cooked;
  const sum = sameKind && weight ? Number((weight.amount + amount).toFixed(unitDef(actualUnit).decimals)) : null;

  const recipeHint = (() => {
    if (!q || q.unit === "taste" || q.amount == null) return item.qty ? `у рецепті ${item.qty}` : "";
    const grams = q.unit !== "g" ? ingredientGrams(item) : null;
    return `у рецепті ${formatQuantity(q.amount, q.unit)}${grams ? ` · ≈${formatNumber(grams, 0)} г` : ""}`;
  })();

  const save = (total: number) => {
    haptic(14);
    onSave({ amount: total, unit: actualUnit, ...(cooked ? { cooked: true } : {}), ...(rowId ? { rowId } : {}) });
  };

  return (
    <div className="flex flex-col gap-3 pb-3">
      {(recipeHint || weight) && (
        <p className="px-1 text-[12.5px] font-semibold text-faint">
          {[recipeHint, weight ? `записано ${formatQuantity(weight.amount, weight.unit)}${weight.cooked ? " готового" : ""}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <div className="flex h-16 items-center gap-2 rounded-[10px] border border-line bg-surface px-3.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, "").slice(0, 7))}
          inputMode="decimal"
          autoFocus
          placeholder={weight ? formatNumber(weight.amount, 1) : "50"}
          aria-label="Скільки"
          className="h-full min-w-0 flex-1 bg-transparent text-center font-display text-[28px] font-bold tabular-nums placeholder:text-faint"
        />
        <span className="w-10 shrink-0 text-[15px] font-bold text-muted">{unitLabel(actualUnit)}</span>
      </div>

      {((!cooked && units.length > 1) || weighable) && (
        <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
          {!cooked && units.length > 1 && (
            <div className="flex h-[50px] items-center gap-1.5 px-3.5">
              <span className="min-w-0 flex-1 text-[14px] font-semibold text-muted">Міра</span>
              {units.map((u) => (
                <button
                  key={u}
                  aria-pressed={unit === u}
                  onClick={() => {
                    haptic(8);
                    setUnit(u);
                  }}
                  className={cn(
                    "h-8 shrink-0 rounded-[8px] border px-3 text-[12.5px] font-bold",
                    unit === u ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface text-muted",
                  )}
                >
                  {unitLabel(u)}
                </button>
              ))}
            </div>
          )}

          {weighable && (
            <div
              className={cn(
                "flex h-[50px] items-center gap-1.5 px-3.5",
                !cooked && units.length > 1 && "border-t border-line",
              )}
            >
              <span className="min-w-0 flex-1 text-[14px] font-semibold text-muted">Вага</span>
              {([false, true] as const).map((c) => (
                <button
                  key={String(c)}
                  aria-pressed={cooked === c}
                  onClick={() => {
                    haptic(8);
                    setCooked(c);
                  }}
                  className={cn(
                    "h-8 shrink-0 rounded-[8px] border px-3 text-[12.5px] font-bold",
                    cooked === c ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface text-muted",
                  )}
                >
                  {c ? "готового" : raw}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {rows.map((row) => {
            const on = rowId === row.id;
            return (
              <button
                key={row.id}
                aria-pressed={on}
                onClick={() => {
                  haptic(8);
                  setRowId(on ? null : row.id);
                }}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px] font-bold",
                  on ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface text-muted",
                )}
              >
                {on && <Check size={13} strokeWidth={3.5} />}
                <span className="max-w-[160px] truncate">{rowName(row)}</span>
                {row.amount != null && row.unit && (
                  <span className="font-semibold text-faint">{formatQuantity(row.amount, row.unit)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {sum != null ? (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={!valid} onClick={() => save(amount)}>
            Замінити
          </Button>
          <Button className="flex-1" disabled={!valid} onClick={() => save(sum)}>
            + Додати{valid ? ` · ${formatQuantity(sum, actualUnit)}` : ""}
          </Button>
        </div>
      ) : (
        <Button full disabled={!valid} onClick={() => save(amount)}>
          <Scale size={18} />
          Записати{valid ? ` ${formatQuantity(amount, actualUnit)}` : ""}
        </Button>
      )}
      {weight && (
        <button
          onClick={() => {
            haptic(8);
            onSave(null);
          }}
          className="h-10 text-[13.5px] font-semibold text-berry"
        >
          Прибрати записане
        </button>
      )}
    </div>
  );
}
