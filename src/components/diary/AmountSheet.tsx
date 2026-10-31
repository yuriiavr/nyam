"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProductEditorSheet, nutritionLine, productMeta } from "@/components/ProductEditorSheet";
import { Button, Panel, Sheet, formatKcal, useToast } from "@/components/ui";
import { ing, knownIngredient } from "@/data/ingredients";
import { eatenAtFor, forGrams, portionPresets } from "@/lib/diary";
import { consumeRows, productTakes } from "@/lib/pantry";
import type { Product } from "@/lib/product-types";
import { diaryUserId, useApp } from "@/lib/store";
import type { FoodEntry, FoodSource, MealSlot } from "@/lib/types";
import { formatNumber } from "@/lib/units";
import { cn, dateKey, haptic, newId } from "@/lib/utils";
import { PeopleSwitch, usePeople } from "./people";
import { ProductThumb } from "./ProductThumb";
import { CheckRow, KcalAside, MacroCells, SheetTitle, SlotRow } from "./SheetParts";

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
        title={
          <SheetTitle
            emoji={
              <ProductThumb
                product={product}
                typeKey={typeKey}
                className="h-10 w-10 shrink-0 rounded-[10px]"
                emojiClass="text-[22px]"
              />
            }
            title={title}
            sub={product ? productMeta(product) : undefined}
            aside={eaten && <KcalAside kcal={formatKcal(eaten.kcal)} />}
          />
        }
        footer={
          <Button full disabled={!valid} onClick={save}>
            Записати{eaten ? ` · ${eaten.kcal} ккал` : ""}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-3">
          {(eaten || per100) && (
            <Panel>
              {eaten && <MacroCells nutrition={eaten} />}
              {per100 && (
                <p className={cn("px-3.5 py-2.5 text-[11.5px] font-semibold text-faint", eaten && "border-t border-line")}>
                  {product?.nutritionSource === "ai" && <span className="font-bold text-brand">≈ </span>}
                  {nutritionLine(per100)} / 100 {liquid ? "мл" : "г"}
                </p>
              )}
            </Panel>
          )}

          {product && (!label || product.nutritionSource === "ai") && (
            <Panel>
              <p className="px-3.5 py-3 text-[12.5px] font-semibold leading-snug text-muted">
                {label
                  ? "Числа — оцінка ШІ. Пачка під рукою? Перепиши з етикетки — картка стане точною для всіх."
                  : byType
                    ? `У картки немає КБЖВ — поки рахую за середнім для «${type?.label}». Точніше буде з етикетки цього товару.`
                    : "У картки немає КБЖВ — без них калорії не порахувати."}
              </p>
              <button
                onClick={() => {
                  haptic(8);
                  setEditing(true);
                }}
                className="flex h-12 w-full items-center gap-2.5 border-t border-line px-3.5 text-left active:bg-surface-2"
              >
                <Sparkles size={16} strokeWidth={2.2} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1 text-[14px] font-bold text-brand">
                  {label ? "Уточнити КБЖВ" : "Додати КБЖВ"}
                </span>
                <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-faint" />
              </button>
            </Panel>
          )}

          <Panel>
            <label className="flex h-[50px] items-center gap-2 px-3.5">
              <span className="flex-1 text-[14px] font-semibold text-muted">Скільки</span>
              <input
                value={grams}
                onChange={(e) => setGrams(e.target.value.replace(/[^\d.,]/g, ""))}
                inputMode="decimal"
                aria-label="Скільки грамів"
                className={cn(
                  "h-8 w-[84px] rounded-[8px] bg-surface-2 px-2.5 text-right text-[14px] font-bold",
                  !(valid || !grams) && "text-berry ring-1 ring-berry",
                )}
              />
              <span className="w-5 text-[14px] font-bold text-muted">{liquid ? "мл" : "г"}</span>
            </label>
            {presets.length > 0 && (
              <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-3.5 pb-3">
                {presets.map((p) => {
                  const on = valid && Math.abs(amount - p.grams) < 0.5;
                  return (
                    <button
                      key={p.label}
                      aria-pressed={on}
                      onClick={() => {
                        haptic(8);
                        setGrams(formatNumber(p.grams, 0));
                      }}
                      className={cn(
                        "h-8 shrink-0 rounded-[8px] border px-2.5 text-[12.5px] font-bold transition-colors",
                        on ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface-2 text-muted",
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}
            {preview.length > 0 && (
              <CheckRow checked={fromPantry} onChange={setFromPantry} divided>
                Взяв з комори
                <span className="font-semibold text-faint">
                  {" · "}
                  {preview.every((c) => c.left == null)
                    ? "там більше не лишиться"
                    : `лишиться ${preview.map((c) => c.left).filter(Boolean).join(" + ")}`}
                </span>
              </CheckRow>
            )}
          </Panel>

          <Panel>
            <SlotRow value={slot} onChange={setSlot} />
            {people.length > 1 && (
              <div className="flex flex-col gap-2 border-t border-line px-3.5 pb-3 pt-2.5">
                <span className="text-[14px] font-semibold text-muted">Хто зʼїв</span>
                <PeopleSwitch people={people} value={who} onChange={setWho} />
              </div>
            )}
          </Panel>
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
