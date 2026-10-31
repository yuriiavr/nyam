"use client";

import { Barcode, Ellipsis, History, Pencil, ReceiptText, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LinkRow } from "@/components/pantry/PantryGroups";
import { Button, Panel, PanelHeader, Sheet, useToast } from "@/components/ui";
import { ing } from "@/data/ingredients";
import type { CommunityTable, Product, ProductIdentifier } from "@/lib/product-types";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  deleteIdentifier,
  fetchMergedProducts,
  fetchProductIdentifiers,
  fetchProductsByIds,
  setProductArchived,
  toCatalogError,
  unmergeProduct,
} from "@/lib/supabase/products-api";
import { haptic } from "@/lib/utils";
import { HistorySheet } from "./HistorySheet";
import { MergeSheet } from "./MergeSheet";
import { EditTypeButton } from "./EditTypeButton";
import {
  ConfirmSheet,
  ProductEditorSheet,
  nutritionLine,
  productMeta,
  shortDate,
  typeTrail,
} from "./ProductEditorSheet";

/*
 * Картка товару (F3): що це, як рецепти його рахують і за чим його впізнають.
 *
 * Картка спільна, тож кожна дія тут — для всіх, і кожна зворотна:
 * - правка йде через редактор із номером версії й пишеться в історію;
 * - «Прибрати картку» не видаляє, а ховає з пошуку й впізнавання: у коморах
 *   вона лишається, а повернути можна банером або в історії;
 * - прибраний штрихкод чи назва з чека теж лишаються в історії.
 *
 * Аркуш не знає про стор: свіжу картку віддає через `onChanged`, а кеш
 * оновлює той, хто його відкрив. У локальному режимі карток немає зовсім.
 */

/** Мережі з A3 (src/data/chains.ts): slug → як назву бачить людина. */
const CHAIN_LABEL: Record<string, string> = {
  atb: "АТБ",
  silpo: "Сільпо",
  varus: "VARUS",
  novus: "NOVUS",
  auchan: "Ашан",
  metro: "METRO",
  eko: "Еко-маркет",
  fora: "Фора",
  kopiyka: "Копійка",
  thrash: "Траш",
};

/** '' — ніде не уточнюємо; 'm:atb' — «АТБ»; 's:…' — один конкретний продавець. */
export function scopeLabel(scope: string): string {
  if (!scope) return "";
  if (scope.startsWith("m:")) return CHAIN_LABEL[scope.slice(2)] ?? scope.slice(2).toUpperCase();
  return "в одному магазині";
}

