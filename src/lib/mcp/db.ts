import "server-only";

import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Product } from "@/lib/product-types";
import type { MealSlot, PantryItem } from "@/lib/types";

/**
 * База для голосового помічника.
 *
 * Помічник приходить не з сесією Supabase, а з особистим ключем, тож пишемо
 * службовим ключем — і RLS тут не стереже. Тому кожен запит у src/lib/mcp
 * явно обмежений людиною з ключа (або її сімʼєю для комори), а id з
 * аргументів інструментів ніколи не беремо на віру.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let service: SupabaseClient | null = null;
let anon: SupabaseClient | null = null;

export const mcpConfigured = () => Boolean(URL && SERVICE_KEY && ANON_KEY);

export function db(): SupabaseClient {
  service ??= createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return service;
}

/** Каталог товарів — публічний; шукаємо ним, щоб не давати пошуку більше прав, ніж треба. */
export function publicDb(): SupabaseClient {
  anon ??= createClient(URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return anon;
}

const TOKEN_RE = /^nyam_[0-9a-f]{64}$/;

/** Чий це ключ. Сміття відсікаємо ще до бази. */
export async function userFromToken(token: string | null | undefined): Promise<string | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const { data, error } = await db()
    .from("api_tokens")
    .select("id,user_id,last_used_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;

  // «Востаннє користувались» — не частіше за раз на десять хвилин: це підказка, а не журнал.
  const last = data.last_used_at ? new Date(data.last_used_at as string).getTime() : 0;
  if (Date.now() - last > 10 * 60_000) {
    void db()
      .from("api_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(() => {});
  }
  return data.user_id as string;
}

/** Я і моя сімʼя — чия комора спільна. */
export async function familyOf(userId: string): Promise<string[]> {
  const { data: me } = await db().from("family_members").select("family_id").eq("user_id", userId).maybeSingle();
  if (!me?.family_id) return [userId];
  const { data } = await db().from("family_members").select("user_id").eq("family_id", me.family_id);
  const ids = (data ?? []).map((r) => r.user_id as string);
  return ids.includes(userId) ? ids : [userId, ...ids];
}

/* ── Товари ───────────────────────────────────────────────────────────── */

export const PRODUCT_COLUMNS =
  "id,type_key,name,brand,fat_pct,pack_amount,pack_unit,grams_per_piece,kcal,protein,fat,carbs,image_url,nutrition_source,source,archived,merged_into,version,updated_at";

const num = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function productFromRow(row: Record<string, unknown>): Product {
  const kcal = num(row.kcal);
  const unit = row.pack_unit as Product["packUnit"] | null;
  return {
    id: String(row.id),
    typeKey: String(row.type_key),
    name: String(row.name),
    ...(row.brand ? { brand: String(row.brand) } : {}),
    ...(num(row.fat_pct) != null ? { fatPct: num(row.fat_pct) } : {}),
    ...(num(row.pack_amount) != null && unit ? { packAmount: num(row.pack_amount), packUnit: unit } : {}),
    ...(num(row.grams_per_piece) != null ? { gramsPerPiece: num(row.grams_per_piece) } : {}),
    ...(kcal != null
      ? {
          nutrition: { kcal, protein: num(row.protein) ?? 0, fat: num(row.fat) ?? 0, carbs: num(row.carbs) ?? 0 },
          ...(row.nutrition_source === "ai" ? { nutritionSource: "ai" as const } : {}),
        }
      : {}),
    ...(typeof row.image_url === "string" ? { image: row.image_url } : {}),
    source: (row.source as Product["source"]) ?? "user",
    archived: Boolean(row.archived),
    ...(row.merged_into ? { mergedInto: String(row.merged_into) } : {}),
    version: num(row.version) ?? 1,
    updatedAt: String(row.updated_at ?? ""),
  };
}

/** Картка за id; обʼєднану — підміняємо переможцем. */
export async function productById(id: string): Promise<Product | null> {
  const { data } = await db().from("products").select(PRODUCT_COLUMNS).eq("id", id).maybeSingle();
  if (!data) return null;
  const product = productFromRow(data as Record<string, unknown>);
  if (product.mergedInto) return productById(product.mergedInto);
  return product;
}

/* ── Комора ───────────────────────────────────────────────────────────── */

export const PANTRY_COLUMNS =
  "id,user_id,ingredient_key,product_id,label,receipt_name,amount,unit,qty,barcode,added_at,expires_at,price_per_gram,updated_at";

/**
 * Рядок бази → рядок комори, щоб списувати тими ж функціями, що й застосунок.
 * Те саме, що rowToPantryItem у supabase/api.ts — той модуль лише для браузера.
 */
export function pantryFromRow(row: Record<string, unknown>): PantryItem {
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    id: String(row.id),
    key: String(row.ingredient_key),
    productId: text(row.product_id),
    ownerId: text(row.user_id),
    label: text(row.label),
    receiptName: text(row.receipt_name),
    amount: num(row.amount),
    unit: text(row.unit) as PantryItem["unit"],
    qty: text(row.qty),
    addedAt: String(row.added_at),
    expiresAt: text(row.expires_at),
    barcode: text(row.barcode),
    pricePerGram: num(row.price_per_gram),
    updatedAt: text(row.updated_at),
  };
}

/** Назад — щоб повернути спорожнілий рядок. Як pantryToRow у supabase/api.ts. */
export function pantryToDbRow(item: PantryItem, owner: string): Record<string, unknown> {
  return {
    id: item.id,
    user_id: owner,
    ingredient_key: item.key,
    product_id: item.productId ?? null,
    label: item.label ?? null,
    receipt_name: item.receiptName ?? null,
    amount: item.amount ?? null,
    unit: item.unit ?? null,
    qty: item.qty ?? null,
    barcode: item.barcode ?? null,
    added_at: item.addedAt,
    expires_at: item.expiresAt ?? null,
    price_per_gram: item.pricePerGram ?? null,
  };
}

/* ── Час людини ───────────────────────────────────────────────────────── */

/**
 * Сервер живе в UTC, а «сьогодні» й «обід» — у часі людини. Помічник може
 * передати свій пояс; ні — Київ: застосунок український.
 */
export const DEFAULT_TZ = process.env.NYAM_TIMEZONE || "Europe/Kyiv";

function parts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute) };
}

