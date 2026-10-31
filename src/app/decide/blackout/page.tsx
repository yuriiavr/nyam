"use client";

import { motion } from "framer-motion";
import { Flame, Plug, Snowflake } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { EmptyState, Panel, PanelHeader, Segmented } from "@/components/ui";
import { suggestable } from "@/lib/matching";
import { powerMatches, type PowerMatch, type PowerMode } from "@/lib/power";
import { useApp } from "@/lib/store";
import { cn, formatMinutes, haptic, plural } from "@/lib/utils";

/**
 * Що приготувати, поки є світло — або поки його немає.
 *
 * Звичайний фільтр «до 30 хвилин» на це не відповідає: тридцять хвилин у
 * духовці й тридцять на газовій плиті — різні речі, коли в графіку
 * відключень наступне вікно через чотири години.
 */

const WINDOWS = [20, 40, 60, 90];

const MODE_NOTE: Record<PowerMode, string> = {
  window: "Світло є, але ненадовго. Показуємо все, що встигнеш приготувати у вікні.",
  socket:
    "Світла немає, газ є. Плита працює, тож лишаємо страви без духовки, блендера й мікрохвильовки.",
  cold: "Ані світла, ані вогню. Тільки те, що не треба готувати взагалі.",
};

export default function BlackoutPage() {
  const hydrated = useApp((s) => s.hydrated);
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);

  const [mode, setMode] = useState<PowerMode>("window");
  const [minutes, setMinutes] = useState<number | null>(60);

  const matches = useMemo(() => {
    if (!hydrated) return [];
    // Без вогню час не обмежуємо: там «готування» це нарізати й змішати.
    return powerMatches(suggestable(useApp.getState()), {
      mode,
      minutes: mode === "cold" ? null : minutes,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, mode, minutes, myRecipes, remoteRecipes]);

  return (
    <div className="pb-8">
      <TopBar
        title="Поки є світло"
        right={
          <span className="shrink-0 text-[12px] font-bold text-faint">
            {matches.length} {plural(matches.length, "страва", "страви", "страв")}
          </span>
        }
      />

      <div className="flex flex-col gap-2.5 px-4">
        <Segmented
          value={mode}
          onChange={(next) => {
            haptic(10);
            setMode(next);
          }}
          options={[
            { value: "window", label: "У вікно" },
            { value: "socket", label: "Без розетки" },
            { value: "cold", label: "Без вогню" },
          ]}
        />

        <Panel>
          <p className="px-3.5 py-3 text-[12.5px] font-semibold leading-snug text-muted">{MODE_NOTE[mode]}</p>
          {mode !== "cold" && (
            <>
              <PanelHeader label="Скільки часу є" className="border-t border-line" />
              <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-3.5 pb-3">
                {WINDOWS.map((w) => (
                  <WindowChip
                    key={w}
                    active={minutes === w}
                    onClick={() => {
                      haptic(8);
                      setMinutes(w);
                    }}
                  >
                    {w} хв
                  </WindowChip>
                ))}
                <WindowChip
                  active={minutes === null}
                  onClick={() => {
                    haptic(8);
                    setMinutes(null);
                  }}
                >
                  Не обмежувати
                </WindowChip>
              </div>
            </>
          )}
        </Panel>

        {matches.length === 0 ? (
          <EmptyState
            emoji="🕯️"
            title="Нічого не вкладається"
            note={
              mode === "cold"
                ? "Усі рецепти потребують плити або духовки. Додай свій рецепт салату чи бутербродів — і він тут зʼявиться."
                : "Спробуй більше вікно або інший режим."
            }
          />
        ) : (
          <Panel>
            <PanelHeader label="Встигнеш приготувати" />
            {matches.slice(0, 40).map((match, i) => (
              <PowerCard key={match.recipe.id} match={match} index={i} />
            ))}
          </Panel>
        )}
      </div>
    </div>
  );
}

function WindowChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-8 shrink-0 rounded-[8px] border px-2.5 text-[12.5px] font-bold",
        active ? "border-brand/40 bg-brand/10 text-brand" : "border-line bg-surface text-muted",
      )}
    >
      {children}
    </button>
  );
}

function PowerCard({ match, index }: { match: PowerMatch; index: number }) {
  const { recipe, needs } = match;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
    >
      <Link
        href={`/recipe/${recipe.id}`}
        className="flex items-center gap-3 border-t border-line px-3.5 py-3 active:bg-surface-2"
      >
        <RecipeMedia
          recipe={recipe}
          className="h-[52px] w-[52px] shrink-0"
          rounded="rounded-[8px]"
          emojiSize="text-[26px]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14.5px] font-extrabold leading-tight">{recipe.title}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {needs.oven && <NeedChip icon={<Plug size={11} />} label="духовка" tone="berry" />}
            {needs.appliance && <NeedChip icon={<Plug size={11} />} label="розетка" tone="berry" />}
            {needs.stove && !needs.oven && (
              <NeedChip icon={<Flame size={11} />} label="плита" tone="brand" />
            )}
            {!needs.oven && !needs.stove && !needs.appliance && (
              <NeedChip icon={<Snowflake size={11} />} label="без вогню" tone="mint" />
            )}
          </div>
        </div>
        <span className="shrink-0 text-[12.5px] font-bold text-muted">{formatMinutes(recipe.timeMin)}</span>
      </Link>
    </motion.div>
  );
}

function NeedChip({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: "berry" | "brand" | "mint";
}) {
  const styles = {
    berry: "bg-berry/12 text-berry",
    brand: "bg-brand/12 text-brand",
    mint: "bg-mint/15 text-mint",
  }[tone];

  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1 rounded-[6px] px-[7px] text-[11px] font-bold ${styles}`}
    >
      {icon}
      {label}
    </span>
  );
}
