import { ing } from "@/data/ingredients";
import { ingredientGrams } from "./nutrition";
import type { PantryItem, Recipe, Unit } from "./types";
import { formatQuantity, sumQuantities, unitDef } from "./units";

/**
 * Списання продуктів із комори після приготування.
 *
 * Комора має відповідати холодильнику, а не історії покупок: якщо на сік
 * пішло 200 мл, у літровій пачці лишається 800, а не літр. Без цього
 * підбір рецептів за вмістом холодильника з часом починає брехати —
 * він упевнений, що продукт є, хоча той давно закінчився.
 */

/** Що саме списали з одного продукту. */
export interface Consumed {
  key: string;
  label: string;
  emoji: string;
  /** Скільки пішло на страву: «200 мл». */
  used: string;
  /** Скільки лишилось: «800 мл». null — продукт закінчився. */
  left: string | null;
}

export interface Consumption {
  pantry: PantryItem[];
  consumed: Consumed[];
}

/**
 * Скільки важить одна одиниця цього продукту.
 *
 * Через грами зводимо різні міри до спільного знаменника: у коморі може
 * лежати «1 л», а рецепт просити «1 склянку». null — перевести не вдалося
 * (штуки продукту, для якого не відома вага однієї).
 */
function gramsPerUnit(key: string, unit: Unit): number | null {
  return ingredientGrams({ key, amount: 1, unit });
}

/**
 * Віднімає від комори те, що пішло на рецепт.
 *
 * Не чіпаємо продукт, якщо:
 *   — кількість у коморі не вказана (не знаємо, скільки було);
 *   — кількість у рецепті не переводиться у вагу («за смаком»);
 *   — інгредієнт позначено «за бажанням» — його могли й не класти.
 *
 * `factor` — множник порцій, якщо готували не на стандартну кількість.
 */
export function consumeForRecipe(
  pantry: PantryItem[],
  recipe: Recipe,
  factor = 1,
): Consumption {
  const consumed: Consumed[] = [];
  const next: PantryItem[] = [];

  for (const item of pantry) {
    const used = recipe.ingredients.find((i) => i.key === item.key && !i.optional);
    const unit = item.unit;

    if (!used || item.amount == null || !unit) {
      next.push(item);
      continue;
    }

    const needGrams = ingredientGrams(used);
    const perUnit = gramsPerUnit(item.key, unit);
    if (needGrams == null || !perUnit) {
      next.push(item);
      continue;
    }

    const def = ing(item.key);
    const haveGrams = item.amount * perUnit;
    const leftGrams = haveGrams - needGrams * factor;
    const decimals = unitDef(unit).decimals;
    const leftAmount = Number((leftGrams / perUnit).toFixed(decimals));

    // Використану кількість показуємо в одиницях комори — так її видно
    // в тих самих цифрах, що й залишок.
    const usedLabel = formatQuantity(
      Number(((needGrams * factor) / perUnit).toFixed(decimals)),
      unit,
    );

    if (leftAmount > 0) {
      next.push({ ...item, amount: leftAmount });
      consumed.push({
        key: item.key,
        label: item.label ?? def.label,
        emoji: def.emoji,
        used: usedLabel,
        left: formatQuantity(leftAmount, unit),
      });
    } else {
      // Продукт закінчився — прибираємо з комори разом зі строком придатності.
      consumed.push({
        key: item.key,
        label: item.label ?? def.label,
        emoji: def.emoji,
        used: usedLabel,
        left: null,
      });
    }
  }

  return { pantry: next, consumed };
}

/* ── Поповнення комори ────────────────────────────────────────────────── */

/**
 * Зливає щойно принесений продукт із тим, що вже лежить у коморі.
 *
 * Просто покласти новий запис поверх старого не можна: у базі на пару
 * «користувач + продукт» є рівно один рядок, тож друга пачка молока з того
 * самого чека не додалась би, а витерла першу. Разом із нею зникли б і
 * строк придатності, і кількість, які людина вводила руками.
 *
 * Кількості складаємо через ту саму арифметику, що й список покупок: 900 г
 * і 900 г дають 1,8 кг. Коли міри не зводяться (штуки й грами), лишаємо те,
 * що було: чесної суми тут не існує, а вигадана гірша за стару правду.
 */
export function mergePantryItem(existing: PantryItem, incoming: PantryItem): PantryItem {
  const summable =
    existing.amount != null && existing.unit && incoming.amount != null && incoming.unit
      ? sumQuantities([
          { amount: existing.amount, unit: existing.unit },
          { amount: incoming.amount, unit: incoming.unit },
        ])
      : [];

  const total = summable.length === 1 && summable[0].amount != null ? summable[0] : null;
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
    // Назва й штрихкод — те, що людина вже бачить у коморі; чек їх не уточнює.
    label: existing.label ?? incoming.label,
    barcode: existing.barcode ?? incoming.barcode,
    // Строк придатності чек не містить взагалі, тож затирати ним нічого.
    expiresAt: existing.expiresAt ?? incoming.expiresAt,
  };
}
