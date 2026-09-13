import { chainOf } from "@/data/chains";
import { ancestors, descendants, ing, knownIngredient, satisfies } from "@/data/ingredients";
import { normalizeEan } from "./ean";
import { productHints } from "./product-hints";
import {
  isCatalogError,
  type CatalogErrorCode,
  type IdentifierHit,
  type Product,
  type ProductDraft,
  type ProductHints,
  type Resolution,
  type SimilarNameHit,
} from "./product-types";
import { isNonFood, lineQuantity, matchReceiptName, type Receipt, type ReceiptLine } from "./receipt";
import type { Unit } from "./types";
import { sumQuantities, unitDef } from "./units";

/**
 * Що це за товар: штрихкод зі сканера (B1) і рядки чека (B2/B3).
 *
 * Мережу модуль сам не чіпає — усі запити приходять у `deps` (зазвичай
 * функції з src/lib/supabase/products-api.ts плюс lookupOffDraft). Так це
 * перевіряється без бази, а локальний режим (збірка без Supabase) гарантовано
 * не робить жодного RPC: `configured: false` → одразу `{via: "none"}`.
 *
 * Правило, яке тримає все інше: `hit` — лише те, що база ЗНАЄ (ідентифікатор).
 * Пошук, «схоже на», OFF і евристика — `suggestion`: показати можна, вважати
 * впізнаним і вчити з цього — ні.
 */

/* ── Залежності ───────────────────────────────────────────────────────── */

