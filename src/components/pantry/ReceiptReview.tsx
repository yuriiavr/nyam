"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button, QuantityInput, Sheet } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { priceFromPurchase } from "@/lib/cost";
import { receiptDisplayName } from "@/lib/product-hints";
import type { LineChoice, Product, ProductDraft, ReceiptDraftProductFields } from "@/lib/product-types";
import { lineQuantity, type Receipt, type ReceiptDraft, type ReceiptLine } from "@/lib/receipt";
import type { IngredientDef, PantryItem, Unit } from "@/lib/types";
import { formatNumber, sumQuantities, unitDef } from "@/lib/units";
import { cn, haptic, newId, plural } from "@/lib/utils";
import { draftFromHints } from "./NamingSequence";

/*
 * Підтвердження чека (F4): витягнуто з src/app/pantry/page.tsx разом із
 * ReceiptRow і дочитуванням, і доповнено станами впізнавання з I5.
 *
 * Що збережено з попередніх виправлень і ламати не можна:
 * - нове читання чи «Скасувати» обривають попереднє (AbortController): стара
 *   відповідь, що приїхала слідом, не відкриє список чужого чека;
 * - список не чекає найповільнішого запиту — лише ENRICH_BUDGET_MS, а те, що
 *   прийшло пізніше, дописується у вже відкритий список;
 * - пізня відповідь не чіпає рядок, який людина вже вирішила сама, не
 *   переписує введену кількість і не ставить знову зняту галочку.
 *
 * Мережу (resolve_identifiers, OFF, similar_receipt_names) сюди не
 * імпортуємо: сторінка передає «дочитувачів» (Enricher) — resolveReceipt у
 * другій хвилі. Так цей файл лишається про людину й список, а не про RPC.
 */

/** Рядок чека в списку: чернетка з receipt.ts + що сказала база + що зробила людина. */
export type ReviewDraft = ReceiptDraft &
  ReceiptDraftProductFields & {
    /** Людина сама правила кількість — пізні відповіді її не переписують. */
    touched?: true;
    /** Товар, обраний чи підтверджений людиною: щоб показати назву, не чекаючи кешу стора. */
    product?: Product;
  };

export interface ReviewReceipt {
  store?: string;
  source: "qr" | "photo";
  drafts: ReviewDraft[];
}

/** Скільки список чека чекає на дочитування, перш ніж показатись. */
export const ENRICH_BUDGET_MS = 2500;

/** Стеля пошуків в Open Food Facts на один чек (B2.4a): решта чекає на людину. */
export const MAX_OFF_LOOKUPS = 8;

/**
 * Дочитувач: шле уточнення рядків через `emit`, скільки завгодно разів.
 * Має поважати `signal` — людина могла вже скасувати.
 */
export type Enricher = (
  emit: (id: string, patch: Partial<ReviewDraft>) => void,
  signal: AbortSignal,
) => Promise<void>;

/**
 * Запускає дочитувачів і чекає їх не довше за `budgetMs`.
 *
 * Прапорець `shown` перемикається в тому самому синхронному кроці, де
 * викликається `onReady`, тож кожне уточнення потрапляє рівно в одне місце:
 * або в перший показ, або в `onLate`. Загубитись між ними (як тоді, коли
 * показ чекав на await) чи прийти двічі йому ніде.
 */
export async function enrichWithinBudget(
  drafts: ReviewDraft[],
  enrichers: readonly Enricher[],
  signal: AbortSignal,
  onReady: (drafts: ReviewDraft[]) => void,
  onLate: (id: string, patch: Partial<ReviewDraft>) => void,
  budgetMs = ENRICH_BUDGET_MS,
): Promise<void> {
  const found = new Map<string, Partial<ReviewDraft>>();
  let shown = false;
  const emit = (id: string, patch: Partial<ReviewDraft>) => {
    if (signal.aborted) return;
    if (shown) onLate(id, patch);
    else found.set(id, { ...found.get(id), ...patch });
  };

  if (enrichers.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(enrichers.map((run) => run(emit, signal).catch(() => undefined))),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
    clearTimeout(timer);
  }

  const ready = drafts.map((d) => {
    const patch = found.get(d.id);
    return patch ? mergeLate(d, patch) : d;
  });
  shown = true;
  if (!signal.aborted) onReady(ready);
}

