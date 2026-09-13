"use client";

import { RotateCcw, TriangleAlert, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Sheet, Skeleton, useToast } from "@/components/ui";
import { CAT_LABEL, ing } from "@/data/ingredients";
import type { CommunityChange, CommunityTable } from "@/lib/product-types";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchCommunityHistory,
  fetchProductsByIds,
  isUuid,
  restoreCommunityVersion,
  toCatalogError,
  unmergeProduct,
} from "@/lib/supabase/products-api";
import type { IngredientCat, Unit } from "@/lib/types";
import { formatNumber, formatQuantity, unitLabel } from "@/lib/units";
import { ConfirmSheet, nutritionLine, shortDate } from "./ProductEditorSheet";

/*
 * Історія змін спільного рядка (A4, F3): картки товару, штрихкоду чи назви з
 * чека, дописаного типу.
 *
 * Що тут свідомо не показуємо. Для створення картки й для всіх
 * ідентифікаторів база віддає запис без імені й з датою без часу: людина +
 * година + «МолокГалБезл900 · АТБ» розповіли б, де й коли хтось купував.
 * Тож і текст для них безособовий: «12.09 — картку створено». Імʼя
 * зʼявляється лише на правках картки — там воно і є відповідальністю вікі.
 *
 * «Повернути цю версію» робить рядок рівним `after` того запису — це нова
 * правка поверх, а не видалення історії: пізніші записи лишаються й самі
 * стають «версіями», до яких можна повернутись.
 */

type Snapshot = Record<string, unknown> | null;

const s = (v: unknown): string | undefined => (v == null || v === "" ? undefined : String(v));
const n = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
const quoted = (v: string | undefined) => (v ? `«${v}»` : "—");

function nutritionOf(snap: Snapshot): string {
  const kcal = n(snap?.kcal);
  if (kcal == null) return "—";
  return nutritionLine({ kcal, protein: n(snap?.protein) ?? 0, fat: n(snap?.fat) ?? 0, carbs: n(snap?.carbs) ?? 0 });
}

const typeName = (key: unknown) => (s(key) ? ing(String(key)).label : "—");

/** Поле знімка → людський підпис і як показати значення. */
type FieldDef = [label: string, show: (snap: Snapshot) => string];

const PRODUCT_FIELDS: FieldDef[] = [
  ["назва", (x) => quoted(s(x?.name))],
  ["виробник", (x) => quoted(s(x?.brand))],
  ["тип", (x) => typeName(x?.type_key)],
  [
    "упаковка",
    (x) => {
      const amount = n(x?.pack_amount);
      const unit = s(x?.pack_unit) as Unit | undefined;
      return amount != null && unit ? formatQuantity(amount, unit) : "—";
    },
  ],
  ["жирність", (x) => (n(x?.fat_pct) != null ? `${formatNumber(n(x?.fat_pct) as number, 1)}%` : "—")],
  ["вага штуки", (x) => (n(x?.grams_per_piece) != null ? `${formatNumber(n(x?.grams_per_piece) as number)} г` : "—")],
  ["КБЖВ", nutritionOf],
  ["фото", (x) => (s(x?.image_url) ? "є" : "немає")],
];

const TYPE_FIELDS: FieldDef[] = [
  ["назва", (x) => quoted(s(x?.label))],
  ["значок", (x) => s(x?.emoji) ?? "—"],
  ["різновид", (x) => (s(x?.parent_key) ? typeName(x?.parent_key) : "самостійний")],
  ["категорія", (x) => (s(x?.cat) ? (CAT_LABEL[String(x?.cat) as IngredientCat] ?? String(x?.cat)) : "—")],
  ["міра", (x) => (s(x?.default_unit) ? unitLabel(String(x?.default_unit) as Unit) : "—")],
  ["вага штуки", (x) => (n(x?.grams_per_piece) != null ? `${formatNumber(n(x?.grams_per_piece) as number)} г` : "—")],
  ["вага склянки", (x) => (n(x?.grams_per_cup) != null ? `${formatNumber(n(x?.grams_per_cup) as number)} г` : "—")],
  ["синоніми", (x) => (Array.isArray(x?.aliases) && x.aliases.length ? (x.aliases as unknown[]).join(", ") : "—")],
  ["базовий", (x) => (x?.staple ? "так" : "ні")],
  ["КБЖВ", nutritionOf],
];