/** Зсув пояса від UTC у хвилинах на цей момент. */
function offsetMinutes(date: Date, tz: string): number {
  const p = parts(date, tz);
  return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000;
}

export function safeTz(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** «2026-10-29» за часом людини. */
export function localDay(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Момент «день, година:хвилина» за часом людини → UTC. */
export function localTime(day: string, hour: number, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, 0));
  return new Date(guess.getTime() - offsetMinutes(guess, tz) * 60_000);
}

/** Межі доби людини в UTC: [початок, кінець). */
export function dayBounds(day: string, tz: string): [string, string] {
  const start = localTime(day, 0, tz);
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDay = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return [start.toISOString(), localTime(nextDay, 0, tz).toISOString()];
}

/** Прийом їжі за годиною людини — ті самі межі, що slotAt у застосунку. */
export function localSlot(date: Date, tz: string): MealSlot {
  const h = parts(date, tz).h;
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 16) return "lunch";
  if (h >= 16 && h < 22) return "dinner";
  return "snack";
}

const SLOT_HOUR: Record<MealSlot, number> = { breakfast: 8, lunch: 13, dinner: 19, snack: 16 };

/** Коли зʼїли: сьогодні — зараз; інший день — типова година прийому. */
export function eatenAt(day: string, slot: MealSlot, tz: string, now = new Date()): string {
  if (day === localDay(now, tz)) return now.toISOString();
  return localTime(day, SLOT_HOUR[slot], tz).toISOString();
}
