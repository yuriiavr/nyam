"use client";

import { WifiOff } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <div className="grid h-20 w-20 place-items-center rounded-[28px] bg-surface-2">
        <WifiOff size={34} className="text-muted" />
      </div>
      <h1 className="mt-5 font-display text-2xl font-extrabold leading-tight">Немає інтернету</h1>
      <p className="mt-2 max-w-[300px] text-[14px] leading-relaxed text-muted">
        Сторінку не вдалося завантажити. Але твої рецепти, комора і план зберігаються на пристрої —
        відкриті раніше екрани працюють офлайн.
      </p>
      <div className="mt-7 flex w-full max-w-xs flex-col gap-2">
        <Button full onClick={() => location.reload()}>
          Спробувати ще раз
        </Button>
        <Link href="/">
          <Button full variant="secondary">
            На головну
          </Button>
        </Link>
      </div>
    </div>
  );
}
