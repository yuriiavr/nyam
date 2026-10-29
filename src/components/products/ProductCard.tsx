"use client";

import { History, Pencil, Refrigerator, ShoppingBasket, Sparkles, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { ProductThumb } from "@/components/diary/ProductThumb";
import { ProductEditorSheet, productMeta, typeTrail } from "@/components/ProductEditorSheet";
import { ProductSheet } from "@/components/ProductSheet";
import { Button, MacroBar, Sheet, useToast } from "@/components/ui";
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
            <Button
              full
              size="lg"
              onClick={() => {
                haptic(10);
                onEat(product);
              }}
            >
              <UtensilsCrossed size={18} />
              Зʼїв
            </Button>
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
        <div className="flex flex-col gap-4 pb-2">
          <ProductThumb product={product} className="h-52 w-full rounded-3xl" emojiClass="text-[84px]" />

          <div>
            <h2 className="font-display text-[20px] font-extrabold leading-tight">{product.name}</h2>
            {productMeta(product) && <p className="mt-1 text-[13px] text-muted">{productMeta(product)}</p>}
            {type && (
              <p className="mt-1 text-[12px] text-faint">
                {type.emoji} {typeTrail(product.typeKey)}
              </p>
            )}
            {rows.length > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-mint/15 px-2.5 py-1 text-[12px] font-bold text-mint">
                <Refrigerator size={13} />
                У коморі: {rows.length} {plural(rows.length, "пачка", "пачки", "пачок")}
                {left > 0 && ` · ${formatQuantity(Math.round(left), liquid ? "ml" : "g")}`}
              </p>
            )}
          </div>

          {n ? (
            <div className="rounded-3xl bg-surface-2 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-bold uppercase tracking-wide text-muted">
                  На 100 {liquid ? "мл" : "г"}
                </p>
                {ai ? (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand">≈ оцінка ШІ</span>
                ) : (
                  <span className="text-[11px] text-faint">з етикетки</span>
                )}
              </div>
              <NutritionGrid n={n} />
              <MacroBar nutrition={n} className="mt-3" />
              {perPack && (
                <p className="mt-3 text-[12.5px] text-muted">
                  Уся пачка ({formatNumber(pack ?? 0, 0)} {liquid ? "мл" : "г"}):{" "}
                  <span className="font-bold text-ink">{perPack.kcal} ккал</span> · Б {formatNumber(perPack.protein, 1)} · Ж{" "}
                  {formatNumber(perPack.fat, 1)} · В {formatNumber(perPack.carbs, 1)}
                </p>
              )}
              {ai && (
                <button onClick={() => setEditing(true)} className="mt-2 text-[12.5px] font-bold text-brand">
                  Пачка під рукою? Переписати з етикетки
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-line p-4">
              <p className="text-[13.5px] font-bold">КБЖВ ще ніхто не вписав</p>
              <p className="mt-1 text-[12.5px] leading-snug text-muted">
                Сфотографуй етикетку чи попроси ШІ оцінити — і калорії цього товару рахуватимуться точно, у тебе й у всіх.
              </p>
              <Button size="sm" className="mt-3" onClick={() => setEditing(true)}>
                <Sparkles size={15} />
                Додати КБЖВ
              </Button>
            </div>
          )}

          <div className="flex gap-4">
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-[13px] font-bold text-muted">
              <Pencil size={14} /> Редагувати
            </button>
            <button onClick={() => setDetails(true)} className="flex items-center gap-1.5 text-[13px] font-bold text-muted">
              <History size={14} /> Історія й штрихкоди
            </button>
          </div>
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
    <div className="mt-2 grid grid-cols-4 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="rounded-2xl bg-bg-elev px-1 py-2.5 text-center">
          <p className="font-display text-[19px] font-extrabold leading-none" style={{ color: c.color }}>
            {c.value}
          </p>
          <p className="mt-1 text-[10.5px] text-muted">{c.label}</p>
        </div>
      ))}
    </div>
  );
}
