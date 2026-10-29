"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProductEditorSheet, nutritionLine, productMeta } from "@/components/ProductEditorSheet";
import { Button, Chip, Segmented, Sheet, useToast } from "@/components/ui";
import { ing, knownIngredient } from "@/data/ingredients";
import { SLOT_META, SLOT_ORDER, eatenAtFor, forGrams, portionPresets } from "@/lib/diary";
import { consumeRows, productTakes } from "@/lib/pantry";
import type { Product } from "@/lib/product-types";
import { diaryUserId, useApp } from "@/lib/store";
import type { FoodEntry, FoodSource, MealSlot } from "@/lib/types";
import { formatNumber } from "@/lib/units";
import { cn, dateKey, haptic, newId } from "@/lib/utils";
import { PeopleSwitch, usePeople } from "./people";
import { ProductThumb } from "./ProductThumb";

/** Що саме зʼїли: конкретний товар із каталогу або просто тип («банан»). */
export type FoodTarget =
  | { kind: "product"; product: Product; grams?: number }
  | { kind: "type"; typeKey: string; label?: string; grams?: number };

/**
 * «Скільки зʼїв?» для одного товару: батончик зі сканера, йогурт із пошуку.
 *
 * Кількість — швидкими кнопками з упаковки («уся пачка», «1 шт»), а грами
 * руками лише тоді, коли треба. Картка без КБЖВ не блокує запис: можна
 * одразу дописати числа (з етикетки, з фото або оцінкою ШІ) — і вони
 * лишаться на картці для всіх, хто цей товар сканує далі.
 */
