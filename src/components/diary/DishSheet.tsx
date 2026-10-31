"use client";

import { Minus, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Panel, PanelHeader, Sheet } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { eatenAtFor, itemsNutrition, mealItem } from "@/lib/diary";
import type { DishParse } from "@/lib/food-ai";
import { FOOD_AI_MESSAGE, parseEatenDish } from "@/lib/food-client";
import { pantryDisplayName } from "@/lib/pantry";
import { shortProductName } from "@/lib/products";
import { diaryUserId, useApp } from "@/lib/store";
import type { MealItem, MealSlot, Nutrition, PantryItem } from "@/lib/types";
import { formatNumber, formatQuantity } from "@/lib/units";
import { cn, dateKey, haptic, newId } from "@/lib/utils";
import { CheckRow, SlotRow, StepButton } from "./SheetParts";
import type { SplitRequest } from "./SplitSheet";

interface Part {
  key: string;
  name: string;
  grams: string;
  per100: Nutrition;
  /** Рядки комори, які запропонував ШІ, — лише ті, що досі є. */
  options: string[];
  /** Обраний рядок. null — «не з комори»: рахуємо оцінкою ШІ. */
  chosen: string | null;
}

const FROM_LABEL: Record<MealItem["from"], string> = {
  label: "етикетка",
  catalog: "довідник",
  ai: "≈ ШІ",
};

/**
 * «Що зʼїв?» без рецепта: запечена картопля з сосисками, яку ніхто не стане
 * оформлювати рецептом.
 *
 * Людина пише словами, ШІ розкладає на продукти й грами і підбирає, що з
 * комори могло піти в страву. Людина лише тицяє, які саме сосиски — і далі
 * калорії рахуються з етикеток цих товарів, а не «сосиски взагалі». Чого
 * в коморі немає, рахується оцінкою ШІ, і це видно біля кожного рядка.
 */
