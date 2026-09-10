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
const pantry = await jiti.import(path.join(root, "src/lib/pantry.ts"));

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

// Регресія: одиниця з уточненням після неї. Стара версія вимагала, щоб увесь
// хвіст рядка був назвою одиниці, тож «400 г консервованого» не парсився
// зовсім — і 400 г нуту просто зникали з калорій хумусу.
check("уточнення після одиниці не ламає розбір", units.parseQty("400 г консервованого"), { amount: 400, unit: "g" });
check("«500 г маскарпоне»", units.parseQty("500 г маскарпоне"), { amount: 500, unit: "g" });
check("«300 мл міцної»", units.parseQty("300 мл міцної"), { amount: 300, unit: "ml" });
check("«180 мл теплої»", units.parseQty("180 мл теплої"), { amount: 180, unit: "ml" });

// Регресія: \w у регулярці не бачить кирилиці, тож усі відмінкові форми
// («щіпка», «жменя», «склянки») повз аліаси пролітали.
check("«щіпка» — це дрібка", units.parseQty("щіпка"), { amount: 1, unit: "pinch" });
check("«жменя» — це жменя", units.parseQty("жменя"), { amount: 1, unit: "handful" });
check("«2 склянки»", units.parseQty("2 склянки"), { amount: 2, unit: "cup" });
check("«3 штуки»", units.parseQty("3 штуки"), { amount: 3, unit: "pcs" });
check("«пучок» = один пучок", units.parseQty("пучок"), { amount: 1, unit: "bunch" });

// Побутові міри зводяться до штук — вагу однієї знає довідник
check("«2 зубчики»", units.parseQty("2 зубчики"), { amount: 2, unit: "pcs" });
check("«2 стейки»", units.parseQty("2 стейки"), { amount: 2, unit: "pcs" });
check("«2 скибки»", units.parseQty("2 скибки"), { amount: 2, unit: "pcs" });

// Дроби й діапазони
check("дріб «1/2»", units.parseQty("1/2 червоної"), { amount: 0.5, unit: "pcs" });
check("змішане «1 1/2 ст. л.»", units.parseQty("1 1/2 ст. л."), { amount: 1.5, unit: "tbsp" });
check("діапазон «2-3 шт» → середина", units.parseQty("2-3 шт"), { amount: 2.5, unit: "pcs" });

// Далі — не кількості, і вигадувати числа не можна
check("«для подачі» не кількість", units.parseQty("для подачі"), null);
check("«багато» не кількість", units.parseQty("багато"), null);
check("«кріп» не кількість", units.parseQty("кріп"), null);

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
// Ложки й склянки — за щільністю продукту, а не за плоскою таблицею:
// склянка борошна це 120 г, а не 240, як у води.
check("1 ст. л. олії = 13,6 г", nutrition.ingredientGrams({ key: "oliya", amount: 1, unit: "tbsp" }), 218 / 16);
check("1 скл. борошна = 120 г", nutrition.ingredientGrams({ key: "boroshno", amount: 1, unit: "cup" }), 120);
check("1 ст. л. борошна = 7,5 г", nutrition.ingredientGrams({ key: "boroshno", amount: 1, unit: "tbsp" }), 7.5);
check("1 скл. цукру = 200 г", nutrition.ingredientGrams({ key: "tsukor", amount: 1, unit: "cup" }), 200);
// Для продукту без відомої щільності лишається запасне значення по воді
check("1 скл. невідомого = 240 г", nutrition.ingredientGrams({ key: "kapusta", amount: 1, unit: "cup" }), 240);
check("2 зубчики часнику = 6 г", nutrition.ingredientGrams({ key: "chasnyk", qty: "2 зубчики" }), 6);
check("24 савоярді = 288 г", nutrition.ingredientGrams({ key: "savoyardi", qty: "24 шт" }), 288);
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

