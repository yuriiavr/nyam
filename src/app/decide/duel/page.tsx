"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RotateCw, Swords, Trophy } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, EmptyState, Panel, PanelHeader, useToast } from "@/components/ui";
import {
  activeFilterCount,
  applyFilters,
  emptyFilters,
  suggestable,
  type Filters,
} from "@/lib/matching";
import { useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { cn, formatMinutes, haptic, plural, shuffle } from "@/lib/utils";

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
          right={
            <>
              <span className="shrink-0 text-[12px] font-bold text-faint">
                {pool.length} {plural(pool.length, "страва", "страви", "страв")}
              </span>
              <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
            </>
          }
        />

        <div className="flex flex-col gap-2.5 px-4">
          <Panel>
            <PanelHeader label="Скільки страв" tone="brand" icon={<Swords size={13} strokeWidth={2.4} />} />
            <div className="border-t border-line px-3.5 py-3">
              <p className="text-[14px] font-extrabold leading-snug">Переможець лишається, поки його не поб'ють</p>
              <p className="mt-1 text-[12.5px] font-semibold leading-snug text-muted">
                Скільки страв пустимо в дуель? Кожна виходить по черзі проти чинного переможця —
                вибирати доведеться на одну менше разів, ніж страв.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
              {sizeOptions(pool.length).map((size, i, all) => (
                <SizeTile
                  key={size}
                  size={size}
                  index={i}
                  all={i === all.length - 1 && size === pool.length}
                  // Непарна плитка в кінці розтягується: інакше в сітці лишилась би порожня клітинка.
                  wide={all.length % 2 === 1 && i === all.length - 1}
                  onPick={() => start(size)}
                />
              ))}
            </div>
          </Panel>

          <p className="px-0.5 text-[11.5px] font-semibold leading-snug text-faint">
            За фільтрами зараз {pool.length} {plural(pool.length, "страва", "страви", "страв")}.
            Більше варіантів зʼявиться, коли рецептів побільшає.
          </p>
        </div>

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
        right={
          <>
            {!done && (
              <span className="shrink-0 text-[12px] font-bold text-faint">
                {next} з {lineup.length - 1}
              </span>
            )}
            <button
              onClick={() => setStage("setup")}
              className="flex h-[38px] shrink-0 items-center rounded-[10px] bg-surface-2 px-3 text-[12.5px] font-bold text-muted active:bg-line"
            >
              Заново
            </button>
          </>
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
          <div className="flex gap-1 px-4 pt-1">
            {lineup.slice(1).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-[2px] ${
                  i < next - 1 ? "bg-brand" : i === next - 1 ? "bg-brand/50" : "bg-surface-2"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 px-4 pt-3">
            <p className="text-[13.5px] font-bold">Що б ти обрав зараз?</p>
            <p className="shrink-0 text-[11.5px] font-semibold text-faint">
              вистояла {streak(lineup, champion, next)}{" "}
              {plural(streak(lineup, champion, next), "раз", "рази", "разів")}
            </p>
          </div>

          <div className="relative flex flex-1 flex-col gap-2.5 px-4 pt-2.5">
            {champion && (
              <Contender
                recipe={champion}
                picked={picked}
                onPick={() => choose(champion)}
                align="top"
                crown={streak(lineup, champion, next) > 0}
              />
            )}

            <div className="pointer-events-none absolute left-1/2 top-[calc(50%+5px)] z-10 -translate-x-1/2 -translate-y-1/2">
              <div className="grid h-12 w-12 place-items-center rounded-[12px] border-4 border-bg bg-surface-2">
                <Swords size={19} className="text-brand" />
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

          <div className="px-4 pt-2.5">
            <button
              onClick={() => {
                haptic(10);
                start(lineup.length);
                toast("Інші страви", "🔄");
              }}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[10px] bg-surface-2 text-[14px] font-bold text-muted active:bg-line"
            >
              <RotateCw size={16} />
              Інші страви
            </button>
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
  wide,
  onPick,
}: {
  size: number;
  index: number;
  /** Остання плитка — це вся наявна добірка, а не круглий варіант. */
  all?: boolean;
  /** На всю ширину сітки. */
  wide?: boolean;
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
      className={cn(
        "flex min-h-[112px] flex-col justify-between gap-3 bg-surface p-3.5 text-left active:bg-surface-2",
        wide && "col-span-2",
      )}
    >
      <span className={cn("font-display text-[32px] font-bold leading-none", capped ? "text-brand" : "text-ink")}>
        {real}
      </span>
      <span>
        <span className="block text-[14px] font-extrabold">
          {plural(real, "страва", "страви", "страв")}
        </span>
        <span className="mt-0.5 block text-[11.5px] font-semibold leading-snug text-faint">
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
      className={`relative flex-1 overflow-hidden rounded-[12px] border text-left ${
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
        className={`relative flex h-full min-h-[150px] flex-col p-3.5 ${align === "top" ? "justify-end" : "justify-start"}`}
      >
        <h3 className="text-[18px] font-extrabold leading-tight text-white">{recipe.title}</h3>
        <p className="mt-1 text-[12px] font-semibold text-white/75">
          {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
        </p>
      </div>

      {crown && !picked && (
        <span className="absolute right-3 top-3 flex h-6 items-center rounded-[6px] bg-[rgb(8_8_10_/_0.6)] px-2 text-[11px] font-extrabold text-white backdrop-blur-md">
          тримає першість
        </span>
      )}

      <AnimatePresence>
        {isWinner && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-[10px] brand-gradient text-brand-ink"
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
    <div className="flex flex-col gap-2.5 px-4">
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
      >
        <Panel>
          <PanelHeader
            label="Переможець визначено"
            tone="brand"
            icon={<Trophy size={13} strokeWidth={2.4} />}
          />
          <div className="flex items-center gap-3 border-t border-line px-3.5 py-3">
            <motion.span
              initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-brand/15 text-[21px]"
            >
              🏆
            </motion.span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-extrabold leading-tight">Перемогла всіх</span>
              <span className="mt-0.5 block text-[12px] font-semibold leading-snug text-muted">
                Ця страва встояла проти {beaten} {plural(beaten, "суперниці", "суперниць", "суперниць")} —
                сумнівів більше немає.
              </span>
            </span>
          </div>
          <Link
            href={`/recipe/${champion.id}`}
            className="flex items-center gap-3 border-t border-line px-3.5 py-3 active:bg-surface-2"
          >
            <RecipeMedia recipe={champion} className="h-14 w-14 shrink-0" rounded="rounded-[8px]" emojiSize="text-[28px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold">{champion.title}</span>
              <span className="block truncate text-[12px] font-semibold text-muted">
                {formatMinutes(champion.timeMin)} · {champion.cuisine}
              </span>
            </span>
            <span className="shrink-0 text-[13px] font-extrabold text-brand">Рецепт ›</span>
          </Link>
          {champion.description && (
            <p className="line-clamp-2 border-t border-line px-3.5 py-2.5 text-[13px] font-semibold leading-relaxed text-muted">
              {champion.description}
            </p>
          )}
        </Panel>
      </motion.div>

      <Link
        href={`/recipe/${champion.id}/cook`}
        onClick={() => haptic(10)}
        className="grid h-[52px] place-items-center rounded-[12px] brand-gradient text-[15.5px] font-extrabold text-brand-ink shadow-[0_14px_36px_-12px_rgb(255_107_53_/_0.6)]"
      >
        Готувати
      </Link>

      <button
        onClick={() => {
          haptic(10);
          onRestart();
        }}
        className="flex h-[50px] items-center justify-center gap-2 rounded-[10px] bg-surface-2 text-[14px] font-bold text-muted active:bg-line"
      >
        <RotateCw size={16} />
        Ще одна дуель
      </button>
    </div>
  );
}