export function DishSheet({
  open,
  onClose,
  slot: initialSlot,
  day = dateKey(),
  initialText = "",
  onNext,
}: {
  open: boolean;
  onClose: () => void;
  slot: MealSlot;
  day?: string;
  initialText?: string;
  /** Страва готова — далі ділимо її на тих, хто їв. */
  onNext: (request: SplitRequest) => void;
}) {
  const account = useApp((s) => s.account);
  const pantry = useApp((s) => s.pantry);
  const products = useApp((s) => s.products);

  const [text, setText] = useState("");
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dish, setDish] = useState<DishParse | null>(null);
  const [title, setTitle] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [servings, setServings] = useState(1);
  const [consume, setConsume] = useState(true);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      ctrl.current?.abort();
      return;
    }
    setText(initialText);
    setSlot(initialSlot);
    setBusy(false);
    setProblem(null);
    setDish(null);
    setParts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rows = useMemo(() => new Map(pantry.map((row) => [row.id, row])), [pantry]);
  const rowName = (row: PantryItem) => shortProductName(pantryDisplayName(row, products), row.key);

  const ask = async () => {
    const t = text.trim();
    if (t.length < 2) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setProblem(null);

    // Те, що лежить у коморі з кількістю, — першим: саме з нього й готують.
    const choices = [...pantry]
      .sort((a, b) => Number(b.amount != null) - Number(a.amount != null))
      .map((row) => {
        const product = row.productId ? products[row.productId] : undefined;
        const piece = product?.gramsPerPiece ?? ing(row.key).gramsPerPiece;
        return {
          id: row.id,
          name: pantryDisplayName(row, products),
          type: ing(row.key).label,
          ...(piece ? { gramsPerPiece: piece } : {}),
        };
      });

    const res = await parseEatenDish(t, choices, c.signal);
    if (c.signal.aborted) return;
    setBusy(false);
    if (!res.ok) {
      setProblem(FOOD_AI_MESSAGE[res.reason]);
      return;
    }
    haptic(12);
    const d = res.dish;
    setDish(d);
    setTitle(d.title);
    setServings(d.servings);
    setParts(
      d.parts.map((p, i) => {
        const options = p.pantryIds.filter((id) => rows.has(id));
        return {
          key: `${i}-${p.name}`,
          name: p.name,
          grams: formatNumber(p.grams, 0),
          per100: p.per100,
          options,
          chosen: options[0] ?? null,
        };
      }),
    );
    setConsume(true);
  };

  /** Рядок складу для кожної частини — у тому ж порядку; null — грамів не вказано. */
  const partItems = useMemo(
    () =>
      parts.map((p) => {
        const grams = Number(p.grams.replace(",", "."));
        if (!(grams > 0)) return null;
        const row = p.chosen ? rows.get(p.chosen) : undefined;
        return mealItem({
          name: row ? rowName(row) : p.name,
          grams,
          product: row?.productId ? products[row.productId] : null,
          typeKey: row?.key,
          pantryId: row?.id,
          ai: p.per100,
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parts, rows, products],
  );
  const items = partItems.filter((i): i is MealItem => i != null);
  const total = itemsNutrition(items);
  const chosenRows = parts.filter((p) => p.chosen).length;

  const patch = (key: string, change: Partial<Part>) =>
    setParts((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));

  const next = () => {
    if (!dish || items.length === 0) return;
    const me = diaryUserId({ account });
    onNext({
      meal: {
        id: newId(),
        ownerId: me,
        title: title.trim() || dish.title,
        emoji: dish.emoji,
        servings,
        nutrition: total,
        items,
        ...(dish.note ? { note: dish.note } : {}),
        cookedAt: eatenAtFor(day, slot),
        eaten: 0,
        finished: false,
      },
      isNew: true,
      source: "dish",
      slot,
      day,
      consume: consume
        ? items.filter((i) => i.pantryId).map((i) => ({ id: i.pantryId as string, grams: i.grams }))
        : undefined,
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={dish ? "Що було в страві" : "Що зʼїв?"}
      footer={
        dish ? (
          <Button full disabled={items.length === 0} onClick={next}>
            Далі — хто їв · {total.kcal} ккал
          </Button>
        ) : (
          <Button full loading={busy} disabled={text.trim().length < 2} onClick={() => void ask()}>
            <Sparkles size={17} />
            Порахувати
          </Button>
        )
      }
    >
      {!dish ? (
        <div className="flex flex-col gap-3 pb-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 600))}
            rows={3}
            placeholder="Запечена картопля з двома сосисками й салатом із помідорів"
            className="w-full resize-none rounded-[10px] border border-line bg-surface px-3.5 py-3 text-[15px] font-semibold leading-snug placeholder:text-faint"
          />
          <p className="-mt-0.5 px-1 text-[12px] font-semibold leading-snug text-faint">
            Пиши як другу: що і скільки, можна «на двох». ШІ розкладе на продукти й запропонує, що з комори пішло в
            страву — калорії рахуватимуться з етикеток саме твоїх товарів.
          </p>
          <Panel>
            <SlotRow value={slot} onChange={setSlot} />
          </Panel>
          {problem && <p className="px-1 text-[13px] font-semibold text-berry">{problem}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-3">
          <div className="flex h-[50px] items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5">
            <span className="text-[24px] leading-none">{dish.emoji}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 120))}
              aria-label="Назва страви"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-bold"
            />
          </div>

          {parts.length > 0 && (
            <Panel>
              <PanelHeader label="Склад" aside={`${total.kcal} ккал`} />
              {parts.map((part, index) => {
                const item = partItems[index];
                return (
                  <div key={part.key} className="flex flex-col gap-2 border-t border-line py-2.5 pl-3.5 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{part.name}</span>
                      <input
                        value={part.grams}
                        onChange={(e) => patch(part.key, { grams: e.target.value.replace(/[^\d.,]/g, "") })}
                        inputMode="decimal"
                        aria-label={`${part.name}, грамів`}
                        className="h-8 w-[64px] rounded-[8px] bg-surface-2 px-2.5 text-right text-[14px] font-bold"
                      />
                      <span className="text-[14px] font-bold text-muted">г</span>
                      <button
                        aria-label={`Прибрати ${part.name}`}
                        onClick={() => setParts((list) => list.filter((p) => p.key !== part.key))}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-faint active:bg-surface-2"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    {part.options.length > 0 && (
                      <div className="no-scrollbar -mr-2 flex gap-1.5 overflow-x-auto pr-2">
                        {part.options.map((id) => {
                          const row = rows.get(id) as PantryItem;
                          const active = part.chosen === id;
                          return (
                            <button
                              key={id}
                              onClick={() => patch(part.key, { chosen: active ? null : id })}
                              aria-pressed={active}
                              className={cn(
                                "flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px] font-bold",
                                active ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface-2 text-muted",
                              )}
                            >
                              <span>{ing(row.key).emoji}</span>
                              <span className="max-w-[160px] truncate">{rowName(row)}</span>
                              {row.amount != null && row.unit && (
                                <span className="font-semibold text-faint">· {formatQuantity(row.amount, row.unit)}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {item && (
                      <p className="text-[11.5px] font-semibold text-faint">
                        {item.kcal} ккал · <span className={item.from === "ai" ? "text-brand" : ""}>{FROM_LABEL[item.from]}</span>
                        {part.options.length > 0 && !part.chosen && " · не з комори"}
                      </p>
                    )}
                  </div>
                );
              })}
            </Panel>
          )}

          <Panel>
            <div className="flex h-[50px] items-center gap-2 pl-3.5 pr-2">
              <span className="flex-1 text-[14px] font-semibold text-muted">Порцій у страві</span>
              <StepButton label="Менше порцій" onClick={() => setServings((s) => Math.max(1, s - 1))}>
                <Minus size={16} strokeWidth={2.4} />
              </StepButton>
              <span className="w-12 text-center text-[15px] font-extrabold tabular-nums">{servings}</span>
              <StepButton label="Більше порцій" onClick={() => setServings((s) => Math.min(20, s + 1))}>
                <Plus size={16} strokeWidth={2.4} />
              </StepButton>
            </div>
            {chosenRows > 0 && (
              <CheckRow checked={consume} onChange={setConsume} divided>
                Списати обране з комори
              </CheckRow>
            )}
          </Panel>

          {dish.note && <p className="px-1 text-[11.5px] font-semibold leading-snug text-faint">≈ {dish.note}</p>}
          <button onClick={() => setDish(null)} className="self-start px-1 text-[13px] font-bold text-brand">
            Переписати опис
          </button>
        </div>
      )}
    </Sheet>
  );
}
