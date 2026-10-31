"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { Bookmark, ChevronRight, Clock, Heart } from "lucide-react";
import { useApp, effectiveStats, profileById } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { avgRating, cn, compactNumber, formatMinutes, haptic, timeAgo } from "@/lib/utils";
import { Avatar } from "./ui";

/* ── Медіа страви: фото або стилізований градієнт з емодзі ───────────── */

export function RecipeMedia({
  recipe,
  className,
  emojiSize = "text-6xl",
  rounded = "rounded-[10px]",
}: {
  recipe: Recipe;
  className?: string;
  emojiSize?: string;
  rounded?: string;
}) {
  return (
    <div
      className={cn("relative overflow-hidden bg-surface-2", rounded, className)}
      style={
        recipe.image
          ? undefined
          : {
              backgroundImage: `linear-gradient(140deg, ${recipe.gradient[0]}, ${recipe.gradient[1]})`,
            }
      }
    >
      {recipe.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={recipe.image}
          alt={recipe.title}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <>
          <div
            aria-hidden
            className="absolute inset-0 opacity-30 mix-blend-overlay"
            style={{
              backgroundImage:
                "radial-gradient(circle at 25% 15%, rgba(255,255,255,.75), transparent 45%)",
            }}
          />
          <div className="absolute inset-0 grid place-items-center">
            <span className={cn("drop-shadow-lg", emojiSize)}>{recipe.emoji}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Велика картка стрічки ────────────────────────────────────────────── */

export function FeedCard({ recipe }: { recipe: Recipe }) {
  /*
   * Картка малюється списками по десятку за раз, тож підписка тут коштує
   * найдорожче: з `useApp()` кожна картка стрічки перемальовувалась від
   * будь-якої зміни в застосунку — від кількості солі в коморі теж.
   */
  const likes = useApp((s) => s.likes);
  const saves = useApp((s) => s.saved);
  const cooked = useApp((s) => s.cooked);
  const ratings = useApp((s) => s.ratings);
  const remoteProfiles = useApp((s) => s.remoteProfiles);
  const toggleLike = useApp((s) => s.toggleLike);
  const toggleSave = useApp((s) => s.toggleSave);

  // У локальному режимі лічильники враховують власні дії, тож перелічуємо їх
  // при кожній зміні того, що туди входить.
  const stats = useMemo(
    () => effectiveStats(useApp.getState(), recipe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recipe, likes, saves, cooked, ratings],
  );
  const author = useMemo(
    () => profileById(useApp.getState(), recipe.authorId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recipe.authorId, remoteProfiles],
  );
  const liked = likes.includes(recipe.id);
  const saved = saves.includes(recipe.id);
  const rating = avgRating({ ...recipe, stats });

  return (
    <article className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <Link href={`/u/${author.id}`} className="flex h-[52px] items-center gap-2.5 px-3.5">
        <Avatar emoji={author.emoji} gradient={author.gradient} src={author.avatar} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold leading-tight">{author.name}</p>
          <p className="truncate text-[11.5px] font-semibold text-faint">
            @{author.handle} · {timeAgo(recipe.createdAt)}
          </p>
        </div>
        <span className="flex h-[22px] shrink-0 items-center rounded-[5px] bg-surface-2 px-[7px] text-[10.5px] font-bold text-muted">
          {recipe.sourceId ? "збережено собі" : recipe.cuisine}
        </span>
      </Link>

      <Link href={`/recipe/${recipe.id}`} className="block border-t border-line">
        <div className="relative">
          <RecipeMedia recipe={recipe} className="h-[220px] w-full" rounded="rounded-none" emojiSize="text-[76px]" />
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex flex-wrap gap-1.5">
            <Badge>{formatMinutes(recipe.timeMin)}</Badge>
            {rating > 0 && <Badge>★ {rating.toFixed(1).replace(".", ",")}</Badge>}
          </div>
        </div>

        <div className="flex flex-col gap-1 px-3.5 pb-1 pt-3">
          <h3 className="font-display text-[15px] font-bold leading-[1.3]">{recipe.title}</h3>
          {recipe.description && (
            <p className="line-clamp-2 text-[13px] leading-[1.45] text-muted">{recipe.description}</p>
          )}
        </div>
      </Link>

      <div className="flex h-12 items-center gap-1 px-2">
        <ActionButton
          active={liked}
          activeClass="text-berry"
          onClick={() => {
            haptic(14);
            toggleLike(recipe.id);
          }}
          icon={<Heart size={18} className={liked ? "fill-current" : ""} />}
          label={compactNumber(stats.likes)}
        />
        <ActionButton
          active={saved}
          activeClass="text-brand"
          onClick={() => {
            haptic(14);
            toggleSave(recipe.id);
          }}
          icon={<Bookmark size={18} className={saved ? "fill-current" : ""} />}
        />
        <span className="ml-auto pr-1.5 text-[11.5px] font-semibold text-faint">
          {stats.cooks > 0 ? `${compactNumber(stats.cooks)} готували` : `${recipe.servings} порц.`}
        </span>
      </div>
    </article>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-6 items-center rounded-[6px] bg-[rgb(12_12_13_/_0.75)] px-2 text-[11.5px] font-bold text-white">
      {children}
    </span>
  );
}

/** Бейдж на фото плитки: «★ 4,9», «#1». */
export function TileBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-5 items-center gap-[3px] rounded-[6px] bg-[rgb(8_8_10_/_0.6)] px-[7px] text-[10.5px] font-extrabold text-white backdrop-blur-md",
        className,
      )}
    >
      {children}
    </span>
  );
}

