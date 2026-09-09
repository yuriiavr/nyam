#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка розрахунків одиниць і калорій.
 *
 * Запуск: npm run check:nutrition
 *
 * jiti потрібен, щоб виконати TypeScript-модулі з аліасом "@/" напряму,
 * без окремого кроку збірки.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const units = await jiti.import(path.join(root, "src/lib/units.ts"));
const nutrition = await jiti.import(path.join(root, "src/lib/nutrition.ts"));

let pass = 0;
let fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}\n      отримано: ${JSON.stringify(actual)}\n      очікувано: ${JSON.stringify(expected)}`);
  }
};

console.log("── Одиниці ──");

// Сумування ваги з підйомом у кілограми
check(
  "200 г + 300 г = 500 г",
  units.formatSummed(units.sumQuantities([{ amount: 200, unit: "g" }, { amount: 300, unit: "g" }])),
  "500 г",
);
check(
  "800 г + 400 г = 1,2 кг",
  units.formatSummed(units.sumQuantities([{ amount: 800, unit: "g" }, { amount: 400, unit: "g" }])),
  "1,2 кг",
);
check(
  "1 кг + 500 г = 1,5 кг",
  units.formatSummed(units.sumQuantities([{ amount: 1, unit: "kg" }, { amount: 500, unit: "g" }])),
  "1,5 кг",
);
check(
  "мл і л зводяться разом",
  units.formatSummed(units.sumQuantities([{ amount: 1.5, unit: "l" }, { amount: 500, unit: "ml" }])),
  "2 л",
);
// Різні родини не змішуються
check(
  "шт і ст. л. лишаються окремо",
  units.formatSummed(units.sumQuantities([{ amount: 2, unit: "pcs" }, { amount: 1, unit: "tbsp" }])),
  "2 шт · 1 ст. л.",
);

// Розбір старих рядків
check("парсинг «200 г»", units.parseQty("200 г"), { amount: 200, unit: "g" });
check("парсинг «2 шт»", units.parseQty("2 шт"), { amount: 2, unit: "pcs" });
check("парсинг «1 ст. л.»", units.parseQty("1 ст. л."), { amount: 1, unit: "tbsp" });
check("парсинг «за смаком»", units.parseQty("за смаком"), { unit: "taste" });
check("сміття не парситься", units.parseQty("трохи"), null);

// Масштабування порцій
check(
  "200 г ×2 = 400 г",
  units.ingredientQtyLabel({ key: "boroshno", amount: 200, unit: "g" }, 2),
  "400 г",
);
check(
  "1 ч. л. ×0.5 = 0,5 ч. л.",
  units.ingredientQtyLabel({ key: "sil", amount: 1, unit: "tsp" }, 0.5),
  "0,5 ч. л.",
);
check(
  "старий текст теж масштабується",
  units.ingredientQtyLabel({ key: "syr", qty: "100 г" }, 2),
  "200 г",
);

// Регресія: кількість без одиниці. Форма зберігала amount без unit, якщо
// селект не чіпали руками, і кількість зникала з екрана.
check(
  "150 без одиниці → мл для молока",
  units.ingredientQtyLabel({ key: "moloko", amount: 150 }, 1),
  "150 мл",
);
check(
  "2 без одиниці → шт для яєць",
  units.ingredientQtyLabel({ key: "yajtsya", amount: 2 }, 1),
  "2 шт",
);
check(
  "200 без одиниці → г для борошна",
  units.ingredientQtyLabel({ key: "boroshno", amount: 200 }, 1),
  "200 г",
);
check(
  "без числа й одиниці нічого не вигадуємо",
  units.ingredientQtyLabel({ key: "moloko" }, 1),
  "",
);

console.log("── Калорії ──");

// Яйця: 60 г × 2 шт = 120 г, 155 ккал/100 г → 186 ккал
check("2 яйця = 120 г", nutrition.ingredientGrams({ key: "yajtsya", amount: 2, unit: "pcs" }), 120);
check("0,5 кг = 500 г", nutrition.ingredientGrams({ key: "kurka", amount: 0.5, unit: "kg" }), 500);
check("1 ст. л. олії = 15 г", nutrition.ingredientGrams({ key: "oliya", amount: 1, unit: "tbsp" }), 15);
check("«за смаком» не важить", nutrition.ingredientGrams({ key: "sil", unit: "taste" }), null);
check("150 мл молока без unit = 150 г", nutrition.ingredientGrams({ key: "moloko", amount: 150 }), 150);

// Рецепт: 200 г курячого філе (165 ккал/100г) + 100 г рису (360) на 2 порції
const recipe = {
  id: "t",
  authorId: "a",
  title: "Тест",
  description: "",
  emoji: "🍽️",
  gradient: ["#000", "#111"],
  image: null,
  cuisine: "Домашня",
  mealTypes: [],
  moods: [],
  tags: [],
  timeMin: 30,
  difficulty: 1,
  servings: 2,
  costLevel: 1,
  ingredients: [
    { key: "kurka", amount: 200, unit: "g" },
    { key: "rys", amount: 100, unit: "g" },
    { key: "sil", unit: "taste" },
  ],
  steps: [],
  createdAt: new Date().toISOString(),
  stats: { likes: 0, saves: 0, cooks: 0, ratingSum: 0, ratingCount: 0 },
};

const n = nutrition.recipeNutrition(recipe);
// 200 г курки = 330 ккал; 100 г рису = 360 ккал; разом 690; на порцію 345
check("всього ккал", n.total.kcal, 690);
check("на порцію", n.perServing.kcal, 345);
// білки: 31*2 + 7*1 = 69 г всього
check("білки всього", n.total.protein, 69);
check("покриття 100% (сіль не рахується)", n.coverage, 1);

// Денний підсумок
const today = new Date().toISOString();
const totals = nutrition.dayTotals(
  [{ recipeId: "t", at: today }, { recipeId: "t", at: today }],
  (id) => (id === "t" ? recipe : undefined),
);
check("дві порції за день", totals.kcal, 690);
check("страв за день", totals.meals, 2);

const yesterday = new Date(Date.now() - 86400000).toISOString();
const onlyToday = nutrition.dayTotals(
  [{ recipeId: "t", at: yesterday }],
  (id) => (id === "t" ? recipe : undefined),
);
check("вчорашнє не рахується", onlyToday.kcal, 0);

console.log(`\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
