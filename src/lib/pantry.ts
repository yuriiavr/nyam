import { CAT_ORDER, canonicalKey, ing, lineage, satisfies, typeDepth, typeDistance } from "@/data/ingredients";
import { ingredientGrams } from "./nutrition";
import { receiptDisplayName } from "./product-hints";
import type { Product } from "./product-types";
import { packGrams } from "./products";
import { isLegacyId, legacyKey } from "./store-migrations";
import type { IngredientCat, PantryItem, Recipe, Unit } from "./types";
import { formatQuantity, sumQuantities, unitDef, type SummedQuantity } from "./units";
import { dateKey, newId } from "./utils";

export { shortProductName } from "./products";

/**
 * Комора «по товару» (D): один рядок — одна покупка, зі своїм id.
 *
 * Чисті функції без стора й мережі: стекування нової пачки, підсумки груп,
 * списання після готування і перепривʼязка тимчасових id після першого знімка.
 *
 * Комора має відповідати холодильнику, а не історії покупок: якщо на сік
 * пішло 200 мл, у літровій пачці лишається 800, а не літр. Без цього підбір
 * рецептів за вмістом холодильника з часом починає брехати.
 *
 * Спільне правило: рядок упізнаємо ЛИШЕ за id. Ключ типу — не особа рядка: у
 * коморі може бути і Галичина, і Молокія, обидві «Молоко».
 */

/** Кеш карток зі стору: id → картка. Порожній — рядки рахуються за типом. */
export type ProductCache = Readonly<Record<string, Product>>;

const NO_PRODUCTS: ProductCache = {};

/* ── Дрібні помічники ─────────────────────────────────────────────────── */

/**
 * «Базовий продукт» без жодних подробиць: «Сіль» із «Основного».
 * Такий рядок не множиться — дві солі в сімʼї це одна сіль, а не дві пачки.
 */
export function isBareStaple(row: PantryItem): boolean {
  return !row.productId && row.amount == null && !row.label && !row.receiptName;
}

/**
 * Назва рядка для людей (D1): картка товару → вільна назва → назва, складена з
 * касового рядка → назва типу. Сирий текст каси («Мол950УлГаличБЛак2.5»)
 * людям не показуємо ніколи: це приватне «звідки», а не назва.
 */
export function pantryDisplayName(item: PantryItem, products: ProductCache = NO_PRODUCTS): string {
  const product = item.productId ? products[item.productId]?.name : undefined;
  if (product) return product;
  if (item.label) return item.label;
  if (item.receiptName) return receiptDisplayName(item.receiptName, item.key);
  return ing(item.key).label;
}

const squeeze = (s: string | undefined) => (s ?? "").toLocaleLowerCase("uk").replace(/\s+/g, " ").trim();

/** Місцевий день із мітки часу; null — мітка не читається. */
function dayOf(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? dateKey(new Date(t)) : null;
}

/** Та сама мить, хоч би як її записали: база віддає «+00:00», клієнт — «.000Z». */
function sameInstant(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : a === b;
}

const byTime = (a: string, b: string) => {
  const d = (Date.parse(a) || 0) - (Date.parse(b) || 0);
  return d || (a < b ? -1 : a > b ? 1 : 0);
};

/* ── Вага рядка ───────────────────────────────────────────────────────── */

/**
 * Скільки грамів у рядку комори. null — кількість не вказана або не
 * переводиться (штуки продукту, чия вага невідома).
 *
 * Спільний знаменник для підсумків, ціни й списання: у коморі «1 л», у
 * рецепті «1 склянка». Мл рахуємо як грами — так само, як nutrition.ts.
 * Для штук товар знає більше за тип (D8): «2 шт» пачки 900 мл — це 1800, а не
 * вага «середньої штуки молока», якої не існує. Далі — тип і його предки
 * (typeValue всередині ingredientGrams).
 */
