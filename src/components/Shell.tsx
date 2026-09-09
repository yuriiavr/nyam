"use client";

import { usePathname } from "next/navigation";
import { BottomNav, NAV_HEIGHT, useNavHidden } from "./BottomNav";

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
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
