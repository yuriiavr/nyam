import { findIngredient } from "@/data/ingredients";
import type { IngredientDef, Nutrition } from "./types";

export interface ProductInfo {
  barcode: string;
  name: string;
  brand?: string;
  image?: string;
  /** Розпізнаний інгредієнт з нашого каталогу, якщо вдалося зіставити */
  ingredient: IngredientDef | null;
  /** Харчова цінність на 100 г з етикетки, якщо виробник її вказав. */
  nutrition?: Nutrition;
  source: "openfoodfacts" | "unknown";
}

/**
 * Пошук товару за штрихкодом в Open Food Facts — безкоштовний відкритий API
 * без ключа, з підтримкою CORS.
 */
export async function lookupBarcode(barcode: string): Promise<ProductInfo> {
  const fallback: ProductInfo = {
    barcode,
    name: `Товар ${barcode}`,
    ingredient: null,
    source: "unknown",
  };

  try {
    const url =
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json` +
      `?fields=product_name,product_name_uk,product_name_ru,brands,image_small_url,` +
      `categories_tags,nutriments`;

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
        brands?: string;
        image_small_url?: string;
        categories_tags?: string[];
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

    // Пробуємо зіставити з каталогом: спершу назва, далі категорії
    const categoryText = (p.categories_tags ?? [])
      .map((t) => t.replace(/^[a-z]{2}:/, "").replace(/-/g, " "))
      .join(" ");

    const ingredient = findIngredient(name) ?? findIngredient(categoryText);

    return {
      barcode,
      name,
      brand: p.brands?.split(",")[0]?.trim(),
      image: p.image_small_url,
      ingredient,
      nutrition: parseNutriments(p.nutriments),
      source: "openfoodfacts",
    };
  } catch {
    return fallback;
  }
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
