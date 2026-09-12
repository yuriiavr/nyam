import { ing } from "@/data/ingredients";
import type { Recipe, ShoppingItem, Unit } from "./types";
import {
  formatQuantity,
  quantityOf,
  scaleAmount,
  sumQuantities,
  unitDef,
} from "./units";
import { newId } from "./utils";

/**
 * Список покупок.
 *
 * Це не похідна від плану на тиждень, як було досі, а власний список, який
 * переживає перезапуск і ходить із тобою в магазин. Різниця не в даних, а в
 * тому, що з ним роблять: план відповідає на питання «що готувати», а цей
 * список — «що взяти з полиці», і в нього дописують від руки те, до чого
 * застосунку діла немає: батарейки, воду коту, щось до чаю.
 *
 * Тому тут дві породи рядків. Позиція з каталогу знає свій відділ, емодзі й
 * одиниці — її можна скласти з тим, що просить рецепт, і перенести в комору.
 * Довільний запис не знає нічого, крім власного тексту, і саме це від нього
 * й потрібно.
 */

/** Назва для показу: каталог, уточнення або просто те, що написали. */
export function shoppingLabel(item: ShoppingItem): string {
  if (item.text) return item.text;
  if (item.key) return ing(item.key).label;
  return "Без назви";
}

export function shoppingEmoji(item: ShoppingItem): string {
  return item.key ? ing(item.key).emoji : "📝";
}

/**
 * Кількість словами: «500 г». Порожньо, якщо її ніхто не називав.
 *
 * Саме число тут і є кількістю: одиниця без нього — це «г» на ціннику, тобто
 * не відповідь на питання «скільки брати». Такий рядок показуємо як
 * ненаповнений, щоб на нього можна було натиснути й дописати число.
 */
export function shoppingQtyLabel(item: ShoppingItem): string {
  if (item.amount == null) return "";
  return formatQuantity(item.amount, item.unit);
}

/**
 * Чим два рядки вважаються тим самим.
 *
 * Каталожні зводяться за ключем: 200 г борошна з одного рецепта і 300 г з
 * іншого — це «500 г борошна», а не два рядки поруч. Довільні — за самим
 * текстом без регістру й зайвих пробілів: «Батарейки» і «батарейки » це
 * одне й те саме, а от «батарейки ААА» — уже інше, і вгадувати тут не треба.
 */
export function shoppingIdentity(item: ShoppingItem): string {
  if (item.key) return `key:${item.key}`;
  return `text:${(item.text ?? "").trim().toLowerCase()}`;
}

/**
 * Зливає нову позицію з тією, що вже в списку.
 *
 * Кількості складаємо тією самою арифметикою, що й комора: 900 г і 900 г
 * дають 1,8 кг. Коли міри не зводяться (штуки й грами), лишаємо те, що вже
 * стояло: чесної суми тут немає, а вигадана гірша за стару правду.
 */
export function mergeShoppingItem(
  existing: ShoppingItem,
  incoming: ShoppingItem,
): ShoppingItem {
  const summable =
    existing.amount != null &&
    existing.unit &&
    incoming.amount != null &&
    incoming.unit
      ? sumQuantities([
          { amount: existing.amount, unit: existing.unit },
          { amount: incoming.amount, unit: incoming.unit },
        ])
      : [];

  const total =
    summable.length === 1 && summable[0].amount != null ? summable[0] : null;
  const quantity =
    total ??
    (existing.amount == null
      ? { amount: incoming.amount, unit: incoming.unit ?? existing.unit }
      : { amount: existing.amount, unit: existing.unit });

  return {
    ...existing,
    amount:
      quantity.amount != null && quantity.unit
        ? Number(quantity.amount.toFixed(unitDef(quantity.unit).decimals))
        : quantity.amount,
    unit: quantity.unit,
    text: existing.text ?? incoming.text,
    recipeId: existing.recipeId ?? incoming.recipeId,
  };
}

/**
 * Що треба докупити для цієї страви.
 *
 * Береться список того, чого немає в коморі, і кількість із рецепта — уже
 * перерахована на обрану кількість порцій. Якщо в рецепті кількість не
 * названа («за смаком», «трохи»), позиція все одно потрапляє в список, просто
 * без числа: купити сіль треба, навіть коли невідомо скільки.
 */
export function itemsForRecipe(
  recipe: Recipe,
  missingKeys: string[],
  factor = 1,
): ShoppingItem[] {
  const wanted = new Set(missingKeys);
  const addedAt = new Date().toISOString();

  return recipe.ingredients
    .filter((item) => wanted.has(item.key))
    .map((item) => {
      const q = quantityOf(item);
      const unit: Unit | undefined = q?.unit;
      const amount =
        q?.amount != null && unit
          ? scaleAmount(q.amount, unit, factor)
          : undefined;

      return {
        id: newId(),
        key: item.key,
        // Назву з етикетки зберігаємо: «Сир President» у магазині шукають
        // очима, а не за загальною категорією «сир».
        text: item.label,
        amount,
        /*
         * Одиниця без числа — не кількість, а «г» на ціннику, тож у списку
         * лишається сам продукт. «За смаком» відпадає з тієї ж причини: це
         * вказівка кухарю, а не мірка на вагах.
         */
        unit: amount == null || unit === "taste" ? undefined : unit,
        done: false,
        addedAt,
        source: "recipe" as const,
        recipeId: recipe.id,
      };
    });
}

/**
 * Котру з незведених кількостей нести в список.
 *
 * `sumQuantities` повертає окремий запис на кожну міру, яку не вдалося
 * звести: «500 г» і «2 ст. л.» лишаються поруч, бо ложка борошна — не грам.
 * У рядку списку місце одне, і брати першу-ліпшу не можна: перша там та,
 * чий рецепт трапився раніше в тижні, тобто випадкова.
 *
 * Вага й обсяг важливіші за все інше: саме їх пишуть на упаковках, і саме
 * ними міряють на вагах у магазині. Далі штуки, і вже потім ложки та
 * жмені — міри кухонні, а не крамничні.
 */
const UNIT_RANK: Partial<Record<Unit, number>> = {
  kg: 0,
  g: 0,
  l: 0,
  ml: 0,
  pcs: 1,
  clove: 1,
  bunch: 1,
  handful: 2,
  cup: 2,
  tbsp: 3,
  tsp: 3,
  pinch: 3,
};

export function pickQuantity(
  quantities: Array<{ amount?: number; unit: Unit }>,
): { amount?: number; unit: Unit } | undefined {
  const numbered = quantities.filter((q) => q.amount != null);
  if (numbered.length === 0) return undefined;
  return [...numbered].sort(
    (a, b) => (UNIT_RANK[a.unit] ?? 9) - (UNIT_RANK[b.unit] ?? 9),
  )[0];
}

/** Довільний рядок: те, чого в каталозі немає й не має бути. */
export function freeItem(text: string): ShoppingItem {
  return {
    id: newId(),
    text: text.trim(),
    done: false,
    addedAt: new Date().toISOString(),
    source: "manual",
  };
}

/** Позиція з каталогу, додана вручну. */
export function catalogItem(
  key: string,
  quantity?: { amount?: number; unit?: Unit },
): ShoppingItem {
  return {
    id: newId(),
    key,
    amount: quantity?.amount,
    unit: quantity?.unit,
    done: false,
    addedAt: new Date().toISOString(),
    source: "manual",
  };
}
