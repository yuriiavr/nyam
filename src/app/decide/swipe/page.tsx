"use client";

import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { Bookmark, Clock, Heart, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { RecipeMedia, RecipeRow } from "@/components/RecipeCard";
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
import { cn, formatMinutes, haptic, shuffle } from "@/lib/utils";

export default function SwipePage() {
  const myRecipes = useApp((s) => s.myRecipes);
  const saved = useApp((s) => s.saved);
  const following = useApp((s) => s.following);
  const cooked = useApp((s) => s.cooked);
  const dismissed = useApp((s) => s.dismissed);
  const wishlist = useApp((s) => s.wishlist);
  const toggleWish = useApp((s) => s.toggleWish);
  const toggleSave = useApp((s) => s.toggleSave);
  const dismiss = useApp((s) => s.dismiss);
  const undismiss = useApp((s) => s.undismiss);
  const clearDismissed = useApp((s) => s.clearDismissed);
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const [filters, setFilters] = useState<Filters>({ ...emptyFilters, pool: "community" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [deck, setDeck] = useState<Recipe[]>([]);
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState<Recipe[]>([]);
  const [flyOut, setFlyOut] = useState<"left" | "right" | null>(null);

  const pool = useMemo(
    () =>
      hydrated
        ? applyFilters(useApp.getState(), filters, suggestable(useApp.getState()))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, filters, myRecipes, following, saved, cooked],
  );

  useEffect(() => {
    setDeck(shuffle(pool.filter((r) => !dismissed.includes(r.id))));
    setIndex(0);
    setLiked([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length, filters]);

  const current = deck[index];
  const next = deck[index + 1];
  const third = deck[index + 2];

  const decide = (dir: "left" | "right") => {
    if (!current) return;
    haptic(dir === "right" ? [14, 30, 14] : 10);
    setFlyOut(dir);

    if (dir === "right") {
      toggleWish(current.id);
      setLiked((prev) => [current, ...prev]);
    } else {
      dismiss(current.id);
    }

    setTimeout(() => {
      setFlyOut(null);
      setIndex((i) => i + 1);
    }, 220);
  };

  const undo = () => {
    if (index === 0) return;
    haptic(10);
    const prev = deck[index - 1];
    undismiss(prev.id);
    if (wishlist.includes(prev.id)) toggleWish(prev.id);
    setLiked((l) => l.filter((r) => r.id !== prev.id));
    setIndex((i) => i - 1);
  };

  const restart = () => {
    haptic(12);
    clearDismissed();
    setDeck(shuffle(pool));
    setIndex(0);
    setLiked([]);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        title="Свайп страв"
        right={
          <>
            <span className="shrink-0 text-[12px] font-bold text-faint">
              {current ? `${deck.length - index} попереду` : "Готово"}
            </span>
            <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
          </>
        }
      />

      {!hydrated ? (
        <div className="flex-1" />
      ) : !current ? (
        <FinishScreen liked={liked} onRestart={restart} />
      ) : (
        <>
          <div className="relative mx-auto mt-1 h-[62vh] w-full max-w-[420px] px-4">
            {third && <StackCard recipe={third} depth={2} key={`d2-${third.id}`} />}
            {next && <StackCard recipe={next} depth={1} key={`d1-${next.id}`} />}
            <SwipeCard
              key={current.id}
              recipe={current}
              flyOut={flyOut}
              onDecide={decide}
              onSave={() => {
                toggleSave(current.id);
                toast("Збережено в галерею", "🔖");
              }}
            />
          </div>

          <div className="mx-auto mt-5 flex w-full max-w-[420px] items-center gap-2 px-4">
            <ActionBtn onClick={() => decide("left")} className="flex-1 bg-surface-2 text-muted">
              <X size={20} strokeWidth={2.4} />
              Не зараз
            </ActionBtn>
            <ActionBtn
              onClick={undo}
              disabled={index === 0}
              label="Повернути попередню"
              className="w-[52px] shrink-0 bg-surface-2 text-muted"
            >
              <RotateCcw size={18} />
            </ActionBtn>
            <ActionBtn
              onClick={() => {
                toggleSave(current.id);
                haptic(12);
                toast("Збережено в галерею", "🔖");
              }}
              label="Зберегти"
              className="w-[52px] shrink-0 bg-surface-2 text-brand"
            >
              <Bookmark size={18} />
            </ActionBtn>
            <ActionBtn onClick={() => decide("right")} className="flex-1 brand-gradient text-brand-ink">
              <Heart size={19} className="fill-current" />
              Хочу
            </ActionBtn>
          </div>

          <p className="mt-3 px-8 pb-4 text-center text-[11.5px] font-semibold leading-snug text-faint">
            Гортай вправо, якщо хочеш це приготувати. Уподобані страви потраплять у список
            «хочу приготувати».
          </p>
        </>
      )}

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

/* ── Картки ───────────────────────────────────────────────────────────── */

function SwipeCard({
  recipe,
  flyOut,
  onDecide,
  onSave,
}: {
  recipe: Recipe;
  flyOut: "left" | "right" | null;
  onDecide: (dir: "left" | "right") => void;
  onSave: () => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-16, 16]);
  const likeOpacity = useTransform(x, [40, 150], [0, 1]);
  const nopeOpacity = useTransform(x, [-150, -40], [1, 0]);

  const handleEnd = (_: unknown, info: PanInfo) => {
    const power = info.offset.x + info.velocity.x * 0.18;
    if (power > 140) onDecide("right");
    else if (power < -140) onDecide("left");
  };

  return (
    <motion.div
      data-no-pull
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleEnd}
      style={{ x, rotate }}
      animate={
        flyOut
          ? { x: flyOut === "right" ? 520 : -520, opacity: 0, transition: { duration: 0.22 } }
          : {}
      }
      className="absolute inset-0 cursor-grab touch-pan-y overflow-hidden rounded-[12px] border border-line bg-surface active:cursor-grabbing"
    >
      <RecipeMedia recipe={recipe} className="h-[62%] w-full" rounded="rounded-none" emojiSize="text-8xl" />

      <motion.div
        style={{ opacity: likeOpacity }}
        className="pointer-events-none absolute left-4 top-4 rotate-[-12deg] rounded-[10px] border-[3px] border-brand bg-[rgb(8_8_10_/_0.55)] px-3.5 py-1"
      >
        <span className="font-display text-[22px] font-bold text-brand">ХОЧУ</span>
      </motion.div>
      <motion.div
        style={{ opacity: nopeOpacity }}
        className="pointer-events-none absolute right-4 top-4 rotate-[12deg] rounded-[10px] border-[3px] border-berry bg-[rgb(8_8_10_/_0.55)] px-3.5 py-1"
      >
        <span className="font-display text-[22px] font-bold text-berry">НЕ ЗАРАЗ</span>
      </motion.div>

      <div className="flex h-[38%] flex-col border-t border-line px-3.5 pb-3.5 pt-3">
        <div className="flex items-start gap-2">
          <h2 className="flex-1 text-[18px] font-extrabold leading-tight">{recipe.title}</h2>
          <button
            onClick={onSave}
            aria-label="Зберегти"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-surface-2 active:bg-line"
          >
            <Bookmark size={16} />
          </button>
        </div>
        <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-muted">
          {recipe.description}
        </p>
        <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
          <Pill>
            <Clock size={11} />
            {formatMinutes(recipe.timeMin)}
          </Pill>
          <Pill>{recipe.cuisine}</Pill>
          {recipe.tags.slice(0, 2).map((t) => (
            <Pill key={t}>{t}</Pill>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function StackCard({ recipe, depth }: { recipe: Recipe; depth: number }) {
  return (
    <motion.div
      initial={false}
      animate={{ scale: 1 - depth * 0.05, y: depth * 14, opacity: 1 - depth * 0.25 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="absolute inset-0 overflow-hidden rounded-[12px] border border-line bg-surface"
    >
      <RecipeMedia recipe={recipe} className="h-[62%] w-full" rounded="rounded-none" emojiSize="text-8xl" />
      <div className="border-t border-line px-3.5 pt-3">
        <h2 className="text-[18px] font-extrabold leading-tight">{recipe.title}</h2>
      </div>
    </motion.div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-surface-2 px-2 text-[11.5px] font-bold text-muted">
      {children}
    </span>
  );
}

/** Кнопка під колодою: широка з підписом або квадратна 52×52 з іконкою. */
function ActionBtn({
  children,
  onClick,
  className,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex h-[52px] items-center justify-center gap-2 rounded-[12px] text-[15px] font-extrabold disabled:opacity-35",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

function FinishScreen({ liked, onRestart }: { liked: Recipe[]; onRestart: () => void }) {
  if (liked.length === 0) {
    return (
      <EmptyState
        emoji="🫙"
        title="Страви закінчились"
        note="Ти переглянув усе, що підходить під фільтри. Можна почати спочатку або змінити умови."
        action={<Button onClick={onRestart}>Почати заново</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5 px-4 pb-6">
      <Panel>
        <PanelHeader label="Твій вибір" tone="brand" />
        <div className="flex items-center gap-3 border-t border-line px-3.5 py-3">
          <span className="pop-in grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-brand/15 text-[21px]">
            ✨
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold leading-tight">
              Ти обрав {liked.length}{" "}
              {liked.length === 1 ? "страву" : liked.length < 5 ? "страви" : "страв"}
            </span>
            <span className="mt-0.5 block text-[12px] font-semibold text-muted">
              Усе це вже в списку «хочу приготувати».
            </span>
          </span>
        </div>
        {liked.map((r) => (
          <RecipeRow key={r.id} recipe={r} href={`/recipe/${r.id}`} flat />
        ))}
      </Panel>

      <div className="flex gap-2">
        <button
          onClick={() => {
            haptic(10);
            onRestart();
          }}
          className="h-[50px] flex-1 rounded-[10px] bg-surface-2 text-[14.5px] font-bold active:bg-line"
        >
          Ще раз
        </button>
        <Link
          href="/me?tab=wish"
          onClick={() => haptic(10)}
          className="grid h-[50px] flex-1 place-items-center rounded-[10px] brand-gradient text-[15px] font-extrabold text-brand-ink"
        >
          До списку
        </Link>
      </div>
    </div>
  );
}
