"use client";

import { motion } from "framer-motion";
import { Flame, Plug, Snowflake } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Card, EmptyState, Segmented } from "@/components/ui";
import { powerMatches, type PowerMatch, type PowerMode } from "@/lib/power";
import { allRecipes, useApp } from "@/lib/store";
import { formatMinutes, haptic, plural } from "@/lib/utils";

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
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);

  const [mode, setMode] = useState<PowerMode>("window");
  const [minutes, setMinutes] = useState<number | null>(60);

  const matches = useMemo(() => {
    if (!hydrated) return [];
    // Без вогню час не обмежуємо: там «готування» це нарізати й змішати.
    return powerMatches(allRecipes(state), {
      mode,
      minutes: mode === "cold" ? null : minutes,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, mode, minutes, state.myRecipes, state.remoteRecipes]);

  return (
    <div className="pb-8">
      <TopBar
        title="Поки є світло"
        subtitle={`${matches.length} ${plural(matches.length, "страва", "страви", "страв")} підходить`}
      />

      <div className="px-4 pt-4">
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
        <p className="mt-2.5 text-[12px] leading-snug text-muted">{MODE_NOTE[mode]}</p>
      </div>

      {mode !== "cold" && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pt-3">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => {
                haptic(8);
                setMinutes(w);
              }}
              className={`shrink-0 rounded-full border px-3.5 py-2 text-[13px] font-bold ${
                minutes === w
                  ? "border-brand bg-brand text-brand-ink"
                  : "border-line bg-surface text-muted"
              }`}
            >
              {w} хв
            </button>
          ))}
          <button
            onClick={() => {
              haptic(8);
              setMinutes(null);
            }}
            className={`shrink-0 rounded-full border px-3.5 py-2 text-[13px] font-bold ${
              minutes === null
                ? "border-brand bg-brand text-brand-ink"
                : "border-line bg-surface text-muted"
            }`}
          >
            Не обмежувати
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 px-4 pt-4">
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
          matches
            .slice(0, 40)
            .map((match, i) => <PowerCard key={match.recipe.id} match={match} index={i} />)
        )}
      </div>
    </div>
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
      <Card className="overflow-hidden p-0">
        <Link href={`/recipe/${recipe.id}`} className="flex gap-3 p-3">
          <RecipeMedia
            recipe={recipe}
            className="h-[64px] w-[64px] shrink-0"
            rounded="rounded-2xl"
            emojiSize="text-2xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 font-display text-[15px] font-bold leading-tight">
                {recipe.title}
              </h3>
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold">
                {formatMinutes(recipe.timeMin)}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
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
        </Link>
      </Card>
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
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${styles}`}
    >
      {icon}
      {label}
    </span>
  );
}
