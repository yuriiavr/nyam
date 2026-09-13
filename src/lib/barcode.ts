import { ing, knownIngredient } from "@/data/ingredients";
import { lookupOffDraft } from "./off-draft";
import type { Product } from "./product-types";
import { resolveBarcode, type BarcodeResult, type ResolveDeps } from "./resolve";
import { isSupabaseConfigured } from "./supabase/client";
import {
  fetchProductsByIds,
  resolveIdentifiers,
  searchProducts,
  similarReceiptNames,
} from "./supabase/products-api";
import type { IngredientDef, Nutrition, Unit } from "./types";

export { normalizeEan } from "./ean";
export { lookupOffDraft, parseNutriments, parsePackSize, productDraftFromOff } from "./off-draft";
export type { BarcodeResult };

/*
 * Штрихкод → що це за товар.
 *
 * Уся логіка впізнавання — у src/lib/resolve.ts (B1): кеш стору, спільна база
 * (resolve_identifiers), Open Food Facts, порожня чернетка. Тут лише «живі»
 * залежності для неї (клієнт Supabase, fetch до OFF) і стара форма відповіді
 * ProductInfo для екранів, які ще не перейшли на картки товарів.
 *
 * Спільний довідник barcode_cache новий код не читає й не пише: його записи
 * перенесено в product_identifiers (supabase/products.sql), а вчать базу
 * тепер teach_identifiers (src/lib/teach.ts) і картки товарів (save_product).
 */

/** Кеш стору, яким сканер впізнає знайомий код і без звʼязку. */
export type CatalogCache = NonNullable<ResolveDeps["cache"]>;

/**
 * Бренди з кешу карток: те, що люди вже назвали, підказка впізнає наступного
 * разу — і в касових скороченнях. Прибрані картки не рахуються: бренд зі
 * сміттєвої картки не мусить «уточнювати» чужі чеки.
 */
export function cachedBrands(products: Readonly<Record<string, Product>>): string[] {
  const seen = new Set<string>();
  for (const product of Object.values(products)) {
    const brand = product.brand?.trim();
    if (brand && !product.archived) seen.add(brand);
  }
  return [...seen];
}

/** navigator.onLine; на сервері (SSR) і без navigator вважаємо, що звʼязок є. */
export const isOnline = (): boolean => typeof navigator === "undefined" || navigator.onLine !== false;

/**
 * Залежності resolve.ts для справжнього застосунку.
 *
 * Без бекенду (`configured: false`) resolve.ts не робить жодного RPC — лише
 * OFF, щоб рядок «лише тип» мав назву з пачки. `cache` — products і eanIndex
 * зі стору: екрани передають їх самі, щоб цей модуль не тягнув за собою стор.
 */
export function catalogDeps(cache?: CatalogCache, overrides: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    configured: isSupabaseConfigured,
    online: isOnline,
    resolveIdentifiers,
    fetchProductsByIds,
    searchProducts,
    similarReceiptNames,
    lookupOff: (ean, signal) => lookupOffDraft(ean, signal),
    cache,
    extraBrands: cache ? cachedBrands(cache.products) : [],
    ...overrides,
  };
}

/**
 * Відповідь сканера у старій формі — для екранів, що ще не перейшли на
 * ScanResultSheet і картки товарів (форма рецепта, старий потік комори).
 */
export interface ProductInfo {
  barcode: string;
  name: string;
  brand?: string;
  image?: string;
  /** Розпізнаний тип з нашого каталогу, якщо вдалося зіставити */
  ingredient: IngredientDef | null;
  /** Харчова цінність на 100 г з етикетки, якщо виробник її вказав. */
  nutrition?: Nutrition;
  /** Вага або обʼєм упаковки з етикетки — щоб не вводити «500 г» руками. */
  amount?: number;
  unit?: Unit;
  /** community — це знає спільна база (картка товару чи «лише тип»). */
  source: "openfoodfacts" | "community" | "unknown";
  /** Спільна картка, коли код веде саме до неї. */
  product?: Product;
  /** Повна відповідь resolveBarcode — для нових екранів. */
  resolution?: BarcodeResult;
}

const typeOf = (key: string | undefined): IngredientDef | null => (key && knownIngredient(key) ? ing(key) : null);

