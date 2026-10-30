"use client";

import { Minus, Plus, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Segmented, Sheet, useToast } from "@/components/ui";
import {
  SLOT_META,
  SLOT_ORDER,
  eatenAtFor,
  hasOwnComposition,
  leftoverServings,
  mealNutrition,
  portionLabel,
  portionsFromGrams,
  recipeMealNutrition,
  roundNutrition,
  scaleNutrition,
  sharesFromPortions,
  splitDefaults,
} from "@/lib/diary";
import { diaryUserId, recipeById, useApp } from "@/lib/store";
import type { FoodEntry, Meal, MealSlot } from "@/lib/types";
import { formatNumber } from "@/lib/units";
import { cn, dateKey, haptic, newId } from "@/lib/utils";
import { PersonAvatar, personName, usePeople } from "./people";

/** Що ділимо: щойно приготовану страву чи залишок учорашньої. */
export interface SplitRequest {
  meal: Meal;
  /** Нова страва — запишеться разом із частками. */
  isNew: boolean;
  source: "cook" | "dish" | "leftover";
  slot: MealSlot;
  day?: string;
  /** Рядки комори, які списати після запису («сосиски були ось ці»). */
  consume?: Array<{ id: string; grams: number }>;
}

const STEP = 0.5;
const snap = (x: number) => Math.max(0, Math.round(x * 4) / 4);

/**
 * «Хто скільки зʼїв» — одна страва на кількох.
 *
 * Кожному пропонуємо порцію за його апетитом (1,5 — півтори порції), далі
 * плюс-мінус. Що лишилось у каструлі, стає залишком, який доїдають пізніше
 * одним дотиком. Хто хоче точніше — зважує: уся страва і своя тарілка.
 */
