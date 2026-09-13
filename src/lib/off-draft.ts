import { findIngredient, findIngredientByCategory } from "@/data/ingredients";
import type { PackUnit, ProductDraft } from "./product-types";
import { productHints } from "./product-hints";
import type { Nutrition, Unit } from "./types";
import { parseQty } from "./units";

/**
 * Open Food Facts → чернетка картки товару (C, B5).
 *
 * OFF лише заповнює редактор: картка з'явиться в спільній базі тільки після
 * «Зберегти» людини, з source = 'off'. Тому тут нічого не пишемо й нічого не
 * вирішуємо остаточно — усе, що вгадане, позначене в `guessed`.
 *
 * Розбір упаковки й КБЖВ переїхав сюди з src/lib/barcode.ts без змін (там
 * вони не експортовані, а barcode.ts тягне за собою клієнт Supabase). Друга
 * хвиля прибирає копії з barcode.ts і імпортує звідси.
 */

/** Поля, які просимо в OFF: без них відповідь важить сотні кілобайт. */
export const OFF_FIELDS = [
  "product_name",
  "product_name_uk",
  "product_name_ru",
  "generic_name",
  "generic_name_uk",
  "brands",
  "image_small_url",
  "categories_tags",
  "quantity",
  "product_quantity",
  "product_quantity_unit",
  "nutriments",
].join(",");

/** Лише ті поля товару OFF, які ми читаємо. */
export interface OffProduct {
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
}

export const offProductUrl = (ean: string): string =>
  `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=${OFF_FIELDS}`;

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
export function parsePackSize(
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
export function parseNutriments(raw: Record<string, unknown> | undefined): Nutrition | undefined {
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

const PACK_UNITS: ReadonlySet<string> = new Set<PackUnit>(["g", "kg", "ml", "l", "pcs"]);

const clean = (value: string | undefined): string | undefined => value?.replace(/\s+/g, " ").trim() || undefined;

/**
 * Чернетка картки з товару OFF (приймає і сам `product`, і всю відповідь API).
 *
 * - назва: українська → український опис → будь-яка → російська (тоді
 *   «здогадка»: людина має переписати її по-людськи);
 * - виробник: перший із `brands`;
 * - тип: назва → опис → категорії, далі уточнення ознаками з назви
 *   («lactose free milk» → безлактозне); тип з OFF — завжди здогадка;
 * - що OFF лишив порожнім (виробник, упаковка, жирність), дозаповнює
 *   productHints з назви — з позначкою «здогадка», де вгадано.
 *
 * null — OFF нічого корисного не знає: тоді редактор порожній, як для
 * невідомого коду.
 */
export function productDraftFromOff(ean: string, json: unknown): ProductDraft | null {
  const holder = json as { product?: OffProduct } | null;
  const p: OffProduct | undefined =
    holder && typeof holder === "object" && holder.product && typeof holder.product === "object"
      ? holder.product
      : (json as OffProduct | null) ?? undefined;
  if (!p || typeof p !== "object") return null;

  const guessed: NonNullable<ProductDraft["guessed"]> = [];
  const ukName = clean(p.product_name_uk) ?? clean(p.generic_name_uk) ?? clean(p.product_name);
  const ruName = ukName ? undefined : clean(p.product_name_ru);
  if (ruName) guessed.push("name");
  const name = ukName ?? ruName ?? "";

  const generic = clean(p.generic_name_uk) ?? clean(p.generic_name);
  const found =
    (name ? findIngredient(name) : null) ??
    (generic ? findIngredient(generic) : null) ??
    findIngredientByCategory(p.categories_tags ?? []);

  const hints = name ? productHints(name, found?.key) : undefined;
  const typeKey = hints?.typeKey ?? found?.key ?? "";
  if (typeKey) guessed.push("type");

  let brand = clean(p.brands?.split(",")[0]);
  if (!brand && hints?.brand) {
    brand = hints.brand;
    if (hints.guessed.includes("brand")) guessed.push("brand");
  }

  const size = parsePackSize(p.quantity, p.product_quantity, p.product_quantity_unit);
  let packAmount = size.amount != null && size.unit && PACK_UNITS.has(size.unit) ? size.amount : undefined;
  let packUnit = packAmount != null ? (size.unit as PackUnit) : undefined;
  if (packAmount == null && hints?.packAmount != null && hints.packUnit) {
    packAmount = hints.packAmount;
    packUnit = hints.packUnit;
    if (hints.packGuessed) guessed.push("pack");
  }

  const fatPct = hints?.fatPct;
  if (fatPct != null && hints?.guessed.includes("fat")) guessed.push("fat");

  const nutrition = parseNutriments(p.nutriments);
  const image = p.image_small_url && /^https:\/\//.test(p.image_small_url) ? p.image_small_url : undefined;

  if (!name && !brand && packAmount == null && !nutrition) return null;

  return {
    typeKey,
    name,
    ...(brand ? { brand } : {}),
    ...(fatPct != null ? { fatPct } : {}),
    ...(packAmount != null && packUnit ? { packAmount, packUnit } : {}),
    ...(nutrition ? { nutrition } : {}),
    ...(image ? { image } : {}),
    source: "off",
    guessed,
    provenance: { from: "off", ean },
  };
}

/**
 * Питає OFF і повертає чернетку. Будь-яка невдача (немає товару, мережа,
 * 8 секунд без відповіді) — null: OFF — бонус, а не умова додати товар.
 * `fetchImpl` — для перевірок без мережі.
 */
export async function lookupOffDraft(
  ean: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ProductDraft | null> {
  try {
    const res = await fetchImpl(offProductUrl(ean), {
      headers: { Accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return productDraftFromOff(ean, await res.json());
  } catch {
    return null;
  }
}
