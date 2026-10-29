"use client";

import { Check, Minus, NotebookPen, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, Chip } from "@/components/ui";
import { portionLabel, settingsOf } from "@/lib/diary";
import { diaryUserId, useApp } from "@/lib/store";
import type { DiarySettings } from "@/lib/types";
import { haptic } from "@/lib/utils";

const GOALS = [1600, 1800, 2000, 2200, 2500];

const MACROS = [
  { field: "proteinGoal", label: "Б", name: "білків", color: "var(--macro-protein)", kcalPerGram: 4 },
  { field: "fatGoal", label: "Ж", name: "жирів", color: "var(--macro-fat)", kcalPerGram: 9 },
  { field: "carbsGoal", label: "В", name: "вуглеводів", color: "var(--macro-carbs)", kcalPerGram: 4 },
] as const;

/**
 * Скільки калорій дають задані БЖВ — щоб видно було, що вони не суперечать
 * цілі калорій: помічник складає меню під усі чотири числа одразу.
 */
function macroHint(s: DiarySettings): string {
  if (MACROS.some((m) => s[m.field] == null)) {
    return "Помічник складатиме меню з рецептів під ці числа. Порожнє — без цілі.";
  }
  const kcal = Math.round(MACROS.reduce((sum, m) => sum + (s[m.field] ?? 0) * m.kcalPerGram, 0));
  if (!s.kcalGoal) return `Разом це ≈ ${kcal} ккал.`;
  const gap = kcal - s.kcalGoal;
  if (Math.abs(gap) <= s.kcalGoal * 0.05) return `Разом це ≈ ${kcal} ккал — збігається з ціллю.`;
  return `Разом це ≈ ${kcal} ккал — на ${Math.abs(gap)} ${gap > 0 ? "більше" : "менше"} за ціль калорій.`;
}

/** Ціль одного з БЖВ: зберігається, коли поле втрачає фокус, як і ціль калорій. */
function MacroGoal({
  label,
  name,
  color,
  value,
  onSave,
}: {
  label: string;
  name: string;
  color: string;
  value?: number;
  onSave: (value: number | undefined) => void;
}) {
  const [raw, setRaw] = useState(value ? String(value) : "");
  useEffect(() => {
    setRaw(value ? String(value) : "");
  }, [value]);

  const save = () => {
    if (!raw.trim()) {
      if (value != null) onSave(undefined);
      return;
    }
    const n = Math.round(Number(raw));
    if (!(n >= 1 && n <= 1000)) {
      setRaw(value ? String(value) : "");
      return;
    }
    if (n !== value) onSave(n);
  };

  return (
    <label className="flex h-11 items-center gap-1.5 rounded-2xl border border-line bg-surface px-3">
      <span className="text-[13px] font-extrabold" style={{ color }}>
        {label}
      </span>
      <input
        value={raw}
        onChange={(e) => setRaw(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        inputMode="numeric"
        placeholder="—"
        aria-label={`Ціль ${name} на день, г`}
        className="min-w-0 flex-1 bg-transparent text-center font-display text-[17px] font-bold outline-none"
      />
      <span className="text-[12px] text-muted">г</span>
    </label>
  );
}

/**
 * Налаштування щоденника: денні цілі, апетит і хто бачить записи.
 *
 * Апетит — скільки порцій рецепта людина зазвичай зʼїдає: саме з нього
 * поділ страви пропонує «тобі півтори, їй одну».
 */
export function DiarySettingsCard() {
  const account = useApp((s) => s.account);
  const settings = useApp((s) => s.diarySettings);
  const family = useApp((s) => s.family);
  const setMyDiarySettings = useApp((s) => s.setMyDiarySettings);
  const mine = settingsOf(settings, diaryUserId({ account }));

  const [goal, setGoal] = useState(mine.kcalGoal ? String(mine.kcalGoal) : "");
  useEffect(() => {
    setGoal(mine.kcalGoal ? String(mine.kcalGoal) : "");
  }, [mine.kcalGoal]);

  const saveGoal = (raw: string) => {
    const n = Math.round(Number(raw));
    if (!raw.trim()) {
      if (mine.kcalGoal != null) setMyDiarySettings({ kcalGoal: undefined });
      return;
    }
    if (!(n >= 500 && n <= 10000)) {
      setGoal(mine.kcalGoal ? String(mine.kcalGoal) : "");
      return;
    }
    if (n !== mine.kcalGoal) setMyDiarySettings({ kcalGoal: n });
  };

  const appetite = (delta: number) => {
    haptic(8);
    const next = Math.min(3, Math.max(0.5, Math.round((mine.appetite + delta) * 4) / 4));
    setMyDiarySettings({ appetite: next });
  };

  return (
    <section id="diary" className="scroll-mt-20 px-4 pt-4">
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <NotebookPen size={17} className="text-brand" />
          <h2 className="font-display text-[16px] font-bold">Щоденник</h2>
        </div>

        <p className="mt-3 text-[13.5px] font-bold">Денна ціль, ккал</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onBlur={() => saveGoal(goal)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            inputMode="numeric"
            placeholder="без цілі"
            aria-label="Денна ціль у кілокалоріях"
            className="h-11 w-28 rounded-2xl border border-line bg-surface px-3 text-center font-display text-[17px] font-bold"
          />
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {GOALS.map((g) => (
              <Chip
                key={g}
                size="sm"
                active={mine.kcalGoal === g}
                onClick={() => {
                  setGoal(String(g));
                  setMyDiarySettings({ kcalGoal: g });
                }}
              >
                {g}
              </Chip>
            ))}
          </div>
        </div>

        <p className="mt-4 text-[13.5px] font-bold">Білки · жири · вуглеводи, г на день</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {MACROS.map((m) => (
            <MacroGoal
              key={m.field}
              label={m.label}
              name={m.name}
              color={m.color}
              value={mine[m.field]}
              onSave={(v) => setMyDiarySettings({ [m.field]: v })}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-muted">{macroHint(mine)}</p>

        <div className="mt-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-bold">Мій апетит</p>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">
              Скільки порцій рецепта ти зазвичай зʼїдаєш. Їси більше за рідних — постав 1,5, і страва ділитиметься
              відповідно.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              aria-label="Менший апетит"
              onClick={() => appetite(-0.25)}
              disabled={mine.appetite <= 0.5}
              className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 active:bg-line disabled:opacity-35"
            >
              <Minus size={16} />
            </button>
            <span className="w-[78px] text-center text-[13px] font-bold">{portionLabel(mine.appetite)}</span>
            <button
              aria-label="Більший апетит"
              onClick={() => appetite(0.25)}
              disabled={mine.appetite >= 3}
              className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 active:bg-line disabled:opacity-35"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {family && (
          <button
            onClick={() => {
              haptic(10);
              setMyDiarySettings({ shareDiary: !mine.shareDiary });
            }}
            aria-pressed={mine.shareDiary}
            className="mt-4 flex w-full items-start gap-3 text-left"
          >
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${
                mine.shareDiary ? "border-brand bg-brand text-brand-ink" : "border-line"
              }`}
            >
              {mine.shareDiary && <Check size={12} strokeWidth={3.5} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold">Сімʼя бачить мій щоденник</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                Вимкнено — рідні бачать лише те, що самі тобі записали (скажімо, твою порцію спільної вечері).
              </span>
            </span>
          </button>
        )}
      </Card>
    </section>
  );
}
