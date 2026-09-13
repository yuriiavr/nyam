"use client";

import { Plus, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IngredientPicker } from "@/components/IngredientPicker";
import { EditTypeButton } from "@/components/EditTypeButton";
import { NewIngredientSheet } from "@/components/NewIngredientSheet";
import { Button, Sheet } from "@/components/ui";
import { ancestors, descendants, ing, knownIngredient, lineage } from "@/data/ingredients";
import {
  type PackUnit,
  type Product,
  type ProductDraft,
  type ProductHints,
} from "@/lib/product-types";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchProductsByIds,
  saveProduct,
  searchProducts,
  toCatalogError,
} from "@/lib/supabase/products-api";
import type { Nutrition, Unit } from "@/lib/types";
import { formatNumber, formatQuantity } from "@/lib/units";
import { cn, haptic } from "@/lib/utils";

/*
 * Редактор спільної картки товару (F3) — замінив колишній ProductCardSheet.
 *
 * Картка одна на всіх: правку бачать усі, і кожна пишеться в історію. Тому
 * тут три принципи, які легко зламати дрібною «зручністю»:
 * - нічого з підказок (чек, Open Food Facts, евристики) не записується без
 *   натиску «Зберегти» — здогадки лише підсвічені, а не прийняті;
 * - клавіатура не відкривається сама: людина спершу бачить, що вже заповнено,
 *   і часто їй лишається тільки погодитись;
 * - дублікат ніколи не мовчазний: база повертає `duplicate`, і ми питаємо
 *   «Це він?», а не створюємо другу «Галичину 2,5%».
 *
 * Дрібні помічники для інших аркушів каталогу (ProductSheet, HistorySheet,
 * ProductPicker, MergeSheet) живуть тут же: це базовий модуль, від якого вони
 * залежать, і так немає циклу імпортів.
 */

/* ── Спільні помічники каталогу ───────────────────────────────────────── */

const PACK_UNITS: PackUnit[] = ["g", "kg", "ml", "l", "pcs"];

/** «900 мл» — або порожньо, якщо упаковки немає. */
export function packLabel(p: { packAmount?: number; packUnit?: PackUnit }): string {
  return p.packAmount != null && p.packUnit ? formatQuantity(p.packAmount, p.packUnit) : "";
}

/** «Галичина · 900 мл · жирність 2,5%» — те, що під назвою на картці. */
export function productMeta(p: Pick<Product, "brand" | "packAmount" | "packUnit" | "fatPct">): string {
  return [p.brand, packLabel(p), p.fatPct != null ? `жирність ${formatNumber(p.fatPct, 1)}%` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** «Молоко безлактозне › Молоко» — як рецепти рахують цей тип. */
export function typeTrail(key: string): string {
  return lineage(key)
    .map((k) => ing(k).label)
    .join(" › ");
}

/** «52 ккал · Б 3 · Ж 2,5 · В 4,7». */
export function nutritionLine(n: Nutrition): string {
  return `${formatNumber(n.kcal, 1)} ккал · Б ${formatNumber(n.protein, 1)} · Ж ${formatNumber(n.fat, 1)} · В ${formatNumber(n.carbs, 1)}`;
}

/** «12.09», а для минулих років — «12.09.2025». */
export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return d.getFullYear() === now.getFullYear() ? `${dd}.${mm}` : `${dd}.${mm}.${d.getFullYear()}`;
}

/**
 * Чи є звʼязок — з підпискою на зміни. navigator.onLine часом бреше «онлайн»,
 * тому це лише перший фільтр: справжню відповідь дає помилка `offline` з RPC.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Тип товару разом із предками й різновидами — для пошуку «того самого» серед карток. */
export function typeFamily(key: string): string[] {
  return key && knownIngredient(key) ? [key, ...ancestors(key), ...descendants(key)] : [];
}

/**
 * Питання «точно?» для дій, які бачать усі (прибрати картку, повернути версію).
 * Окремим аркушем у стосі, а не window.confirm: той у PWA на iOS виглядає
 * чужим і блокує анімації.
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Скасувати
          </Button>
          <Button variant={danger ? "danger" : "primary"} className="flex-1" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {body && <div className="pb-3 text-[14px] leading-relaxed text-muted">{body}</div>}
    </Sheet>
  );
}

export function Field({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-muted">
      {children}
      {note}
    </p>
  );
}

/** Позначка «здогадка» біля назви поля. */
function Guess() {
  return (
    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10.5px] font-semibold normal-case tracking-normal text-brand">
      здогадка
    </span>
  );
}

