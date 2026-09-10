"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Compass, House, Refrigerator, Sparkles, User } from "lucide-react";
import { useApp } from "@/lib/store";
import { cn, haptic } from "@/lib/utils";

interface Tab {
  href: string;
  label: string;
  icon: typeof House;
  center?: boolean;
}

const TABS: Tab[] = [
  { href: "/", label: "Стрічка", icon: House },
  { href: "/explore", label: "Пошук", icon: Compass },
  { href: "/decide", label: "Вирішити", icon: Sparkles, center: true },
  { href: "/pantry", label: "Комора", icon: Refrigerator },
  { href: "/me", label: "Я", icon: User },
];

/** Маршрути, де нижня панель заважає (повноекранні режими та форми). */
const HIDE_ON = [/\/cook$/, /^\/new$/, /^\/scan$/, /^\/auth/];

/** Висота панелі без safe-area — використовується для відступу контенту. */
export const NAV_HEIGHT = 76;

export function useNavHidden(pathname: string): boolean {
  return HIDE_ON.some((re) => re.test(pathname));
}

export function BottomNav() {
  const pathname = usePathname() || "/";
  // Поки користувач не увійшов, замість застосунку показується екран входу —
  // навігація по вкладках там нікуди не веде.
  const account = useApp((s) => s.account);
  if (useNavHidden(pathname) || !account) return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-[560px] -translate-x-1/2">
      <div className="glass pad-safe-b border-t border-line">
        <ul className="flex items-stretch justify-around px-2 pt-1.5 pb-1">
          {TABS.map((tab) => {
            const active = isActive(tab.href);
            const Icon = tab.icon;

            if (tab.center) {
              return (
                <li key={tab.href} className="relative -mt-7 w-[64px]">
                  <Link
                    href={tab.href}
                    onClick={() => haptic(14)}
                    aria-label={tab.label}
                    className="flex flex-col items-center gap-1"
                  >
                    <motion.span
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 500, damping: 26 }}
                      className={cn(
                        "grid h-[54px] w-[54px] place-items-center rounded-[20px] brand-gradient text-brand-ink",
                        "shadow-[var(--shadow-pop)] ring-4 ring-bg",
                      )}
                    >
                      <Icon size={24} strokeWidth={2.4} />
                    </motion.span>
                    <span
                      className={cn(
                        "text-[10px] font-bold tracking-tight",
                        active ? "text-brand" : "text-muted",
                      )}
                    >
                      {tab.label}
                    </span>
                  </Link>
                </li>
              );
            }

            return (
              <li key={tab.href} className="w-[64px]">
                <Link
                  href={tab.href}
                  onClick={() => haptic(8)}
                  className="relative flex flex-col items-center gap-1 py-1.5"
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      transition={{ type: "spring", stiffness: 480, damping: 34 }}
                      className="absolute inset-x-2 top-0 h-[34px] rounded-2xl bg-surface-2"
                    />
                  )}
                  <span className="relative z-10 flex flex-col items-center gap-1">
                    <Icon
                      size={21}
                      strokeWidth={active ? 2.5 : 2}
                      className={active ? "text-brand" : "text-muted"}
                    />
                    <span
                      className={cn(
                        "text-[10px] font-bold tracking-tight",
                        active ? "text-ink" : "text-muted",
                      )}
                    >
                      {tab.label}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
