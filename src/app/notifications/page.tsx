"use client";

import { Bookmark, ChefHat, Heart, MessageCircle, Star, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Avatar, Button, EmptyState, Spinner } from "@/components/ui";
import { refreshNotifications } from "@/lib/session";
import { recipeById, useApp } from "@/lib/store";
import * as api from "@/lib/supabase/api";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import type { AppNotification, NotificationType, Profile } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

const META: Record<NotificationType, { icon: typeof Heart; text: string; tone: string }> = {
  follow: { icon: UserPlus, text: "підписався на тебе", tone: "text-brand" },
  like: { icon: Heart, text: "вподобав твій рецепт", tone: "text-berry" },
  save: { icon: Bookmark, text: "зберіг твій рецепт", tone: "text-sky" },
  cook: { icon: ChefHat, text: "приготував твою страву", tone: "text-mint" },
  rating: { icon: Star, text: "оцінив твій рецепт", tone: "text-brand-2" },
  family_join: { icon: Users, text: "приєднався до твоєї сімʼї", tone: "text-grape" },
  comment: { icon: MessageCircle, text: "залишив коментар до твого рецепта", tone: "text-sky" },
};

export default function NotificationsPage() {
  const account = useApp((s) => s.account);
  const notifications = useApp((s) => s.notifications);
  const markRead = useApp((s) => s.markNotificationsRead);

  const [actors, setActors] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);

  const actorIds = useMemo(
    () => [...new Set(notifications.map((n) => n.actorId).filter((id): id is string => !!id))],
    [notifications],
  );

  // Свіжий список при кожному відкритті — стрічка мала б бути актуальною.
  useEffect(() => {
    if (!account) {
      setLoading(false);
      return;
    }
    void refreshNotifications().finally(() => setLoading(false));
  }, [account]);

  // Профілі тих, хто діяв: у вибірку спільноти вони могли не потрапити.
  useEffect(() => {
    if (!actorIds.length) return;
    let alive = true;
    void api
      .fetchProfilesByIds(actorIds)
      .then((list) => {
        if (alive) setActors(new Map(list.map((p) => [p.id, p])));
      })
      .catch(() => {
        /* без профілю просто покажемо запасний варіант */
      });
    return () => {
      alive = false;
    };
  }, [actorIds]);

  // Позначаємо прочитаним при вході, але лише те, що вже було непрочитаним.
  useEffect(() => {
    if (!account || loading) return;
    if (!notifications.some((n) => !n.readAt)) return;
    void api.markNotificationsRead().then(markRead).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, loading]);

  if (!isSupabaseConfigured || !account) {
    return (
      <div className="pb-8">
        <TopBar title="Сповіщення" />
        <EmptyState
          emoji="🔔"
          title="Потрібен акаунт"
          note="Сповіщення показують, хто підписався на тебе та що зробив з твоїми рецептами."
          action={
            <Link href="/auth">
              <Button>Увійти</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="pb-8">
      <TopBar title="Сповіщення" subtitle={`${notifications.length} подій`} />

      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          emoji="🌱"
          title="Поки тихо"
          note="Тут зʼявиться, коли хтось підпишеться на тебе, вподобає чи приготує твій рецепт."
        />
      ) : (
        <ul className="divide-y divide-line">
          {notifications.map((n) => (
            <NotificationRow key={n.id} n={n} actor={n.actorId ? actors.get(n.actorId) : undefined} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({ n, actor }: { n: AppNotification; actor?: Profile }) {
  const state = useApp();
  const meta = META[n.type];
  const Icon = meta.icon;
  const recipe = n.recipeId ? recipeById(state, n.recipeId) : undefined;

  const body = (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div className="relative shrink-0">
        <Avatar
          emoji={actor?.emoji ?? "👤"}
          gradient={actor?.gradient ?? ["#6d5e59", "#a1908a"]}
          src={actor?.avatar}
          size={42}
        />
        <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-bg bg-surface-2">
          <Icon size={11} className={meta.tone} />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug">
          <span className="font-bold">{actor?.name ?? "Хтось"}</span>{" "}
          <span className="text-muted">{meta.text}</span>
          {recipe && <span className="font-semibold"> «{recipe.title}»</span>}
        </p>
        <p className="mt-0.5 text-[11.5px] text-faint">{timeAgo(n.createdAt)}</p>
      </div>

      {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand" />}
    </div>
  );

  const href = n.recipeId ? `/recipe/${n.recipeId}` : n.actorId ? `/u/${n.actorId}` : null;

  return (
    <li className={n.readAt ? undefined : "bg-brand/[0.04]"}>
      {href ? <Link href={href}>{body}</Link> : body}
    </li>
  );
}
