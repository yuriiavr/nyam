"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ProductEditorSheet } from "@/components/ProductEditorSheet";
import { productHints } from "@/lib/product-hints";
import type { Product, ProductDraft, ProductHints } from "@/lib/product-types";
import type { PantryItem } from "@/lib/types";
import { plural } from "@/lib/utils";

/*
 * «Назвати» після імпорту чека (F4 → I5): рядки без картки товару по черзі,
 * «1 з 3», редактор уже заповнений, [Пропустити] [Зберегти й далі].
 *
 * Редактор — ProductEditorSheet (він сам ловить `duplicate` і «Це він?»):
 * тут лише черга, лічильник і те, що підставити в картку. Звʼязати рядок із
 * товаром і навчити базу (T1) — справа сторінки в onLinked, тієї самої, що й
 * для «Обрати товар» в ItemSheet: двох різних шляхів навчання бути не мусить.
 */

/** «Додано 14 · 3 без картки товару» — текст тосту з [Назвати]. */
export function namingOfferText(added: number, unnamed: number): string {
  const head = `Додано ${added} ${plural(added, "позицію", "позиції", "позицій")}`;
  return unnamed > 0 ? `${head} · ${unnamed} без картки товару` : head;
}

/**
 * Картка з підказок сирої назви (C).
 *
 * Назва-здогадка позначається як `guessed`: «Молоко безлактозне Галичина» з
 * «МолокГалБезл900» — це наш висновок, а не прочитане, і людина має бачити,
 * що саме їй треба перевірити. Упаковку ваговим не підставляємо: у «ІмбирКг»
 * її немає за визначенням.
 */
export function draftFromHints(
  hints: ProductHints | null | undefined,
  base: { typeKey?: string; name?: string; provenance: ProductDraft["provenance"]; source?: ProductDraft["source"] },
): ProductDraft {
  const name = hints?.suggestedName ?? base.name ?? "";
  const guessed: NonNullable<ProductDraft["guessed"]> = [...(hints?.guessed ?? [])];
  if (hints?.suggestedName && !guessed.includes("name")) guessed.push("name");
  return {
    typeKey: hints?.typeKey ?? base.typeKey ?? "",
    name,
    brand: hints?.brand,
    fatPct: hints?.fatPct,
    packAmount: hints?.weighed ? undefined : hints?.packAmount,
    packUnit: hints?.weighed ? undefined : hints?.packUnit,
    source: base.source,
    guessed,
    provenance: base.provenance,
  };
}

/** Підказки для рядка комори: з вільної назви чи назви з каси (B7: label ?? receiptName). */
function rowHints(row: PantryItem, extraBrands?: readonly string[]): ProductHints | null {
  const raw = row.label ?? row.receiptName;
  return raw ? productHints(raw, row.key, extraBrands) : null;
}

/**
 * Картка для «Обрати товар» / «Назвати» з рядка комори (B7).
 *
 * Звідки: назва з каси → «З чека: …»; штрихкод → «Штрихкод …» (код тут ніхто
 * не перевіряв, тож «ніхто не знає» було б неправдою); інакше вручну.
 */
export function namingDraft(row: PantryItem, extraBrands?: readonly string[]): ProductDraft {
  return draftFromHints(rowHints(row, extraBrands), {
    typeKey: row.key,
    // Не назва типу: картка «Молоко» без бренду й упаковки — сміття, яке потім
    // зливалося б із кожним молоком. Хай краще редактор попросить людську назву.
    name: row.label ?? "",
    source: row.receiptName ? "receipt" : undefined,
    provenance: row.receiptName
      ? { from: "receipt", raw: row.receiptName }
      : row.barcode
        ? { from: "scan", ean: row.barcode }
        : { from: "manual" },
  });
}

/**
 * Чи просити назвати цей рядок: без картки, не голий базовий і не ваговий.
 * Саме їх рахує «3 без картки товару».
 */
export function needsNaming(row: PantryItem, extraBrands?: readonly string[]): boolean {
  if (row.productId) return false;
  if (row.amount == null && !row.label && !row.receiptName) return false;
  return !rowHints(row, extraBrands)?.weighed;
}