function diff(fields: FieldDef[], before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  for (const [label, show] of fields) {
    const a = show(before);
    const b = show(after);
    if (a !== b) out.push(`${label}: ${a} → ${b}`);
  }
  return out;
}

/** Людський опис одного запису. `names` — назви карток за id, для «привʼязано до «…»». */
export function describeChange(table: CommunityTable, c: CommunityChange, names: Record<string, string>): string {
  const { before, after } = c;
  const productName = (id: unknown) => (s(id) ? quoted(names[String(id)] ?? "картка товару") : "—");
  const target = (x: Snapshot) => (s(x?.product_id) ? productName(x?.product_id) : quoted(typeName(x?.type_key)));
  const revert = c.revertedFrom != null ? "повернуто версію" : "";

  let text: string;
  if (table === "product_identifiers") {
    if (c.op === "insert") text = `привʼязано до ${target(after)}`;
    else if (c.op === "delete") text = `відвʼязано від ${target(before)}`;
    else if (c.op === "merge") text = `перейшло до ${target(after)} при обʼєднанні карток`;
    else if (c.op === "unmerge") text = `повернулось до ${target(after)} після розʼєднання`;
    else text = `тепер означає ${target(after)}`;
  } else if (table === "products") {
    if (c.op === "insert") text = "картку створено";
    else if (c.op === "merge" && s(after?.merged_into) && !s(before?.merged_into))
      text = `Обʼєднано з ${productName(after?.merged_into)}`;
    else if (c.op === "unmerge" && s(before?.merged_into) && !s(after?.merged_into)) text = "Розʼєднано";
    else if (!before?.archived && after?.archived) text = "картку прибрано";
    else if (before?.archived && !after?.archived) text = "картку повернуто";
    else text = diff(PRODUCT_FIELDS, before, after).join("; ") || "без видимих змін";
  } else {
    if (c.op === "insert") text = "тип створено";
    else if (c.op === "merge" && s(after?.merged_into)) text = `Обʼєднано з ${quoted(typeName(after?.merged_into))}`;
    else if (c.op === "unmerge" && s(before?.merged_into) && !s(after?.merged_into)) text = "Розʼєднано";
    else text = diff(TYPE_FIELDS, before, after).join("; ") || "без видимих змін";
  }
  return revert ? `${revert}: ${text}` : text;
}

const versionOf = (c: CommunityChange | undefined): number | undefined =>
  n(c?.after?.version) ?? n(c?.before?.version);

