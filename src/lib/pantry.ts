import { ing } from "@/data/ingredients";
import { ingredientGrams } from "./nutrition";
import type { PantryItem, Recipe, Unit } from "./types";
import { formatQuantity, unitDef } from "./units";

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
