"use client";

/*
 * Спільний каталог товарів: картки, ідентифікатори, історія, вікі-правка типів
 * і обʼєднання (I3–I6). Усе, що ходить у спільні таблиці.
 *
 * Окремо від api.ts свідомо: там особисте (рецепти, комора, сімʼя), тут —
 * вікі, де кожен запис іде через security definer RPC з версією й бюджетом
 * змін і кидає CatalogError. Комора по id (upsertPantryItems, deletePantryItems,
 * deletePantryType) живе в api.ts разом із рештою особистих даних; сюди йде
 * лише один напрямок імпорту (products-api → api), без кола.
 *
 * Правила файлу:
 * - з products ніколи не `select *`: читати дозволено лише окремі колонки
 *   (автор і час створення закриті), і зірочка впала б 42501. Тому переліки
 *   колонок виведені з типів рядків, як PANTRY_SELECT в api.ts;
 * - писати в спільні таблиці — лише через security definer RPC з номером
 *   версії; нормалізацію (normalize_ean, receipt_name_key, receipt_scope)
 *   рахує тільки база: клієнт шле сирі стрічки й slug мережі;
 * - помилки каталогу виходять звідси як CatalogError з людським повідомленням;
 *   запис комори кидає сирі помилки PostgREST, як і решта api.ts, — їх
 *   показує шина помилок sync.
 *
 * ── Контракт SQL (назви аргументів мусять збігатися дослівно) ─────────────
 *   resolve_identifiers(p_eans text[], p_names text[], p_seller text default null, p_chain text default null)
 *     → table (kind, raw, identifier_id, scope, product_id, type_key, version)
 *   search_products(p_query text, p_type_keys text[] default null, p_limit int default 20)
 *     → table (id, type_key, name, brand, fat_pct, pack_amount, pack_unit, grams_per_piece,
 *              kcal, protein, fat, carbs, image_url, source, archived, merged_into, version, updated_at)
 *   save_product(p_id uuid, p_expected_version int, p_card jsonb)
 *     → jsonb {status: 'created' | 'updated' | 'duplicate', product: {…колонки PRODUCT_SELECT}}
 *     p_card завжди несе всі 13 ключів (null = порожньо): type_key, name, brand, fat_pct,
 *     pack_amount, pack_unit, grams_per_piece, kcal, protein, fat, carbs, image_url, source
 *   set_product_archived(p_id uuid, p_expected_version int, p_archived boolean) → jsonb product
 *   teach_identifiers(p_items jsonb, p_seller text default null, p_chain text default null)
 *     → jsonb [{kind, raw, status, identifier_id, scope, product_id, type_key, version}]
 *     p_items: [{kind, raw, product_id?, type_key?, source, only_if_unknown?}], ≤ 60 (ділимо тут)
 *   reassign_identifier(p_id uuid, p_expected_version int, p_product_id uuid, p_type_key text)
 *     → jsonb {…колонки IDENTIFIER_SELECT}
 *   delete_identifier(p_id uuid, p_expected_version int) → void
 *   community_history(p_table text, p_row_id text, p_limit int default 50)
 *     → table (id, op, changed_at, actor_name, before, after, reverted_from)
 *   restore_community_version(p_change_id bigint, p_expected_version int) → будь-що (ігноруємо)
 *   save_custom_ingredient(p_key text, p_expected_version int, p_def jsonb)
 *     → jsonb {…колонки CUSTOM_INGREDIENT_SELECT з api.ts, зокрема parent_key, version}
 *     p_def завжди несе: label, emoji, cat, aliases, staple, grams_per_piece, grams_per_cup,
 *     default_unit, kcal, protein, fat, carbs, parent_key
 *   similar_receipt_names(p_names text[], p_seller text default null, p_chain text default null)   (I5)
 *     → table (raw, identifier_id, value, similarity, product_id)
 *   merge_products(p_loser uuid, p_winner uuid) → будь-що (ігноруємо)                               (I6)
 *   unmerge_product(p_loser uuid) → будь-що                                                          (I6)
 *   merge_custom_ingredients(p_loser text, p_winner text) → будь-що                                  (I6)
 *   unmerge_custom_ingredient(p_loser text) → будь-що                                                (I6)
 *   Відповідь-обʼєкт може бути й масивом з одного рядка (returns table/setof) — розгортаємо.
 *
 * ── Коди помилок → CatalogError.code ──────────────────────────────────────
 *   hint catalog_conflict або 40001 → conflict      hint catalog_rate_limit → rate_limit
 *   hint duplicate або 23505        → duplicate     23503                   → missing_type
 *   42501, 28000, PGRST301/302      → denied        P0002                   → not_found
 *   22023, 23514, 22P02, 23502, 22001, 22003 → invalid
 *   мережа, AbortError, офлайн, немає бекенду → offline   NYAM_STALE_CLIENT → stale
 */

