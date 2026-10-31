"use client";

import { Barcode, Plus, Search, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NewIngredientSheet } from "@/components/NewIngredientSheet";
import { Panel, Sheet, Spinner } from "@/components/ui";
import {
  CAT_LABEL,
  CAT_ORDER,
  allIngredients,
  ancestors,
  findIngredient,
  ing,
  isOwnKey,
  satisfies,
  searchIngredients,
} from "@/data/ingredients";
import { useApp } from "@/lib/store";
import type { Product, ProductDraft, ProductHints } from "@/lib/product-types";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { searchProducts } from "@/lib/supabase/products-api";
import type { IngredientCat, IngredientDef, Unit } from "@/lib/types";
import { formatSummed, sumQuantities } from "@/lib/units";
import { cn, haptic } from "@/lib/utils";
import { EditTypeButton } from "./EditTypeButton";
import { ProductEditorSheet, packLabel, useOnline, type ProductSaveOutcome } from "./ProductEditorSheet";

/*
 * Ручне додавання (F6, B4): і конкретні товари спільного каталогу, і типи.
 *
 * Товар — коли людина знає, що саме купила («Галичина 2,5%»): рядок комори
 * отримує назву, упаковку й КБЖВ картки. Тип — коли байдуже або картки ще
 * немає: «Молоко» без бренду рецептам підходить так само.
 *
 * Пошук нічого не вчить. Рядок, набраний руками, — не доказ, що «мол гал»
 * означає цей товар для всіх: вчимо лише з чека чи сканера (teach.ts).
 *
 * Без мережі товари шукаємо лише в кеші на пристрої; у локальному режимі
 * (без Supabase) товарів немає взагалі — лишається давній вибір типу.
 */

/** Мінімальне, що пікер знає про комору: для позначки «вже є · 1,9 л». */
export interface PickerPantryRow {
  key: string;
  productId?: string;
  amount?: number;
  unit?: Unit;
}