// Регресія покриття: раніше базові продукти потрапляли в чисельник, але не
// в знаменник, і покриття виходило 100% навіть коли інгредієнт випав.
const halfKnown = {
  ...recipe,
  ingredients: [
    { key: "kurka", amount: 200, unit: "g" },
    { key: "maslo", amount: 20, unit: "g" },
    { key: "sil", unit: "taste" },
    { key: "gorikhy", qty: "для подачі" },
  ],
};
const hk = nutrition.recipeNutrition(halfKnown);
check("покриття не бреше", hk.coverage, 2 / 3);
check("непораховане названо", hk.skipped, ["Горіхи"]);
check("сіль не псує покриття", nutrition.recipeNutrition({
  ...recipe,
  ingredients: [{ key: "kurka", amount: 200, unit: "g" }, { key: "sil", amount: 1, unit: "tsp" }],
}).coverage, 1);

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

/*
 * День — місцевий, а не UTC. У Києві страва, приготована о 00:30, має мітку
 * вчорашнього UTC-дня, і за UTC вона зникала б із сьогоднішнього підсумку.
 */
const now = new Date();
const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30).toISOString();
const afterMidnight = nutrition.dayTotals(
  [{ recipeId: "t", at: localMidnight }],
  (id) => (id === "t" ? recipe : undefined),
);
check("страва по опівночі — сьогоднішня", afterMidnight.meals, 1);

console.log("── Списання з комори ──");

const dish = (ingredients) => ({ ...recipe, ingredients });

// Літр соку мінус 200 мл на страву — лишається 0,8 л, а не літр
{
  const { pantry: left, consumed } = pantry.consumeForRecipe(
    [{ key: "sik", amount: 1, unit: "l", addedAt: today }],
    dish([{ key: "sik", amount: 200, unit: "ml" }]),
  );
  check("сік: лишилось 0,8 л", left[0].amount, 0.8);
  check("сік: списано 0,2 л", consumed[0].used, "0,2 л");
  check("сік: підпис залишку", consumed[0].left, "0,8 л");
}

// Різні міри зводяться через грами: склянка борошна це 120 г
{
  const { pantry: left } = pantry.consumeForRecipe(
    [{ key: "boroshno", amount: 1, unit: "kg", addedAt: today }],
    dish([{ key: "boroshno", amount: 1, unit: "cup" }]),
  );
  check("борошно: 1 кг − 1 скл = 0,88 кг", left[0].amount, 0.88);
}

// Не вистачило — продукт зникає з комори
{
  const { pantry: left, consumed } = pantry.consumeForRecipe(
    [{ key: "yajtsya", amount: 2, unit: "pcs", addedAt: today }],
    dish([{ key: "yajtsya", amount: 3, unit: "pcs" }]),
  );
  check("яйця закінчились", left.length, 0);
  check("яйця: позначено як закінчені", consumed[0].left, null);
}

// Кількість у коморі не вказана — не вигадуємо, скільки лишилось
{
  const { pantry: left, consumed } = pantry.consumeForRecipe(
    [{ key: "rys", addedAt: today }],
    dish([{ key: "rys", amount: 100, unit: "g" }]),
  );
  check("без кількості продукт лишається", left.length, 1);
  check("без кількості нічого не списано", consumed.length, 0);
}

// «За бажанням» могли й не покласти, «за смаком» не зважити
{
  const { consumed } = pantry.consumeForRecipe(
    [
      { key: "smetana", amount: 200, unit: "g", addedAt: today },
      { key: "sil", amount: 500, unit: "g", addedAt: today },
    ],
    dish([
      { key: "smetana", amount: 50, unit: "g", optional: true },
      { key: "sil", unit: "taste" },
    ]),
  );
  check("опційне й «за смаком» не списуються", consumed.length, 0);
}

// Множник порцій: готували вдвічі більше — і списалось удвічі більше
{
  const { pantry: left } = pantry.consumeForRecipe(
    [{ key: "moloko", amount: 1, unit: "l", addedAt: today }],
    dish([{ key: "moloko", amount: 250, unit: "ml" }]),
    2,
  );
  check("подвійна порція списує 500 мл", left[0].amount, 0.5);
}

console.log(`\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
