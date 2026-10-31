"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LinkRow } from "@/components/pantry/PantryGroups";
import { Button, QuantityInput, Sheet } from "@/components/ui";
import { ing, isOwnKey, lineage } from "@/data/ingredients";
import { productHints } from "@/lib/product-hints";
import type { Product } from "@/lib/product-types";
import type { PantryItem } from "@/lib/types";
import { formatNumber, formatQuantity } from "@/lib/units";
import { cn, haptic } from "@/lib/utils";

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

  /*
   * Строк більше не закриває аркуш: унизу є «Готово», а поруч — кількість і
   * ціна, які часто правлять тим самим заходом.
   */
  const saveExpiry = (expiresAt: string | undefined) => {
    haptic(10);
    patch({ expiresAt });
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

  /* ── Дії з рядком: картка, «не той», тип, ще, прибрати ── */
  const links: Array<{ key: string; label: ReactNode; onClick: () => void; tone?: "danger"; icon?: ReactNode }> = [];
  if (row && def) {
    if (canUseProducts && row.productId && onOpenProduct) {
      const productId = row.productId;
      links.push({ key: "card", label: "Картка товару", onClick: () => onOpenProduct(productId) });
    }
    if (canUseProducts && row.productId && onWrongProduct) {
      links.push({ key: "wrong", label: "Не той товар?", onClick: () => onWrongProduct(row) });
    }
    if (onEditType && isOwnKey(row.key)) {
      links.push({ key: "type", label: `Редагувати тип «${def.label}»`, onClick: () => onEditType(row.key) });
    }
    if (onAddMore) {
      links.push({
        key: "more",
        label: "Додати ще",
        onClick: onAddMore,
        icon: <Plus size={15} strokeWidth={2.2} className="shrink-0 text-faint" />,
      });
    }
    links.push({
      key: "remove",
      label: "Прибрати з комори",
      tone: "danger",
      onClick: () => {
        removePantry(row.id);
        onRemoved?.(row);
        onClose();
      },
    });
  }

  return (
    <Sheet
      open={!!row}
      onClose={onClose}
      title={
        def ? (
          <span className="flex items-center gap-3">
            <span className="text-[26px] leading-none">{def.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{name}</span>
              {subtitle && (
                <span className="block truncate font-sans text-[12px] font-semibold text-faint">{subtitle}</span>
              )}
            </span>
          </span>
        ) : (
          ""
        )
      }
      footer={
        row ? (
          <Button full onClick={onClose}>
            Готово
          </Button>
        ) : undefined
      }
    >
      {row && def && (
        <div className="flex flex-col gap-3 pb-3">
          <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
            <Field label="Кількість">
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
                <ClearButton
                  label="Прибрати кількість"
                  onClick={() => patch({ amount: undefined, unit: undefined, qty: undefined })}
                />
              )}
            </Field>
            {row.qty && row.amount == null && (
              <p className="border-b border-line px-3.5 pb-2.5 text-[11.5px] text-faint">Було записано як «{row.qty}»</p>
            )}

            {/* Ціна має сенс лише разом із кількістю: без неї грам не порахувати. */}
            {row.amount != null && grams != null && grams > 0 && (
              <Field label="Ціна" note={`за ${formatQuantity(row.amount, row.unit)} — для вартості страв`}>
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
                  placeholder="0,00"
                  aria-label={`Ціна: ${name}`}
                  className="h-9 w-[84px] rounded-[8px] bg-surface-2 px-2.5 text-right text-[14px] font-bold"
                />
                <span className="text-[14px] font-bold text-muted">₴</span>
              </Field>
            )}

            {/*
              Обіцяємо лише те, що застосунок справді робить: продукт із близьким
              строком підіймається у «Варто вжити», а «Врятувати продукт» збирає
              з нього страви.
            */}
            <Field label="Їстівне до" divided={false}>
              <input
                type="date"
                value={row.expiresAt ?? ""}
                onChange={(e) => saveExpiry(e.target.value || undefined)}
                aria-label={`Їстівне до: ${name}`}
                className="h-9 min-w-0 rounded-[8px] bg-surface-2 px-2.5 text-[14px] font-bold"
              />
              {row.expiresAt && <ClearButton label="Прибрати строк" onClick={() => saveExpiry(undefined)} />}
            </Field>
            {/* Швидкі варіанти замість календаря: так зазвичай і думають про продукти. */}
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-3.5 pb-3">
              {EXPIRY_CHIPS.map((opt) => {
                const date = inDays(opt.days);
                const on = row.expiresAt === date;
                return (
                  <button
                    key={opt.days}
                    onClick={() => saveExpiry(date)}
                    aria-pressed={on}
                    className={cn(
                      "h-8 shrink-0 rounded-[8px] px-3 text-[12.5px] font-bold",
                      on ? "bg-brand/15 text-brand" : "bg-surface-2 text-muted",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Товар без картки: «Уточнити товар» ── */}
          {canUseProducts && !row.productId && !bareStaple(row) && (onChooseProduct || hints?.weighed) && (
            <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
              {onChooseProduct && (
                <LinkRow
                  tone="brand"
                  onClick={() => onChooseProduct(row)}
                  aside={
                    evidence && (
                      <span className="shrink-0 font-mono text-[11.5px] text-faint">
                        {row.receiptName ? "з чека" : "штрихкод"}
                      </span>
                    )
                  }
                >
                  <span className="inline-flex items-center gap-2.5">
                    {evidence && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
                    {evidence ? "Уточнити товар" : "Обрати товар"}
                  </span>
                </LinkRow>
              )}
              {hints?.weighed && (
                <LinkRow
                  divided={!!onChooseProduct}
                  // Сирий текст каси — лише «звідки». Без нього рядок
                  // показується типом, а картка йому не потрібна.
                  onClick={() => patch({ receiptName: undefined })}
                >
                  Назвати просто «{def.label}»
                </LinkRow>
              )}
              {/*
                Обіцянка «впізнаватимуть самі» чесна лише тоді, коли є що
                запамʼятати — назва з каси чи штрихкод. Рядок, доданий руками,
                нічого не навчить (B7), тож йому кажемо про інше.
              */}
              {onChooseProduct && (
                <p className="border-t border-line px-3.5 py-2.5 text-[11.5px] leading-snug text-faint">
                  {evidence
                    ? "Один раз — і наступні чеки та сканування впізнаватимуть його самі, у тебе й у всіх."
                    : "Щоб у коморі була точна назва, КБЖВ і упаковка."}
                  {row.receiptName && (
                    <span className="mt-1 block truncate font-mono text-[11px]">З чека: {row.receiptName}</span>
                  )}
                </p>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
            {links.map((link, i) => (
              <LinkRow key={link.key} divided={i > 0} tone={link.tone} icon={link.icon} onClick={link.onClick}>
                {link.label}
              </LinkRow>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Рядок картки аркуша: підпис ліворуч, поле праворуч. */
function Field({
  label,
  note,
  divided = true,
  children,
}: {
  label: string;
  note?: string;
  /** Лінія під рядком; ні — коли під ним продовження того самого поля. */
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-h-[50px] items-center gap-2 px-3.5 py-1.5", divided && "border-b border-line")}>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-muted">{label}</span>
        {note && <span className="block truncate text-[11px] text-faint">{note}</span>}
      </span>
      {children}
    </div>
  );
}

/** Маленький хрестик після поля: «прибрати кількість», «прибрати строк». */
function ClearButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={() => {
        haptic(8);
        onClick();
      }}
      aria-label={label}
      title={label}
      className="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center text-faint"
    >
      <X size={15} />
    </button>
  );
}
