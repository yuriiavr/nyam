"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Chip, IconButton, Segmented, Sheet, useToast } from "@/components/ui";
import { SLOT_META, SLOT_ORDER, eatenAtFor, portionLabel } from "@/lib/diary";
import { amountLabel, dishEmoji, dishGrams, dishId, dishNutrition, maxPortions } from "@/lib/restaurants";
import { diaryUserId, useApp } from "@/lib/store";
import type { FoodEntry, MealSlot } from "@/lib/types";
import { formatNumber } from "@/lib/units";
import { dateKey, haptic, newId } from "@/lib/utils";
import { PeopleSwitch, usePeople } from "./people";
import { RestaurantLogo, type RestaurantPick } from "./RestaurantSheet";

const PRESETS: Array<{ value: number; label: string }> = [
  { value: 0.5, label: "½" },
  { value: 1, label: "1" },
  { value: 1.5, label: "1½" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
];
const STEP = 0.5;

/**
 * Страва із закладу: скільки порцій, на який прийом їжі й кому.
 *
 * Числа — на порцію з офіційного меню, множимо на кількість. Запис —
 * звичайний FoodEntry із назвою страви; заклад видно з `productId`
 * (див. src/lib/restaurants.ts), тож у щоденнику під назвою стоїть
 * «McDonald's · 2 порції».
 */
export function RestaurantDishSheet({
  open,
  onClose,
  pick,
  slot: initialSlot,
  day = dateKey(),
  forUser,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  pick: RestaurantPick | null;
  slot: MealSlot;
  day?: string;
  forUser?: string;
  onLogged?: (entry: FoodEntry) => void;
}) {
  const people = usePeople();
  const account = useApp((s) => s.account);
  const logFood = useApp((s) => s.logFood);
  const toast = useToast();

  const [portions, setPortions] = useState(1);
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [who, setWho] = useState("");

  useEffect(() => {
    if (!open || !pick) return;
    setPortions(1);
    setSlot(initialSlot);
    setWho(forUser ?? diaryUserId({ account }));
    // Лише на відкритті.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pick]);

  if (!pick) return null;
  const { restaurant, menu, dish } = pick;
  const hasMacros = dish.protein != null && dish.fat != null && dish.carbs != null;
  const eaten = dishNutrition(dish, portions);
  const portion = amountLabel(dish);
  const max = maxPortions(dish);

  const change = (delta: number) => {
    haptic(8);
    setPortions((p) => Math.min(max, Math.max(STEP, p + delta)));
  };

  const save = () => {
    const me = diaryUserId({ account });
    const grams = dishGrams(dish, portions);
    const entry: FoodEntry = {
      id: newId(),
      userId: who || me,
      loggedBy: me,
      eatenAt: eatenAtFor(day, slot),
      slot,
      title: dish.name,
      emoji: dishEmoji(menu, dish),
      productId: dishId(restaurant.id, dish.key),
      ...(grams != null ? { grams } : {}),
      nutrition: eaten,
      source: "search",
    };
    logFood([entry]);
    toast(`Записано: ${dish.name} · ${formatNumber(eaten.kcal, 0)} ккал`, entry.emoji);
    haptic(14);
    onLogged?.(entry);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      footer={
        <Button full size="lg" onClick={save}>
          Записати · {formatNumber(eaten.kcal, 0)} ккал
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex items-start gap-3">
          <RestaurantLogo restaurant={restaurant} className="h-14 w-14 shrink-0 rounded-[12px] p-1.5" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[17px] font-bold leading-tight">{dish.name}</h2>
            <p className="mt-0.5 truncate text-[12px] text-muted">
              {restaurant.name}
              {portion && ` · порція ${portion}`}
            </p>
            <p className="mt-1 text-[11.5px] text-muted">
              {formatNumber(dish.kcal, 0)} ккал
              {hasMacros &&
                ` · Б ${formatNumber(dish.protein ?? 0, 1)} · Ж ${formatNumber(dish.fat ?? 0, 1)} · В ${formatNumber(dish.carbs ?? 0, 1)}`}{" "}
              <span className="text-faint">/ порція</span>
            </p>
          </div>
        </div>

        {!hasMacros && (
          <p className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-[12.5px] leading-snug">
            {restaurant.name} публікує лише калорії. Білки, жири й вуглеводи запишуться нулями — у підсумку дня
            їх буде менше, ніж насправді.
          </p>
        )}
        {dish.note && (
          <p className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-[12.5px] leading-snug text-muted">{dish.note}</p>
        )}

        <div>
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">Скільки порцій</p>
          <div className="flex items-center gap-2">
            <IconButton label="Менше" onClick={() => change(-STEP)} disabled={portions <= STEP}>
              <Minus size={18} />
            </IconButton>
            <span className="min-w-[64px] text-center font-display text-[22px] font-extrabold">
              {formatNumber(portions, 1)}
            </span>
            <IconButton label="Більше" onClick={() => change(STEP)} disabled={portions >= max}>
              <Plus size={18} />
            </IconButton>
            <span className="ml-auto text-right text-[12px] leading-tight text-muted">
              <span className="font-display text-[18px] font-extrabold text-ink">{formatNumber(eaten.kcal, 0)}</span>{" "}
              ккал
              {hasMacros && (
                <>
                  <br />Б {formatNumber(eaten.protein, 1)} · Ж {formatNumber(eaten.fat, 1)} · В{" "}
                  {formatNumber(eaten.carbs, 1)}
                </>
              )}
            </span>
          </div>
          <div className="no-scrollbar -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
            {PRESETS.filter((p) => p.value <= max).map((p) => (
              <Chip key={p.value} active={portions === p.value} onClick={() => setPortions(p.value)}>
                {p.label}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-faint">
            {portionLabel(portions)}
            {dish.amount ? ` · ${amountLabel(dish, portions)}` : ""}
          </p>
        </div>

        <Segmented
          value={slot}
          onChange={setSlot}
          options={SLOT_ORDER.map((s) => ({ value: s, label: SLOT_META[s].label }))}
        />

        {people.length > 1 && (
          <div>
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">Хто зʼїв</p>
            <PeopleSwitch people={people} value={who} onChange={setWho} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