export function rowGrams(row: PantryItem, products: ProductCache = NO_PRODUCTS): number | null {
  if (row.amount == null || !row.unit) return null;
  if (row.unit === "pcs" && row.productId) {
    const product = products[row.productId];
    const perPiece = product ? product.gramsPerPiece ?? (product.packUnit === "pcs" ? null : packGrams(product)) : null;
    if (perPiece) return row.amount * perPiece;
  }
  return ingredientGrams({ key: row.key, amount: row.amount, unit: row.unit });
}

/**
 * Типова одиниця з урахуванням предків: дописаний різновид без неї міряють як
 * батька. defaultUnit не входить у typeValue, тож ідемо родоводом самі.
 */
function typeValueUnit(key: string): Unit {
  for (const k of lineage(key)) {
    const unit = ing(k).defaultUnit;
    if (unit) return unit;
  }
  return "g";
}

/**
 * Разом у «родині» типової одиниці типу: молоко — в мл/л, борошно — в г/кг.
 * Лише коли всі рядки переводяться в грами, а тип міряють вагою чи обʼємом:
 * яйця («10 шт») чесніше показати штуками, ніж «600 г».
 */
function totalOf(rows: PantryItem[], typeKey: string, products: ProductCache): SummedQuantity[] {
  const measured = rows.filter((r) => r.amount != null && r.unit);
  if (!measured.length) return [];
  const base = unitDef(typeValueUnit(typeKey)).base;
  const grams = measured.map((r) => rowGrams(r, products));
  if ((base === "g" || base === "ml") && grams.every((g) => g != null)) {
    const sum = (grams as number[]).reduce((a, b) => a + b, 0);
    const [total] = sumQuantities([{ amount: sum, unit: base }]);
    return [{ ...total, amount: Number((total.amount ?? 0).toFixed(unitDef(total.unit).decimals)) }];
  }
  return sumQuantities(measured.map((r) => ({ amount: r.amount, unit: r.unit as Unit })));
}

/* ── Стекування (D6) ──────────────────────────────────────────────────── */

export interface StackResult {
  pantry: PantryItem[];
  /** Рядок, у який лягла покупка: новий, доповнений або замінений. */
  rowId: string;
  /** Той рядок до зміни; null — рядок новий. Для «Скасувати» в ScanResultSheet (F5). */
  before: PantryItem | null;
}

/** Тип товару перемагає: рецепти збігаються за key, і він мусить бути типом картки. */
function syncType(row: PantryItem, products: ProductCache): PantryItem {
  const typeKey = row.productId ? products[row.productId]?.typeKey : undefined;
  return typeKey && typeKey !== row.key ? { ...row, key: typeKey } : row;
}

/** Змінений рядок із тимчасовим id: у базу не піде, але перший знімок донесе правку. */
function markLegacy(row: PantryItem): PantryItem {
  return isLegacyId(row.id) && !row.legacyDirty ? { ...row, legacyDirty: true } : row;
}

/** Одна й та сама річ: той самий товар або той самий тип під тією самою назвою. */
function sameIdentity(a: PantryItem, b: PantryItem, products: ProductCache): boolean {
  if (a.productId || b.productId) return a.productId === b.productId;
  if (a.key !== b.key) return false;
  if (squeeze(pantryDisplayName(a, products)) !== squeeze(pantryDisplayName(b, products))) return false;
  /*
   * Різні рядки каси одного типу («…Галич…» і «…Молокія…») можуть скластися
   * в ту саму назву — скажімо, коли підказка не впізнала бренду й лишила
   * «Молоко». Злиття загубило б одну з пачок разом із доказом для «Уточнити
   * товар», тож касові рядки мусять збігтися дослівно.
   */
  return !a.receiptName || !b.receiptName || squeeze(a.receiptName) === squeeze(b.receiptName);
}

