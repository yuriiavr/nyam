/*
 * Спільні типи товарів, ідентифікаторів та історії (I2–I6).
 *
 * Окремим файлом від src/lib/types.ts, бо це цілий контракт каталогу з власною
 * помилкою (CatalogError); types.ts його реекспортує. Рядок комори (PantryItem)
 * живе в types.ts.
 *
 * Правило для всього файлу: це форма, яку бачить клієнт (camelCase, числа —
 * числами, «немає» — undefined). Рядки бази й назви аргументів RPC живуть у
 * src/lib/supabase/products-api.ts і далі за нього не виходять.
 */

import type { IngredientDef, Nutrition } from "./types";

/* ── Товар ────────────────────────────────────────────────────────────── */

/** Одиниці упаковки: те, що пишуть на пачці. Ложок і пучків на пачках не буває. */
export type PackUnit = "g" | "kg" | "ml" | "l" | "pcs";

/**
 * Звідки взялась картка. `migration` пишуть лише SQL-файли: save_product
 * будь-що, крім off і receipt, записує як user — клієнту тут не вірять.
 */
export type ProductSource = "user" | "off" | "receipt" | "migration";

/**
 * Спільна картка товару: назва, виробник, упаковка, жирність, КБЖВ і рівно
 * один тип. Одна на всіх — правку бачать усі, і кожна пишеться в історію.
 *
 * `name` — рівно те, що бачить людина; упаковку показуємо окремо («· 900 мл»),
 * а brand і fatPct лише підказки для пошуку й дублікатів — з них назву ніхто
 * не складає.
 */
export interface Product {
  id: string;
  /** Ключ типу (вбудованого чи own_*). Тип рядка комори з цим товаром — завжди цей. */
  typeKey: string;
  name: string;
  brand?: string;
  fatPct?: number;
  packAmount?: number;
  packUnit?: PackUnit;
  /** Вага штуки, коли упаковка в штуках: «6 яєць» → грами без здогадок. */
  gramsPerPiece?: number;
  /** На 100 г. Цілим блоком: ккал без БЖВ буває, БЖВ без ккал — ні (products_nutrition_whole). */
  nutrition?: Nutrition;
  /** Лише https (обмеження в базі) — зазвичай image_small_url з Open Food Facts. */
  image?: string;
  source: ProductSource;
  /** Прибрана картка: зникає з пошуку й впізнавання, але в коморах лишається. */
  archived: boolean;
  /** I6: картку обʼєднали з цією. Читати треба переможця. */
  mergedInto?: string;
  /** Номер правки — кожен запис RPC несе його як p_expected_version. */
  version: number;
  updatedAt: string;
}

/**
 * Дані картки з редактора — те, що йде в save_product.
 *
 * Без id і version: їх save_product отримує окремими аргументами, а нова
 * картка їх ще не має. `guessed` і `provenance` — лише для редактора
 * (підкреслити здогадку, показати «З чека: …»); у базу вони не йдуть.
 */
export interface ProductDraft {
  typeKey: string;
  name: string;
  brand?: string;
  fatPct?: number;
  packAmount?: number;
  packUnit?: PackUnit;
  gramsPerPiece?: number;
  nutrition?: Nutrition;
  image?: string;
  /** Лише off чи receipt мають сенс; решту база однаково запише як user. */
  source?: Exclude<ProductSource, "migration">;
  /** Поля, які вгадали, а не прочитали: «900 мл?» з крапковим підкресленням. */
  guessed?: Array<"type" | "name" | "brand" | "pack" | "fat">;
  /**
   * Звідки заповнено: «Цей штрихкод ще ніхто не знає» / «З Open Food Facts» / «З чека: …».
   *
   * Для скану `known` — що про код сказала база: `none` — ніхто не знає;
   * `type` — знають лише як тип; `product` — уже означає інший товар
   * («Не той товар?»). Немає — код не перевіряли (рядок комори зі штрихкодом),
   * і обіцяти «ніхто не знає» не можна. `label` — назва того типу чи товару.
   */
  provenance?:
    | { from: "scan"; ean: string; known?: "none" | "type" | "product"; label?: string }
    | { from: "off"; ean: string }
    | { from: "receipt"; raw: string }
    | { from: "manual" };
}

/**
 * Відповідь save_product. `duplicate` — такий товар (назва + бренд + упаковка)
 * уже є, і нічого не записано: `product` тоді — той, що вже є, і людину
 * питають «Це він?».
 */
