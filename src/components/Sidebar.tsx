"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, Compass, House, NotebookPen, Refrigerator, Sparkles } from "lucide-react";
import { useApp } from "@/lib/store";
import { cn, haptic } from "@/lib/utils";
import { Avatar } from "./ui";

const ITEMS = [
  { href: "/", label: "Стрічка", icon: House },
  { href: "/explore", label: "Пошук", icon: Compass },
  { href: "/decide", label: "Вирішити", icon: Sparkles, center: true },
  { href: "/pantry", label: "Комора", icon: Refrigerator },
  { href: "/plan", label: "Тиждень", icon: CalendarDays },
  { href: "/diary", label: "Щоденник", icon: NotebookPen },
];

/** Екрани без власного пункту підсвічують «батька»: покупки живуть у тижні. */
const PARENT: Array<[RegExp, string]> = [[/^\/shopping/, "/plan"]];

/** Де рейки немає: готування займає весь екран, вхід — до застосунку. */
const HIDE_ON = [/\/cook$/, /^\/auth/];

/**
 * Навігаційна рейка планшета (від md): вузька колонка зліва замість нижньої
 * «пігулки». На широкому екрані палець тягнеться вбік, а не вниз, і вертикаль
 * лишається контенту — на альбомних 600 px вона найдорожча.
 */
export function NavRail() {
  const pathname = usePathname() || "/";
  const account = useApp((s) => s.account);
  const profile = useApp((s) => s.profile);
  const unread = useApp((s) => s.notifications.filter((n) => !n.readAt).length);
  if (!account || HIDE_ON.some((re) => re.test(pathname))) return null;

  const current = PARENT.find(([re]) => re.test(pathname))?.[1] ?? pathname;
  const isActive = (href: string) => (href === "/" ? current === "/" : current.startsWith(href));

  return (
    <nav className="sticky top-0 z-30 hidden h-dvh w-[92px] shrink-0 flex-col items-center gap-1 border-r border-line bg-[rgb(13_13_16_/_0.6)] pb-3.5 pt-4 md:flex light:bg-bg-elev">
      <Link
        href="/"
        aria-label="Ням — на головну"
        className="mb-3 grid h-[46px] w-[46px] place-items-center rounded-[16px] brand-gradient text-[24px] shadow-[0_12px_30px_-10px_rgb(255_107_53_/_0.6)]"
      >
        🍲
      </Link>

      {ITEMS.map((item) => {
        const active = isActive(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => haptic(8)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-[58px] w-[76px] flex-col items-center justify-center gap-1 rounded-[18px] transition-colors",
              item.center
                ? "brand-gradient text-brand-ink"
                : active
                  ? "bg-surface-2 text-brand"
                  : "text-muted active:bg-surface-2",
            )}
          >
            <Icon size={22} strokeWidth={item.center ? 2.4 : 2} />
            <span className="text-[11px] font-bold tracking-[0.01em]">{item.label}</span>
          </Link>
        );
      })}

      <div className="flex-1" />

      <Link
        href="/notifications"
        aria-label={unread ? `Сповіщення, непрочитаних: ${unread}` : "Сповіщення"}
        className={cn(
          "relative grid h-12 w-12 place-items-center rounded-[16px]",
          pathname.startsWith("/notifications") ? "bg-surface-2 text-brand" : "text-muted active:bg-surface-2",
        )}
      >
        <Bell size={22} />
        {unread > 0 && (
          <span className="absolute right-[11px] top-2.5 h-[9px] w-[9px] rounded-full bg-berry shadow-[0_0_0_2px_var(--bg-elev)]" />
        )}
      </Link>
      <Link
        href="/me"
        aria-label="Профіль"
        className={cn(
          "mt-1.5 rounded-full",
          pathname.startsWith("/me") || pathname.startsWith("/settings")
            ? "shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--brand)]"
            : "shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--line-strong)]",
        )}
      >
        <Avatar emoji={profile.emoji} gradient={profile.gradient} src={profile.avatar} size={46} />
      </Link>
    </nav>
  );
}
