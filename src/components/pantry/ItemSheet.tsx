"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, QuantityInput, Sheet } from "@/components/ui";
import { ing, isOwnKey, lineage } from "@/data/ingredients";
import { productHints } from "@/lib/product-hints";
import type { Product } from "@/lib/product-types";
import type { PantryItem } from "@/lib/types";
import { formatNumber, formatQuantity } from "@/lib/units";
import { haptic } from "@/lib/utils";

/*
 * Один рядок комори — одна покупка (F2, I4; «Обрати товар» — I5).
 *
 * Перенесено з src/app/pantry/page.tsx і переведено з ключа на id: у коморі
 * «по товару» дві пачки молока — два рядки, і правка строку однієї не має
 * зачепити другу. Тому всі зміни йдуть через updatePantry(id, patch), а не
 * через addPantry({...item, ...changes}): той складає покупки докупи (D6) і
 * з правкою строку зробив би другий рядок.
 */

/**
 * Голий базовий рядок (isBareStaple, D1): «Сіль» без кількості, назви й чека —
 * і саме базового типу. Такий живе галочкою в «Базових», і картка товару йому
 * ні до чого (B7). «Молоко», щойно обране зі списку, теж ще без кількості, але
 * це покупка в «У коморі» — йому «Обрати товар» потрібне одразу.
 */
function bareStaple(row: PantryItem): boolean {
  return !row.productId && row.amount == null && !row.label && !row.receiptName && !!ing(row.key).staple;
}

// Швидкі варіанти замість вибору дати: так зазвичай і думають про продукти.
const EXPIRY_CHIPS = [
  { label: "Завтра", days: 1 },
  { label: "3 дні", days: 3 },
  { label: "Тиждень", days: 7 },
  { label: "2 тижні", days: 14 },
  { label: "Місяць", days: 30 },
];