/** Сума двох кількостей, якщо вона одна чесна; інакше null. Обидві порожні — теж «одна». */
function summedPair(a: PantryItem, b: PantryItem): { amount?: number; unit?: Unit } | null {
  const aHas = a.amount != null && !!a.unit;
  const bHas = b.amount != null && !!b.unit;
  if (!aHas && !bHas) return a.amount == null && b.amount == null ? { unit: a.unit ?? b.unit } : null;
  if (!aHas || !bHas) return null;
  const sum = sumQuantities([
    { amount: a.amount, unit: a.unit as Unit },
    { amount: b.amount, unit: b.unit as Unit },
  ]);
  if (sum.length !== 1 || sum[0].amount == null) return null;
  return { amount: Number(sum[0].amount.toFixed(unitDef(sum[0].unit).decimals)), unit: sum[0].unit };
}

function mergeRows(existing: PantryItem, incoming: PantryItem, products: ProductCache): PantryItem | null {
  const quantity = summedPair(existing, incoming);
  if (!quantity) return null;

  // Ціна — середня зважена за грамами: 900 мл по 0,05 і 1 л по 0,06 — це не 0,055.
  let pricePerGram = incoming.pricePerGram ?? existing.pricePerGram;
  if (existing.pricePerGram != null && incoming.pricePerGram != null) {
    const ge = rowGrams(existing, products);
    const gi = rowGrams(incoming, products);
    if (ge && gi) pricePerGram = (existing.pricePerGram * ge + incoming.pricePerGram * gi) / (ge + gi);
  }

  return {
    ...existing,
    ...quantity,
    pricePerGram,
    // Те, що людина вже бачить у коморі, лишається: назва, штрихкод, власник,
    // сирий рядок каси й строк (нова пачка без строку приєднується до датованої).
    label: existing.label ?? incoming.label,
    barcode: existing.barcode ?? incoming.barcode,
    ownerId: existing.ownerId ?? incoming.ownerId,
    receiptName: existing.receiptName ?? incoming.receiptName,
    expiresAt: existing.expiresAt ?? incoming.expiresAt,
  };
}

/** Прибирає ключі зі значенням undefined — щоб рядок не тягнув порожні поля в сховище. */
function compact(row: PantryItem): PantryItem {
  const out = { ...row } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as PantryItem;
}

/** Рядок, якому ще не дали id (екрани часто складають покупку без нього). */
export type PantryInput = Omit<PantryItem, "id"> & { id?: string };

/**
 * Кладе покупку в комору (D6).
 *
 * 0. Рядок із тим самим id уже є — це правка: замінюємо на місці, не стекуємо.
 * 1. Базовий продукт, якого тип уже лежить «голим» будь-де в (сімейній)
 *    коморі, — нічого не робимо.
 * 2. Зливаємо з наявним, лише коли все сходиться: та сама річ, той самий
 *    місцевий день, сумісний строк (рівні або в нової його немає), рядок не
 *    прострочений і кількості дають одну суму. Дві пачки з одного чека —
 *    одна позиція «1,8 л»; пачка з позавчора лишається окремою, бо в неї свій строк.
 * 3. Інакше — новий рядок (у кінець масиву; порядок показу вирішує groupPantry).
 *
 * Результат завжди з типом картки (якщо картка в кеші) і з legacyDirty, якщо
 * змінений рядок ще має тимчасовий id.
 */
export function stackIntoPantry(
  pantry: PantryItem[],
  incoming: PantryInput,
  today: string,
  products: ProductCache = NO_PRODUCTS,
): StackResult {
  const next = syncType({ ...incoming, id: incoming.id || newId() }, products);

  const same = pantry.findIndex((row) => row.id === next.id);
  if (same >= 0) {
    const row = compact(markLegacy(next));
    return { pantry: pantry.map((r, i) => (i === same ? row : r)), rowId: row.id, before: pantry[same] };
  }

  if (isBareStaple(next)) {
    const staple = pantry.find((row) => isBareStaple(row) && row.key === next.key);
    if (staple) return { pantry, rowId: staple.id, before: staple };
  }

  const day = dayOf(next.addedAt) ?? today;
  const exactExpiry = (row: PantryItem) => Number((row.expiresAt ?? "") === (next.expiresAt ?? ""));
  const candidates = pantry
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        !isBareStaple(row) &&
        sameIdentity(row, next, products) &&
        dayOf(row.addedAt) === day &&
        !(row.expiresAt && row.expiresAt < today) &&
        (!next.expiresAt || (row.expiresAt ?? "") === next.expiresAt),
    )
    // Точний збіг строку раніше за «нова без строку»: пачка з тим самим строком — та сама партія.
    .sort((a, b) => exactExpiry(b.row) - exactExpiry(a.row));

  for (const { row, index } of candidates) {
    const merged = mergeRows(row, next, products);
    if (!merged) continue;
    const result = compact(markLegacy(syncType(merged, products)));
    return { pantry: pantry.map((r, i) => (i === index ? result : r)), rowId: result.id, before: row };
  }

  const row = compact(next);
  return { pantry: [...pantry, row], rowId: row.id, before: null };
}