export interface SaveProductResult {
  status: "created" | "updated" | "duplicate";
  product: Product;
}

/* ── Ідентифікатори ───────────────────────────────────────────────────── */

/** Штрихкод EAN або назва рядка з чека. */
export type IdentifierKind = "ean" | "receipt_name";

/** Як ідентифікатор потрапив у базу. `migration` — лише з SQL. */
export type IdentifierSource = "scan" | "qr" | "photo" | "manual" | "migration";

/**
 * На що вказує ідентифікатор: на конкретний товар або лише на тип.
 * «ІмбирКг» → тип imbyr: ваговий товар без картки, щоб не плодити сміття.
 */
export type Target = { productId: string } | { typeKey: string };

/** Збіг з resolve_identifiers: що ця стрічка означає і в якій області її навчили. */
export interface IdentifierHit {
  kind: IdentifierKind;
  /** Рівно та стрічка, яку ми надіслали, — за нею відповідь зводиться з рядком чека. */
  raw: string;
  identifierId: string;
  /** '' — глобально; 'm:atb' — мережа; 's:…' — продавець без відомої мережі. */
  scope: string;
  /** Товар уже переписаний на переможця обʼєднання (merged_into), якщо таке було. */
  target: Target;
  version: number;
}

/** Рядок product_identifiers так, як його показує картка товару («Як його впізнати»). */
export interface ProductIdentifier {
  id: string;
  kind: IdentifierKind;
  scope: string;
  raw: string;
  /** Нормалізоване базою: normalize_ean чи receipt_name_key. Клієнт його не рахує. */
  value: string;
  target: Target;
  source: IdentifierSource;
  version: number;
}

/**
 * Що відомо про один рядок чека чи скан.
 *
 * `hit` — впізнано напевно. `suggestion` — лише здогадка: показуємо «Схоже
 * на …», але ніколи не вважаємо впізнаним і нічого з неї не навчаємо.
 */
export interface Resolution {
  via: IdentifierKind | "none";
  hit?: IdentifierHit;
  /** Штрихкод і назва в одному рядку ведуть до різних цілей: перемагає штрихкод, рядок не позначено. */
  eanConflict?: IdentifierHit;
  suggestion?: {
    product?: Product;
    typeKey?: string;
    from: "search" | "similar" | "off" | "heuristic";
  };
}

/** Схожа назва з similar_receipt_names (I5): лише для «Схоже на: …? [Так]». */
export interface SimilarNameHit {
  raw: string;
  identifierId: string;
  value: string;
  similarity: number;
  productId: string;
}

/* ── Навчання ─────────────────────────────────────────────────────────── */

/**
 * Що людина зробила з рядком чека чи сканом — від цього залежить, чого вчимо
 * спільну базу (src/lib/teach.ts, таблиця T1–T4).
 */
export type LineChoice =
  | { kind: "untouched" } // імпортовано з галочкою, не чіпали
  | { kind: "confirmed"; productId: string } // [Так] на підказці
  | { kind: "picked-product"; productId: string } // обрали в пікері або створили картку
  | { kind: "picked-type"; typeKey: string };

/**
 * Один запис для teach_identifiers — уже у формі елемента p_items
 * (snake_case), бо саме його порівнюють перевірки teachPlan.
 * Рівно одне з product_id / type_key.
 */
export interface TeachItem {
  kind: IdentifierKind;
  raw: string;
  product_id?: string;
  type_key?: string;
  source: Exclude<IdentifierSource, "migration">;
  /** Не вчити, якщо цю стрічку вже знають хоч у якійсь області (T3, T4). */
  only_if_unknown?: boolean;
}

/**
 * Результат одного елемента teach_identifiers.
 *
 * - `inserted` — навчили;
 * - `same` — вже вказувало туди ж;
 * - `conflict` — вказує на інше: `target` і `version` — того, що вже є
 *   (для reassign_identifier);
 * - `skipped` — only_if_unknown, а стрічку вже знають;
 * - `invalid` — база не змогла порахувати ключ (заглушка каси, 2 літери).
 */
export interface TeachResult {
  kind: IdentifierKind;
  raw: string;
  status: "inserted" | "same" | "conflict" | "skipped" | "invalid";
  identifierId?: string;
  scope?: string;
  target?: Target;
  version?: number;
}

/** Що робити з конфліктом: уточнити тип до товару мовчки, спитати людину чи нічого. */
export type ConflictAction = "refine" | "prompt" | "none";