export function ProductSheet({
  open,
  onClose,
  product,
  onChanged,
  onMerged,
  onUnmerged,
  productNames,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Картка з кешу стору. */
  product: Product | null;
  /** Свіжа версія після правки, прибирання, повернення чи конфлікту — оновити кеш. */
  onChanged?: (product: Product) => void;
  /** I6: є — зʼявляється «Це дублікат…». */
  onMerged?: (loserId: string, winnerId: string) => void;
  /** I6: є — в історії біля «Обʼєднано з …» зʼявляється «Розʼєднати». */
  onUnmerged?: (loserId: string) => void;
  productNames?: Record<string, string>;
  /** Дії екрана під карткою (скажімо, «Додати в комору»). */
  children?: ReactNode;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState<Product | null>(product);
  const [identifiers, setIdentifiers] = useState<ProductIdentifier[] | null>(null);
  /*
   * Картки, обʼєднані з цією. Переможену після обʼєднання вже нізвідки не
   * відкрити — комори, скани й пошук ведуть сюди, — тож «Розʼєднати» живе тут,
   * а не лише в тості, який легко проґавити.
   */
  const [merged, setMerged] = useState<Product[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProductIdentifier | null>(null);
  const [archiveAsk, setArchiveAsk] = useState(false);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<{
    table: CommunityTable;
    rowId: string;
    version?: number;
    title: string;
  } | null>(null);
  const [merge, setMerge] = useState<{ other: Product | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Кеш стору може відстати від відповіді RPC (realtime для товарів немає),
   * тож нову версію з пропсів беремо лише тоді, коли вона справді не старіша
   * за ту, що аркуш уже бачив.
   */
  useEffect(() => {
    setCurrent((cur) =>
      !product || !cur || cur.id !== product.id || product.version >= cur.version ? product : cur,
    );
  }, [product]);

  const loadIdentifiers = useCallback(async (id: string) => {
    try {
      setIdentifiers(await fetchProductIdentifiers(id));
    } catch (e) {
      setIdentifiers([]);
      setError(toCatalogError(e).message);
    }
  }, []);

  const loadMerged = useCallback(async (id: string) => {
    // Підказка, не обовʼязок: без списку картка працює так само.
    setMerged(await fetchMergedProducts(id).catch(() => []));
  }, []);

  useEffect(() => {
    if (!open || !product) return;
    setIdentifiers(null);
    setMerged([]);
    setMenuFor(null);
    setError(null);
    void loadIdentifiers(product.id);
    if (onUnmerged) void loadMerged(product.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  if (!isSupabaseConfigured || !current) return null;

  const apply = (next: Product) => {
    setCurrent(next);
    onChanged?.(next);
  };

  /** Після конфлікту чи повернення версії — перечитати картку з бази. */
  const refresh = async () => {
    const fresh = await fetchProductsByIds([current.id])
      .then((list) => list.find((p) => p.id === current.id) ?? null)
      .catch(() => null);
    if (fresh) apply(fresh);
    return fresh;
  };

  const setArchived = async (archived: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await setProductArchived(current.id, current.version, archived);
      haptic(14);
      apply(next);
      toast(archived ? "Картку прибрано" : "Картку повернуто", archived ? "🗂️" : "↩️");
      setArchiveAsk(false);
    } catch (e) {
      const err = toCatalogError(e);
      setArchiveAsk(false);
      setError(err.message);
      if (err.code === "conflict") await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeIdentifier = async () => {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await deleteIdentifier(removing.id, removing.version);
      haptic(12);
      setIdentifiers((list) => list?.filter((i) => i.id !== removing.id) ?? null);
      toast(`Прибрано «${removing.raw}»`, "🧹");
      setRemoving(null);
    } catch (e) {
      const err = toCatalogError(e);
      setRemoving(null);
      setError(err.message);
      if (err.code === "conflict" || err.code === "not_found") await loadIdentifiers(current.id);
    } finally {
      setBusy(false);
    }
  };

  /** «Розʼєднати»: коди, що переїхали при обʼєднанні, — назад; комори лишаються з цією карткою. */
  const unmerge = async (loser: Product) => {
    setBusy(true);
    setError(null);
    try {
      await unmergeProduct(loser.id);
      haptic(12);
      toast(`«${loser.name}» знову окрема картка. Комори лишились із «${current.name}»`, "↩️");
      setMerged((list) => list.filter((p) => p.id !== loser.id));
      onUnmerged?.(loser.id);
      await loadIdentifiers(current.id);
    } catch (e) {
      setError(toCatalogError(e).message);
      await loadMerged(current.id);
    } finally {
      setBusy(false);
    }
  };

  const names = { ...(productNames ?? {}), [current.id]: current.name };
  const meta = productMeta(current);

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Картка товару" footer={children}>
        <div className="flex flex-col gap-3 pb-3">
          {current.archived && (
            <div className="flex min-h-[50px] items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-2">
              <p className="min-w-0 flex-1 text-[14px] font-bold">Картку прибрано</p>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void setArchived(false)}>
                Повернути
              </Button>
            </div>
          )}

          {error && (
            <p className="flex items-start gap-2 rounded-[10px] border border-berry/30 bg-berry/10 px-3.5 py-3 text-[12.5px] font-semibold leading-snug text-berry">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 px-1">
            {current.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.image}
                alt=""
                className="h-14 w-14 shrink-0 rounded-[10px] border border-line bg-surface object-contain"
              />
            ) : (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-[28px]">
                {ing(current.typeKey).emoji}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[16px] font-bold leading-snug">{current.name}</h3>
              {meta && <p className="mt-0.5 text-[12.5px] font-semibold text-faint">{meta}</p>}
            </div>
            {!current.archived && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil size={14} /> Редагувати
              </Button>
            )}
          </div>

          <Panel>
            <div className="flex min-h-[50px] flex-col justify-center gap-0.5 px-3.5 py-2.5">
              <span className="text-[12px] font-semibold text-faint">Рецепти рахують як</span>
              <span className="flex flex-wrap items-baseline gap-x-2 text-[14px] font-semibold">
                <span>
                  {ing(current.typeKey).emoji} {typeTrail(current.typeKey)}
                </span>
                <EditTypeButton typeKey={current.typeKey} />
              </span>
            </div>
            {current.nutrition && (
              <div className="flex min-h-[50px] flex-col justify-center gap-0.5 border-t border-line px-3.5 py-2.5">
                <span className="text-[12px] font-semibold text-faint">КБЖВ на 100 г</span>
                <span className="text-[14px] font-semibold">{nutritionLine(current.nutrition)}</span>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader label="Як його впізнати" />
            {identifiers === null ? (
              <div className="border-t border-line px-3.5 py-3">
                <div className="shimmer h-6 rounded-[8px] bg-surface-2" />
              </div>
            ) : identifiers.length === 0 ? (
              <p className="border-t border-line px-3.5 py-3 text-[12.5px] font-semibold leading-snug text-faint">
                Поки ні штрихкоду, ні назви з чека. Відскануй його чи додай із чека — і наступного разу він
                впізнається сам, у тебе й у всіх.
              </p>
            ) : (
              <>
                {identifiers.map((i) => (
                  <div key={i.id} className="border-t border-line">
                    <div className="flex h-12 items-center gap-2.5 pl-3.5 pr-2">
                      {i.kind === "ean" ? (
                        <Barcode size={16} className="shrink-0 text-muted" />
                      ) : (
                        <ReceiptText size={16} className="shrink-0 text-muted" />
                      )}
                      <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                        {i.kind === "ean" ? (
                          <>
                            Штрихкод <span className="font-mono">{i.raw}</span>
                          </>
                        ) : (
                          <>
                            З чека: «{i.raw}»{scopeLabel(i.scope) ? ` · ${scopeLabel(i.scope)}` : ""}
                          </>
                        )}
                      </p>
                      <button
                        onClick={() => setMenuFor((id) => (id === i.id ? null : i.id))}
                        aria-label="Дії"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-surface-2 active:bg-line"
                      >
                        <Ellipsis size={16} className="text-muted" />
                      </button>
                    </div>
                    {menuFor === i.id && (
                      <div className="flex gap-2 border-t border-line px-3.5 py-2.5">
                        <Button size="sm" variant="danger" onClick={() => setRemoving(i)}>
                          Прибрати
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setHistory({
                              table: "product_identifiers",
                              rowId: i.id,
                              version: i.version,
                              title: i.kind === "ean" ? `Історія: ${i.raw}` : `Історія: «${i.raw}»`,
                            })
                          }
                        >
                          <History size={14} /> Історія
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </Panel>

          {merged.length > 0 && (
            <Panel>
              <PanelHeader label="Обʼєднано з цією карткою" />
              {merged.map((p) => (
                <div key={p.id} className="flex min-h-[54px] items-center gap-2.5 border-t border-line px-3.5 py-2">
                  <p className="min-w-0 flex-1 leading-snug">
                    <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                    {productMeta(p) && (
                      <span className="block truncate text-[11.5px] font-semibold text-faint">{productMeta(p)}</span>
                    )}
                  </p>
                  <Button size="sm" variant="outline" loading={busy} onClick={() => void unmerge(p)}>
                    Розʼєднати
                  </Button>
                </div>
              ))}
            </Panel>
          )}

          <Panel>
            <LinkRow
              onClick={() =>
                setHistory({ table: "products", rowId: current.id, version: current.version, title: "Історія змін" })
              }
              aside={
                current.updatedAt && (
                  <span className="shrink-0 text-[12px] font-semibold text-faint">
                    змінено {shortDate(current.updatedAt)}
                  </span>
                )
              }
            >
              Історія змін
            </LinkRow>
            {onMerged && !current.archived && (
              <LinkRow divided onClick={() => setMerge({ other: null })}>
                Це дублікат…
              </LinkRow>
            )}
            {!current.archived && (
              <LinkRow divided tone="danger" onClick={() => setArchiveAsk(true)}>
                Прибрати картку
              </LinkRow>
            )}
          </Panel>
        </div>
      </Sheet>

      <ProductEditorSheet
        open={editing}
        onClose={() => setEditing(false)}
        product={current}
        onSaved={(saved) => {
          apply(saved);
          toast("Картку оновлено", "✅");
        }}
        onProductChanged={apply}
        onDuplicate={
          onMerged
            ? (existing) => {
                setEditing(false);
                setMerge({ other: existing });
              }
            : undefined
        }
      />

      <ConfirmSheet
        open={archiveAsk}
        onClose={() => setArchiveAsk(false)}
        title="Прибрати картку для всіх?"
        body="Вона зникне з пошуку, а штрихкоди й назви з чеків перестануть її впізнавати. У коморах вона лишиться. Повернути можна в історії змін."
        confirmLabel="Прибрати для всіх"
        danger
        loading={busy}
        onConfirm={() => void setArchived(true)}
      />

      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Прибрати «${removing.raw}»?` : ""}
        body={removing?.kind === "ean" ? "Наступний скан не впізнає цей штрихкод сам." : "Наступний чек не впізнає його сам."}
        confirmLabel="Прибрати"
        danger
        loading={busy}
        onConfirm={() => void removeIdentifier()}
      />

      <HistorySheet
        open={history !== null}
        onClose={() => setHistory(null)}
        table={history?.table ?? "products"}
        rowId={history?.rowId ?? null}
        title={history?.title}
        currentVersion={history?.table === "products" ? current.version : history?.version}
        productNames={names}
        onRestored={() => {
          // Повернення міняє або картку, або привʼязку — перечитуємо обидва.
          void refresh();
          void loadIdentifiers(current.id);
        }}
        onUnmerged={onUnmerged}
      />

      {onMerged && (
        <MergeSheet
          open={merge !== null}
          onClose={() => setMerge(null)}
          product={current}
          other={merge?.other ?? null}
          onMerged={(loser, winner) => {
            onMerged(loser, winner);
            onClose();
          }}
        />
      )}
    </>
  );
}