/** Кілька покупок підряд (чек, імпорт): однакові рядки чека спершу складаються між собою. */
export function stackAllIntoPantry(
  pantry: PantryItem[],
  items: readonly PantryInput[],
  today: string,
  products: ProductCache = NO_PRODUCTS,
): { pantry: PantryItem[]; rowIds: string[] } {
  let current = pantry;
  const rowIds: string[] = [];
  for (const item of items) {
    const res = stackIntoPantry(current, item, today, products);
    current = res.pantry;
    if (!rowIds.includes(res.rowId)) rowIds.push(res.rowId);
  }
  return { pantry: current, rowIds };
}

/**
 * Чиста частина updatePantry: латка одного рядка.
 *
 * id не міняється ніколи; ключ зі значенням undefined — це «стерти поле»
 * (прибрати строк, ціну, касовий рядок); productId одразу переписує тип, не
 * чекаючи тригера в базі; тимчасовий id позначає правку для першого знімка.
 */
export function patchPantryRow(row: PantryItem, patch: Partial<PantryItem>, products: ProductCache = NO_PRODUCTS): PantryItem {
  const { id: _ignored, ...rest } = patch;
  return compact(markLegacy(syncType({ ...row, ...rest }, products)));
}

/* ── Результат скану (F5) ─────────────────────────────────────────────── */

export type ScanQuantityPlan =
  /** updatePantry(rowId, {amount, unit}). */
  | { kind: "set"; amount: number; unit: Unit }
  /** Кількість не складається з попередньою пачкою: addPantry(restore) і окремий рядок `add`. */
  | { kind: "unstack"; restore: PantryItem; add: { amount: number; unit: Unit } };

/**
 * Поле кількості після скану міняє ЛИШЕ цю пачку: разом = було до скану + введене.
 * Коли суми немає (штуки до мілілітрів, або в попередньої пачки кількість
 * не вказана), розстековуємо: стара пачка повертається, нова стає окремою.
 */
export function scanQuantityPlan(before: PantryItem | null, entered: { amount: number; unit: Unit }): ScanQuantityPlan {
  if (!before) return { kind: "set", ...entered };
  if (before.amount != null && before.unit) {
    const sum = sumQuantities([{ amount: before.amount, unit: before.unit }, entered]);
    if (sum.length === 1 && sum[0].amount != null) {
      return { kind: "set", amount: Number(sum[0].amount.toFixed(unitDef(sum[0].unit).decimals)), unit: sum[0].unit };
    }
  }
  return { kind: "unstack", restore: before, add: entered };
}

/**
 * «Скасувати» / «Не той товар?»: попередня пачка повертається як була
 * (addPantry з тим самим id замінює на місці), а нова без попередньої — зникає.
 */
export function scanUndoPlan(
  rowId: string,
  before: PantryItem | null,
): { kind: "restore"; row: PantryItem } | { kind: "remove"; id: string } {
  return before ? { kind: "restore", row: before } : { kind: "remove", id: rowId };
}

/* ── Групи й підсумки (D8) ────────────────────────────────────────────── */