/** BarcodeResult → стара форма ProductInfo. Чисто; `code` — те, що прочитав сканер. */
export function productInfoFromResult(code: string, res: BarcodeResult): ProductInfo {
  const barcode = res.ean ?? code;
  const fallbackName = `Товар ${barcode}`;
  if (res.product) {
    const p = res.product;
    return {
      barcode,
      name: p.name,
      brand: p.brand,
      image: p.image,
      ingredient: typeOf(p.typeKey),
      nutrition: p.nutrition,
      ...(p.packAmount != null && p.packUnit ? { amount: p.packAmount, unit: p.packUnit } : {}),
      source: "community",
      product: p,
      resolution: res,
    };
  }
  const draft = res.draft;
  const known = res.hit && "typeKey" in res.hit.target;
  const typeKey = res.typeKey ?? (draft?.typeKey || undefined);
  return {
    barcode,
    name: draft?.name?.trim() || (known && typeKey ? typeOf(typeKey)?.label ?? fallbackName : fallbackName),
    brand: draft?.brand,
    image: draft?.image,
    ingredient: typeOf(typeKey),
    nutrition: draft?.nutrition,
    ...(draft?.packAmount != null && draft.packUnit ? { amount: draft.packAmount, unit: draft.packUnit } : {}),
    source: known ? "community" : draft?.source === "off" ? "openfoodfacts" : "unknown",
    resolution: res,
  };
}

/**
 * Пошук товару за штрихкодом — обгортка над resolveBarcode у старій формі.
 *
 * Порядок той самий, що в B1: кеш стору → спільна база → Open Food Facts.
 * Український ринок OFF майже не покриває (коди 482… там здебільшого
 * відсутні), тож відповідь спільноти для них єдина. Нічого не пише.
 */
export async function lookupBarcode(barcode: string, cache?: CatalogCache): Promise<ProductInfo> {
  try {
    return productInfoFromResult(barcode, await resolveBarcode(barcode, catalogDeps(cache)));
  } catch {
    return { barcode, name: `Товар ${barcode}`, ingredient: null, source: "unknown" };
  }
}

/** Чи є в браузері нативний BarcodeDetector узагалі (Chrome на Android). */
export function hasNativeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

/*
 * Скільки чекати на список форматів. Відповідь приходить майже миттєво, а
 * якщо ні — щось із платформою не так, і надійніше одразу взяти ZXing, ніж
 * тримати людину перед камерою, яка нічого не шукає.
 */
const NATIVE_FORMATS_TIMEOUT_MS = 1500;

/**
 * Чи прочитає нативний BarcodeDetector усе, що ми просимо.
 *
 * Сама наявність класу нічого не гарантує: він буває й там, де платформа
 * потрібного формату не вміє, і тоді detect() просто завжди повертає
 * порожньо — сканер виглядає живим, але не спрацює ніколи. Тому вимагаємо
 * кожен формат зі списку, а інакше йдемо в ZXing, який вміє все сам.
 */
export async function nativeDetectorSupports(formats: readonly string[]): Promise<boolean> {
  if (!hasNativeDetector()) return false;
  const ctor = (window as unknown as { BarcodeDetector: { getSupportedFormats?: () => Promise<string[]> } })
    .BarcodeDetector;
  if (typeof ctor.getSupportedFormats !== "function") return false;
  try {
    const supported = await Promise.race([
      ctor.getSupportedFormats(),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), NATIVE_FORMATS_TIMEOUT_MS)),
    ]);
    return formats.length > 0 && formats.every((format) => supported.includes(format));
  } catch {
    return false;
  }
}

export const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
] as const;

/**
 * Формати для сканера чека.
 *
 * Окремо від товарних кодів навмисно: на упаковці QR теж трапляється (акції,
 * інструкції), і якби сканер продукту його читав, замість штрихкоду в комору
 * летіла б реклама. Тут навпаки — цікавить рівно QR фіскального чека.
 *
 * Перелік має дійти до обох рушіїв — і до нативного BarcodeDetector, і до
 * ZXing: без явних підказок ZXing читає всі формати, які знає.
 */
export const RECEIPT_FORMATS = ["qr_code"] as const;