/* ── Правила рядка ────────────────────────────────────────────────────── */

/** Міри каси, у яких товар важать (кг, л): тоді кількість — з каси, а не з упаковки. */
const WEIGHED_MEASURES = new Set(["кг", "г", "гр", "грам", "л", "мл"]);

function tillWeighed(line: ReceiptLine): boolean {
  const measure = line.measure?.toLowerCase().replace(/\./g, "").trim();
  return !!measure && WEIGHED_MEASURES.has(measure);
}

function tidy(amount: number, unit: Unit): { amount: number; unit: Unit } {
  const [summed] = sumQuantities([{ amount, unit }]);
  if (!summed || summed.amount == null) return { amount, unit };
  return { amount: Number(summed.amount.toFixed(unitDef(summed.unit).decimals)), unit: summed.unit };
}

/**
 * Скільки принесли за цим рядком (B2.5).
 *
 * Зважене касою — як каса сказала. З товаром — упаковка × кількість: «2 шт»
 * молока з карткою на 900 мл — це 1,8 л. Далі упаковка з підказок назви, а
 * вже потім те, що вміє lineQuantity.
 */
export function receiptLineQuantity(
  line: ReceiptLine,
  product?: Product,
  hints?: ReviewDraft["hints"],
): { amount: number; unit: Unit } | null {
  if (tillWeighed(line) || hints?.weighed) return lineQuantity(line);
  const count = line.qty > 0 ? line.qty : 1;
  if (product?.packAmount != null && product.packUnit) return tidy(product.packAmount * count, product.packUnit);
  if (hints?.packAmount != null && hints.packUnit) return tidy(hints.packAmount * count, hints.packUnit);
  return lineQuantity(line);
}

/** Товар рядка: вибір людини важить більше за відповідь бази, «лише тип» — скасовує її. */
export function lineProductId(d: ReviewDraft): string | undefined {
  const choice = d.choice;
  if (choice?.kind === "confirmed" || choice?.kind === "picked-product") return choice.productId;
  if (choice?.kind === "picked-type") return undefined;
  const target = d.resolution?.hit?.target;
  return target && "productId" in target ? target.productId : undefined;
}

/**
 * Стан рядка в списку (F4):
 * - `known` — знайомий товар (штрихкод чи назва) або обраний людиною;
 * - `similar` — «Схоже на: …» — лише здогадка, ніколи не впізнане;
 * - `type` — лише тип (евристика, ідентифікатор на тип, вибір типу);
 * - `unknown` — «Не впізнали»;
 * - `conflict` — штрихкод і назва ведуть до різного;
 * - `nonfood` — «Не для комори».
 */
export type LineState = "known" | "similar" | "type" | "unknown" | "conflict" | "nonfood";

export function lineState(d: ReviewDraft): LineState {
  if (d.choice && d.choice.kind !== "untouched") return lineProductId(d) ? "known" : "type";
  if (d.nonFood) return "nonfood";
  if (d.resolution?.eanConflict) return "conflict";
  if (lineProductId(d)) return "known";
  if (d.resolution?.suggestion?.product) return "similar";
  return d.ingredient ? "type" : "unknown";
}

/**
 * Галочка наперед (B2.6): впізнане й усе з типом-здогадкою — так; невідоме
 * й конфлікт штрихкоду з назвою — ні: там останнє слово за людиною.
 */
export function precheck(d: ReviewDraft): boolean {
  const state = lineState(d);
  return !!d.ingredient && state !== "conflict" && state !== "nonfood" && state !== "unknown";
}

/**
 * Пізнє уточнення поверх рядка.
 *
 * Здогадка (без `resolution.hit`) не переписує тип, який рядок уже має, — так
 * само, як раніше пошук за кодом дописував лише нерозпізнані рядки. Кількість,
 * яку людина ввела сама, не переписує ніщо.
 */
function mergeLate(d: ReviewDraft, patch: Partial<ReviewDraft>): ReviewDraft {
  let next: Partial<ReviewDraft> = patch;
  if (d.ingredient && !patch.resolution?.hit) {
    const { ingredient: _i, amount: _a, unit: _u, ...rest } = patch;
    next = rest;
  }
  if (d.touched) {
    const { amount: _a, unit: _u, ...rest } = next;
    next = rest;
  }
  return { ...d, ...next, id: d.id, line: d.line };
}

