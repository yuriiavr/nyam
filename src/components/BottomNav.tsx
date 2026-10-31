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

/**
 * Скільки панель займає від низу екрана без safe-area: 14 px повітря під
 * «пігулкою» і 62 px її самої. Від цього числа відступають контент, тости й
 * панель «готуєш зараз», тож міняти його — лише разом із розміткою нижче.
 */
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

  /*
   * Плаваюча «пігулка» з редизайну: самі іконки, без підписів — пʼять вкладок
   * упізнаються з першого дня, а підписи забирали висоту в кожного екрана.
   * Назви лишаються для скрінрідера (aria-label) і підказкою при наведенні.
   */
  return (
    <nav
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
      className="pointer-events-none fixed left-1/2 z-40 w-full max-w-[560px] -translate-x-1/2 px-[18px] md:hidden"
    >
      <ul className="pointer-events-auto flex h-[62px] items-center justify-around rounded-[31px] border border-white/[0.07] bg-[rgb(22_22_26_/_0.82)] px-1.5 shadow-[0_18px_40px_-12px_rgb(0_0_0_/_0.8)] backdrop-blur-[24px] backdrop-saturate-[1.6] light:border-line light:bg-white/85 light:shadow-[var(--shadow-card)]">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          const Icon = tab.icon;

          if (tab.center) {
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  onClick={() => haptic(14)}
                  aria-label={tab.label}
                  title={tab.label}
                  aria-current={active ? "page" : undefined}
                >
                  <motion.span
                    whileTap={{ scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 500, damping: 26 }}
                    className="grid h-11 w-12 place-items-center rounded-[22px] brand-gradient text-brand-ink"
                  >
                    <Icon size={22} strokeWidth={2.4} />
                  </motion.span>
                </Link>
              </li>
            );
          }

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                onClick={() => haptic(8)}
                aria-label={tab.label}
                title={tab.label}
                aria-current={active ? "page" : undefined}
                className="relative grid h-11 w-[52px] place-items-center"
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    transition={{ type: "spring", stiffness: 480, damping: 34 }}
                    className="absolute inset-0 rounded-[22px] bg-white/[0.08] light:bg-surface-2"
                  />
                )}
                <Icon
                  size={23}
                  strokeWidth={2}
                  className={cn("relative z-10 transition-colors", active ? "text-ink" : "text-muted")}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
