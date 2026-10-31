"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { SLOT_META, SLOT_ORDER } from "@/lib/diary";
import type { MealSlot, Nutrition } from "@/lib/types";
import { formatNumber } from "@/lib/units";
import { cn, haptic } from "@/lib/utils";

/*
 * Дрібні деталі аркушів щоденника, однакові в кожному: заголовок з емодзі,
 * степер −/+, вибір прийому їжі й рядок-галочка. Зібрані тут, щоб «Обід» і
 * «−» виглядали однаково, звідки б аркуш не відкрили.
 */

/** Заголовок аркуша: емодзі, назва, тьмяний підпис і праворуч — число (ккал). */
export function SheetTitle({
  emoji,
  title,
  sub,
  aside,
}: {
  emoji?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <span className="flex items-center gap-3">
      {emoji && <span className="text-[28px] leading-none">{emoji}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        {sub && <span className="block truncate font-sans text-[12px] font-semibold text-faint">{sub}</span>}
      </span>
      {aside}
    </span>
  );
}

/** «520 ккал» у заголовку: велике число Unbounded, підпис дрібно під ним. */
export function KcalAside({ kcal }: { kcal: ReactNode }) {
  return (
    <span className="flex shrink-0 flex-col items-end">
      <span className="text-[20px] leading-tight">{kcal}</span>
      <span className="font-sans text-[11px] font-semibold text-muted">ккал</span>
    </span>
  );
}

/** Три клітинки БЖВ у грамах — квадратик кольору нутрієнта й число. */
export function MacroCells({ nutrition, className }: { nutrition: Nutrition; className?: string }) {
  const parts = [
    { key: "protein", label: "Білки", value: nutrition.protein, color: "var(--macro-protein)" },
    { key: "fat", label: "Жири", value: nutrition.fat, color: "var(--macro-fat)" },
    { key: "carbs", label: "Вуглеводи", value: nutrition.carbs, color: "var(--macro-carbs)" },
  ];
  return (
    <div className={cn("grid grid-cols-3 gap-2.5 px-3.5 py-3", className)}>
      {parts.map((m) => (
        <div key={m.key} className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-[5px] truncate text-[11.5px] font-bold text-muted">
            <span className="h-[7px] w-[7px] shrink-0 rounded-[2px]" style={{ background: m.color }} />
            {m.label}
          </span>
          <span className="text-[15px] font-extrabold">{formatNumber(m.value, 1)} г</span>
        </div>
      ))}
    </div>
  );
}

/** Кнопка степера 32×32: − і + біля кількості. */
export function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 select-none place-items-center rounded-[8px] bg-surface-2 text-ink active:bg-line disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** Чотири прийоми їжі в один ряд — перемикач усередині картки аркуша. */
export function SlotPicker({ value, onChange }: { value: MealSlot; onChange: (slot: MealSlot) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1 rounded-[9px] border border-line bg-bg-elev p-[3px]">
      {SLOT_ORDER.map((s) => {
        const on = s === value;
        return (
          <button
            key={s}
            aria-pressed={on}
            onClick={() => {
              haptic(8);
              onChange(s);
            }}
            className={cn(
              "h-8 min-w-0 truncate rounded-[6px] px-1 text-[12.5px] font-bold transition-colors",
              on ? "bg-line text-ink" : "text-muted",
            )}
          >
            {SLOT_META[s].label}
          </button>
        );
      })}
    </div>
  );
}

/** Картка «Прийом їжі» з перемикачем — у кожному аркуші, що щось записує. */
export function SlotRow({
  value,
  onChange,
  divided,
}: {
  value: MealSlot;
  onChange: (slot: MealSlot) => void;
  /** Лінія згори — коли рядок не перший у картці. */
  divided?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-2 px-3.5 pb-3 pt-2.5", divided && "border-t border-line")}>
      <span className="text-[14px] font-semibold text-muted">Прийом їжі</span>
      <SlotPicker value={value} onChange={onChange} />
    </div>
  );
}

/**
 * Рядок-галочка картки: справжній checkbox (для доступності й клавіатури),
 * намальований квадратиком із дизайну.
 */
export function CheckRow({
  checked,
  onChange,
  divided,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-12 cursor-pointer items-center gap-3 px-3.5 py-2",
        divided && "border-t border-line",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40",
          checked ? "border-brand bg-brand text-brand-ink" : "border-line-strong",
        )}
      >
        {checked && <Check size={13} strokeWidth={3.5} />}
      </span>
      <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug">{children}</span>
    </label>
  );
}