export interface PantryGroup {
  /** Точний тип: «Молоко» і «Молоко безлактозне» — різні групи. */
  key: string;
  rows: PantryItem[];
  /** «1,9 л»; порожньо — жоден рядок не має кількості. */
  total: SummedQuantity[];
  /** Скільки рядків без кількості: «+ ще 1 без кількості». */
  unknown: number;
  /** Найближчий строк серед непрострочених. */
  soonest?: string;
}

export interface PantrySection {
  cat: IngredientCat;
  groups: PantryGroup[];
}

/** Датовані — за строком, далі без строку — як приносили. */
function shelfOrder(a: PantryItem, b: PantryItem): number {
  if (a.expiresAt && b.expiresAt) return a.expiresAt < b.expiresAt ? -1 : a.expiresAt > b.expiresAt ? 1 : byTime(a.addedAt, b.addedAt);
  if (a.expiresAt) return -1;
  if (b.expiresAt) return 1;
  return byTime(a.addedAt, b.addedAt);
}

/** Голі базові продукти одного ключа — один запис: у двох членів сімʼї «Сіль» одна. */
function distinctStaples(rows: PantryItem[]): PantryItem[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!isBareStaple(row)) return true;
    if (seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}

/**
 * Комора для вкладки «У коморі» (F1): прострочене окремо зверху, решта —
 * розділи за CAT_ORDER, у кожному групи за точним типом із підсумком.
 */
export function groupPantry(
  rows: PantryItem[],
  products: ProductCache,
  today: string,
): { expired: PantryItem[]; sections: PantrySection[] } {
  const all = distinctStaples(rows);
  const expired = all
    .filter((r) => r.expiresAt && r.expiresAt < today)
    .sort((a, b) => ((a.expiresAt as string) < (b.expiresAt as string) ? -1 : 1));
  const fresh = all.filter((r) => !(r.expiresAt && r.expiresAt < today));

  const byKey = new Map<string, PantryItem[]>();
  for (const row of fresh) {
    const key = canonicalKey(row.key);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }

  const sections = new Map<IngredientCat, PantryGroup[]>();
  for (const [key, list] of byKey) {
    const sorted = [...list].sort(shelfOrder);
    const dated = sorted.map((r) => r.expiresAt).filter((d): d is string => !!d);
    const group: PantryGroup = {
      key,
      rows: sorted,
      total: totalOf(sorted, key, products),
      unknown: sorted.filter((r) => r.amount == null || !r.unit).length,
      ...(dated.length ? { soonest: dated[0] } : {}),
    };
    const cat = ing(key).cat;
    sections.set(cat, [...(sections.get(cat) ?? []), group]);
  }

  return {
    expired,
    sections: CAT_ORDER.filter((cat) => sections.has(cat)).map((cat) => ({
      cat,
      groups: (sections.get(cat) as PantryGroup[]).sort((a, b) =>
        ing(a.key).label.localeCompare(ing(b.key).label, "uk"),
      ),
    })),
  };
}

/** «14 товарів · 9 типів»: голі базові рахуємо раз на ключ (D7). */
export function pantryCounts(rows: PantryItem[]): { items: number; types: number } {
  const distinct = distinctStaples(rows);
  return { items: distinct.length, types: new Set(distinct.map((r) => canonicalKey(r.key))).size };
}

/**
 * Скільки є вдома того, що годиться для потреби: «є 1,9 л».
 * Сам тип і всі різновиди; одиниці — родина типової одиниці потреби.
 * Підбір страв від цього не залежить: там «є / немає» (H2.3).
 */
export function availableFor(needKey: string, pantry: PantryItem[], products: ProductCache = NO_PRODUCTS): SummedQuantity[] {
  return totalOf(
    pantry.filter((row) => satisfies(row.key, needKey)),
    needKey,
    products,
  );
}

/* ── Списання після готування (D9) ────────────────────────────────────── */

/** Що саме списали з одного рядка — з id, бо «Повернути в комору» повертає саме його. */
export interface Consumed {
  id: string;
  key: string;
  label: string;
  emoji: string;
  /** Скільки пішло на страву: «200 мл». */
  used: string;
  /** Скільки лишилось: «800 мл». null — рядок закінчився. */
  left: string | null;
}

