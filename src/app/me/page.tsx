"use client";

import { motion } from "framer-motion";
import { Bell, ChevronRight, Pencil, Plus, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Avatar, Button, Panel, Segmented, Sheet, TILE_BUTTON, useToast } from "@/components/ui";
import { allRecipes, cookStreak, useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { cn, formatMinutes, haptic, plural, timeAgo } from "@/lib/utils";

type Tab = "mine" | "saved" | "wish" | "history";

export default function MePage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <MeContent />
    </Suspense>
  );
}

function MeContent() {
  const params = useSearchParams();
  const profile = useApp((s) => s.profile);
  const account = useApp((s) => s.account);
  const myRecipes = useApp((s) => s.myRecipes);
  const saved = useApp((s) => s.saved);
  const wishlist = useApp((s) => s.wishlist);
  const cooked = useApp((s) => s.cooked);
  const notifications = useApp((s) => s.notifications);
  const updateProfile = useApp((s) => s.updateProfile);
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const initialTab = (params.get("tab") as Tab) ?? "mine";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState(profile.name);
  const [handle, setHandle] = useState(profile.handle);
  const [bio, setBio] = useState(profile.bio);
  const [emoji, setEmoji] = useState(profile.emoji);
  /*
   * Фото з Google чи емодзі. Знімок беремо з акаунта, а не з профілю: у
   * профілі його можна замінити емодзі, і тоді посилання зникло б, а так
   * його завжди можна обрати назад.
   */
  const googlePhoto = account?.photo ?? profile.avatar ?? null;
  const [avatar, setAvatar] = useState<string | null>(profile.avatar ?? null);

  const lists = useMemo(() => {
    if (!hydrated) return { mine: [], saved: [], wish: [], history: [] };
    const all = allRecipes(useApp.getState());
    const byId = new Map(all.map((r) => [r.id, r]));
    return {
      mine: myRecipes,
      saved: saved.map((id) => byId.get(id)).filter((r) => r != null),
      wish: wishlist.map((id) => byId.get(id)).filter((r) => r != null),
      history: cooked
        .map((c) => ({ recipe: byId.get(c.recipeId), at: c.at }))
        .filter((x) => x.recipe != null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, myRecipes, saved, wishlist, cooked]);

  const streak = hydrated ? cookStreak(useApp.getState()) : 0;

  const saveProfile = () => {
    updateProfile({
      name: name.trim() || "Мій профіль",
      handle: handle.trim().replace(/^@/, "") || "me",
      bio: bio.trim(),
      emoji,
      avatar,
    });
    toast("Профіль оновлено", "✅");
    setEditOpen(false);
  };

  const current = tab === "history" ? [] : lists[tab];

  const unread = notifications.filter((n) => !n.readAt).length;

  const rows: Array<{ key: string; recipe: Recipe; meta: string }> =
    tab === "history"
      ? lists.history.map((h, i) => ({
          key: `${h.recipe!.id}-${i}`,
          recipe: h.recipe!,
          meta: `Приготовано ${timeAgo(h.at)}`,
        }))
      : current.map((r) => ({
          key: r!.id,
          recipe: r!,
          meta: `${formatMinutes(r!.timeMin)}${r!.cuisine ? ` · ${r!.cuisine}` : ""}`,
        }));

  const emptyText =
    tab === "mine"
      ? "Ще немає своїх рецептів"
      : tab === "saved"
        ? "Зберігай рецепти закладкою — вони будуть тут"
        : tab === "wish"
          ? "Погортай свайп чи рулетку — сподобане буде тут"
          : "Приготуй щось у покроковому режимі — і страва зʼявиться тут";

  return (
    <div className="pb-8">
      <TopBar
        back={false}
        title="Профіль"
        right={
          <>
            <Link
              href="/notifications"
              aria-label={unread ? `Сповіщення, непрочитаних: ${unread}` : "Сповіщення"}
              className={cn(TILE_BUTTON, "relative")}
            >
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-[5px] bg-brand px-1 text-[10px] font-extrabold leading-none text-brand-ink">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <Link href="/settings" aria-label="Налаштування" className={TILE_BUTTON}>
              <Settings2 size={18} />
            </Link>
          </>
        }
      />

      {/*
        Планшет (lg): картка профілю — бічна колонка на 280 px, вкладки й рецепти
        сіткою в чотири колонки — праворуч.
      */}
      <div className="flex flex-col gap-2.5 px-4 md:px-6 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-4">
        <aside className="contents lg:sticky lg:top-4 lg:flex lg:flex-col lg:gap-3">
        {/* Профіль */}
        <Panel>
          <div className="flex items-center gap-3.5 p-3.5 lg:flex-col lg:gap-3 lg:px-4 lg:pb-4 lg:pt-5 lg:text-center">
            <Avatar emoji={profile.emoji} gradient={profile.gradient} src={profile.avatar} size={64} />
            <div className="min-w-0 flex-1 lg:w-full">
              <h2 className="truncate font-display text-[17px] font-bold leading-tight">{profile.name}</h2>
              <p className="truncate text-[12.5px] font-semibold text-faint">@{profile.handle}</p>
              {profile.bio && <p className="mt-1 line-clamp-2 text-[12.5px] leading-[1.4] text-muted">{profile.bio}</p>}
            </div>
          </div>
          {/* У вузькій бічній колонці планшета — два на два */}
          <div className="grid grid-cols-4 border-t border-line lg:grid-cols-2">
            <Stat value={lists.mine.length} label="рецептів" first />
            <Stat value={lists.saved.length} label="збережено" />
            <Stat value={cooked.length} label="приготовано" className="lg:border-l-0 lg:border-t" />
            <Stat
              value={streak}
              label={plural(streak, "день поспіль", "дні поспіль", "днів поспіль")}
              accent={streak > 0}
              className="lg:border-t"
            />
          </div>
          <button
            onClick={() => {
              haptic(8);
              setName(profile.name);
              setHandle(profile.handle);
              setBio(profile.bio);
              setEmoji(profile.emoji);
              setEditOpen(true);
            }}
            className="flex h-[46px] w-full items-center justify-center gap-1.5 border-t border-line text-[13.5px] font-bold active:bg-surface-2"
          >
            <Pencil size={14} strokeWidth={2.2} />
            Редагувати профіль
          </button>
        </Panel>

        {/* Сімʼя й налаштування — на планшеті під карткою, на телефоні вони в шапці й у налаштуваннях */}
        <Panel className="hidden lg:block">
          <Link href="/family" className="flex h-12 items-center gap-3 px-3.5 active:bg-surface-2">
            <Users size={17} className="shrink-0 text-muted" />
            <span className="flex-1 text-[14px] font-semibold">Сімʼя</span>
            <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
          </Link>
          <Link href="/settings" className="flex h-12 items-center gap-3 border-t border-line px-3.5 active:bg-surface-2">
            <Settings2 size={17} className="shrink-0 text-muted" />
            <span className="flex-1 text-[14px] font-semibold">Налаштування</span>
            <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
          </Link>
        </Panel>
        </aside>

        <section className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-3">

        {/* Вкладки */}
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "mine", label: "Мої" },
            { value: "saved", label: "Збережені" },
            { value: "wish", label: "Хочу" },
            { value: "history", label: "Історія" },
          ]}
          className="lg:w-[440px]"
        />

        {/* Вміст */}
        {hydrated && (
          <Panel className="lg:hidden">
            {rows.map(({ key, recipe, meta }, i) => (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
              >
                <Link
                  href={`/recipe/${recipe.id}`}
                  className={cn(
                    "flex h-16 items-center gap-3 px-3.5 active:bg-surface-2",
                    i > 0 && "border-t border-line",
                  )}
                >
                  <RecipeMedia recipe={recipe} className="h-11 w-11 shrink-0" rounded="rounded-[8px]" emojiSize="text-[22px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{recipe.title}</span>
                    <span className="block truncate text-[12px] font-semibold text-faint">{meta}</span>
                  </span>
                  <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-faint" />
                </Link>
              </motion.div>
            ))}
            {rows.length === 0 && (
              <p className="px-3.5 py-9 text-center text-[13.5px] font-bold text-faint">{emptyText}</p>
            )}
            {tab === "mine" && (
              <Link
                href="/new"
                onClick={() => haptic(12)}
                className={cn(
                  "flex h-12 items-center gap-2.5 px-3.5 active:bg-surface-2",
                  "border-t border-line",
                )}
              >
                <Plus size={16} strokeWidth={2.4} className="text-brand" />
                <span className="flex-1 text-[14px] font-semibold text-brand">Додати свій рецепт</span>
              </Link>
            )}
          </Panel>
        )}

        {/* Планшет: ті самі рецепти плитками */}
        {hydrated && (
          <div className="hidden lg:grid lg:grid-cols-4 lg:gap-x-3.5 lg:gap-y-4">
            {rows.map(({ key, recipe, meta }) => (
              <Link key={key} href={`/recipe/${recipe.id}`} className="min-w-0">
                <RecipeMedia recipe={recipe} className="aspect-square w-full" rounded="rounded-[10px]" emojiSize="text-[52px]" />
                <span className="mt-2 line-clamp-2 text-[13.5px] font-bold leading-tight">{recipe.title}</span>
                <span className="mt-0.5 block truncate text-[12px] font-semibold text-faint">{meta}</span>
              </Link>
            ))}
            {tab === "mine" && (
              <Link
                href="/new"
                onClick={() => haptic(12)}
                className="flex aspect-square flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong text-brand active:bg-surface"
              >
                <Plus size={26} strokeWidth={2.4} />
                <span className="text-[13.5px] font-bold">Додати рецепт</span>
              </Link>
            )}
            {rows.length === 0 && tab !== "mine" && (
              <p className="col-span-4 rounded-[10px] border border-line bg-surface px-3.5 py-9 text-center text-[13.5px] font-bold text-faint">
                {emptyText}
              </p>
            )}
          </div>
        )}
        </section>
      </div>

      {/* Редагування профілю */}
      <Sheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Редагувати профіль"
        footer={
          <Button full onClick={saveProfile}>
            Зберегти
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-4">
          <div>
            <label className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-muted">
              Аватар
            </label>
            <div className="flex flex-wrap gap-2">
              {/* Знімок із Google — першим: він уже є, і найчастіше саме його
                  й хочуть лишити. Емодзі поруч, для тих, хто не хоче фото. */}
              {googlePhoto && (
                <button
                  onClick={() => setAvatar(googlePhoto)}
                  aria-label="Фото з Google"
                  aria-pressed={avatar !== null}
                  className={`h-12 w-12 overflow-hidden rounded-[10px] ${
                    avatar ? "ring-2 ring-brand" : ""
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={googlePhoto} alt="" className="h-full w-full object-cover" />
                </button>
              )}
              {["🧑‍🍳", "👩‍🍳", "👨‍🍳", "🔥", "🥑", "🍜", "🧁", "🌶️", "🐙", "🦊"].map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setEmoji(e);
                    // Обрали емодзі — фото більше не показуємо, інакше вибір
                    // не мав би жодного видимого наслідку: знімок завжди зверху.
                    setAvatar(null);
                  }}
                  aria-pressed={avatar === null && emoji === e}
                  className={`grid h-12 w-12 place-items-center rounded-[10px] text-2xl ${
                    avatar === null && emoji === e ? "bg-brand/20 ring-2 ring-brand" : "bg-surface-2"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-muted">
              Імʼя
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              className="h-12 w-full rounded-[10px] border border-line bg-surface px-4 text-[15px]"
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-muted">
              Нік
            </label>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              maxLength={24}
              className="h-12 w-full rounded-[10px] border border-line bg-surface px-4 text-[15px]"
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-muted">
              Про себе
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={160}
              className="w-full resize-none rounded-[10px] border border-line bg-surface p-4 text-[15px] leading-relaxed"
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Stat({
  value,
  label,
  accent,
  first,
  className,
}: {
  value: number;
  label: string;
  accent?: boolean;
  first?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center gap-0.5 border-line py-2.5",
        !first && "border-l",
        className,
      )}
    >
      <span className={cn("font-display text-[16px] font-bold leading-tight", accent && "text-brand")}>{value}</span>
      <span className="max-w-full truncate px-1 text-[11px] font-semibold text-faint">{label}</span>
    </div>
  );
}
