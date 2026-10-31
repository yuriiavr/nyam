"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Panel, Sheet, formatKcal, useToast } from "@/components/ui";
import {
  SLOT_META,
  entryNutrition,
  forGrams,
  mealNutrition,
  portionLabel,
  roundNutrition,
  scaleNutrition,
} from "@/lib/diary";
import { pantryDisplayName } from "@/lib/pantry";
import {
  amountLabel,
  dishById,
  dishGrams,
  dishNutrition,
  maxPortions,
  portionsOfEntry,
  restaurantOfProductId,
} from "@/lib/restaurants";
import { diaryUserId, recipeById, useApp } from "@/lib/store";
import type { FoodEntry, MealSlot, Nutrition } from "@/lib/types";
import { formatNumber } from "@/lib/units";
import { haptic } from "@/lib/utils";
import { KcalAside, MacroCells, SheetTitle, SlotRow, StepButton } from "./SheetParts";
import { useRestaurantMenus } from "./useRestaurantMenus";

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

  /* Страва із закладу правиться порціями з офіційного меню, а не грамами. */
  const restaurant = restaurantOfProductId(entry?.productId);
  const menus = useRestaurantMenus(restaurant ? [restaurant.id] : []);
  const menu = restaurant ? menus[restaurant.id] : undefined;
  const dish = restaurant && menu && entry?.productId ? dishById(menu, restaurant.id, entry.productId) : undefined;
  const [dishPortions, setDishPortions] = useState(1);

  useEffect(() => {
    if (!entry) return;
    setGrams(entry.grams != null ? formatNumber(entry.grams, 0) : "");
    setPortions(meal && entry.share ? Math.round(entry.share * meal.servings * 4) / 4 : 0);
    setSlot(entry.slot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  // Меню могло доїхати вже після відкриття.
  useEffect(() => {
    if (entry && dish) setDishPortions(portionsOfEntry(dish, entry));
  }, [entry, dish]);

  if (!entry) return null;

  const me = diaryUserId({ account });
  const editable = entry.userId === me || entry.loggedBy === me || !entry.loggedBy;
  const product = entry.productId ? products[entry.productId] : undefined;

  /** КБЖВ на 100 г: з картки, а нема картки в кеші — з самого запису. */
  const per100: Nutrition | undefined =
    product?.nutrition ??
    (entry.nutrition && entry.grams ? scaleNutrition(entry.nutrition, 100 / entry.grams) : undefined);

  const amount = Number(grams.replace(",", "."));
  const byGrams = !entry.mealId && entry.grams != null && !dish;
  const total = meal ? mealNutrition(meal, recipe) : undefined;
  const share = meal ? Math.min(1, portions / meal.servings) : entry.share;
  const dishGramsNext = dish ? dishGrams(dish, dishPortions) : undefined;

  const next: Nutrition | undefined = dish
    ? dishNutrition(dish, dishPortions)
    : byGrams
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
      ...(dishGramsNext != null ? { grams: dishGramsNext } : {}),
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

  // Під назвою — що саме записано: прийом їжі й кількість.
  const amountNote = dish
    ? portionLabel(dishPortions)
    : byGrams
    ? amount > 0
      ? `${formatNumber(amount, 0)} г`
      : ""
    : meal
      ? `${portionLabel(portions)} з ${formatNumber(meal.servings, 2)}`
      : "";
  const subtitle = [SLOT_META[slot].label, amountNote].filter(Boolean).join(" · ");

  return (
    <Sheet
      open={!!entry}
      onClose={onClose}
      title={
        <SheetTitle
          emoji={entry.emoji}
          title={entry.title}
          sub={subtitle}
          aside={next && <KcalAside kcal={formatKcal(next.kcal)} />}
        />
      }
      footer={
        editable ? (
          <Button full disabled={!valid} onClick={save}>
            Зберегти{next ? ` · ${next.kcal} ккал` : ""}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 pb-3">
        {restaurant && (
          <p className="-mb-1 px-0.5 text-[12px] font-semibold text-faint">
            {restaurant.name}
            {dish?.amount ? ` · порція ${amountLabel(dish)}` : ""}
          </p>
        )}
        {next ? (
          // Заклад, що публікує лише калорії: нулі в Б/Ж/В виглядали б як справжні числа.
          restaurant?.kcalOnly ? (
            <Panel className="px-3.5 py-3 text-[12.5px] font-semibold text-muted">
              {formatNumber(next.kcal, 0)} ккал · Б/Ж/В заклад не публікує
            </Panel>
          ) : (
            <Panel>
              <MacroCells nutrition={next} />
            </Panel>
          )
        ) : (
          <Panel className="px-3.5 py-3 text-[12.5px] font-semibold text-muted">
            Калорії невідомі — у товару чи страви немає КБЖВ.
          </Panel>
        )}
        {dish?.note && (
          <Panel className="px-3.5 py-3 text-[12.5px] font-semibold leading-snug text-muted">{dish.note}</Panel>
        )}

        {!editable && (
          <Panel className="px-3.5 py-3 text-[12.5px] font-semibold leading-snug text-muted">
            Це чужий щоденник — правити його може лише власник.
          </Panel>
        )}

        {editable && dish && (
          <Panel>
            <div className="flex h-[54px] items-center gap-2 pl-3.5 pr-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-muted">Зʼїв</span>
                {dishGramsNext != null && (
                  <span className="block truncate text-[11.5px] font-semibold text-faint">
                    {amountLabel(dish, dishPortions)}
                  </span>
                )}
              </span>
              <StepButton
                label="Менше"
                disabled={dishPortions <= 0.5}
                onClick={() => setDishPortions((p) => Math.max(0.5, p - 0.5))}
              >
                <Minus size={16} strokeWidth={2.4} />
              </StepButton>
              <span className="w-[92px] text-center text-[14px] font-extrabold tabular-nums">
                {portionLabel(dishPortions)}
              </span>
              <StepButton
                label="Більше"
                disabled={dishPortions >= maxPortions(dish)}
                onClick={() => setDishPortions((p) => Math.min(maxPortions(dish), p + 0.5))}
              >
                <Plus size={16} strokeWidth={2.4} />
              </StepButton>
            </div>
          </Panel>
        )}

        {editable && (
          <Panel>
            {byGrams && (
              <label className="flex h-[50px] items-center gap-2 border-b border-line px-3.5">
                <span className="flex-1 text-[14px] font-semibold text-muted">Вага</span>
                <input
                  value={grams}
                  onChange={(e) => setGrams(e.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  aria-label="Скільки грамів"
                  className="h-8 w-[84px] rounded-[8px] bg-surface-2 px-2.5 text-right text-[14px] font-bold"
                />
                <span className="text-[14px] font-bold text-muted">г</span>
              </label>
            )}

            {meal && (
              <div className="flex h-[54px] items-center gap-2 border-b border-line pl-3.5 pr-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-muted">Зʼїв</span>
                  <span className="block truncate text-[11.5px] font-semibold text-faint">
                    із {portionLabel(meal.servings)}
                  </span>
                </span>
                <StepButton
                  label="Менше"
                  disabled={portions <= 0.25}
                  onClick={() => setPortions((p) => Math.max(0.25, p - 0.25))}
                >
                  <Minus size={16} strokeWidth={2.4} />
                </StepButton>
                <span className="w-[92px] text-center text-[14px] font-extrabold tabular-nums">
                  {portionLabel(portions)}
                </span>
                <StepButton
                  label="Більше"
                  disabled={portions >= meal.servings}
                  onClick={() => setPortions((p) => Math.min(meal.servings, p + 0.25))}
                >
                  <Plus size={16} strokeWidth={2.4} />
                </StepButton>
              </div>
            )}

            <SlotRow value={slot} onChange={setSlot} />

            <button
              onClick={remove}
              className="flex h-12 w-full items-center border-t border-line px-3.5 text-left text-[14px] font-semibold text-berry active:bg-surface-2"
            >
              Прибрати запис
            </button>
          </Panel>
        )}
      </div>
    </Sheet>
  );
}
