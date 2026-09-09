"use client";

import { motion } from "framer-motion";
import { Bell, Flame, Pencil, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { RecipeRow, RecipeTile } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Avatar, Button, EmptyState, Segmented, Sheet, useToast } from "@/components/ui";
import { allRecipes, cookStreak, useApp } from "@/lib/store";
import { haptic, plural, timeAgo } from "@/lib/utils";

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
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const initialTab = (params.get("tab") as Tab) ?? "mine";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState(state.profile.name);
  const [handle, setHandle] = useState(state.profile.handle);
  const [bio, setBio] = useState(state.profile.bio);
  const [emoji, setEmoji] = useState(state.profile.emoji);

  const lists = useMemo(() => {
    if (!hydrated) return { mine: [], saved: [], wish: [], history: [] };
    const all = allRecipes(state);
    const byId = new Map(all.map((r) => [r.id, r]));
    return {
      mine: state.myRecipes,
      saved: state.saved.map((id) => byId.get(id)).filter((r) => r != null),
      wish: state.wishlist.map((id) => byId.get(id)).filter((r) => r != null),
      history: state.cooked
        .map((c) => ({ recipe: byId.get(c.recipeId), at: c.at }))
        .filter((x) => x.recipe != null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, state.myRecipes, state.saved, state.wishlist, state.cooked]);

  const streak = hydrated ? cookStreak(state) : 0;

  const saveProfile = () => {
    state.updateProfile({
      name: name.trim() || "Мій профіль",
      handle: handle.trim().replace(/^@/, "") || "me",
      bio: bio.trim(),
      emoji,
    });
    toast("Профіль оновлено", "✅");
    setEditOpen(false);
  };

  const current = tab === "history" ? [] : lists[tab];

  const unread = state.notifications.filter((n) => !n.readAt).length;

  return (
    <div className="pb-8">
      <TopBar
        back={false}
        title="Мій профіль"
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/notifications"
              aria-label={unread ? `Сповіщення, непрочитаних: ${unread}` : "Сповіщення"}
              className="relative grid h-10 w-10 place-items-center rounded-2xl bg-surface-2"
            >
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-bg bg-brand px-1 text-[10px] font-extrabold leading-none text-brand-ink">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <Link
              href="/settings"
              aria-label="Налаштування"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2"
            >
              <Settings2 size={18} />
            </Link>
          </div>
        }
      />

      {/* Профіль */}
      <section className="px-4 pt-4">
        <div className="flex items-center gap-4">
          <Avatar
            emoji={state.profile.emoji}
            gradient={state.profile.gradient}
            src={state.profile.avatar}
            size={72}
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[19px] font-extrabold leading-tight">
              {state.profile.name}
            </h2>
            <p className="truncate text-[12.5px] text-muted">@{state.profile.handle}</p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => {
                setName(state.profile.name);
                setHandle(state.profile.handle);
                setBio(state.profile.bio);
                setEmoji(state.profile.emoji);
                setEditOpen(true);
              }}
            >
              <Pencil size={14} />
              Редагувати
            </Button>
          </div>
        </div>

        {state.profile.bio && (
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted">{state.profile.bio}</p>
        )}

        {/* Статистика */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          <Stat value={lists.mine.length} label="рецептів" />
          <Stat value={lists.saved.length} label="збережено" />
          <Stat value={state.cooked.length} label="приготовано" />
          <Stat value={streak} label="днів поспіль" accent={streak > 0} />
        </div>

        {streak > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-brand/25 bg-brand/8 px-3.5 py-2.5">
            <Flame size={16} className="text-brand" />
            <p className="text-[12.5px] font-semibold">
              Серія {streak} {plural(streak, "день", "дні", "днів")} — не зупиняйся!
            </p>
          </div>
        )}
      </section>

      {/* Вкладки */}
      <div className="px-4 pt-5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "mine", label: `Мої ${lists.mine.length}` },
            { value: "saved", label: `Збережені ${lists.saved.length}` },
            { value: "wish", label: `Хочу ${lists.wish.length}` },
            { value: "history", label: "Історія" },
          ]}
        />
      </div>

      {/* Вміст */}
      <section className="px-4 pt-4">
        {!hydrated ? null : tab === "history" ? (
          lists.history.length === 0 ? (
            <EmptyState
              emoji="📖"
              title="Історія порожня"
              note="Приготуй щось у покроковому режимі — і страва зʼявиться тут."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {lists.history.map((h, i) => (
                <RecipeRow
                  key={`${h.recipe!.id}-${i}`}
                  recipe={h.recipe!}
                  href={`/recipe/${h.recipe!.id}`}
                  subtitle={`Приготовано ${timeAgo(h.at)}`}
                />
              ))}
            </div>
          )
        ) : current.length === 0 ? (
          <EmptyState
            emoji={tab === "mine" ? "📗" : tab === "saved" ? "🔖" : "📌"}
            title={
              tab === "mine"
                ? "Ще немає своїх рецептів"
                : tab === "saved"
                  ? "Порожня галерея"
                  : "Список бажань порожній"
            }
            note={
              tab === "mine"
                ? "Додай перший рецепт — його побачить уся спільнота."
                : tab === "saved"
                  ? "Зберігай чужі рецепти кнопкою «закладка» — вони будуть тут."
                  : "Погортай свайп або покрути рулетку — сподобані страви потраплять сюди."
            }
            action={
              tab === "mine" ? (
                <Link href="/new">
                  <Button>
                    <Plus size={17} />
                    Створити рецепт
                  </Button>
                </Link>
              ) : (
                <Link href={tab === "saved" ? "/explore" : "/decide/swipe"}>
                  <Button variant="secondary">
                    {tab === "saved" ? "До каталогу" : "До свайпу"}
                  </Button>
                </Link>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-5">
            {current.map((r, i) => (
              <motion.div
                key={r!.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
              >
                <RecipeTile recipe={r!} />
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Додати рецепт */}
      {tab === "mine" && lists.mine.length > 0 && (
        <div className="px-4 pt-5">
          <Link href="/new" onClick={() => haptic(12)}>
            <Button variant="secondary" full>
              <Plus size={17} />
              Додати ще рецепт
            </Button>
          </Link>
        </div>
      )}

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
              {["🧑‍🍳", "👩‍🍳", "👨‍🍳", "🔥", "🥑", "🍜", "🧁", "🌶️", "🐙", "🦊"].map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`grid h-12 w-12 place-items-center rounded-2xl text-2xl ${
                    emoji === e ? "bg-brand/20 ring-2 ring-brand" : "bg-surface-2"
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
              className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px]"
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
              className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px]"
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
              className="w-full resize-none rounded-2xl border border-line bg-surface p-4 text-[15px] leading-relaxed"
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
}: {
  value: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-2 py-2.5 text-center ${
        accent ? "border-brand/30 bg-brand/8" : "border-line bg-surface"
      }`}
    >
      <p
        className={`font-display text-[18px] font-extrabold leading-none ${accent ? "text-brand" : ""}`}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[10px] text-muted">{label}</p>
    </div>
  );
}