const EAN_QUERY = /^\d{8,13}$/;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function ProductPicker({
  open,
  onClose,
  title = "Додати в комору",
  subtitle,
  initialQuery = "",
  onPickProduct,
  onPickType,
  recentProducts = [],
  cachedProducts,
  pantry = [],
  exclude = [],
  typeKeys,
  onBarcode,
  prefillProduct,
  onCreateProduct,
  onCreateType,
  saveLabel = "Зберегти й додати в комору",
  onProductSaved,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Під заголовком — скажімо, сирий рядок чека («Що це за товар?»). */
  subtitle?: string;
  /**
   * Запит на відкритті: «Обрати товар» для рядка «Мол950УлГаличБЛак2.5» одразу
   * шукає «Молоко безлактозне Галичина 2,5%», а не порожнечу — людині лишається
   * тицьнути, а не набирати те, що застосунок уже вгадав.
   */
  initialQuery?: string;
  onPickProduct: (product: Product) => void;
  /**
   * `typed` — картка, яку людина заповнила у власному редакторі пікера, але
   * зберегти не змогла (без звʼязку — «Додати як тип»): назва й упаковка з неї
   * не мусять загубитись.
   */
  onPickType: (def: IngredientDef, typed?: ProductDraft) => void;
  /** «Нещодавні товари» з кешу стору, найсвіжіші першими. */
  recentProducts?: readonly Product[];
  /** Де шукати без мережі. Немає — у нещодавніх. */
  cachedProducts?: readonly Product[];
  /** Для «вже є · 1,9 л» біля типів. */
  pantry?: readonly PickerPantryRow[];
  /** Ключі типів, яких не показувати (до I4 — те, що вже в коморі). */
  exclude?: readonly string[];
  /** Обмежити пошук товарів цими типами (B7: тип рядка з різновидами). */
  typeKeys?: readonly string[];
  /** Запит із 8–13 цифр — це штрихкод: віддаємо в B1. */
  onBarcode?: (ean: string) => void;
  /** Заповнення редактора для «＋ Створити товар «…»»: підказки з назви, OFF тощо. */
  prefillProduct?: (query: string) => { draft?: ProductDraft; hints?: ProductHints } | undefined;
  /** Екран сам відкриває редактор. Немає — пікер відкриває власний. */
  onCreateProduct?: (query: string) => void;
  /** Екран сам відкриває створення типу. Немає — пікер відкриває NewIngredientSheet. */
  onCreateType?: (query: string) => void;
  saveLabel?: string;
  /** Власний редактор щойно зберіг картку (для кешу стору й навчання). */
  onProductSaved?: (product: Product, outcome: ProductSaveOutcome) => void;
}) {
  const online = useOnline();
  const customIngredients = useApp((s) => s.customIngredients);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Product[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [editor, setEditor] = useState<{ draft?: ProductDraft; hints?: ProductHints } | null>(null);
  const [newType, setNewType] = useState<string | null>(null);

  useEffect(() => {
    if (open) setQ(initialQuery);
    // Лише на відкритті: інакше кожен рендер батька скидав би набране.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const typed = q.trim();
  const products = isSupabaseConfigured;
  const isEan = EAN_QUERY.test(typed);
  const typeKeysKey = typeKeys?.join(",") ?? "";

  /* Товари спільноти: 250 мс після останньої літери, попередній запит скасовуємо. */
  useEffect(() => {
    if (!open || !products || !online || typed.length < 2 || isEan) {
      setRemote(null);
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchProducts(typed, typeKeys?.length ? typeKeys : null, 20, ctrl.signal)
        .then((found) => {
          if (!ctrl.signal.aborted) setRemote(found);
        })
        .catch(() => {
          // Без відповіді — показуємо кеш, як офлайн: пошук не повинен лаятись.
          if (!ctrl.signal.aborted) setRemote(null);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, products, online, typed, isEan, typeKeysKey]);

  /* Без мережі (чи поки сервер думає) — кеш на пристрої за назвою й виробником. */
  const localProducts = useMemo(() => {
    if (!products || typed.length < 2) return [];
    const needle = norm(typed);
    const pool = cachedProducts ?? recentProducts;
    return pool
      .filter((p) => !p.archived && !p.mergedInto)
      .filter((p) => !typeKeys?.length || typeKeys.includes(p.typeKey))
      .filter((p) => norm(`${p.name} ${p.brand ?? ""}`).includes(needle))
      .slice(0, 20);
  }, [products, typed, cachedProducts, recentProducts, typeKeysKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const productList = remote ?? localProducts;

  const types = useMemo(() => {
    const found = typed ? searchIngredients(typed) : allIngredients();
    return found.filter((d) => !exclude.includes(d.key) && !d.mergedInto);
    // customIngredients — щоб дописаний щойно тип одразу зʼявився.
  }, [typed, exclude, customIngredients]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const map = new Map<IngredientCat, IngredientDef[]>();
    for (const d of types) map.set(d.cat, [...(map.get(d.cat) ?? []), d]);
    return CAT_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [types]);

  /** «вже є · 1,9 л» — усе, що задовольняє цей тип, разом з різновидами (як availableFor). */
  const haveLabel = (key: string): string | null => {
    const rows = pantry.filter((r) => satisfies(r.key, key));
    if (rows.length === 0) return null;
    const amounts = rows.filter((r) => r.amount != null && r.unit).map((r) => ({ amount: r.amount, unit: r.unit as Unit }));
    const total = amounts.length ? formatSummed(sumQuantities(amounts)) : "";
    return total ? `вже є · ${total}` : "вже є";
  };

  const heldProducts = useMemo(() => new Set(pantry.map((r) => r.productId).filter(Boolean)), [pantry]);

  const pickProduct = (p: Product) => {
    haptic(10);
    onPickProduct(p);
    onClose();
  };

  const pickType = (def: IngredientDef) => {
    haptic(10);
    onPickType(def);
    onClose();
  };

  const createProduct = () => {
    if (onCreateProduct) {
      onCreateProduct(typed);
      onClose();
      return;
    }
    const given = prefillProduct?.(typed);
    const guess = findIngredient(typed);
    /*
     * Назва — те, що людина набрала: кнопка обіцяла «Створити товар «q»». Лише
     * порожній запит бере назву з підготовленої картки. Набране руками — вже не
     * здогадка, тож і позначку «здогадка» з назви знімаємо.
     */
    const name = typed || given?.draft?.name || "";
    const guessed = given?.draft?.guessed?.filter((g) => g !== "name" || name === given?.draft?.name);
    setEditor({
      draft: {
        ...(given?.draft ?? {}),
        typeKey: given?.draft?.typeKey || (typeKeys?.length === 1 ? typeKeys[0] : (guess?.key ?? "")),
        name,
        ...(guessed ? { guessed } : {}),
        provenance: given?.draft?.provenance ?? { from: "manual" },
      },
      hints: given?.hints,
    });
  };

  const createType = () => {
    if (onCreateType) {
      onCreateType(typed);
      onClose();
      return;
    }
    setNewType(typed);
  };

  const showRecent = products && !typed && recentProducts.length > 0;

  return (
    <>
      <Sheet open={open} onClose={onClose} title={title}>
        <div className="sticky top-0 z-10 -mx-5 mb-2 bg-bg-elev px-5 pb-3">
          {subtitle && <p className="mb-2 truncate px-1 font-mono text-[12px] font-semibold text-faint">{subtitle}</p>}
          <div className="flex h-[46px] items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5">
            <Search size={18} className="shrink-0 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={products ? "Молоко, Галичина, 4820…" : "Помідор, курка, рис…"}
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-semibold placeholder:text-faint"
            />
            {searching && <Spinner className="h-4 w-4" />}
            {q && (
              <button onClick={() => setQ("")} aria-label="Очистити" className="-mr-1.5 grid h-8 w-8 place-items-center">
                <X size={16} className="text-muted" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 pb-4">
          {isEan && onBarcode && (
            <Panel>
              <ActionRow
                icon={<Barcode size={18} className="text-brand" />}
                title={`Штрихкод ${typed}`}
                note="Знайти товар за кодом"
                onClick={() => {
                  onBarcode(typed);
                  onClose();
                }}
              />
            </Panel>
          )}

          {showRecent && (
            <Section title="Нещодавні товари">
              <Panel>
                {recentProducts.slice(0, 8).map((p, i) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    held={heldProducts.has(p.id)}
                    divided={i > 0}
                    onClick={() => pickProduct(p)}
                  />
                ))}
              </Panel>
            </Section>
          )}

          {products && typed.length >= 2 && !isEan && (
            <Section title="Товари">
              {!online && (
                <p className="flex items-center gap-1.5 px-1 text-[12px] font-semibold text-faint">
                  <WifiOff size={13} /> Товари спільноти — коли зʼявиться звʼязок
                </p>
              )}
              <Panel>
                {productList.map((p, i) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    held={heldProducts.has(p.id)}
                    divided={i > 0}
                    onClick={() => pickProduct(p)}
                  />
                ))}
                {productList.length === 0 && online && !searching && remote !== null && (
                  <p className="px-3.5 py-3 text-[12.5px] font-semibold text-faint">Такої картки ще немає.</p>
                )}
                <ActionRow
                  title={`＋ Створити товар «${typed}»`}
                  note={online ? "Картка з назвою, упаковкою й КБЖВ — спільна для всіх" : "Потрібен звʼязок"}
                  onClick={createProduct}
                  divided={productList.length > 0 || (online && !searching && remote !== null)}
                  brand
                />
              </Panel>
            </Section>
          )}

          <Section title="Типи">
            {typed && (
              <Panel>
                <ActionRow
                  title={`＋ Новий тип «${typed}»`}
                  note="Свій тип продукту — з мірою й калоріями"
                  onClick={createType}
                  brand
                />
              </Panel>
            )}
            {types.length === 0 ? (
              <p className="px-1 py-2 text-[12.5px] font-semibold text-faint">
                Такого типу немає — його можна створити рядком вище.
              </p>
            ) : (
              grouped.map(([cat, items]) => (
                <div key={cat}>
                  {!typed && (
                    <h4 className="mb-2 mt-1 px-1 text-[11px] font-extrabold uppercase tracking-[0.07em] text-faint">
                      {CAT_LABEL[cat]}
                    </h4>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((def) => {
                      const have = haveLabel(def.key);
                      const parent = ancestors(def.key)[0];
                      const own = isOwnKey(def.key);
                      const chip = (
                        <button
                          key={def.key}
                          onClick={() => pickType(def)}
                          className={
                            own
                              ? "inline-flex h-9 items-center gap-1.5 pl-3 pr-1 text-[13px] font-semibold"
                              : "inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-semibold active:bg-surface-2"
                          }
                        >
                          <span>{def.emoji}</span>
                          {def.label}
                          {parent && <span className="text-[11px] font-semibold text-faint">› {ing(parent).label}</span>}
                          {have && (
                            <span className="rounded-[5px] bg-brand/10 px-1.5 py-0.5 text-[10.5px] font-bold text-brand">
                              {have}
                            </span>
                          )}
                        </button>
                      );
                      // Дописаний тип правлять усі (F7) — олівець поруч, окремою кнопкою.
                      return own ? (
                        <span
                          key={def.key}
                          className="inline-flex h-9 items-center rounded-[8px] border border-line bg-surface pr-1 active:bg-surface-2"
                        >
                          {chip}
                          <EditTypeButton typeKey={def.key} icon />
                        </span>
                      ) : (
                        chip
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </Section>
        </div>
      </Sheet>

      {products && (
        <ProductEditorSheet
          open={editor !== null}
          onClose={() => setEditor(null)}
          draft={editor?.draft ?? null}
          hints={editor?.hints ?? null}
          saveLabel={saveLabel}
          onSaved={(product, outcome) => {
            onProductSaved?.(product, outcome);
            onPickProduct(product);
            onClose();
          }}
          onAddAsType={(typeKey, typed) => {
            onPickType(ing(typeKey), typed);
            onClose();
          }}
        />
      )}

      <NewIngredientSheet
        open={newType !== null}
        initialName={newType ?? ""}
        onClose={() => setNewType(null)}
        onCreated={(def) => {
          onPickType(def);
          onClose();
        }}
      />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="px-1 pt-1 text-[11px] font-extrabold uppercase tracking-[0.07em] text-faint">{title}</h3>
      {children}
    </div>
  );
}

function ProductRow({
  product,
  held,
  divided,
  onClick,
}: {
  product: Product;
  held: boolean;
  divided?: boolean;
  onClick: () => void;
}) {
  const pack = packLabel(product);
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex min-h-[54px] w-full items-center gap-3 px-3.5 py-2 text-left active:bg-surface-2",
        divided && "border-t border-line",
      )}
    >
      <span className="w-[22px] shrink-0 text-lg leading-none">{ing(product.typeKey).emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">
          {product.name}
          {pack && <span className="text-muted"> · {pack}</span>}
        </span>
        <span className="block truncate text-[11.5px] font-semibold text-faint">
          {[product.brand, ing(product.typeKey).label].filter(Boolean).join(" · ")}
          {held ? " · вже є в коморі" : ""}
        </span>
      </span>
      <Plus size={16} strokeWidth={2.2} className="shrink-0 text-muted" />
    </button>
  );
}

function ActionRow({
  icon,
  title,
  note,
  onClick,
  divided,
  brand,
}: {
  icon?: React.ReactNode;
  title: string;
  note?: string;
  onClick: () => void;
  /** Лінія згори — коли рядок іде під іншими в тій самій картці. */
  divided?: boolean;
  /** «＋ Створити…» — дія, тож помаранчевим. */
  brand?: boolean;
}) {
  return (
    <button
      onClick={() => {
        haptic(8);
        onClick();
      }}
      className={cn(
        "flex min-h-[54px] w-full items-center gap-3 px-3.5 py-2 text-left active:bg-surface-2",
        divided && "border-t border-line",
      )}
    >
      {icon && <span className="grid w-[22px] shrink-0 place-items-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[14px] font-bold", brand && "text-brand")}>{title}</span>
        {note && <span className="block text-[11.5px] font-semibold text-faint">{note}</span>}
      </span>
    </button>
  );
}
