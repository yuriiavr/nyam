import { findIngredient } from "@/data/ingredients";
import type { IngredientDef } from "./types";

export interface ProductInfo {
  barcode: string;
  name: string;
  brand?: string;
  image?: string;
  /** Розпізнаний інгредієнт з нашого каталогу, якщо вдалося зіставити */
  ingredient: IngredientDef | null;
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
      `?fields=product_name,product_name_uk,product_name_ru,brands,image_small_url,categories_tags`;

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
      source: "openfoodfacts",
    };
  } catch {
    return fallback;
  }
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
