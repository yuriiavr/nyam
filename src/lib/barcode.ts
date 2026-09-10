import { findIngredient, findIngredientByCategory, ING_BY_KEY } from "@/data/ingredients";
import { cacheBarcode, fetchCachedBarcode } from "./supabase/api";
import { parseQty } from "./units";
import type { IngredientDef, Nutrition, Unit } from "./types";

export interface ProductInfo {
  barcode: string;
  name: string;
  brand?: string;
  image?: string;
  /** Розпізнаний інгредієнт з нашого каталогу, якщо вдалося зіставити */
  ingredient: IngredientDef | null;
  /** Харчова цінність на 100 г з етикетки, якщо виробник її вказав. */
  nutrition?: Nutrition;
  /** Вага або обʼєм упаковки з етикетки — щоб не вводити «500 г» руками. */
  amount?: number;
  unit?: Unit;
  source: "openfoodfacts" | "community" | "unknown";
}

/**
 * Пошук товару за штрихкодом.
 *
 * Спершу питаємо спільний довідник: якщо цей код хтось уже розпізнав, це
 * і швидше, і точніше за будь-яку евристику. Далі — Open Food Facts.
 *
 * Порядок саме такий, бо український ринок OFF майже не покриває: коди 482…
 * там здебільшого просто відсутні. Відповідь спільноти для них єдина.
 */
export async function lookupBarcode(barcode: string): Promise<ProductInfo> {
  const known = await fetchCachedBarcode(barcode).catch(() => null);
  const ingredient = known ? ING_BY_KEY.get(known.ingredientKey) ?? null : null;
  if (known && ingredient) {
    return {
      barcode,
      name: known.name,
      brand: known.brand,
      image: known.image,
      ingredient,
      source: "community",
    };
  }

  return lookupInOpenFoodFacts(barcode);
}

/**
 * Запамʼятовує вибір користувача для штрихкода, якого не впізнали.
 *
 * Мовчки: підказка спільноті — побічний ефект додавання продукту, і якщо
 * запис не пройшов, користувачу нема на що реагувати.
 */
export async function teachBarcode(
  product: ProductInfo,
  ingredientKey: string,
): Promise<void> {
  if (product.source === "community") return;
  try {
    await cacheBarcode({
      barcode: product.barcode,
      name: product.name,
      brand: product.brand,
      image: product.image,
      ingredientKey,
    });
  } catch {
    /* довідник спільноти — приємний бонус, а не умова роботи */
  }
}

async function lookupInOpenFoodFacts(barcode: string): Promise<ProductInfo> {
  const fallback: ProductInfo = {
    barcode,
    name: `Товар ${barcode}`,
    ingredient: null,
    source: "unknown",
  };

  try {
    const url =
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json` +
      `?fields=product_name,product_name_uk,product_name_ru,generic_name,generic_name_uk,` +
      `brands,image_small_url,categories_tags,quantity,product_quantity,` +
      `product_quantity_unit,nutriments`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return fallback;

    const json = (await res.json()) as {
      status?: number;
      product?: {
        product_name?: string;
        product_name_uk?: string;
        product_name_ru?: string;
        generic_name?: string;
        generic_name_uk?: string;
        brands?: string;
        image_small_url?: string;
        categories_tags?: string[];
        quantity?: string;
        product_quantity?: number | string;
        product_quantity_unit?: string;
        nutriments?: Record<string, unknown>;
      };
    };

    const p = json.product;
    if (!p) return fallback;

    const name =
      p.product_name_uk?.trim() ||
      p.product_name?.trim() ||
      p.product_name_ru?.trim() ||
      fallback.name;

    /*
     * Зіставляємо в три заходи. Назва на етикетці — маркетинговий текст
     * («Молочна ріка Особлива»), тож коли вона нічого не дала, пробуємо
     * generic_name — це рядок, де виробник пише, що це насправді
     * («сир кисломолочний»). Категорії останні: вони структуровані й тому
     * найнадійніші, але надто загальні, щоб починати з них.
     */
    const generic = p.generic_name_uk?.trim() || p.generic_name?.trim();
    const ingredient =
      findIngredient(name) ??
      (generic ? findIngredient(generic) : null) ??
      findIngredientByCategory(p.categories_tags ?? []);

    return {
      barcode,
      name,
      brand: p.brands?.split(",")[0]?.trim(),
      image: p.image_small_url,
      ingredient,
      nutrition: parseNutriments(p.nutriments),
      ...parsePackSize(p.quantity, p.product_quantity, p.product_quantity_unit),
      source: "openfoodfacts",
    };
  } catch {
    return fallback;
  }
}

/**
 * Розмір упаковки з етикетки: «500 г», «1 л».
 *
 * Спершу беремо машинні поля product_quantity + product_quantity_unit, бо
 * вони вже нормалізовані. Якщо їх немає — розбираємо людський рядок quantity
 * тим самим парсером, що й кількості в рецептах.
 *
 * Абсурдні значення відкидаємо: у базі трапляється вага в 0 або 50 кг, і
 * підставити таке в комору гірше, ніж не підставити нічого.
 */
function parsePackSize(
  quantity: string | undefined,
  productQuantity: number | string | undefined,
  productQuantityUnit: string | undefined,
): { amount?: number; unit?: Unit } {
  const sane = (amount: number, unit: Unit) =>
    amount > 0 && amount <= 10_000 ? { amount: Math.round(amount * 100) / 100, unit } : {};

  const machine = Number(productQuantity);
  if (Number.isFinite(machine) && machine > 0) {
    const raw = (productQuantityUnit ?? "g").toLowerCase();
    const unit: Unit | null = raw === "g" ? "g" : raw === "ml" ? "ml" : null;
    if (unit) return sane(machine, unit);
  }

  const parsed = parseQty(quantity);
  if (parsed?.amount != null && parsed.unit !== "taste") return sane(parsed.amount, parsed.unit);
  return {};
}

/**
 * Витягує КБЖВ на 100 г з відповіді Open Food Facts.
 *
 * Дані заповнюють самі користувачі бази, тож поля бувають відсутні або
 * абсурдні. Беремо лише те, що схоже на правду: калорійність вище 900 на
 * 100 г неможлива фізично (чистий жир — 900), тож такий запис відкидаємо
 * цілком, ніж підсунемо в рахунок сміття.
 */
function parseNutriments(raw: Record<string, unknown> | undefined): Nutrition | undefined {
  if (!raw) return undefined;

  const num = (key: string): number | null => {
    const value = raw[key];
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  // Якщо ккал немає, але є кДж — переводимо (1 ккал = 4,184 кДж).
  const kj = num("energy-kj_100g");
  const kcal = num("energy-kcal_100g") ?? (kj != null ? kj / 4.184 : null);
  if (kcal == null || kcal > 900) return undefined;

  const protein = num("proteins_100g") ?? 0;
  const fat = num("fat_100g") ?? 0;
  const carbs = num("carbohydrates_100g") ?? 0;

  // Сума макронутрієнтів не може перевищувати 100 г у 100 г продукту.
  if (protein + fat + carbs > 105) return undefined;

  return {
    kcal: Math.round(kcal),
    protein: Math.round(protein * 10) / 10,
    fat: Math.round(fat * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
  };
}

/** Чи підтримує браузер нативний BarcodeDetector (Chrome на Android). */
export function hasNativeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
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
