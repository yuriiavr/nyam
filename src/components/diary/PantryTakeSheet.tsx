"use client";

import { Check, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Panel, PanelHeader, Sheet, useToast } from "@/components/ui";
import { satisfies } from "@/data/ingredients";
import { pantryDisplayName, rowGrams } from "@/lib/pantry";
import { shortProductName } from "@/lib/products";
import { useApp } from "@/lib/store";
import type { MealItem, PantryItem } from "@/lib/types";
import { formatNumber, formatQuantity } from "@/lib/units";
import { cn, haptic } from "@/lib/utils";
import { SheetTitle } from "./SheetParts";

interface Line {
  item: MealItem;
  /** Рядки комори, з яких цей продукт міг піти. */
  rows: PantryItem[];
  /** Обраний рядок; null — цього в коморі не брали. */
  rowId: string | null;
  grams: string;
}

/**
 * «Що взяли з комори?» для страви, записаної голосом.
 *
 * Помічник записує калорії одразу, а комору не чіпає: який саме рядок і
 * скільки грамів — лише здогад ШІ. Тут людина бачить здогад і виправляє:
 * інша пачка, інші грами чи «нічого не брали». Цей аркуш помічник може
 * відкрити сам — /diary?take=<id страви>.
 */
export function PantryTakeSheet({ mealId, onClose }: { mealId: string | null; onClose: () => void }) {
  const meal = useApp((s) => (mealId ? s.meals.find((m) => m.id === mealId) : undefined));
  const pantry = useApp((s) => s.pantry);
  const products = useApp((s) => s.products);
  const saveMeal = useApp((s) => s.saveMeal);
  const consumePantryRows = useApp((s) => s.consumePantryRows);
  const returnToPantry = useApp((s) => s.returnToPantry);
  const toast = useToast();
  const [lines, setLines] = useState<Line[]>([]);

  const taken = meal?.pantryTaken ?? [];

  // Здогад ШІ — один раз, коли страва відкрилась чи повернулась у комору.
  const seed = `${meal?.id ?? ""}:${taken.length}`;
  useEffect(() => {
    if (!meal) return;
    setLines(
      meal.items.flatMap((item) => {
        const rows = pantry.filter(
          (row) =>
            (row.id === item.pantryId || (!!item.typeKey && satisfies(row.key, item.typeKey))) &&
            !!row.amount &&
            (rowGrams(row, products) ?? 0) > 0,
        );
        if (!rows.length) return [];
        const guess = rows.some((r) => r.id === item.pantryId) ? (item.pantryId as string) : null;
        return [{ item, rows, rowId: guess, grams: formatNumber(item.grams, 0) }];
      }),
    );
    // Комора міняється з кожним знімком — не перезаписуємо вибір людини.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const takes = useMemo(
    () =>
      lines.flatMap((line) => {
        const grams = Number(line.grams.replace(",", "."));
        return line.rowId && grams > 0 && grams <= 5000 ? [{ id: line.rowId, grams }] : [];
      }),
    [lines],
  );

  const name = (row: PantryItem) => shortProductName(pantryDisplayName(row, products), row.key);
  const set = (index: number, patch: Partial<Line>) =>
    setLines((all) => all.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const confirm = () => {
    if (!meal || !takes.length) return;
    const used = consumePantryRows(takes);
    saveMeal({ ...meal, pantryTaken: used.taken });
    haptic(16);
    toast(
      used.consumed.length ? `Списано з комори: ${used.consumed.map((c) => c.label).join(", ")}` : "Нічого не списано",
      "🧺",
    );
    onClose();
  };

  const nothing = () => {
    if (meal) saveMeal({ ...meal, pantryTaken: [] });
    haptic(10);
    onClose();
  };

  const giveBack = () => {
    if (!meal) return;
    const back = returnToPantry(taken);
    saveMeal({ ...meal, pantryTaken: [] });
    haptic(12);
    toast(back.length ? `Повернуто в комору: ${back.map(name).join(", ")}` : "Повертати нічого", "↩️");
  };

  return (
    <Sheet
      open={!!mealId}
      onClose={onClose}
      title={
        meal ? <SheetTitle emoji={meal.emoji} title="Що взяли з комори?" sub={meal.title} /> : "Що взяли з комори?"
      }
      footer={
        !meal ? undefined : taken.length ? (
          <Button full onClick={onClose}>
            Готово
          </Button>
        ) : lines.length ? (
          <div className="flex flex-col gap-2">
            <Button full disabled={!takes.length} onClick={confirm}>
              {takes.length ? `Списати ${takes.length}` : "Обери, що брали"}
            </Button>
            <Button full variant="ghost" onClick={nothing}>
              Нічого з комори не брали
            </Button>
          </div>
        ) : (
          <Button full onClick={nothing}>
            Зрозуміло
          </Button>
        )
      }
    >
      {!meal ? (
        <Panel className="mb-3 px-3.5 py-3 text-[13px] font-semibold leading-relaxed text-muted">
          Цієї страви тут ще немає — щоденник оновлюється. Якщо вона так і не зʼявиться, запис могли прибрати.
        </Panel>
      ) : (
        <div className="flex flex-col gap-3 pb-3">
          {taken.length > 0 ? (
            <Panel>
              <PanelHeader label="Уже списано" aside={taken.length} />
              {taken.map((t) => (
                <div key={t.row.id} className="flex h-12 items-center gap-3 border-t border-line px-3.5">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{name(t.row)}</span>
                  <span className="shrink-0 text-[12.5px] font-bold text-muted">
                    {t.row.unit ? formatQuantity(t.amount, t.row.unit) : ""}
                  </span>
                </div>
              ))}
              <button
                onClick={() => {
                  haptic(10);
                  giveBack();
                }}
                className="flex h-12 w-full items-center gap-2.5 border-t border-line px-3.5 text-left active:bg-surface-2"
              >
                <Undo2 size={16} strokeWidth={2.4} className="shrink-0 text-brand" />
                <span className="text-[14px] font-bold text-brand">Повернути в комору</span>
              </button>
            </Panel>
          ) : lines.length === 0 ? (
            <Panel className="px-3.5 py-3 text-[13px] font-semibold leading-relaxed text-muted">
              У коморі немає нічого з цієї страви — списувати нічого.
            </Panel>
          ) : (
            <>
              <p className="px-1 text-[12px] font-semibold leading-snug text-faint">
                Помічник лише здогадується, яку пачку взяли й скільки. Виправ, якщо не так, — і комора не бреше.
              </p>
              <Panel>
                {lines.map((line, index) => (
                  <div
                    key={`${line.item.name}-${index}`}
                    className={cn("flex flex-col gap-2 px-3.5 py-2.5", index > 0 && "border-t border-line")}
                  >
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{line.item.name}</p>
                      <input
                        value={line.grams}
                        onChange={(e) => set(index, { grams: e.target.value.replace(/[^\d.,]/g, "") })}
                        inputMode="decimal"
                        aria-label={`Скільки грамів: ${line.item.name}`}
                        className="h-8 w-[64px] rounded-[8px] bg-surface-2 px-2.5 text-right text-[14px] font-bold"
                      />
                      <span className="text-[14px] font-bold text-muted">г</span>
                    </div>
                    <div className="no-scrollbar -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5">
                      {line.rows.map((row) => {
                        const on = line.rowId === row.id;
                        return (
                          <button
                            key={row.id}
                            aria-pressed={on}
                            onClick={() => {
                              haptic(8);
                              set(index, { rowId: on ? null : row.id });
                            }}
                            className={cn(
                              "flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px] font-bold",
                              on ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface-2 text-muted",
                            )}
                          >
                            {on && <Check size={13} strokeWidth={3} />}
                            {name(row)}
                            {row.amount != null && row.unit && (
                              <span className="font-semibold text-faint">{formatQuantity(row.amount, row.unit)}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </Panel>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
