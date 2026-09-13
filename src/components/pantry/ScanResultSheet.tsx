"use client";

import { useState } from "react";
import { Button, Chip, QuantityInput, Sheet } from "@/components/ui";
import { ing } from "@/data/ingredients";
import type { Product, ProductDraft } from "@/lib/product-types";
import type { PantryItem, Unit } from "@/lib/types";
import { formatQuantity, sumQuantities, unitDef } from "@/lib/units";
import { haptic, newId } from "@/lib/utils";
import { inDays } from "./ItemSheet";

/*
 * Результат сканування штрихкоду (F5; I3 — без дельти, I4 — зі складанням).
 *
 * Знайомий товар додається за два дотики: скан → [Готово]. Усе інше тут —
 * про те, щоб цей швидкий шлях нічого не ламав: друга пачка того самого
 * молока ляже в той самий рядок (D6), але поле кількості правитиме лише її, а
 * «Скасувати» чи «Не той товар?» повернуть рядок рівно таким, яким він був до
 * скану. Перша пачка не губиться ніколи.
 */

/** Товар впізнано й уже покладено в комору — те, що повернув stackIntoPantry. */
export interface ScanProductOutcome {
  kind: "product";
  /** Новий на кожен скан: від нього аркуш скидає свій стан. */
  scanId: string;
  code: string;
  product: Product;
  /** Рядок, у який ліг скан (новий або той, до якого доклали). */
  rowId: string;
  /** Рядок до складання; null — скан став новим рядком. */
  before: PantryItem | null;
  /** Скільки приніс сам скан: упаковка товару. */
  added: { amount?: number; unit?: Unit };
}

export type ScanOutcome =
  | ScanProductOutcome
  /** Штрихкод веде лише до типу: «Знаємо, що це «Згущене молоко», але ще не знаємо назви». */
  | { kind: "type"; scanId: string; code: string; ean: string; typeKey: string; draft: ProductDraft }
  /** Знайшли в Open Food Facts — нічого не записано, доки людина не збереже картку. */
  | { kind: "off"; scanId: string; code: string; ean: string; draft: ProductDraft }
  /** Ніхто не знає; ean null — код не EAN (Code-128 тощо), лише «Лише тип». */
  | { kind: "unknown"; scanId: string; code: string; ean: string | null; draft: ProductDraft }
  /**
   * База не відповіла (немає звʼязку, застарілий застосунок): не знаємо, чи код
   * знайомий, — тож і не кажемо «ніхто не знає». Картку заповнити не можна,
   * лише покласти тип зі штрихкодом (B1.8).
   */
  | { kind: "offline"; scanId: string; code: string; ean: string }
  /** Локальний режим (без бекенду): карток немає, лише тип із назвою з OFF. */
  | { kind: "local"; scanId: string; code: string; name?: string; image?: string };

/**
 * Патч, що повертає рядок до стану `before`. Ключі перелічено явно: у
 * `{...before}` не було б полів, яких у before не було, — і ціна чи строк,
 * що їх принесло складання, пережили б відкат.
 */
export function restorePatch(before: PantryItem): Partial<PantryItem> {
  return {
    key: before.key,
    productId: before.productId,
    label: before.label,
    receiptName: before.receiptName,
    amount: before.amount,
    unit: before.unit,
    qty: before.qty,
    expiresAt: before.expiresAt,
    barcode: before.barcode,
    pricePerGram: before.pricePerGram,
  };
}

/** Кількість, округлена до точності одиниці: 1,8000000002 л → 1,8 л. */
function tidy(amount: number, unit: Unit): number {
  return Number(amount.toFixed(unitDef(unit).decimals));
}

/**
 * Рядок після правки кількості скану: разом із попереднім, якщо зводиться.
 *
 * null — не зводиться (штуки й грами): тоді скан мусить стати окремим
 * рядком, бо вигадана сума гірша за два чесні рядки.
 */
