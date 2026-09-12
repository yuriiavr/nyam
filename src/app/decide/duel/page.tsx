"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RotateCw, Swords, Trophy } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, EmptyState, useToast } from "@/components/ui";
import {
  activeFilterCount,
  applyFilters,
  emptyFilters,
  suggestable,
  type Filters,
} from "@/lib/matching";
import { useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { formatMinutes, haptic, plural, shuffle } from "@/lib/utils";

/**
 * Дуель страв: переможець лишається на місці.
 *
 * Не турнір на вибування. Обрана страва зустрічає наступну, і поки її не
 * поб'ють, вона так і стоїть: карбонара проти вафель — карбонара, карбонара
 * проти борщу — карбонара, карбонара проти піци — піца, і далі вже піца
 * зустрічає наступну.
 *
 * Чому так краще за сітку: у турнірі половина страв вилітає, не зустрівшись
 * із твоєю улюбленою, і переможець — той, кому пощастило з сіткою. Тут
 * переможець побив усіх по черзі, і кожен вибір — це те саме просте питання,
 * а не порівняння двох випадкових страв із чужої гілки.
 */

/** Скільки страв бере участь. Верхня межа — щоб не перетворити це на роботу. */
const SIZES = [10, 15, 20, 25, 35, 50];

/**
 * Плитки під те, що реально є в застосунку.
 *
 * Показувати «50 страв», коли їх двадцять три, безглуздо — і ще безглуздіше
 * малювати три однакові плитки з числом 23. Тому лишаємо тільки ті варіанти,
 * які менші за наявну кількість, а останньою ставимо саму цю кількість: «усі,
 * що є». Коли рецептів побільшає, плиток стане більше самі собою.
 */
function sizeOptions(available: number): number[] {
  const fit = SIZES.filter((size) => size < available);
  // Коли страв більше за найбільшу плитку, сьомої не додаємо: понад пʼятдесят
  // порівнянь — це вже не вибір вечері, а робота.
  if (fit.length === SIZES.length) return SIZES;
  return available >= 2 ? [...fit, available] : fit;
}

type Stage = "setup" | "duel";

export default function DuelPage() {
  const myRecipes = useApp((s) => s.myRecipes);
  const saved = useApp((s) => s.saved);
  const following = useApp((s) => s.following);
  const cooked = useApp((s) => s.cooked);
  const wishlist = useApp((s) => s.wishlist);
  const toggleWish = useApp((s) => s.toggleWish);
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [stage, setStage] = useState<Stage>("setup");
  /** Учасники в порядку появи. Перший одразу стає чинним переможцем. */
  const [lineup, setLineup] = useState<Recipe[]>([]);
  const [champion, setChampion] = useState<Recipe | null>(null);
  /** Хто виходить наступним. Дорівнює довжині складу — дуель скінчилась. */
  const [next, setNext] = useState(1);
  const [picked, setPicked] = useState<string | null>(null);

  const pool = useMemo(
    () =>
      hydrated
        ? applyFilters(useApp.getState(), filters, suggestable(useApp.getState()))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, filters, myRecipes, saved, following, cooked],
  );

  const start = (wanted: number) => {
    // Більше страв, ніж є, узяти нізвідки: беремо скільки набралось.
    const contenders = shuffle(pool).slice(0, Math.min(wanted, pool.length));
    haptic(14);
    setLineup(contenders);
    setChampion(contenders[0] ?? null);
    setNext(1);
    setPicked(null);
    setStage("duel");
  };

  const challenger = lineup[next];
  const done = champion !== null && next >= lineup.length;

  const choose = (winner: Recipe) => {
    if (picked || !champion) return;
    haptic([16, 30, 16]);
    setPicked(winner.id);

    setTimeout(() => {
      setChampion(winner);
      setNext((i) => i + 1);
      setPicked(null);

      if (next + 1 >= lineup.length) {
        haptic([30, 60, 30, 60, 40]);
        // Переможця кладемо у список бажань — але саме кладемо, а не
        // перемикаємо: інакше страва, яка там уже була, звідти б зникла.
        if (!wishlist.includes(winner.id)) toggleWish(winner.id);
      }
    }, 340);
  };

  if (hydrated && pool.length < 2) {
    return (
      <div>
        <TopBar title="Дуель страв" />
        <EmptyState
          emoji="⚔️"
          title="Замало страв для дуелі"
          note="Потрібно щонайменше дві. Послаб фільтри або додай рецепти."
          action={<Button onClick={() => setFilters(emptyFilters)}>Скинути фільтри</Button>}
        />
      </div>
    );
  }

  if (stage === "setup") {
    return (
      <div className="flex min-h-dvh flex-col pb-6">
        <TopBar
          title="Дуель страв"
          subtitle="Переможець лишається, поки його не поб'ють"
          right={
            <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
          }
        />

        <p className="px-4 pt-4 text-[13.5px] leading-snug text-muted">
          Скільки страв пустимо в дуель? Кожна виходить по черзі проти чинного переможця —
          вибирати доведеться на одну менше разів, ніж страв.
        </p>

        <div className="grid grid-cols-2 gap-3 px-4 pt-4">
          {sizeOptions(pool.length).map((size, i, all) => (
            <SizeTile
              key={size}
              size={size}
              index={i}
              all={i === all.length - 1 && size === pool.length}
              onPick={() => start(size)}
            />
          ))}
        </div>

        <p className="px-4 pt-4 text-[11.5px] leading-snug text-faint">
          За фільтрами зараз {pool.length} {plural(pool.length, "страва", "страви", "страв")}.
          Більше варіантів зʼявиться, коли рецептів побільшає.
        </p>

        <FilterSheet
        suggesting
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          value={filters}
          onChange={setFilters}
          resultCount={pool.length}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col pb-6">
      <TopBar
        title="Дуель страв"
        subtitle={
          done
            ? "Переможець визначено"
            : `${next} з ${lineup.length - 1} · вистояла ${streak(lineup, champion, next)} ${plural(streak(lineup, champion, next), "раз", "рази", "разів")}`
        }
        right={
          <button
            onClick={() => setStage("setup")}
            className="rounded-2xl bg-surface-2 px-3 py-2 text-[12.5px] font-bold text-muted"
          >
            Заново
          </button>
        }
      />

      {done && champion ? (
        <ChampionScreen
          champion={champion}
          beaten={lineup.length - 1}
          onRestart={() => setStage("setup")}
        />
      ) : (
        <>
          {/* Скільки страв уже пройшло повз */}
          <div className="flex gap-1 px-4 pt-4">
            {lineup.slice(1).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full ${
                  i < next - 1 ? "bg-brand" : i === next - 1 ? "bg-brand/50" : "bg-line"
                }`}
              />
            ))}
          </div>

          <p className="px-4 pt-4 text-center text-[13px] font-semibold text-muted">
            Що б ти обрав зараз?
          </p>

          <div className="relative flex flex-1 flex-col gap-3 px-4 pt-3">
            {champion && (
              <Contender
                recipe={champion}
                picked={picked}
                onPick={() => choose(champion)}
                align="top"
                crown={streak(lineup, champion, next) > 0}
              />
            )}

            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
              <div className="grid h-12 w-12 place-items-center rounded-full border-4 border-bg bg-surface-2">
                <Swords size={20} className="text-brand" />
              </div>
            </div>

            {challenger && (
              <Contender
                recipe={challenger}
                picked={picked}
                onPick={() => choose(challenger)}
                align="bottom"
              />
            )}
          </div>

          <div className="px-4 pt-4">
            <Button
              variant="ghost"
              full
              onClick={() => {
                start(lineup.length);
                toast("Інші страви", "🔄");
              }}
            >
              <RotateCw size={16} />
              Інші страви
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Скільки поспіль чинний переможець уже вистояв. */
function streak(lineup: Recipe[], champion: Recipe | null, next: number): number {
  if (!champion) return 0;
  const since = lineup.findIndex((r) => r.id === champion.id);
  return since < 0 ? 0 : Math.max(0, next - Math.max(since, 1));
}

/**
 * Плитка вибору кількості. Число велике, бо воно тут головне.
 */
function SizeTile({
  size,
  index,
  all,
  onPick,
}: {
  size: number;
  index: number;
  /** Остання плитка — це вся наявна добірка, а не круглий варіант. */
  all?: boolean;
  onPick: () => void;
}) {
  const real = size;
  const capped = Boolean(all);

  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.2) }}
      whileTap={{ scale: 0.97 }}
      onClick={onPick}
      className={`flex aspect-square flex-col justify-between rounded-xl3 border p-4 text-left ${
        capped ? "border-line bg-surface-2/60" : "border-line bg-surface"
      }`}
      style={
        capped
          ? undefined
          : {
              backgroundImage:
                "radial-gradient(circle at 100% 0%, color-mix(in oklab, var(--brand) 14%, transparent), transparent 62%)",
            }
      }
    >
      <span className="font-display text-[40px] font-extrabold leading-none">
        {real}
      </span>
      <span>
        <span className="block text-[13px] font-bold">
          {plural(real, "страва", "страви", "страв")}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
          {capped
            ? `усі, що є · ${real - 1} ${plural(real - 1, "вибір", "вибори", "виборів")}`
            : `${real - 1} ${plural(real - 1, "вибір", "вибори", "виборів")}`}
        </span>
      </span>
    </motion.button>
  );
}

function Contender({
  recipe,
  picked,
  onPick,
  align,
  crown,
}: {
  recipe: Recipe;
  picked: string | null;
  onPick: () => void;
  align: "top" | "bottom";
  /** Чинний переможець — той, хто вже когось побив. */
  crown?: boolean;
}) {
  const isWinner = picked === recipe.id;
  const isLoser = picked !== null && !isWinner;

  return (
    <motion.button
      layout
      onClick={onPick}
      whileTap={{ scale: 0.97 }}
      animate={{
        scale: isWinner ? 1.02 : isLoser ? 0.94 : 1,
        opacity: isLoser ? 0.35 : 1,
      }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      className={`relative flex-1 overflow-hidden rounded-xl3 border text-left ${
        isWinner ? "border-brand" : "border-line"
      } bg-surface`}
    >
      <RecipeMedia
        recipe={recipe}
        className="absolute inset-0 h-full w-full"
        rounded="rounded-none"
        emojiSize="text-7xl"
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(to ${align === "top" ? "top" : "bottom"}, rgba(0,0,0,.82), rgba(0,0,0,.15))`,
        }}
      />
      <div
        className={`relative flex h-full min-h-[150px] flex-col p-4 ${align === "top" ? "justify-end" : "justify-start"}`}
      >
        <h3 className="font-display text-[18px] font-extrabold leading-tight text-white">
          {recipe.title}
        </h3>
        <p className="mt-1 text-[12px] font-semibold text-white/75">
          {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
        </p>
      </div>

      {crown && !picked && (
        <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
          тримає першість
        </span>
      )}

      <AnimatePresence>
        {isWinner && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full brand-gradient text-brand-ink"
          >
            <Trophy size={18} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function ChampionScreen({
  champion,
  beaten,
  onRestart,
}: {
  champion: Recipe;
  beaten: number;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center px-4 pt-8">
      <motion.div
        initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="text-6xl"
      >
        🏆
      </motion.div>
      <h2 className="mt-3 font-display text-xl font-extrabold">Перемогла всіх</h2>
      <p className="mt-1 text-center text-[13px] text-muted">
        Ця страва встояла проти {beaten} {plural(beaten, "суперниці", "суперниць", "суперниць")} —
        сумнівів більше немає.
      </p>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="mt-6 w-full overflow-hidden rounded-xl3 border border-brand/30 bg-surface"
      >
        <RecipeMedia
          recipe={champion}
          className="aspect-[16/10] w-full"
          rounded="rounded-none"
          emojiSize="text-7xl"
        />
        <div className="p-4">
          <h3 className="font-display text-[18px] font-extrabold leading-tight">{champion.title}</h3>
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
            {champion.description}
          </p>
          <div className="mt-4 flex gap-2">
            <Link href={`/recipe/${champion.id}`} className="flex-1">
              <Button variant="secondary" full>
                Рецепт
              </Button>
            </Link>
            <Link href={`/recipe/${champion.id}/cook`} className="flex-1">
              <Button full>Готувати</Button>
            </Link>
          </div>
        </div>
      </motion.div>

      <Button variant="ghost" full className="mt-4" onClick={onRestart}>
        <RotateCw size={16} />
        Ще одна дуель
      </Button>
    </div>
  );
}
