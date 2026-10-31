"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Sheet, Spinner } from "@/components/ui";
import {
  RESTAURANTS,
  cachedMenu,
  loadMenu,
  restaurantById,
  type Restaurant,
  type RestaurantDish,
  type RestaurantId,
  type RestaurantMenu,
} from "@/data/restaurants";
import { amountLabel, dishById, filterMenu, restaurantOfProductId } from "@/lib/restaurants";
import { diaryUserId, useApp } from "@/lib/store";
import { formatNumber } from "@/lib/units";
import { cn, haptic } from "@/lib/utils";
import { restaurantIdsOf, useRestaurantMenus } from "./useRestaurantMenus";

/** Що вибрали: страва з меню закладу. */
export interface RestaurantPick {
  restaurant: Restaurant;
  menu: RestaurantMenu;
  dish: RestaurantDish;
}

/**
 * «З закладу»: великі плитки закладів → меню розділами з пошуком → страва.
 *
 * Меню закладу вантажиться лише тут, коли його відкрили. Вибрана страва
 * йде далі в RestaurantDishSheet (скільки порцій, коли, хто); після запису
 * повертаємось сюди ж, у те саме меню: у закладі рідко їдять одну страву —
 * бургер, картопля й напій записуються підряд.
 */
export function RestaurantSheet({
  open,
  onClose,
  initial,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** Одразу меню цього закладу — коли повертаємось після запису страви. */
  initial?: RestaurantId;
  onPick: (pick: RestaurantPick) => void;
}) {
  const [current, setCurrent] = useState<RestaurantId | null>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    setCurrent(initial ?? null);
    // Повернулись у те саме меню — пошук лишаємо: «соус» шукали не для одного соусу.
    if (!initial) setQuery("");
    // Лише на відкритті.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!current) {
      setMenu(null);
      return;
    }
    let alive = true;
    setFailed(false);
    setMenu(cachedMenu(current) ?? null);
    loadMenu(current)
      .then((m) => alive && setMenu(m))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [current, attempt]);

  const restaurant = current ? restaurantById(current) : undefined;
  const shown = useMemo(() => (menu ? filterMenu(menu, query) : null), [menu, query]);

  const choose = (id: RestaurantId) => {
    haptic(10);
    setQuery("");
    setCurrent(id);
  };

  const pick = (dish: RestaurantDish) => {
    if (!restaurant || !menu) return;
    haptic(10);
    onPick({ restaurant, menu, dish });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        restaurant ? (
          <span className="flex min-w-0 items-center gap-2.5">
            <button
              aria-label="До закладів"
              onClick={() => {
                haptic(8);
                setCurrent(null);
              }}
              className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-surface-2 active:bg-line"
            >
              <ChevronLeft size={18} />
            </button>
            <RestaurantLogo restaurant={restaurant} className="h-[38px] w-[38px] rounded-[10px] p-1" />
            <span className="min-w-0 truncate">{restaurant.name}</span>
          </span>
        ) : (
          "З закладу"
        )
      }
    >
      {!restaurant ? (
        <RestaurantGrid onChoose={choose} onPick={onPick} />
      ) : (
        <div className="flex flex-col gap-3 pb-4">
          <label className="flex h-[46px] items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5">
            <Search size={18} className="shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Що їв у ${restaurant.name}?`}
              aria-label="Пошук у меню"
              enterKeyHint="search"
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-faint"
            />
            {query && (
              <button aria-label="Очистити пошук" onClick={() => setQuery("")} className="shrink-0 text-faint">
                <X size={17} />
              </button>
            )}
          </label>

          {restaurant.kcalOnly && (
            <p className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-[12.5px] leading-snug text-muted">
              Заклад публікує лише калорії — білки, жири й вуглеводи цих страв не рахуються.
            </p>
          )}

          {failed ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-[14px] font-semibold text-muted">Не вдалося відкрити меню</p>
              <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                Спробувати ще
              </Button>
            </div>
          ) : !shown ? (
            <div className="grid place-items-center py-12">
              <Spinner />
            </div>
          ) : shown.categories.length === 0 ? (
            <p className="py-10 text-center text-[14px] font-semibold text-muted">
              У меню {restaurant.name} такого немає
            </p>
          ) : (
            shown.categories.map((c) => (
              <section key={c.name}>
                <h3 className="mb-1.5 px-0.5 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">
                  {c.name}
                </h3>
                <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
                  {c.dishes.map((d) => (
                    <DishRow key={d.key} dish={d} onClick={() => pick(d)} />
                  ))}
                </div>
              </section>
            ))
          )}

          <p className="px-0.5 pt-1 text-[11px] leading-snug text-faint">
            Числа — з офіційного джерела:{" "}
            <a href={restaurant.source.url} target="_blank" rel="noreferrer" className="underline">
              {restaurant.source.label}
            </a>
            , станом на {restaurant.source.fetched.split("-").reverse().join(".")}.
          </p>
        </div>
      )}
    </Sheet>
  );
}