/** Картка для «Створити товар» з рядка чека: підказки назви + «З чека: …». */
export function productDraftFromLine(d: ReviewDraft): ProductDraft {
  return draftFromHints(d.hints, {
    typeKey: d.ingredient?.key,
    source: "receipt",
    provenance: { from: "receipt", raw: d.line.name },
  });
}

/**
 * Рядки комори з підтвердженого (D6.6): назва — картка чи тип, а сирий текст
 * каси йде в receiptName і лишається приватним «звідки». Складання однакових
 * рядків — справа importPantry (stackIntoPantry), не цього файлу.
 */
export function receiptPantryItems(
  drafts: readonly ReviewDraft[],
  chosen: ReadonlySet<string>,
  addedAt: string,
  makeId: () => string = newId,
  products: Readonly<Record<string, Product>> = {},
): PantryItem[] {
  return drafts
    .filter((d) => chosen.has(d.id) && d.ingredient)
    .map((d) => {
      const productId = lineProductId(d);
      // Картка знає вагу штуки: «2 шт» яєць з карткою — це грами, і ціна грама чесна.
      const product = productId ? (d.product?.id === productId ? d.product : products[productId]) : undefined;
      const key = product?.typeKey ?? d.ingredient!.key;
      return {
        id: makeId(),
        key,
        productId,
        label: undefined,
        receiptName: d.line.name,
        amount: d.amount,
        unit: d.unit,
        addedAt,
        /*
         * Ціну рахуємо з підтвердженої кількості, а не з тієї, що вгадав
         * розбір: якщо людина виправила «1 шт» на «900 г», ціна грама має
         * піти за виправленням, інакше страва вийде дорожчою в девʼять разів.
         */
        pricePerGram: priceFromPurchase(key, d.amount, d.unit, d.line.sum, product) ?? undefined,
      };
    });
}

/* ── Стан списку ──────────────────────────────────────────────────────── */

/**
 * Увесь життєвий цикл чека: читання → дочитування → список → вибір.
 *
 * Стан тримається в ref і дзеркалиться в React, а не оновлюється
 * функціональними апдейтерами: рішення «ставити галочку чи ні» для пізньої
 * відповіді залежить від свіжого рядка, і приймати його всередині апдейтера
 * (який StrictMode кличе двічі) було б побічним ефектом.
 */