/* ── Історія ──────────────────────────────────────────────────────────── */

export type CommunityTable = "products" | "product_identifiers" | "custom_ingredients";

export type CommunityOp = "insert" | "update" | "delete" | "merge" | "unmerge";

/**
 * Один запис історії з community_history.
 *
 * `actorName` порожній і `changedAt` зрізаний до дня для створення карток і
 * для всіх ідентифікаторів: людина + час + назва з чека конкретного магазину
 * розповіли б, де й коли хтось купував. Знімки — рядок бази як є (snake_case),
 * без авторів і часу створення.
 */
export interface CommunityChange {
  id: number;
  op: CommunityOp;
  changedAt: string;
  actorName: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Цей запис — повернення версії з іншого запису. */
  revertedFrom: number | null;
}

/** Дописаний тип разом із номером правки — для вікі-редагування (save_custom_ingredient). */
export type VersionedIngredient = IngredientDef & { version: number };

/* ── Помилки каталогу ─────────────────────────────────────────────────── */

/**
 * Людський сенс помилки спільного каталогу — щоб екрани не розбирали коди Postgres.
 *
 * - `conflict` — картку щойно змінив хтось інший (40001, hint catalog_conflict);
 * - `rate_limit` — забагато змін поспіль (hint catalog_rate_limit);
 * - `duplicate` — така картка вже є (hint duplicate; 23505);
 * - `missing_type` — такого типу в базі немає (23503);
 * - `denied` — не увійшли або немає права (42501, 28000, 401);
 * - `not_found` — цієї версії чи картки вже немає (P0002);
 * - `invalid` — база не прийняла дані (22023, 23514, 22P02, перевірки);
 * - `offline` — немає звʼязку або бекенд не налаштований;
 * - `stale` — застосунок застарів, запис зупинила перевірка версії;
 * - `other` — решта.
 */
export type CatalogErrorCode =
  | "conflict"
  | "rate_limit"
  | "duplicate"
  | "missing_type"
  | "denied"
  | "not_found"
  | "invalid"
  | "offline"
  | "stale"
  | "other";

/**
 * Помилка RPC чи читання каталогу. `message` — вже українською, придатне для
 * тосту; `pgCode`/`hint` — сирі, для перевірок і журналу.
 */
export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  readonly pgCode?: string;
  readonly hint?: string;

  constructor(code: CatalogErrorCode, message: string, pgCode?: string, hint?: string) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
    this.pgCode = pgCode;
    this.hint = hint;
  }
}

/**
 * Перевірка за іменем, а не лише instanceof: скрипти перевірок (jiti) можуть
 * завантажити цей файл двічі різними шляхами, і тоді класів теж два.
 */
export function isCatalogError(error: unknown, code?: CatalogErrorCode): error is CatalogError {
  const ok =
    error instanceof CatalogError ||
    (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "CatalogError");
  return ok && (code === undefined || (error as CatalogError).code === code);
}

/* ── Рядок чека ───────────────────────────────────────────────────────── */

/**
 * Підказки для картки, виведені з сирої назви (src/lib/product-hints.ts).
 * Без мережі й без запису: лише заповнити редактор, який людина підтвердить.
 */
export interface ProductHints {
  /** Уточнений тип (moloko → moloko_bezlaktozne). */
  typeKey?: string;
  brand?: string;
  packAmount?: number;
  packUnit?: PackUnit;
  /** Число без одиниці («Масл180») — одиницю вгадали за типом. */
  packGuessed?: boolean;
  fatPct?: number;
  /** «безлактозне», «солодковершкове», «пастеризоване». */
  attributes: string[];
  /** Ваговий товар: без упаковки й без пропозиції картки. */
  weighed: boolean;
  tokens: string[];
  /** «Молоко безлактозне Галичина 2,5%» — упаковка сюди ніколи не йде. */
  suggestedName?: string;
  guessed: Array<"type" | "brand" | "pack" | "fat">;
}

/**
 * Поля, що їх ReceiptDraft (src/lib/receipt.ts) отримує в I5:
 * `interface ReceiptDraft extends ReceiptDraftProductFields`.
 */
export interface ReceiptDraftProductFields {
  /** Що сказала база (штрихкод / назва / підказка). Немає — ще не спитали. */
  resolution?: Resolution;
  hints?: ProductHints;
  /** Немає — `untouched`. */
  choice?: LineChoice;
}
