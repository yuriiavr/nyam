"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, PanelHeader, Toggle } from "@/components/ui";
import { portionLabel, settingsOf } from "@/lib/diary";
import { diaryUserId, useApp } from "@/lib/store";
import type { DiarySettings } from "@/lib/types";
import { haptic } from "@/lib/utils";

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
    <label className="flex h-9 min-w-0 items-center gap-1.5 rounded-[8px] bg-surface-2 px-2.5">
      <span className="h-[7px] w-[7px] shrink-0 rounded-[2px]" style={{ background: color }} />
      <span className="text-[12.5px] font-extrabold text-muted">{label}</span>
      <input
        value={raw}
        onChange={(e) => setRaw(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        inputMode="numeric"
        placeholder="—"
        aria-label={`Ціль ${name} на день, г`}
        className="w-0 min-w-0 flex-1 bg-transparent text-right text-[14px] font-bold outline-none"
      />
      <span className="text-[12px] text-faint">г</span>
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
    <Panel id="diary" className="scroll-mt-20">
      <PanelHeader label="Щоденник" />

      <label className="flex h-[52px] items-center gap-2 border-t border-line px-3.5">
        <span className="flex-1 text-[14px] font-semibold">Денна ціль</span>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value.replace(/\D/g, "").slice(0, 5))}
          onBlur={() => saveGoal(goal)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          inputMode="numeric"
          placeholder="без цілі"
          aria-label="Денна ціль у кілокалоріях"
          className="h-8 w-[84px] rounded-[8px] bg-surface-2 px-2.5 text-right text-[14px] font-bold"
        />
        <span className="w-[30px] text-[13px] font-bold text-muted">ккал</span>
      </label>

      <div className="flex flex-col gap-2 border-t border-line px-3.5 pb-3 pt-2.5">
        <span className="text-[14px] font-semibold">Білки · жири · вуглеводи</span>
        <div className="grid grid-cols-3 gap-1.5">
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
        <p className="text-[11.5px] font-semibold leading-snug text-faint">{macroHint(mine)}</p>
      </div>

      <div className="flex min-h-[52px] items-center gap-2 border-t border-line py-2 pl-3.5 pr-2">
        <span className="min-w-0 flex-1 text-[14px] font-semibold" title="Скільки порцій рецепта зазвичай зʼїдаєш">
          Мій апетит
        </span>
        <button
          aria-label="Менший апетит"
          onClick={() => appetite(-0.25)}
          disabled={mine.appetite <= 0.5}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-surface-2 active:bg-line disabled:opacity-35"
        >
          <Minus size={16} />
        </button>
        <span className="w-[76px] shrink-0 text-center text-[13.5px] font-extrabold">{portionLabel(mine.appetite)}</span>
        <button
          aria-label="Більший апетит"
          onClick={() => appetite(0.25)}
          disabled={mine.appetite >= 3}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-surface-2 active:bg-line disabled:opacity-35"
        >
          <Plus size={16} />
        </button>
      </div>

      {family && (
        <div className="flex min-h-[52px] items-center gap-2 border-t border-line px-3.5 py-2">
          <span className="min-w-0 flex-1 text-[14px] font-semibold">Сімʼя бачить мій щоденник</span>
          <Toggle
            checked={mine.shareDiary}
            label="Сімʼя бачить мій щоденник"
            onChange={(next) => setMyDiarySettings({ shareDiary: next })}
          />
        </div>
      )}
    </Panel>
  );
}