/** Плитки закладів і нещодавні страви з них — щоб улюблене було за один дотик. */
function RestaurantGrid({
  onChoose,
  onPick,
}: {
  onChoose: (id: RestaurantId) => void;
  onPick: (pick: RestaurantPick) => void;
}) {
  const account = useApp((s) => s.account);
  const foodLog = useApp((s) => s.foodLog);
  const me = diaryUserId({ account });

  /** Останні різні страви із закладів, що їв сам. */
  const recentEntries = useMemo(() => {
    const seen = new Set<string>();
    return foodLog
      .filter((e) => e.userId === me && restaurantOfProductId(e.productId))
      .sort((a, b) => b.eatenAt.localeCompare(a.eatenAt))
      .filter((e) => {
        if (seen.has(e.productId as string)) return false;
        seen.add(e.productId as string);
        return true;
      })
      .slice(0, 6);
  }, [foodLog, me]);

  const menus = useRestaurantMenus(restaurantIdsOf(recentEntries));
  const recent = recentEntries.flatMap((e) => {
    const restaurant = restaurantOfProductId(e.productId);
    const menu = restaurant ? menus[restaurant.id] : undefined;
    const dish = restaurant && menu ? dishById(menu, restaurant.id, e.productId as string) : undefined;
    return restaurant && menu && dish ? [{ restaurant, menu, dish }] : [];
  });

  return (
    <div className="flex flex-col gap-5 pb-4">
      <div className="grid grid-cols-3 gap-2">
        {RESTAURANTS.map((r) => (
          <button
            key={r.id}
            onClick={() => onChoose(r.id)}
            className="flex flex-col items-center gap-2 rounded-[10px] border border-line bg-surface px-2 pb-3 pt-3.5 active:bg-surface-2"
          >
            <RestaurantLogo restaurant={r} className="h-14 w-14 rounded-[12px] p-1.5" />
            <span className="text-center text-[12.5px] font-bold leading-tight">{r.name}</span>
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <section>
          <h3 className="mb-1.5 px-0.5 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">
            Нещодавнє
          </h3>
          <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
            {recent.map((p) => (
              <button
                key={`${p.restaurant.id}:${p.dish.key}`}
                onClick={() => {
                  haptic(10);
                  onPick(p);
                }}
                className="flex w-full items-center gap-3 border-t border-line px-3 py-2.5 text-left first:border-t-0 active:bg-surface-2"
              >
                <RestaurantLogo restaurant={p.restaurant} className="h-9 w-9 shrink-0 rounded-[8px] p-1" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{p.dish.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">{p.restaurant.name}</span>
                </span>
                <span className="shrink-0 text-[13px] font-bold">
                  {formatNumber(p.dish.kcal, 0)} <span className="text-[11px] font-semibold text-faint">ккал</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DishRow({ dish, onClick }: { dish: RestaurantDish; onClick: () => void }) {
  const macros =
    dish.protein != null && dish.fat != null && dish.carbs != null
      ? `Б ${formatNumber(dish.protein, 1)} · Ж ${formatNumber(dish.fat, 1)} · В ${formatNumber(dish.carbs, 1)}`
      : "";
  const meta = [amountLabel(dish), macros].filter(Boolean).join(" · ");
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 border-t border-line px-3 py-2.5 text-left first:border-t-0 active:bg-surface-2"
    >
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[14px] font-semibold leading-snug">{dish.name}</span>
        {meta && <span className="mt-0.5 block truncate text-[11.5px] text-muted">{meta}</span>}
      </span>
      <span className="shrink-0 text-right text-[13px] font-bold">
        {formatNumber(dish.kcal, 0)} <span className="text-[11px] font-semibold text-faint">ккал</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-faint" />
    </button>
  );
}

/**
 * Логотип на білій плашці: логотипи з сайтів закладів зроблені під світле тло.
 * Не завантажився — плитка фірмового кольору з першою літерою назви.
 */
export function RestaurantLogo({ restaurant, className }: { restaurant: Restaurant; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span
        style={{ backgroundColor: restaurant.color }}
        className={cn("grid place-items-center font-display text-[15px] font-extrabold text-white", className)}
        aria-hidden
      >
        {restaurant.name.slice(0, 1)}
      </span>
    );
  }
  return (
    <span className={cn("grid place-items-center overflow-hidden bg-white", className)}>
      {/* Маленькі статичні PNG із public/ — next/image тут нічого не дасть. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={restaurant.logo}
        alt={restaurant.name}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