export function HistorySheet({
  open,
  onClose,
  table,
  rowId,
  title = "Історія змін",
  currentVersion,
  productNames,
  onRestored,
  onUnmerged,
}: {
  open: boolean;
  onClose: () => void;
  table: CommunityTable;
  /** id картки чи ідентифікатора (uuid) або ключ дописаного типу. */
  rowId: string | null;
  title?: string;
  /**
   * Поточна версія рядка, яку бачить екран (p_expected_version). Немає — беремо
   * з найсвіжішого запису: так працює й для вже видаленого ідентифікатора.
   */
  currentVersion?: number;
  /** Назви карток, які вже є в кеші; решту аркуш дочитає сам. */
  productNames?: Record<string, string>;
  /** Після «Повернути цю версію» — перечитати картку й оновити кеш. */
  onRestored?: (change: CommunityChange) => void;
  /** I6: є — біля «Обʼєднано з …» зʼявляється [Розʼєднати]. */
  onUnmerged?: (loserId: string) => void;
}) {
  const toast = useToast();
  const [list, setList] = useState<CommunityChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ change: CommunityChange; index: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!rowId) return;
    setError(null);
    try {
      const rows = await fetchCommunityHistory(table, rowId, 50);
      setList(rows);
      // Назви карток, на які посилаються знімки, — одним запитом.
      const ids = new Set<string>();
      for (const c of rows)
        for (const snap of [c.before, c.after]) {
          for (const v of [snap?.product_id, snap?.merged_into]) if (isUuid(v)) ids.add(v);
        }
      const missing = [...ids].filter((id) => !(productNames?.[id]));
      if (missing.length) {
        const found = await fetchProductsByIds(missing).catch(() => []);
        setNames((prev) => ({ ...prev, ...Object.fromEntries(found.map((p) => [p.id, p.name])) }));
      }
    } catch (e) {
      setError(toCatalogError(e).message);
    }
  }, [table, rowId, productNames]);

  useEffect(() => {
    if (!open) return;
    setList(null);
    setConfirm(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table, rowId]);

  if (!isSupabaseConfigured) return null;

  const allNames = { ...names, ...(productNames ?? {}) };
  const noun = table === "products" ? "картку" : table === "custom_ingredients" ? "тип" : "привʼязку";

  const restore = async () => {
    if (!confirm || !list) return;
    const expected = currentVersion ?? versionOf(list[0]);
    if (expected == null) return;
    setBusy(true);
    try {
      await restoreCommunityVersion(confirm.change.id, expected);
      toast(`Повернули версію від ${shortDate(confirm.change.changedAt)}`, "↩️");
      onRestored?.(confirm.change);
      setConfirm(null);
      await load();
    } catch (e) {
      const err = toCatalogError(e);
      setConfirm(null);
      // Той самий аркуш — для картки, привʼязки й типу: кажемо про те, що справді змінили.
      const changed = table === "products" ? "Картку" : table === "custom_ingredients" ? "Тип" : "Привʼязку";
      setError(err.code === "conflict" ? `${changed} щойно змінили — онови історію.` : err.message);
      if (err.code === "conflict") await load();
    } finally {
      setBusy(false);
    }
  };

  const unmerge = async () => {
    if (!rowId) return;
    setBusy(true);
    try {
      await unmergeProduct(rowId);
      toast("Розʼєднали", "↩️");
      onUnmerged?.(rowId);
      await load();
    } catch (e) {
      setError(toCatalogError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={title}>
        <div className="flex flex-col gap-2.5 pb-4">
          {error && (
            <div className="flex items-start gap-2 rounded-2xl border border-berry/30 bg-berry/10 px-3.5 py-3 text-[12.5px] leading-snug text-berry">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <p className="min-w-0 flex-1">{error}</p>
              <button onClick={() => void load()} className="shrink-0 font-bold" aria-label="Оновити історію">
                <RotateCcw size={15} />
              </button>
            </div>
          )}

          {list === null && !error && (
            <>
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </>
          )}

          {list?.length === 0 && <p className="py-8 text-center text-[13px] text-muted">Змін ще не було.</p>}

          {list?.map((c, index) => {
            const head = `${shortDate(c.changedAt)}${c.actorName ? ` · ${c.actorName}` : ""}`;
            const merged =
              table === "products" && c.op === "merge" && s(c.after?.merged_into) && !s(c.before?.merged_into);
            const restorable =
              index > 0 && c.after != null && c.op !== "merge" && c.op !== "unmerge" && !s(c.after?.merged_into);
            return (
              <div key={c.id} className="rounded-2xl border border-line bg-surface px-3.5 py-3">
                <p className="text-[13px] leading-snug">
                  <span className="font-bold">{head}</span>
                  <span className="text-muted"> — {describeChange(table, c, allNames)}</span>
                </p>
                {(restorable || (merged && onUnmerged && index === 0)) && (
                  <div className="mt-2 flex gap-2">
                    {restorable && (
                      <Button size="sm" variant="secondary" onClick={() => setConfirm({ change: c, index })}>
                        <Undo2 size={14} /> Повернути цю версію
                      </Button>
                    )}
                    {merged && onUnmerged && index === 0 && (
                      <Button size="sm" variant="outline" loading={busy} onClick={() => void unmerge()}>
                        Розʼєднати
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? `Повернути ${noun} до версії від ${shortDate(confirm.change.changedAt)}?` : ""}
        body={
          <>
            Це побачать усі.
            {confirm && confirm.index >= 2 && <> Пізніші зміни ({confirm.index}) теж зникнуть.</>}
          </>
        }
        confirmLabel="Повернути"
        loading={busy}
        onConfirm={() => void restore()}
      />
    </>
  );
}
