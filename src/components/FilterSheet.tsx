"use client";

import { Check, SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";
import { Button, Sheet } from "./ui";
import { allRecipes, useApp } from "@/lib/store";
import {
  emptyFilters,
  POOL_LABEL,
  type Filters,
  type Pool,
} from "@/lib/matching";
import type { MealType, Mood } from "@/lib/types";
import { COURSE_LABEL, COURSE_ORDER } from "@/lib/pairing";
import { MEAL_LABEL, MOOD_META, cn, haptic } from "@/lib/utils";

const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"];
const MOODS: Mood[] = [
  "fast",
  "comfort",
  "healthy",
  "hearty",
  "spicy",
  "sweet",
  "fancy",
  "cheap",
  "cozy",
  "fresh",
];
const TIMES = [15, 30, 45, 60];
const POOLS: Pool[] = [
  "all",
  "community",
  "saved",
  "mine",
  "following",
  "wishlist",
];

/**
 * «Не пропонувати те, що вже готували».
 *
 * Живе в сховищі, а не у фільтрах екрана: це рішення про смак, а не про
 * конкретний пошук, і людина приймає його один раз. Увімкнено за
 * замовчуванням — саме по повтори минулого тижня й скаржаться найчастіше.
 */
function AvoidRecent() {
  const days = useApp((s) => s.avoidRecentDays);
  const setDays = useApp((s) => s.setAvoidRecentDays);
  const on = days != null;

  return (
    <div className="pt-1">
      <button
        onClick={() => {
          haptic(10);
          setDays(on ? null : 7);
        }}
        aria-pressed={on}
        className="flex w-full items-start gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-3 text-left active:bg-surface-2"
      >
        <span
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] ${
            on ? "border-brand bg-brand text-brand-ink" : "border-line-strong"
          }`}
        >
          {on && <Check size={12} strokeWidth={3.5} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold leading-snug">
            Не пропонувати те, що готували минулі 7 днів
          </span>
          <span className="mt-0.5 block text-[11.5px] font-semibold leading-snug text-faint">
            Діє в усіх способах вибору. У пошуку — ні: там шукають конкретну страву.
          </span>
        </span>
      </button>
    </div>
  );
}

export function FilterButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => {
        haptic(10);
        onClick();
      }}
      className="relative grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[10px] border border-line bg-surface"
      aria-label="Фільтри"
    >
      <SlidersHorizontal size={17} />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-[5px] bg-brand px-1 text-[10px] font-extrabold text-brand-ink">
          {count}
        </span>
      )}
    </button>
  );
}

export function FilterSheet({
  open,
  onClose,
  value,
  onChange,
  resultCount,
  hidePool = false,
  suggesting = false,
}: {
  open: boolean;
  onClose: () => void;
  value: Filters;
  onChange: (f: Filters) => void;
  resultCount?: number;
  /** Там, де джерело обирають окремим перемикачем, тут його дублювати нічим. */
  hidePool?: boolean;
  /**
   * Екран пропонує страву, а не шукає конкретну. Тоді тут зʼявляється
   * перемикач повторів — у пошуку він був би шкідливий.
   */
  suggesting?: boolean;
}) {
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);

  const cuisines = useMemo(() => {
    const set = new Set(allRecipes(useApp.getState()).map((r) => r.cuisine));
    return [...set].sort();
  }, [myRecipes, remoteRecipes]);

  const toggle = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Фільтри"
      footer={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => onChange({ ...emptyFilters, query: value.query })}
          >
            Скинути
          </Button>
          <Button className="flex-[1.6]" onClick={onClose}>
            {resultCount != null ? `Показати ${resultCount}` : "Готово"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-3">
      {!hidePool && (
        <Group title="Звідки брати">
          {POOLS.map((p) => (
            <Chip
              key={p}
              active={value.pool === p}
              onClick={() => onChange({ ...value, pool: p })}
            >
              {POOL_LABEL[p]}
            </Chip>
          ))}
        </Group>
      )}

      {/* Частина прийому їжі: гарнір окремо від основної страви. */}
      <Group title="Частина страви">
        {COURSE_ORDER.map((c) => (
          <Chip
            key={c}
            active={value.courses.includes(c)}
            onClick={() =>
              onChange({ ...value, courses: toggle(value.courses, c) })
            }
          >
            {COURSE_LABEL[c]}
          </Chip>
        ))}
      </Group>

      <Group title="Прийом їжі">
        {MEALS.map((m) => (
          <Chip
            key={m}
            active={value.meals.includes(m)}
            onClick={() =>
              onChange({ ...value, meals: toggle(value.meals, m) })
            }
          >
            {MEAL_LABEL[m]}
          </Chip>
        ))}
      </Group>

      <Group title="Настрій">
        {MOODS.map((m) => (
          <Chip
            key={m}
            active={value.moods.includes(m)}
            onClick={() =>
              onChange({ ...value, moods: toggle(value.moods, m) })
            }
          >
            <span>{MOOD_META[m].emoji}</span>
            {MOOD_META[m].label}
          </Chip>
        ))}
      </Group>

      <Group title="Максимум часу">
        {TIMES.map((t) => (
          <Chip
            key={t}
            active={value.maxTime === t}
            onClick={() =>
              onChange({ ...value, maxTime: value.maxTime === t ? null : t })
            }
          >
            до {t} хв
          </Chip>
        ))}
      </Group>

      <Group title="Складність">
        {[1, 2, 3].map((d) => (
          <Chip
            key={d}
            active={value.maxDifficulty === d}
            onClick={() =>
              onChange({
                ...value,
                maxDifficulty: value.maxDifficulty === d ? null : d,
              })
            }
          >
            {["", "Просто", "До середньої", "Будь-яка"][d]}
          </Chip>
        ))}
      </Group>

      <Group title="Бюджет">
        {[1, 2, 3].map((c) => (
          <Chip
            key={c}
            active={value.maxCost === c}
            onClick={() =>
              onChange({ ...value, maxCost: value.maxCost === c ? null : c })
            }
          >
            {"₴".repeat(c)}
          </Chip>
        ))}
      </Group>

      <Group title="Кухня">
        {cuisines.map((c) => (
          <Chip
            key={c}
            active={value.cuisines.includes(c)}
            onClick={() =>
              onChange({ ...value, cuisines: toggle(value.cuisines, c) })
            }
          >
            {c}
          </Chip>
        ))}
      </Group>

      {suggesting && <AvoidRecent />}
      </div>
    </Sheet>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 px-0.5 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">
        {title}
      </h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Чіп фільтра: плаский, як у решті аркушів, — активний підсвічений брендом. */
function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => {
        haptic(8);
        onClick();
      }}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 select-none items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px] font-bold transition-colors",
        active ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface text-muted active:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}
