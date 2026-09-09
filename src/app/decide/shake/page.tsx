"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Hand, Smartphone } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilterButton, FilterSheet } from "@/components/FilterSheet";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, EmptyState } from "@/components/ui";
import { activeFilterCount, applyFilters, emptyFilters, type Filters } from "@/lib/matching";
import { useApp } from "@/lib/store";
import type { Recipe } from "@/lib/types";
import { formatMinutes, haptic, pick } from "@/lib/utils";

type MotionPermission = "unsupported" | "granted" | "prompt" | "denied";

interface DeviceMotionCtor {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export default function ShakePage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [result, setResult] = useState<Recipe | null>(null);
  const [rolling, setRolling] = useState(false);
  const [permission, setPermission] = useState<MotionPermission>("prompt");

  const lastShake = useRef(0);
  const lastAccel = useRef({ x: 0, y: 0, z: 0 });

  const pool = useMemo(
    () => (hydrated ? applyFilters(state, filters) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, filters, state.myRecipes, state.saved, state.following, state.cooked],
  );

  const roll = useCallback(() => {
    if (!pool.length || rolling) return;
    haptic([20, 50, 20, 50, 30]);
    setRolling(true);
    setResult(null);
    setTimeout(() => {
      setResult(pick(pool) ?? null);
      setRolling(false);
      haptic([30, 60, 30]);
    }, 900);
  }, [pool, rolling]);

  // Визначаємо, чи взагалі доступна акселерометрія
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("DeviceMotionEvent" in window)) {
      setPermission("unsupported");
      return;
    }
    const ctor = window.DeviceMotionEvent as unknown as DeviceMotionCtor;
    setPermission(typeof ctor.requestPermission === "function" ? "prompt" : "granted");
  }, []);

  // Слухаємо струс
  useEffect(() => {
    if (permission !== "granted") return;

    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;

      const prev = lastAccel.current;
      const delta =
        Math.abs(a.x - prev.x) + Math.abs(a.y - prev.y) + Math.abs(a.z - prev.z);
      lastAccel.current = { x: a.x, y: a.y, z: a.z };

      const now = Date.now();
      if (delta > 32 && now - lastShake.current > 1400) {
        lastShake.current = now;
        roll();
      }
    };

    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [permission, roll]);

  const requestMotion = async () => {
    const ctor = window.DeviceMotionEvent as unknown as DeviceMotionCtor;
    if (typeof ctor.requestPermission !== "function") {
      setPermission("granted");
      return;
    }
    try {
      const res = await ctor.requestPermission();
      setPermission(res === "granted" ? "granted" : "denied");
    } catch {
      setPermission("denied");
    }
  };

  if (hydrated && pool.length === 0) {
    return (
      <div>
        <TopBar title="Струсити" />
        <EmptyState
          emoji="📳"
          title="Немає з чого обирати"
          note="Послаб фільтри, щоб у барабані зʼявились страви."
          action={<Button onClick={() => setFilters(emptyFilters)}>Скинути фільтри</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col pb-8">
      <TopBar
        title="Струсити телефон"
        subtitle={`${pool.length} страв у грі`}
        right={
          <FilterButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
        }
      />

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <motion.div
          animate={
            rolling
              ? { rotate: [0, -14, 14, -12, 12, -6, 6, 0], scale: [1, 1.06, 1] }
              : { rotate: 0, scale: 1 }
          }
          transition={{ duration: 0.9, ease: "easeInOut" }}
          className="relative"
        >
          <div className="grid h-40 w-40 place-items-center rounded-[44px] border border-line bg-surface shadow-[var(--shadow-card)]">
            <AnimatePresence mode="wait">
              {result && !rolling ? (
                <motion.span
                  key={result.id}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 320, damping: 18 }}
                  className="text-7xl"
                >
                  {result.emoji}
                </motion.span>
              ) : (
                <motion.span
                  key="phone"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Smartphone size={56} className="text-muted" />
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {rolling && (
            <motion.div
              initial={{ opacity: 0.7, scale: 1 }}
              animate={{ opacity: 0, scale: 1.35 }}
              transition={{ duration: 0.9, repeat: Infinity }}
              className="absolute inset-0 rounded-[44px] border-2 border-brand"
            />
          )}
        </motion.div>

        <h2 className="mt-7 text-center font-display text-xl font-extrabold leading-tight">
          {permission === "granted"
            ? "Потряси телефон"
            : permission === "unsupported"
              ? "Твій пристрій без акселерометра"
              : permission === "denied"
                ? "Доступ до руху заборонено"
                : "Увімкни визначення руху"}
        </h2>
        <p className="mt-2 max-w-[300px] text-center text-[13px] leading-relaxed text-muted">
          {permission === "granted"
            ? "Різкий рух — і застосунок обере випадкову страву. Або просто натисни кнопку."
            : permission === "prompt"
              ? "iOS вимагає окремого дозволу на доступ до датчиків руху. Кнопка нижче його запитає."
              : "Нічого страшного — кнопка працює завжди."}
        </p>

        {permission === "prompt" && (
          <Button className="mt-5" onClick={requestMotion}>
            <Smartphone size={17} />
            Дозволити рух
          </Button>
        )}

        <Button size="lg" className="mt-5 w-full max-w-xs" onClick={roll} loading={rolling}>
          <Hand size={19} />
          Обрати випадкову
        </Button>

        <AnimatePresence>
          {result && !rolling && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-6 w-full max-w-sm overflow-hidden rounded-xl3 border border-line bg-surface"
            >
              <Link href={`/recipe/${result.id}`} className="flex items-center gap-3 p-3">
                <RecipeMedia
                  recipe={result}
                  className="h-16 w-16 shrink-0"
                  rounded="rounded-2xl"
                  emojiSize="text-3xl"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-display text-[16px] font-bold">{result.title}</h3>
                  <p className="truncate text-[12px] text-muted">
                    {formatMinutes(result.timeMin)} · {result.cuisine}
                  </p>
                </div>
              </Link>
              <div className="flex gap-2 px-3 pb-3">
                <Link href={`/recipe/${result.id}`} className="flex-1">
                  <Button variant="secondary" full size="sm">
                    Рецепт
                  </Button>
                </Link>
                <Link href={`/recipe/${result.id}/cook`} className="flex-1">
                  <Button full size="sm">
                    Готувати
                  </Button>
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        value={filters}
        onChange={setFilters}
        resultCount={pool.length}
      />
    </div>
  );
}
