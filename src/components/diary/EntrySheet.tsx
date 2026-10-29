"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Segmented, Sheet, useToast } from "@/components/ui";
import {
  SLOT_META,
  SLOT_ORDER,
  entryNutrition,
  forGrams,
  mealNutrition,
  portionLabel,
  roundNutrition,
  scaleNutrition,
} from "@/lib/diary";
import { pantryDisplayName } from "@/lib/pantry";
import { diaryUserId, recipeById, useApp } from "@/lib/store";
import type { FoodEntry, MealSlot, Nutrition } from "@/lib/types";
import { formatNumber } from "@/lib/units";
import { haptic } from "@/lib/utils";
import { nutritionLine } from "@/components/ProductEditorSheet";

/**
 * Один запис щоденника: скільки, коли, прибрати.
 *
 * Товар міряємо грамами, частку страви — порціями: так людина й памʼятає
 * («я зʼїв дві порції», а не «0,4 каструлі»).
 */
export function EntrySheet({ entry, onClose }: { entry: FoodEntry | null; onClose: () => void }) {
  const account = useApp((s) => s.account);
  const products = useApp((s) => s.products);
  const meals = useApp((s) => s.meals);
  const updateFoodEntry = useApp((s) => s.updateFoodEntry);
  const removeFoodEntries = useApp((s) => s.removeFoodEntries);
  const toast = useToast();

  const [grams, setGrams] = useState("");
  const [portions, setPortions] = useState(0);
  const [slot, setSlot] = useState<MealSlot>("snack");

  const meal = entry?.mealId ? meals.find((m) => m.id === entry.mealId) : undefined;
  const recipe = meal?.recipeId ? recipeById(useApp.getState(), meal.recipeId) : undefined;

  useEffect(() => {
    if (!entry) return;
    setGrams(entry.grams != null ? formatNumber(entry.grams, 0) : "");
    setPortions(meal && entry.share ? Math.round(entry.share * meal.servings * 4) / 4 : 0);
    setSlot(entry.slot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  if (!entry) return null;

  const me = diaryUserId({ account });
  const editable = entry.userId === me || entry.loggedBy === me || !entry.loggedBy;
  const product = entry.productId ? products[entry.productId] : undefined;

  /** КБЖВ на 100 г: з картки, а нема картки в кеші — з самого запису. */
  const per100: Nutrition | undefined =
    product?.nutrition ??
    (entry.nutrition && entry.grams ? scaleNutrition(entry.nutrition, 100 / entry.grams) : undefined);

  const amount = Number(grams.replace(",", "."));
  const byGrams = !entry.mealId && entry.grams != null;
  const total = meal ? mealNutrition(meal, recipe) : undefined;
  const share = meal ? Math.min(1, portions / meal.servings) : entry.share;

  const next: Nutrition | undefined = byGrams
    ? per100 && amount > 0
      ? forGrams(per100, amount)
      : undefined
    : meal && total && share
      ? roundNutrition(scaleNutrition(total, share))
      : entryNutrition(entry, () => meal, () => recipe);

  const valid = byGrams ? amount > 0 && amount <= 5000 : !meal || portions > 0;

  const save = () => {
    if (!valid) return;
    updateFoodEntry(entry.id, {
      slot,
      ...(byGrams ? { grams: amount } : {}),
      ...(meal && share ? { share: Math.round(share * 1000) / 1000 } : {}),
      nutrition: next,
    });
    haptic(12);
    onClose();
  };

  const remove = () => {
    const back = removeFoodEntries([entry.id]);
    haptic(14);
    if (back.length) {
      toast(`Повернуто в комору: ${back.map((row) => pantryDisplayName(row, products)).join(", ")}`, "🧺");
    }
    onClose();
  };

  return (
    <Sheet
      open={!!entry}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="text-xl">{entry.emoji}</span>
          <span className="min-w-0 truncate">{entry.title}</span>
        </span>
      }
      footer={
        editable ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={remove} aria-label="Прибрати запис">
              <Trash2 size={18} />
            </Button>
            <Button full size="lg" disabled={!valid} onClick={save}>
              Зберегти{next ? ` · ${next.kcal} ккал` : ""}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {next ? (
          <p className="text-[13px] text-muted">{nutritionLine(next)}</p>
        ) : (
          <p className="text-[13px] text-muted">Калорії невідомі — у товару чи страви немає КБЖВ.</p>
        )}

        {!editable && (
          <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-snug text-muted">
            Це чужий щоденник — правити його може лише власник.
          </p>
        )}

        {editable && byGrams && (
          <label className="flex items-center gap-2">
            <input
              value={grams}
              onChange={(e) => setGrams(e.target.value.replace(/[^\d.,]/g, ""))}
              inputMode="decimal"
              aria-label="Скільки грамів"
              className="h-12 w-28 rounded-2xl border border-line bg-surface px-3 text-center font-display text-[20px] font-bold"
            />
            <span className="text-[15px] font-semibold text-muted">г</span>
          </label>
        )}

        {editable && meal && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-3.5 py-3">
            <div>
              <p className="text-[12px] text-muted">Зʼїв із {portionLabel(meal.servings)}</p>
              <p className="font-display text-[20px] font-extrabold">{portionLabel(portions)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                aria-label="Менше"
                disabled={portions <= 0.25}
                onClick={() => setPortions((p) => Math.max(0.25, p - 0.25))}
                className="grid h-9 w-9 place-items-center rounded-xl bg-bg-elev active:bg-line disabled:opacity-35"
              >
                <Minus size={16} />
              </button>
              <button
                aria-label="Більше"
                disabled={portions >= meal.servings}
                onClick={() => setPortions((p) => Math.min(meal.servings, p + 0.25))}
                className="grid h-9 w-9 place-items-center rounded-xl bg-bg-elev active:bg-line disabled:opacity-35"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        )}

        {editable && (
          <Segmented
            value={slot}
            onChange={setSlot}
            options={SLOT_ORDER.map((s) => ({ value: s, label: SLOT_META[s].label }))}
          />
        )}
      </div>
    </Sheet>
  );
}