export function useReceiptReview() {
  const [receipt, setReceiptState] = useState<ReviewReceipt | null>(null);
  const [chosen, setChosenState] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState<"qr" | "photo">("qr");

  const receiptRef = useRef<ReviewReceipt | null>(null);
  const chosenRef = useRef<ReadonlySet<string>>(new Set());
  const run = useRef<AbortController | null>(null);
  // Джерело читання для show(): стан `from` у замиканні обробника ще старий.
  const fromRef = useRef<"qr" | "photo">("qr");
  /*
   * Рядки, продукт для яких людина обрала сама, і рядки, галочку яких вона
   * чіпала. Пізня відповідь бази, що приїхала через пʼять секунд, не
   * переписує ані перше, ані друге.
   */
  const byHand = useRef(new Set<string>());
  const toggled = useRef(new Set<string>());

  const setReceipt = useCallback((next: ReviewReceipt | null) => {
    receiptRef.current = next;
    setReceiptState(next);
  }, []);
  const setChosen = useCallback((next: ReadonlySet<string>) => {
    chosenRef.current = next;
    setChosenState(next);
  }, []);

  const replaceDraft = (id: string, make: (d: ReviewDraft) => ReviewDraft): ReviewDraft | null => {
    const cur = receiptRef.current;
    const old = cur?.drafts.find((d) => d.id === id);
    if (!cur || !old) return null;
    const next = make(old);
    setReceipt({ ...cur, drafts: cur.drafts.map((d) => (d.id === id ? next : d)) });
    return next;
  };

  const check = (id: string, on: boolean) => {
    if (chosenRef.current.has(id) === on) return;
    const next = new Set(chosenRef.current);
    if (on) next.add(id);
    else next.delete(id);
    setChosen(next);
  };

  /** Починає нове читання й обриває попереднє. */
  const start = (source: "qr" | "photo"): AbortSignal => {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    byHand.current = new Set();
    toggled.current = new Set();
    fromRef.current = source;
    setFrom(source);
    setBusy(true);
    return controller.signal;
  };

  /** «Скасувати» в аркуші «Читаю чек»: закрити його — означає передумати. */
  const cancel = () => {
    run.current?.abort();
    run.current = null;
    setBusy(false);
  };

  /** Читання не вдалося — сторінка показує свій аркуш невдачі. */
  const fail = () => setBusy(false);

  /**
   * Розібраний чек → список. `drafts` — receiptDrafts(read.lines) з
   * підказками; `enrichers` — resolveReceipt та інше, що може запізнитись.
   */
  const show = async (
    read: Receipt,
    drafts: ReviewDraft[],
    enrichers: readonly Enricher[],
    signal: AbortSignal,
  ) => {
    await enrichWithinBudget(
      drafts,
      enrichers,
      signal,
      (ready) => {
        setBusy(false);
        setReceipt({ store: read.store, source: fromRef.current, drafts: ready });
        // Наперед позначаємо лише впізнане: решту людина або підкаже, або пропустить.
        setChosen(new Set(ready.filter(precheck).map((d) => d.id)));
        haptic(14);
      },
      (id, patch) => {
        if (signal.aborted || byHand.current.has(id)) return;
        const next = replaceDraft(id, (d) => mergeLate(d, patch));
        // Список могли закрити — тоді дописувати нікуди.
        if (next && !toggled.current.has(id)) check(id, precheck(next));
      },
    );
  };

  const toggle = (id: string) => {
    haptic(8);
    toggled.current.add(id);
    check(id, !chosenRef.current.has(id));
  };

  /** Людина правила кількість — пізні відповіді її більше не чіпають. */
  const setQuantity = (id: string, next: { amount?: number; unit: Unit }) =>
    replaceDraft(id, (d) => ({ ...d, amount: next.amount, unit: next.unit, touched: true }));

  const choose = (id: string, make: (d: ReviewDraft) => ReviewDraft) => {
    byHand.current.add(id);
    const next = replaceDraft(id, make);
    if (next) check(id, !!next.ingredient);
  };

  const withProduct = (product: Product, choice: LineChoice) => (d: ReviewDraft): ReviewDraft => {
    const q = receiptLineQuantity(d.line, product, d.hints);
    return {
      ...d,
      ingredient: ing(product.typeKey),
      nonFood: false,
      choice,
      product,
      amount: q?.amount,
      unit: q?.unit,
      touched: undefined,
    };
  };

  /** [Так] на «Схоже на: …». */
  const confirm = (id: string) => {
    const product = receiptRef.current?.drafts.find((d) => d.id === id)?.resolution?.suggestion?.product;
    if (product) choose(id, withProduct(product, { kind: "confirmed", productId: product.id }));
  };

  /** Товар із пікера «Що це за товар?» або щойно створений у редакторі. */
  const pickProduct = (id: string, product: Product) =>
    choose(id, withProduct(product, { kind: "picked-product", productId: product.id }));

  /** Тип із пікера: рядок лягає без картки товару (T2). */
  const pickType = (id: string, def: IngredientDef) =>
    choose(id, (d) => {
      const q = receiptLineQuantity(d.line, undefined, d.hints);
      return {
        ...d,
        ingredient: def,
        nonFood: false,
        choice: { kind: "picked-type", typeKey: def.key },
        product: undefined,
        amount: q?.amount,
        unit: q?.unit,
        touched: undefined,
      };
    });

  const close = () => setReceipt(null);

  const selected = receipt ? receipt.drafts.filter((d) => chosen.has(d.id) && d.ingredient) : [];

  return {
    receipt,
    chosen,
    busy,
    from,
    selected,
    start,
    cancel,
    fail,
    show,
    toggle,
    setQuantity,
    confirm,
    pickProduct,
    pickType,
    close,
  };
}

export type ReceiptReviewState = ReturnType<typeof useReceiptReview>;

/* ── Аркуш ────────────────────────────────────────────────────────────── */