export function stackedQuantity(
  before: PantryItem | null,
  entered: { amount?: number; unit?: Unit },
): { amount?: number; unit?: Unit } | null {
  if (!before) return entered;
  if (entered.amount == null || !entered.unit) {
    // Поле стерли — цей скан нічого не додає, лишається те, що було.
    return { amount: before.amount, unit: before.unit };
  }
  if (before.amount == null || !before.unit) return entered;
  const summed = sumQuantities([
    { amount: before.amount, unit: before.unit },
    { amount: entered.amount, unit: entered.unit },
  ]);
  const [only] = summed;
  return summed.length === 1 && only.amount != null
    ? { amount: tidy(only.amount, only.unit), unit: only.unit }
    : null;
}

export function ScanResultSheet({
  outcome,
  pantry,
  onClose,
  onScanMore,
  addPantry,
  updatePantry,
  removePantry,
  onWrongProduct,
  onFillCard,
  onTypeOnly,
  onOpenProduct,
}: {
  outcome: ScanOutcome | null;
  pantry: PantryItem[];
  onClose: () => void;
  onScanMore: () => void;
  /**
   * Покупка через addPantry: у який рядок вона справді лягла і яким він був до
   * того. Відокремлена пачка могла скластися з третьою пачкою цього дня (D6) —
   * тоді before не null, і відкочувати треба той рядок, а не прибирати його.
   */
  addPantry: (item: PantryItem) => { rowId: string; before: PantryItem | null };
  updatePantry: (id: string, patch: Partial<PantryItem>) => void;
  removePantry: (id: string) => void;
  /** Уже після відкату: сторінка відкриває вибір іншого товару для цього коду. */
  onWrongProduct: (outcome: ScanProductOutcome) => void;
  /** «Заповнити картку» → ProductEditorSheet з outcome.draft. */
  onFillCard: (outcome: Extract<ScanOutcome, { draft: ProductDraft }>) => void;
  /** «Лише тип» (T4) / вибір типу в локальному режимі. */
  onTypeOnly: (outcome: Exclude<ScanOutcome, ScanProductOutcome>) => void;
  onOpenProduct?: (productId: string) => void;
}) {
  const scanMore = () => {
    onClose();
    onScanMore();
  };

  return (
    <Sheet open={!!outcome} onClose={onClose} title="Результат сканування">
      {outcome?.kind === "product" ? (
        <KnownProduct
          key={outcome.scanId}
          outcome={outcome}
          pantry={pantry}
          addPantry={addPantry}
          updatePantry={updatePantry}
          removePantry={removePantry}
          onClose={onClose}
          onScanMore={scanMore}
          onWrongProduct={onWrongProduct}
          onOpenProduct={onOpenProduct}
        />
      ) : outcome ? (
        <div className="pb-4">
          <ScanHeader
            image={"draft" in outcome ? outcome.draft.image : outcome.kind === "local" ? outcome.image : undefined}
            emoji={outcome.kind === "type" ? ing(outcome.typeKey).emoji : "📦"}
            title={
              outcome.kind === "local"
                ? outcome.name ?? "Невідомий товар"
                : outcome.kind === "offline"
                  ? "Штрихкод прочитано"
                  : outcome.draft.name || (outcome.kind === "type" ? ing(outcome.typeKey).label : "Невідомий товар")
            }
            subtitle={"draft" in outcome ? outcome.draft.brand : undefined}
            code={outcome.code}
          />

          <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-3.5">
            <p className="text-[13px] leading-snug">
              {outcome.kind === "type"
                ? `Знаємо, що це «${ing(outcome.typeKey).label}», але ще не знаємо назви. Заповни картку — і наступного разу він додасться сам.`
                : outcome.kind === "off"
                  ? "Знайшли в Open Food Facts. Перевір назву й тип — картка стане спільною для всіх."
                  : outcome.kind === "offline"
                    ? "Без звʼязку не видно, чи цей товар уже знайомий. Поки додай його як тип — штрихкод збережеться, і товар можна буде уточнити пізніше."
                    : outcome.kind === "local"
                      ? outcome.name
                        ? `Знайшли: «${outcome.name}». Обери, що це за продукт.`
                        : "Цього штрихкоду не знайшли. Обери, що це за продукт."
                      : !outcome.ean
                        ? // Ваговий цінник магазину чи Code-128: такий код ні вчити, ні впізнати — обіцяти «додасться сам» не можна.
                          "Це внутрішній код магазину, а не штрихкод товару — запамʼятати його не вийде. Заповни картку або додай як тип."
                        : "Цього штрихкоду ще ніхто не знає. Заповни картку один раз — наступного разу він додасться сам, у тебе й у всіх."}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {"draft" in outcome && (
                <Button size="sm" onClick={() => onFillCard(outcome)}>
                  Заповнити картку
                </Button>
              )}
              <Button
                size="sm"
                variant={"draft" in outcome ? "secondary" : "primary"}
                onClick={() => onTypeOnly(outcome)}
              >
                {!("draft" in outcome)
                  ? "Обрати продукт"
                  : outcome.kind === "type"
                    ? `Лише «${ing(outcome.typeKey).label}»`
                    : "Лише тип"}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={scanMore}>
              Сканувати ще
            </Button>
            <Button className="flex-1" onClick={onClose}>
              Готово
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

function ScanHeader({
  image,
  emoji,
  title,
  subtitle,
  code,
}: {
  image?: string;
  emoji: string;
  title: string;
  subtitle?: string;
  code: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-16 w-16 rounded-2xl bg-surface-2 object-contain" />
      ) : (
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-surface-2 text-2xl">
          {emoji}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold leading-snug">{title}</p>
        {subtitle && <p className="truncate text-[12px] text-muted">{subtitle}</p>}
        <p className="mt-0.5 font-mono text-[11px] text-faint">{code}</p>
      </div>
    </div>
  );
}

/**
 * Знайомий товар, уже в коморі.
 *
 * Стан живе тут, а не на сторінці, і скидається з кожним новим сканом
 * (key = scanId): `split` — куди лягла відокремлена пачка, коли введене не
 * склалося з попередньою: у свій новий рядок (before = null) або в іншу пачку
 * цього дня (before — якою та була). Чужу пачку відкат лише повертає до before
 * і ніколи не прибирає й не переписує її кількість введеним.
 */
function KnownProduct({
  outcome,
  pantry,
  addPantry,
  updatePantry,
  removePantry,
  onClose,
  onScanMore,
  onWrongProduct,
  onOpenProduct,
}: {
  outcome: ScanProductOutcome;
  pantry: PantryItem[];
  addPantry: (item: PantryItem) => { rowId: string; before: PantryItem | null };
  updatePantry: (id: string, patch: Partial<PantryItem>) => void;
  removePantry: (id: string) => void;
  onClose: () => void;
  onScanMore: () => void;
  onWrongProduct: (outcome: ScanProductOutcome) => void;
  onOpenProduct?: (productId: string) => void;
}) {
  const { product, rowId, before } = outcome;
  const def = ing(product.typeKey);
  const row = pantry.find((p) => p.id === rowId);
  const [entered, setEntered] = useState(outcome.added);
  const [split, setSplit] = useState<{ rowId: string; before: PantryItem | null } | null>(null);
  const [pickDate, setPickDate] = useState(false);

  const pack =
    product.packAmount != null && product.packUnit ? formatQuantity(product.packAmount, product.packUnit) : "";

  /** Окремий рядок для цього скану — коли з попередньою пачкою не складається. */
  const splitRow = (quantity: { amount?: number; unit?: Unit }, expiresAt?: string): PantryItem => ({
    id: newId(),
    key: row?.key ?? product.typeKey,
    productId: product.id,
    barcode: row?.barcode ?? outcome.code,
    addedAt: new Date().toISOString(),
    amount: quantity.amount,
    unit: quantity.unit,
    pricePerGram: row?.pricePerGram,
    expiresAt,
  });

  /** Прибрати відокремлену пачку: свій рядок — геть, чужу пачку — назад до того, якою була. */
  const undoSplit = (s: { rowId: string; before: PantryItem | null }) => {
    if (s.before) updatePantry(s.rowId, restorePatch(s.before));
    else removePantry(s.rowId);
  };

  /** Поле кількості міняє лише цю пачку: рядок = попереднє + введене (F5). */
  const applyQuantity = (next: { amount?: number; unit: Unit }) => {
    setEntered(next);
    if (!before) {
      updatePantry(rowId, { amount: next.amount, unit: next.unit, qty: undefined });
      return;
    }
    const total = stackedQuantity(before, next);
    if (total) {
      if (split) {
        undoSplit(split);
        setSplit(null);
      }
      updatePantry(rowId, { amount: total.amount, unit: total.unit, qty: undefined });
      return;
    }
    // Не складається: попередня пачка повертається як була, скан — окремо.
    updatePantry(rowId, restorePatch(before));
    // Свій окремий рядок просто правимо; якщо ж пачка лягла в чужу, відкочуємо
    // ту й кладемо заново — addPantry сам вирішить, куди тепер (D6).
    if (split && !split.before) {
      updatePantry(split.rowId, { amount: next.amount, unit: next.unit });
      return;
    }
    if (split) undoSplit(split);
    setSplit(addPantry(splitRow(next)));
  };

  /**
   * Строк придатності. Пачка з іншим строком — уже інша покупка (D6): якщо
   * скан доклали до пачки без строку чи з іншим, відокремлюємо його, інакше
   * «до 20.09» мовчки переписав би строк першої пачки.
   */
  const applyExpiry = (expiresAt: string) => {
    haptic(10);
    if (split && !split.before) updatePantry(split.rowId, { expiresAt });
    else if (split) {
      // Пачка лежить у чужій — строк тієї не чіпаємо: відкочуємо й кладемо окремо зі строком.
      undoSplit(split);
      addPantry(splitRow(entered, expiresAt));
    } else if (before && before.expiresAt !== expiresAt) {
      updatePantry(rowId, restorePatch(before));
      addPantry(splitRow(entered, expiresAt));
    } else updatePantry(rowId, { expiresAt });
    onClose();
  };

  /** «Скасувати» і «Не той товар?»: рядок — рівно таким, яким був до скану. */
  const undo = () => {
    if (split) undoSplit(split);
    if (before) updatePantry(rowId, restorePatch(before));
    else removePantry(rowId);
  };

  const together = before && !split && row ? formatQuantity(row.amount, row.unit) : "";

  return (
    <div className="pb-4">
      <ScanHeader
        image={product.image}
        emoji={def.emoji}
        title={`${product.name}${pack ? ` · ${pack}` : ""}`}
        subtitle={product.brand}
        code={outcome.code}
      />

      <div className="mt-4 rounded-2xl border border-mint/30 bg-mint/10 p-3.5">
        <p className="text-[13px] font-bold text-mint">✓ У коморі: {product.name}</p>
        {together && (
          <p className="mt-1 text-[12.5px] font-semibold">Тепер разом: {together}</p>
        )}
        {split && (
          <p className="mt-1 text-[11.5px] text-muted">
            Не складається з попередньою пачкою — лежить окремим рядком.
          </p>
        )}

        <div className="mt-3 flex items-center gap-2.5">
          <span className="text-[12px] font-semibold text-muted">
            {before ? "Ця пачка:" : "Скільки:"}
          </span>
          <QuantityInput
            amount={entered.amount}
            unit={entered.unit}
            defaultUnit={product.packUnit ?? def.defaultUnit}
            label={product.name}
            allowTaste={false}
            onChange={applyQuantity}
          />
        </div>

        <p className="mt-4 text-[12px] font-semibold text-muted">До якого числа?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { label: "Завтра", days: 1 },
            { label: "3 дні", days: 3 },
            { label: "Тиждень", days: 7 },
            { label: "2 тижні", days: 14 },
          ].map((opt) => (
            <Chip key={opt.days} size="sm" onClick={() => applyExpiry(inDays(opt.days))}>
              {opt.label}
            </Chip>
          ))}
          <Chip size="sm" active={pickDate} onClick={() => setPickDate((v) => !v)}>
            Дата
          </Chip>
        </div>
        {pickDate && (
          <input
            type="date"
            autoFocus
            onChange={(e) => e.target.value && applyExpiry(e.target.value)}
            className="mt-2 h-11 w-full rounded-2xl border border-line bg-surface-2 px-3.5 text-[15px]"
          />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              undo();
              onWrongProduct(outcome);
            }}
          >
            Не той товар?
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              undo();
              onClose();
            }}
          >
            Скасувати
          </Button>
          {onOpenProduct && (
            <Button size="sm" variant="ghost" onClick={() => onOpenProduct(product.id)}>
              Картка товару
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onScanMore}>
          Сканувати ще
        </Button>
        <Button className="flex-1" onClick={onClose}>
          Готово
        </Button>
      </div>
    </div>
  );
}