export function AmountSheet({
  open,
  onClose,
  target,
  slot: initialSlot,
  day = dateKey(),
  source,
  forUser,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  target: FoodTarget | null;
  slot: MealSlot;
  /** Який день щоденника: можна дописати вчорашню вечерю. */
  day?: string;
  source: FoodSource;
  /** Кому записати за замовчуванням (щоденник рідного, відкритий зараз). */
  forUser?: string;
  onLogged?: (entry: FoodEntry) => void;
}) {
  const people = usePeople();
  const account = useApp((s) => s.account);
  const logFood = useApp((s) => s.logFood);
  const upsertProducts = useApp((s) => s.upsertProducts);
  const pantry = useApp((s) => s.pantry);
  const products = useApp((s) => s.products);
  const consumePantryRows = useApp((s) => s.consumePantryRows);
  const toast = useToast();
  // Свіжа версія картки з кешу: щойно дописане КБЖВ має зʼявитись тут же.
  const product = useApp((s) =>
    target?.kind === "product" ? (s.products[target.product.id] ?? target.product) : null,
  );
  const typeKey = product?.typeKey ?? (target?.kind === "type" ? target.typeKey : "");
  const type = typeKey && knownIngredient(typeKey) ? ing(typeKey) : null;

  const presets = useMemo(
    () => portionPresets(product ?? {}, type?.gramsPerPiece),
    [product, type?.gramsPerPiece],
  );

  const [grams, setGrams] = useState("");
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [who, setWho] = useState("");
  const [editing, setEditing] = useState(false);
  // Батончик із холодильника — списуємо; купили дорогою — людина зніме галочку.
  const [fromPantry, setFromPantry] = useState(true);

  useEffect(() => {
    if (!open || !target) return;
    const start = target.grams ?? presets[0]?.grams ?? 100;
    setGrams(formatNumber(start, 0));
    setSlot(initialSlot);
    setWho(forUser ?? diaryUserId({ account }));
    setFromPantry(true);
    // Лише на відкритті: інакше свіжа картка з кешу скидала б набране.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  if (!target) return null;

  const label = product?.nutrition;
  const per100 = label ?? type?.nutrition;
  const byType = !label && !!type?.nutrition;
  const amount = Number(grams.replace(",", "."));
  const valid = Number.isFinite(amount) && amount > 0 && amount <= 5000;
  const eaten = per100 && valid ? forGrams(per100, amount) : null;
  const liquid = product?.packUnit === "ml" || product?.packUnit === "l";
  const title = product?.name ?? (target.kind === "type" ? (target.label ?? type?.label ?? typeKey) : "");
  const takes = product && valid ? productTakes(pantry, product.id, amount, products) : [];
  const preview = takes.length ? consumeRows(pantry, takes, products).consumed : [];

  const save = () => {
    if (!valid) return;
    const me = diaryUserId({ account });
    const used = fromPantry && takes.length ? consumePantryRows(takes) : null;
    const entry: FoodEntry = {
      id: newId(),
      userId: who || me,
      loggedBy: me,
      eatenAt: eatenAtFor(day, slot),
      slot,
      title,
      emoji: type?.emoji ?? "🍽️",
      ...(product ? { productId: product.id } : {}),
      grams: amount,
      nutrition: eaten ?? undefined,
      source,
      ...(used?.taken.length ? { pantryTaken: used.taken } : {}),
    };
    logFood([entry]);
    if (used?.consumed.length) toast(`Списано з комори: ${used.consumed.map((c) => c.label).join(", ")}`, "🧺");
    haptic(14);
    onLogged?.(entry);
    onClose();
  };

  return (
    <>
      <Sheet
        open={open && !editing}
        onClose={onClose}
        footer={
          <Button full size="lg" disabled={!valid} onClick={save}>
            Записати{eaten ? ` · ${eaten.kcal} ккал` : ""}
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex items-center gap-3">
            <ProductThumb product={product} typeKey={typeKey} className="h-16 w-16 shrink-0 rounded-2xl" />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[17px] font-bold leading-tight">{title}</h2>
              {product && productMeta(product) && (
                <p className="mt-0.5 truncate text-[12px] text-muted">{productMeta(product)}</p>
              )}
              {per100 && (
                <p className="mt-1 text-[11.5px] text-muted">
                  {product?.nutritionSource === "ai" && <span className="font-bold text-brand">≈ </span>}
                  {nutritionLine(per100)} <span className="text-faint">/ 100 {liquid ? "мл" : "г"}</span>
                </p>
              )}
            </div>
          </div>

          {product && (!label || product.nutritionSource === "ai") && (
            <div className="rounded-2xl bg-surface-2 p-3">
              <p className="text-[12.5px] leading-snug">
                {label
                  ? "Числа — оцінка ШІ. Пачка під рукою? Перепиши з етикетки — картка стане точною для всіх."
                  : byType
                    ? `У картки немає КБЖВ — поки рахую за середнім для «${type?.label}». Точніше буде з етикетки цього товару.`
                    : "У картки немає КБЖВ — без них калорії не порахувати."}
              </p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => setEditing(true)}>
                <Sparkles size={15} />
                {label ? "Уточнити КБЖВ" : "Додати КБЖВ"}
              </Button>
            </div>
          )}

          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">Скільки</p>
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {presets.map((p) => (
                <Chip key={p.label} active={valid && Math.abs(amount - p.grams) < 0.5} onClick={() => setGrams(formatNumber(p.grams, 0))}>
                  {p.label}
                </Chip>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={grams}
                onChange={(e) => setGrams(e.target.value.replace(/[^\d.,]/g, ""))}
                inputMode="decimal"
                aria-label="Скільки грамів"
                className={cn(
                  "h-12 w-28 rounded-2xl border bg-surface px-3 text-center font-display text-[20px] font-bold",
                  valid || !grams ? "border-line" : "border-berry",
                )}
              />
              <span className="text-[15px] font-semibold text-muted">{liquid ? "мл" : "г"}</span>
              {eaten && (
                <span className="ml-auto text-right text-[12px] leading-tight text-muted">
                  <span className="font-display text-[18px] font-extrabold text-ink">{eaten.kcal}</span> ккал
                  <br />Б {formatNumber(eaten.protein, 1)} · Ж {formatNumber(eaten.fat, 1)} · В {formatNumber(eaten.carbs, 1)}
                </span>
              )}
            </div>
          </div>

          {preview.length > 0 && (
            <label className="flex items-center gap-2.5 px-1 text-[13px]">
              <input
                type="checkbox"
                checked={fromPantry}
                onChange={(e) => setFromPantry(e.target.checked)}
                className="h-5 w-5 accent-[var(--brand)]"
              />
              <span>
                Взяв з комори
                <span className="text-muted">
                  {" · "}
                  {preview.every((c) => c.left == null)
                    ? "там більше не лишиться"
                    : `лишиться ${preview.map((c) => c.left).filter(Boolean).join(" + ")}`}
                </span>
              </span>
            </label>
          )}

          <Segmented
            value={slot}
            onChange={setSlot}
            options={SLOT_ORDER.map((s) => ({ value: s, label: SLOT_META[s].label }))}
          />

          {people.length > 1 && (
            <div>
              <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">Хто зʼїв</p>
              <PeopleSwitch people={people} value={who} onChange={setWho} />
            </div>
          )}
        </div>
      </Sheet>

      {product && (
        <ProductEditorSheet
          open={open && editing}
          onClose={() => setEditing(false)}
          product={product}
          saveLabel="Зберегти КБЖВ"
          onSaved={(p) => {
            upsertProducts([p]);
            setEditing(false);
          }}
          onProductChanged={(p) => upsertProducts([p])}
        />
      )}
    </>
  );
}
