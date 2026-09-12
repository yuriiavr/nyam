#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка списку покупок.
 *
 * Запуск: npm run check:shopping
 *
 * Мережі не потребує: це арифметика й розкладка по відділах, а не база.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const shopping = await jiti.import(path.join(root, "src/lib/shopping.ts"));
const { byAisle } = await jiti.import(path.join(root, "src/lib/matching.ts"));

let pass = 0;
let fail = 0;
const check = (what, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    pass++;
    return;
  }
  fail++;
  console.log(
    `  ✗ ${what}\n      отримано: ${JSON.stringify(actual)}\n      очікувано: ${JSON.stringify(expected)}`,
  );
};

console.log("── Що вважається тим самим ──");

const { shoppingIdentity, mergeShoppingItem, itemsForRecipe, freeItem, catalogItem } = shopping;

check("продукт із довідника — за ключем", shoppingIdentity({ key: "moloko" }), "key:moloko");
// Довільні записи зводимо за текстом: «Батарейки» і «батарейки » — одне й те саме.
check(
  "довільний запис — за текстом",
  shoppingIdentity({ text: "Батарейки " }),
  shoppingIdentity({ text: "батарейки" }),
);
// А от уточнення — уже інша покупка, і вгадувати тут не можна.
check(
  "уточнення — це інша покупка",
  shoppingIdentity({ text: "батарейки ААА" }) === shoppingIdentity({ text: "батарейки" }),
  false,
);

console.log("── Складання кількостей ──");

const base = { id: "a", done: false, addedAt: "2026-09-01T10:00:00.000Z" };
const merged = mergeShoppingItem(
  { ...base, key: "boroshno", amount: 200, unit: "g" },
  { ...base, id: "b", key: "boroshno", amount: 300, unit: "g" },
);
check("200 г + 300 г", { amount: merged.amount, unit: merged.unit }, { amount: 500, unit: "g" });

const upscaled = mergeShoppingItem(
  { ...base, key: "moloko", amount: 900, unit: "ml" },
  { ...base, key: "moloko", amount: 900, unit: "ml" },
);
check("900 мл + 900 мл = 1,8 л", { amount: upscaled.amount, unit: upscaled.unit }, { amount: 1.8, unit: "l" });

// Штуки й грами не зводяться: лишається те, що вже стояло в списку.
const mixed = mergeShoppingItem(
  { ...base, key: "yajtsya", amount: 6, unit: "pcs" },
  { ...base, key: "yajtsya", amount: 300, unit: "g" },
);
check("штуки з грамами не змішуються", { amount: mixed.amount, unit: mixed.unit }, { amount: 6, unit: "pcs" });

// Коли кількості не було зовсім — беремо ту, що принесли.
const filled = mergeShoppingItem({ ...base, key: "sil" }, { ...base, key: "sil", amount: 1, unit: "pcs" });
check("порожня кількість заповнюється", { amount: filled.amount, unit: filled.unit }, { amount: 1, unit: "pcs" });

console.log("── Зі сторінки страви ──");

/*
 * Страва навмисно зібрана тут, а не взята з демо-набору: перевіряємо
 * перетворення складу в покупки, і рецепт має бути передбачуваним, а не
 * таким, який хтось колись відредагував.
 */
const recipe = {
  id: "r_test",
  title: "Тест",
  ingredients: [
    { key: "boroshno", amount: 250, unit: "g" },
    { key: "yajtsya", qty: "2 шт" },
    { key: "sil", unit: "taste" },
    { key: "syr", amount: 100, unit: "g", label: "Сир President" },
    { key: "kriop", amount: 10, unit: "g", optional: true },
  ],
};

const one = itemsForRecipe(recipe, ["boroshno"], 1);
check("береться лише те, чого бракує", one.length, 1);
check("кількість із рецепта", { amount: one[0].amount, unit: one[0].unit }, { amount: 250, unit: "g" });
check("позначено джерело", one[0].source, "recipe");
check("і сам рецепт", one[0].recipeId, "r_test");
check("і ще не куплено", one[0].done, false);

// Подвійна порція — подвійна закупівля. Це те саме число, що людина бачить
// у складі страви, коли крутить лічильник порцій.
check("подвійна порція", itemsForRecipe(recipe, ["boroshno"], 2)[0].amount, 500);

// Старий вільний текст теж розбирається: «2 шт» на трьох — це 6 шт.
const eggs = itemsForRecipe(recipe, ["yajtsya"], 3)[0];
check("«2 шт» × 3", { amount: eggs.amount, unit: eggs.unit }, { amount: 6, unit: "pcs" });

// «За смаком» — вказівка кухарю, а не мірка на вагах: у списку лишається
// сама сіль, без кількості.
const salt = itemsForRecipe(recipe, ["sil"], 1)[0];
check("«за смаком» без одиниці", salt.unit, undefined);
check("але сама сіль у списку", salt.key, "sil");

// Назву з етикетки зберігаємо: в магазині шукають очима саме її.
check("назва товару не губиться", itemsForRecipe(recipe, ["syr"], 1)[0].text, "Сир President");

// Порядок не залежить від того, як його попросили.
check(
  "кілька позицій одразу",
  itemsForRecipe(recipe, ["yajtsya", "boroshno"], 1).map((x) => x.key),
  ["boroshno", "yajtsya"],
);

console.log("── Підписи ──");

const { shoppingQtyLabel, shoppingEmoji, shoppingLabel } = shopping;

check("кількість словами", shoppingQtyLabel({ ...base, key: "boroshno", amount: 500, unit: "g" }), "500 г");
// Одиниця без числа — це не кількість, а «г» на ціннику.
check("одиниця без числа мовчить", shoppingQtyLabel({ ...base, key: "boroshno", unit: "g" }), "");
check("і порожня кількість теж", shoppingQtyLabel({ ...base, key: "boroshno" }), "");
check("назва з довідника", shoppingLabel({ ...base, key: "moloko" }), "Молоко");
check("своя назва важливіша", shoppingLabel({ ...base, key: "syr", text: "Сир President" }), "Сир President");
check("довільний запис — своїм значком", shoppingEmoji({ ...base, text: "батарейки" }), "📝");

console.log("── Незведені міри ──");

const { pickQuantity } = shopping;

// «500 г» і «2 ст. л.» не звести. У магазині міряють вагою — її й беремо,
// а не ту, чий рецепт випадково трапився в тижні першим.
check(
  "вага важливіша за ложки",
  pickQuantity([{ amount: 2, unit: "tbsp" }, { amount: 500, unit: "g" }]),
  { amount: 500, unit: "g" },
);
check(
  "штуки важливіші за жмені",
  pickQuantity([{ amount: 1, unit: "handful" }, { amount: 3, unit: "pcs" }]),
  { amount: 3, unit: "pcs" },
);
// Кількість без числа — не кількість.
check("без чисел немає що брати", pickQuantity([{ unit: "taste" }]), undefined);

console.log("── Відділи магазину ──");

const list = [
  catalogItem("moloko"),
  catalogItem("pomidor"),
  freeItem("батарейки"),
];
const aisles = byAisle(list);

check("овочі йдуть перед молочним", aisles[0].cat, "veg");
// Рядок без продукту з довідника не має відділу — і лягає в «Інше», у кінець.
check("довільний запис — в «Інше»", aisles[aisles.length - 1].cat, "other");
check("і не губиться", aisles[aisles.length - 1].items[0].text, "батарейки");
check("довільний запис без ключа", freeItem("батарейки").key, undefined);
check("і не куплений одразу", freeItem("батарейки").done, false);

console.log(`\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
