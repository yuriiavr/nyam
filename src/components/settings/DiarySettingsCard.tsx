"use client";

import { Check, Minus, NotebookPen, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, Chip } from "@/components/ui";
import { portionLabel, settingsOf } from "@/lib/diary";
import { diaryUserId, useApp } from "@/lib/store";
import { haptic } from "@/lib/utils";

const GOALS = [1600, 1800, 2000, 2200, 2500];

/**
 * Налаштування щоденника: денна ціль, апетит і хто бачить записи.
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
