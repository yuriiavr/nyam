"use client";

import { Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CAT_LABEL,
  CAT_ORDER,
  allIngredients,
  ancestors,
  ing,
  isOwnKey,
  searchIngredients,
} from "@/data/ingredients";
import type { IngredientCat, IngredientDef } from "@/lib/types";
import { EditTypeButton } from "./EditTypeButton";
import { Sheet } from "./ui";

/**
 * Вибір продукту з довідника.
 *
 * Жив усередині комори, поки був потрібен лише їй; тепер із нього додають і
 * в список покупок, і туди ж — те, чого в довіднику немає. `onFree` саме про
 * це: якщо його передали, під пошуком зʼявляється рядок «додати як є», і
 * написане потрапляє туди, куди його просили, без спроби вгадати продукт.
 *
 * Вгадувати тут було б гірше за мовчання: «батарейки» не стануть їжею від
 * того, що ми підберемо до них найсхожіший запис у каталозі.
 */
export function IngredientPicker({
  open,
  onClose,
  title,
  onPick,
  onFree,
  onCreate,
  freeHint = "Додати як є",
  exclude = [],
  query: controlledQuery,
  onQueryChange,
  results,
  placeholder = "Помідор, курка, рис…",
  pickIcon = true,
  editOwn = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onPick: (def: IngredientDef) => void;
  /** Дозволяє дописати те, чого в каталозі немає. Немає — рядок не показуємо. */
  onFree?: (text: string) => void;
  /** Дозволяє створити повноцінний продукт у каталозі. */
  onCreate?: (name: string) => void;
  freeHint?: string;
  exclude?: string[];
  query?: string;
  onQueryChange?: (v: string) => void;
  results?: IngredientDef[];
  placeholder?: string;
  /*
   * «+» на кожному продукті читається як «додати в комору». Коли пікер лише
   * обирає тип (батька нового типу), плюс збиває з толку — тоді його немає.
   */
  pickIcon?: boolean;
  /**
   * Олівець біля дописаних типів — правка для всіх з історією (F7). Вимикаємо
   * там, де пікер сам живе всередині правки типу (батько, обʼєднання): третій
   * аркуш «Редагувати тип» поверх двох лише заплутав би.
   */
  editOwn?: boolean;
}) {
  const [localQuery, setLocalQuery] = useState("");
  const q = controlledQuery ?? localQuery;
  const setQ = onQueryChange ?? setLocalQuery;

  const list = useMemo(() => {
    const found = q.trim() ? (results ?? searchIngredients(q)) : allIngredients();
    // Обʼєднаний дописаний тип — лише псевдонім переможця: обирати його не можна, лише переможця.
    return found.filter((d) => !exclude.includes(d.key) && !d.mergedInto);
  }, [q, results, exclude]);

  const grouped = useMemo(() => {
    const map = new Map<IngredientCat, IngredientDef[]>();
    for (const d of list) map.set(d.cat, [...(map.get(d.cat) ?? []), d]);
    return CAT_ORDER.filter((c) => map.has(c)).map(
      (c) => [c, map.get(c)!] as const,
    );
  }, [list]);

  const typed = q.trim();

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="sticky top-0 z-10 -mx-5 mb-2 bg-bg-elev px-5 pb-3">
        <div className="flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5">
          <Search size={17} className="shrink-0 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className="h-full flex-1 text-[15px]"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Очистити">
              <X size={16} className="text-muted" />
            </button>
          )}
        </div>
      </div>

      {onFree && typed && (
        <button
          onClick={() => {
            onFree(typed);
            setQ("");
            onClose();
          }}
          className="mb-3 flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-brand/50 bg-brand/5 px-3.5 py-3 text-left"
        >
          <span className="text-lg">📝</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">
              «{typed}»
            </span>
            <span className="block text-[11.5px] text-muted">{freeHint}</span>
          </span>
          <Plus size={16} className="shrink-0 text-brand" />
        </button>
      )}

      {onCreate && typed && (
        <button
          onClick={() => {
            onCreate(typed);
            setQ("");
            onClose();
          }}
          className="mb-3 flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-line bg-surface px-3.5 py-3 text-left"
        >
          <span className="text-lg">📦</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">Створити «{typed}»</span>
            <span className="block text-[11.5px] text-muted">
              Свій продукт у каталозі — з мірою й калоріями
            </span>
          </span>
          <Plus size={16} className="shrink-0 text-brand" />
        </button>
      )}

      {list.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">
          {onFree || onCreate
            ? "У довіднику такого немає — але його можна створити рядком вище."
            : "Нічого не знайшлось. Спробуй іншу назву."}
        </p>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-muted">
                {CAT_LABEL[cat]}
              </h3>
              <div className="flex flex-wrap gap-2">
                {items.map((def) => {
                  const own = editOwn && isOwnKey(def.key);
                  const pick = (
                    <button
                      key={def.key}
                      onClick={() => {
                        onPick(def);
                        // Рядок пошуку скидаємо разом із вибором: продукт уже
                        // додано, і наступного разу аркуш має відкритись чистим.
                        setQ("");
                        onClose();
                      }}
                      className={
                        own
                          ? "inline-flex items-center gap-1.5 py-2 pl-3 pr-1 text-[13px] font-semibold"
                          : "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-2 pl-3 pr-3 text-[13px] font-semibold active:bg-surface-2"
                      }
                    >
                      <span>{def.emoji}</span>
                      {def.label}
                      {/* Різновид видно одразу: «Молоко безлактозне › Молоко» — і
                          ясно, що рецепти з молоком його теж рахують. */}
                      {ancestors(def.key).length > 0 && (
                        <span className="text-[11px] font-normal text-faint">
                          › {ing(ancestors(def.key)[0]).label}
                        </span>
                      )}
                      {pickIcon && <Plus size={13} className="text-brand" />}
                    </button>
                  );
                  // Дописаний тип: вибір і олівець — дві окремі кнопки в одному чипі (кнопка в кнопці недійсна).
                  return own ? (
                    <span
                      key={def.key}
                      className="inline-flex items-center rounded-full border border-line bg-surface pr-1 active:bg-surface-2"
                    >
                      {pick}
                      <EditTypeButton typeKey={def.key} icon />
                    </span>
                  ) : (
                    pick
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