export interface ResolveDeps {
  /** isSupabaseConfigured. false — локальний режим: жодного RPC. */
  configured: boolean;
  /** navigator.onLine; без нього вважаємо, що звʼязок є. */
  online?: () => boolean;
  resolveIdentifiers(
    eans: readonly string[],
    names: readonly string[],
    seller?: string | null,
    chain?: string | null,
    signal?: AbortSignal,
  ): Promise<IdentifierHit[]>;
  fetchProductsByIds(ids: Iterable<string>, signal?: AbortSignal): Promise<Product[]>;
  /** Для «Схоже на …» у чеку. Немає — крок пропускаємо. */
  searchProducts?(query: string, typeKeys?: readonly string[] | null, limit?: number, signal?: AbortSignal): Promise<Product[]>;
  /** I5, лише фото-чеки. Немає — крок пропускаємо. */
  similarReceiptNames?(
    names: readonly string[],
    seller?: string | null,
    chain?: string | null,
    signal?: AbortSignal,
  ): Promise<SimilarNameHit[]>;
  /** Open Food Facts → чернетка (lookupOffDraft). Немає — без OFF. */
  lookupOff?(ean: string, signal?: AbortSignal): Promise<ProductDraft | null>;
  /** Кеш зі стору: знайомий штрихкод впізнається і без звʼязку. */
  cache?: {
    products: Readonly<Record<string, Product>>;
    eanIndex: Readonly<Record<string, string>>;
  };
  /** Бренди з кешу карток — для підказок назви. */
  extraBrands?: readonly string[];
  /** Скільки чекати базу; за замовчуванням 4 с (B1). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 4000;
/** OFF — не більше стількох рядків на чек: кожен — окремий запит у чужий сервіс. */
const OFF_LINES_PER_RECEIPT = 8;
/** «Схоже на» через пошук — не більше стількох рядків: решта лишається з евристикою. */
const SEARCH_LINES_PER_RECEIPT = 12;

const deadline = (deps: ResolveDeps) => AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
const errorCode = (error: unknown): CatalogErrorCode => (isCatalogError(error) ? error.code : "other");
const uniq = <T,>(list: Iterable<T>): T[] => [...new Set(list)];

/** Картка з урахуванням обʼєднань — не глибше кількох кроків, без кіл. */
function follow(map: ReadonlyMap<string, Product> | Readonly<Record<string, Product>>, id: string): Product | undefined {
  const get = (key: string) => (map instanceof Map ? map.get(key) : (map as Record<string, Product>)[key]);
  let product = get(id);
  for (let hop = 0; hop < 4 && product?.mergedInto; hop++) {
    const next = get(product.mergedInto);
    if (!next || next.id === product.id) break;
    product = next;
  }
  return product;
}

/* ── Штрихкод (B1) ────────────────────────────────────────────────────── */

export interface BarcodeResult extends Resolution {
  /** normalizeEan(code); null — не EAN (Code-128 тощо): лише ручний вибір. */
  ean: string | null;
  /** Відомий товар: у комору одразу. */
  product?: Product;
  /** Тип рядка: з товару або з ідентифікатора «лише тип». */
  typeKey?: string;
  /** Для редактора картки: з OFF або порожня з provenance скану. */
  draft?: ProductDraft;
  from?: "cache" | "server";
  /** База не відповіла: `offline` → «Картку товару можна зберегти, коли є звʼязок». */
  error?: CatalogErrorCode;
  /** Знайдено в кеші — перевірити в базі у фоні, коли є звʼязок. */
  revalidate?: () => Promise<BarcodeResult>;
}

/** Порожня картка скану; тип — коли база знає код лише як тип, інакше код не знає ніхто. */
const blankDraft = (ean: string, typeKey = ""): ProductDraft => ({
  typeKey,
  name: "",
  guessed: [],
  provenance: typeKey
    ? { from: "scan", ean, known: "type", ...(knownIngredient(typeKey) ? { label: ing(typeKey).label } : {}) }
    : { from: "scan", ean, known: "none" },
});

async function offDraft(ean: string, deps: ResolveDeps): Promise<ProductDraft | null> {
  if (!deps.lookupOff) return null;
  try {
    return await deps.lookupOff(ean);
  } catch {
    return null;
  }
}

/** Промах у базі або локальний режим: що скаже OFF. Нічого не пишемо. */
async function withOff(ean: string, deps: ResolveDeps, base: Partial<BarcodeResult> = {}): Promise<BarcodeResult> {
  const draft = await offDraft(ean, deps);
  return {
    via: "none",
    ean,
    ...base,
    draft: draft ?? blankDraft(ean),
    ...(draft?.typeKey ? { typeKey: draft.typeKey, suggestion: { typeKey: draft.typeKey, from: "off" as const } } : {}),
  };
}

async function barcodeFromServer(ean: string, deps: ResolveDeps): Promise<BarcodeResult> {
  /*
   * Одна межа на обидва запити (B1, 4 с): штрихкод знайшовся швидко, а картка
   * зависла на напівмертвому зʼєднанні — це однаково «база не відповіла», а не
   * спінер «Шукаю товар» до кінця світу.
   */
  const signal = deadline(deps);
  let hits: IdentifierHit[];
  try {
    hits = await deps.resolveIdentifiers([ean], [], null, null, signal);
  } catch (error) {
    return { via: "none", ean, error: errorCode(error) };
  }

  const hit = hits.find((h) => h.kind === "ean");
  if (!hit) return withOff(ean, deps, { from: "server" });

  if ("productId" in hit.target) {
    let products: Product[];
    try {
      products = await deps.fetchProductsByIds([hit.target.productId], signal);
    } catch (error) {
      return { via: "none", ean, error: errorCode(error) };
    }
    const product = follow(new Map(products.map((p) => [p.id, p])), hit.target.productId);
    // Картку встигли прибрати між двома запитами — чесніше «не знаємо», ніж прибрана картка в коморі.
    if (!product || product.archived) return withOff(ean, deps, { from: "server" });
    return { via: "ean", ean, hit, product, typeKey: product.typeKey, from: "server" };
  }

  /*
   * Знаємо лише тип: «Знаємо, що це «Згущене молоко», але ще не знаємо назви».
   * OFF може підказати назву; тип з OFF беремо, лише коли він уточнює відомий.
   */
  const known = hit.target.typeKey;
  const draft = await offDraft(ean, deps);
  const typeKey = draft?.typeKey && satisfies(draft.typeKey, known) ? draft.typeKey : known;
  return {
    via: "ean",
    ean,
    hit,
    typeKey,
    from: "server",
    draft: draft
      ? { ...draft, typeKey, guessed: (draft.guessed ?? []).filter((g) => g !== "type" || typeKey !== known) }
      : blankDraft(ean, typeKey),
  };
}

/**
 * Штрихкод зі сканера → що це (B1, кроки 1–5).
 *
 * 1. не EAN → `{via:"none", ean:null}`;
 * 2. локальний режим → лише OFF (назва для рядка «лише тип»), без RPC;
 * 3. кеш стору → одразу, з `revalidate` для фону;
 * 4. офлайн → `error: "offline"`;
 * 5. база: товар / тип / промах → OFF → порожня чернетка.
 *
 * Нічого не пише: картку створює лише «Зберегти» в редакторі.
 */
export async function resolveBarcode(code: string | null | undefined, deps: ResolveDeps): Promise<BarcodeResult> {
  const ean = normalizeEan(code);
  if (!ean) return { via: "none", ean: null };
  if (!deps.configured) return withOff(ean, deps);

  const online = deps.online?.() ?? true;
  const id = deps.cache?.eanIndex[ean];
  const cached = id && deps.cache ? follow(deps.cache.products, id) : undefined;
  if (cached && !cached.archived) {
    return {
      via: "ean",
      ean,
      product: cached,
      typeKey: cached.typeKey,
      from: "cache",
      ...(online ? { revalidate: () => barcodeFromServer(ean, deps) } : {}),
    };
  }
  if (!online) return { via: "none", ean, error: "offline" };
  return barcodeFromServer(ean, deps);
}

/* ── Чек (B2 / B3) ────────────────────────────────────────────────────── */

export type ReceiptSource = "qr" | "photo";

/** Рядок чека після розпізнавання — те, що показує ReceiptReview (F4). */
export interface ResolvedReceiptLine {
  /** `${index}:${name}` — той самий ключ, що в receiptDrafts, щоб звести з наявними рядками. */
  id: string;
  line: ReceiptLine;
  nonFood: boolean;
  /** Дійсний EAN рядка (лише QR; у фото кодів немає). */
  ean: string | null;
  hints: ProductHints;
  resolution: Resolution;
  /** Тип рядка комори: з товару, з ідентифікатора, з OFF чи з евристики. */
  typeKey?: string;
  /** Лише коли впізнано напевно (`resolution.hit`). Підказаний товар — у `resolution.suggestion`. */
  product?: Product;
  /** Чернетка для редактора, коли OFF щось знає. */
  draft?: ProductDraft;
  amount?: number;
  unit?: Unit;
  /** З галочкою: усе впізнане й усе з типом; без — невідоме й eanConflict. */
  checked: boolean;
}

export interface ReceiptResolution {
  lines: ResolvedReceiptLine[];
  /** Усі картки, які довелось завантажити, — для кешу стору. */
  products: Product[];
  /** Основний запит не вдався: рядки лишились з евристикою. */
  error?: CatalogErrorCode;
}

/** 0,548 кг → 548 г, 1800 мл → 1,8 л — так само, як tidy у receipt.ts. */
function tidy(amount: number, unit: Unit): { amount: number; unit: Unit } {
  const [summed] = sumQuantities([{ amount, unit }]);
  if (!summed || summed.amount == null) return { amount, unit };
  return { amount: Number(summed.amount.toFixed(unitDef(summed.unit).decimals)), unit: summed.unit };
}

/**
 * Скільки принесли додому (B2.5):
 * - вагове (каса рахує кг/л, або «Кг» у назві) → як на касі;
 * - з товаром → упаковка товару × кількість;
 * - інакше упаковка з назви × кількість, інакше lineQuantity.
 */
function lineAmount(line: ReceiptLine, hints: ProductHints, product?: Product): { amount: number; unit: Unit } | null {
  const till = line.measure ? lineQuantity({ ...line, name: "" }) : null;
  if (till && till.unit !== "pcs") return till;
  if (hints.weighed) return line.qty > 0 ? tidy(line.qty, "kg") : null;
  const qty = line.qty > 0 ? line.qty : 1;
  if (product?.packAmount != null && product.packUnit) return tidy(product.packAmount * qty, product.packUnit);
  if (hints.packAmount != null && hints.packUnit) return tidy(hints.packAmount * qty, hints.packUnit);
  return lineQuantity(line);
}

const NO_HINTS: ProductHints = { attributes: [], weighed: false, tokens: [], guessed: [] };

/**
 * Чек без бази: не їжа, тип з евристики (уточнений підказками), кількість.
 * Синхронно — це показується одразу, а відповідь бази латає рядки потім.
 */
export function draftReceiptLines(
  receipt: Receipt,
  source: ReceiptSource,
  extraBrands: readonly string[] = [],
): ResolvedReceiptLine[] {
  return receipt.lines.map((line, index) => {
    const nonFood = isNonFood(line.name);
    const hints = nonFood
      ? NO_HINTS
      : productHints(line.name, matchReceiptName(line.name)?.key, extraBrands, line.measure);
    const typeKey = nonFood ? undefined : hints.typeKey;
    const quantity = nonFood ? null : lineAmount(line, hints);
    return {
      id: `${index}:${line.name}`,
      line,
      nonFood,
      ean: source === "qr" ? normalizeEan(line.code) : null,
      hints,
      resolution: typeKey ? { via: "none", suggestion: { typeKey, from: "heuristic" } } : { via: "none" },
      typeKey,
      amount: quantity?.amount,
      unit: quantity?.unit,
      checked: !nonFood && !!typeKey,
    };
  });
}

/** Тип, на який веде збіг: товару (якщо його картка є) або сам тип. */
function hitType(hit: IdentifierHit, products: ReadonlyMap<string, Product>): string | undefined {
  if ("productId" in hit.target) return follow(products, hit.target.productId)?.typeKey;
  return hit.target.typeKey;
}

/** Два збіги одного рядка не сперечаються: та сама ціль або одна уточнює іншу. */
function compatible(a: IdentifierHit, b: IdentifierHit, products: ReadonlyMap<string, Product>): boolean {
  const pa = "productId" in a.target ? follow(products, a.target.productId)?.id : undefined;
  const pb = "productId" in b.target ? follow(products, b.target.productId)?.id : undefined;
  if (pa && pb) return pa === pb;
  const ta = hitType(a, products);
  const tb = hitType(b, products);
  if (!ta || !tb) return false;
  // Товар проти типу: годиться, якщо товар цього типу чи різновиду. Два типи — один уточнює інший.
  if (pa) return satisfies(ta, tb);
  if (pb) return satisfies(tb, ta);
  return satisfies(ta, tb) || satisfies(tb, ta);
}

/** Зі згодних збігів — конкретніший: товар важить більше за тип, різновид — більше за батька. */
function moreSpecific(a: IdentifierHit, b: IdentifierHit, products: ReadonlyMap<string, Product>): IdentifierHit {
  const aProduct = "productId" in a.target;
  const bProduct = "productId" in b.target;
  if (aProduct !== bProduct) return aProduct ? a : b;
  if (aProduct) return a;
  const ta = hitType(a, products);
  const tb = hitType(b, products);
  return ta && tb && satisfies(tb, ta) && tb !== ta ? b : a;
}

const typeFamily = (typeKey: string) => uniq([typeKey, ...ancestors(typeKey), ...descendants(typeKey)]);

/**
 * Чек → рядки з тим, що про них знає база (B2 для QR, B3 для фото).
 *
 * Один resolve_identifiers на весь чек: EAN (лише QR) і назви їжі, продавець
 * як є і мережа з chainOf — область рахує база. Далі на рядок:
 * 1. збіг EAN, потім назви; розійшлись — перемагає EAN, рядок без галочки
 *    й з `eanConflict`;
 * 2. невпізнаним — підказки: OFF (QR, до 8 рядків) або «схожі назви» (фото),
 *    потім пошук карток, інакше евристика. Підказка ніколи не стає `hit`.
 *
 * Будь-яка невдача — рядки з евристикою і `error`; підказки мовчки пропускаються.
 *
 * `onHits` — у дві хвилі (B2.2): те, що база ЗНАЄ (збіги, картки, упаковки),
 * віддаємо одразу, щойно прийшли resolve_identifiers і картки, а не після
 * підказок. Підказки — до 8 запитів в OFF і 12 пошуків, кожен до 4 с, — інакше
 * тримали б знайомий товар, доки не відповість найповільніший, і список
 * відкривався б самими типами. У `onHits` лише рядки зі збігом; решта — у
 * фінальній відповіді. Рядки, віддані в `onHits`, далі не змінюються.
 */
export async function resolveReceipt(
  receipt: Receipt,
  source: ReceiptSource,
  deps: ResolveDeps,
  onHits?: (early: ReceiptResolution) => void,
): Promise<ReceiptResolution> {
  const lines = draftReceiptLines(receipt, source, deps.extraBrands);
  if (!deps.configured) return { lines, products: [] };
  if (deps.online && !deps.online()) return { lines, products: [], error: "offline" };

  const food = lines.filter((l) => !l.nonFood);
  const eans = uniq(food.map((l) => l.ean).filter((e): e is string => !!e));
  const names = uniq(food.map((l) => l.line.name));
  if (eans.length === 0 && names.length === 0) return { lines, products: [] };

  const seller = receipt.store?.trim() || null;
  const chain = chainOf(seller) ?? null;

  let hits: IdentifierHit[];
  try {
    hits = await deps.resolveIdentifiers(eans, names, seller, chain, deadline(deps));
  } catch (error) {
    return { lines, products: [], error: errorCode(error) };
  }

  const products = new Map<string, Product>();
  try {
    await load(products, deps, hits.flatMap((h) => ("productId" in h.target ? [h.target.productId] : [])), deadline(deps));
  } catch (error) {
    return { lines, products: [], error: errorCode(error) };
  }

  // Товар без картки чи прибраний, тип, якого цей клієнт не знає, — не збіг.
  const usable = (hit: IdentifierHit | undefined): IdentifierHit | undefined => {
    if (!hit) return undefined;
    if ("productId" in hit.target) {
      const product = follow(products, hit.target.productId);
      return product && !product.archived ? hit : undefined;
    }
    return knownIngredient(hit.target.typeKey) ? hit : undefined;
  };
  const byKey = new Map(hits.map((h) => [`${h.kind}\n${h.raw}`, h]));

  for (const row of food) {
    const eanHit = row.ean ? usable(byKey.get(`ean\n${row.ean}`)) : undefined;
    const nameHit = usable(byKey.get(`receipt_name\n${row.line.name}`));
    let hit: IdentifierHit | undefined;
    let conflict: IdentifierHit | undefined;
    if (eanHit && nameHit) {
      if (compatible(eanHit, nameHit, products)) hit = moreSpecific(eanHit, nameHit, products);
      else [hit, conflict] = [eanHit, nameHit];
    } else {
      hit = eanHit ?? nameHit;
    }
    if (!hit) continue;

    const product = "productId" in hit.target ? follow(products, hit.target.productId) : undefined;
    if (!product && "typeKey" in hit.target) {
      // Тип від бази — основа; ознаки з назви можуть лише уточнити його вниз.
      row.hints = productHints(row.line.name, hit.target.typeKey, deps.extraBrands, row.line.measure);
    }
    row.product = product;
    row.typeKey = product?.typeKey ?? row.hints.typeKey;
    row.resolution = { via: hit.kind, hit, ...(conflict ? { eanConflict: conflict } : {}) };
    const quantity = lineAmount(row.line, row.hints, product);
    row.amount = quantity?.amount;
    row.unit = quantity?.unit;
    row.checked = !conflict;
  }

  if (onHits) {
    const known = food.filter((row) => row.resolution.via !== "none");
    if (known.length) onHits({ lines: known, products: [...products.values()] });
  }
  await suggest(food.filter((row) => row.resolution.via === "none"), source, seller, chain, deps, products);
  return { lines, products: [...products.values()] };
}

/** Підказки для невпізнаних рядків. Лише показати — нічого не впізнано й нічого не вчимо. */
async function suggest(
  rows: ResolvedReceiptLine[],
  source: ReceiptSource,
  seller: string | null,
  chain: string | null,
  deps: ResolveDeps,
  products: Map<string, Product>,
): Promise<void> {
  if (rows.length === 0) return;
  const signal = deadline(deps);
  const pending = (row: ResolvedReceiptLine) =>
    !row.resolution.suggestion || row.resolution.suggestion.from === "heuristic";

  /* (a) QR: дійсний EAN → OFF. */
  if (source === "qr" && deps.lookupOff) {
    const withEan = rows.filter((row) => row.ean).slice(0, OFF_LINES_PER_RECEIPT);
    await Promise.all(
      withEan.map(async (row) => {
        const draft = await deps.lookupOff!(row.ean as string, signal).catch(() => null);
        if (!draft) return;
        row.draft = draft;
        const typeKey = row.typeKey ?? (draft.typeKey || undefined);
        if (!typeKey) return;
        row.typeKey = typeKey;
        row.resolution = { via: "none", suggestion: { typeKey, from: "off" } };
        row.checked = true;
      }),
    );
  }

  /* (b) фото: схожі назви з чеків (I5). */
  if (source === "photo" && deps.similarReceiptNames) {
    try {
      const open = rows.filter(pending);
      const similar = await deps.similarReceiptNames(
        uniq(open.map((row) => row.line.name)),
        seller,
        chain,
        signal,
      );
      await load(products, deps, similar.map((s) => s.productId), signal);
      const byRaw = new Map(similar.map((s) => [s.raw, s]));
      for (const row of open) {
        const hit = byRaw.get(row.line.name);
        const product = hit ? follow(products, hit.productId) : undefined;
        if (!product || product.archived) continue;
        row.typeKey ??= product.typeKey;
        row.resolution = { via: "none", suggestion: { product, typeKey: row.typeKey, from: "similar" } };
        row.checked = true;
      }
    } catch {
      /* підказка — бонус */
    }
  }

  /* (c) пошук карток за назвою-здогадкою в родині типу. */
  if (deps.searchProducts) {
    const open = rows.filter((row) => pending(row) && row.typeKey && row.hints.suggestedName).slice(0, SEARCH_LINES_PER_RECEIPT);
    await Promise.all(
      open.map(async (row) => {
        try {
          const [top] = await deps.searchProducts!(row.hints.suggestedName as string, typeFamily(row.typeKey as string), 1, signal);
          if (!top || top.archived) return;
          products.set(top.id, top);
          row.resolution = { via: "none", suggestion: { product: top, typeKey: row.typeKey, from: "search" } };
        } catch {
          /* підказка — бонус */
        }
      }),
    );
  }
}

/** Докачує картки, яких ще немає в мапі. */
async function load(products: Map<string, Product>, deps: ResolveDeps, ids: string[], signal?: AbortSignal): Promise<void> {
  const missing = uniq(ids).filter((id) => !products.has(id));
  if (missing.length === 0) return;
  for (const p of await deps.fetchProductsByIds(missing, signal)) products.set(p.id, p);
}
