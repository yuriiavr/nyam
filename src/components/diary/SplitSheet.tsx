"use client";

import { ChevronRight, ListChecks, Minus, Plus, Scale } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Panel, PanelHeader, Sheet, useToast } from "@/components/ui";
import {
  eatenAtFor,
  hasOwnComposition,
  leftoverServings,
  mealNutrition,
  portionLabel,
  portionsFromGrams,
  portionsOf,
  recipeMealNutrition,
  roundNutrition,
  scaleNutrition,
  sharesFromPortions,
  splitDefaults,
} from "@/lib/diary";
import { planTakes } from "@/lib/pantry";
import { diaryUserId, recipeById, useApp } from "@/lib/store";
import type { FoodEntry, Meal, MealSlot, PantryItem } from "@/lib/types";
import { formatNumber } from "@/lib/units";
import { cn, dateKey, haptic, newId } from "@/lib/utils";
import { CookedSheet, countComposition, lineMissing, type CookedDraftLine, type CookedSave } from "./CookedSheet";
import { PersonAvatar, personName, usePeople } from "./people";
import { CheckRow, SheetTitle, SlotRow, StepButton } from "./SheetParts";

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
  /** Можна розписати, що було в порції, — «Зʼїв» зі сторінки рецепта. */
  portionEdit?: boolean;
}