/* ── Числа з полів ────────────────────────────────────────────────────── */

/** undefined — поле порожнє; NaN — щось написано, але це не число. */
function parseField(raw: string): number | undefined {
  const t = raw.trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const str = (n: number | undefined) => (n == null ? "" : String(n).replace(".", ","));

/** Одиниця упаковки за типовою мірою типу: молоко — мл, яйця — штуки, решта — грами. */
function packUnitFor(typeKey: string): PackUnit {
  const unit: Unit | undefined = typeKey ? ing(typeKey).defaultUnit : undefined;
  if (unit === "ml" || unit === "l") return "ml";
  if (unit === "pcs") return "pcs";
  return "g";
}

/* ── Редактор ─────────────────────────────────────────────────────────── */

type Guessed = NonNullable<ProductDraft["guessed"]>[number];

/** Прапорець «пояснення про спільні картки вже бачили» — на пристрій, не на акаунт. */
const NOTICE_KEY = "nyam:catalog-edit-notice";

function noticeSeen(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) !== null;
  } catch {
    return true;
  }
}

function markNoticeSeen() {
  try {
    localStorage.setItem(NOTICE_KEY, new Date().toISOString());
  } catch {
    /* приватний режим — пояснення просто покажеться ще раз */
  }
}

export type ProductSaveOutcome = "created" | "updated" | "picked";

interface Form {
  name: string;
  brand: string;
  pack: string;
  packUnit: PackUnit;
  fat: string;
  perPiece: string;
  kcal: string;
  protein: string;
  fatG: string;
  carbs: string;
  typeKey: string;
}

function formFrom(p: Partial<ProductDraft>): Form {
  return {
    name: p.name ?? "",
    brand: p.brand ?? "",
    pack: str(p.packAmount),
    packUnit: p.packUnit ?? packUnitFor(p.typeKey ?? ""),
    fat: str(p.fatPct),
    perPiece: str(p.gramsPerPiece),
    kcal: str(p.nutrition?.kcal),
    protein: str(p.nutrition?.protein),
    fatG: str(p.nutrition?.fat),
    carbs: str(p.nutrition?.carbs),
    typeKey: p.typeKey ?? "",
  };
}

function productToDraft(p: Product): ProductDraft {
  return {
    typeKey: p.typeKey,
    name: p.name,
    brand: p.brand,
    fatPct: p.fatPct,
    packAmount: p.packAmount,
    packUnit: p.packUnit,
    gramsPerPiece: p.gramsPerPiece,
    nutrition: p.nutrition,
    image: p.image,
    source: p.source === "migration" ? undefined : p.source,
  };
}

/**
 * Що підставити в нову картку: явна чернетка (OFF, тип зі скану) перемагає,
 * підказки з назви (C) заповнюють лише порожнє. Усе, що прийшло з підказок,
 * позначаємо здогадкою.
 */
