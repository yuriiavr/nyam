"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Compass,
  House,
  Plus,
  Refrigerator,
  Settings2,
  Sparkles,
  User,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { cn, haptic } from "@/lib/utils";
import { Avatar } from "./ui";

const ITEMS = [
  { href: "/", label: "Стрічка", icon: House },
  { href: "/explore", label: "Пошук", icon: Compass },
  { href: "/decide", label: "Вирішити", icon: Sparkles },
  { href: "/pantry", label: "Комора", icon: Refrigerator },
  { href: "/plan", label: "План на тиждень", icon: CalendarDays },
  { href: "/me", label: "Профіль", icon: User },
];

/** Бічна навігація — тільки для великих екранів (від lg). */
export function Sidebar() {
  const pathname = usePathname() || "/";
  const profile = useApp((s) => s.profile);
  const myCount = useApp((s) => s.myRecipes.length);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-bg-elev/60 px-3 py-5 lg:flex xl:w-[276px]">
      {/* Логотип */}
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
        <span className="grid h-10 w-10 place-items-center rounded-2xl brand-gradient text-xl text-brand-ink shadow-[var(--shadow-pop)]">
          🍲
        </span>
        <span className="min-w-0">
          <span className="block font-display text-[19px] font-extrabold leading-none">Ням</span>
          <span className="block truncate text-[11px] text-muted">що поїсти сьогодні</span>
        </span>
      </Link>

      {/* Навігація */}
      <nav className="flex flex-col gap-1">
        {ITEMS.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => haptic(8)}
              className="relative flex items-center gap-3 rounded-2xl px-3 py-2.5"
            >
              {active && (
                <motion.span
                  layoutId="sidebar-pill"
                  transition={{ type: "spring", stiffness: 460, damping: 36 }}
                  className="absolute inset-0 rounded-2xl bg-surface-2"
                />
              )}
              <Icon
                size={19}
                strokeWidth={active ? 2.5 : 2}
                className={cn("relative z-10 shrink-0", active ? "text-brand" : "text-muted")}
              />
              <span
                className={cn(
                  "relative z-10 truncate text-[14px] font-bold",
                  active ? "text-ink" : "text-muted",
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Головна дія */}
      <Link
        href="/new"
        onClick={() => haptic(12)}
        className="mt-5 flex items-center justify-center gap-2 rounded-2xl brand-gradient py-3 text-[14px] font-bold text-brand-ink shadow-[var(--shadow-pop)] transition-transform active:scale-[0.97]"
      >
        <Plus size={18} strokeWidth={2.6} />
        Додати рецепт
      </Link>

      <div className="flex-1" />

      {/* Профіль */}
      <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface p-2.5">
        <Link href="/me" className="flex min-w-0 flex-1 items-center gap-2.5">
          <Avatar
            emoji={profile.emoji}
            gradient={profile.gradient}
            src={profile.avatar}
            size={36}
          />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold">{profile.name}</span>
            <span className="block truncate text-[11px] text-muted">
              {myCount} {myCount === 1 ? "рецепт" : "рецептів"}
            </span>
          </span>
        </Link>
        <Link
          href="/settings"
          aria-label="Налаштування"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted"
        >
          <Settings2 size={16} />
        </Link>
      </div>
    </aside>
  );
}