/** Дата через `days` днів за місцевим календарем, YYYY-MM-DD. */
export function inDays(days: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Та сама межа абсурду, що й у priceFromPurchase (cost.ts): понад 100 ₴ за грам — помилка вводу. */
const MAX_PRICE_PER_GRAM = 100;

export function ItemSheet({
  itemId,
  pantry,
  products,
  displayName,
  gramsOf,
  canUseProducts,
  updatePantry,
  removePantry,
  onClose,
  onAddMore,
  onRemoved,
  onChooseProduct,
  onWrongProduct,
  onOpenProduct,
  onEditType,
}: {
  /** id рядка; null — аркуш закрито. */
  itemId: string | null;
  pantry: PantryItem[];
  products: Record<string, Product>;
  /** pantryDisplayName(row, products). */
  displayName: (row: PantryItem) => string;
  /** rowGrams(row, products) — через грами рахуємо ціну покупки. */
  gramsOf: (row: PantryItem) => number | null;
  /** Без бекенду карток товарів немає — блок товару ховаємо цілком. */
  canUseProducts: boolean;
  updatePantry: (id: string, patch: Partial<PantryItem>) => void;
  removePantry: (id: string) => void;
  onClose: () => void;
  /** Показує «Додати ще» — щоб наповнювати комору не по одному аркушу. */
  onAddMore?: () => void;
  /** Після «Прибрати з комори»: сторінка показує «Прибрано «…»» з [Повернути]. */
  onRemoved?: (row: PantryItem) => void;
  /**
   * «Обрати товар» (B7): зі штрихкодом — шлях сканера з кроку 2, інакше
   * редактор із підказками й кандидатами. Сторінка ж потім кличе
   * updatePantry(id, {productId}) і вчить базу лише за наявності доказу.
   */
  onChooseProduct?: (row: PantryItem) => void;
  /** «Не той товар?» — вибір іншого, T1 для чека/штрихкоду цього рядка, B9 при конфлікті. */
  onWrongProduct?: (row: PantryItem) => void;
  /** «Картка товару ›». */
  onOpenProduct?: (productId: string) => void;
  /** Дописаний тип (own_*) правлять усі — F7. Немає — рядка «Тип: … · Редагувати» не буде. */
  onEditType?: (key: string) => void;
}) {
  const row = itemId ? pantry.find((p) => p.id === itemId) : undefined;
  const def = row ? ing(row.key) : null;
  const product = row?.productId ? products[row.productId] : undefined;
  const name = row ? displayName(row) : "";

  /*
   * Вагові рядки («ІмбирКг») картки не просять: імбир у кожному магазині той
   * самий, і бренду в нього немає. Їм пропонуємо просто назватися типом.
   */
  const hints = useMemo(
    () => (row?.receiptName ? productHints(row.receiptName, row.key) : null),
    [row?.receiptName, row?.key],
  );

  const patch = (changes: Partial<PantryItem>) => {
    if (!row) return;
    updatePantry(row.id, changes);
  };

  const saveExpiry = (expiresAt: string | undefined) => {
    haptic(10);
    patch({ expiresAt });
    onClose();
  };

  /* ── Ціна ─────────────────────────────────────────────────────────────
   * Людина памʼятає суму з чека, а не ціну грама. Тож питаємо «скільки
   * коштувало» за кількість вище і вже з неї рахуємо грам. Поле тримає сирий
   * текст і пише лише на виході з поля: інакше «4» з «45» встигало б
   * записатись у базу як ціна.
   */
  const grams = row ? gramsOf(row) : null;
  const paidNow =
    row?.pricePerGram != null && grams != null && grams > 0
      ? formatNumber(row.pricePerGram * grams, 2)
      : "";
  const [paid, setPaid] = useState(paidNow);
  const editingPaid = useRef(false);
  useEffect(() => {
    if (!editingPaid.current) setPaid(paidNow);
  }, [paidNow, itemId]);

  const commitPaid = () => {
    editingPaid.current = false;
    if (!row) return;
    const raw = paid.trim().replace(",", ".");
    if (raw === "") {
      if (row.pricePerGram != null) patch({ pricePerGram: undefined });
      return;
    }
    const value = Number(raw);
    const perGram = grams != null && grams > 0 && value > 0 ? value / grams : null;
    if (perGram != null && perGram < MAX_PRICE_PER_GRAM) patch({ pricePerGram: perGram });
    else setPaid(paidNow);
  };

  /* ── Підзаголовок: «Молоко безлактозне › Молоко · в упаковці 900 мл» ── */
  const chain = row ? lineage(row.key).map((k) => ing(k).label) : [];
  const pack =
    product?.packAmount != null && product.packUnit
      ? `в упаковці ${formatQuantity(product.packAmount, product.packUnit)}`
      : "";
  const subtitle = [chain.length > 1 || product || name !== def?.label ? chain.join(" › ") : "", pack]
    .filter(Boolean)
    .join(" · ");

  const evidence = !!(row?.receiptName || row?.barcode);

  return (
    <Sheet
      open={!!row}
      onClose={onClose}
      title={def ? `${def.emoji} ${name}` : ""}
      footer={
        row ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                removePantry(row.id);
                onRemoved?.(row);
                onClose();
              }}
            >
              Прибрати з комори
            </Button>
            <Button className="flex-1" onClick={onClose}>
              Готово
            </Button>
          </div>
        ) : undefined
      }
    >
      {row && def && (
        <div className="pb-4">
          {subtitle && <p className="-mt-1 mb-4 text-[12px] text-muted">{subtitle}</p>}
          {onEditType && isOwnKey(row.key) && (
            <p className="-mt-2 mb-4 text-[12px] text-muted">
              Тип «{def.label}» дописали люди ·{" "}
              <button onClick={() => onEditType(row.key)} className="font-bold text-brand">
                Редагувати тип
              </button>
            </p>
          )}

          <label className="block text-[12px] font-semibold text-muted">Скільки є вдома</label>
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <QuantityInput
              amount={row.amount}
              unit={row.unit}
              defaultUnit={product?.packUnit ?? def.defaultUnit}
              label={name}
              allowTaste={false}
              onChange={({ amount, unit }) => {
                // Старий вільний текст прибираємо: разом із числом він
                // конфліктував би за те, що саме показувати.
                patch({ amount, unit, qty: undefined });
              }}
            />
            {row.amount != null && (
              <button
                onClick={() => patch({ amount: undefined, unit: undefined, qty: undefined })}
                className="text-[12px] font-semibold text-faint"
              >
                Прибрати
              </button>
            )}
          </div>
          {row.qty && row.amount == null && (
            <p className="mt-1.5 text-[11.5px] text-faint">Було записано як «{row.qty}»</p>
          )}

          {/* Ціна має сенс лише разом із кількістю: без неї грам не порахувати. */}
          {row.amount != null && grams != null && grams > 0 && (
            <>
              <label className="mt-4 block text-[12px] font-semibold text-muted">
                Скільки коштувало
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  value={paid}
                  onFocus={() => {
                    editingPaid.current = true;
                  }}
                  onChange={(e) => setPaid(e.target.value.replace(/[^\d.,]/g, ""))}
                  onBlur={commitPaid}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  inputMode="decimal"
                  placeholder="45,90"
                  aria-label={`Ціна: ${name}`}
                  className="h-9 w-[90px] rounded-xl bg-surface-2 px-2 text-center text-[13px]"
                />
                <span className="text-[13px] font-semibold text-muted">₴</span>
                <span className="text-[11.5px] leading-snug text-faint">
                  за {formatQuantity(row.amount, row.unit)} — для вартості страв
                </span>
              </div>
            </>
          )}

          <div className="mt-5 h-px bg-line" />

          {/*
            Обіцяємо лише те, що застосунок справді робить: продукт із близьким
            строком підіймається вгору комори, а «Врятувати продукт» збирає з
            нього страви.
          */}
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            До якого числа це ще їстівне? Продукт із близьким строком підніметься вгору
            комори, а «Врятувати продукт» покаже, що з нього приготувати.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {EXPIRY_CHIPS.map((opt) => (
              <Chip key={opt.days} onClick={() => saveExpiry(inDays(opt.days))}>
                {opt.label}
              </Chip>
            ))}
          </div>

          <label className="mt-4 block text-[12px] text-muted">Або точна дата</label>
          <input
            type="date"
            value={row.expiresAt ?? ""}
            onChange={(e) => saveExpiry(e.target.value || undefined)}
            className="mt-1.5 h-11 w-full rounded-2xl border border-line bg-surface-2 px-3.5 text-[15px]"
          />

          {row.expiresAt && (
            <Button full variant="secondary" className="mt-3" onClick={() => saveExpiry(undefined)}>
              Прибрати строк
            </Button>
          )}

          {/* ── Товар ── */}
          {canUseProducts && (row.productId ? (
            <>
              <div className="mt-5 h-px bg-line" />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                {onOpenProduct && (
                  <button
                    onClick={() => {
                      haptic(8);
                      onOpenProduct(row.productId!);
                    }}
                    className="inline-flex items-center gap-1 text-[13px] font-bold text-brand"
                  >
                    Картка товару <ChevronRight size={15} />
                  </button>
                )}
                {onWrongProduct && (
                  <Button size="sm" variant="ghost" onClick={() => onWrongProduct(row)}>
                    Не той товар?
                  </Button>
                )}
              </div>
            </>
          ) : !bareStaple(row) && (onChooseProduct || hints?.weighed) ? (
            <>
              <div className="mt-5 h-px bg-line" />
              <div className="mt-4 rounded-2xl border border-line bg-surface p-3.5">
                {/*
                  Обіцянка «впізнаватимуть самі» чесна лише тоді, коли є що
                  запамʼятати — назва з каси чи штрихкод. Рядок, доданий руками,
                  нічого не навчить (B7), тож йому кажемо про інше: точна назва,
                  КБЖВ і упаковка.
                */}
                <p className="text-[12.5px] leading-snug text-muted">
                  {evidence
                    ? "Один раз — і наступні чеки та сканування впізнаватимуть його самі, у тебе й у всіх."
                    : "Щоб у коморі була точна назва, КБЖВ і упаковка"}
                </p>
                {row.receiptName ? (
                  <p className="mt-1.5 truncate font-mono text-[11px] text-faint">
                    З чека: {row.receiptName}
                  </p>
                ) : row.barcode ? (
                  <p className="mt-1.5 truncate font-mono text-[11px] text-faint">
                    Штрихкод {row.barcode}
                  </p>
                ) : null}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {onChooseProduct && (
                    <Button size="sm" onClick={() => onChooseProduct(row)}>
                      Обрати товар
                    </Button>
                  )}
                  {hints?.weighed && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        // Сирий текст каси — лише «звідки». Без нього рядок
                        // показується типом, а картка йому не потрібна.
                        patch({ receiptName: undefined });
                      }}
                    >
                      Назвати просто «{def.label}»
                    </Button>
                  )}
                </div>
              </div>
            </>
          ) : null)}

          {onAddMore && (
            <Button full variant="ghost" className="mt-4" onClick={onAddMore}>
              Додати ще
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