import { getSupabase, friendlyError } from "./client";
import { isUuid, rowToIngredient, type CustomIngredientRow } from "./api";
import { STALE_WRITE_CODE, STALE_WRITE_MESSAGE } from "../schema-version";
import type { IngredientDef } from "@/lib/types";
import {
  CatalogError,
  isCatalogError,
  type CatalogErrorCode,
  type CommunityChange,
  type CommunityOp,
  type CommunityTable,
  type IdentifierHit,
  type IdentifierKind,
  type IdentifierSource,
  type PackUnit,
  type Product,
  type ProductDraft,
  type ProductIdentifier,
  type ProductSource,
  type SaveProductResult,
  type SimilarNameHit,
  type Target,
  type TeachItem,
  type TeachResult,
  type VersionedIngredient,
} from "@/lib/product-types";

/* ── Дрібниці ─────────────────────────────────────────────────────────── */

/** Той самий, що в api.ts: реекспорт, бо екрани каталогу беруть його звідси. */
export { isUuid };

/** numeric з PostgREST буває рядком, а з jsonb — числом. Зводимо до числа або нічого. */
function num(value: number | string | null | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const text = (value: string | null | undefined): string | undefined => (value == null || value === "" ? undefined : value);

/** RPC з `returns table` віддає масив, з `returns jsonb` — обʼєкт. Контракт дозволяє обидва. */
function one<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return (data as T | null) ?? null;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const uniq = <T,>(list: Iterable<T>): T[] => [...new Set(list)];

/* ── Помилки ──────────────────────────────────────────────────────────── */

const DEFAULT_MESSAGE: Record<CatalogErrorCode, string> = {
  conflict: "Картку щойно змінив хтось інший — ось свіжа версія. Внеси свою правку ще раз.",
  rate_limit: "Забагато змін поспіль — спробуй за кілька хвилин.",
  duplicate: "Така картка вже є.",
  missing_type: "Такого типу вже немає — онови застосунок і обери тип ще раз.",
  denied: "Недостатньо прав для цієї дії.",
  not_found: "Цієї картки чи версії вже немає.",
  invalid: "Щось із даними не так — перевір поля.",
  offline: "Немає звʼязку з сервером — спробуй, коли зʼявиться інтернет.",
  stale: STALE_WRITE_MESSAGE,
  other: "Щось пішло не так.",
};

const INVALID_CODES = new Set(["22023", "23514", "22P02", "23502", "22001", "22003"]);

/**
 * Зводить будь-яку помилку запиту до CatalogError.
 *
 * Спершу hint, потім код: той самий 40001 чи P0001 різні RPC кидають з різних
 * причин, а hint ми ставимо свідомо. Повідомлення беремо з бази, коли воно
 * українське (наші raise пишуть людською мовою), — інакше стале для коду:
 * англійське «duplicate key value violates…» людині нічого не скаже.
 */
export function toCatalogError(error: unknown): CatalogError {
  if (isCatalogError(error)) return error;
  const e = (typeof error === "object" && error ? error : {}) as {
    code?: unknown;
    hint?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const pgCode = e.code == null ? "" : String(e.code);
  const hint = e.hint == null ? "" : String(e.hint);
  const message = e.message == null ? String(error ?? "") : String(e.message);

  let code: CatalogErrorCode;
  if (pgCode === STALE_WRITE_CODE) code = "stale";
  else if (hint === "catalog_conflict" || pgCode === "40001") code = "conflict";
  else if (hint === "catalog_rate_limit") code = "rate_limit";
  else if (hint === "duplicate" || pgCode === "23505") code = "duplicate";
  else if (pgCode === "23503") code = "missing_type";
  else if (pgCode === "42501" || pgCode === "28000" || pgCode === "PGRST301" || pgCode === "PGRST302") code = "denied";
  else if (pgCode === "P0002") code = "not_found";
  else if (INVALID_CODES.has(pgCode)) code = "invalid";
  else if (
    e.name === "AbortError" ||
    e.name === "TimeoutError" ||
    /failed to fetch|networkerror|load failed|network request failed|aborterror|timeouterror/i.test(message) ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  )
    code = "offline";
  else code = "other";

  // friendlyError знає наші тексти запобіжників («Задовгий ланцюжок…» → людське).
  const ukrainian = /[а-яіїєґ]/i.test(message) ? friendlyError(error) : null;
  const human =
    code === "stale" || code === "offline" || code === "missing_type"
      ? DEFAULT_MESSAGE[code]
      : ukrainian ?? (code === "other" ? friendlyError(error) : DEFAULT_MESSAGE[code]);
  return new CatalogError(code, human, pgCode || undefined, hint || undefined);
}

/**
 * Один виклик RPC каталогу. Без бекенду — `offline`: локальний режим не
 * повинен сюди доходити (resolve.ts повертає `{via:"none"}` раніше), а якщо
 * дійшов, краще чесна помилка «немає звʼязку», ніж тихо порожня відповідь.
 */
async function call<T>(fn: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const sb = getSupabase();
  if (!sb) throw new CatalogError("offline", DEFAULT_MESSAGE.offline);
  try {
    const { data, error } = await (signal ? sb.rpc(fn, args).abortSignal(signal) : sb.rpc(fn, args));
    if (error) throw error;
    return data as T;
  } catch (error) {
    throw toCatalogError(error);
  }
}

/* ── Товари ───────────────────────────────────────────────────────────── */

/** Рядок products — рівно ті колонки, які клієнту дозволено читати (без search_key: він для індексу). */
interface ProductRow {
  id: string;
  type_key: string;
  name: string;
  brand: string | null;
  fat_pct: number | string | null;
  pack_amount: number | string | null;
  pack_unit: string | null;
  grams_per_piece: number | string | null;
  kcal: number | string | null;
  protein: number | string | null;
  fat: number | string | null;
  carbs: number | string | null;
  image_url: string | null;
  source: string;
  archived: boolean;
  merged_into: string | null;
  version: number;
  updated_at: string;
}

const PRODUCT_COLUMNS = {
  id: true,
  type_key: true,
  name: true,
  brand: true,
  fat_pct: true,
  pack_amount: true,
  pack_unit: true,
  grams_per_piece: true,
  kcal: true,
  protein: true,
  fat: true,
  carbs: true,
  image_url: true,
  source: true,
  archived: true,
  merged_into: true,
  version: true,
  updated_at: true,
} satisfies Record<keyof ProductRow, true>;

/** Експортовано для npm run db:check: кожна колонка мусить бути і в таблиці, і в grant select. */
export const PRODUCT_SELECT = Object.keys(PRODUCT_COLUMNS).join(",");

const PACK_UNITS = new Set<string>(["g", "kg", "ml", "l", "pcs"]);
const PRODUCT_SOURCES = new Set<string>(["user", "off", "receipt", "migration"]);

export function rowToProduct(row: ProductRow): Product {
  const kcal = num(row.kcal);
  const packAmount = num(row.pack_amount);
  const packUnit = row.pack_unit && PACK_UNITS.has(row.pack_unit) ? (row.pack_unit as PackUnit) : undefined;
  return {
    id: row.id,
    typeKey: row.type_key,
    name: row.name,
    brand: text(row.brand),
    fatPct: num(row.fat_pct),
    // Упаковка лише парою: число без одиниці нічого не каже (products_pack_pair).
    ...(packAmount != null && packUnit ? { packAmount, packUnit } : {}),
    gramsPerPiece: num(row.grams_per_piece),
    nutrition:
      kcal != null
        ? { kcal, protein: num(row.protein) ?? 0, fat: num(row.fat) ?? 0, carbs: num(row.carbs) ?? 0 }
        : undefined,
    image: text(row.image_url),
    source: PRODUCT_SOURCES.has(row.source) ? (row.source as ProductSource) : "user",
    archived: Boolean(row.archived),
    mergedInto: text(row.merged_into),
    version: Number(row.version) || 1,
    updatedAt: row.updated_at,
  };
}

/**
 * Картка для p_card. Усі ключі завжди на місці, порожнє — null: правка, що
 * стерла виробника, мусить його стерти, а не лишити старий через «ключа не було».
 */
export function draftToCard(draft: ProductDraft): Record<string, unknown> {
  const trim = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim() || null;
  const pack = draft.packAmount != null && draft.packAmount > 0 && draft.packUnit;
  return {
    type_key: draft.typeKey,
    name: trim(draft.name),
    brand: trim(draft.brand),
    fat_pct: draft.fatPct ?? null,
    pack_amount: pack ? draft.packAmount : null,
    pack_unit: pack ? draft.packUnit : null,
    grams_per_piece: draft.gramsPerPiece ?? null,
    kcal: draft.nutrition?.kcal ?? null,
    protein: draft.nutrition ? draft.nutrition.protein : null,
    fat: draft.nutrition ? draft.nutrition.fat : null,
    carbs: draft.nutrition ? draft.nutrition.carbs : null,
    image_url: draft.image && /^https:\/\//.test(draft.image) ? draft.image : null,
    source: draft.source ?? "user",
  };
}

/**
 * Картки за id — для кешу товарів у сторі.
 *
 * Шматками по 100: довгий `in (…)` не влазить в адресу запиту. Обʼєднані
 * картки тягнуть за собою переможця другим запитом — інакше рядок комори з
 * переможеною карткою показав би стару назву. Обʼєднання сплющує ланцюжки,
 * тож одного кроку досить. Повертає і запитані, і переможців.
 *
 * `signal` — межа очікування скану (B1, 4 с): без неї запит, що завис на
 * напівмертвому зʼєднанні, тримав би «Шукаю товар» хвилинами.
 */
export async function fetchProductsByIds(ids: Iterable<string>, signal?: AbortSignal): Promise<Product[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const load = async (list: string[]) => {
    const parts = await Promise.all(
      chunks(list, 100).map((part) => {
        const query = sb.from("products").select(PRODUCT_SELECT).in("id", part);
        return signal ? query.abortSignal(signal) : query;
      }),
    );
    const failed = parts.find((r) => r.error);
    if (failed?.error) throw toCatalogError(failed.error);
    return parts.flatMap((r) => ((r.data ?? []) as unknown as ProductRow[]).map(rowToProduct));
  };

  const wanted = uniq([...ids].filter(isUuid));
  if (wanted.length === 0) return [];
  const found = await load(wanted);
  const have = new Set(found.map((p) => p.id));
  const winners = uniq(found.map((p) => p.mergedInto).filter((id): id is string => !!id && !have.has(id)));
  return winners.length ? [...found, ...(await load(winners))] : found;
}

/**
 * Пошук карток для пікера і «Можливо, це вже є:». Менше двох літер — без
 * запиту: база однаково нічого не знайде. `typeKeys` — тип із предками й
 * різновидами, їх рахує той, хто кличе (ancestors/descendants).
 */
export async function searchProducts(
  query: string,
  typeKeys?: readonly string[] | null,
  limit = 20,
  signal?: AbortSignal,
): Promise<Product[]> {
  if (query.trim().length < 2) return [];
  const rows = await call<ProductRow[] | null>(
    "search_products",
    { p_query: query, p_type_keys: typeKeys?.length ? [...typeKeys] : null, p_limit: limit },
    signal,
  );
  return (rows ?? []).map(rowToProduct);
}

/**
 * Створює (`id` = null) або правує картку.
 *
 * `duplicate` — не помилка, а відповідь: такий товар уже є, і людину
 * спитають «Це він?». Застаріла версія — CatalogError `conflict`.
 */
export async function saveProduct(
  id: string | null,
  expectedVersion: number | null,
  draft: ProductDraft,
): Promise<SaveProductResult> {
  const data = one<{ status: string; product: ProductRow }>(
    await call("save_product", { p_id: id, p_expected_version: expectedVersion, p_card: draftToCard(draft) }),
  );
  if (!data?.product) throw new CatalogError("other", DEFAULT_MESSAGE.other);
  const status = data.status === "duplicate" ? "duplicate" : data.status === "updated" ? "updated" : "created";
  return { status, product: rowToProduct(data.product) };
}

/** «Прибрати картку для всіх» і «Повернути». Комори не чіпає. */
export async function setProductArchived(id: string, expectedVersion: number, archived: boolean): Promise<Product> {
  const row = one<ProductRow>(
    await call("set_product_archived", { p_id: id, p_expected_version: expectedVersion, p_archived: archived }),
  );
  if (!row) throw new CatalogError("not_found", DEFAULT_MESSAGE.not_found);
  return rowToProduct(row);
}

/* ── Ідентифікатори ───────────────────────────────────────────────────── */

interface IdentifierRow {
  id: string;
  kind: string;
  scope: string;
  raw: string;
  value: string;
  product_id: string | null;
  type_key: string | null;
  source: string;
  version: number;
}

const IDENTIFIER_COLUMNS = {
  id: true,
  kind: true,
  scope: true,
  raw: true,
  value: true,
  product_id: true,
  type_key: true,
  source: true,
  version: true,
} satisfies Record<keyof IdentifierRow, true>;

/** Для npm run db:check: без автора й часу — їх grant не дає (приватність покупок). */
export const IDENTIFIER_SELECT = Object.keys(IDENTIFIER_COLUMNS).join(",");

function targetOf(row: { product_id?: string | null; type_key?: string | null }): Target | null {
  if (row.product_id) return { productId: row.product_id };
  if (row.type_key) return { typeKey: row.type_key };
  return null;
}

const kindOf = (value: string): IdentifierKind => (value === "ean" ? "ean" : "receipt_name");

function rowToIdentifier(row: IdentifierRow): ProductIdentifier | null {
  const target = targetOf(row);
  if (!target) return null;
  return {
    id: row.id,
    kind: kindOf(row.kind),
    scope: row.scope ?? "",
    raw: row.raw,
    value: row.value,
    target,
    source: row.source as IdentifierSource,
    version: Number(row.version) || 1,
  };
}

/** «Як його впізнати» на картці: штрихкоди й назви з чеків цих карток. */
export async function fetchProductIdentifiers(productIds: string | readonly string[]): Promise<ProductIdentifier[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const ids = uniq((typeof productIds === "string" ? [productIds] : [...productIds]).filter(isUuid));
  if (ids.length === 0) return [];
  const parts = await Promise.all(
    chunks(ids, 100).map((part) =>
      sb.from("product_identifiers").select(IDENTIFIER_SELECT).in("product_id", part).order("kind").order("raw"),
    ),
  );
  const failed = parts.find((r) => r.error);
  if (failed?.error) throw toCatalogError(failed.error);
  return parts
    .flatMap((r) => (r.data ?? []) as unknown as IdentifierRow[])
    .map(rowToIdentifier)
    .filter((x): x is ProductIdentifier => x !== null);
}

/**
 * Що база знає про ці штрихкоди й назви з чека — один запит на весь чек.
 *
 * `seller` — сира назва продавця з чека, `chain` — chainOf(seller); область
 * рахує сама база. Порожні списки — без запиту. Відповідь зводиться з
 * рядками за `raw`, тож стрічки шлемо рівно такими, як вони в рядку.
 */
export async function resolveIdentifiers(
  eans: readonly string[],
  names: readonly string[],
  seller?: string | null,
  chain?: string | null,
  signal?: AbortSignal,
): Promise<IdentifierHit[]> {
  const pEans = uniq(eans.filter(Boolean)).slice(0, 200);
  const pNames = uniq(names.filter(Boolean)).slice(0, 200);
  if (pEans.length === 0 && pNames.length === 0) return [];
  const rows = await call<Array<{
    kind: string;
    raw: string;
    identifier_id: string;
    scope: string;
    product_id: string | null;
    type_key: string | null;
    version: number;
  }> | null>(
    "resolve_identifiers",
    { p_eans: pEans, p_names: pNames, p_seller: seller ?? null, p_chain: chain ?? null },
    signal,
  );
  const hits: IdentifierHit[] = [];
  for (const row of rows ?? []) {
    const target = targetOf(row);
    if (!target) continue;
    hits.push({
      kind: kindOf(row.kind),
      raw: row.raw,
      identifierId: row.identifier_id,
      scope: row.scope ?? "",
      target,
      version: Number(row.version) || 1,
    });
  }
  return hits;
}

/**
 * Вчить базу: вставити, якщо такого ще немає; чуже ніколи не переписує.
 *
 * Шматками по 60 (стеля RPC) і по черзі — щоб бюджет змін рахувався чесно.
 * Результати йдуть у порядку `items`, якщо база їх так віддає.
 */
export async function teachIdentifiers(
  items: readonly TeachItem[],
  seller?: string | null,
  chain?: string | null,
): Promise<TeachResult[]> {
  const out: TeachResult[] = [];
  for (const part of chunks(items, 60)) {
    const rows = await call<Array<{
      kind: string;
      raw: string;
      status: string;
      identifier_id: string | null;
      scope: string | null;
      product_id: string | null;
      type_key: string | null;
      version: number | null;
    }> | null>("teach_identifiers", {
      p_items: part.map((item) => ({
        kind: item.kind,
        raw: item.raw,
        ...(item.product_id ? { product_id: item.product_id } : {}),
        ...(item.type_key ? { type_key: item.type_key } : {}),
        source: item.source,
        ...(item.only_if_unknown ? { only_if_unknown: true } : {}),
      })),
      p_seller: seller ?? null,
      p_chain: chain ?? null,
    });
    for (const row of rows ?? []) {
      const status = (["inserted", "same", "conflict", "skipped", "invalid"] as const).find((s) => s === row.status);
      out.push({
        kind: kindOf(row.kind),
        raw: row.raw,
        status: status ?? "invalid",
        identifierId: text(row.identifier_id),
        scope: row.scope ?? undefined,
        target: targetOf(row) ?? undefined,
        version: row.version ?? undefined,
      });
    }
  }
  return out;
}

/** «Виправити для всіх» і автоматичне уточнення тип → товар. Застаріла версія — `conflict`. */
export async function reassignIdentifier(
  id: string,
  expectedVersion: number,
  target: Target,
): Promise<ProductIdentifier> {
  const row = one<IdentifierRow>(
    await call("reassign_identifier", {
      p_id: id,
      p_expected_version: expectedVersion,
      p_product_id: "productId" in target ? target.productId : null,
      p_type_key: "typeKey" in target ? target.typeKey : null,
    }),
  );
  const identifier = row ? rowToIdentifier(row) : null;
  if (!identifier) throw new CatalogError("not_found", DEFAULT_MESSAGE.not_found);
  return identifier;
}

/** «Прибрати «МолокГалБезл900»». Пишеться в історію, повернути можна. */
export async function deleteIdentifier(id: string, expectedVersion: number): Promise<void> {
  await call("delete_identifier", { p_id: id, p_expected_version: expectedVersion });
}

/** Схожі назви з чеків (I5) — лише для «Схоже на: …», ніколи не як впізнане. */
export async function similarReceiptNames(
  names: readonly string[],
  seller?: string | null,
  chain?: string | null,
  signal?: AbortSignal,
): Promise<SimilarNameHit[]> {
  const pNames = uniq(names.filter(Boolean)).slice(0, 40);
  if (pNames.length === 0) return [];
  const rows = await call<Array<{
    raw: string;
    identifier_id: string;
    value: string;
    similarity: number | string;
    product_id: string;
  }> | null>(
    "similar_receipt_names",
    { p_names: pNames, p_seller: seller ?? null, p_chain: chain ?? null },
    signal,
  );
  return (rows ?? [])
    .filter((row) => row.product_id)
    .map((row) => ({
      raw: row.raw,
      identifierId: row.identifier_id,
      value: row.value,
      similarity: num(row.similarity) ?? 0,
      productId: row.product_id,
    }));
}

/* ── Історія ──────────────────────────────────────────────────────────── */

const COMMUNITY_OPS = new Set<string>(["insert", "update", "delete", "merge", "unmerge"]);

/** Історія одного рядка, новіші зверху. */
export async function fetchCommunityHistory(
  table: CommunityTable,
  rowId: string,
  limit = 50,
): Promise<CommunityChange[]> {
  const rows = await call<Array<{
    id: number | string;
    op: string;
    changed_at: string;
    actor_name: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reverted_from: number | string | null;
  }> | null>("community_history", { p_table: table, p_row_id: rowId, p_limit: limit });
  return (rows ?? []).map((row) => ({
    id: Number(row.id),
    op: (COMMUNITY_OPS.has(row.op) ? row.op : "update") as CommunityOp,
    changedAt: row.changed_at,
    actorName: row.actor_name ?? null,
    before: row.before ?? null,
    after: row.after ?? null,
    revertedFrom: row.reverted_from == null ? null : Number(row.reverted_from),
  }));
}

/**
 * «Повернути цю версію»: рядок стає рівним `after` цього запису.
 * `expectedVersion` — поточна версія рядка, яку бачить екран; після успіху
 * екран перечитує картку сам.
 */
export async function restoreCommunityVersion(changeId: number, expectedVersion: number): Promise<void> {
  await call("restore_community_version", { p_change_id: changeId, p_expected_version: expectedVersion });
}

/* ── Дописані типи (вікі-правка) ──────────────────────────────────────── */

/**
 * Правка дописаного типу для всіх — з історією. Створення лишається прямим
 * insert-ом (api.ts upsertCustomIngredient): так пишуть і старі клієнти.
 * Цикл чи задовгий ланцюжок різновидів — `invalid` з людським текстом.
 */
export async function saveCustomIngredient(
  key: string,
  expectedVersion: number,
  def: IngredientDef,
): Promise<VersionedIngredient> {
  const row = one<CustomIngredientRow>(
    await call("save_custom_ingredient", {
      p_key: key,
      p_expected_version: expectedVersion,
      p_def: {
        label: def.label,
        emoji: def.emoji,
        cat: def.cat,
        aliases: def.aliases ?? [],
        staple: def.staple ?? false,
        grams_per_piece: def.gramsPerPiece ?? null,
        grams_per_cup: def.gramsPerCup ?? null,
        default_unit: def.defaultUnit ?? "g",
        kcal: def.nutrition?.kcal ?? null,
        protein: def.nutrition ? def.nutrition.protein : null,
        fat: def.nutrition ? def.nutrition.fat : null,
        carbs: def.nutrition ? def.nutrition.carbs : null,
        parent_key: def.parent ?? null,
      },
    }),
  );
  if (!row) throw new CatalogError("not_found", DEFAULT_MESSAGE.not_found);
  // Той самий розбір, що й для каталогу з бази: версія потрібна наступній правці.
  const ingredient = rowToIngredient(row);
  return { ...ingredient, version: ingredient.version ?? 1 };
}

/* ── Обʼєднання (I6) ──────────────────────────────────────────────────── */

/** Штрихкоди, назви й комори переходять до `winner`. Несумісні типи — `invalid`. */
export async function mergeProducts(loser: string, winner: string): Promise<void> {
  await call("merge_products", { p_loser: loser, p_winner: winner });
}

/** Розʼєднати: повертає лише ті ідентифікатори, що переїхали при обʼєднанні. Комори лишаються з переможцем. */
export async function unmergeProduct(loser: string): Promise<void> {
  await call("unmerge_product", { p_loser: loser });
}

/**
 * Тип own_* стає псевдонімом іншого; рецепти зі старим ключем читаються як новий.
 * Несумісні типи (не той самий, не загальніший і не з одним батьком) — `invalid`.
 */
export async function mergeCustomIngredients(loser: string, winner: string): Promise<void> {
  await call("merge_custom_ingredients", { p_loser: loser, p_winner: winner });
}

/**
 * Розʼєднати тип: назад переїжджає рівно те, що переїхало при останньому
 * обʼєднанні й досі там, — картки, коди, рядки комори й списку, різновиди.
 */
export async function unmergeCustomIngredient(loser: string): Promise<void> {
  await call("unmerge_custom_ingredient", { p_loser: loser });
}

/**
 * Картки, обʼєднані з цією (merged_into = id). Переможену картку після
 * обʼєднання вже нізвідки не відкрити — усі шляхи ведуть до переможця, тож
 * «Розʼєднати» мусить жити на ньому.
 */
export async function fetchMergedProducts(winnerId: string): Promise<Product[]> {
  const sb = getSupabase();
  if (!sb || !isUuid(winnerId)) return [];
  const { data, error } = await sb.from("products").select(PRODUCT_SELECT).eq("merged_into", winnerId).limit(50);
  if (error) throw toCatalogError(error);
  return ((data ?? []) as unknown as ProductRow[]).map(rowToProduct);
}

/**
 * Ідентифікатори з рівно такою сирою стрічкою — у будь-якій області.
 *
 * Для «Не той товар?» на рядку з назвою з каси: чек навчив її в області
 * магазину (m:atb), а виправлення з комори магазину вже не знає й пише
 * глобально — там конфлікту немає, і хибна привʼязка магазину лишилась би
 * мовчки. Шукаємо за raw, бо value (receipt_name_key) рахує лише база, а
 * рядок комори несе рівно ту стрічку, яку тоді вчили.
 */
export async function fetchIdentifiersByRaw(kind: IdentifierKind, raw: string): Promise<ProductIdentifier[]> {
  const sb = getSupabase();
  if (!sb || !raw) return [];
  const { data, error } = await sb
    .from("product_identifiers")
    .select(IDENTIFIER_SELECT)
    .eq("kind", kind)
    .eq("raw", raw)
    .limit(20);
  if (error) throw toCatalogError(error);
  return ((data ?? []) as unknown as IdentifierRow[])
    .map(rowToIdentifier)
    .filter((x): x is ProductIdentifier => x !== null);
}
