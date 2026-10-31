"use client";

import { ChevronRight, History, Pencil, Refrigerator, ShoppingBasket, Sparkles, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { ProductThumb } from "@/components/diary/ProductThumb";
import { ProductEditorSheet, productMeta, typeTrail } from "@/components/ProductEditorSheet";
import { ProductSheet } from "@/components/ProductSheet";
import { Button, MacroBar, Panel, PanelHeader, Sheet, useToast } from "@/components/ui";
import { ing, knownIngredient } from "@/data/ingredients";
import { forGrams, packGrams } from "@/lib/diary";
import { rowGrams } from "@/lib/pantry";
import type { Product } from "@/lib/product-types";
import { rowFromProduct } from "@/lib/products";
import { useApp } from "@/lib/store";
import type { Nutrition } from "@/lib/types";
import { formatNumber, formatQuantity } from "@/lib/units";
import { haptic, newId, plural } from "@/lib/utils";

/**
 * Картка товару, як у застосунку доставки: велике фото, КБЖВ на 100 г і на
 * всю пачку, а під ними — що з ним зробити: зʼїсти, покласти в комору,
 * дописати в список покупок.
 *
 * Історія правок, штрихкоди й обʼєднання — у «Подробицях» (ProductSheet):
 * вони потрібні рідко, а картка має читатись з одного погляду.
 */
export function ProductCard({
  product: initial,
  onClose,
  onEat,
}: {
  product: Product | null;
  onClose: () => void;
  onEat: (product: Product) => void;
}) {
  const toast = useToast();
  const product = useApp((s) => (initial ? (s.products[initial.id] ?? initial) : null));
  const pantry = useApp((s) => s.pantry);
  const products = useApp((s) => s.products);
  const addPantry = useApp((s) => s.addPantry);
  const addShopping = useApp((s) => s.addShopping);
  const upsertProducts = useApp((s) => s.upsertProducts);
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);

  if (!product) return null;

  const n = product.nutrition;
  const ai = product.nutritionSource === "ai";
  const pack = packGrams(product);
  const perPack = n && pack ? forGrams(n, pack) : null;
  const liquid = product.packUnit === "ml" || product.packUnit === "l";
  const rows = pantry.filter((r) => r.productId === product.id);
  const left = rows.reduce((sum, r) => sum + (rowGrams(r, products) ?? 0), 0);
  const type = knownIngredient(product.typeKey) ? ing(product.typeKey) : null;

  const toPantry = () => {
    addPantry(rowFromProduct(product));
    haptic(12);
    toast(`«${product.name}» у коморі`, "🧺");
  };

  const toShopping = () => {
    const { fresh } = addShopping([
      {
        id: newId(),
        key: product.typeKey,
        text: product.name,
        done: false,
        addedAt: new Date().toISOString(),
        source: "manual",
      },
    ]);
    haptic(12);
    toast(fresh > 0 ? `«${product.name}» у списку` : "Уже в списку", "🛒");
  };

  return (
    <>
      <Sheet
        open={!!initial && !editing && !details}
        onClose={onClose}
        maxHeight="92dvh"
        footer={
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                haptic(10);
                onEat(product);
              }}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[12px] brand-gradient text-[15.5px] font-extrabold text-brand-ink active:opacity-90"
            >
              <UtensilsCrossed size={18} />
              Зʼїв
            </button>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={toPantry}>
                <Refrigerator size={17} />У комору
              </Button>
              <Button variant="secondary" className="flex-1" onClick={toShopping}>
                <ShoppingBasket size={17} />У список
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-2.5 pb-2">
          <ProductThumb product={product} className="h-52 w-full rounded-[10px]" emojiClass="text-[84px]" />

          <div className="px-0.5 pt-1">
            <h2 className="font-display text-[18px] font-bold leading-tight">{product.name}</h2>
            {productMeta(product) && (
              <p className="mt-1 text-[12.5px] font-semibold text-muted">{productMeta(product)}</p>
            )}
            {type && (
              <p className="mt-0.5 text-[12px] font-semibold text-faint">
                {type.emoji} {typeTrail(product.typeKey)}
              </p>
            )}
            {rows.length > 0 && (
              <p className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-brand/10 px-2 text-[12px] font-bold text-brand">
                <Refrigerator size={13} />
                У коморі: {rows.length} {plural(rows.length, "пачка", "пачки", "пачок")}
                {left > 0 && ` · ${formatQuantity(Math.round(left), liquid ? "ml" : "g")}`}
              </p>
            )}
          </div>

          {n ? (
            <Panel>
              <PanelHeader
                label={`На 100 ${liquid ? "мл" : "г"}`}
                aside={
                  ai ? (
                    <span className="flex h-5 items-center rounded-[5px] bg-brand/10 px-1.5 text-[11px] font-extrabold text-brand">
                      ≈ оцінка ШІ
                    </span>
                  ) : (
                    "з етикетки"
                  )
                }
              />
              <div className="border-t border-line px-3.5 pb-3.5 pt-3">
                <NutritionGrid n={n} />
                <MacroBar nutrition={n} className="mt-3" />
              </div>
              {perPack && (
                <p className="border-t border-line px-3.5 py-2.5 text-[12.5px] font-semibold text-muted">
                  Уся пачка ({formatNumber(pack ?? 0, 0)} {liquid ? "мл" : "г"}):{" "}
                  <span className="font-bold text-ink">{perPack.kcal} ккал</span> · Б {formatNumber(perPack.protein, 1)} · Ж{" "}
                  {formatNumber(perPack.fat, 1)} · В {formatNumber(perPack.carbs, 1)}
                </p>
              )}
              {ai && (
                <button
                  onClick={() => setEditing(true)}
                  className="flex h-11 w-full items-center gap-2 border-t border-line px-3.5 text-left active:bg-surface-2"
                >
                  <span className="flex-1 text-[13.5px] font-bold text-brand">Пачка під рукою? Переписати з етикетки</span>
                  <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-faint" />
                </button>
              )}
            </Panel>
          ) : (
            <div className="rounded-[10px] border border-dashed border-line-strong p-3.5">
              <p className="text-[14px] font-bold">КБЖВ ще ніхто не вписав</p>
              <p className="mt-1 text-[12.5px] font-semibold leading-snug text-muted">
                Сфотографуй етикетку чи попроси ШІ оцінити — і калорії цього товару рахуватимуться точно, у тебе й у всіх.
              </p>
              <Button size="sm" className="mt-3" onClick={() => setEditing(true)}>
                <Sparkles size={15} />
                Додати КБЖВ
              </Button>
            </div>
          )}

          <Panel>
            <button
              onClick={() => setEditing(true)}
              className="flex h-12 w-full items-center gap-2.5 px-3.5 text-left active:bg-surface-2"
            >
              <Pencil size={15} className="shrink-0 text-faint" />
              <span className="flex-1 text-[14px] font-semibold">Редагувати</span>
              <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
            </button>
            <button
              onClick={() => setDetails(true)}
              className="flex h-12 w-full items-center gap-2.5 border-t border-line px-3.5 text-left active:bg-surface-2"
            >
              <History size={15} className="shrink-0 text-faint" />
              <span className="flex-1 text-[14px] font-semibold">Історія й штрихкоди</span>
              <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
            </button>
          </Panel>
        </div>
      </Sheet>

      <ProductEditorSheet
        open={!!initial && editing}
        onClose={() => setEditing(false)}
        product={product}
        onSaved={(p) => {
          upsertProducts([p]);
          setEditing(false);
        }}
        onProductChanged={(p) => upsertProducts([p])}
      />

      <ProductSheet
        open={!!initial && details}
        onClose={() => setDetails(false)}
        product={product}
        onChanged={(p) => upsertProducts([p])}
        productNames={Object.fromEntries(Object.values(products).map((p) => [p.id, p.name]))}
      />
    </>
  );
}

function NutritionGrid({ n }: { n: Nutrition }) {
  const cells = [
    { label: "ккал", value: formatNumber(n.kcal, 0), color: "var(--ink)" },
    { label: "білки", value: formatNumber(n.protein, 1), color: "var(--macro-protein)" },
    { label: "жири", value: formatNumber(n.fat, 1), color: "var(--macro-fat)" },
    { label: "вугл.", value: formatNumber(n.carbs, 1), color: "var(--macro-carbs)" },
  ];
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {cells.map((c) => (
        <div key={c.label} className="rounded-[8px] bg-surface-2 px-1 py-2.5 text-center">
          <p className="font-display text-[17px] font-bold leading-none" style={{ color: c.color }}>
            {c.value}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-faint">{c.label}</p>
        </div>
      ))}
    </div>
  );
}