export interface Consumption {
  pantry: PantryItem[];
  consumed: Consumed[];
}

/**
 * Черга рядків, з яких брати для потреби `needKey`:
 * 1. ближчий тип: рецепту з «Молоко» — звичайне, безлактозне лишається тим, кому треба саме його;
 * 2. непрострочене зі строком — що зіпсується першим;
 * 3. без строку — як приносили;
 * 4. прострочене — останнім: у страву скоріше пішло свіже, а прострочене
 *    списуємо, лише коли свіжого не вистачило.
 * Рядки без кількості сюди не потрапляють: не знаємо, скільки було.
 */
export function consumptionOrder(
  needKey: string,
  rows: PantryItem[],
  products: ProductCache = NO_PRODUCTS,
  today: string = dateKey(),
): PantryItem[] {
  const rank = (row: PantryItem) => {
    const expired = !!row.expiresAt && row.expiresAt < today;
    return [typeDistance(row.key, needKey), expired ? 2 : row.expiresAt ? 0 : 1] as const;
  };
  return rows
    .filter((row) => satisfies(row.key, needKey) && (rowGrams(row, products) ?? 0) > 0 && !!row.amount)
    .sort((a, b) => {
      const [da, ea] = rank(a);
      const [db, eb] = rank(b);
      if (da !== db) return da - db;
      if (ea !== eb) return ea - eb;
      if (ea === 1) return byTime(a.addedAt, b.addedAt);
      const ex = (a.expiresAt as string).localeCompare(b.expiresAt as string);
      return ex || byTime(a.addedAt, b.addedAt);
    });
}

/**
 * Віднімає з комори те, що пішло на рецепт — по рядках, за id.
 *
 * Не чіпаємо: рядки без кількості, потреби «за смаком» і «за бажанням» (їх
 * могли й не класти). Потребу закриває і сам тип, і його різновид; конкретніші
 * потреби беруть першими, щоб «Молоко» з того ж рецепта не забрало
 * безлактозне, якого той просить окремо. Одна потреба може спорожнити кілька
 * рядків підряд; спорожнілий рядок зникає разом зі строком.
 *
 * `factor` — множник порцій, якщо готували не на стандартну кількість.
 */
export function consumeForRecipe(
  pantry: PantryItem[],
  recipe: Recipe,
  factor = 1,
  products: ProductCache = NO_PRODUCTS,
  today: string = dateKey(),
): Consumption {
  const consumed: Consumed[] = [];
  /*
   * Робоча копія: друга потреба бачить уже зменшені рядки. Ключ — id, а для
   * рядка без id (старі дані, перевірки) — його місце в масиві: інакше всі такі
   * рядки злиплися б під одним «undefined».
   */
  const slot = new Map<PantryItem, string>();
  pantry.forEach((row, index) => slot.set(row, row.id || `#${index}`));
  const rows = new Map(pantry.map((row) => [slot.get(row) as string, row]));

  const needs = recipe.ingredients
    .filter((need) => !need.optional && ingredientGrams(need) != null)
    .sort((a, b) => typeDepth(b.key) - typeDepth(a.key));

  for (const need of needs) {
    let left = (ingredientGrams(need) as number) * factor;
    for (const row of consumptionOrder(need.key, [...rows.values()], products, today)) {
      if (left <= 0) break;
      const at = slot.get(row) as string;
      const grams = rowGrams(row, products) as number;
      const unit = row.unit as Unit;
      const perUnit = grams / (row.amount as number);
      const take = Math.min(grams, left);
      left -= take;

      const decimals = unitDef(unit).decimals;
      const rest = Number(((grams - take) / perUnit).toFixed(decimals));
      if (rest > 0) {
        const next = markLegacy({ ...row, amount: rest });
        slot.set(next, at);
        rows.set(at, next);
      } else {
        rows.delete(at);
      }

      consumed.push({
        id: row.id,
        key: row.key,
        label: pantryDisplayName(row, products),
        emoji: ing(row.key).emoji,
        // Використане — в одиницях рядка, щоб читалось поруч із залишком.
        used: formatQuantity(Number((take / perUnit).toFixed(decimals)), unit),
        left: rest > 0 ? formatQuantity(rest, unit) : null,
      });
    }
  }

  if (!consumed.length) return { pantry, consumed };
  // Порядок комори той самий: змінились лише кількості.
  return { pantry: pantry.flatMap((item) => rows.get(slot.get(item) as string) ?? []), consumed };
}

