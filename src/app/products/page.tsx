"use client";

import { Barcode, Plus, Search, WifiOff, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { FoodScanner } from "@/components/diary/FoodScanner";
import { ProductThumb } from "@/components/diary/ProductThumb";
import { useFoodFlows } from "@/components/diary/useFoodFlows";
import { ProductEditorSheet, packLabel, useOnline } from "@/components/ProductEditorSheet";
import { ProductCard } from "@/components/products/ProductCard";
import { TopBar } from "@/components/TopBar";
import { EmptyState, Panel, PanelHeader, TILE_BUTTON, TILE_BUTTON_BRAND } from "@/components/ui";
import { CAT_LABEL, CAT_ORDER, allIngredients, ing, knownIngredient, lineage } from "@/data/ingredients";
import type { Product } from "@/lib/product-types";
import { restaurantOfProductId } from "@/lib/restaurants";
import { diaryUserId, useApp } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { browseProducts, fetchProductsByIds, searchProducts } from "@/lib/supabase/products-api";
import type { IngredientCat } from "@/lib/types";
import { cn, haptic } from "@/lib/utils";

/**
 * Бібліотека товарів — як вітрина доставки: категорії, плитки з фото й
 * калоріями, картка товару з КБЖВ і діями.
 *
 * «Мої» — те, що є в коморі, і те, що ти їв: твоя особиста полиця. Решта —
 * спільний каталог, який наповнюють скани всіх. Товар належить типу, тип —
 * категорії: «Моцарела Galbani» лежить під «Сир», а той — у «Молочне та яйця»,
 * тож різні сири з різними калоріями живуть поруч, але не зливаються.
 */

const CAT_EMOJI: Record<IngredientCat, string> = {
  veg: "🥦",
  fruit: "🍎",
  meat: "🥩",
  fish: "🐟",
  dairy: "🧀",
  grain: "🌾",
  spice: "🧂",
  sauce: "🫒",
  bakery: "🥖",
  drink: "🥤",
  other: "🛒",
};

type Tab = "mine" | IngredientCat;

/** Скільки ключів типів в одному запиті: довгий `in (…)` не влазить в адресу. */
const KEYS_PER_QUERY = 80;

export default function ProductsPage() {
  const hydrated = useApp((s) => s.hydrated);
  const account = useApp((s) => s.account);
  const products = useApp((s) => s.products);
  const pantry = useApp((s) => s.pantry);
  const foodLog = useApp((s) => s.foodLog);
  const upsertProducts = useApp((s) => s.upsertProducts);
  const online = useOnline();
  const flows = useFoodFlows();

  const [tab, setTab] = useState<Tab>("mine");
  const [query, setQuery] = useState("");
  const [shelf, setShelf] = useState<Product[] | null>(null);
  const [found, setFound] = useState<Product[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Product | null>(null);
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(false);

  const me = diaryUserId({ account });
  const inPantry = useMemo(() => new Set(pantry.flatMap((r) => (r.productId ? [r.productId] : []))), [pantry]);

  /** Моя полиця: комора й зʼїдене. Картки, яких нема в кеші, дочитуємо. */
  const mineIds = useMemo(() => {
    // Страви із закладів теж лежать у productId, але це не товари каталогу.
    const eaten = foodLog
      .filter((e) => e.userId === me && e.productId && !restaurantOfProductId(e.productId))
      .map((e) => e.productId as string);
    return [...new Set([...inPantry, ...eaten])];
  }, [foodLog, me, inPantry]);

  useEffect(() => {
    if (!hydrated || !isSupabaseConfigured || !online) return;
    const missing = mineIds.filter((id) => !useApp.getState().products[id]);
    if (missing.length === 0) return;
    fetchProductsByIds(missing)
      .then((list) => useApp.getState().upsertProducts(list))
      .catch(() => {});
  }, [hydrated, online, mineIds]);

  /* Вітрина категорії: свіжі картки її типів зі спільного каталогу. */
  useEffect(() => {
    if (tab === "mine" || !isSupabaseConfigured || !online) {
      setShelf(null);
      return;
    }
    const keys = allIngredients()
      .filter((d) => d.cat === tab)
      .map((d) => d.key);
    const ctrl = new AbortController();
    setLoading(true);
    const parts: string[][] = [];
    for (let i = 0; i < keys.length; i += KEYS_PER_QUERY) parts.push(keys.slice(i, i + KEYS_PER_QUERY));
    Promise.all(parts.map((part) => browseProducts(part, 60, 0, ctrl.signal)))
      .then((lists) => {
        if (ctrl.signal.aborted) return;
        const all = lists.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setShelf(all.slice(0, 120));
        upsertProducts(all);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setShelf([]);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, online]);

  /* Пошук: каталог, а без звʼязку — те, що вже є на пристрої. */
  const typed = query.trim();
  useEffect(() => {
    if (typed.length < 2 || !isSupabaseConfigured || !online) {
      setFound(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      searchProducts(typed, null, 40, ctrl.signal)
        .then((list) => {
          if (ctrl.signal.aborted) return;
          setFound(list);
          upsertProducts(list);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setFound([]);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, online]);

  const visible = useMemo(() => {
    const live = (p: Product) => products[p.id] ?? p;
    const ok = (p: Product) => !p.archived && !p.mergedInto;
    if (typed.length >= 2) {
      const needle = typed.toLowerCase();
      const local = Object.values(products).filter(
        (p) => ok(p) && `${p.name} ${p.brand ?? ""}`.toLowerCase().includes(needle),
      );
      const remote = (found ?? []).map(live);
      const ids = new Set(remote.map((p) => p.id));
      return [...remote, ...local.filter((p) => !ids.has(p.id))].filter(ok);
    }
    if (tab === "mine") return mineIds.flatMap((id) => products[id] ?? []).filter(ok);
    const cached = Object.values(products).filter((p) => ok(p) && knownIngredient(p.typeKey) && ing(p.typeKey).cat === tab);
    const fromShelf = (shelf ?? []).map(live);
    const ids = new Set(fromShelf.map((p) => p.id));
    return [...fromShelf, ...cached.filter((p) => !ids.has(p.id))].filter(ok);
  }, [typed, found, tab, mineIds, products, shelf]);

  /** Групи «як у доставці»: за головним типом — «Сир», «Молоко», «Ковбаса». */
  const groups = useMemo(() => {
    const byRoot = new Map<string, Product[]>();
    for (const p of visible) {
      const chain = lineage(p.typeKey);
      const root = chain[chain.length - 1] ?? p.typeKey;
      const list = byRoot.get(root) ?? [];
      list.push(p);
      byRoot.set(root, list);
    }
    return [...byRoot.entries()]
      .map(([root, list]) => ({ root, list: list.sort((a, b) => a.name.localeCompare(b.name, "uk")) }))
      .sort((a, b) => {
        const ca = CAT_ORDER.indexOf(ing(a.root).cat);
        const cb = CAT_ORDER.indexOf(ing(b.root).cat);
        return ca - cb || b.list.length - a.list.length || ing(a.root).label.localeCompare(ing(b.root).label, "uk");
      });
  }, [visible]);

  const pick = (p: Product) => {
    haptic(10);
    setOpen(p);
  };

  return (
    <div className="pb-8">
      <TopBar
        title="Товари"
        subtitle="Твоя полиця і спільний каталог"
        right={
          <>
            <motion.button
              whileTap={{ scale: 0.88 }}
              aria-label="Новий товар"
              onClick={() => {
                haptic(8);
                setCreating(true);
              }}
              className={TILE_BUTTON}
            >
              <Plus size={19} />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.88 }}
              aria-label="Сканувати штрихкод"
              onClick={() => {
                haptic(8);
                setScanning(true);
              }}
              className={TILE_BUTTON_BRAND}
            >
              <Barcode size={19} />
            </motion.button>
          </>
        }
      />

      {/* Пошук і категорії липнуть під шапкою: каталог довгий, а перемкнути полицю треба будь-коли. */}
      <div className="sticky top-[calc(56px+env(safe-area-inset-top))] z-20 bg-bg px-4 pb-2.5">
        <label className="flex h-[46px] items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5">
          <Search size={18} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Молоко безлактозне Галичина"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
          />
          {query && (
            <button aria-label="Очистити" onClick={() => setQuery("")} className="text-muted">
              <X size={16} />
            </button>
          )}
        </label>
        {typed.length < 2 && (
          <div className="no-scrollbar -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4">
            <CatChip active={tab === "mine"} onClick={() => setTab("mine")}>
              ⭐ Мої
            </CatChip>
            {CAT_ORDER.map((cat) => (
              <CatChip key={cat} active={tab === cat} onClick={() => setTab(cat)}>
                {CAT_EMOJI[cat]} {CAT_LABEL[cat]}
              </CatChip>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-4">
      {!online && (
        <p className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[12.5px] font-semibold text-muted">
          <WifiOff size={15} className="shrink-0" /> Без звʼязку — показую те, що вже є на телефоні.
        </p>
      )}

      {!hydrated || (loading && visible.length === 0) ? (
        <Panel aria-busy>
          <div className="flex h-9 items-center px-3.5">
            <span className="shimmer h-2.5 w-24 rounded-[4px] bg-surface-2" />
          </div>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex h-16 items-center gap-3 border-t border-line px-3.5">
              <span className="shimmer h-11 w-11 shrink-0 rounded-[8px] bg-surface-2" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="shimmer h-3 w-3/5 rounded-[4px] bg-surface-2" />
                <span className="shimmer h-2.5 w-2/5 rounded-[4px] bg-surface-2" />
              </span>
            </div>
          ))}
        </Panel>
      ) : groups.length === 0 ? (
        typed.length >= 2 ? (
          <EmptyState
            emoji="🔎"
            title="Нічого не знайшлось"
            note="Відскануй штрихкод — і товар зʼявиться в каталозі для всіх."
          />
        ) : tab === "mine" ? (
          <EmptyState
            emoji="🧺"
            title="Полиця ще порожня"
            note="Тут збираються товари з твоєї комори й ті, що ти їв. Відскануй перший — батончик, молоко, сир."
          />
        ) : (
          <EmptyState emoji={CAT_EMOJI[tab]} title="Тут поки пусто" note="Відскануй товар цієї категорії — він стане першим." />
        )
      ) : (
        groups.map(({ root, list }) => (
          <Panel key={root}>
            <PanelHeader
              label={
                <>
                  <span className="text-[13px] normal-case tracking-normal">{ing(root).emoji}</span>
                  {ing(root).label}
                </>
              }
              aside={String(list.length)}
            />
            {list.map((p) => (
              <Tile key={p.id} product={p} inPantry={inPantry.has(p.id)} onClick={() => pick(p)} />
            ))}
          </Panel>
        ))
      )}
      </div>

      <ProductCard
        product={open}
        onClose={() => setOpen(null)}
        onEat={(p) => {
          setOpen(null);
          flows.amount({ kind: "product", product: p }, "search");
        }}
      />

      <FoodScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onProduct={(p) => setOpen(p)}
      />

      <ProductEditorSheet
        open={creating}
        onClose={() => setCreating(false)}
        draft={{ typeKey: "", name: query.trim(), guessed: [], provenance: { from: "manual" } }}
        title="Новий товар"
        onSaved={(p) => {
          upsertProducts([p]);
          setCreating(false);
          setOpen(p);
        }}
        onProductChanged={(p) => upsertProducts([p])}
      />

      {flows.ui}
    </div>
  );
}

/** Категорія над списком: як фільтри в редизайні, а не круглі чипи. */
function CatChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => {
        haptic(8);
        onClick();
      }}
      aria-pressed={active}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-[8px] border px-2.5 text-[12.5px] font-bold transition-colors",
        active ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface text-muted",
      )}
    >
      {children}
    </button>
  );
}

/** Рядок товару в панелі групи: фото, назва, бренд і пачка, калорії праворуч. */
function Tile({ product, inPantry, onClick }: { product: Product; inPantry: boolean; onClick: () => void }) {
  const n = product.nutrition;
  const sub = [product.brand, packLabel(product)].filter(Boolean).join(" · ");
  return (
    <button
      onClick={onClick}
      className="flex h-16 w-full items-center gap-3 border-t border-line px-3.5 text-left active:bg-surface-2"
    >
      <ProductThumb product={product} className="h-11 w-11 shrink-0 rounded-[8px]" emojiClass="text-[22px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-bold">{product.name}</span>
          {inPantry && (
            <span className="flex h-[18px] shrink-0 items-center rounded-[5px] bg-brand/15 px-1.5 text-[10.5px] font-extrabold text-brand">
              вдома
            </span>
          )}
        </span>
        {sub && <span className="block truncate text-[12px] font-semibold text-faint">{sub}</span>}
      </span>
      <span className={cn("shrink-0 text-[12.5px] font-bold", n ? "text-muted" : "text-faint")}>
        {n ? `${product.nutritionSource === "ai" ? "≈" : ""}${Math.round(n.kcal)} ккал` : "КБЖВ ?"}
      </span>
    </button>
  );
}
