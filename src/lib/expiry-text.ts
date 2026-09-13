import { ing } from "@/data/ingredients";
import { productHints } from "./product-hints";
import { plural } from "./utils";

/**
 * Текст щоденного сповіщення про строки (cron /api/cron/expiry, D11).
 *
 * Окремо від маршруту, бо тут дві речі, які легко зламати непомітно:
 * відмінки («І ще 21 продукт», а не «продуктів» — стара вбудована формула
 * помилялась на 21, 22–24, 31…) і назва, яку людина впізнає. Сервер не має
 * реєстру дописаних типів, тож own_* без підказки показав би сирий ключ, а
 * касовий рядок — «Мол950УлГаличБЛак2.5». Обидва випадки — у перевірках.
 */

/** Рядок pantry_items у тій формі, яку читає cron. Колонки I2/I4 необовʼязкові. */
export interface ExpiryRow {
  ingredient_key: string;
  expires_at: string;
  label?: string | null;
  receipt_name?: string | null;
  product_id?: string | null;
}

export interface ExpiryLookups {
  /** products.id → name (I4). */
  products?: ReadonlyMap<string, string>;
  /** custom_ingredients.key → label: сервер не знає дописаних типів. */
  customLabels?: ReadonlyMap<string, string>;
}

/**
 * Назва рядка для людини, від найточнішого:
 * картка товару → власна назва → назва з касового рядка → дописаний тип → тип.
 */
export function expiryRowName(row: ExpiryRow, lookups: ExpiryLookups = {}): string {
  const product = row.product_id ? lookups.products?.get(row.product_id) : undefined;
  if (product?.trim()) return product.trim();
  if (row.label?.trim()) return row.label.trim();
  // Лише коли підказка справді склалась: інакше для own_* вийшов би сирий ключ замість назви.
  const fromReceipt = row.receipt_name ? productHints(row.receipt_name, row.ingredient_key).suggestedName : undefined;
  if (fromReceipt) return fromReceipt;
  return lookups.customLabels?.get(row.ingredient_key)?.trim() || ing(row.ingredient_key).label;
}

/**
 * Одне сповіщення на людину: найтерміновіше — в заголовку, решта — лічильником.
 * `today` — YYYY-MM-DD; рядки — те, що псується сьогодні або завтра.
 */
export function expiryMessage(
  rows: ReadonlyArray<{ expires_at: string; name: string }>,
  today: string,
): { title: string; body: string } {
  const sorted = [...rows].sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const first = sorted[0];
  if (!first) return { title: "", body: "" };

  const rest = sorted.length - 1;
  const when = first.expires_at <= today ? "сьогодні останній день" : "псується завтра";
  return {
    title: rest > 0 ? `${first.name} — ${when}` : `${first.name}: ${when}`,
    body:
      rest > 0
        ? `І ще ${rest} ${plural(rest, "продукт", "продукти", "продуктів")} на черзі. Зазирни, що з них приготувати.`
        : "Зазирни в комору — можливо, саме з нього щось вийде.",
  };
}