/**
 * «Повернути в комору»: рядки `items` (знімок до готування) стають на свої
 * місця за id; спорожнілі й прибрані — повертаються в кінець.
 */
export function restorePantryById(pantry: PantryItem[], items: readonly PantryItem[]): PantryItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const next = pantry.map((row) => {
    const back = byId.get(row.id);
    if (!back) return row;
    byId.delete(row.id);
    return back;
  });
  return [...next, ...byId.values()];
}

/* ── Перепривʼязка тимчасових id (D5) ─────────────────────────────────── */

export interface LegacyRemoval {
  key: string;
  addedAt: string;
}

/**
 * Серверний рядок для тимчасового: спершу та сама мить, потім найраніший
 * рядок ключа (так показував старий dedupePantry).
 *
 * Та сама мить — не лише серед рядків того самого ключа, а й серед
 * споріднених типів: SQL контрактного кроку переписує касове безлактозне
 * молоко з «moloko» на «moloko_bezlaktozne», а тимчасовий рядок старих даних
 * досі «legacy:moloko». І саме мить важить більше за ключ: якщо поруч лежить
 * звичайне молоко дружини (інша мить), «найраніший рядок ключа» переписав би
 * її пачку, а переписаний рядок тієї самої миті лишився б нечіпаним.
 * Порядок: той самий ключ і мить → споріднений тип і мить → найраніший ключа.
 */
function pickRemote(rows: PantryItem[], key: string, addedAt: string): PantryItem | undefined {
  const same = rows.filter((r) => r.key === key);
  return (
    same.find((r) => sameInstant(r.addedAt, addedAt)) ??
    rows.find((r) => sameInstant(r.addedAt, addedAt) && (satisfies(r.key, key) || satisfies(key, r.key))) ??
    [...same].sort((a, b) => byTime(a.addedAt, b.addedAt))[0]
  );
}

/** Ключ для пошуку рядка в базі: зі старого id, якщо він тимчасовий (див. legacyKey). */
const baseKey = (row: Pick<PantryItem, "id" | "key">): string => legacyKey(row.id) ?? row.key;

/**
 * Перший знімок після оновлення: рядки з `legacy:` отримують справжні id.
 *
 * - Незмінений тимчасовий рядок просто зникає — його замінює знімок.
 * - Змінений (legacyDirty) лягає на серверний рядок того ж ключа (той самий
 *   addedAt, інакше найраніший) і переймає його id, власника й товар; немає
 *   такого — стає новим рядком. Обидва варіанти йдуть в `upserts`.
 * - Прибране, поки id був тимчасовим, видаляє рівно ОДИН серверний рядок
 *   (той самий addedAt, інакше найраніший) і ніколи — рядок, чий справжній id
 *   є локально: пачка, додана пізніше, не мусить зникнути через стару дію.
 *
 * `pantry` — знімок у тому вигляді, як його слід показати; локальні рядки зі
 * справжніми id, що ще не дійшли до бази, лишаються на mergePantry у сторі.
 */