const NO_ROWS: readonly PantryItem[] = [];

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
  /* Що було в порції, коли не як у рецепті: склад однієї тарілки, решта — її кратні. */
  const [portion, setPortion] = useState<CookedSave | null>(null);
  const [portionOpen, setPortionOpen] = useState(false);
  const [deduct, setDeduct] = useState(true);
  /* Склад змінили й закрили, не порахувавши: ШІ порахує його перед записом. */
  const [draft, setDraft] = useState<CookedDraftLine[] | null>(null);
  const [counting, setCounting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const countCtrl = useRef<AbortController | null>(null);

  const meal = request?.meal;
  const isNew = !!request?.isNew;
  const me = diaryUserId({ account });

  /** Скільки можна розділити: нова страва — уся; залишок — що лишилось. */
  const available = useMemo(() => {
    if (!meal) return 0;
    return isNew ? servings : leftoverServings(meal, foodLog);
  }, [meal, isNew, servings, foodLog]);

  useEffect(() => {
    countCtrl.current?.abort();
    if (!request) return;
    const m = request.meal;
    setServings(m.servings);
    setSlot(request.slot);
    setWeigh(false);
    setDishGrams("");
    setPlates({});
    setPortion(null);
    setPortionOpen(false);
    setDeduct(true);
    setDraft(null);
    setCounting(false);
    setProblem(null);
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
  const recipeTotal = useMemo(() => {
    if (!meal) return undefined;
    if (isNew && recipe && !hasOwnComposition(meal)) return recipeMealNutrition(recipe, servings) ?? meal.nutrition;
    return mealNutrition(meal, recipe);
  }, [meal, isNew, recipe, servings]);

  if (!request || !meal) return null;

  /** Склад порції, якщо його розписали, — на всі зварені порції; інакше рецепт. */
  const totalOf = (p: CookedSave | null) =>
    isNew && p ? roundNutrition(scaleNutrition(p.nutrition, servings)) : recipeTotal;
  /* Склад порції — на всі зварені порції: і страва, і що пішло з комори. */
  const wholeOf = (p: CookedSave | null) =>
    isNew && p ? portionsOf({ items: p.items, takes: p.wants }, servings) : null;

  const total = totalOf(portion);
  const whole = wholeOf(portion);
  const base = isNew ? servings : meal.servings;
  // Змінений, ще не порахований склад — старих калорій не показуємо: вони вже не про цю тарілку.
  const perPortion = total && !draft ? scaleNutrition(total, 1 / Math.max(0.25, base)) : undefined;

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

  const save = (p: CookedSave | null) => {
    if (over) return;
    const total = totalOf(p);
    const whole = wholeOf(p);
    // Спершу комора: страва памʼятає, що взяла, — прибрали запис, і це повернеться.
    // Порції не вистачило однієї пачки — решту з такої самої.
    const state = useApp.getState();
    const fromPortion = whole && deduct ? planTakes(state.pantry, whole.takes, state.products) : [];
    const consume = [...(request.consume ?? []), ...fromPortion];
    const used = consume.length ? consumePantryRows(consume) : null;
    const taken = used?.taken.length ? { pantryTaken: [...(meal.pantryTaken ?? []), ...used.taken] } : {};
    const composed: Partial<Meal> =
      whole && p ? { items: whole.items, ...(p.note ? { note: p.note } : {}) } : {};
    const finalMeal: Meal = { ...(isNew ? { ...meal, servings, nutrition: total, ...composed } : meal), ...taken };
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

  /**
   * «Записати». Склад змінили, але не порахували — спершу ШІ: у щоденник
   * іде калорійність того, що справді було в тарілці, а не рецепта.
   */
  const submit = async () => {
    if (over || counting) return;
    if (!draft || !recipe) {
      save(portion);
      return;
    }
    if (draft.length === 0 || draft.some(lineMissing)) {
      setPortionOpen(true);
      return;
    }
    countCtrl.current?.abort();
    const c = new AbortController();
    countCtrl.current = c;
    setCounting(true);
    setProblem(null);
    const state = useApp.getState();
    const res = await countComposition({
      lines: draft,
      recipe,
      rows: new Map(state.pantry.map((row) => [row.id, row])),
      products: state.products,
      portion: true,
      signal: c.signal,
    });
    if (!res) return;
    setCounting(false);
    if (!res.ok) {
      setProblem(res.problem);
      return;
    }
    setPortion(res.result);
    setDraft(null);
    save(res.result);
  };

  const finish = () => {
    saveMeal({ ...meal, finished: true });
    haptic(10);
    toast("Залишок прибрано", "🧽");
    onClose();
  };

  return (
    <>
      <Sheet
        open={!!request}
        onClose={onClose}
        title={
          <SheetTitle
            emoji={meal.emoji}
            title={meal.title}
            sub={
              perPortion
                ? `${Math.round(perPortion.kcal)} ккал у порції`
                : draft
                  ? "Калорії порахує ШІ"
                  : "Калорії ще не пораховані"
            }
          />
        }
        footer={
          <div className="flex flex-col gap-2">
            {problem && <p className="text-center text-[13px] font-semibold text-berry">{problem}</p>}
            <Button full disabled={over} loading={counting} onClick={() => void submit()}>
              {draft
                ? "Порахувати й записати"
                : sum > 0
                  ? "Записати"
                  : isNew
                    ? "Зберегти без записів"
                    : "Записати"}
            </Button>
            {!isNew && (
              <button onClick={finish} className="py-1 text-[13px] font-semibold text-muted">
                Доїли або викинули — прибрати залишок
              </button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-3 pb-3">
          <Panel>
            <div className="flex h-[50px] items-center gap-2 pl-3.5 pr-2">
              <span className="flex-1 text-[14px] font-semibold text-muted">{isNew ? "Вийшло порцій" : "Лишилось"}</span>
              {isNew ? (
                <>
                  <StepButton label="Менше порцій" onClick={() => setServings((s) => Math.max(1, s - 1))}>
                    <Minus size={16} strokeWidth={2.4} />
                  </StepButton>
                  <span className="w-12 text-center text-[15px] font-extrabold tabular-nums">
                    {formatNumber(servings, 2)}
                  </span>
                  <StepButton label="Більше порцій" onClick={() => setServings((s) => Math.min(50, s + 1))}>
                    <Plus size={16} strokeWidth={2.4} />
                  </StepButton>
                </>
              ) : (
                <span className="pr-1.5 text-[14px] font-extrabold">{portionLabel(available)}</span>
              )}
            </div>

            {request.portionEdit && isNew && recipe && (
              <>
                <button
                  onClick={() => {
                    haptic(8);
                    setPortionOpen(true);
                  }}
                  className="flex min-h-[54px] w-full items-center gap-3 border-t border-line px-3.5 py-2 text-left active:bg-surface-2"
                >
                  <ListChecks size={17} strokeWidth={2.2} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold">
                      {draft ? "Склад порції — змінено" : portion ? "Склад порції — як було" : "Склад порції — як у рецепті"}
                    </span>
                    <span className="block text-[11.5px] font-semibold leading-snug text-faint">
                      {draft
                        ? "Ще не пораховано — ШІ порахує перед записом"
                        : portion
                          ? `${Math.round(portion.nutrition.kcal)} ккал у порції · змінити`
                          : "Клали інакше? Впиши, скільки чого було в тарілці"}
                    </span>
                  </span>
                  <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-faint" />
                </button>
                {(draft ? draft.some((line) => line.rowId) : !!whole && whole.takes.length > 0) && (
                  <CheckRow checked={deduct} onChange={setDeduct} divided>
                    Списати з комори — на {portionLabel(servings)}
                  </CheckRow>
                )}
              </>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              label="Хто скільки зʼїв"
              className="pr-2"
              aside={
                <button
                  onClick={() => setWeigh((w) => !w)}
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-bold",
                    weigh ? "bg-brand/10 text-brand" : "text-muted",
                  )}
                >
                  <Scale size={14} strokeWidth={2.2} />
                  {weigh ? "Порціями" : "Зважити"}
                </button>
              }
            />

            {weigh && (
              <label className="flex h-[50px] items-center gap-2 border-t border-line px-3.5">
                <span className="flex-1 text-[14px] font-semibold text-muted">Уся страва, готова</span>
                <input
                  value={dishGrams}
                  onChange={(e) => setDishGrams(e.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  placeholder="1200"
                  className="h-8 w-[84px] rounded-[8px] bg-surface-2 px-2.5 text-right text-[14px] font-bold"
                />
                <span className="w-3 text-[14px] font-bold text-muted">г</span>
              </label>
            )}

            {people.map((p) => {
              const n = effective[p.userId] ?? 0;
              const kcal = perPortion ? Math.round(perPortion.kcal * n) : null;
              return (
                <div key={p.userId} className="flex h-[54px] items-center gap-2.5 border-t border-line pl-3.5 pr-2">
                  <PersonAvatar person={p} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold">{personName(p)}</p>
                    <p className="truncate text-[11.5px] font-semibold text-faint">
                      {n > 0 ? portionLabel(n) : "не їв"}
                      {kcal != null && n > 0 && ` · ${kcal} ккал`}
                    </p>
                  </div>
                  {weigh ? (
                    <label className="flex items-center gap-2 pr-1.5">
                      <input
                        value={plates[p.userId] ?? ""}
                        onChange={(e) => setPlates((x) => ({ ...x, [p.userId]: e.target.value.replace(/[^\d.,]/g, "") }))}
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`Тарілка: ${personName(p)}, грамів`}
                        className="h-8 w-[76px] rounded-[8px] bg-surface-2 px-2.5 text-right text-[14px] font-bold"
                      />
                      <span className="w-3 text-[14px] font-bold text-muted">г</span>
                    </label>
                  ) : (
                    <>
                      <StepButton label={`Менше: ${personName(p)}`} onClick={() => bump(p.userId, -STEP)} disabled={n <= 0}>
                        <Minus size={16} strokeWidth={2.4} />
                      </StepButton>
                      <span className="w-10 text-center text-[14px] font-extrabold tabular-nums">{formatNumber(n, 2)}</span>
                      <StepButton label={`Більше: ${personName(p)}`} onClick={() => bump(p.userId, STEP)} disabled={left <= 0}>
                        <Plus size={16} strokeWidth={2.4} />
                      </StepButton>
                    </>
                  )}
                </div>
              );
            })}
          </Panel>

          <p className={cn("-mt-0.5 px-1 text-[12px] font-semibold leading-snug", over ? "text-berry" : "text-faint")}>
            {over
              ? `Це більше, ніж є: ${portionLabel(available)}. ${isNew ? "Додай порцій угорі" : "Перевір цифри"}.`
              : left >= 0.1
                ? `Лишиться ${portionLabel(snap(left))} — доїсте потім одним дотиком.`
                : "Усе зʼїли — залишку не буде."}
          </p>

          <Panel>
            <SlotRow value={slot} onChange={setSlot} />
          </Panel>

          {(portion?.note ?? meal.note) && (
            <p className="px-1 text-[11.5px] font-semibold leading-snug text-faint">≈ {portion?.note ?? meal.note}</p>
          )}
        </div>
      </Sheet>

      {/* Поруч, а не всередині: аркуш зсунутий transform-ом, і вкладений fixed жив би в його межах. */}
      {request.portionEdit && isNew && recipe && (
        <CookedSheet
          open={portionOpen}
          recipe={recipe}
          portion
          pantryBefore={NO_ROWS}
          draft={draft ?? portion?.lines}
          onClose={() => setPortionOpen(false)}
          onDraft={setDraft}
          onSave={(result) => {
            setPortion(result);
            setDraft(null);
            setProblem(null);
            setPortionOpen(false);
            toast(`Порція: ${Math.round(result.nutrition.kcal)} ккал`, "✅");
          }}
        />
      )}
    </>
  );
}
