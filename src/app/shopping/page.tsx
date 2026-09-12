"use client";

import { motion } from "framer-motion";
import { Check, Plus, Refrigerator, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { IngredientPicker } from "@/components/IngredientPicker";
import { TopBar } from "@/components/TopBar";
import {
  Button,
  EmptyState,
  QuantityInput,
  Sheet,
  useToast,
} from "@/components/ui";
import { INGREDIENTS, ing } from "@/data/ingredients";
import { byAisle, shoppingSuggestions } from "@/lib/matching";
import {
  catalogItem,
  freeItem,
  shoppingEmoji,
  shoppingLabel,
  shoppingQtyLabel,
} from "@/lib/shopping";
import { allRecipes, recipeById, useApp } from "@/lib/store";
import type { PantryItem, ShoppingItem } from "@/lib/types";
import { haptic, plural } from "@/lib/utils";

/**
 * Список покупок.
 *
 * Відповідає не на питання «що готувати», а на «що взяти з полиці», і саме
 * тому він власний, а не порахований з плану на тиждень. Похідний список не
 * відредагуєш: у нього не допишеш батарейки, воду коту й «щось до чаю», бо
 * при наступному перерахунку цього там не буде. А в магазин ходять з одним
 * списком, а не з двома.
 *
 * Порядок — за відділами магазину, а не за важливістю для готування: список,
 * зібраний так, не змушує вертатись через пів залу по забуту сметану.
 *
 * Куплене не зникає, а лишається викресленим до кінця походу: у касі
 * корисно бачити, що саме ти набрав, а не порожній екран.
 */
export default function ShoppingPage() {
  const shopping = useApp((s) => s.shopping);
  const pantry = useApp((s) => s.pantry);
  const myRecipes = useApp((s) => s.myRecipes);
  const remoteRecipes = useApp((s) => s.remoteRecipes);
  const hydrated = useApp((s) => s.hydrated);
  const addShopping = useApp((s) => s.addShopping);
  const toggleShopping = useApp((s) => s.toggleShopping);
  const removeShopping = useApp((s) => s.removeShopping);
  const clearBoughtShopping = useApp((s) => s.clearBoughtShopping);
  const importPantry = useApp((s) => s.importPantry);
  const toast = useToast();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const done = shopping.filter((x) => x.done);
  const aisles = useMemo(() => byAisle(shopping), [shopping]);

  /* Підпис «для „Карбонари“»: видно, заради чого це купують. */
  const recipeTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of shopping) {
      if (!item.recipeId || map.has(item.recipeId)) continue;
      const recipe = recipeById(useApp.getState(), item.recipeId);
      if (recipe) map.set(item.recipeId, recipe.title);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopping, myRecipes, remoteRecipes]);

  /**
   * Чого немає вдома.
   *
   * Спершу те, що відкриває страви: продукт, якого бракує трьом майже готовим
   * рецептам, вартий місця в кошику більше за випадковий. Далі базове — сіль
   * і олія, не позначені в коморі. Те, що вже в списку, не пропонуємо.
   */
  const suggestions = useMemo(() => {
    if (!hydrated) return [];
    const state = useApp.getState();
    const have = state.pantry.map((p) => p.key);
    const listed = new Set(
      shopping.filter((x) => !x.done && x.key).map((x) => x.key),
    );

    const unlocking = shoppingSuggestions(allRecipes(state), have, 8);
    const staples = INGREDIENTS.filter(
      (d) => d.staple && !have.includes(d.key),
    ).map((d) => ({
      key: d.key,
      unlocks: 0,
    }));

    const seen = new Set<string>();
    const out: Array<{ key: string; unlocks: number }> = [];
    for (const candidate of [...unlocking, ...staples]) {
      if (listed.has(candidate.key) || seen.has(candidate.key)) continue;
      seen.add(candidate.key);
      out.push(candidate);
      if (out.length >= 8) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, shopping, pantry, myRecipes, remoteRecipes]);

  const addOne = (item: ShoppingItem, name: string) => {
    haptic(12);
    const { fresh } = addShopping([item]);
    toast(fresh > 0 ? `${name} у списку` : `${name} уже в списку`, "🛒");
  };

  /**
   * Куплене — в комору.
   *
   * Разом із кількістю: «500 г» щойно порахував сам застосунок, і викидати
   * це число означало б, що комора знову не знає, скільки чого вдома.
   */
  const moveToPantry = () => {
    const items: PantryItem[] = done
      .filter((x) => x.key)
      .map((x) => ({
        key: x.key as string,
        label: x.text,
        amount: x.amount,
        unit: x.unit,
        addedAt: new Date().toISOString(),
      }));

    haptic(16);
    if (items.length > 0) importPantry(items);
    clearBoughtShopping();

    /*
     * Пишемо рівно те, що сталось. Довільні записи в комору не їдуть — вона
     * про продукти, — тож коли куплені були тільки вони, «у коморі» було б
     * неправдою, як і «список очищено», якщо в ньому ще щось лишилось.
     */
    const free = done.length - items.length;
    const left = shopping.length - done.length;
    toast(
      items.length > 0
        ? `${items.length} ${plural(items.length, "продукт", "продукти", "продуктів")} у коморі${free > 0 ? ` · ${free} викреслено` : ""}`
        : left === 0
          ? "Список очищено"
          : `${done.length} ${plural(done.length, "позицію", "позиції", "позицій")} викреслено`,
      items.length > 0 ? "🧊" : "🧹",
    );
  };

  const item = shopping.find((x) => x.id === editing) ?? null;

  return (
    <div className="pb-8">
      <TopBar
        title="Список покупок"
        subtitle={
          shopping.length
            ? `${shopping.length} ${plural(shopping.length, "позиція", "позиції", "позицій")}${done.length ? ` · ${done.length} у кошику` : ""}`
            : "Що взяти в магазині"
        }
        right={
          <button
            onClick={() => {
              haptic(12);
              setPickerOpen(true);
            }}
            aria-label="Додати в список"
            className="grid h-10 w-10 place-items-center rounded-2xl brand-gradient text-brand-ink"
          >
            <Plus size={19} />
          </button>
        }
      />

      {hydrated && shopping.length === 0 ? (
        <EmptyState
          emoji="🛒"
          title="Список порожній"
          note="Додай, що треба купити: продукт із довідника або будь-що своє — батарейки, воду коту, щось до чаю. А зі сторінки страви сюди можна перенести все, чого бракує на неї."
          action={
            <Button onClick={() => setPickerOpen(true)}>Додати позицію</Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-5 px-4 pt-4">
          {aisles.map(({ cat, label, items }) => (
            <section key={cat}>
              <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-muted">
                {label}
              </h2>
              <div className="flex flex-col gap-2">
                {items.map((entry) => (
                  <Row
                    key={entry.id}
                    item={entry}
                    forRecipe={
                      entry.recipeId
                        ? recipeTitles.get(entry.recipeId)
                        : undefined
                    }
                    onToggle={() => {
                      haptic(8);
                      toggleShopping(entry.id);
                    }}
                    onEdit={() => setEditing(entry.id)}
                    onRemove={() => {
                      haptic(10);
                      removeShopping(entry.id);
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Чого немає вдома */}
      {suggestions.length > 0 && (
        <section className="px-4 pt-7">
          <h2 className="font-display text-[17px] font-bold">
            Чого немає вдома
          </h2>
          <p className="mb-3 mt-0.5 text-[11.5px] leading-snug text-faint">
            Продукти, яких немає в коморі. Спершу ті, що відкривають страви.
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map(({ key, unlocks }) => {
              const def = ing(key);
              return (
                <button
                  key={key}
                  onClick={() => addOne(catalogItem(key), def.label)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-2 pl-3 pr-3 text-[13px] font-semibold active:bg-surface-2"
                >
                  <span>{def.emoji}</span>
                  {def.label}
                  {unlocks > 0 && (
                    <span className="text-[11px] font-bold text-brand">
                      +{unlocks} {plural(unlocks, "страва", "страви", "страв")}
                    </span>
                  )}
                  <Plus size={13} className="text-brand" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Кінець походу */}
      {done.length > 0 && (
        <section className="flex flex-col gap-2 px-4 pt-7">
          <Button full size="lg" onClick={moveToPantry}>
            <Refrigerator size={18} />
            Перенести куплене в комору ({done.length})
          </Button>
          <Button
            full
            variant="secondary"
            onClick={() => {
              haptic(10);
              clearBoughtShopping();
              toast("Куплене прибрано", "🧹");
            }}
          >
            <Trash2 size={17} />
            Просто прибрати куплене
          </Button>
        </section>
      )}

      {shopping.length > 0 && (
        <p className="px-4 pt-6 text-center text-[11.5px] leading-snug text-faint">
          Список спільний із сімʼєю: те, що ти викреслив у магазині, вдома видно
          одразу.{" "}
          <Link href="/pantry" className="font-bold text-brand">
            Комора
          </Link>
        </p>
      )}

      <IngredientPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Що купити"
        onPick={(def) => addOne(catalogItem(def.key), def.label)}
        onFree={(text) => addOne(freeItem(text), text)}
        freeHint="Додати в список як є — це не продукт із довідника"
      />

      <ItemSheet
        item={item}
        onClose={() => setEditing(null)}
        onRemove={() => {
          if (!item) return;
          removeShopping(item.id);
          setEditing(null);
        }}
      />
    </div>
  );
}

/**
 * Рядок списку.
 *
 * Ціль для пальця — увесь рядок: у магазині тикають однією рукою, тримаючи
 * другою кошик. Кількість і хрестик — окремі кнопки поменше, бо помилково
 * викреслити не страшно, а помилково стерти — прикро.
 */
function Row({
  item,
  forRecipe,
  onToggle,
  onEdit,
  onRemove,
}: {
  item: ShoppingItem;
  forRecipe?: string;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const qty = shoppingQtyLabel(item);

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border pr-2 ${
        item.done ? "border-mint/40 bg-mint/8" : "border-line bg-surface"
      }`}
    >
      <motion.button
        whileTap={{ scale: 0.985 }}
        onClick={onToggle}
        aria-pressed={item.done}
        className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
      >
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
            item.done ? "border-mint bg-mint text-bg" : "border-line"
          }`}
        >
          {item.done && <Check size={13} strokeWidth={3} />}
        </span>
        <span className="text-lg">{shoppingEmoji(item)}</span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[14px] font-semibold ${
              item.done ? "line-through opacity-60" : ""
            }`}
          >
            {shoppingLabel(item)}
          </span>
          {forRecipe && (
            <span className="block truncate text-[11px] text-muted">
              для «{forRecipe}»
            </span>
          )}
        </span>
      </motion.button>

      <button
        onClick={onEdit}
        aria-label={`Кількість: ${shoppingLabel(item)}`}
        className={`shrink-0 rounded-xl px-2 py-1.5 text-[12px] font-bold ${
          qty
            ? "bg-surface-2 text-muted"
            : "border border-dashed border-line text-faint"
        }`}
      >
        {qty || "скільки?"}
      </button>

      <button
        onClick={onRemove}
        aria-label={`Прибрати ${shoppingLabel(item)}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint active:bg-surface-2"
      >
        <X size={15} />
      </button>
    </div>
  );
}

/** Скільки брати й чи треба взагалі. Назву правимо лише у власних записах. */
function ItemSheet({
  item,
  onClose,
  onRemove,
}: {
  item: ShoppingItem | null;
  onClose: () => void;
  onRemove: () => void;
}) {
  const updateShopping = useApp((s) => s.updateShopping);

  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      title={item ? shoppingLabel(item) : ""}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onRemove}>
            <Trash2 size={16} />
            Прибрати
          </Button>
          <Button className="flex-[1.4]" onClick={onClose}>
            Готово
          </Button>
        </div>
      }
    >
      {item && (
        <div className="flex flex-col gap-4 pb-2">
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">
              Скільки брати
            </p>
            <QuantityInput
              amount={item.amount}
              unit={item.unit}
              defaultUnit={
                item.key ? (ing(item.key).defaultUnit ?? "g") : "pcs"
              }
              allowTaste={false}
              label={shoppingLabel(item)}
              onChange={({ amount, unit }) =>
                updateShopping(item.id, { amount, unit })
              }
            />
            <p className="mt-2 text-[11.5px] leading-snug text-faint">
              Необовʼязково: «молоко» в списку зрозуміле й без числа.
            </p>
          </div>

          {!item.key && (
            <div>
              <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">
                Назва
              </p>
              <input
                value={item.text ?? ""}
                onChange={(e) =>
                  updateShopping(item.id, { text: e.target.value })
                }
                className="h-11 w-full rounded-2xl border border-line bg-surface px-3.5 text-[15px]"
              />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
