"use client";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { Camera, Check, Plus, ReceiptText, ScanBarcode, ShoppingBasket } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { IngredientPicker } from "@/components/IngredientPicker";
import { MergeSheet } from "@/components/MergeSheet";
import { NewIngredientSheet } from "@/components/NewIngredientSheet";
import { ProductEditorSheet, typeFamily } from "@/components/ProductEditorSheet";
import { ProductPicker } from "@/components/ProductPicker";
import { ProductSheet } from "@/components/ProductSheet";
import { TopBar } from "@/components/TopBar";
import { Button, EmptyState, Segmented, Sheet, Spinner, useToast } from "@/components/ui";
import {
  cachedBrands,
  catalogDeps,
  teachAndSettle,
  wrongMappingPrompts,
  type ConflictPrompt,
  type TeachOutcome,
} from "@/components/pantry/catalog";
import { ConflictSheet } from "@/components/pantry/ConflictSheet";
import { ItemSheet } from "@/components/pantry/ItemSheet";
import { NamingSequence, namingDraft, namingOfferText, needsNaming } from "@/components/pantry/NamingSequence";
import { ActionToast, PantryGroupSheet, PantryGroups } from "@/components/pantry/PantryGroups";
import {
  MAX_OFF_LOOKUPS,
  ReceiptReview,
  productDraftFromLine,
  receiptLineQuantity,
  receiptPantryItems,
  useReceiptReview,
  type Enricher,
  type ReviewDraft,
} from "@/components/pantry/ReceiptReview";
import { ScanResultSheet, type ScanOutcome } from "@/components/pantry/ScanResultSheet";
import { chainOf } from "@/data/chains";
import {
  CAT_LABEL,
  CAT_ORDER,
  allIngredients,
  ing,
  isOwnKey,
  knownIngredient,
  satisfies,
} from "@/data/ingredients";
import { RECEIPT_FORMATS } from "@/lib/barcode";
import { normalizeEan } from "@/lib/ean";
import { lookupOffDraft } from "@/lib/off-draft";
import { groupPantry, isBareStaple, pantryCounts, pantryDisplayName, rowGrams } from "@/lib/pantry";
import { productHints, receiptDisplayName } from "@/lib/product-hints";
import type { IdentifierHit, Product, ProductDraft, ProductHints, TeachItem } from "@/lib/product-types";
import { rowFromProduct, shortProductName } from "@/lib/products";
import {
  fetchReceipt,
  parseReceiptQr,
  readReceiptPhoto,
  type Receipt,
  type ReceiptFailure,
} from "@/lib/receipt";
import {
  draftReceiptLines,
  resolveBarcode,
  resolveReceipt,
  type BarcodeResult,
  type ReceiptResolution,
  type ReceiptSource,
  type ResolvedReceiptLine,
} from "@/lib/resolve";
import { refreshFromServer } from "@/lib/session";
import { useApp } from "@/lib/store";
import { fetchCustomIngredients } from "@/lib/supabase/api";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchProductsByIds,
  toCatalogError,
  unmergeCustomIngredient,
  unmergeProduct,
} from "@/lib/supabase/products-api";
import { teachPlan } from "@/lib/teach";
import type { IngredientCat, IngredientDef, PantryItem, Unit } from "@/lib/types";
import { formatSummed, ingredientQtyLabel, sumQuantities } from "@/lib/units";
import { compressImage, dateKey, haptic, newId, plural } from "@/lib/utils";

/*
 * Комора по товару (I4–I6): один рядок — одна покупка, згрупована за типом.
 *
 * Сторінка — диригент. Малюють компоненти з src/components/pantry, що це за
 * товар — вирішує resolve.ts, чого вчити спільну базу — teach.ts. Тут лише
 * послідовність: що відкрити після чого, і що покласти в комору.
 *
 * Скрізь одне правило: у комору лягає рядок за id. Правки — updatePantry(id),
 * нові покупки — addPantry (він сам складає однакові пачки, D6), прибирання —
 * removePantry(id). Жодного «addPantry({...item, ...changes})»: для комори по
 * товару це вже друга пачка, а не правка першої.
 */

/** Для якого рядка чи скану відкрито вибір товару. */
type PickerContext =
  | { kind: "add"; initialQuery?: string }
  /** «Обрати товар» (B7) чи «Не той товар?» на рядку комори. `draft` — з OFF/штрихкоду, якщо його спитали. */
  | { kind: "row"; rowId: string; wrong: boolean; draft?: ProductDraft }
  /** «Не той товар?» після скану: попередню пачку вже повернуто. */
  | { kind: "scan-wrong"; code: string; ean: string | null; previous: Product }
  /** Рядок чека: «Не те?», «Інше», «Обрати», «Це інший товар». */
  | { kind: "line"; lineId: string };

/** Для чого відкрито редактор картки на рівні сторінки. */
type EditorContext =
  | { kind: "scan"; draft: ProductDraft }
  | { kind: "line"; lineId: string; draft: ProductDraft; hints?: ProductHints };

/** Тост із дією: «Прибрано …» [Повернути], «Додано 14 · 3 без картки» [Назвати]. */
interface Offer {
  /** Новий на кожну пропозицію: однаковий текст двох поспіль — усе одно дві різні дії. */
  id: string;
  text: string;
  emoji?: string;
  actionLabel: string;
  onAction: () => void;
}

