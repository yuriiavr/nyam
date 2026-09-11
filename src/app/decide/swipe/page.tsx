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
import { Button, EmptyState, useToast } from "@/components/ui";
import { activeFilterCount, applyFilters, emptyFilters, type Filters } from "@/lib/matching";
import { useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { formatMinutes, haptic, shuffle } from "@/lib/utils";

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
    () => (hydrated ? applyFilters(useApp.getState(), filters) : []),
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
        subtitle={current ? `${deck.length - index} попереду` : "Готово"}
        right={
          <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
        }
      />

      {!hydrated ? (
        <div className="flex-1" />
      ) : !current ? (
        <FinishScreen liked={liked} onRestart={restart} />
      ) : (
        <>
          <div className="relative mx-auto mt-4 h-[62vh] w-full max-w-[420px] px-5">
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

          <div className="mt-5 flex items-center justify-center gap-4 px-4">
            <CircleBtn onClick={() => decide("left")} className="border-line text-muted">
              <X size={26} />
            </CircleBtn>
            <CircleBtn
              onClick={undo}
              disabled={index === 0}
              className="h-12 w-12 border-line text-muted"
            >
              <RotateCcw size={18} />
            </CircleBtn>
            <CircleBtn
              onClick={() => {
                toggleSave(current.id);
                haptic(12);
                toast("Збережено в галерею", "🔖");
              }}
              className="h-12 w-12 border-brand/40 text-brand"
            >
              <Bookmark size={18} />
            </CircleBtn>
            <CircleBtn
              onClick={() => decide("right")}
              className="border-transparent brand-gradient text-brand-ink"
            >
              <Heart size={26} className="fill-current" />
            </CircleBtn>
          </div>

          <p className="mt-3 px-8 pb-4 text-center text-[12px] leading-snug text-muted">
            Гортай вправо, якщо хочеш це приготувати. Уподобані страви потраплять у список
            «хочу приготувати».
          </p>
        </>
      )}

      <FilterSheet
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
      className="absolute inset-0 cursor-grab touch-pan-y overflow-hidden rounded-xl4 border border-line bg-surface shadow-[var(--shadow-card)] active:cursor-grabbing"
    >
      <RecipeMedia recipe={recipe} className="h-[62%] w-full" rounded="rounded-none" emojiSize="text-8xl" />

      <motion.div
        style={{ opacity: likeOpacity }}
        className="pointer-events-none absolute left-5 top-5 rotate-[-12deg] rounded-2xl border-4 border-mint px-4 py-1.5"
      >
        <span className="font-display text-2xl font-extrabold text-mint">ХОЧУ</span>
      </motion.div>
      <motion.div
        style={{ opacity: nopeOpacity }}
        className="pointer-events-none absolute right-5 top-5 rotate-[12deg] rounded-2xl border-4 border-berry px-4 py-1.5"
      >
        <span className="font-display text-2xl font-extrabold text-berry">НЕ ЗАРАЗ</span>
      </motion.div>

      <div className="flex h-[38%] flex-col p-4">
        <div className="flex items-start gap-2">
          <h2 className="flex-1 font-display text-[19px] font-extrabold leading-tight">
            {recipe.title}
          </h2>
          <button
            onClick={onSave}
            aria-label="Зберегти"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-surface-2"
          >
            <Bookmark size={16} />
          </button>
        </div>
        <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
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
      className="absolute inset-0 overflow-hidden rounded-xl4 border border-line bg-surface"
    >
      <RecipeMedia recipe={recipe} className="h-[62%] w-full" rounded="rounded-none" emojiSize="text-8xl" />
      <div className="p-4">
        <h2 className="font-display text-[19px] font-extrabold leading-tight">{recipe.title}</h2>
      </div>
    </motion.div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-muted">
      {children}
    </span>
  );
}

function CircleBtn({
  children,
  onClick,
  className,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.88 }}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-16 w-16 place-items-center rounded-full border-2 bg-surface disabled:opacity-35 ${className ?? ""}`}
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
    <div className="px-4 pt-6">
      <div className="text-center">
        <div className="pop-in text-5xl">✨</div>
        <h2 className="mt-3 font-display text-xl font-extrabold">
          Ти обрав {liked.length}{" "}
          {liked.length === 1 ? "страву" : liked.length < 5 ? "страви" : "страв"}
        </h2>
        <p className="mt-1 text-[13px] text-muted">Усе це вже в списку «хочу приготувати».</p>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {liked.map((r) => (
          <RecipeRow key={r.id} recipe={r} href={`/recipe/${r.id}`} />
        ))}
      </div>

      <div className="mt-5 flex gap-2 pb-6">
        <Button variant="secondary" className="flex-1" onClick={onRestart}>
          Ще раз
        </Button>
        <Link href="/me?tab=wish" className="flex-1">
          <Button full>До списку</Button>
        </Link>
      </div>
    </div>
  );
}
