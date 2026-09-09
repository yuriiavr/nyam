"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Bookmark, Clock, Flame, Heart, Star, Users } from "lucide-react";
import { useApp, effectiveStats, profileById } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { avgRating, cn, compactNumber, formatMinutes, haptic, timeAgo } from "@/lib/utils";
import { Avatar } from "./ui";

/* ── Медіа страви: фото або стилізований градієнт з емодзі ───────────── */

export function RecipeMedia({
  recipe,
  className,
  emojiSize = "text-6xl",
  rounded = "rounded-xl3",
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
  const state = useApp();
  const author = profileById(state, recipe.authorId);
  const stats = effectiveStats(state, recipe);
  const liked = state.likes.includes(recipe.id);
  const saved = state.saved.includes(recipe.id);
  const rating = avgRating({ ...recipe, stats });

  return (
    <article className="overflow-hidden rounded-xl3 border border-line bg-surface shadow-[var(--shadow-card)]">
      <Link href={`/u/${author.id}`} className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <Avatar emoji={author.emoji} gradient={author.gradient} src={author.avatar} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold leading-tight">{author.name}</p>
          <p className="truncate text-[11px] text-muted">
            @{author.handle} · {timeAgo(recipe.createdAt)}
          </p>
        </div>
        {recipe.sourceId && (
          <span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-bold text-muted">
            збережено собі
          </span>
        )}
      </Link>

      <Link href={`/recipe/${recipe.id}`} className="block">
        <div className="relative px-3.5">
          <RecipeMedia recipe={recipe} className="aspect-[4/3] w-full" emojiSize="text-7xl" />
          <div className="pointer-events-none absolute inset-x-3.5 bottom-0 flex flex-wrap gap-1.5 p-3">
            <Badge icon={<Clock size={11} />}>{formatMinutes(recipe.timeMin)}</Badge>
            {rating > 0 && (
              <Badge icon={<Star size={11} className="fill-current" />}>{rating.toFixed(1)}</Badge>
            )}
            <Badge icon={<Flame size={11} />}>{compactNumber(stats.cooks)} готували</Badge>
          </div>
        </div>

        <div className="px-4 pt-3">
          <h3 className="font-display text-[17px] font-bold leading-snug">{recipe.title}</h3>
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
            {recipe.description}
          </p>
        </div>
      </Link>

      <div className="flex items-center gap-1 px-2.5 py-2.5">
        <ActionButton
          active={liked}
          activeClass="text-berry"
          onClick={() => {
            haptic(14);
            state.toggleLike(recipe.id);
          }}
          icon={<Heart size={18} className={liked ? "fill-current" : ""} />}
          label={compactNumber(stats.likes)}
        />
        <ActionButton
          active={saved}
          activeClass="text-brand"
          onClick={() => {
            haptic(14);
            state.toggleSave(recipe.id);
          }}
          icon={<Bookmark size={18} className={saved ? "fill-current" : ""} />}
          label={compactNumber(stats.saves)}
        />
        <div className="ml-auto flex items-center gap-1.5 pr-2 text-[11px] text-muted">
          <Users size={13} />
          {recipe.servings} порц.
        </div>
      </div>
    </article>
  );
}

function Badge({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-ink">
      {icon}
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
  label: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.86 }}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-2xl px-3 py-2 text-[12px] font-bold transition-colors",
        active ? activeClass : "text-muted",
      )}
    >
      {icon}
      {label}
    </motion.button>
  );
}

/* ── Плитка для сітки ─────────────────────────────────────────────────── */

export function RecipeTile({ recipe, badge }: { recipe: Recipe; badge?: React.ReactNode }) {
  const state = useApp();
  const stats = effectiveStats(state, recipe);
  const rating = avgRating({ ...recipe, stats });

  return (
    <Link href={`/recipe/${recipe.id}`} className="group block">
      <motion.div whileTap={{ scale: 0.97 }} className="relative">
        <RecipeMedia recipe={recipe} className="aspect-square w-full" emojiSize="text-5xl" />
        {badge && <div className="absolute left-2 top-2">{badge}</div>}
        <div className="absolute right-2 top-2">
          {rating > 0 && (
            <span className="glass inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold">
              <Star size={9} className="fill-brand-2 text-brand-2" />
              {rating.toFixed(1)}
            </span>
          )}
        </div>
      </motion.div>
      <div className="pt-2">
        <h4 className="line-clamp-2 text-[13px] font-bold leading-tight">{recipe.title}</h4>
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted">
          <Clock size={11} />
          {formatMinutes(recipe.timeMin)}
          <span className="mx-0.5">·</span>
          <Flame size={11} />
          {compactNumber(stats.cooks)}
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
}: {
  recipe: Recipe;
  right?: React.ReactNode;
  subtitle?: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-2.5"
    >
      <RecipeMedia
        recipe={recipe}
        className="h-14 w-14 shrink-0"
        rounded="rounded-2xl"
        emojiSize="text-2xl"
      />
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-[14px] font-bold leading-tight">{recipe.title}</h4>
        <div className="mt-0.5 truncate text-[11.5px] text-muted">
          {subtitle ?? (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} />
              {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
            </span>
          )}
        </div>
      </div>
      {right}
    </motion.div>
  );

  if (href) return <Link href={href}>{inner}</Link>;
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
    <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
      {recipes.map((r, i) => (
        <div key={r.id} className="w-[148px] shrink-0">
          <RecipeTile recipe={r} badge={renderBadge?.(r, i)} />
        </div>
      ))}
    </div>
  );
}
