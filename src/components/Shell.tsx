"use client";

import { motion } from "framer-motion";
import { PullToRefresh } from "./PullToRefresh";
import { refreshFromServer } from "@/lib/session";
import { usePathname } from "next/navigation";
import { AuthScreen } from "./AuthScreen";
import { BottomNav, NAV_HEIGHT, useNavHidden } from "./BottomNav";
import { CookingHost } from "./CookingHost";
import { PushOffer } from "./PushOffer";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { NavRail } from "./Sidebar";

/**
 * Оболонка застосунку: колонка шириною з телефон і нижня навігація.
 * Відступ знизу додається лише тоді, коли навігація справді на екрані —
 * інакше повноекранні режими (готування, створення рецепта) отримували б
 * порожню смугу під липкими кнопками. Панель «готуєш зараз» над навігацією
 * додає до відступу свою висоту — змінною --cook-dock (див. CookingHost).
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const navHidden = useNavHidden(pathname);
  const wide = WIDE.some((re) => re.test(pathname));

  return (
    <div className="relative flex min-h-dvh w-full">
      {/* Світіння згори — з планшетного макета; на телефоні його зʼїдала б шапка. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 hidden bg-[radial-gradient(50rem_30rem_at_60%_-20%,rgb(255_107_53_/_0.13),transparent_70%)] md:block light:md:hidden"
      />
      <NavRail />
      <div
        className={cn(
          "relative mx-auto flex min-h-dvh w-full min-w-0 max-w-[560px] flex-1 flex-col",
          wide ? "md:max-w-none" : "md:max-w-[720px]",
        )}
      >
        <main
          className="flex-1 md:!pb-[var(--cook-dock,0px)]"
          style={
            navHidden
              ? undefined
              : { paddingBottom: `calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom) + var(--cook-dock, 0px))` }
          }
        >
          <AuthGate pathname={pathname}>
            <PullToRefresh onRefresh={refreshFromServer}>{children}</PullToRefresh>
          </AuthGate>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}

/**
 * Екрани з власною планшетною розкладкою (кілька колонок від lg). Решта на
 * планшеті лишається колонкою до 720 px по центру — розтягнутий на всю ширину
 * список читати важче, ніж вузький.
 */
const WIDE = [
  /^\/$/,
  /^\/explore$/,
  /^\/decide$/,
  /^\/decide\/roulette$/,
  /^\/pantry$/,
  /^\/plan$/,
  /^\/shopping$/,
  /^\/diary$/,
  /^\/recipe\/[^/]+$/,
  /^\/recipe\/[^/]+\/cook$/,
  /^\/me$/,
  /^\/notifications$/,
];

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
  if (!account) {
    return (
      <>
        <AuthScreen />
        {/* На екрані входу — лише підказка про встановлення, не про сповіщення:
            на iPhone застосунок з Початкового екрана має окреме сховище, тож
            краще встановити до входу, а з вбудованого браузера Instagram чи
            Telegram вхід через Google часто не пускає зовсім. */}
        <PushOffer />
      </>
    );
  }
  return (
    <>
      {children}
      {/* Таймери готування ведуться на кожній сторінці, а не лише на сторінці
          рецепта: вийшов із готування — макарони варяться далі. */}
      <CookingHost />
      {/* Пропозиції ніколи не мають вискочити поверх заставки чи публічних
          сторінок; сповіщення — лише тут, у гілці з акаунтом. */}
      <PushOffer />
    </>
  );
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
