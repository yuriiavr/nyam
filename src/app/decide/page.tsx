"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { RecipeMedia } from "@/components/RecipeCard";
import { Button, Card } from "@/components/ui";
import { allRecipes, useApp } from "@/lib/store";
import { recommend } from "@/lib/matching";
import { haptic, pick } from "@/lib/utils";
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
  {
    href: "/decide/roulette",
    emoji: "🎡",
    title: "Рулетка",
    note: "Крути колесо — доля обере страву",
    accent: "#ff6b35",
    span: true,
  },
  {
    href: "/decide/fridge",
    emoji: "🧊",
    title: "Що в холодильнику",
    note: "Готуй з того, що вже є",
    accent: "#34d399",
  },
  {
    href: "/decide/swipe",
    emoji: "🔥",
    title: "Свайп",
    note: "Гортай, як у Тіндері",
    accent: "#f43f6a",
  },
  {
    href: "/decide/duel",
    emoji: "⚔️",
    title: "Дуель страв",
    note: "Турнір на вибування",
    accent: "#a78bfa",
  },
  {
    href: "/decide/mood",
    emoji: "🎭",
    title: "За настроєм",
    note: "Три питання — і готово",
    accent: "#ffb020",
  },
  {
    href: "/decide/shake",
    emoji: "📳",
    title: "Струсити",
    note: "Потряси телефон",
    accent: "#38bdf8",
  },
  {
    href: "/decide/party",
    emoji: "👥",
    title: "Разом",
    note: "Оберіть компанією на одному телефоні",
    accent: "#f472b6",
  },
  {
    href: "/decide/foryou",
    emoji: "🔮",
    title: "Для тебе",
    note: "Алгоритм на основі твого смаку",
    accent: "#c084fc",
  },
  {
    href: "/decide/weather",
    emoji: "🌦️",
    title: "За погодою",
    note: "Холодно — суп, спека — салат",
    accent: "#60a5fa",
  },
  {
    href: "/plan",
    emoji: "📅",
    title: "План на тиждень",
    note: "Згенерувати меню на 7 днів",
    accent: "#fb923c",
  },
];

export default function DecidePage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const router = useRouter();
  const [instant, setInstant] = useState<Recipe | null>(null);

  const pool = useMemo(() => (hydrated ? allRecipes(state) : []), [hydrated, state]);

  const rollInstant = () => {
    haptic([18, 40, 18]);
    const recs = recommend(state, { limit: 12 });
    const chosen = recs.length ? pick(recs)?.recipe : pick(pool);
    setInstant(chosen ?? null);
  };

  return (
    <div className="pb-8">
      <TopBar back={false} title="Вирішити за мене" subtitle="10 способів обрати страву" />

      {/* Найшвидший варіант */}
      <section className="px-4 pt-4">
        <Card className="overflow-hidden p-0">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-brand" />
              <p className="text-[12px] font-bold uppercase tracking-wide text-brand">
                Найшвидше
              </p>
            </div>
            <h2 className="mt-1.5 font-display text-[19px] font-extrabold leading-tight">
              Просто скажи, що готувати
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              Одна кнопка. Врахує твій смак, комору і час доби.
            </p>

            {instant && (
              <motion.div
                key={instant.id}
                initial={{ opacity: 0, scale: 0.94, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 24 }}
                className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-bg-elev p-3"
              >
                <RecipeMedia
                  recipe={instant}
                  className="h-16 w-16 shrink-0"
                  rounded="rounded-2xl"
                  emojiSize="text-3xl"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase text-muted">Твій вердикт</p>
                  <h3 className="truncate font-display text-[16px] font-bold">{instant.title}</h3>
                  <p className="truncate text-[12px] text-muted">
                    {instant.timeMin} хв · {instant.cuisine}
                  </p>
                </div>
                <Button size="sm" onClick={() => router.push(`/recipe/${instant.id}`)}>
                  Готую
                </Button>
              </motion.div>
            )}

            <Button full size="lg" className="mt-4" onClick={rollInstant} disabled={!hydrated}>
              {instant ? "Ще варіант" : "Обери за мене"}
            </Button>
          </div>
        </Card>
      </section>

      {/* Способи вибору */}
      <section className="px-4 pt-6">
        <h2 className="mb-3 font-display text-[17px] font-bold">Способи вибору</h2>
        <div className="grid grid-cols-2 gap-3">
          {METHODS.map((m, i) => (
            <motion.div
              key={m.href}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.035, type: "spring", stiffness: 300, damping: 26 }}
              className={m.span ? "col-span-2" : undefined}
            >
              <Link href={m.href} onClick={() => haptic(12)}>
                <motion.div
                  whileTap={{ scale: 0.96 }}
                  className="relative h-full overflow-hidden rounded-xl3 border border-line bg-surface p-4"
                  style={{
                    backgroundImage: `radial-gradient(circle at 100% 0%, ${m.accent}22, transparent 60%)`,
                  }}
                >
                  <div
                    className="grid h-11 w-11 place-items-center rounded-2xl text-2xl"
                    style={{ background: `${m.accent}22` }}
                  >
                    {m.emoji}
                  </div>
                  <h3 className="mt-3 font-display text-[15px] font-bold leading-tight">
                    {m.title}
                  </h3>
                  <p className="mt-1 text-[12px] leading-snug text-muted">{m.note}</p>
                </motion.div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