function ActionButton({
  active,
  activeClass,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  activeClass: string;
  onClick: () => void;
  icon: React.ReactNode;
  label?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.86 }}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-bold transition-colors",
        active ? activeClass : "text-muted",
      )}
    >
      {icon}
      {label}
    </motion.button>
  );
}

/* ── Плитка для сітки ─────────────────────────────────────────────────── */

export function RecipeTile({
  recipe,
  badge,
  rounded = "rounded-[10px]",
}: {
  recipe: Recipe;
  badge?: React.ReactNode;
  rounded?: string;
}) {
  // Лічильники живуть у самому рецепті; підписка потрібна лише щоб плитка
  // перемалювалась, коли вони змінились.
  const remoteRecipes = useApp((s) => s.remoteRecipes);
  const myRecipes = useApp((s) => s.myRecipes);
  const stats = useMemo(
    () => effectiveStats(useApp.getState(), recipe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recipe, remoteRecipes, myRecipes],
  );
  const rating = avgRating({ ...recipe, stats });

  return (
    <Link href={`/recipe/${recipe.id}`} className="group flex min-w-0 flex-col gap-2">
      <motion.div whileTap={{ scale: 0.97 }} className="relative">
        <RecipeMedia recipe={recipe} className="aspect-square w-full" rounded={rounded} emojiSize="text-[50px]" />
        {badge && <div className="absolute left-[7px] top-[7px]">{badge}</div>}
        {rating > 0 && (
          <TileBadge className="absolute right-[7px] top-[7px]">
            <span className="text-brand-2">★</span>
            {rating.toFixed(1).replace(".", ",")}
          </TileBadge>
        )}
      </motion.div>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <h4 className="truncate text-[13px] font-bold leading-tight">{recipe.title}</h4>
        <p className="truncate text-[11.5px] font-semibold text-faint">
          {formatMinutes(recipe.timeMin)}
          {recipe.cuisine ? ` · ${recipe.cuisine}` : ""}
        </p>
      </div>
    </Link>
  );
}

/* ── Компактний горизонтальний рядок ──────────────────────────────────── */

export function RecipeRow({
  recipe,
  right,
  subtitle,
  href,
  onClick,
  flat,
}: {
  recipe: Recipe;
  right?: React.ReactNode;
  subtitle?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  /** Рядок усередині панелі: без власної рамки, з лінією зверху і стрілкою. */
  flat?: boolean;
}) {
  const inner = (
    <motion.div
      whileTap={flat ? undefined : { scale: 0.98 }}
      className={
        flat
          ? "flex h-16 items-center gap-3 border-t border-line px-3.5 active:bg-surface-2"
          : "flex items-center gap-3 rounded-[10px] border border-line bg-surface p-2.5"
      }
    >
      <RecipeMedia
        recipe={recipe}
        className="h-11 w-11 shrink-0"
        rounded="rounded-[8px]"
        emojiSize="text-[22px]"
      />
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-[14px] font-bold leading-tight">{recipe.title}</h4>
        <div className="mt-0.5 truncate text-[12px] font-semibold text-faint">
          {subtitle ?? (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} />
              {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
            </span>
          )}
        </div>
      </div>
      {right ?? (flat && <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-faint" />)}
    </motion.div>
  );

  if (href) return <Link href={href} className="block">{inner}</Link>;
  return (
    <button onClick={onClick} className="w-full text-left">
      {inner}
    </button>
  );
}

/* ── Горизонтальна карусель ───────────────────────────────────────────── */

export function RecipeScroller({
  recipes,
  renderBadge,
}: {
  recipes: Recipe[];
  renderBadge?: (r: Recipe, i: number) => React.ReactNode;
}) {
  return (
    <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-3.5 pb-3.5 pt-3">
      {recipes.map((r, i) => (
        <div key={r.id} className="w-[136px] shrink-0">
          <RecipeTile recipe={r} badge={renderBadge?.(r, i)} rounded="rounded-[8px]" />
        </div>
      ))}
    </div>
  );
}
