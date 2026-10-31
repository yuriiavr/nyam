"use client";

import { Bookmark, ChefHat, Heart, MessageCircle, Star, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Avatar, Button, EmptyState, Panel, PanelHeader, Spinner } from "@/components/ui";
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

/** «Сьогодні», «Вчора» або «28 жовтня» — заголовок групи за місцевим днем. */
function dayLabel(date: Date, now: Date): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(date)) / 86_400_000);
  if (days === 0) return "Сьогодні";
  if (days === 1) return "Вчора";
  return date.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Групи за днем у тому ж порядку, у якому прийшли сповіщення. */
function groupByDay(list: AppNotification[]): Array<{ key: string; label: string; items: AppNotification[] }> {
  const now = new Date();
  const groups: Array<{ key: string; label: string; items: AppNotification[] }> = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const n of list) {
    const d = new Date(n.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: dayLabel(d, now), items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(n);
  }
  return groups;
}

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
  const groups = useMemo(() => groupByDay(notifications), [notifications]);

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
      <TopBar
        title="Сповіщення"
        right={<span className="shrink-0 text-[12px] font-bold text-faint">{notifications.length} подій</span>}
      />

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
        // Планшет (lg): дні у дві колонки — так на екрані вміщається тиждень подій.
        <div className="flex flex-col gap-2.5 px-4 md:px-6 lg:block lg:columns-2 lg:gap-3">
          {groups.map((group) => (
            <Panel key={group.key} className="lg:mb-3 lg:break-inside-avoid">
              <PanelHeader label={group.label} aside={String(group.items.length)} />
              <ul>
                {group.items.map((n) => (
                  <NotificationRow key={n.id} n={n} actor={n.actorId ? actors.get(n.actorId) : undefined} />
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationRow({ n, actor }: { n: AppNotification; actor?: Profile }) {
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);
  const meta = META[n.type];
  const Icon = meta.icon;
  const recipe = useMemo(
    () => (n.recipeId ? recipeById(useApp.getState(), n.recipeId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n.recipeId, myRecipes, remoteRecipes],
  );

  const body = (
    <div className="flex items-start gap-3 px-3.5 py-3">
      <div className="relative shrink-0">
        <Avatar
          emoji={actor?.emoji ?? "👤"}
          gradient={actor?.gradient ?? ["#6d5e59", "#a1908a"]}
          src={actor?.avatar}
          size={38}
        />
        <span className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-surface bg-surface-2">
          <Icon size={10} strokeWidth={2.4} className={meta.tone} />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug">
          <span className="font-bold">{actor?.name ?? "Хтось"}</span>{" "}
          <span className="font-semibold text-muted">{meta.text}</span>
          {recipe && <span className="font-semibold"> «{recipe.title}»</span>}
        </p>
        <p className="mt-0.5 text-[11.5px] font-semibold text-faint">{timeAgo(n.createdAt)}</p>
      </div>

      {!n.readAt && (
        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
      )}
    </div>
  );

  const href = n.recipeId ? `/recipe/${n.recipeId}` : n.actorId ? `/u/${n.actorId}` : null;

  return (
    <li className="border-t border-line">
      {href ? (
        <Link href={href} className="block active:bg-surface-2">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