export function NamingSequence({
  open,
  rows,
  pantry,
  extraBrands,
  onLinked,
  onDone,
}: {
  open: boolean;
  /** Черга на момент відкриття; далі аркуш сам пропускає зниклі й уже названі. */
  rows: PantryItem[];
  /** Жива комора: рядок могли прибрати чи назвати з іншого пристрою. */
  pantry: PantryItem[];
  /** Бренди з кешу товарів — productHints упізнає і їх. */
  extraBrands?: readonly string[];
  /**
   * Звʼязати рядок із товаром: updatePantry(row.id, {productId}) одразу і T1 для
   * receiptName/barcode цього рядка у фоні, з B9 на конфлікт. Черга не чекає
   * навчання: про його невдачу каже сама сторінка.
   */
  onLinked: (row: PantryItem, product: Product) => Promise<void> | void;
  /** Черга скінчилась або її закрили: скільки назвали з усіх. */
  onDone: (summary: { named: number; total: number }) => void;
}) {
  const [queue, setQueue] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [named, setNamed] = useState(0);
  /*
   * Редактор після збереження (і після «Так, це він») сам кличе onClose — тієї
   * ж миті, синхронно за onSaved. Для черги це не «закрити», а «далі»: без цього
   * прапорця «Зберегти й далі» закривало б усю чергу вже на першому рядку.
   * Справжнє закриття (свайп, хрестик) приходить без onSaved перед ним.
   */
  const advancing = useRef(false);

  // Чергу знімаємо при відкритті: рядки, що зʼявились потім, — уже інша розмова.
  useEffect(() => {
    if (!open) return;
    setQueue(rows.map((r) => r.id));
    setIndex(0);
    setNamed(0);
    advancing.current = false;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Поточний крок — перший із index, який ще є в коморі й досі без картки.
   * Не зсуваємо index при кожній зміні комори: тоді збережений рядок, що
   * щойно отримав productId, «перестрибував» би через наступний.
   */
  const byId = useMemo(() => new Map(pantry.map((p) => [p.id, p])), [pantry]);
  let at = index;
  while (at < queue.length && !(byId.get(queue[at]) && !byId.get(queue[at])!.productId)) at++;
  const row = at < queue.length ? byId.get(queue[at]) : undefined;

  const hints = useMemo(
    () => (row ? rowHints(row, extraBrands) : null),
    [row?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const draft = useMemo(
    () => (row ? namingDraft(row, extraBrands) : null),
    // Картку будуємо раз на рядок: інакше кожна правка комори скидала б введене.
    [row?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const finish = (namedNow: number) => {
    onDone({ named: namedNow, total: queue.length });
    setQueue([]);
  };

  // Усе в черзі зникло чи назване деінде — закриваємося самі.
  useEffect(() => {
    if (open && queue.length > 0 && !row) finish(named);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !row || !draft) return null;

  const last = !queue.slice(at + 1).some((id) => byId.get(id) && !byId.get(id)!.productId);

  return (
    <ProductEditorSheet
      key={row.id}
      open
      draft={draft}
      hints={hints}
      title={`Назвати товар · ${at + 1} з ${queue.length}`}
      saveLabel={last ? "Зберегти" : "Зберегти й далі"}
      skipLabel="Пропустити"
      onSaved={(product) => {
        // onClose прийде синхронно слідом — до наступного такту це «далі», а не «закрити».
        advancing.current = true;
        setTimeout(() => {
          advancing.current = false;
        }, 0);
        /*
         * Звʼязок рядка з карткою стор робить одразу (updatePantry), а навчання
         * бази — у фоні зі своїми тостами й питаннями про конфлікт. Чекати його
         * тут означало б тримати людину на вже названому рядку секундами.
         */
        void Promise.resolve(onLinked(row, product)).catch(() => {});
        const namedNow = named + 1;
        setNamed(namedNow);
        if (last) finish(namedNow);
        else setIndex(at + 1);
      }}
      onSkip={() => {
        if (last) finish(named);
        else setIndex(at + 1);
      }}
      onClose={() => {
        if (advancing.current) return;
        finish(named);
      }}
    />
  );
}
