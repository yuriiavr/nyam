"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn, haptic } from "@/lib/utils";

export function TopBar({
  title,
  subtitle,
  right,
  back = true,
  transparent,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  back?: boolean;
  transparent?: boolean;
  className?: string;
}) {
  const router = useRouter();
  return (
    <header
      className={cn(
        "pad-safe-t sticky top-0 z-30",
        transparent ? "bg-transparent" : "glass border-b border-line",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-2 px-3">
        {back && (
          <button
            onClick={() => {
              haptic(8);
              router.back();
            }}
            aria-label="Назад"
            className="-ml-1 grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-surface-2/80 active:bg-line"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {title && (
            <h1 className="truncate font-display text-[16px] font-bold leading-tight">{title}</h1>
          )}
          {subtitle && <p className="truncate text-[11.5px] text-muted">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}