function prefill(draft: ProductDraft | null | undefined, hints: ProductHints | null | undefined) {
  const d: Partial<ProductDraft> = { ...(draft ?? {}) };
  const guessed = new Set<Guessed>(draft?.guessed ?? []);
  if (hints) {
    if (!d.typeKey && hints.typeKey) {
      d.typeKey = hints.typeKey;
      if (hints.guessed.includes("type")) guessed.add("type");
    }
    if (!d.name && hints.suggestedName) {
      d.name = hints.suggestedName;
      guessed.add("name");
    }
    if (!d.brand && hints.brand) {
      d.brand = hints.brand;
      if (hints.guessed.includes("brand")) guessed.add("brand");
    }
    // Ваговий товар упаковки не має — навіть якщо в назві знайшлось число.
    if (d.packAmount == null && !hints.weighed && hints.packAmount != null && hints.packUnit) {
      d.packAmount = hints.packAmount;
      d.packUnit = hints.packUnit;
      if (hints.packGuessed || hints.guessed.includes("pack")) guessed.add("pack");
    }
    if (d.fatPct == null && hints.fatPct != null) {
      d.fatPct = hints.fatPct;
      if (hints.guessed.includes("fat")) guessed.add("fat");
    }
  }
  return { form: formFrom(d), guessed, draft: d };
}

function provenanceText(p: ProductDraft["provenance"]): string | null {
  if (!p) return null;
  if (p.from === "scan") {
    // Кажемо лише те, що база справді відповіла: «ніхто не знає» — тільки на промах.
    if (p.known === "none") return "Цей штрихкод ще ніхто не знає";
    if (p.known === "type") return p.label ? `Цей штрихкод знають лише як «${p.label}» — картка зробить його товаром` : `Штрихкод ${p.ean} знають лише як тип`;
    if (p.known === "product") return p.label ? `Цей штрихкод зараз означає «${p.label}»` : `Штрихкод ${p.ean} уже означає інший товар`;
    return `Штрихкод ${p.ean}`;
  }
  if (p.from === "off") return "З Open Food Facts";
  if (p.from === "receipt") return `З чека: ${p.raw}`;
  return null;
}

/**
 * Створення (без `product`) або правка (з `product`) спільної картки.
 *
 * Батьківський екран сам вирішує, що робити з готовою карткою: додати в
 * комору, навчити штрихкод чи назву з чека (teach.ts), оновити кеш стору.
 * Редактор лише зберігає і повертає `onSaved(product, outcome)`:
 * - `created` / `updated` — записано;
 * - `picked` — людина погодилась, що це вже наявна картка («Так, це він»
 *   на дублікаті чи «Це він» у «Можливо, це вже є:»). Нічого не записано.
 *
 * У локальному режимі (без Supabase) карток товарів немає — аркуш не рендериться.
 */
