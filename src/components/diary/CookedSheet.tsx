"use client";

import { Check, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FridgePicker } from "@/components/FridgePicker";
import { Button, Sheet } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { defaultRow, pantryCandidates, rawWord, weighsCooked, type CookWeight } from "@/lib/cooked";
import { cookedComposition, type CookedPart } from "@/lib/diary";
import { FOOD_AI_MESSAGE, countCookedDish } from "@/lib/food-client";
import { ingredientGrams } from "@/lib/nutrition";
import type { CookedDish, CookedLine } from "@/lib/nutrition-ai";
import { pantryDisplayName, restorePantryById } from "@/lib/pantry";
import type { Product } from "@/lib/product-types";
import { shortProductName } from "@/lib/products";
import { useApp } from "@/lib/store";
import type { MealItem, Nutrition, PantryItem, Recipe, RecipeIngredient, Unit } from "@/lib/types";
import {
  formatNumber,
  formatQuantity,
  quantityOf,
  scaleAmount,
  scaleLegacyQty,
  unitDef,
  unitLabel,
} from "@/lib/units";
import { cn, haptic, newId } from "@/lib/utils";

/** Рядок складу в аркуші. Кількість — як набрана, щоб «0,5» не ставало «0.5» посеред введення. */
export interface CookedDraftLine {
  id: string;
  key: string;
  /** Назва з рецепта — поки з комори нічого не обрано. */
  name: string;
  amount: string;
  unit: Unit;
  /** Як у рецепті — підказка поруч і що повернути, коли «готового» вимкнули. */
  recipeAmount?: number;
  recipeUnit?: Unit;
  /** Старий вільний текст кількості з рецепта: «2-3 шт». */
  qty?: string;
  /** Рядок комори, з якого брали; null — не з комори. */
  rowId: string | null;
  /** Вагу знято з готового продукту. */
  cooked: boolean;
  optional?: boolean;
  /** Етикетка товару з рецепта — коли з комори нічого не обрали. */
  nutrition?: Nutrition;
  /** Товар із рецепта: його пачку пропонуємо першою. */
  productId?: string;
  /** Вагу записали посеред готування. */
  weighed?: boolean;
}

export interface CookedSave {
  lines: CookedDraftLine[];
  items: MealItem[];
  nutrition: Nutrition;
  note?: string;
  /** Що зняти з комори: рядок і грами сирого чи сухого. */
  wants: Array<{ id: string; grams: number }>;
}

const NO_WEIGHTS: Readonly<Record<string, CookWeight>> = {};

/** Рецепт на `factor` від себе: на одну порцію дрібне не зникає в нуль. */
function scaled(amount: number, unit: Unit, factor: number): number {
  const n = scaleAmount(amount, unit, factor);
  return n > 0 || !(amount > 0) ? n : unitDef(unit).decimals > 0 ? 0.25 : 1;
}

const amountOf = (line: CookedDraftLine) => Number(line.amount.replace(",", "."));

/** Етикетка картки, а не оцінка ШІ: оцінку модель зробить і сама, свіжішу. */
const labelOf = (product: Product | undefined) =>
  product?.nutrition && product.nutritionSource !== "ai" ? product.nutrition : undefined;

/**
 * Рядок з рецепта — з вагою, записаною посеред готування, якщо її записали.
 * `factor` — частка рецепта: на одну порцію це 1/порцій.
 */
function lineFromRecipe(
  item: RecipeIngredient,
  view: readonly PantryItem[],
  products: Record<string, Product>,
  weight?: CookWeight,
  factor = 1,
): CookedDraftLine {
  const q = quantityOf(item);
  const recipeUnit = q?.unit ?? ing(item.key).defaultUnit ?? "g";
  const recipeAmount = q?.amount != null ? scaled(q.amount, recipeUnit, factor) : undefined;
  const rows = pantryCandidates(view, item.key, products);
  // Зважене — отже, поклали: і необовʼязкове, і з тієї пачки, яку тоді обрали.
  const chosen =
    (weight?.rowId ? rows.find((row) => row.id === weight.rowId) : undefined) ??
    defaultRow(weight ? { ...item, optional: false } : item, rows, recipeUnit);
  const unit = weight?.unit ?? recipeUnit;
  const amount = weight?.amount ?? recipeAmount;
  return {
    id: newId(),
    key: item.key,
    name: item.label ?? ing(item.key).label,
    amount: amount != null ? formatNumber(amount, unitDef(unit).decimals) : "",
    unit,
    ...(recipeAmount != null ? { recipeAmount, recipeUnit } : {}),
    ...(q?.amount == null && item.qty && recipeUnit !== "taste" ? { qty: scaleLegacyQty(item.qty, factor) } : {}),
    rowId: chosen?.id ?? null,
    cooked: !!weight?.cooked,
    ...(item.optional ? { optional: true } : {}),
    ...(item.nutrition ? { nutrition: item.nutrition } : {}),
    ...(item.productId ? { productId: item.productId } : {}),
    ...(weight ? { weighed: true } : {}),
  };
}