export function rebaseLegacyPantry(
  local: PantryItem[],
  remote: PantryItem[],
  removed: readonly LegacyRemoval[],
): { pantry: PantryItem[]; upserts: PantryItem[]; removeIds: string[] } {
  const heldReal = new Set(local.filter((r) => !isLegacyId(r.id)).map((r) => r.id));
  const taken = new Set<string>();
  const free = () => remote.filter((r) => !heldReal.has(r.id) && !taken.has(r.id));

  const upserts: PantryItem[] = [];
  const adopted = new Map<string, PantryItem>();
  for (const row of local) {
    if (!isLegacyId(row.id) || !row.legacyDirty) continue;
    const { legacyDirty: _dirty, ...clean } = row;
    const target = pickRemote(free(), baseKey(row), row.addedAt);
    if (target) {
      taken.add(target.id);
      /*
       * Правку людини беремо з локального рядка, а те, чого старий код знати не
       * міг, — із серверного: власника, касовий рядок, штрихкод, картку. Картку —
       * лише якщо людина ще не обрала свою («Обрати товар» до першого знімка).
       * Мітка, рівна касовому рядку, — це касовий текст, який SQL I2 уже переніс
       * у receipt_name; повертати його в назву не можна (так само робить тригер).
       * Тип, якого людина не міняла, — серверний: контрактний крок міг його
       * уточнити (безлактозне), а тригер тримає його рівним типу картки.
       */
      const tillLabel = !!clean.label && clean.label === target.receiptName;
      const keptType = !!clean.productId || clean.key !== baseKey(row);
      const next = compact({
        ...clean,
        id: target.id,
        key: keptType ? clean.key : target.key,
        ownerId: target.ownerId,
        productId: clean.productId ?? target.productId,
        receiptName: clean.receiptName ?? target.receiptName,
        barcode: clean.barcode ?? target.barcode,
        label: tillLabel ? target.label : clean.label,
      });
      adopted.set(target.id, next);
      upserts.push(next);
    } else {
      upserts.push(compact({ ...clean, id: newId() }));
    }
  }

  const removeIds: string[] = [];
  for (const { key, addedAt } of removed) {
    const target = pickRemote(free(), key, addedAt);
    if (!target) continue;
    taken.add(target.id);
    removeIds.push(target.id);
  }

  const gone = new Set(removeIds);
  const fresh = upserts.filter((u) => !adopted.has(u.id));
  return {
    pantry: [...remote.filter((r) => !gone.has(r.id)).map((r) => adopted.get(r.id) ?? r), ...fresh],
    upserts,
    removeIds,
  };
}

/**
 * «Повернути в комору» для рядків, знятих ще з тимчасовим «legacy:» id (D5).
 *
 * Знімок `items` зроблено до готування чи прибирання, а між ним і дотиком
 * міг прийти перший знімок із бази. Тоді тимчасового рядка вже немає: змінений
 * отримав справжній id, а спорожнілий база вже видалила. Повернути його як є —
 * означало б покласти чистий тимчасовий рядок, який у базу не йде ніколи й
 * зникає з наступним знімком: людина бачить «повернуто», а списання лишається.
 * Тож:
 * - рядок із цим id ще є, або його видалення ще чекає знімка → як є;
 * - знімок уже дав йому справжній id (та сама мить, той самий чи споріднений
 *   тип) → повертаємо кількість у той рядок;
 * - знімок його вже прибрав → новий рядок із новим id, щоб він дійшов до бази.
 */
export function rebaseRestored(
  pantry: readonly PantryItem[],
  items: readonly PantryItem[],
  removed: readonly LegacyRemoval[],
): PantryItem[] {
  const ids = new Set(pantry.map((r) => r.id));
  return items.map((item) => {
    if (!isLegacyId(item.id) || ids.has(item.id)) return item;
    const key = baseKey(item);
    if (removed.some((r) => r.key === key && sameInstant(r.addedAt, item.addedAt))) return item;
    const real = pantry.find(
      (r) =>
        !isLegacyId(r.id) &&
        sameInstant(r.addedAt, item.addedAt) &&
        (r.key === item.key || r.key === key || satisfies(r.key, key) || satisfies(key, r.key)),
    );
    if (real) return { ...real, amount: item.amount, unit: item.unit, qty: item.qty };
    const { legacyDirty: _dirty, ...clean } = item;
    return { ...clean, id: newId() };
  });
}
