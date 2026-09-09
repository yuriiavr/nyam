"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChefHat, Plus, ScanBarcode, Search, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { TopBar } from "@/components/TopBar";
import { Button, Card, Chip, EmptyState, Sheet, Spinner, useToast } from "@/components/ui";
import { CAT_LABEL, CAT_ORDER, INGREDIENTS, ing, searchIngredients } from "@/data/ingredients";
import { lookupBarcode, type ProductInfo } from "@/lib/barcode";
import { fridgeMatches, shoppingSuggestions } from "@/lib/matching";
import { allRecipes, useApp } from "@/lib/store";
import type { IngredientCat, IngredientDef } from "@/lib/types";
import { haptic, plural } from "@/lib/utils";

const POPULAR = [
  "yajtsya",
  "kartoplya",
  "kurka",
  "pomidor",
  "syr",
  "makarony",
  "rys",
  "tsybulya",
  "moloko",
  "gryby",
  "morkva",
  "khlib",
];

export default function PantryPage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanned, setScanned] = useState<ProductInfo | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [pickFor, setPickFor] = useState<ProductInfo | null>(null);

  const pantryKeys = state.pantry.map((p) => p.key);

  const grouped = useMemo(() => {
    const map = new Map<IngredientCat, typeof state.pantry>();
    for (const item of state.pantry) {
      const cat = ing(item.key).cat;
      map.set(cat, [...(map.get(cat) ?? []), item]);
    }
    return CAT_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [state.pantry]);

  const { matchCount, suggestions } = useMemo(() => {
    if (!hydrated || pantryKeys.length === 0) return { matchCount: 0, suggestions: [] };
    const recipes = allRecipes(state);
    return {
      matchCount: fridgeMatches(recipes, pantryKeys, { minPct: 60 }).length,
      suggestions: shoppingSuggestions(recipes, pantryKeys, 6),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, state.pantry, state.myRecipes]);

  const add = (key: string, extra?: { label?: string; barcode?: string }) => {
    haptic(12);
    state.addPantry({ key, addedAt: new Date().toISOString(), ...extra });
  };

  const handleDetect = async (code: string) => {
    setScanOpen(false);
    setScanLoading(true);
    const info = await lookupBarcode(code);
    setScanLoading(false);
    setScanned(info);
    if (info.ingredient) {
      add(info.ingredient.key, { label: info.name, barcode: info.barcode });
    }
  };

  const searchResults = query.trim() ? searchIngredients(query) : [];

  return (
    <div className="pb-8">
      <TopBar
        back={false}
        title="Моя комора"
        subtitle={
          state.pantry.length
            ? `${state.pantry.length} ${plural(state.pantry.length, "продукт", "продукти", "продуктів")}`
            : "Що є вдома"
        }
        right={
          state.pantry.length > 0 ? (
            <button
              onClick={() => {
                if (confirm("Очистити всю комору?")) {
                  state.clearPantry();
                  toast("Комору очищено", "🧹");
                }
              }}
              aria-label="Очистити"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2 text-muted"
            >
              <Trash2 size={17} />
            </button>
          ) : undefined
        }
      />

      {/* Дії */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-4">
        <button
          onClick={() => {
            haptic(14);
            setScanOpen(true);
          }}
          className="flex flex-col items-start gap-2 rounded-xl3 border border-line bg-surface p-4 active:bg-surface-2"
          style={{
            backgroundImage:
              "radial-gradient(circle at 100% 0%, color-mix(in oklab, var(--brand) 16%, transparent), transparent 62%)",
          }}
        >
          <span className="grid h-11 w-11 place-items-center rounded-2xl brand-gradient text-brand-ink">
            <ScanBarcode size={20} />
          </span>
          <span className="text-[14px] font-bold">Сканувати штрихкод</span>
          <span className="text-[11.5px] leading-snug text-muted">
            Наведи камеру — продукт додасться сам
          </span>
        </button>

        <button
          onClick={() => {
            haptic(12);
            setAddOpen(true);
          }}
          className="flex flex-col items-start gap-2 rounded-xl3 border border-line bg-surface p-4 active:bg-surface-2"
        >
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-surface-2">
            <Plus size={20} />
          </span>
          <span className="text-[14px] font-bold">Додати вручну</span>
          <span className="text-[11.5px] leading-snug text-muted">Пошук по каталогу продуктів</span>
        </button>
      </div>

      {/* Швидке додавання */}
      {hydrated && state.pantry.length < 4 && (
        <section className="pt-6">
          <h2 className="mb-2.5 px-4 text-[12px] font-bold uppercase tracking-wide text-muted">
            Часто додають
          </h2>
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4">
            {POPULAR.filter((k) => !pantryKeys.includes(k)).map((k) => {
              const def = ing(k);
              return (
                <Chip key={k} onClick={() => add(k)}>
                  <span>{def.emoji}</span>
                  {def.label}
                  <Plus size={13} className="opacity-60" />
                </Chip>
              );
            })}
          </div>
        </section>
      )}

      {/* Що можна приготувати */}
      {hydrated && state.pantry.length > 0 && (
        <section className="px-4 pt-6">
          <Link href="/decide/fridge">
            <motion.div whileTap={{ scale: 0.98 }}>
              <Card className="flex items-center gap-3 border-mint/30 p-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-mint/15 text-2xl">
                  🧊
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold">
                    {matchCount > 0
                      ? `${matchCount} ${plural(matchCount, "страва", "страви", "страв")} майже готові`
                      : "Подивитись, що можна приготувати"}
                  </p>
                  <p className="text-[12px] text-muted">
                    Підбір за вмістом холодильника — з відсотком збігу
                  </p>
                </div>
                <ChefHat size={18} className="shrink-0 text-mint" />
              </Card>
            </motion.div>
          </Link>
        </section>
      )}

      {/* Список комори */}
      <section className="px-4 pt-6">
        {!hydrated ? null : state.pantry.length === 0 ? (
          <EmptyState
            emoji="🧊"
            title="Комора порожня"
            note="Додай продукти — і застосунок покаже, що з них можна приготувати прямо зараз."
            action={<Button onClick={() => setScanOpen(true)}>Сканувати перший продукт</Button>}
          />
        ) : (
          <div className="flex flex-col gap-5">
            {grouped.map(([cat, items]) => (
              <div key={cat}>
                <h3 className="mb-2.5 text-[12px] font-bold uppercase tracking-wide text-muted">
                  {CAT_LABEL[cat]}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <AnimatePresence initial={false}>
                    {items.map((item) => {
                      const def = ing(item.key);
                      return (
                        <motion.button
                          key={item.key}
                          layout
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.85 }}
                          onClick={() => {
                            haptic(10);
                            state.removePantry(item.key);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-2 pl-3 pr-2 text-[13px] font-semibold"
                        >
                          <span>{def.emoji}</span>
                          <span>{def.label}</span>
                          {item.barcode && <span className="text-[9px] text-faint">скан</span>}
                          <X size={13} className="text-faint" />
                        </motion.button>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Що докупити */}
      {suggestions.length > 0 && (
        <section className="px-4 pt-7">
          <div className="mb-2.5 flex items-center gap-2">
            <Sparkles size={15} className="text-brand" />
            <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted">
              Докупи — відкриє нові рецепти
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map(({ key, unlocks }) => {
              const def = ing(key);
              return (
                <button
                  key={key}
                  onClick={() => add(key)}
                  className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 py-2 pl-3 pr-3.5 text-[13px] font-semibold"
                >
                  <span>{def.emoji}</span>
                  {def.label}
                  <span className="rounded-full bg-brand/20 px-1.5 text-[11px] font-extrabold text-brand">
                    +{unlocks}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Сканер */}
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetect={handleDetect} />

      {/* Індикатор пошуку товару */}
      <Sheet open={scanLoading} onClose={() => {}} title="Шукаю товар">
        <div className="flex items-center gap-3 py-6">
          <Spinner />
          <p className="text-[14px] text-muted">Звіряю штрихкод з базою Open Food Facts…</p>
        </div>
      </Sheet>

      {/* Результат сканування */}
      <Sheet open={!!scanned} onClose={() => setScanned(null)} title="Результат сканування">
        {scanned && (
          <div className="pb-4">
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
              {scanned.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={scanned.image}
                  alt=""
                  className="h-16 w-16 rounded-2xl bg-surface-2 object-contain"
                />
              ) : (
                <span className="grid h-16 w-16 place-items-center rounded-2xl bg-surface-2 text-2xl">
                  {scanned.ingredient?.emoji ?? "📦"}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold">{scanned.name}</p>
                {scanned.brand && <p className="truncate text-[12px] text-muted">{scanned.brand}</p>}
                <p className="mt-0.5 font-mono text-[11px] text-faint">{scanned.barcode}</p>
              </div>
            </div>

            {scanned.ingredient ? (
              <div className="mt-4 rounded-2xl border border-mint/30 bg-mint/10 p-3.5">
                <p className="text-[13px] font-bold text-mint">
                  ✓ Додано в комору як «{scanned.ingredient.label}»
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  Не те? Обери правильний продукт зі списку.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2.5"
                  onClick={() => {
                    state.removePantry(scanned.ingredient!.key);
                    setPickFor(scanned);
                    setScanned(null);
                  }}
                >
                  Обрати інший
                </Button>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-3.5">
                <p className="text-[13px] font-bold">Не вдалося визначити продукт</p>
                <p className="mt-1 text-[12px] text-muted">
                  Обери зі списку, чим це є — наступного разу впізнаємо швидше.
                </p>
                <Button
                  size="sm"
                  className="mt-2.5"
                  onClick={() => {
                    setPickFor(scanned);
                    setScanned(null);
                  }}
                >
                  Обрати продукт
                </Button>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setScanned(null);
                  setScanOpen(true);
                }}
              >
                Сканувати ще
              </Button>
              <Button className="flex-1" onClick={() => setScanned(null)}>
                Готово
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      {/* Ручний вибір продукту після сканування */}
      <IngredientPicker
        open={!!pickFor}
        onClose={() => setPickFor(null)}
        title="Що це за продукт?"
        exclude={pantryKeys}
        onPick={(def) => {
          add(def.key, { label: pickFor?.name, barcode: pickFor?.barcode });
          setPickFor(null);
          toast(`${def.label} у коморі`, def.emoji);
        }}
      />

      {/* Додавання вручну */}
      <IngredientPicker
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setQuery("");
        }}
        title="Додати продукт"
        exclude={pantryKeys}
        query={query}
        onQueryChange={setQuery}
        results={searchResults}
        onPick={(def) => {
          add(def.key);
          toast(`${def.label} у коморі`, def.emoji);
        }}
        keepOpen
      />
    </div>
  );
}

/* ── Вибір інгредієнта ────────────────────────────────────────────────── */

function IngredientPicker({
  open,
  onClose,
  title,
  onPick,
  exclude = [],
  query: controlledQuery,
  onQueryChange,
  results,
  keepOpen,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onPick: (def: IngredientDef) => void;
  exclude?: string[];
  query?: string;
  onQueryChange?: (v: string) => void;
  results?: IngredientDef[];
  keepOpen?: boolean;
}) {
  const [localQuery, setLocalQuery] = useState("");
  const q = controlledQuery ?? localQuery;
  const setQ = onQueryChange ?? setLocalQuery;

  const list = useMemo(() => {
    const found = q.trim() ? results ?? searchIngredients(q) : INGREDIENTS;
    return found.filter((d) => !exclude.includes(d.key));
  }, [q, results, exclude]);

  const grouped = useMemo(() => {
    const map = new Map<IngredientCat, IngredientDef[]>();
    for (const d of list) map.set(d.cat, [...(map.get(d.cat) ?? []), d]);
    return CAT_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [list]);

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="sticky top-0 z-10 -mx-5 mb-2 bg-bg-elev px-5 pb-3">
        <div className="flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5">
          <Search size={17} className="shrink-0 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Помідор, курка, рис…"
            className="h-full flex-1 text-[15px]"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Очистити">
              <X size={16} className="text-muted" />
            </button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">
          Нічого не знайшлось. Спробуй іншу назву.
        </p>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-muted">
                {CAT_LABEL[cat]}
              </h3>
              <div className="flex flex-wrap gap-2">
                {items.map((def) => (
                  <button
                    key={def.key}
                    onClick={() => {
                      onPick(def);
                      if (!keepOpen) onClose();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-2 pl-3 pr-3 text-[13px] font-semibold active:bg-surface-2"
                  >
                    <span>{def.emoji}</span>
                    {def.label}
                    <Plus size={13} className="text-brand" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
