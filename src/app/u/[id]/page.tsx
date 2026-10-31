"use client";

import { motion } from "framer-motion";
import { Check, MapPin, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RecipeRow } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Avatar, Panel, PanelHeader, Segmented, useToast } from "@/components/ui";
import { allRecipes, effectiveStats, profileById, useApp } from "@/lib/store";
import { topBy } from "@/lib/matching";
import { avgRating, cn, compactNumber, formatMinutes, haptic, plural } from "@/lib/utils";

type Sort = "popular" | "new";

export default function UserPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const myProfile = useApp((s) => s.profile);
  const myRecipes = useApp((s) => s.myRecipes);
  const likes = useApp((s) => s.likes);
  const saved = useApp((s) => s.saved);
  const followingIds = useApp((s) => s.following);
  const remoteProfiles = useApp((s) => s.remoteProfiles);
  const toggleFollow = useApp((s) => s.toggleFollow);
  const toast = useToast();
  const [sort, setSort] = useState<Sort>("popular");

  const profile = useMemo(
    () => profileById(useApp.getState(), params.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.id, remoteProfiles],
  );
  const isMe = params.id === myProfile.id;

  const { recipes, totalCooks, avg } = useMemo(() => {
    const snapshot = useApp.getState();
    const list = allRecipes(snapshot).filter((r) => r.authorId === params.id);
    const stats = list.map((r) => effectiveStats(snapshot, r));
    const cooks = stats.reduce((sum, s) => sum + s.cooks, 0);
    const rated = list
      .map((r) => avgRating({ ...r, stats: effectiveStats(useApp.getState(), r) }))
      .filter((v) => v > 0);
    return {
      recipes: topBy(useApp.getState(), list, sort === "popular" ? "popular" : "new"),
      totalCooks: cooks,
      avg: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, sort, myRecipes, likes, saved]);

  useEffect(() => {
    if (isMe) router.replace("/me");
  }, [isMe, router]);

  if (isMe) return <div className="min-h-dvh" />;

  const following = followingIds.includes(profile.id);

  return (
    <div className="pb-8">
      {/* Імʼя лишається в шапці: вона липка, і поки гортаєш рецепти, видно, чиї вони. */}
      <TopBar title={profile.name} />

      <div className="flex flex-col gap-2.5 px-4">
        {/* Шапка профілю */}
        <Panel>
          <div className="flex items-center gap-3.5 p-3.5">
            <Avatar emoji={profile.emoji} gradient={profile.gradient} src={profile.avatar} size={64} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-display text-[17px] font-bold leading-tight">{profile.name}</h2>
              <p className="truncate text-[12.5px] font-semibold text-faint">@{profile.handle}</p>
              {profile.city && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] font-semibold text-faint">
                  <MapPin size={11} className="shrink-0" />
                  {profile.city}
                </p>
              )}
              {profile.bio && <p className="mt-1 text-[12.5px] leading-[1.4] text-muted">{profile.bio}</p>}
            </div>
          </div>

          <div className="grid grid-cols-4 border-t border-line">
            <Stat
              value={compactNumber(profile.followers + (following ? 1 : 0))}
              label="підписників"
              href={`/u/${params.id}/followers`}
              first
            />
            <Stat value={String(recipes.length)} label="рецептів" />
            <Stat value={compactNumber(totalCooks)} label="приготувань" />
            <Stat value={avg > 0 ? avg.toFixed(1) : "—"} label="рейтинг" accent={avg > 0} />
          </div>

          <div className="border-t border-line p-3">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                haptic(10);
                toggleFollow(profile.id);
                toast(following ? "Ви відписались" : `Тепер ви стежите за ${profile.name}`, "👋");
              }}
              className={cn(
                "flex h-11 w-full items-center justify-center gap-1.5 rounded-[10px] text-[14px] font-extrabold transition-colors",
                following ? "bg-surface-2 text-muted" : "brand-gradient text-brand-ink",
              )}
            >
              {following ? <Check size={16} strokeWidth={2.6} /> : <UserPlus size={16} strokeWidth={2.4} />}
              {following ? "Ви підписані" : "Підписатись"}
            </motion.button>
          </div>
        </Panel>

        {/* Рецепти */}
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: "popular", label: "Популярні" },
            { value: "new", label: "Нові" },
          ]}
        />

        <Panel>
          <PanelHeader
            label="Рецепти"
            aside={`${recipes.length} ${plural(recipes.length, "штука", "штуки", "штук")}`}
          />
          {recipes.length === 0 ? (
            <div className="border-t border-line px-3.5 py-9 text-center">
              <p className="text-[13.5px] font-bold text-muted">Тут поки порожньо</p>
              <p className="mt-1 text-[12.5px] font-semibold text-faint">Цей кухар ще нічого не опублікував.</p>
            </div>
          ) : (
            recipes.map((r, i) => {
              const rating = avgRating({ ...r, stats: effectiveStats(useApp.getState(), r) });
              return (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                >
                  <RecipeRow
                    flat
                    recipe={r}
                    href={`/recipe/${r.id}`}
                    subtitle={
                      <>
                        {formatMinutes(r.timeMin)}
                        {r.cuisine ? ` · ${r.cuisine}` : ""}
                        {rating > 0 && (
                          <>
                            {" · "}
                            <span className="text-brand-2">★</span> {rating.toFixed(1).replace(".", ",")}
                          </>
                        )}
                      </>
                    }
                  />
                </motion.div>
              );
            })
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Клітинка статистики, як у власному профілі. */
function Stat({
  value,
  label,
  href,
  accent,
  first,
}: {
  value: string;
  label: string;
  /** Якщо задано — клітинка веде на окремий екран (напр. список підписників). */
  href?: string;
  accent?: boolean;
  first?: boolean;
}) {
  const cls = cn("flex min-w-0 flex-col items-center gap-0.5 py-2.5", !first && "border-l border-line");
  const body = (
    <>
      <span className={cn("font-display text-[16px] font-bold leading-tight", accent && "text-brand")}>{value}</span>
      <span className="max-w-full truncate px-1 text-[11px] font-semibold text-faint">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cn(cls, "active:bg-surface-2")}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}
