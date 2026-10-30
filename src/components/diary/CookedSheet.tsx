"use client";

import { Check, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FridgePicker } from "@/components/FridgePicker";
import { Button, QuantityInput, Sheet } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { convertAmount, defaultRow, pantryCandidates, rawWord, weighsCooked, type CookWeight } from "@/lib/cooked";
import { cookedComposition, type CookedPart } from "@/lib/diary";
import { FOOD_AI_MESSAGE, countCookedDish } from "@/lib/food-client";
import { ingredientGrams } from "@/lib/nutrition";
import type { CookedDish, CookedLine } from "@/lib/nutrition-ai";
import { pantryDisplayName, restorePantryById } from "@/lib/pantry";
import type { Product } from "@/lib/product-types";
import { shortProductName } from "@/lib/products";
import { useApp } from "@/lib/store";
import type { MealItem, Nutrition, PantryItem, Recipe, RecipeIngredient, Unit } from "@/lib/types";
import { formatNumber, formatQuantity, quantityOf, scaleAmount, scaleLegacyQty, unitDef, unitLabel } from "@/lib/units";
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

/** Без кількості можна лише «за смаком» і старий текст рецепта («2-3 шт»), який модель прочитає сама. */
export const lineMissing = (line: CookedDraftLine) =>
  line.unit !== "taste" && !(amountOf(line) > 0) && !(line.qty && !line.cooked && !line.amount.trim());

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
 * Склад → ШІ → калорії, склад страви й що списати з комори.
 *
 * Окремо від аркуша, бо порахувати треба й тоді, коли аркуш закрили не
 * натиснувши «Порахувати»: змінене не має піти в щоденник з калоріями
 * рецепта. null — запит скасували.
 */
