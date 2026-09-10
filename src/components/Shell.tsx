"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { AuthScreen } from "./AuthScreen";
import { BottomNav, NAV_HEIGHT, useNavHidden } from "./BottomNav";
import { useApp } from "@/lib/store";

/**
 * Оболонка застосунку: колонка шириною з телефон і нижня навігація.
 * Відступ знизу додається лише тоді, коли навігація справді на екрані —
 * інакше повноекранні режими (готування, створення рецепта) отримували б
 * порожню смугу під липкими кнопками.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const navHidden = useNavHidden(pathname);

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[560px] flex-col border-line md:border-x">
      <main
        className="flex-1"
        style={
          navHidden
            ? undefined
            : { paddingBottom: `calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom))` }
        }
      >
        <AuthGate pathname={pathname}>{children}</AuthGate>
      </main>
      <BottomNav />
    </div>
  );
}

/**
 * Сторінки, доступні без входу.
 *
 * Умови й політика приватності мають відкриватись будь-кому: на них веде
 * посилання з самого екрана входу, і їхня публічна адреса потрібна Google
 * для перевірки застосунку. /auth і /auth/callback — це власне вхід.
 */
const PUBLIC = [/^\/auth/, /^\/privacy$/, /^\/terms$/, /^\/offline$/];

const isPublic = (pathname: string) => PUBLIC.some((re) => re.test(pathname));

/**
 * Не пускає в застосунок без акаунта.
 *
 * Гостьового режиму немає свідомо: рецепти, комора й план — це особисті дані,
 * які мають жити в акаунті, а не в localStorage одного браузера. Раніше без
 * входу все зберігалось локально й губилось разом з очищеним кешем.
 */
function AuthGate({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const hydrated = useApp((s) => s.hydrated);
  const authChecked = useApp((s) => s.authChecked);
  const account = useApp((s) => s.account);

  if (isPublic(pathname)) return <>{children}</>;
  if (!hydrated || !authChecked) return <Splash />;
  if (!account) return <AuthScreen />;
  return <>{children}</>;
}

/** Заставка на час перевірки сесії — секунда-дві на холодному старті. */
function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <motion.div
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 1.6, repeat: Infinity }}
        className="grid h-20 w-20 place-items-center rounded-[28px] brand-gradient text-4xl shadow-[var(--shadow-pop)]"
      >
        🍲
      </motion.div>
    </div>
  );
}
