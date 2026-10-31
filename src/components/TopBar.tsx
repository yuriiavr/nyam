"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn, haptic } from "@/lib/utils";

/**
 * Шапка екрана з дизайну: кнопка «назад» 38×38, назва шрифтом Unbounded і
 * квадратні дії праворуч. Без скла й лінії знизу — під нею одразу картки.
 */
export function TopBar({
  title,
  subtitle,
  right,
  back = true,
  transparent,
  railTab,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  back?: boolean;
  transparent?: boolean;
  /** Екран має свій пункт у рейці планшета — там «назад» не потрібен. */
  railTab?: boolean;
  className?: string;
}) {
  const router = useRouter();
  return (
    <header
      className={cn(
        "pad-safe-t sticky top-0 z-30 md:static",
        transparent ? "bg-transparent" : "bg-bg md:bg-transparent",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-2.5 px-4 md:h-[76px] md:gap-3.5 md:px-6">
        {back && (
          <button
            onClick={() => {
              haptic(8);
              router.back();
            }}
            aria-label="Назад"
            className={cn(
              "grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-surface-2 active:bg-line",
              railTab && "md:hidden",
            )}
          >
            <ChevronLeft size={20} strokeWidth={2.2} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {title && (
            <h1
              className={cn(
                "truncate font-display font-bold leading-tight",
                subtitle ? "text-[16px] md:text-[20px]" : back ? "text-[20px] md:text-[24px]" : "text-[22px] md:text-[24px]",
                "md:font-extrabold",
              )}
            >
              {title}
            </h1>
          )}
          {subtitle && <p className="truncate text-[12px] font-semibold text-faint md:text-[13px]">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}
