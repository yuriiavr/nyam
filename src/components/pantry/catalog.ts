"use client";

import { satisfies } from "@/data/ingredients";
import { cachedBrands, catalogDeps as liveDeps, isOnline } from "@/lib/barcode";
import type { IdentifierHit, TeachItem, TeachResult } from "@/lib/product-types";
import type { ResolveDeps } from "@/lib/resolve";
import { useApp } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchIdentifiersByRaw, reassignIdentifier, teachIdentifiers } from "@/lib/supabase/products-api";
import { conflictAction, wrongMappingConflicts } from "@/lib/teach";

export { cachedBrands, isOnline };

/*
 * Клей між екранами й спільним каталогом: з чого зібрати ResolveDeps і як
 * довести навчання до кінця (уточнення тип → товар мовчки, решта конфліктів —
 * питанням до людини).
 *
 * resolve.ts і teach.ts навмисно не знають ні про стор, ні про Supabase — так
 * їх перевіряють без бази. Тож «звідки брати мережу й кеш» живе тут, в одному
 * місці, а не розмножене по комори, формі рецепта й «Назвати».
 */

/**
 * Залежності для resolveBarcode / resolveReceipt — живі (src/lib/barcode.ts)
 * разом із кешем стору.
 *
 * Кеш читаємо в момент виклику, а не при рендері: між дотиком і відповіддю
 * стор міг отримати свіжі картки, і знайомий штрихкод без звʼязку має
 * впізнатись за найсвіжішим кешем. У локальному режимі configured:false —
 * resolve.ts тоді не робить жодного RPC, лише питає Open Food Facts.
 */
export function catalogDeps(): ResolveDeps {
  const { products, eanIndex } = useApp.getState();
  return liveDeps({ products, eanIndex });
}

/** Відповідь бази, яку не можна вирішити мовчки: «Цей код зараз означає «Q»». */
export interface ConflictPrompt {
  /** Що ми намагались навчити. */
  sent: TeachItem;
  /** Що вже є: target і version — для reassign_identifier. */
  result: TeachResult;
  /** Товар, до якого людина привʼязала рядок (sent.product_id). */
  productId: string;
}

export interface TeachOutcome {
  /** false — запит не пройшов (офлайн, забагато змін): рядки однаково вже в коморі. */
  ok: boolean;
  /** Конфлікти для людини — по одному аркушу. */
  prompts: ConflictPrompt[];
  /** Ідентифікатори, про які база вже відповіла, — щоб не питати про них удруге. */
  identifierIds: string[];
}

/**
 * Вчить базу й доводить відповіді до ладу (B8/B9).
 *
 * - `refine`: код знали лише як тип, а новий товар цього типу — уточнюємо до
 *   товару мовчки (reassign_identifier пишеться в історію, повернути можна);
 * - `prompt`: код уже означає інший товар — чуже мовчки не переписуємо,
 *   повертаємо питання екрану;
 * - навчені й підтверджені штрихкоди одразу лягають у eanIndex: наступний
 *   скан цього коду впізнається навіть без звʼязку.
 *
 * Будь-яка невдача навчання не скасовує того, що вже в коморі: ok:false і
 * порожні prompts, а що сказати людині — вирішує екран.
 */
export async function teachAndSettle(
  items: readonly TeachItem[],
  opts: { seller?: string | null; chain?: string | null } = {},
): Promise<TeachOutcome> {
  if (items.length === 0 || !isSupabaseConfigured) return { ok: true, prompts: [], identifierIds: [] };
  if (!isOnline()) return { ok: false, prompts: [], identifierIds: [] };

  let results: TeachResult[];
  try {
    results = await teachIdentifiers(items, opts.seller ?? null, opts.chain ?? null);
  } catch {
    return { ok: false, prompts: [], identifierIds: [] };
  }

  const products = useApp.getState().products;
  const prompts: ConflictPrompt[] = [];
  const indexed: IdentifierHit[] = [];
  const hitOf = (r: TeachResult, productId: string): IdentifierHit => ({
    kind: r.kind,
    raw: r.raw,
    identifierId: r.identifierId ?? "",
    scope: r.scope ?? "",
    target: { productId },
    version: r.version ?? 1,
  });

  for (const result of results) {
    // Відповідь зводимо з надісланим за видом і сирою стрічкою: порядок база не обіцяє.
    const sent = items.find((i) => i.kind === result.kind && i.raw === result.raw);
    if (!sent) continue;
    const productId = sent.product_id;

    if ((result.status === "inserted" || result.status === "same") && productId && result.kind === "ean") {
      indexed.push(hitOf(result, productId));
      continue;
    }

    const productType = productId ? products[productId]?.typeKey : undefined;
    const action = conflictAction(sent, result, productType);
    if (action === "refine" && productId && result.identifierId && result.version != null) {
      try {
        const moved = await reassignIdentifier(result.identifierId, result.version, { productId });
        if (moved.kind === "ean") indexed.push(hitOf({ ...result, version: moved.version }, productId));
      } catch {
        /* уточнення — бонус: рядок у коморі вже з товаром, спитати можна пізніше */
      }
    } else if (action === "prompt" && productId) {
      prompts.push({ sent, result, productId });
    }
  }

  if (indexed.length) {
    const cached = indexed.flatMap((h) => {
      const p = "productId" in h.target ? products[h.target.productId] : undefined;
      return p ? [p] : [];
    });
    useApp.getState().upsertProducts(cached, indexed);
  }
  return {
    ok: true,
    prompts,
    identifierIds: results.flatMap((r) => (r.identifierId ? [r.identifierId] : [])),
  };
}

/**
 * «Не той товар?» з назвою з каси: привʼязки цієї назви в інших областях
 * (магазин, де її навчив чек), що досі ведуть до попереднього товару рядка, —
 * питаннями «Цей код зараз означає…» (див. wrongMappingConflicts у teach.ts).
 * Невдача пошуку — порожньо: рядок уже з правильним товаром, а спитати можна
 * наступного разу.
 */
export async function wrongMappingPrompts(
  raw: string,
  previousProductId: string | undefined,
  productId: string,
  skip: readonly string[],
): Promise<ConflictPrompt[]> {
  if (!isSupabaseConfigured || !previousProductId || previousProductId === productId || !isOnline()) return [];
  try {
    const found = await fetchIdentifiersByRaw("receipt_name", raw);
    return wrongMappingConflicts(found, raw, previousProductId, productId, new Set(skip)).map((c) => ({
      ...c,
      productId,
    }));
  } catch {
    return [];
  }
}

/** Чи можна запропонувати обʼєднати два товари: типи сумісні (один — той самий чи загальніший). */
export const mergeableTypes = (a: string, b: string): boolean => satisfies(a, b) || satisfies(b, a);