export function ProductEditorSheet({
  open,
  onClose,
  product = null,
  draft = null,
  hints = null,
  title,
  saveLabel,
  skipLabel,
  onSkip,
  onSaved,
  onProductChanged,
  onAddAsType,
  onDuplicate,
}: {
  /** Замість «Новий товар» / «Редагувати товар» — скажімо, «Назвати товар · 1 з 3». */
  title?: string;
  /** Друга кнопка поруч зі збереженням (NamingSequence: «Пропустити»). */
  skipLabel?: string;
  onSkip?: () => void;
  open: boolean;
  onClose: () => void;
  /** Правка цієї картки. Немає — нова. */
  product?: Product | null;
  /** Заповнення нової картки: OFF, тип зі скану, назва з пошуку, provenance. */
  draft?: ProductDraft | null;
  /** Підказки з сирої назви (product-hints.ts): заповнюють лише порожнє. */
  hints?: ProductHints | null;
  /** «Зберегти й додати в комору» там, де збереження одразу кладе в комору. */
  saveLabel?: string;
  onSaved: (product: Product, outcome: ProductSaveOutcome) => void;
  /** Свіжа версія картки після конфлікту — щоб стор оновив кеш. */
  onProductChanged?: (product: Product) => void;
  /** Офлайн: «Додати поки як «Молоко»?» — рядок лише з типом. Немає — кнопку не показуємо. */
  onAddAsType?: (typeKey: string, draft: ProductDraft) => void;
  /** Правка перейменувала картку в уже наявну: запропонувати обʼєднання (I6). */
  onDuplicate?: (existing: Product) => void;
}) {
  const online = useOnline();
  const nameRef = useRef<HTMLInputElement>(null);

  /** Картка, яку правимо, — оновлюється свіжою версією після конфлікту. */
  const [base, setBase] = useState<Product | null>(product);
  const [form, setForm] = useState<Form>(() => formFrom({}));
  const [guessed, setGuessed] = useState<Set<Guessed>>(new Set());
  const [source, setSource] = useState<ProductDraft["source"]>(undefined);
  const [image, setImage] = useState<string | undefined>(undefined);
  const [showNutrition, setShowNutrition] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<
    | { kind: "duplicate"; existing: Product }
    | { kind: "offline" }
    | { kind: "error"; text: string }
    | null
  >(null);
  const [similar, setSimilar] = useState<Product[]>([]);
  const [picking, setPicking] = useState(false);
  const [creatingType, setCreatingType] = useState<string | null>(null);
  const [showNotice, setShowNotice] = useState(false);

  /*
   * Скидаємо стан на відкритті й коли прийшла справді інша картка — за
   * змістом, а не за обʼєктом: батько може перемальовуватись із новим
   * обʼєктом draft посеред набору, і тоді щойно введене зникало б під
   * пальцями. А черга «Назвати» (1 з 3) тримає аркуш відкритим і лише міняє
   * чернетку — без підпису наступний рядок відкрився б із полями попереднього.
   */
  const resetKey = product
    ? `p:${product.id}`
    : `d:${JSON.stringify([draft?.name, draft?.typeKey, draft?.provenance, hints?.suggestedName, hints?.typeKey])}`;
  useEffect(() => {
    if (!open) return;
    if (product) {
      setBase(product);
      setForm(formFrom(productToDraft(product)));
      setGuessed(new Set());
      setSource(productToDraft(product).source);
      setImage(product.image);
      setShowNutrition(Boolean(product.nutrition));
    } else {
      const p = prefill(draft, hints);
      setBase(null);
      setForm(p.form);
      setGuessed(p.guessed);
      setSource(p.draft.source);
      setImage(p.draft.image);
      setShowNutrition(Boolean(p.draft.nutrition));
    }
    setTried(false);
    setSaving(false);
    setProblem(null);
    setSimilar([]);
    setShowNotice(!noticeSeen());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetKey]);

  const set = <K extends keyof Form>(key: K, value: Form[K], clears?: Guessed) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (clears && guessed.has(clears)) {
      setGuessed((g) => {
        const next = new Set(g);
        next.delete(clears);
        return next;
      });
    }
    if (problem?.kind === "duplicate" || problem?.kind === "error") setProblem(null);
  };

  /* ── Перевірка — ті самі межі, що в products (A2) ── */

  const check = useMemo(() => {
    const errors: Partial<Record<"name" | "brand" | "pack" | "fat" | "perPiece" | "nutrition" | "type", string>> = {};
    const name = form.name.replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 120) errors.name = "Назва — від 2 до 120 символів.";
    const brand = form.brand.replace(/\s+/g, " ").trim();
    if (brand.length > 60) errors.brand = "Виробник — до 60 символів.";

    const pack = parseField(form.pack);
    if (pack != null && !(pack > 0 && pack <= 100000)) errors.pack = "Упаковка — число більше нуля, до 100 000.";

    const fatPct = parseField(form.fat);
    if (fatPct != null && !(fatPct >= 0 && fatPct <= 100)) errors.fat = "Жирність — від 0 до 100 %.";

    const perPiece = form.packUnit === "pcs" ? parseField(form.perPiece) : undefined;
    if (perPiece != null && !(perPiece > 0 && perPiece <= 100000)) errors.perPiece = "Вага штуки — число більше нуля.";

    const kcal = parseField(form.kcal);
    const macros = [parseField(form.protein), parseField(form.fatG), parseField(form.carbs)];
    let nutrition: Nutrition | undefined;
    if (kcal == null) {
      // products_nutrition_whole: БЖВ без калорій база не прийме.
      if (macros.some((m) => m != null)) errors.nutrition = "Без калорій БЖВ не збережуться — впиши й ккал.";
    } else if (!(kcal >= 0 && kcal <= 900)) {
      errors.nutrition = "У 100 г — від 0 до 900 ккал. Перевір кому.";
    } else if (macros.some((m) => m != null && !(m >= 0 && m <= 100))) {
      errors.nutrition = "Білки, жири й вуглеводи — від 0 до 100 г кожне.";
    } else if (macros.reduce<number>((s, m) => s + (m ?? 0), 0) > 105) {
      errors.nutrition = "Білки, жири й вуглеводи разом не важать більше за самі 100 грамів. Перевір кому.";
    } else {
      nutrition = { kcal, protein: macros[0] ?? 0, fat: macros[1] ?? 0, carbs: macros[2] ?? 0 };
    }

    if (!form.typeKey || !knownIngredient(form.typeKey)) errors.type = "Обери тип — без нього рецепти не порахують товар.";

    const draftOut: ProductDraft = {
      typeKey: form.typeKey,
      name,
      brand: brand || undefined,
      fatPct: fatPct != null && Number.isFinite(fatPct) ? Math.round(fatPct * 10) / 10 : undefined,
      ...(pack != null && Number.isFinite(pack) ? { packAmount: Math.round(pack * 100) / 100, packUnit: form.packUnit } : {}),
      gramsPerPiece: perPiece != null && Number.isFinite(perPiece) ? perPiece : undefined,
      nutrition,
      image,
      source,
    };
    return { errors, ok: Object.keys(errors).length === 0, draft: draftOut };
  }, [form, image, source]);

  /* ── «Можливо, це вже є:» — лише для нової картки й зі звʼязком ── */

  const similarQuery = `${form.name} ${form.brand}`.replace(/\s+/g, " ").trim();
  useEffect(() => {
    if (!open || base || !online || !isSupabaseConfigured || similarQuery.length < 3) {
      setSimilar([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const types = typeFamily(form.typeKey);
      searchProducts(similarQuery, types.length ? types : null, 3, ctrl.signal)
        .then((found) => {
          if (!ctrl.signal.aborted) setSimilar(found.slice(0, 3));
        })
        // Підказка, не обовʼязок: без неї редактор працює так само.
        .catch(() => {});
    }, 500);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, base, online, similarQuery, form.typeKey]);

  if (!isSupabaseConfigured) return null;

  const pick = (existing: Product) => {
    haptic(12);
    onSaved(existing, "picked");
    onClose();
  };

  const save = async () => {
    setTried(true);
    if (!check.ok || saving) {
      haptic([10, 40, 10]);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setProblem({ kind: "offline" });
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const result = await saveProduct(base?.id ?? null, base?.version ?? null, check.draft);
      if (result.status === "duplicate" && result.product.id !== base?.id) {
        setProblem({ kind: "duplicate", existing: result.product });
        return;
      }
      markNoticeSeen();
      haptic(14);
      onSaved(result.product, base ? "updated" : "created");
      onClose();
    } catch (error) {
      const e = toCatalogError(error);
      if (e.code === "offline") {
        setProblem({ kind: "offline" });
      } else if (e.code === "conflict" && base) {
        /*
         * Хтось зберіг раніше. Показуємо свіжу версію, а не зливаємо мовчки:
         * злиття двох правок однієї назви вгадало б лише одну з них. Людина
         * бачить, що змінилось, і вносить свою правку ще раз — тепер уже з
         * правильним номером версії.
         */
        const fresh = await fetchProductsByIds([base.id])
          .then((list) => list.find((p) => p.id === base.id) ?? null)
          .catch(() => null);
        if (fresh) {
          setBase(fresh);
          setForm(formFrom(productToDraft(fresh)));
          setShowNutrition(Boolean(fresh.nutrition));
          onProductChanged?.(fresh);
        }
        setProblem({ kind: "error", text: e.message });
      } else if (e.code === "duplicate") {
        // Правка, що зіткнулась з унікальністю поза статусом (restore-подібний шлях).
        setProblem({ kind: "error", text: "Така картка вже є — зміни назву, виробника чи упаковку." });
      } else {
        setProblem({ kind: "error", text: e.message });
      }
    } finally {
      setSaving(false);
    }
  };

  // Порожні назву й тип лаємо лише після спроби зберегти: нова картка й так починається з них.
  const err = (key: keyof typeof check.errors) =>
    tried || (key !== "name" && key !== "type") ? check.errors[key] : undefined;
  const guessCls = (g: Guessed) =>
    guessed.has(g) ? "border-dashed border-brand/60 underline decoration-dotted underline-offset-4" : "border-line";
  const inputCls = "h-11 w-full rounded-2xl border bg-surface px-3.5 text-[15px]";
  const provenance = base ? null : provenanceText(draft?.provenance);
  const typeLabel = form.typeKey && knownIngredient(form.typeKey) ? ing(form.typeKey).label : "";

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={title ?? (base ? "Редагувати товар" : "Новий товар")}
        footer={
          <div className="flex gap-2">
            {onSkip && (
              <Button variant="secondary" className="flex-1" onClick={onSkip} disabled={saving}>
                {skipLabel ?? "Пропустити"}
              </Button>
            )}
            <Button className="flex-1" onClick={save} loading={saving}>
              {saveLabel ?? "Зберегти"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          {provenance && (
            <p className="rounded-2xl bg-surface-2 px-3.5 py-3 text-[12.5px] leading-snug text-muted">
              {provenance}
            </p>
          )}

          {showNotice && (
            <p className="rounded-2xl border border-brand/30 bg-brand/5 px-3.5 py-3 text-[12.5px] leading-snug">
              Картки товарів спільні: правку побачать усі. Кожна зміна пишеться в історію, і її можна повернути.
            </p>
          )}

          {problem && <ProblemBlock problem={problem} typeLabel={typeLabel} onPick={pick} onRename={() => {
            setProblem(null);
            nameRef.current?.focus();
          }} onAddAsType={
            onAddAsType && form.typeKey && knownIngredient(form.typeKey)
              ? () => {
                  onAddAsType(form.typeKey, check.draft);
                  onClose();
                }
              : undefined
          } onDuplicate={base && onDuplicate ? onDuplicate : undefined} editing={!!base} />}

          <div>
            <Field note={guessed.has("name") ? <Guess /> : null}>Назва</Field>
            <input
              ref={nameRef}
              value={form.name}
              onChange={(e) => set("name", e.target.value, "name")}
              placeholder="Молоко безлактозне Галичина 2,5%"
              maxLength={140}
              className={cn(inputCls, guessCls("name"))}
            />
            {err("name") ? (
              <p className="mt-1.5 text-[11.5px] leading-snug text-berry">{err("name")}</p>
            ) : (
              <p className="mt-1.5 text-[11px] leading-snug text-faint">
                Так, як сказала б людина, а не каса: без скорочень.
              </p>
            )}
          </div>

          {similar.length > 0 && !problem && (
            <div className="rounded-2xl border border-line bg-surface px-3.5 py-3">
              <p className="mb-2 text-[12px] font-bold text-muted">Можливо, це вже є:</p>
              <div className="flex flex-col gap-2">
                {similar.map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5">
                    <span className="text-lg">{ing(p.typeKey).emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold">{p.name}</span>
                      {productMeta(p) && (
                        <span className="block truncate text-[11.5px] text-muted">{productMeta(p)}</span>
                      )}
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => pick(p)}>
                      Це він
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <Field note={guessed.has("brand") ? <Guess /> : null}>Виробник</Field>
            <input
              value={form.brand}
              onChange={(e) => set("brand", e.target.value, "brand")}
              placeholder="Галичина"
              maxLength={80}
              className={cn(inputCls, guessCls("brand"))}
            />
            {err("brand") && <p className="mt-1.5 text-[11.5px] leading-snug text-berry">{err("brand")}</p>}
          </div>

          <div>
            <Field note={guessed.has("type") ? <Guess /> : null}>Тип</Field>
            <div className="flex gap-2">
              <button
                onClick={() => setPicking(true)}
                className={cn(
                  "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border bg-surface px-3.5 py-2 text-left text-[14px]",
                  guessCls("type"),
                )}
              >
                {typeLabel ? (
                  <>
                    <span className="text-lg">{ing(form.typeKey).emoji}</span>
                    <span className="min-w-0 flex-1 truncate font-bold">{typeTrail(form.typeKey)}</span>
                    <span className="shrink-0 text-[12px] font-bold text-brand">змінити</span>
                  </>
                ) : (
                  <span className="text-faint">Обрати тип</span>
                )}
              </button>
              <button
                onClick={() => setCreatingType(form.name.trim())}
                aria-label="Новий тип"
                className="flex h-11 shrink-0 items-center gap-1 rounded-2xl bg-surface-2 px-3 text-[12.5px] font-bold text-brand"
              >
                <Plus size={14} /> Новий тип
              </button>
            </div>
            {err("type") ? (
              <p className="mt-1.5 text-[11.5px] leading-snug text-berry">{err("type")}</p>
            ) : (
              <p className="mt-1.5 text-[11px] leading-snug text-faint">
                Рецепти рахують товар за типом: рецепту з «Молоко» підійде й «Молоко безлактозне». Навпаки — ні.
              </p>
            )}
            {/* Дописаний тип із хибним батьком виправляють тут же, а не лише з комори. */}
            <EditTypeButton typeKey={form.typeKey} className="mt-1" />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="min-w-0">
              <Field note={guessed.has("pack") ? <Guess /> : null}>Упаковка</Field>
              <div className="flex items-center gap-1.5">
                <input
                  value={form.pack}
                  onChange={(e) => set("pack", e.target.value.replace(/[^\d.,]/g, ""), "pack")}
                  inputMode="decimal"
                  placeholder="900"
                  aria-label="Скільки в упаковці"
                  className={cn("h-11 w-full min-w-0 rounded-2xl border bg-surface px-3 text-center text-[15px]", guessCls("pack"))}
                />
                <select
                  value={form.packUnit}
                  onChange={(e) => set("packUnit", e.target.value as PackUnit, "pack")}
                  aria-label="Одиниця упаковки"
                  className="h-11 w-[72px] shrink-0 rounded-2xl bg-surface-2 px-1.5 text-center text-[13px] font-semibold"
                >
                  {PACK_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {formatQuantity(undefined, u)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="w-[96px]">
              <Field note={guessed.has("fat") ? <Guess /> : null}>Жирність, %</Field>
              <input
                value={form.fat}
                onChange={(e) => set("fat", e.target.value.replace(/[^\d.,]/g, ""), "fat")}
                inputMode="decimal"
                placeholder="2,5"
                aria-label="Жирність у відсотках"
                className={cn(inputCls, "px-2 text-center", guessCls("fat"))}
              />
            </div>
          </div>
          {(err("pack") || err("fat")) && (
            <p className="-mt-2 text-[11.5px] leading-snug text-berry">{err("pack") ?? err("fat")}</p>
          )}

          {form.packUnit === "pcs" && (
            <div>
              <Field>Грамів в одній штуці</Field>
              <input
                value={form.perPiece}
                onChange={(e) => set("perPiece", e.target.value.replace(/[^\d.,]/g, ""))}
                inputMode="decimal"
                placeholder="60"
                className={cn(inputCls, "border-line")}
              />
              <p className={cn("mt-1.5 text-[11px] leading-snug", err("perPiece") ? "text-berry" : "text-faint")}>
                {err("perPiece") ?? "Щоб «6 шт» стали грамами для калорій і рецептів."}
              </p>
            </div>
          )}

          {showNutrition ? (
            <div>
              <Field>КБЖВ на 100 г</Field>
              <div className="grid grid-cols-4 gap-2">
                <NumField value={form.kcal} onChange={(v) => set("kcal", v)} label="ккал" />
                <NumField value={form.protein} onChange={(v) => set("protein", v)} label="білки" />
                <NumField value={form.fatG} onChange={(v) => set("fatG", v)} label="жири" />
                <NumField value={form.carbs} onChange={(v) => set("carbs", v)} label="вугл." />
              </div>
              <p className={cn("mt-1.5 text-[11px] leading-snug", err("nutrition") ? "text-berry" : "text-faint")}>
                {err("nutrition") ?? "З етикетки, збоку. Можна лишити порожнім — вигадані калорії гірші за відсутні."}
              </p>
            </div>
          ) : (
            <button onClick={() => setShowNutrition(true)} className="self-start text-[13px] font-bold text-brand">
              ＋ КБЖВ з етикетки
            </button>
          )}
        </div>
      </Sheet>

      <IngredientPicker
        open={picking}
        onClose={() => setPicking(false)}
        title="Тип товару"
        onPick={(def) => {
          set("typeKey", def.key, "type");
          // Упаковку ще не вводили — міра за типом: молоко в мл, яйця в штуках.
          if (!form.pack) setForm((f) => ({ ...f, typeKey: def.key, packUnit: packUnitFor(def.key) }));
        }}
        onCreate={(typed) => {
          setPicking(false);
          setCreatingType(typed || form.name.trim());
        }}
      />

      <NewIngredientSheet
        open={creatingType !== null}
        initialName={creatingType ?? ""}
        onClose={() => setCreatingType(null)}
        onCreated={(def) => {
          set("typeKey", def.key, "type");
          if (!form.pack) setForm((f) => ({ ...f, typeKey: def.key, packUnit: packUnitFor(def.key) }));
        }}
      />
    </>
  );
}

function ProblemBlock({
  problem,
  typeLabel,
  editing,
  onPick,
  onRename,
  onAddAsType,
  onDuplicate,
}: {
  problem: { kind: "duplicate"; existing: Product } | { kind: "offline" } | { kind: "error"; text: string };
  typeLabel: string;
  editing: boolean;
  onPick: (p: Product) => void;
  onRename: () => void;
  onAddAsType?: () => void;
  onDuplicate?: (existing: Product) => void;
}) {
  const box = "rounded-2xl border px-3.5 py-3 text-[12.5px] leading-snug";
  if (problem.kind === "duplicate") {
    const p = problem.existing;
    const pack = packLabel(p);
    return (
      <div className={cn(box, "border-brand/40 bg-brand/5")}>
        <p>
          Такий товар уже є: «{p.name}»{pack ? ` · ${pack}` : ""}.{" "}
          {editing ? "Змінити назву чи обʼєднати картки?" : "Це він?"}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {editing ? (
            onDuplicate && (
              <Button size="sm" variant="secondary" onClick={() => onDuplicate(p)}>
                Обʼєднати
              </Button>
            )
          ) : (
            <Button size="sm" onClick={() => onPick(p)}>
              Так, це він
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onRename}>
            Змінити назву
          </Button>
        </div>
      </div>
    );
  }
  if (problem.kind === "offline") {
    return (
      <div className={cn(box, "border-line bg-surface-2")}>
        <p>
          Картку товару можна зберегти, коли є звʼязок.
          {onAddAsType && typeLabel ? ` Додати поки як «${typeLabel}»?` : ""}
        </p>
        {onAddAsType && typeLabel && (
          <div className="mt-2.5">
            <Button size="sm" variant="secondary" onClick={onAddAsType}>
              Додати як тип
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={cn(box, "flex items-start gap-2 border-berry/30 bg-berry/10 text-berry")}>
      <TriangleAlert size={15} className="mt-0.5 shrink-0" />
      <p>{problem.text}</p>
    </div>
  );
}

function NumField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex flex-col gap-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        inputMode="decimal"
        placeholder="0"
        aria-label={label}
        className="h-11 w-full rounded-2xl border border-line bg-surface px-2 text-center text-[15px]"
      />
      <span className="text-center text-[10.5px] text-muted">{label}</span>
    </label>
  );
}