export function ReceiptReview({
  review,
  products,
  canUseProducts,
  onPick,
  onCreateProduct,
  onImport,
}: {
  review: ReceiptReviewState;
  /** Кеш товарів стора: назви для знайомих рядків. */
  products: Record<string, Product>;
  /** Локальний режим: без станів товару й без «Створити товар». */
  canUseProducts: boolean;
  /** «Не те?», «Інше», «Обрати», «Це інший товар» → «Що це за товар?» (ProductPicker). */
  onPick: (draft: ReviewDraft) => void;
  /** «Створити товар» → ProductEditorSheet з productDraftFromLine(draft). */
  onCreateProduct: (draft: ReviewDraft) => void;
  /** «Додати N позицій»: receiptPantryItems + importPantry + навчання (B8). */
  onImport: (drafts: ReviewDraft[]) => void;
}) {
  const [nonFoodOpen, setNonFoodOpen] = useState(false);
  const { receipt, chosen, selected } = review;
  const count = selected.length;

  const food = receipt?.drafts.filter((d) => lineState(d) !== "nonfood") ?? [];
  const nonFood = receipt?.drafts.filter((d) => lineState(d) === "nonfood") ?? [];

  const row = (draft: ReviewDraft) => (
    <ReceiptRow
      key={draft.id}
      draft={draft}
      product={draft.product ?? (lineProductId(draft) ? products[lineProductId(draft)!] : undefined)}
      canUseProducts={canUseProducts}
      checked={chosen.has(draft.id)}
      onToggle={() => review.toggle(draft.id)}
      onQuantity={(next) => review.setQuantity(draft.id, next)}
      onConfirm={() => review.confirm(draft.id)}
      onPick={() => onPick(draft)}
      onCreate={() => onCreateProduct(draft)}
    />
  );

  return (
    <Sheet
      open={!!receipt}
      onClose={review.close}
      title="Що було в чеку"
      footer={
        receipt ? (
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={review.close}>
              Скасувати
            </Button>
            <Button className="flex-1" onClick={() => onImport(selected)} disabled={count === 0}>
              {count > 0
                ? `Додати ${count} ${plural(count, "позицію", "позиції", "позицій")}`
                : "Нічого не обрано"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {receipt && (
        <div className="pb-2">
          <p className="mb-3 text-[12px] leading-snug text-muted">
            {receipt.store ? `${receipt.store} · ` : ""}
            {receipt.drafts.length} {plural(receipt.drafts.length, "рядок", "рядки", "рядків")}.
            Познач, що несемо в комору.
            {receipt.source === "photo" && (
              <span className="mt-1 block text-faint">
                Прочитано з фото — перевір назви й кількості, перш ніж додавати.
              </span>
            )}
          </p>

          <div className="flex flex-col gap-2">{food.map(row)}</div>

          {/* Пакети й знижки лише заважають звіряти покупки — згорнуті, але
              не сховані: каса інколи помиляється і в цьому. */}
          {nonFood.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => {
                  haptic(8);
                  setNonFoodOpen((v) => !v);
                }}
                aria-expanded={nonFoodOpen}
                className="flex items-center gap-1 py-1.5 text-[12px] font-bold uppercase tracking-wide text-muted"
              >
                Не для комори · {nonFood.length}
                <ChevronDown size={14} className={cn("transition-transform", nonFoodOpen && "rotate-180")} />
              </button>
              {nonFoodOpen && <div className="mt-1.5 flex flex-col gap-2">{nonFood.map(row)}</div>}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Рядок чека перед тим, як стати рядком комори.
 *
 * Касову назву показуємо завжди, навіть коли товар знайомий: саме за нею
 * людина звіряє рядок із папірцем у руці, а «Молоко» без уточнення в чеку на
 * двадцять позицій ні про що не каже.
 */
function ReceiptRow({
  draft,
  product,
  canUseProducts,
  checked,
  onToggle,
  onQuantity,
  onConfirm,
  onPick,
  onCreate,
}: {
  draft: ReviewDraft;
  product?: Product;
  canUseProducts: boolean;
  checked: boolean;
  onToggle: () => void;
  onQuantity: (next: { amount?: number; unit: Unit }) => void;
  onConfirm: () => void;
  onPick: () => void;
  onCreate: () => void;
}) {
  const def = draft.ingredient;
  const state = lineState(draft);
  const suggestion = draft.resolution?.suggestion?.product;
  const byHand = !!draft.choice && draft.choice.kind !== "untouched";

  const title =
    state === "unknown"
      ? "Не впізнали"
      : state === "nonfood"
        ? draft.line.name
        : product?.name ??
          draft.hints?.suggestedName ??
          (def ? receiptDisplayName(draft.line.name, def.key) : draft.line.name);

  // Упаковку вгадали з голого числа («Масл180») — кажемо про це чесно.
  const guessed =
    !!def && !draft.touched && state !== "known" && !!draft.hints?.packGuessed && draft.amount != null;
  const canCreate = canUseProducts && !draft.hints?.weighed && (state === "type" || state === "unknown");

  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        checked ? "border-line bg-surface" : "border-line/50 bg-surface/40",
      )}
    >
      <div className="flex items-start gap-2.5">
        <button
          onClick={onToggle}
          disabled={!def}
          role="checkbox"
          aria-checked={checked}
          aria-label={`Додати ${title}`}
          className={cn(
            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2",
            checked ? "border-brand bg-brand text-brand-ink" : "border-line",
            !def && "opacity-40",
          )}
        >
          {checked && <Check size={13} strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-[13.5px] font-bold", !checked && "text-muted")}>{title}</p>
          <p className="truncate text-[11px] text-faint">
            {state !== "nonfood" && draft.line.name}
            {draft.line.sum != null && `${state !== "nonfood" ? " · " : ""}${formatNumber(draft.line.sum)} ₴`}
            {canUseProducts && state === "known" && !byHand && draft.resolution?.hit && (
              <span className="font-semibold text-mint"> · знайомий товар</span>
            )}
          </p>
        </div>

        {canUseProducts && state === "known" ? (
          <button onClick={onPick} className="shrink-0 text-[11.5px] font-semibold text-muted underline">
            Не те?
          </button>
        ) : (
          <span className="shrink-0 text-lg">{def?.emoji ?? "📦"}</span>
        )}
      </div>

      {canUseProducts && state === "similar" && suggestion && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-[30px]">
          <p className="min-w-0 text-[12px] text-muted">
            Схоже на: <span className="font-semibold text-ink">«{suggestion.name}»</span>
          </p>
          <Button size="sm" onClick={onConfirm}>
            Так
          </Button>
          <Button size="sm" variant="secondary" onClick={onPick}>
            Інше
          </Button>
        </div>
      )}

      {state === "conflict" && (
        <div className="mt-2 flex items-center justify-between gap-2 pl-[30px]">
          <p className="text-[11.5px] text-brand-2">Штрихкод і назва ведуть до різних товарів</p>
          <Button size="sm" variant="secondary" onClick={onPick}>
            Обрати
          </Button>
        </div>
      )}

      {def && state !== "nonfood" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-[30px]">
          <span className="text-[12px] font-semibold text-muted">Скільки:</span>
          <QuantityInput
            amount={draft.amount}
            unit={draft.unit}
            defaultUnit={product?.packUnit ?? def.defaultUnit}
            allowTaste={false}
            label={title}
            onChange={onQuantity}
          />
          {guessed && (
            <span className="text-[11px] text-faint underline decoration-dotted">здогадка</span>
          )}
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2 pl-[30px]">
          <p className="text-[11.5px] text-muted">
            {state === "nonfood" ? "Не для комори" : "Немає в каталозі"}
          </p>
          <Button size="sm" variant="secondary" onClick={onPick}>
            Обрати
          </Button>
        </div>
      )}

      {state === "type" && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 pl-[30px]">
          <button onClick={onPick} className="py-1 text-[11.5px] font-semibold text-muted underline">
            Це інший товар
          </button>
          {canCreate && (
            <button onClick={onCreate} className="py-1 text-[11.5px] font-semibold text-brand underline">
              Створити товар
            </button>
          )}
        </div>
      )}
      {state === "unknown" && canCreate && (
        <div className="mt-1.5 pl-[30px]">
          <button onClick={onCreate} className="py-1 text-[11.5px] font-semibold text-brand underline">
            Створити товар
          </button>
        </div>
      )}
    </div>
  );
}