export default function PantryPage() {
  const router = useRouter();
  /*
   * Комора читає свої зрізи, а не весь стор: інакше набір кількості в одній
   * картці перемальовував би сторінку цілком, разом з усіма аркушами.
   */
  const pantry = useApp((s) => s.pantry);
  const products = useApp((s) => s.products);
  const shopping = useApp((s) => s.shopping);
  /*
   * Підписка на каталог, дописаний людьми: сам опис лежить у реєстрі модуля,
   * і без цього рядка екран не дізнався б, що він нарешті приїхав, — власний
   * тип показувався б сирим ключем до наступного дотику. Родовід типів теж
   * звідти, тож і групи перераховуються від нього.
   */
  const customIngredients = useApp((s) => s.customIngredients);
  const account = useApp((s) => s.account);
  const hydrated = useApp((s) => s.hydrated);
  const updatePantry = useApp((s) => s.updatePantry);
  const removePantry = useApp((s) => s.removePantry);
  const removePantryType = useApp((s) => s.removePantryType);
  const importPantry = useApp((s) => s.importPantry);
  const restorePantry = useApp((s) => s.restorePantry);
  const upsertProducts = useApp((s) => s.upsertProducts);
  const setCustomIngredients = useApp((s) => s.setCustomIngredients);
  const toast = useToast();
  const review = useReceiptReview();

  /** Картки товарів є лише з бекендом; локальний режим — типи й назви, як раніше. */
  const canUseProducts = isSupabaseConfigured;
  /*
   * Фото читає платний сервіс, і маршрут пускає лише з живою сесією Supabase.
   * Без неї кнопка вела б рівно до одного — до «сесія застаріла».
   */
  const canReadPhoto = isSupabaseConfigured && !!account;

  const [tab, setTab] = useState<"stock" | "basics">("stock");
  const [addSheet, setAddSheet] = useState(false);
  /** id рядка, картку якого відкрито. */
  const [itemId, setItemId] = useState<string | null>(null);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [productSheetId, setProductSheetId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerContext | null>(null);
  const [editor, setEditor] = useState<EditorContext | null>(null);
  /** «Лише тип» після скану — вибір типу без товарів. */
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  /** Новий тип після скану («Створити «…»» у виборі типу). */
  const [creatingType, setCreatingType] = useState<string | null>(null);
  const [editTypeKey, setEditTypeKey] = useState<string | null>(null);
  const [mergeTypeKey, setMergeTypeKey] = useState<string | null>(null);
  const [mergePair, setMergePair] = useState<{ product: Product; other: Product } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scan, setScan] = useState<ScanOutcome | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  /** Невдача читання чека разом із тим, що саме прочиталось із QR. */
  const [receiptError, setReceiptError] = useState<{
    message: string;
    scanned: string;
    reason?: ReceiptFailure;
    from: ReceiptSource;
  } | null>(null);
  /** Конфлікти навчання — по одному аркушу «Цей код зараз означає…». */
  const [prompts, setPrompts] = useState<ConflictPrompt[]>([]);
  /** Черга «Назвати» після чека: рядки й магазин, у якому їх купили. */
  const [naming, setNaming] = useState<{ rows: PantryItem[]; store?: string } | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  /** «У коморі є 2 товари цього типу. Прибрати всі?» */
  const [basicsAsk, setBasicsAsk] = useState<{ key: string; count: number } | null>(null);

  /** Прихований вибір файлу: камера для фотографії чека. */
  const photoInput = useRef<HTMLInputElement>(null);
  /**
   * Номер поточного пошуку за штрихкодом. «Шукаю товар» можна закрити — тоді
   * номер росте, і відповідь, що запізнилась, уже нічого не відкриває й не
   * кладе в комору: людина передумала, а не чекає.
   */
  const lookupSeq = useRef(0);
  /** Останній скан: з ним «Лише тип», картка й «Не той товар?» знають код і що про нього сказала база. */
  const scanCtx = useRef<{ code: string; ean: string | null; res: BarcodeResult } | null>(null);
  /** OFF-чернетки рядків чека: «Створити товар» заповнюється з етикетки, коли вона є. */
  const lineDrafts = useRef(new Map<string, ProductDraft>());

  const dismissOffer = useCallback(() => setOffer(null), []);
  const today = dateKey();

  /* ── Похідне ──────────────────────────────────────────────────────── */

  /** Скільки ще не викреслено в списку покупок — число на значку кошика. */
  const toBuy = shopping.filter((x) => !x.done).length;

  /*
   * Базові продукти живуть окремою вкладкою-чеклистом, тож із основного
   * списку їх прибираємо: інакше сіль і олія лежали б у двох місцях одразу.
   * Але товар («Олія Щедрий Дар 0,85 л») — уже не галочка, а покупка з
   * кількістю й строком: він показується в коморі завжди (D8).
   */
  const stock = useMemo(() => pantry.filter((p) => p.productId || !ing(p.key).staple), [pantry, customIngredients]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouping = useMemo(
    () => groupPantry(stock, products, today),
    // customIngredients — родовід і категорії дописаних типів.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stock, products, today, customIngredients],
  );
  /*
   * «14 товарів · 9 типів» і число на вкладці — про те саме, що видно у
   * списку: без галочок «Основного» і з голими базовими раз на ключ (D7).
   * Інакше вгорі було б «8 товарів», а на вкладці поруч — «У коморі (5)».
   */
  const counts = useMemo(() => pantryCounts(stock), [stock]);
  const brands = useMemo(() => cachedBrands(products), [products]);

  const displayName = useCallback((row: PantryItem) => pantryDisplayName(row, products), [products]);
  const shortName = useCallback(
    (row: PantryItem) => shortProductName(pantryDisplayName(row, products), row.key),
    [products],
  );

  const basics = useMemo(() => {
    const map = new Map<IngredientCat, IngredientDef[]>();
    for (const def of allIngredients()) {
      if (!def.staple) continue;
      map.set(def.cat, [...(map.get(def.cat) ?? []), def]);
    }
    return CAT_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customIngredients]);

  /*
   * Чеклист базових — про точну наявність, без родоводу: галочка «Олія» стоїть
   * лише тоді, коли в коморі є саме олія. Різновид лише підписуємо під нею.
   * Рахуємо різні ключі, а не рядки: у двох членів сімʼї «Сіль» одна (D7).
   */
  const basicsHave = allIngredients().filter(
    (d) => d.staple && pantry.some((p) => p.key === d.key),
  ).length;

  const group = groupKey
    ? (grouping.sections.flatMap((s) => s.groups).find((g) => g.key === groupKey) ?? null)
    : null;

  /* ── Покласти в комору ────────────────────────────────────────────── */

  /**
   * Нова покупка через addPantry — і що з нею сталось: у який рядок лягла і
   * яким той рядок був до того (для «Тепер разом» і «Скасувати» в F5).
   * Через getState, а не селектор: обробники скану живуть довше за рендер.
   */
  const put = (item: PantryItem): { rowId: string; before: PantryItem | null } => {
    const { rowId, before } = useApp.getState().addPantry(item);
    return { rowId, before };
  };

  /**
   * Відповіді teachAndSettle: невдача — чесний тост (порожній `failure` — мовчки:
   * підказка типу коду лише бонус), конфлікти — у чергу аркушів.
   */
  const settleTeaching = async (
    items: TeachItem[],
    opts: { seller?: string | null; chain?: string | null; failure: string },
  ): Promise<TeachOutcome | null> => {
    if (!items.length || !canUseProducts) return null;
    const res = await teachAndSettle(items, opts);
    if (!res.ok && opts.failure) toast(opts.failure, "⚠️");
    if (res.prompts.length) setPrompts((list) => [...list, ...res.prompts]);
    return res;
  };

  /** Щойно прибраний рядок — назад рівно тим самим рядком (за id, без складання). */
  const offerUndoRemove = (row: PantryItem) => {
    setOffer({
      id: newId(),
      text: `Прибрано «${shortProductName(pantryDisplayName(row, useApp.getState().products), row.key)}»`,
      emoji: "🧹",
      actionLabel: "Повернути",
      onAction: () => restorePantry([row]),
    });
  };

  const addProduct = (product: Product) => {
    upsertProducts([product]);
    const { rowId } = put(rowFromProduct(product));
    haptic(12);
    // Одразу відкриваємо картку: питання «скільки й до якого числа» краще
    // ставити тоді, коли продукт щойно в руках, а не колись потім.
    setItemId(rowId);
  };

  /**
   * Тип у комору. `typed` — картка, яку людина вже заповнила, але без звʼязку не
   * зберегла («Додати як тип»): набрані назва й упаковка лягають у рядок, а не
   * зникають разом із редактором.
   */
  const addType = (def: IngredientDef, typed?: ProductDraft) => {
    const pack =
      typed?.packAmount != null && typed.packUnit ? { amount: typed.packAmount, unit: typed.packUnit as Unit } : {};
    const { rowId } = put({
      id: newId(),
      key: def.key,
      ...(typed?.name ? { label: typed.name } : {}),
      ...pack,
      addedAt: new Date().toISOString(),
    });
    haptic(12);
    setItemId(rowId);
  };

  /**
   * Рядок комори стає товаром (B7, «Назвати», «Не той товар?»).
   *
   * Тип стор перепише одразу за карткою, не чекаючи тригера в базі. Вчимо
   * лише з доказу — назви з каси чи штрихкоду цього рядка: «Сир», доданий
   * руками, нічого не каже про те, що «Сир» означає цей товар для всіх.
   */
  const linkRow = async (row: PantryItem, product: Product, store?: string) => {
    upsertProducts([product]);
    updatePantry(row.id, { productId: product.id });
    haptic(12);
    toast(`«${product.name}» у коморі`, "🔗");
    const items = teachPlan(
      { name: row.receiptName, ean: row.barcode },
      { via: "none" },
      { kind: "picked-product", productId: product.id },
      "manual",
    );
    const taught = await settleTeaching(items, {
      seller: store ?? null,
      chain: chainOf(store) ?? null,
      failure: "Товар привʼязано, але запамʼятати назву з чека чи штрихкод не вдалося",
    });
    /*
     * «Не той товар?»: магазину, де назву навчив чек, тут уже не знаємо, тож
     * вище вчили глобально — і хибна привʼязка в області магазину лишилась би
     * мовчки (вона там перемагає). Питаємо про кожну, що веде до старого товару.
     */
    if (canUseProducts && row.receiptName && row.productId && row.productId !== product.id) {
      const extra = await wrongMappingPrompts(row.receiptName, row.productId, product.id, taught?.identifierIds ?? []);
      if (extra.length) setPrompts((list) => [...list, ...extra]);
    }
  };

  /* ── Сканер штрихкодів (B1, F5) ───────────────────────────────────── */

  const addScannedProduct = (code: string, ean: string | null, product: Product, index?: IdentifierHit[]) => {
    upsertProducts([product], index);
    const item = rowFromProduct(product, ean ? { barcode: ean } : {});
    const { rowId, before } = put(item);
    haptic(14);
    setScan({
      kind: "product",
      scanId: newId(),
      code,
      product,
      rowId,
      before,
      added: { amount: item.amount, unit: item.unit },
    });
  };

  const handleDetect = async (code: string) => {
    setScanOpen(false);
    setScanLoading(true);
    const seq = ++lookupSeq.current;
    let res: BarcodeResult;
    try {
      res = await resolveBarcode(code, catalogDeps());
    } catch {
      res = { via: "none", ean: normalizeEan(code), error: "other" };
    }
    if (seq !== lookupSeq.current) return;
    setScanLoading(false);
    scanCtx.current = { code, ean: res.ean, res };
    const scanId = newId();

    if (!canUseProducts) {
      // Локальний режим: карток немає — назва з Open Food Facts і вибір типу.
      setScan({ kind: "local", scanId, code, name: res.draft?.name || undefined, image: res.draft?.image });
      return;
    }

    if (res.product) {
      // Знайомий товар — у комору одразу: скан → [Готово], два дотики.
      addScannedProduct(code, res.ean, res.product, res.hit ? [res.hit] : undefined);
      /*
       * Із кешу — перевіряємо в базі у фоні: картку могли перейменувати чи
       * уточнити. Рядок уже в коморі, тож лише освіжаємо кеш (назва підтягнеться).
       */
      if (res.revalidate) {
        void res
          .revalidate()
          .then((fresh) => {
            if (fresh.product) useApp.getState().upsertProducts([fresh.product], fresh.hit ? [fresh.hit] : undefined);
          })
          .catch(() => {});
      }
      return;
    }

    const blank: ProductDraft = {
      typeKey: "",
      name: "",
      guessed: [],
      // «Ніхто не знає» — лише коли база відповіла промахом, а не коли не відповіла.
      provenance: res.ean ? { from: "scan", ean: res.ean, ...(res.error ? {} : { known: "none" as const }) } : { from: "manual" },
    };
    if (res.ean && res.hit && res.typeKey) {
      setScan({ kind: "type", scanId, code, ean: res.ean, typeKey: res.typeKey, draft: res.draft ?? { ...blank, typeKey: res.typeKey } });
    } else if (res.ean && res.error) {
      // База не відповіла: не кажемо «ніхто не знає» — не знаємо ми.
      setScan({ kind: "offline", scanId, code, ean: res.ean });
    } else if (res.ean && res.draft?.provenance?.from === "off") {
      setScan({ kind: "off", scanId, code, ean: res.ean, draft: res.draft });
    } else {
      setScan({ kind: "unknown", scanId, code, ean: res.ean, draft: res.draft ?? blank });
    }
  };

  /** Картку щойно заповнили після скану: у комору, і штрихкод — цьому товару (T1). */
  const afterScanCard = (product: Product) => {
    const ctx = scanCtx.current;
    if (!ctx) {
      addProduct(product);
      return;
    }
    addScannedProduct(ctx.code, ctx.ean, product);
    if (!ctx.ean) return;
    void settleTeaching(
      teachPlan({ ean: ctx.ean }, ctx.res, { kind: "picked-product", productId: product.id }, "scan"),
      { failure: "Товар у коморі, але запамʼятати штрихкод не вдалося" },
    );
  };

  /**
   * «Лише тип» (T4): рядок типу зі штрихкодом і назвою з OFF, якщо вона була.
   * Онлайн ще й підказуємо базі тип цього коду — лише якщо його ніхто не знає.
   */
  const addTypeFromScan = (def: IngredientDef, typed?: ProductDraft) => {
    const ctx = scanCtx.current;
    // Картка, яку людина вже заповнила без звʼязку, важить більше за етикетку з OFF.
    const draft = typed?.name ? typed : ctx?.res.draft;
    const pack =
      draft?.packAmount != null && draft.packUnit ? { amount: draft.packAmount, unit: draft.packUnit as Unit } : {};
    const { rowId } = put({
      id: newId(),
      key: def.key,
      ...(draft?.name ? { label: draft.name } : {}),
      ...(ctx?.ean ? { barcode: ctx.ean } : {}),
      ...pack,
      addedAt: new Date().toISOString(),
    });
    haptic(12);
    toast(`«${draft?.name || def.label}» у коморі`, "📦");
    setItemId(rowId);
    if (ctx?.ean && canUseProducts) {
      void settleTeaching(
        teachPlan({ ean: ctx.ean }, ctx.res, { kind: "picked-type", typeKey: def.key }, "scan"),
        // Підказка типу — бонус до рядка, який уже лежить у коморі: мовчимо.
        { failure: "" },
      ).catch(() => {});
    }
  };

  /* ── Чек: QR і фото (B2, B3, F4) ──────────────────────────────────── */

  /**
   * Чек із фотографії.
   *
   * Той самий шлях, що й для QR: розпізнане стає списком на підтвердження, у
   * комору мовчки не лягає нічого. Різниця лише в джерелі — там машинний код
   * із податкової, тут те, що видно на папірці.
   */
  const handleReceiptPhoto = async (file: File) => {
    const signal = review.start("photo");
    try {
      /*
       * Сесію питаємо раніше за стискання: без неї маршрут однаково відповість
       * 401, і людина чекала б на стискання й вивантаження фото заради відмови.
       *
       * Але «немає токена» — ще не «сесія застаріла». Протухлий токен Supabase
       * оновлює мережею, і без звʼязку getSession теж віддає порожню сесію —
       * лише з мережевою помилкою поруч. Сказати на це «онови сторінку» означало
       * б послати людину без звʼязку перезавантажувати застосунок, який офлайн
       * уже не відкриється. Тож із такою помилкою йдемо в запит як є: без
       * звʼязку він упаде й чесно скаже «немає звʼязку», а якщо звʼязок
       * повернувся — маршрут сам відповість, чи жива сесія.
       */
      const session = await getSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token ?? null;
      const result =
        token || isAuthRetryableFetchError(session?.error)
          ? await readReceiptPhoto(await compressImage(file, 1600, 0.8), token, signal)
          : ({ ok: false, reason: "unauthorized" } as const);
      // Людина вже натиснула «Скасувати» або почала нове читання — мовчимо.
      if (signal.aborted) return;

      if (!result.ok) {
        review.fail();
        setReceiptError({
          message: PHOTO_FAILURE[result.reason] ?? RECEIPT_FAILURE[result.reason],
          scanned: "фото чека",
          reason: result.reason,
          from: "photo",
        });
        return;
      }

      await showReceipt(result.receipt, "photo", signal);
    } catch {
      if (signal.aborted) return;
      review.fail();
      setReceiptError({ message: "Не вдалося прочитати фото. Спробуй ще раз", scanned: "фото чека", from: "photo" });
    }
  };

  /**
   * QR з чека → позиції з податкової → список на підтвердження.
   *
   * У комору мовчки не кладемо нічого: касова назва зіставляється з каталогом
   * приблизно, і останнє слово має лишитись за людиною, яка цей чек тримає.
   */
  const handleReceipt = async (raw: string) => {
    setReceiptOpen(false);

    /*
     * Про невдачу повідомляємо аркушем, а не тостом. Тост тут з'являвся
     * рівно тоді, коли на весь екран згасав сканер, і його просто не
     * помічали: виглядало так, ніби QR прочитано, а далі нічого не сталось.
     * Аркуш заразом показує, що саме зчиталось, — з цим уже можна щось робити.
     */
    const query = parseReceiptQr(raw);
    if (!query) {
      setReceiptError({
        message: "Це не схоже на фіскальний чек. QR прочитано, але в ньому немає полів чека.",
        scanned: raw,
        from: "qr",
      });
      return;
    }

    const signal = review.start("qr");
    const result = await fetchReceipt(query, signal);
    if (signal.aborted) return;
    if (!result.ok) {
      review.fail();
      setReceiptError({ message: RECEIPT_FAILURE[result.reason], scanned: raw, reason: result.reason, from: "qr" });
      return;
    }

    await showReceipt(result.receipt, "qr", signal);
  };

  /**
   * Розібраний чек → список на підтвердження.
   *
   * Одразу — те, що вміє евристика (тип із назви, упаковка, кількість). Що
   * скаже база (знайомий товар, «схоже на», OFF), дописується в межах
   * ENRICH_BUDGET_MS, а те, що запізнилось, — у вже відкритий список, не
   * чіпаючи того, що людина встигла вирішити сама.
   */
  const showReceipt = async (read: Receipt, source: ReceiptSource, signal: AbortSignal) => {
    lineDrafts.current = new Map();
    const lines = draftReceiptLines(read, source, cachedBrands(useApp.getState().products));
    const enrichers: Enricher[] = [];

    if (canUseProducts) {
      enrichers.push(async (emit, sig) => {
        /*
         * Дві хвилі: знайомі товари — щойно база їх назвала (вони встигають у
         * перший показ списку), підказки OFF і пошуку — коли дочитаються. Рядок
         * зі збігом у другій хвилі вже не змінюється, тож і вдруге не шлемо.
         */
        const sent = new Set<string>();
        const deliver = (res: ReceiptResolution) => {
          if (sig.aborted) return;
          if (res.products.length) useApp.getState().upsertProducts(res.products);
          for (const line of res.lines) {
            if (line.nonFood || sent.has(line.id)) continue;
            if (line.draft) lineDrafts.current.set(line.id, line.draft);
            const suggestion = line.resolution.suggestion;
            // Лише евристика — вона вже в списку, дописувати нічого.
            if (!line.resolution.hit && (!suggestion || suggestion.from === "heuristic")) continue;
            sent.add(line.id);
            emit(line.id, reviewPatch(line));
          }
        };
        deliver(await resolveReceipt(read, source, catalogDeps(), deliver));
      });
    } else if (source === "qr") {
      /*
       * Без бекенду довідника товарів немає, але справжній EAN у чеку однаково
       * може впізнати Open Food Facts — як і досі. Не більше восьми рядків:
       * решта чекає на людину, і це чесніший обмін, ніж хвилина очікування.
       */
      enrichers.push(async (emit, sig) => {
        const targets = lines.filter((l) => !l.nonFood && !l.typeKey && l.ean).slice(0, MAX_OFF_LOOKUPS);
        await Promise.all(
          targets.map(async (line) => {
            const draft = await lookupOffDraft(line.ean as string, sig);
            if (sig.aborted || !draft?.typeKey || !knownIngredient(draft.typeKey)) return;
            const hints: ProductHints = { ...line.hints, packAmount: draft.packAmount, packUnit: draft.packUnit };
            const quantity = receiptLineQuantity(line.line, undefined, hints);
            emit(line.id, { ingredient: ing(draft.typeKey), amount: quantity?.amount, unit: quantity?.unit });
          }),
        );
      });
    }

    await review.show(read, lines.map(reviewDraftOf), enrichers, signal);
  };

  /**
   * Кладе підтверджені позиції в комору — одним записом на весь чек, — а
   * потім, уже з рядками в коморі, вчить базу (B8) і пропонує назвати те, що
   * лишилось без картки.
   *
   * Назва рядка — ніколи не текст каси: той іде в receiptName і лишається
   * приватним «звідки». Людям — картка, тип або «Молоко безлактозне Галичина».
   */
  const importReceipt = async () => {
    const current = review.receipt;
    if (!current) return;
    const chosen = review.chosen;
    const items = receiptPantryItems(current.drafts, chosen, new Date().toISOString(), newId, products);
    if (items.length === 0) {
      review.close();
      return;
    }

    // Рядки, куди лягли покупки: однакові рядки чека й пачки цього дня складаються (D6).
    const rowIds = importPantry(items);
    review.close();
    haptic([12, 30, 12]);

    const source = current.source;
    const store = current.store;
    const lines = current.drafts.filter((d) => chosen.has(d.id) && d.ingredient);

    const after = useApp.getState().pantry;
    const unnamed = canUseProducts
      ? rowIds
          .map((id) => after.find((row) => row.id === id))
          .filter((row): row is PantryItem => !!row && needsNaming(row, brands))
      : [];
    const text = namingOfferText(items.length, unnamed.length);
    if (unnamed.length > 0) {
      setOffer({ id: newId(), text, emoji: "🧾", actionLabel: "Назвати", onAction: () => setNaming({ rows: unnamed, store }) });
    } else {
      toast(text, "🧾");
    }

    if (!canUseProducts) return;
    const seen = new Set<string>();
    const teach = lines
      .flatMap((d) =>
        teachPlan(
          { name: d.line.name, ean: source === "qr" ? d.line.code : undefined, nonFood: d.nonFood, checked: true },
          d.resolution ?? { via: "none" },
          d.choice ?? { kind: "untouched" },
          source,
        ),
      )
      // Два однакові рядки в одному чеку вчать одне й те саме — шлемо раз.
      .filter((item) => {
        const key = `${item.kind}\n${item.raw}\n${item.product_id ?? item.type_key}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    await settleTeaching(teach, {
      seller: store ?? null,
      chain: chainOf(store) ?? null,
      failure: "Товари додано, але запамʼятати назви не вдалося",
    });
  };

  /* ── Картки й типи ────────────────────────────────────────────────── */

  /** «Обрати товар» (B7): зі штрихкодом — спершу питаємо сам код, далі вибір. */
  const chooseProduct = async (row: PantryItem) => {
    setItemId(null);
    if (row.barcode && canUseProducts) {
      setScanLoading(true);
      const seq = ++lookupSeq.current;
      const res = await resolveBarcode(row.barcode, catalogDeps()).catch(() => null);
      if (seq !== lookupSeq.current) return;
      setScanLoading(false);
      if (res?.product) {
        await linkRow(row, res.product);
        return;
      }
      setPicker({ kind: "row", rowId: row.id, wrong: false, draft: res?.draft });
      return;
    }
    setPicker({ kind: "row", rowId: row.id, wrong: false });
  };

  /** Обʼєднали дві картки: рядки комори з переможеною — на переможця, як уже зробила база. */
  const afterProductsMerged = (loser: string, winner: string) => {
    const state = useApp.getState();
    for (const row of state.pantry) if (row.productId === loser) state.updatePantry(row.id, { productId: winner });
    void fetchProductsByIds([loser, winner])
      .then((list) => useApp.getState().upsertProducts(list))
      .catch(() => {});
    setProductSheetId(null);
    setOffer({
      id: newId(),
      text: "Картки обʼєднано",
      emoji: "🔗",
      actionLabel: "Розʼєднати",
      onAction: () => {
        void unmergeProduct(loser)
          .then(() => fetchProductsByIds([loser, winner]))
          .then((list) => {
            useApp.getState().upsertProducts(list);
            toast("Розʼєднали. Комори лишились з обʼєднаною карткою", "↩️");
          })
          .catch((e) => toast(toCatalogError(e).message, "⚠️"));
      },
    });
  };

  /** Каталог дописаних і знімок комори — після обʼєднання чи розʼєднання типів (база вже переписала рядки). */
  const reloadTypes = () =>
    fetchCustomIngredients()
      .then((list) => setCustomIngredients(list))
      .then(() => refreshFromServer())
      .catch(() => {});

  /** Розʼєднати тип: рядки, картки й коди, що переїхали при обʼєднанні, база повертає сама. */
  const unmergeType = async (loser: string) => {
    try {
      await unmergeCustomIngredient(loser);
      haptic(12);
      toast(`«${ing(loser).label}» знову окремий тип`, "↩️");
      setGroupKey(null);
      await reloadTypes();
    } catch (e) {
      toast(toCatalogError(e).message, "⚠️");
    }
  };

  /**
   * Обʼєднали дописаний тип з іншим: каталог і рядки комори — зі знімка.
   *
   * Рядки на переможця база вже переписала сама, і локально їх не пишемо
   * навмисно: такий запис у черзі синхронізації, що дійшов би вже після
   * «Розʼєднати», знову переніс би рядок на переможця. До знімка старий ключ
   * і так рахується переможцем (canonicalKey).
   */
  const afterTypesMerged = (loser: string, winner: string) => {
    // Підпис до перечитування каталогу: після нього переможений — уже псевдонім.
    const loserLabel = ing(loser).label;
    setGroupKey(null);
    void reloadTypes();
    setOffer({
      id: newId(),
      text: `«${loserLabel}» тепер — «${ing(winner).label}»`,
      emoji: "🔗",
      actionLabel: "Розʼєднати",
      onAction: () => void unmergeType(loser),
    });
  };

  /* ── Базові ───────────────────────────────────────────────────────── */

  const toggleBasic = (def: IngredientDef) => {
    haptic(8);
    const rows = pantry.filter((p) => p.key === def.key);
    if (rows.length === 0) {
      put({ id: newId(), key: def.key, addedAt: new Date().toISOString() });
      return;
    }
    const real = rows.filter((r) => !isBareStaple(r));
    // Галочка — про «є / немає». Та коли під нею лежать справжні покупки, одним дотиком їх не викидаємо.
    if (real.length > 0) setBasicsAsk({ key: def.key, count: real.length });
    else removePantryType(def.key);
  };

  /* ── Контексти аркушів ────────────────────────────────────────────── */

  const pickerRow = picker?.kind === "row" ? pantry.find((p) => p.id === picker.rowId) : undefined;
  const pickerLine =
    picker?.kind === "line" ? review.receipt?.drafts.find((d) => d.id === picker.lineId) : undefined;

  /** Картка для «＋ Створити товар» у виборі — із тим, що вже відомо про рядок чи скан. */
  const prefillProduct = (): { draft?: ProductDraft; hints?: ProductHints } | undefined => {
    if (!picker) return undefined;
    if (picker.kind === "row" && pickerRow) {
      const base = namingDraft(pickerRow, brands);
      const raw = pickerRow.label ?? pickerRow.receiptName;
      return {
        draft: picker.draft
          ? { ...base, ...picker.draft, name: picker.draft.name || base.name, typeKey: picker.draft.typeKey || base.typeKey }
          : base,
        hints: raw ? productHints(raw, pickerRow.key, brands) : undefined,
      };
    }
    if (picker.kind === "line" && pickerLine) return { draft: lineDraft(pickerLine), hints: pickerLine.hints };
    if (picker.kind === "scan-wrong" && picker.ean) {
      return {
        draft: {
          typeKey: "",
          name: "",
          guessed: [],
          provenance: { from: "scan", ean: picker.ean, known: "product", label: picker.previous.name },
        },
      };
    }
    return undefined;
  };

  /** Картка з рядка чека: підказки назви, а поверх — етикетка з OFF, якщо її знайшли. */
  const lineDraft = (d: ReviewDraft): ProductDraft => {
    const base = productDraftFromLine(d);
    const off = lineDrafts.current.get(d.id);
    return off
      ? { ...base, ...off, name: off.name || base.name, typeKey: off.typeKey || base.typeKey, provenance: base.provenance }
      : base;
  };

  const pickerProps = (() => {
    if (!picker) return null;
    switch (picker.kind) {
      case "add":
        return {
          title: "Додати в комору",
          subtitle: undefined,
          initialQuery: picker.initialQuery,
          typeKeys: undefined,
          onPickProduct: addProduct,
          onPickType: (def: IngredientDef, typed?: ProductDraft) => addType(def, typed),
        };
      case "row": {
        if (!pickerRow) return null;
        const raw = pickerRow.label ?? pickerRow.receiptName;
        const hints = raw ? productHints(raw, pickerRow.key, brands) : null;
        return {
          title: picker.wrong ? "Не той товар?" : "Обрати товар",
          subtitle: pickerRow.receiptName
            ? `З чека: ${pickerRow.receiptName}`
            : pickerRow.barcode
              ? `Штрихкод ${pickerRow.barcode}`
              : pantryDisplayName(pickerRow, products),
          initialQuery:
            picker.draft?.name || hints?.suggestedName || pickerRow.label || ing(pickerRow.key).label,
          // «Обрати товар» шукає в родині типу рядка (B7); «Не той» — скрізь: могли помилитись і з типом.
          typeKeys: picker.wrong ? undefined : typeFamily(pickerRow.key),
          onPickProduct: (p: Product) => void linkRow(pickerRow, p),
          onPickType: (def: IngredientDef, typed?: ProductDraft) =>
            updatePantry(pickerRow.id, { key: def.key, productId: undefined, ...(typed?.name ? { label: typed.name } : {}) }),
        };
      }
      case "scan-wrong":
        return {
          title: "Що це за товар?",
          subtitle: `Штрихкод ${picker.code}`,
          initialQuery: undefined,
          typeKeys: undefined,
          onPickProduct: (p: Product) => {
            afterScanCard(p);
          },
          onPickType: (def: IngredientDef, typed?: ProductDraft) => addTypeFromScan(def, typed),
        };
      case "line": {
        if (!pickerLine) return null;
        return {
          title: "Що це за товар?",
          subtitle: pickerLine.line.name,
          initialQuery:
            pickerLine.hints?.suggestedName ??
            (pickerLine.ingredient ? receiptDisplayName(pickerLine.line.name, pickerLine.ingredient.key) : undefined),
          typeKeys: undefined,
          onPickProduct: (p: Product) => {
            upsertProducts([p]);
            review.pickProduct(pickerLine.id, p);
          },
          onPickType: (def: IngredientDef) => review.pickType(pickerLine.id, def),
        };
      }
    }
  })();

  /** Вибір на рядку, якого вже немає (прибрали з іншого пристрою), не відкриваємо. */
  const activePicker = picker && pickerProps ? pickerProps : null;

  /*
   * Розпізнавання фото зламане з нашого боку — і друге фото зламається так
   * само. Тут, як виняток, веземо до QR: якщо він на чеку є, це єдиний шлях,
   * що зараз працює, а якщо немає — людина просто закриє аркуш.
   */
  const photoBroken =
    receiptError?.from === "photo" &&
    (receiptError.reason === "misconfigured" || receiptError.reason === "nokey");

  const productForSheet = productSheetId ? (products[productSheetId] ?? null) : null;
  const productNames = useMemo(
    () => Object.fromEntries(Object.values(products).map((p) => [p.id, p.name])),
    [products],
  );

  return (
    <div className="pb-8">
      <TopBar
        back={false}
        title="Моя комора"
        subtitle={
          counts.items
            ? `${counts.items} ${plural(counts.items, "товар", "товари", "товарів")} · ${counts.types} ${plural(counts.types, "тип", "типи", "типів")}`
            : "Що є вдома"
        }
        right={
          <div className="flex items-center gap-2">
            {/* Список покупок — зворотний бік комори: те, чого в ній немає. */}
            <Link
              href="/shopping"
              onClick={() => haptic(8)}
              aria-label="Список покупок"
              className="relative grid h-10 w-10 place-items-center rounded-2xl bg-surface-2"
            >
              <ShoppingBasket size={18} />
              {toBuy > 0 && (
                <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[10px] font-extrabold text-brand-ink">
                  {toBuy}
                </span>
              )}
            </Link>
            {/* Сканер — найчастіший шлях у комору: без проміжного аркуша. */}
            <button
              onClick={() => {
                haptic(12);
                setScanOpen(true);
              }}
              aria-label="Сканувати штрихкод"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2"
            >
              <ScanBarcode size={18} />
            </button>
            <button
              onClick={() => {
                haptic(12);
                setAddSheet(true);
              }}
              aria-label="Додати продукт"
              className="grid h-10 w-10 place-items-center rounded-2xl brand-gradient text-brand-ink"
            >
              <Plus size={19} />
            </button>
          </div>
        }
      />

      {/* Вкладки: що приніс і що є з базового */}
      <div className="px-4 pt-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "stock", label: `У коморі (${counts.items})` },
            { value: "basics", label: `Базові (${basicsHave})` },
          ]}
        />
      </div>

      {tab === "stock" ? (
        <section className="px-4 pt-4">
          {!hydrated ? null : stock.length === 0 ? (
            <EmptyState
              emoji="🧊"
              title="Тут порожньо"
              note="Додай продукти кнопкою вгорі — скануванням штрихкоду, чека або зі списку."
              action={<Button onClick={() => setPicker({ kind: "add" })}>Додати продукт</Button>}
            />
          ) : (
            <PantryGroups
              grouping={grouping}
              displayName={displayName}
              shortName={shortName}
              canUseProducts={canUseProducts}
              onOpenRow={(row) => setItemId(row.id)}
              onRemoveRow={(row) => {
                removePantry(row.id);
                offerUndoRemove(row);
              }}
              onOpenGroup={(g) => setGroupKey(g.key)}
              onRefineRow={(row) => void chooseProduct(row)}
            />
          )}
        </section>
      ) : (
        /*
         * Базові продукти — не інвентар, а чеклист. Сіль і олія або є, або
         * немає; скільки саме їх лишилось, ніхто не рахує, і питати про це
         * означало б вимагати роботи заради нуля користі. Тому тут увесь
         * список одразу, а не лише те, що вже додано.
         */
        <section className="px-4 pt-4">
          <p className="text-[12.5px] leading-snug text-muted">
            Те, що зазвичай просто є вдома. Познач, чого бракує, — підбір страв за
            холодильником це врахує.
          </p>
          <div className="mt-4 flex flex-col gap-5">
            {basics.map(([cat, items]) => (
              <div key={cat}>
                <h3 className="mb-2.5 text-[12px] font-bold uppercase tracking-wide text-muted">
                  {CAT_LABEL[cat]}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {items.map((def) => {
                    const rows = pantry.filter((p) => p.key === def.key);
                    const have = rows.length > 0;
                    const real = rows.filter((r) => !isBareStaple(r));
                    /*
                     * Кількість тут не питаємо, але як що вже відома — з чека
                     * чи зі сканера, — показуємо. «2 кг» на пачці рису чек знає,
                     * і ховати це від людини сенсу немає.
                     */
                    const measured = rows.filter((r) => r.amount != null && r.unit);
                    const qty =
                      rows.length === 1
                        ? ingredientQtyLabel(rows[0])
                        : measured.length
                          ? formatSummed(sumQuantities(measured.map((r) => ({ amount: r.amount, unit: r.unit as Unit }))))
                          : "";
                    // Кілька справжніх покупок під однією галочкою — кажемо скільки: «Олія ✓ (2 товари)».
                    const several = real.length > 1 || real.some((r) => r.productId);
                    // Самої олії немає, але є її різновид — скажемо, щоб не купили зайве.
                    const variant = have
                      ? undefined
                      : pantry.find((p) => p.key !== def.key && satisfies(p.key, def.key));
                    return (
                      <button
                        key={def.key}
                        onClick={() => toggleBasic(def)}
                        aria-pressed={have}
                        className={`inline-flex items-center gap-1.5 rounded-full border py-2 pl-3 pr-3 text-[13px] font-semibold ${
                          have ? "border-mint/50 bg-mint/12" : "border-line bg-surface text-muted"
                        }`}
                      >
                        <span>{def.emoji}</span>
                        {def.label}
                        {qty && <span className="text-[11px] font-bold text-brand">{qty}</span>}
                        {variant && (
                          <span className="text-[11px] font-semibold text-mint">
                            є різновид: {ing(variant.key).label}
                          </span>
                        )}
                        {have && <Check size={13} className="text-mint" />}
                        {several && (
                          <span className="text-[11px] font-semibold text-muted">
                            ({real.length} {plural(real.length, "товар", "товари", "товарів")})
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Фото чека: камера на телефоні, галерея на столі */}
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleReceiptPhoto(file);
        }}
      />

      {/* Як додати продукт */}
      <Sheet open={addSheet} onClose={() => setAddSheet(false)} title="Додати продукт">
        <div className="flex flex-col gap-2 pb-4">
          <AddWay
            icon={<ScanBarcode size={19} />}
            title="Сканувати штрихкод"
            note="Наведи камеру на пачку — продукт знайдеться сам"
            onClick={() => {
              setAddSheet(false);
              setScanOpen(true);
            }}
          />
          <AddWay
            icon={<ReceiptText size={19} />}
            title="Сканувати чек"
            note="QR на касовому чеку — усі покупки одразу"
            onClick={() => {
              setAddSheet(false);
              setReceiptOpen(true);
            }}
          />
          {canReadPhoto && (
            <AddWay
              icon={<Camera size={19} />}
              title="Сфотографувати чек"
              note="Коли QR немає або він стерся — прочитаємо з фото"
              onClick={() => {
                setAddSheet(false);
                photoInput.current?.click();
              }}
            />
          )}
          <AddWay
            icon={<Plus size={19} />}
            title="Обрати зі списку"
            note={canUseProducts ? "Товар за назвою чи виробником — або просто тип" : "Пошук по каталогу продуктів"}
            onClick={() => {
              setAddSheet(false);
              setPicker({ kind: "add" });
            }}
          />
        </div>
      </Sheet>

      {/* Рядок комори: скільки є, до якого числа, який це товар */}
      <ItemSheet
        itemId={itemId}
        pantry={pantry}
        products={products}
        displayName={displayName}
        gramsOf={(row) => rowGrams(row, products)}
        canUseProducts={canUseProducts}
        updatePantry={updatePantry}
        removePantry={removePantry}
        onClose={() => setItemId(null)}
        onAddMore={() => {
          setItemId(null);
          setPicker({ kind: "add" });
        }}
        onRemoved={offerUndoRemove}
        onChooseProduct={canUseProducts ? (row) => void chooseProduct(row) : undefined}
        onWrongProduct={
          canUseProducts
            ? (row) => {
                setItemId(null);
                setPicker({ kind: "row", rowId: row.id, wrong: true });
              }
            : undefined
        }
        onOpenProduct={(id) => {
          setItemId(null);
          setProductSheetId(id);
        }}
        onEditType={(key) => {
          setItemId(null);
          setEditTypeKey(key);
        }}
      />

      {/* Група типу: «🥛 Молоко — 2 товари, разом 1,9 л» */}
      <PantryGroupSheet
        group={group}
        displayName={displayName}
        shortName={shortName}
        onClose={() => setGroupKey(null)}
        onOpenRow={(row) => {
          setGroupKey(null);
          setItemId(row.id);
        }}
        onAddMore={(g) => {
          setGroupKey(null);
          setPicker({ kind: "add", initialQuery: ing(g.key).label });
        }}
        onRecipes={(g) => {
          setGroupKey(null);
          router.push(`/decide/fridge?with=${encodeURIComponent(g.key)}`);
        }}
        onEditType={group && isOwnKey(group.key) ? (key) => setEditTypeKey(key) : undefined}
        onMergeType={
          group && isOwnKey(group.key) && canUseProducts
            ? (key) => {
                setGroupKey(null);
                setMergeTypeKey(key);
              }
            : undefined
        }
        mergedTypes={group && canUseProducts ? customIngredients.filter((d) => d.mergedInto === group.key) : []}
        onUnmergeType={canUseProducts ? (key) => void unmergeType(key) : undefined}
      />

      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetect={handleDetect} />

      {/* Сканер QR з чека */}
      <BarcodeScanner
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        onDetect={handleReceipt}
        formats={RECEIPT_FORMATS}
        hint="Наведи на QR-код унизу чека"
        manualEntry={false}
      />

      {/* Очікування відповіді податкової чи розпізнавання. Закрити аркуш —
          означає передумати: без цього людина до хвилини дивилась на
          спінер, який не можна прибрати, і це виглядало як завислий застосунок. */}
      <Sheet
        open={review.busy}
        onClose={review.cancel}
        title="Читаю чек"
        footer={
          <Button full variant="secondary" onClick={review.cancel}>
            Скасувати
          </Button>
        }
      >
        <div className="flex items-center gap-3 py-6">
          <Spinner />
          <p className="text-[14px] text-muted">
            {review.from === "photo"
              ? "Розбираю фото: назви, кількості, ціни…"
              : "Питаю податкову, що саме було в цьому чеку…"}
          </p>
        </div>
      </Sheet>

      {/* Не вдалося прочитати чек */}
      <Sheet
        open={!!receiptError}
        onClose={() => setReceiptError(null)}
        title="Чек не прочитався"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setReceiptError(null)}>
              Закрити
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                const from = receiptError?.from;
                setReceiptError(null);
                // Повертаємо туди, звідки прийшли: пропонувати QR тому, хто
                // щойно фотографував (бо QR на чеку й немає), — знущання.
                if (from === "photo" && !photoBroken) photoInput.current?.click();
                else setReceiptOpen(true);
              }}
            >
              {photoBroken
                ? "Сканувати QR"
                : receiptError?.from === "photo"
                  ? "Сфотографувати ще"
                  : "Сканувати ще"}
            </Button>
          </div>
        }
      >
        {receiptError && (
          <div className="pb-2">
            <p className="text-[14px] leading-relaxed">{receiptError.message}</p>
            {/* Для QR показуємо, що саме зчиталось: із цим уже можна щось
                зрозуміти. Для фото показувати нічого — знімок людина бачила
                на власні очі. */}
            {receiptError.from !== "photo" && (
              <>
                <p className="mt-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
                  Що зчиталося з коду
                </p>
                <p className="mt-1.5 break-all rounded-2xl bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-muted">
                  {receiptError.scanned.slice(0, 300) || "— порожньо —"}
                </p>
              </>
            )}
          </div>
        )}
      </Sheet>

      {/* Позиції чека */}
      <ReceiptReview
        review={review}
        products={products}
        canUseProducts={canUseProducts}
        onPick={(draft) => setPicker({ kind: "line", lineId: draft.id })}
        onCreateProduct={(draft) =>
          setEditor({ kind: "line", lineId: draft.id, draft: lineDraft(draft), hints: draft.hints })
        }
        onImport={() => void importReceipt()}
      />

      {/* Пошук товару за штрихкодом. База відповідає до 4 с, але звʼязок у
          магазині буває напівмертвим — закрити аркуш означає передумати. */}
      <Sheet
        open={scanLoading}
        onClose={() => {
          lookupSeq.current++;
          setScanLoading(false);
        }}
        title="Шукаю товар"
      >
        <div className="flex items-center gap-3 py-6">
          <Spinner />
          <p className="text-[14px] text-muted">
            {canUseProducts ? "Звіряю штрихкод зі спільними картками товарів…" : "Звіряю штрихкод з базою Open Food Facts…"}
          </p>
        </div>
      </Sheet>

      {/* Результат сканування */}
      <ScanResultSheet
        outcome={scan}
        pantry={pantry}
        onClose={() => setScan(null)}
        onScanMore={() => setScanOpen(true)}
        addPantry={(item) => put(item)}
        updatePantry={updatePantry}
        removePantry={removePantry}
        onWrongProduct={(outcome) => {
          setScan(null);
          const ctx = scanCtx.current;
          setPicker({ kind: "scan-wrong", code: outcome.code, ean: ctx?.ean ?? null, previous: outcome.product });
        }}
        onFillCard={(outcome) => {
          setScan(null);
          setEditor({ kind: "scan", draft: outcome.draft });
        }}
        onTypeOnly={(outcome) => {
          setScan(null);
          if (outcome.kind === "type") addTypeFromScan(ing(outcome.typeKey));
          else setTypePickerOpen(true);
        }}
        onOpenProduct={(id) => {
          setScan(null);
          setProductSheetId(id);
        }}
      />

      {/* «Лише тип» після скану */}
      <IngredientPicker
        open={typePickerOpen}
        onClose={() => setTypePickerOpen(false)}
        title="Що це за продукт?"
        onPick={(def) => addTypeFromScan(def)}
        onCreate={(name) => setCreatingType(name)}
      />

      <NewIngredientSheet
        open={creatingType !== null}
        initialName={creatingType ?? ""}
        onClose={() => setCreatingType(null)}
        onCreated={(def, { existing }) => {
          addTypeFromScan(def);
          // Обрали наявний тип замість нового — у каталог нічого не додалось.
          if (!existing) toast(`«${def.label}» тепер у каталозі`, "📦");
        }}
      />

      {/* Правка дописаного типу (F7) */}
      <NewIngredientSheet
        open={editTypeKey !== null}
        ingredient={editTypeKey && knownIngredient(editTypeKey) ? ing(editTypeKey) : null}
        onClose={() => setEditTypeKey(null)}
        onMerged={afterTypesMerged}
      />

      {/* Товари й типи: додати, обрати для рядка чи скану */}
      <ProductPicker
        open={!!activePicker}
        onClose={() => setPicker(null)}
        title={activePicker?.title}
        subtitle={activePicker?.subtitle}
        initialQuery={activePicker?.initialQuery ?? ""}
        typeKeys={activePicker?.typeKeys}
        onPickProduct={(p) => activePicker?.onPickProduct(p)}
        onPickType={(def, typed) => activePicker?.onPickType(def, typed)}
        recentProducts={recentProducts(products)}
        cachedProducts={Object.values(products)}
        pantry={pantry}
        onBarcode={picker?.kind === "add" ? (ean) => void handleDetect(ean) : undefined}
        prefillProduct={prefillProduct}
        saveLabel={picker?.kind === "add" || picker?.kind === "scan-wrong" ? "Зберегти й додати в комору" : "Зберегти"}
        onProductSaved={(p) => upsertProducts([p])}
      />

      {/* Редактор картки для скану й рядка чека */}
      <ProductEditorSheet
        open={!!editor}
        onClose={() => setEditor(null)}
        draft={editor?.draft ?? null}
        hints={editor?.kind === "line" ? editor.hints : null}
        saveLabel={editor?.kind === "scan" ? "Зберегти й додати в комору" : "Зберегти"}
        onSaved={(product) => {
          upsertProducts([product]);
          if (editor?.kind === "scan") afterScanCard(product);
          else if (editor?.kind === "line") review.pickProduct(editor.lineId, product);
        }}
        onAddAsType={(typeKey, typed) => {
          // Без звʼязку картку не зберегти — «Додати поки як «Молоко»?».
          if (editor?.kind === "scan") addTypeFromScan(ing(typeKey), typed);
          else if (editor?.kind === "line") review.pickType(editor.lineId, ing(typeKey));
          setEditor(null);
        }}
        onProductChanged={(p) => upsertProducts([p])}
      />

      {/* Картка товару (F3) */}
      <ProductSheet
        open={!!productForSheet}
        onClose={() => setProductSheetId(null)}
        product={productForSheet}
        productNames={productNames}
        onChanged={(p) => upsertProducts([p])}
        onMerged={afterProductsMerged}
        onUnmerged={(loser) => {
          void fetchProductsByIds([loser])
            .then((list) => useApp.getState().upsertProducts(list))
            .catch(() => {});
        }}
      />

      {/* Дублікат, знайдений на конфлікті штрихкоду (B10) */}
      <MergeSheet
        open={!!mergePair}
        onClose={() => setMergePair(null)}
        product={mergePair?.product ?? null}
        other={mergePair?.other ?? null}
        onMerged={afterProductsMerged}
      />

      {/* Дублікат дописаного типу (F8) */}
      <MergeSheet
        mode="types"
        open={mergeTypeKey !== null}
        onClose={() => setMergeTypeKey(null)}
        typeKey={mergeTypeKey}
        onMerged={afterTypesMerged}
      />

      {/* «Цей код зараз означає «Q»» — по одному */}
      <ConflictSheet
        prompt={prompts[0] ?? null}
        onClose={() => setPrompts((list) => list.slice(1))}
        onMerge={(product, other) => setMergePair({ product, other })}
      />

      {/* «Назвати» після чека */}
      <NamingSequence
        open={!!naming}
        rows={naming?.rows ?? []}
        pantry={pantry}
        extraBrands={brands}
        onLinked={(row, product) => linkRow(row, product, naming?.store)}
        onDone={({ named, total }) => {
          setNaming(null);
          if (named > 0) toast(`Названо ${named} з ${total}`, "✅");
        }}
      />

      {/* Базові: прибрати галочку, під якою лежать справжні покупки */}
      <Sheet
        open={!!basicsAsk}
        onClose={() => setBasicsAsk(null)}
        title={basicsAsk ? `${ing(basicsAsk.key).emoji} ${ing(basicsAsk.key).label}` : ""}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setBasicsAsk(null)}>
              Лишити
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                if (basicsAsk) removePantryType(basicsAsk.key);
                setBasicsAsk(null);
              }}
            >
              Прибрати
            </Button>
          </div>
        }
      >
        {basicsAsk && (
          <p className="pb-2 text-[14px] leading-relaxed">
            У коморі є {basicsAsk.count}{" "}
            {plural(basicsAsk.count, "товар", "товари", "товарів")} цього типу. Прибрати всі?
          </p>
        )}
      </Sheet>

      <ActionToast
        id={offer?.id}
        text={offer?.text ?? null}
        emoji={offer?.emoji}
        actionLabel={offer?.actionLabel ?? ""}
        onAction={() => offer?.onAction()}
        onDismiss={dismissOffer}
      />
    </div>
  );
}

/* ── Чек ──────────────────────────────────────────────────────────────── */

/**
 * Що сказати, коли чек не прочитався.
 *
 * Двома наборами, бо винуватці різні: QR іде в податкову, фото — у
 * розпізнавання. Писати «податкова не відповідає» тому, хто щойно
 * сфотографував чек, означало б послати його чекати того, що не станеться.
 */
const PHOTO_FAILURE: Partial<Record<ReceiptFailure, string>> = {
  upstream: "Розпізнавання не відповідає. Спробуй ще раз за кілька хвилин",
  /*
   * Без «спробуй пізніше»: зламане налаштування саме не минає, і людина
   * фотографувала б знову й знову. Чесніше сказати, що біда наша, і
   * показати шлях, який працює й без розпізнавання.
   */
  misconfigured:
    "Розпізнавання фото зараз зламане з нашого боку — нове фото не допоможе. Якщо на чеку є QR-код, відскануй його",
  noitems: "На фото не видно жодного товару. Спробуй зняти весь чек цілком",
  notfound: "На фото не видно чека",
};

const RECEIPT_FAILURE: Record<ReceiptFailure, string> = {
  notfound: "Податкова не знайшла такого чека",
  noitems: "У цьому чеку немає списку товарів",
  upstream: "Податкова не відповідає — спробуй пізніше",
  offline: "Немає звʼязку — чек читається тільки онлайн",
  throttled: "Забагато спроб поспіль. Спробуй пізніше",
  nokey: "Розпізнавання фото ще не налаштоване — немає ключа Gemini",
  unauthorized: "Схоже, сесія застаріла. Онови сторінку й спробуй ще раз",
  unreadable: "На фото не видно чека. Спробуй зняти рівніше й ближче",
  toobig: "Знімок завеликий. Сфотографуй чек ще раз — камера дасть менший файл",
  toolong: "Чек задовгий, щоб прочитати його одним знімком. Сфотографуй його частинами",
  misconfigured: "Читання чеків зараз не працює — це збій у нас. Спробуй пізніше",
  // Аркуш невдачі на скасування не відкривається; рядок тут лише для повноти.
  cancelled: "Скасовано",
};

/** Рядок з resolve.ts → рядок списку: тип стає IngredientDef, решта як є. */
function reviewDraftOf(line: ResolvedReceiptLine): ReviewDraft {
  return {
    id: line.id,
    line: line.line,
    ingredient: line.typeKey && knownIngredient(line.typeKey) ? ing(line.typeKey) : null,
    nonFood: line.nonFood,
    amount: line.amount,
    unit: line.unit,
    hints: line.hints,
    resolution: line.resolution,
    ...(line.product ? { product: line.product } : {}),
  };
}

/**
 * Пізня відповідь бази для рядка. Тип і кількість мерджер списку прийме лише
 * від справжнього збігу (resolution.hit): здогадка не переписує того, що
 * рядок уже має, — лише додає «Схоже на».
 */
function reviewPatch(line: ResolvedReceiptLine): Partial<ReviewDraft> {
  return {
    ...(line.typeKey && knownIngredient(line.typeKey) ? { ingredient: ing(line.typeKey) } : {}),
    amount: line.amount,
    unit: line.unit,
    hints: line.hints,
    resolution: line.resolution,
    ...(line.product ? { product: line.product } : {}),
  };
}

/** «Нещодавні товари»: картки з кешу, свіжіші першими, без прибраних і злитих. */
function recentProducts(products: Readonly<Record<string, Product>>): Product[] {
  return Object.values(products)
    .filter((p) => !p.archived && !p.mergedInto)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, 12);
}

/** Один зі способів покласти продукт у комору. */
function AddWay({
  icon,
  title,
  note,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left active:bg-surface-2"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-brand">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-bold">{title}</span>
        <span className="block text-[11.5px] leading-snug text-muted">{note}</span>
      </span>
    </button>
  );
}