/**
 * «Що пішло в страву» — склад після готування, а не з рецепта.
 *
 * Вдома кладуть на око: макаронів менше, сиру більше, бекон з тієї пачки,
 * що відкрита. Тут людина виправляє кількості, тицяє, з якої саме пачки
 * брала, і для круп, пасти, мʼяса й риби каже, що зважила: сухе з пачки чи
 * вже готове в каструлі. ШІ рахує страву з етикеток саме цих пачок, а
 * зважене готовим — сам: етикетка на сухий продукт до звареного не пасує.
 * Комору списуємо за цим складом, а не за рецептом.
 *
 * `portion` — те саме для однієї порції: «Зʼїв» зі сторінки рецепта, де
 * людина каже, що було в її тарілці. Кількості рецепта ділимо на його
 * порції, а скільки таких порцій вийшло й хто скільки зʼїв, вирішує поділ.
 */
export function CookedSheet({
  open,
  recipe,
  pantryBefore,
  draft,
  weights = NO_WEIGHTS,
  portion = false,
  onClose,
  onSave,
}: {
  open: boolean;
  recipe: Recipe;
  /** Рядки комори до списання за рецептом: показуємо комору, якою вона була до готування. */
  pantryBefore: readonly PantryItem[];
  /** Склад, який уже розписували, — щоб відкрити його, а не рецепт наново. */
  draft?: CookedDraftLine[] | null;
  /** Ваги, записані посеред готування: ними й заповнюємо склад. */
  weights?: Readonly<Record<string, CookWeight>>;
  /** Склад однієї порції, а не всієї страви. */
  portion?: boolean;
  onClose: () => void;
  onSave: (result: CookedSave) => void;
}) {
  const pantry = useApp((s) => s.pantry);
  const products = useApp((s) => s.products);
  const [lines, setLines] = useState<CookedDraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  /* Комора до готування: списане за рецептом ще лежить у пачках. */
  const view = useMemo(() => restorePantryById(pantry, pantryBefore), [pantry, pantryBefore]);
  const rows = useMemo(() => new Map(view.map((row) => [row.id, row])), [view]);

  useEffect(() => {
    if (!open) {
      ctrl.current?.abort();
      return;
    }
    setBusy(false);
    setProblem(null);
    const factor = portion ? 1 / Math.max(1, recipe.servings || 1) : 1;
    setLines(
      draft?.length
        ? draft
        : recipe.ingredients.map((item) => lineFromRecipe(item, view, products, weights[item.key], factor)),
    );
    // Лише на відкритті: комора міняється зі знімками, а вибір людини — ні.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (id: string, change: Partial<CookedDraftLine>) =>
    setLines((list) => list.map((line) => (line.id === id ? { ...line, ...change } : line)));

  /** Підказка біля кількості: на порцію — це вже не «у рецепті», а його частка. */
  const recipeWord = portion ? "за рецептом" : "у рецепті";
  const rowName = (row: PantryItem) => shortProductName(pantryDisplayName(row, products), row.key);
  const productOf = (line: CookedDraftLine) => {
    const row = line.rowId ? rows.get(line.rowId) : undefined;
    return row?.productId ? products[row.productId] : undefined;
  };

  /** Без кількості можна лише «за смаком» і старий текст рецепта («2-3 шт»), який модель прочитає сама. */
  const missing = (line: CookedDraftLine) =>
    line.unit !== "taste" && !(amountOf(line) > 0) && !(line.qty && !line.cooked && !line.amount.trim());
  const ready = lines.length > 0 && !lines.some(missing);

  const toCooked = (line: CookedDraftLine): CookedLine => {
    const row = line.rowId ? rows.get(line.rowId) : undefined;
    const type = ing(line.key).label;
    const own = row ? pantryDisplayName(row, products) : line.name;
    const name = own.toLowerCase() !== type.toLowerCase() ? `${own} (${type})` : own;
    const amount = amountOf(line);
    const qty =
      line.unit === "taste" ? unitLabel("taste") : amount > 0 ? formatQuantity(amount, line.unit) : (line.qty ?? "");
    // Етикетка — обраної пачки; не з комори — товару з рецепта. Зваженому готовим — жодної.
    const label = line.cooked ? undefined : row ? labelOf(productOf(line)) : line.nutrition;
    return { name, qty, ...(line.cooked ? { cooked: true } : {}), ...(label ? { label } : {}) };
  };

  /** Сира вага за мірою людини; штуки — за вагою штуки пачки, якщо вона її знає. */
  const rawGrams = (line: CookedDraftLine): number | null => {
    const amount = amountOf(line);
    if (line.cooked || !(amount > 0)) return null;
    const piece = productOf(line)?.gramsPerPiece;
    if (line.unit === "pcs" && piece) return amount * piece;
    return ingredientGrams({ key: line.key, amount, unit: line.unit });
  };

  const save = async () => {
    if (!ready || busy) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setProblem(null);

    const dish: CookedDish = {
      title: portion ? `${recipe.title} — одна порція` : recipe.title,
      description: recipe.description,
      lines: lines.map(toCooked),
      steps: recipe.steps,
    };
    const res = await countCookedDish(dish, c.signal);
    if (c.signal.aborted) return;
    setBusy(false);
    if (!res.ok) {
      setProblem(FOOD_AI_MESSAGE[res.reason]);
      return;
    }

    const parts = lines.map((line, i): CookedPart => {
      const row = line.rowId ? rows.get(line.rowId) : undefined;
      const product = productOf(line);
      return {
        name: row ? rowName(row) : line.name,
        typeKey: line.key,
        ...(product ? { productId: product.id } : line.productId && !row ? { productId: line.productId } : {}),
        ...(row ? { pantryId: row.id } : {}),
        grams: rawGrams(line),
        cooked: line.cooked,
        labelled: !!dish.lines[i].label,
      };
    });
    const { items, takes } = cookedComposition(parts, res.items);
    const { note, ...nutrition } = res.nutrition;
    haptic(16);
    onSave({ lines, items, nutrition, ...(note ? { note } : {}), wants: takes });
  };

  /** «З холодильника» віддає товари, а не рядки: беремо рядок, з якого рецепт узяв би першим. */
  const addFromFridge = (picked: RecipeIngredient[]) => {
    const added = picked.map((item): CookedDraftLine => {
      const fit = pantryCandidates(view, item.key, products).filter((row) =>
        item.productId ? row.productId === item.productId : !row.productId && row.key === item.key,
      );
      return {
        id: newId(),
        key: item.key,
        name: item.label ?? ing(item.key).label,
        amount: "",
        unit: item.unit ?? ing(item.key).defaultUnit ?? "g",
        rowId: fit[0]?.id ?? null,
        cooked: false,
      };
    });
    setLines((list) => [...list, ...added]);
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={portion ? "Що було в порції" : "Що пішло в страву"}
        footer={
          <div className="flex flex-col gap-2">
            {problem && <p className="text-center text-[13px] font-semibold text-berry">{problem}</p>}
            <Button full size="lg" loading={busy} disabled={!ready} onClick={() => void save()}>
              <Sparkles size={17} />
              {!ready ? "Впиши, скільки пішло" : portion ? "Порахувати порцію" : "Порахувати й зберегти"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-[12.5px] leading-snug text-muted">
            {portion
              ? "Впиши, скільки чого було в одній порції, і познач, з якої пачки. ШІ порахує калорії з етикеток саме цих пачок."
              : "Виправ, скільки чого поклали, і познач, з якої пачки брали. ШІ порахує калорії з етикеток саме цих пачок, а комора спише те, що справді пішло."}
          </p>

          {lines.map((line) => {
            const row = line.rowId ? rows.get(line.rowId) : undefined;
            const options = pantryCandidates(view, line.key, products);
            const weighable = weighsCooked(line.key);
            const raw = rawWord(line.key);
            const hint = [
              line.weighed ? "⚖️ зважено" : "",
              line.recipeAmount != null && line.recipeUnit
                ? `${recipeWord} ${formatQuantity(line.recipeAmount, line.recipeUnit)}`
                : line.qty
                  ? `${recipeWord} ${line.qty}`
                  : "",
              line.optional ? "за бажанням" : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={line.id}
                className={cn("rounded-2xl border p-3", missing(line) ? "border-berry/50" : "border-line")}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{ing(line.key).emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{row ? rowName(row) : line.name}</span>
                    {hint && <span className="block truncate text-[11.5px] text-faint">{hint}</span>}
                  </span>
                  {line.unit === "taste" ? (
                    <span className="text-[12.5px] text-muted">за смаком</span>
                  ) : (
                    <>
                      <input
                        value={line.amount}
                        onChange={(e) => patch(line.id, { amount: e.target.value.replace(/[^\d.,]/g, "").slice(0, 7) })}
                        inputMode="decimal"
                        placeholder={line.cooked ? "300" : (line.qty ?? "0")}
                        aria-label={`${line.name}: скільки пішло`}
                        className="h-9 w-16 rounded-xl bg-surface-2 px-2 text-center text-[14px] font-bold"
                      />
                      <span className="w-9 text-[12px] text-muted">{unitLabel(line.unit)}</span>
                    </>
                  )}
                  <button
                    aria-label={`Не клали: ${line.name}`}
                    onClick={() => {
                      haptic(8);
                      setLines((list) => list.filter((l) => l.id !== line.id));
                    }}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-muted active:bg-surface-2"
                  >
                    <X size={16} />
                  </button>
                </div>

                {options.length > 0 && (
                  <div className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1">
                    {options.map((option) => {
                      const on = line.rowId === option.id;
                      return (
                        <button
                          key={option.id}
                          aria-pressed={on}
                          onClick={() => {
                            haptic(8);
                            patch(line.id, { rowId: on ? null : option.id });
                          }}
                          className={cn(
                            "flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[12.5px]",
                            on ? "border-brand bg-brand/10 font-bold" : "border-line text-muted",
                          )}
                        >
                          {on && <Check size={13} strokeWidth={3} className="text-brand" />}
                          <span className="max-w-[160px] truncate">{rowName(option)}</span>
                          {option.amount != null && option.unit && (
                            <span className="font-normal text-faint">{formatQuantity(option.amount, option.unit)}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {options.length > 0 && !row && <p className="mt-1.5 text-[11.5px] text-faint">не з комори</p>}

                {weighable && line.unit !== "taste" && (
                  <div className="mt-2 flex items-center gap-1.5 text-[12px]">
                    <span className="text-muted">Вага:</span>
                    {([false, true] as const).map((cooked) => (
                      <button
                        key={String(cooked)}
                        aria-pressed={line.cooked === cooked}
                        onClick={() => {
                          if (line.cooked === cooked) return;
                          haptic(8);
                          // Готове зважують у грамах; назад — міра з рецепта.
                          patch(
                            line.id,
                            cooked
                              ? { cooked, unit: "g", amount: "" }
                              : {
                                  cooked,
                                  unit: line.recipeUnit ?? ing(line.key).defaultUnit ?? "g",
                                  amount:
                                    line.recipeAmount != null && line.recipeUnit
                                      ? formatNumber(line.recipeAmount, unitDef(line.recipeUnit).decimals)
                                      : "",
                                },
                          );
                        }}
                        className={cn(
                          "rounded-full border px-2.5 py-1 font-semibold",
                          line.cooked === cooked ? "border-brand bg-brand/10 text-ink" : "border-line text-muted",
                        )}
                      >
                        {cooked ? "готового" : raw}
                      </button>
                    ))}
                  </div>
                )}
                {line.cooked && (
                  <p className="mt-1.5 text-[11.5px] leading-snug text-faint">
                    {`Етикетка — на ${raw} продукт, тож готовий ШІ порахує сам`}
                    {portion ? "." : ` і спише з пачки, скільки ${raw} на це пішло.`}
                  </p>
                )}
              </div>
            );
          })}

          <button
            onClick={() => {
              haptic(8);
              setAdding(true);
            }}
            className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line py-3 text-[13.5px] font-bold text-brand"
          >
            <Plus size={16} />
            Додати з комори
          </button>
        </div>
      </Sheet>

      {/* Поруч, а не всередині: аркуш зсунутий transform-ом, і вкладений fixed жив би в його межах. */}
      <FridgePicker
        open={adding}
        onClose={() => setAdding(false)}
        existing={lines.map((line) => {
          const product = productOf(line);
          return { key: line.key, ...(product ? { productId: product.id } : {}) };
        })}
        onPick={addFromFridge}
      />
    </>
  );
}