export async function countComposition({
  lines,
  recipe,
  rows,
  products,
  portion = false,
  signal,
}: {
  lines: readonly CookedDraftLine[];
  recipe: Recipe;
  /** Комора, з якої обирали пачки, — за id. */
  rows: ReadonlyMap<string, PantryItem>;
  products: Readonly<Record<string, Product>>;
  portion?: boolean;
  signal?: AbortSignal;
}): Promise<{ ok: true; result: CookedSave } | { ok: false; problem: string } | null> {
  const rowOf = (line: CookedDraftLine) => (line.rowId ? rows.get(line.rowId) : undefined);
  const productOf = (line: CookedDraftLine) => {
    const row = rowOf(line);
    return row?.productId ? products[row.productId] : undefined;
  };

  const toCooked = (line: CookedDraftLine): CookedLine => {
    const row = rowOf(line);
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

  const dish: CookedDish = {
    title: portion ? `${recipe.title} — одна порція` : recipe.title,
    description: recipe.description,
    lines: lines.map(toCooked),
    steps: recipe.steps,
  };
  const res = await countCookedDish(dish, signal);
  if (signal?.aborted) return null;
  if (!res.ok) return { ok: false, problem: FOOD_AI_MESSAGE[res.reason] };

  const parts = lines.map((line, i): CookedPart => {
    const row = rowOf(line);
    const product = productOf(line);
    return {
      name: row ? shortProductName(pantryDisplayName(row, products), row.key) : line.name,
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
  return { ok: true, result: { lines: [...lines], items, nutrition, ...(note ? { note } : {}), wants: takes } };
}

/**
 * «Що пішло в страву» — склад після готування, а не з рецепта.
 *
 * Вдома кладуть на око: макаронів менше, сиру більше, бекон з тієї пачки,
 * що відкрита. Тут людина виправляє кількості й міри (у рецепті «2 шт», а
 * зважила 130 г), тицяє, з якої саме пачки брала, і для круп, пасти, мʼяса
 * й риби каже, що зважила: сухе з пачки чи вже готове в каструлі. ШІ рахує
 * страву з етикеток саме цих пачок, а зважене готовим — сам: етикетка на
 * сухий продукт до звареного не пасує. Комору списуємо за цим складом, а не
 * за рецептом.
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
  onDraft,
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
  /** Закрили, не порахувавши, а щось уже змінили: змінене не губимо. */
  onDraft?: (lines: CookedDraftLine[]) => void;
  onSave: (result: CookedSave) => void;
}) {
  const pantry = useApp((s) => s.pantry);
  const products = useApp((s) => s.products);
  const [lines, setLines] = useState<CookedDraftLine[]>([]);
  const [touched, setTouched] = useState(false);
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
    setTouched(false);
    const factor = portion ? 1 / Math.max(1, recipe.servings || 1) : 1;
    setLines(
      draft?.length
        ? draft
        : recipe.ingredients.map((item) => lineFromRecipe(item, view, products, weights[item.key], factor)),
    );
    // Лише на відкритті: комора міняється зі знімками, а вибір людини — ні.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const edit = (change: (list: CookedDraftLine[]) => CookedDraftLine[]) => {
    setTouched(true);
    setLines(change);
  };
  const patch = (id: string, change: Partial<CookedDraftLine>) =>
    edit((list) => list.map((line) => (line.id === id ? { ...line, ...change } : line)));

  /**
   * Нова міра — та сама кількість у ній: «2 шт» яєць стають «110 г», і
   * лишається вписати, скільки показали ваги. Не перевести — поле порожнє,
   * щоб «2 шт» не стали «2 г». Готове зважують на вагу — інша міра це знімає.
   */
  const setQuantity = (line: CookedDraftLine, next: { amount?: number; unit: Unit }) => {
    if (next.unit === line.unit) {
      patch(line.id, { amount: next.amount != null ? formatNumber(next.amount, 3) : "" });
      return;
    }
    haptic(8);
    const was = amountOf(line);
    const moved = was > 0 ? convertAmount(line.key, was, line.unit, next.unit) : null;
    patch(line.id, {
      unit: next.unit,
      amount: moved != null ? formatNumber(moved, unitDef(next.unit).decimals) : "",
      cooked: line.cooked && unitDef(next.unit).base === "g",
    });
  };

  const close = () => {
    if (touched) onDraft?.(lines);
    onClose();
  };

  /** Підказка біля кількості: на порцію — це вже не «у рецепті», а його частка. */
  const recipeWord = portion ? "за рецептом" : "у рецепті";
  const rowName = (row: PantryItem) => shortProductName(pantryDisplayName(row, products), row.key);
  const productOf = (line: CookedDraftLine) => {
    const row = line.rowId ? rows.get(line.rowId) : undefined;
    return row?.productId ? products[row.productId] : undefined;
  };

  const ready = lines.length > 0 && !lines.some(lineMissing);

  const save = async () => {
    if (!ready || busy) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setProblem(null);
    const res = await countComposition({ lines, recipe, rows, products, portion, signal: c.signal });
    if (!res) return;
    setBusy(false);
    if (!res.ok) {
      setProblem(res.problem);
      return;
    }
    haptic(16);
    onSave(res.result);
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
    edit((list) => [...list, ...added]);
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={close}
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
              ? "Впиши, скільки чого було в одній порції, — міру можна змінити: у рецепті штуки, а зважив у грамах. Познач, з якої пачки: ШІ порахує калорії з етикеток саме цих пачок."
              : "Виправ, скільки чого поклали, — міру можна змінити: у рецепті штуки, а зважив у грамах. Познач, з якої пачки брали: ШІ порахує калорії з етикеток саме цих пачок, а комора спише те, що справді пішло."}
          </p>

          {lines.map((line) => {
            const row = line.rowId ? rows.get(line.rowId) : undefined;
            const options = pantryCandidates(view, line.key, products);
            const weighable = weighsCooked(line.key);
            const raw = rawWord(line.key);
            const typed = amountOf(line);
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
                className={cn("rounded-2xl border p-3", lineMissing(line) ? "border-berry/50" : "border-line")}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{ing(line.key).emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{row ? rowName(row) : line.name}</span>
                    {hint && <span className="block truncate text-[11.5px] text-faint">{hint}</span>}
                  </span>
                  <button
                    aria-label={`Не клали: ${line.name}`}
                    onClick={() => {
                      haptic(8);
                      edit((list) => list.filter((l) => l.id !== line.id));
                    }}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-muted active:bg-surface-2"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Кількість і міра — тим самим контролом, що в рецепті й коморі. */}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <QuantityInput
                    amount={line.amount.trim() && Number.isFinite(typed) ? typed : undefined}
                    unit={line.unit}
                    defaultUnit={line.unit}
                    placeholder={line.cooked ? "300" : (line.qty ?? "0")}
                    label={line.name}
                    onChange={(next) => setQuantity(line, next)}
                  />
                  {weighable && line.unit !== "taste" && (
                    <div className="flex items-center gap-1.5 text-[12px]">
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
