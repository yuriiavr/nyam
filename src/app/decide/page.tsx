"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { RecipeMedia } from "@/components/RecipeCard";
import { Button, Panel, PanelHeader } from "@/components/ui";
import { allRecipes, useApp } from "@/lib/store";
import { recommend } from "@/lib/matching";
import { cn, formatMinutes, haptic, pick } from "@/lib/utils";

const RECIPE_HREF = "/recipe/";
import type { Recipe } from "@/lib/types";
import { useRouter } from "next/navigation";

interface Method {
  href: string;
  emoji: string;
  title: string;
  note: string;
  accent: string;
  span?: boolean;
}

const METHODS: Method[] = [
  { href: "/decide/roulette", emoji: "🎡", title: "Рулетка", note: "Крути колесо — доля обере", accent: "#ff6b35" },
  { href: "/decide/fridge", emoji: "🧊", title: "Холодильник", note: "Готуй з того, що вже є", accent: "#38bdf8" },
  { href: "/decide/duel", emoji: "⚔️", title: "Дуель", note: "Переможець лишається, поки не програє", accent: "#f43f6a" },
  { href: "/decide/party", emoji: "👥", title: "Разом", note: "Оберіть компанією на одному телефоні", accent: "#a78bfa" },
  { href: "/decide/rescue", emoji: "🆘", title: "Врятувати", note: "Страви з того, що псується", accent: "#34d399" },
  { href: "/decide/blackout", emoji: "🕯️", title: "Поки є світло", note: "Встигнути між відключеннями", accent: "#ffb020" },
  { href: "/plan", emoji: "📅", title: "Тиждень", note: "Меню на 7 днів без повторів і список покупок", accent: "#38bdf8", span: true },
];

export default function DecidePage() {
  /*
   * Список рецептів залежить лише від того, звідки вони беруться. Підписка
   * на весь стор перемальовувала б сторінку від будь-якої зміни.
   */
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);
  const hydrated = useApp((s) => s.hydrated);
  const router = useRouter();
  const [instant, setInstant] = useState<Recipe | null>(null);

  const pool = useMemo(
    () => (hydrated ? allRecipes(useApp.getState()) : []),
    [hydrated, myRecipes, remoteRecipes],
  );

  const rollInstant = () => {
    haptic([18, 40, 18]);
    const recs = recommend(useApp.getState(), { limit: 12 });
    const chosen = recs.length ? pick(recs)?.recipe : pick(pool);
    setInstant(chosen ?? null);
  };

  return (
    <div className="pb-8">
      <TopBar back={false} title="Вирішити" />

      {/* Планшет (lg): «Найшвидше» — висока ліва колонка, способи — сіткою 3×2 праворуч. */}
      <div className="flex flex-col gap-2.5 px-4 md:px-6 lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,3fr)] lg:gap-3">
        {/* Найшвидший варіант */}
        <Panel className="lg:flex lg:flex-col">
          <PanelHeader label="Найшвидше" tone="brand" icon={<Zap size={13} className="fill-brand" strokeWidth={0} />} />
          <div className="flex flex-col gap-3 border-t border-line px-3.5 pb-3.5 pt-3 lg:flex-1 lg:p-4">
            <div>
              <h2 className="font-display text-[17px] font-bold leading-tight">Просто скажи, що готувати</h2>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">Врахує смак, комору і час доби</p>
            </div>

            {instant && (
              <motion.button
                key={instant.id}
                initial={{ opacity: 0, scale: 0.96, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 24 }}
                onClick={() => router.push(RECIPE_HREF + instant.id)}
                className="flex items-center gap-3 rounded-[10px] border border-line bg-bg-elev p-2 text-left"
              >
                <RecipeMedia recipe={instant} className="h-14 w-14 shrink-0" rounded="rounded-[8px]" emojiSize="text-[28px]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-faint">Твій вердикт</span>
                  <span className="block truncate text-[15px] font-extrabold">{instant.title}</span>
                  <span className="block truncate text-[12px] font-semibold text-muted">
                    {formatMinutes(instant.timeMin)} · {instant.cuisine}
                  </span>
                </span>
                <span className="shrink-0 pr-1.5 text-[13px] font-extrabold text-brand">Готую ›</span>
              </motion.button>
            )}

            {/* На планшеті колонка висока — порожнє місце займає кубик, а не дірка. */}
            {!instant && <span className="hidden flex-1 place-items-center text-[88px] lg:grid">🎲</span>}

            <Button full onClick={rollInstant} disabled={!hydrated} className="lg:mt-auto">
              {instant ? "Ще варіант" : "Обери за мене"}
            </Button>
          </div>
        </Panel>

        {/* Способи вибору */}
        <Panel>
          <PanelHeader label="Способи вибору" />
          <div className="grid grid-cols-2 gap-px border-t border-line bg-line lg:grid-cols-3">
            {METHODS.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                onClick={() => haptic(12)}
                className={cn(
                  "flex min-h-[112px] flex-col gap-2.5 bg-surface p-3.5 active:bg-surface-2 lg:min-h-[150px] lg:p-4",
                  m.span && "col-span-2 lg:col-span-3 lg:min-h-[96px] lg:flex-row lg:items-center lg:gap-3.5",
                )}
              >
                <span
                  className="grid h-10 w-10 place-items-center rounded-[10px] text-[21px]"
                  style={{ background: `${m.accent}24` }}
                >
                  {m.emoji}
                </span>
                <span>
                  <span className="block text-[14px] font-extrabold">{m.title}</span>
                  <span className="mt-0.5 block text-[11.5px] font-semibold leading-[1.35] text-faint">{m.note}</span>
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
