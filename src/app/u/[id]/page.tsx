"use client";

import { motion } from "framer-motion";
import { Flame, MapPin, Star, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RecipeTile } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Avatar, Button, EmptyState, Segmented, useToast } from "@/components/ui";
import { allRecipes, effectiveStats, profileById, useApp } from "@/lib/store";
import { topBy } from "@/lib/matching";
import { avgRating, compactNumber, plural } from "@/lib/utils";

type Sort = "popular" | "new";

export default function UserPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const state = useApp();
  const toast = useToast();
  const [sort, setSort] = useState<Sort>("popular");

  const profile = profileById(state, params.id);
  const isMe = params.id === state.profile.id;

  const { recipes, totalCooks, avg } = useMemo(() => {
    const list = allRecipes(state).filter((r) => r.authorId === params.id);
    const stats = list.map((r) => effectiveStats(state, r));
    const cooks = stats.reduce((sum, s) => sum + s.cooks, 0);
    const rated = list
      .map((r) => avgRating({ ...r, stats: effectiveStats(state, r) }))
      .filter((v) => v > 0);
    return {
      recipes: topBy(state, list, sort === "popular" ? "popular" : "new"),
      totalCooks: cooks,
      avg: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, sort, state.myRecipes, state.likes, state.saved]);

  useEffect(() => {
    if (isMe) router.replace("/me");
  }, [isMe, router]);

  if (isMe) return <div className="min-h-dvh" />;

  const following = state.following.includes(profile.id);

  return (
    <div className="pb-8">
      <TopBar title={profile.name} subtitle={`@${profile.handle}`} />

      {/* Шапка профілю */}
      <section className="px-4 pt-4">
        <div
          className="overflow-hidden rounded-xl3 border border-line bg-surface"
          style={{
            backgroundImage: `linear-gradient(140deg, ${profile.gradient[0]}22, transparent 60%)`,
          }}
        >
          <div className="flex items-center gap-4 p-4">
            <Avatar
              emoji={profile.emoji}
              gradient={profile.gradient}
              src={profile.avatar}
              size={72}
              ring
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-display text-[19px] font-extrabold leading-tight">
                {profile.name}
              </h2>
              <p className="truncate text-[12.5px] text-muted">@{profile.handle}</p>
              {profile.city && (
                <p className="mt-1 flex items-center gap-1 text-[12px] text-muted">
                  <MapPin size={11} />
                  {profile.city}
                </p>
              )}
            </div>
          </div>

          {profile.bio && (
            <p className="px-4 pb-3 text-[13.5px] leading-relaxed text-muted">{profile.bio}</p>
          )}

          <div className="grid grid-cols-4 gap-px border-t border-line bg-line">
            <MiniStat
              icon={<Users size={13} />}
              value={compactNumber(profile.followers + (following ? 1 : 0))}
              label="підписників"
              href={`/u/${params.id}/followers`}
            />
            <MiniStat value={String(recipes.length)} label="рецептів" />
            <MiniStat
              icon={<Flame size={13} />}
              value={compactNumber(totalCooks)}
              label="приготувань"
            />
            <MiniStat
              icon={<Star size={13} />}
              value={avg > 0 ? avg.toFixed(1) : "—"}
              label="рейтинг"
            />
          </div>

          <div className="p-3">
            <Button
              full
              variant={following ? "secondary" : "primary"}
              onClick={() => {
                state.toggleFollow(profile.id);
                toast(following ? "Ви відписались" : `Тепер ви стежите за ${profile.name}`, "👋");
              }}
            >
              {following ? "Ви підписані" : "Підписатись"}
            </Button>
          </div>
        </div>
      </section>

      {/* Рецепти */}
      <section className="px-4 pt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-[17px] font-bold">
            Рецепти · {recipes.length} {plural(recipes.length, "штука", "штуки", "штук")}
          </h2>
        </div>

        <Segmented
          value={sort}
          onChange={setSort}
          className="mb-4"
          options={[
            { value: "popular", label: "Популярні" },
            { value: "new", label: "Нові" },
          ]}
        />

        {recipes.length === 0 ? (
          <EmptyState emoji="🍽️" title="Тут поки порожньо" note="Цей кухар ще нічого не опублікував." />
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-5">
            {recipes.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
              >
                <RecipeTile recipe={r} />
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MiniStat({
  icon,
  value,
  label,
  href,
}: {
  icon?: React.ReactNode;
  value: string;
  label: string;
  /** Якщо задано — клітинка веде на окремий екран (напр. список підписників). */
  href?: string;
}) {
  const body = (
    <>
      <p className="flex items-center justify-center gap-1 font-display text-[15px] font-extrabold leading-none">
        {icon && <span className="text-brand">{icon}</span>}
        {value}
      </p>
      <p className="mt-1 truncate text-[10px] text-muted">{label}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="bg-surface px-1 py-2.5 text-center active:bg-surface-2">
        {body}
      </Link>
    );
  }
  return <div className="bg-surface px-1 py-2.5 text-center">{body}</div>;
}
