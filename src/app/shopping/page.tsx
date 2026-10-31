"use client";

import { Check, Plus, Refrigerator, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { IngredientPicker } from "@/components/IngredientPicker";
import { NewIngredientSheet } from "@/components/NewIngredientSheet";
import { TopBar } from "@/components/TopBar";
import { Button, Panel, PanelHeader, QuantityInput, Sheet, useToast } from "@/components/ui";
import { allIngredients, ing, satisfies } from "@/data/ingredients";
import { byAisle, shoppingSuggestions } from "@/lib/matching";
import {
  catalogItem,
  freeItem,
  shoppingEmoji,
  shoppingLabel,
  shoppingQtyLabel,
} from "@/lib/shopping";
import { allRecipes, pantryTypes, recipeById, useApp } from "@/lib/store";
import type { PantryItem, ShoppingItem } from "@/lib/types";
import { cn, haptic, newId, plural } from "@/lib/utils";

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
  /*
   * Підписка на каталог, дописаний людьми: сам опис лежить у реєстрі модуля,
   * і без цього рядка екран не дізнався б, що він нарешті приїхав, — власний
   * продукт показувався б сирим ключем до наступного дотику.
   */
  const customIngredients = useApp((s) => s.customIngredients);
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
  /** Назва для картки власного продукту; null — картка закрита. */
  const [creating, setCreating] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** Що пишуть у полі вгорі — далі воно ж пошук у пікері. */
  const [query, setQuery] = useState("");

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
    // Разом із загальнішими типами: є печериці — «Гриби» докуповувати не радимо.
    const have = pantryTypes(state);
    const listed = new Set(
      shopping.filter((x) => !x.done && x.key).map((x) => x.key),
    );

    const unlocking = shoppingSuggestions(allRecipes(state), have, 8);
    const staples = allIngredients().filter(
      (d) => d.staple && !have.has(d.key),
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
  }, [hydrated, shopping, pantry, myRecipes, remoteRecipes, customIngredients]);

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
    const addedAt = new Date().toISOString();
    const cached = Object.values(useApp.getState().products);
    const items: PantryItem[] = done
      .filter((x) => x.key)
      .map((x) => {
        const key = x.key as string;
        /*
         * Товар підставляємо лише за точним збігом назви з карткою в кеші, чий
         * тип годиться для рядка (B6): «Молоко Галичина 2,5%» у списку — це та
         * картка. Жодного «схоже»: список пишуть руками, і «молоко» не означає
         * конкретної пачки. І нічого не вчимо — рядок списку не доказ.
         */
        const text = x.text?.trim().toLocaleLowerCase("uk");
        const product = text
          ? cached.find(
              (p) =>
                !p.archived &&
                !p.mergedInto &&
                p.name.trim().toLocaleLowerCase("uk") === text &&
                satisfies(p.typeKey, key),
            )
          : undefined;
        return {
          // Кожна покупка — свій рядок комори; однакові пачки складе сам addPantry/importPantry.
          id: newId(),
          key: product?.typeKey ?? key,
          ...(product ? { productId: product.id } : {}),
          label: x.text,
          amount: x.amount,
          unit: x.unit,
          addedAt,
        };
      });

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

  const openPicker = () => {
    haptic(12);
    setPickerOpen(true);
  };

  return (
    <div className="pb-8">
      <TopBar
        title="Покупки"
        right={
          shopping.length > 0 ? (
            <span className="text-[12px] font-bold text-faint">
              {shopping.length - done.length > 0 ? `${shopping.length - done.length} купити` : "усе в кошику"}
            </span>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-2.5 px-4 md:px-6 lg:gap-3">
        {/* Додати: пишеш назву — далі пікер з довідником і «просто рядок» */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            openPicker();
          }}
          className="flex h-[46px] items-center gap-2.5 rounded-[10px] border border-line bg-surface pl-3.5 pr-1.5"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Додати: молоко, батарейки…"
            enterKeyHint="go"
            className="h-full min-w-0 flex-1 text-[15px] font-semibold"
          />
          <button
            type="submit"
            aria-label="Додати в список"
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[8px] brand-gradient text-brand-ink"
          >
            <Plus size={17} strokeWidth={2.6} />
          </button>
        </form>

        {hydrated && shopping.length === 0 && (
          <Panel>
            <p className="px-3.5 py-6 text-center text-[13px] font-semibold leading-relaxed text-muted">
              Список порожній. Додай продукт із довідника або будь-що своє — батарейки, воду коту. Зі сторінки страви
              сюди переноситься все, чого бракує.
            </p>
          </Panel>
        )}

        {/* Планшет (lg): відділи магазину стовпчиками — як ходиш між полицями */}
        <div className="contents lg:block lg:columns-3 lg:gap-3">
        {aisles.map(({ cat, label, items }) => (
          <Panel key={cat} className="lg:mb-3 lg:break-inside-avoid">
            <PanelHeader label={label} aside={`${items.filter((x) => x.done).length}/${items.length}`} />
            {items.map((entry) => (
              <Row
                key={entry.id}
                item={entry}
                forRecipe={entry.recipeId ? recipeTitles.get(entry.recipeId) : undefined}
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
          </Panel>
        ))}
        </div>

        {/* Кінець походу */}
        {done.length > 0 && (
          <div className="overflow-hidden rounded-[10px] border border-brand/35 bg-surface">
            <button
              onClick={moveToPantry}
              className="flex h-[52px] w-full items-center gap-2.5 px-3.5 text-left active:bg-surface-2"
            >
              <Refrigerator size={18} className="text-brand" />
              <span className="flex-1 text-[14px] font-bold text-brand">Куплене — у комору</span>
              <span className="text-[12px] font-bold text-faint">{done.length}</span>
            </button>
            <button
              onClick={() => {
                haptic(10);
                clearBoughtShopping();
                toast("Куплене прибрано", "🧹");
              }}
              className="flex h-11 w-full items-center gap-2.5 border-t border-line px-3.5 text-left active:bg-surface-2"
            >
              <Trash2 size={15} className="text-faint" />
              <span className="flex-1 text-[13px] font-semibold text-muted">Просто прибрати куплене</span>
            </button>
          </div>
        )}

        {/* Чого немає вдома */}
        {suggestions.length > 0 && (
          <Panel>
            <PanelHeader label="Чого немає вдома" />
            <div className="grid grid-cols-2 gap-px border-t border-line bg-line lg:grid-cols-4">
              {suggestions.map(({ key, unlocks }) => {
                const def = ing(key);
                return (
                  <button
                    key={key}
                    onClick={() => addOne(catalogItem(key), def.label)}
                    className="flex h-[50px] items-center gap-[9px] bg-surface pl-3 pr-2.5 text-left active:bg-surface-2"
                  >
                    <span className="text-[16px]">{def.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold">{def.label}</span>
                      {unlocks > 0 && (
                        <span className="block truncate text-[11px] font-bold text-brand">
                          +{unlocks} {plural(unlocks, "страва", "страви", "страв")}
                        </span>
                      )}
                    </span>
                    <Plus size={15} strokeWidth={2.4} className="shrink-0 text-muted" />
                  </button>
                );
              })}
            </div>
          </Panel>
        )}

        {shopping.length > 0 && (
          <p className="px-2 pt-1 text-center text-[11.5px] font-semibold leading-snug text-faint">
            Список спільний із сімʼєю: викреслене в магазині вдома видно одразу.
          </p>
        )}
      </div>

      <IngredientPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Що купити"
        query={query}
        onQueryChange={setQuery}
        onPick={(def) => {
          addOne(catalogItem(def.key), def.label);
          setQuery("");
        }}
        onFree={(text) => {
          addOne(freeItem(text), text);
          setQuery("");
        }}
        freeHint="Просто рядок у списку: батарейки, вода коту, щось до чаю"
        onCreate={(name) => {
          setPickerOpen(false);
          setCreating(name);
          setQuery("");
        }}
      />

      {/* Продукт, якого в каталозі не було */}
      <NewIngredientSheet
        open={creating !== null}
        initialName={creating ?? ""}
        onClose={() => setCreating(null)}
        onCreated={(def) => addOne(catalogItem(def.key), def.label)}
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
    <div className="flex min-h-[50px] items-center gap-1 border-t border-line pr-1.5">
      <button
        onClick={onToggle}
        aria-pressed={item.done}
        className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-2 pl-3.5 text-left"
      >
        <span
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] transition-colors",
            item.done ? "border-brand bg-brand text-brand-ink" : "border-line-strong",
          )}
        >
          {item.done && <Check size={12} strokeWidth={3.5} />}
        </span>
        <span className="text-[17px]">{shoppingEmoji(item)}</span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-[14px] font-semibold",
              item.done ? "text-faint line-through" : "text-ink",
            )}
          >
            {shoppingLabel(item)}
          </span>
          {forRecipe && (
            <span className="block truncate text-[11.5px] font-semibold text-faint">для «{forRecipe}»</span>
          )}
        </span>
      </button>

      <button
        onClick={onEdit}
        aria-label={`Кількість: ${shoppingLabel(item)}`}
        className={cn(
          "shrink-0 rounded-[8px] px-2 py-1.5 text-[12.5px] font-bold",
          qty ? "text-muted" : "border border-dashed border-line-strong text-faint",
        )}
      >
        {qty || "скільки?"}
      </button>

      <button
        onClick={onRemove}
        aria-label={`Прибрати ${shoppingLabel(item)}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-faint active:bg-surface-2"
      >
        <X size={14} strokeWidth={2.2} />
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
                className="h-11 w-full rounded-[10px] border border-line bg-surface px-3.5 text-[15px]"
              />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