export function SplitSheet({
  request,
  onClose,
  onDone,
}: {
  request: SplitRequest | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const toast = useToast();
  const people = usePeople();
  const account = useApp((s) => s.account);
  const foodLog = useApp((s) => s.foodLog);
  const logFood = useApp((s) => s.logFood);
  const saveMeal = useApp((s) => s.saveMeal);
  const consumePantryRows = useApp((s) => s.consumePantryRows);
  const recipe = useApp((s) => (request?.meal.recipeId ? recipeById(s, request.meal.recipeId) : undefined));

  const [servings, setServings] = useState(1);
  const [portions, setPortions] = useState<Record<string, number>>({});
  const [slot, setSlot] = useState<MealSlot>("lunch");
  const [weigh, setWeigh] = useState(false);
  const [dishGrams, setDishGrams] = useState("");
  const [plates, setPlates] = useState<Record<string, string>>({});

  const meal = request?.meal;
  const isNew = !!request?.isNew;
  const me = diaryUserId({ account });

  /** Скільки можна розділити: нова страва — уся; залишок — що лишилось. */
  const available = useMemo(() => {
    if (!meal) return 0;
    return isNew ? servings : leftoverServings(meal, foodLog);
  }, [meal, isNew, servings, foodLog]);

  useEffect(() => {
    if (!request) return;
    const m = request.meal;
    setServings(m.servings);
    setSlot(request.slot);
    setWeigh(false);
    setDishGrams("");
    setPlates({});
    if (request.isNew) {
      setPortions(splitDefaults(people, m.servings));
    } else {
      // Залишок зазвичай доїдає хтось один — я; решті нуль, додати можна.
      const left = leftoverServings(m, useApp.getState().foodLog);
      const mine = people.find((p) => p.me)?.appetite ?? 1;
      setPortions({ [me]: snap(Math.min(mine, left)) });
    }
    // Лише на відкритті: склад сімʼї посеред поділу не міняється.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  /*
   * КБЖВ усієї страви: рецепт перераховуємо на зварені порції. Склад,
   * розписаний після готування, — уже вся каструля: порції її лише ділять.
   */
  const total = useMemo(() => {
    if (!meal) return undefined;
    if (isNew && recipe && !hasOwnComposition(meal)) return recipeMealNutrition(recipe, servings) ?? meal.nutrition;
    return mealNutrition(meal, recipe);
  }, [meal, isNew, recipe, servings]);

  if (!request || !meal) return null;

  const base = isNew ? servings : meal.servings;
  const perPortion = total ? scaleNutrition(total, 1 / Math.max(0.25, base)) : undefined;

  /* Зважування: порції з грамів тарілки — поверх кнопок. */
  const dish = Number(dishGrams.replace(",", "."));
  const effective: Record<string, number> = weigh
    ? Object.fromEntries(
        people.map((p) => [p.userId, portionsFromGrams(Number((plates[p.userId] ?? "").replace(",", ".")), dish, base)]),
      )
    : portions;
  const sum = Object.values(effective).reduce((a, b) => a + (b || 0), 0);
  const over = sum > available + 1e-6;
  const left = Math.max(0, available - sum);

  const bump = (userId: string, delta: number) => {
    haptic(8);
    setPortions((p) => {
      const now = p[userId] ?? 0;
      const others = sum - now;
      const next = snap(Math.min(available - others, now + delta));
      return { ...p, [userId]: Math.max(0, next) };
    });
  };

  const save = () => {
    if (over) return;
    // Спершу комора: страва памʼятає, що взяла, — прибрали запис, і це повернеться.
    const used = request.consume?.length ? consumePantryRows(request.consume) : null;
    const taken = used?.taken.length ? { pantryTaken: [...(meal.pantryTaken ?? []), ...used.taken] } : {};
    const finalMeal: Meal = { ...(isNew ? { ...meal, servings, nutrition: total } : meal), ...taken };
    const shares = sharesFromPortions(effective, finalMeal.servings);
    const eatenAt = eatenAtFor(request.day ?? dateKey(), slot);
    const entries: FoodEntry[] = Object.entries(shares).map(([userId, share]) => ({
      id: newId(),
      userId,
      loggedBy: me,
      eatenAt,
      slot,
      title: finalMeal.title,
      emoji: finalMeal.emoji,
      mealId: finalMeal.id,
      share,
      nutrition: total ? roundNutrition(scaleNutrition(total, share)) : undefined,
      source: request.source,
    }));
    logFood(entries, isNew || used?.taken.length ? finalMeal : undefined);

    if (used?.consumed.length) toast(`Списано з комори: ${used.consumed.map((u) => u.label).join(", ")}`, "🧺");
    haptic(16);
    const mine = shares[me];
    toast(
      mine && total
        ? `Записано: ${Math.round(total.kcal * mine)} ккал`
        : entries.length
          ? "Записано"
          : "Страву збережено — залишок чекає",
      "✅",
    );
    onDone?.();
    onClose();
  };

  const finish = () => {
    saveMeal({ ...meal, finished: true });
    haptic(10);
    toast("Залишок прибрано", "🧽");
    onClose();
  };

  return (
    <Sheet
      open={!!request}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="text-xl">{meal.emoji}</span>
          <span className="min-w-0 truncate">{meal.title}</span>
        </span>
      }
      footer={
        <div className="flex flex-col gap-2">
          <Button full size="lg" disabled={over} onClick={save}>
            {sum > 0 ? "Записати" : isNew ? "Зберегти без записів" : "Записати"}
          </Button>
          {!isNew && (
            <button onClick={finish} className="py-1 text-[13px] font-semibold text-muted">
              Доїли або викинули — прибрати залишок
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-[12px] text-muted">{isNew ? "Вийшло порцій" : "Лишилось"}</p>
            <p className="font-display text-[20px] font-extrabold leading-tight">
              {isNew ? formatNumber(servings, 2) : portionLabel(available)}
            </p>
            <p className="text-[11.5px] text-muted">
              {perPortion ? `${Math.round(perPortion.kcal)} ккал у порції` : "Калорії ще не пораховані"}
            </p>
          </div>
          {isNew && (
            <div className="flex items-center gap-1.5">
              <StepButton label="Менше порцій" onClick={() => setServings((s) => Math.max(1, s - 1))}>
                <Minus size={16} />
              </StepButton>
              <StepButton label="Більше порцій" onClick={() => setServings((s) => Math.min(50, s + 1))}>
                <Plus size={16} />
              </StepButton>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[12px] font-bold uppercase tracking-wide text-muted">Хто скільки зʼїв</p>
          <button
            onClick={() => setWeigh((w) => !w)}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold",
              weigh ? "bg-brand/10 text-brand" : "text-muted",
            )}
          >
            <Scale size={14} />
            {weigh ? "Порціями" : "Зважити"}
          </button>
        </div>

        {weigh && (
          <label className="-mt-2 flex items-center gap-2 text-[13px]">
            <span className="flex-1 text-muted">Уся страва, готова</span>
            <input
              value={dishGrams}
              onChange={(e) => setDishGrams(e.target.value.replace(/[^\d.,]/g, ""))}
              inputMode="decimal"
              placeholder="1200"
              className="h-10 w-24 rounded-xl border border-line bg-surface px-2 text-center text-[15px]"
            />
            <span className="w-4 text-muted">г</span>
          </label>
        )}

        <div className="flex flex-col gap-2">
          {people.map((p) => {
            const n = effective[p.userId] ?? 0;
            const kcal = perPortion ? Math.round(perPortion.kcal * n) : null;
            return (
              <div key={p.userId} className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5">
                <PersonAvatar person={p} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">{personName(p)}</p>
                  <p className="text-[12px] text-muted">
                    {n > 0 ? portionLabel(n) : "не їв"}
                    {kcal != null && n > 0 && ` · ${kcal} ккал`}
                  </p>
                </div>
                {weigh ? (
                  <label className="flex items-center gap-1.5">
                    <input
                      value={plates[p.userId] ?? ""}
                      onChange={(e) => setPlates((x) => ({ ...x, [p.userId]: e.target.value.replace(/[^\d.,]/g, "") }))}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`Тарілка: ${personName(p)}, грамів`}
                      className="h-10 w-20 rounded-xl border border-line bg-surface px-2 text-center text-[15px]"
                    />
                    <span className="text-[13px] text-muted">г</span>
                  </label>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <StepButton label={`Менше: ${personName(p)}`} onClick={() => bump(p.userId, -STEP)} disabled={n <= 0}>
                      <Minus size={16} />
                    </StepButton>
                    <span className="w-9 text-center font-display text-[16px] font-bold">{formatNumber(n, 2)}</span>
                    <StepButton label={`Більше: ${personName(p)}`} onClick={() => bump(p.userId, STEP)} disabled={left <= 0}>
                      <Plus size={16} />
                    </StepButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className={cn("-mt-1 text-[12px] leading-snug", over ? "text-berry" : "text-muted")}>
          {over
            ? `Це більше, ніж є: ${portionLabel(available)}. ${isNew ? "Додай порцій угорі" : "Перевір цифри"}.`
            : left >= 0.1
              ? `Лишиться ${portionLabel(snap(left))} — доїсте потім одним дотиком.`
              : "Усе зʼїли — залишку не буде."}
        </p>

        <Segmented
          value={slot}
          onChange={setSlot}
          options={SLOT_ORDER.map((s) => ({ value: s, label: SLOT_META[s].label }))}
        />

        {meal.note && <p className="text-[11.5px] leading-snug text-faint">≈ {meal.note}</p>}
      </div>
    </Sheet>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 text-ink active:bg-line disabled:opacity-35"
    >
      {children}
    </button>
  );
}
