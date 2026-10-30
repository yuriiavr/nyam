#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка щоденника: хто скільки зʼїв, залишки, порції товару, склад страви.
 *
 * Запуск: npm run check:diary
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const diary = await jiti.import(path.join(root, "src/lib/diary.ts"));

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

console.log("── Хто скільки зʼїв ──");

const me = { userId: "me", appetite: 1.5 };
const her = { userId: "her", appetite: 1 };

check("4 порції на двох: кожному за апетитом, решта — залишок", diary.splitDefaults([me, her], 4), { me: 1.5, her: 1 });
check("2 порції на двох: казан порожній, ділимо пропорційно", diary.splitDefaults([me, her], 2), { me: 1.25, her: 0.75 });
check("1 порція на двох: округлення не вилазить за казан", diary.splitDefaults([me, her], 1), { me: 0.5, her: 0.5 });
check("Сам: одна порція за апетитом", diary.splitDefaults([me], 4), { me: 1.5 });
check("Нікого — порожньо", diary.splitDefaults([], 4), {});

check("Порції → частки", diary.sharesFromPortions({ me: 1.5, her: 1, cat: 0 }, 4), { me: 0.375, her: 0.25 });
check("Частка не більша за всю страву", diary.sharesFromPortions({ me: 6 }, 4), { me: 1 });
check("Грами з ваг → порції", diary.portionsFromGrams(450, 1200, 4), 1.5);
check("Без ваги страви — нуль", diary.portionsFromGrams(450, 0, 4), 0);

check("1 порція", diary.portionLabel(1), "1 порція");
check("2 порції", diary.portionLabel(2), "2 порції");
check("5 порцій", diary.portionLabel(5), "5 порцій");
check("1,5 порції", diary.portionLabel(1.5), "1,5 порції");

console.log("── Залишки ──");

const meal = {
  id: "m1",
  ownerId: "me",
  title: "Плов",
  emoji: "🍚",
  servings: 4,
  nutrition: { kcal: 2400, protein: 80, fat: 90, carbs: 300 },
  items: [],
  cookedAt: new Date().toISOString(),
  eaten: 0,
  finished: false,
};
const ate = (userId, share) => ({
  id: `${userId}-${share}`,
  userId,
  eatenAt: meal.cookedAt,
  slot: "dinner",
  title: "Плов",
  emoji: "🍚",
  mealId: "m1",
  share,
  source: "cook",
});

check("Нічого не зʼїли — 4 порції", diary.leftoverServings(meal, []), 4);
check("Зʼїли 0,375 + 0,25 — лишилось 1,5", diary.leftoverServings(meal, [ate("me", 0.375), ate("her", 0.25)]), 1.5);
check("База знає більше (чужий приватний запис)", diary.leftoverServings({ ...meal, eaten: 0.75 }, [ate("me", 0.375)]), 1);
check("Крихти — не залишок", diary.leftoverServings({ ...meal, eaten: 0.99 }, []), 0);
check("Закрита страва — без залишку", diary.leftoverServings({ ...meal, finished: true }, []), 0);
check(
  "Стара страва (4 доби) — не пропонуємо",
  diary.leftovers([{ ...meal, cookedAt: new Date(Date.now() - 4 * 86400_000).toISOString() }], []).length,
  0,
);

check(
  "КБЖВ частки страви",
  diary.entryNutrition(ate("me", 0.375), () => meal, () => undefined),
  { kcal: 900, protein: 30, fat: 33.8, carbs: 112.5 },
);

console.log("── Товар ──");

check(
  "Батончик 50 г: уся пачка і 100 г",
  diary.portionPresets({ packAmount: 50, packUnit: "g" }).map((p) => p.grams),
  [50, 100],
);
check(
  "Йогурт 300 г: уся, пів, 100 г",
  diary.portionPresets({ packAmount: 300, packUnit: "g" }).map((p) => p.grams),
  [300, 150, 100],
);
check(
  "Молоко 1 л: без «уся пачка», пів і 100 мл",
  diary.portionPresets({ packAmount: 1, packUnit: "l" }).map((p) => p.label),
  ["½ пачки · 500 мл", "100 мл"],
);
check(
  "Яйця 10 шт по 60 г: штуками, не пачкою",
  diary.portionPresets({ packAmount: 10, packUnit: "pcs", gramsPerPiece: 60 }).map((p) => p.grams),
  [60, 120, 100],
);
check("Грами пачки в кг", diary.packGrams({ packAmount: 0.5, packUnit: "kg" }), 500);
check("КБЖВ на грами", diary.forGrams({ kcal: 520, protein: 6, fat: 28, carbs: 60 }, 50), {
  kcal: 260,
  protein: 3,
  fat: 14,
  carbs: 30,
});

console.log("── Склад страви ──");

const suluguni = {
  id: "p1",
  typeKey: "syr",
  name: "Сир Сулугуні Ферма",
  nutrition: { kcal: 290, protein: 20, fat: 24, carbs: 0 },
  source: "user",
  archived: false,
  version: 1,
  updatedAt: "",
};
const ai = { kcal: 350, protein: 25, fat: 27, carbs: 1 };

check("Етикетка товару перемагає оцінку ШІ", diary.mealItem({ name: "сир", grams: 100, product: suluguni, ai }).from, "label");
check("Етикетка: 50 г сулугуні", diary.mealItem({ name: "сир", grams: 50, product: suluguni, ai }).kcal, 145);
check(
  "Оцінка ШІ на картці поступається свіжій оцінці ШІ",
  diary.mealItem({ name: "сир", grams: 100, product: { ...suluguni, nutritionSource: "ai" }, ai }).kcal,
  350,
);
check("Без товару — оцінка ШІ", diary.mealItem({ name: "сир", grams: 100, typeKey: "syr", ai }).from, "ai");
check("Без товару й ШІ — довідник типу", diary.mealItem({ name: "сир", grams: 100, typeKey: "syr" }).from, "catalog");

check(
  "Склад страви складається",
  diary.itemsNutrition([
    { name: "a", grams: 100, kcal: 100.4, protein: 1, fat: 2, carbs: 3, from: "ai" },
    { name: "b", grams: 100, kcal: 200.4, protein: 1.04, fat: 2, carbs: 3, from: "ai" },
  ]),
  { kcal: 301, protein: 2, fat: 4, carbs: 6 },
);

console.log("── Час ──");

check("8:00 — сніданок", diary.slotAt(new Date(2026, 0, 1, 8)), "breakfast");
check("13:00 — обід", diary.slotAt(new Date(2026, 0, 1, 13)), "lunch");
check("19:00 — вечеря", diary.slotAt(new Date(2026, 0, 1, 19)), "dinner");
check("01:00 — перекус", diary.slotAt(new Date(2026, 0, 1, 1)), "snack");

const cook = { recipeId: "r1", at: new Date(2026, 0, 1, 19).toISOString() };
check(
  "Готування зі стравою поруч — уже в щоденнику",
  diary.unloggedCooks([cook], [{ ...meal, recipeId: "r1", cookedAt: new Date(2026, 0, 1, 19, 40).toISOString() }]),
  [],
);
check("Готування без страви — питаємо", diary.unloggedCooks([cook], []).length, 1);

const now = new Date(2026, 0, 2, 21, 15);
check("Запис за сьогодні — просто зараз", diary.eatenAtFor("2026-01-02", "lunch", now), now.toISOString());
check(
  "Вчорашній обід — о першій, а не вночі",
  diary.eatenAtFor("2026-01-01", "lunch", now),
  new Date(2026, 0, 1, 13).toISOString(),
);

check(
  "Нещодавнє: товар один раз, найсвіжіший запис",
  diary.recentProducts(
    [
      { id: "1", userId: "me", eatenAt: "2026-01-01T08:00:00Z", slot: "breakfast", title: "Йогурт", emoji: "🥛", productId: "p1", grams: 150, source: "scan" },
      { id: "2", userId: "me", eatenAt: "2026-01-02T08:00:00Z", slot: "breakfast", title: "Йогурт", emoji: "🥛", productId: "p1", grams: 300, source: "scan" },
      { id: "3", userId: "her", eatenAt: "2026-01-02T09:00:00Z", slot: "snack", title: "Батончик", emoji: "🍫", productId: "p2", grams: 50, source: "scan" },
    ],
    "me",
  ).map((r) => [r.productId, r.grams]),
  [["p1", 300]],
);

console.log("── Страва з рецепта ──");

const recipe = {
  id: "r9",
  title: "Борщ",
  emoji: "🍲",
  servings: 4,
  ingredients: [{ key: "kartoplia", amount: 400, unit: "g" }],
  steps: [],
};
const fromRecipe = diary.mealFromRecipe(recipe, { id: "m9", ownerId: "me", cookedAt: "2026-01-02T12:00:00Z" });
check("Порцій — як у рецепті", fromRecipe.servings, 4);
check("Страва памʼятає рецепт", fromRecipe.recipeId, "r9");
check("Нова страва ще ніким не зʼїдена", [fromRecipe.eaten, fromRecipe.finished], [0, false]);

console.log("── Списання обраного з комори ──");

const pantry = await jiti.import(path.join(root, "src/lib/pantry.ts"));
const rows = [
  { id: "a", key: "sosysky", amount: 500, unit: "g", addedAt: "2026-01-01T00:00:00Z" },
  { id: "b", key: "kartoplia", amount: 300, unit: "g", addedAt: "2026-01-01T00:00:00Z" },
];
const used = pantry.consumeRows(rows, [
  { id: "a", grams: 120 },
  { id: "b", grams: 500 },
]);
check("Сосиски: лишилось 380 г", used.pantry.find((r) => r.id === "a")?.amount, 380);
check("Картоплі не вистачило — рядок закінчився", used.pantry.some((r) => r.id === "b"), false);
check("Що списано — обидва рядки", used.consumed.map((c) => c.id), ["a", "b"]);
check("Чужий id — нічого не чіпає", pantry.consumeRows(rows, [{ id: "zzz", grams: 10 }]).pantry, rows);

console.log("── Що взяв запис із комори ──");

const bar = { id: "p-bar", typeKey: "sosysky", name: "Батончик Корона", gramsPerPiece: 50, version: 1, updatedAt: "", source: "user", archived: false };
const barCache = { [bar.id]: bar };
const bars = [
  { id: "old", key: "sosysky", productId: bar.id, amount: 1, unit: "pcs", addedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-05" },
  { id: "new", key: "sosysky", productId: bar.id, amount: 3, unit: "pcs", addedAt: "2026-01-02T00:00:00Z", expiresAt: "2026-02-01" },
  { id: "other", key: "sosysky", amount: 500, unit: "g", addedAt: "2026-01-01T00:00:00Z" },
];
check(
  "Батончик: спершу той, що зіпсується раніше, решта — з наступного",
  pantry.productTakes(bars, bar.id, 100, barCache, "2026-01-03"),
  [
    { id: "old", grams: 50 },
    { id: "new", grams: 50 },
  ],
);
check("Товару в коморі немає — комору не чіпаємо", pantry.productTakes(bars, "p-none", 50, barCache), []);
check(
  "Прострочене — останнім",
  pantry.productTakes(bars, bar.id, 50, barCache, "2026-01-10").map((t) => t.id),
  ["new"],
);

const barEaten = pantry.consumeRows(bars, [{ id: "old", grams: 50 }, { id: "new", grams: 50 }], barCache);
const taken = pantry.takenFrom(bars, barEaten.pantry, barEaten.consumed.map((c) => c.id));
check(
  "Взято: спорожнілий рядок цілком, з повного — одна штука",
  taken.map((t) => [t.row.id, t.amount]),
  [
    ["old", 1],
    ["new", 1],
  ],
);

// Поки запис жив, із другої пачки взяли ще одну — повертаємо лише своє.
const later = barEaten.pantry.map((r) => (r.id === "new" ? { ...r, amount: 1 } : r));
const back = pantry.returnTaken(later, taken);
check(
  "Повернення додає взяте, а спорожнілий рядок повертає з його кількістю",
  back.map((r) => [r.id, r.amount]).sort(),
  [
    ["new", 2],
    ["old", 1],
  ],
);
check(
  "Рядок переписали в інших одиницях — не вгадуємо",
  pantry.returnTaken([{ ...bars[1], amount: 120, unit: "g" }], [{ row: bars[1], amount: 1 }]),
  [],
);

check(
  "pantry_taken із бази: биті елементи відкидаємо",
  pantry.parsePantryTaken([{ row: bars[0], amount: 1 }, { row: { id: "x" }, amount: 1 }, { row: bars[1], amount: 0 }, "сміття"]).map(
    (t) => t.row.id,
  ),
  ["old"],
);
check("pantry_taken null — ще не вирішили", pantry.parsePantryTaken(null), undefined);
check("pantry_taken [] — нічого не брали", pantry.parsePantryTaken([]), []);

console.log("── Голосом — що взяли з комори? ──");

const voiceMeal = {
  id: "vm",
  ownerId: "me",
  title: "Картопля з сосисками",
  emoji: "🥔",
  servings: 1,
  items: [{ name: "сосиски", grams: 120, typeKey: "sosysky", pantryId: "a", kcal: 300, protein: 12, fat: 27, carbs: 1, from: "label" }],
  cookedAt: "2026-01-02T19:00:00Z",
  eaten: 1,
  finished: false,
};
const voiceEntry = { id: "ve", userId: "me", eatenAt: "2026-01-02T19:00:00Z", slot: "dinner", title: "Картопля", emoji: "🥔", mealId: "vm", share: 1, source: "voice" };
const at = new Date("2026-01-02T21:00:00Z");
check("Записане голосом із комори — питаємо", diary.pantryPending([voiceMeal], [voiceEntry], "me", at).length, 1);
check("Уже підтвердили — не питаємо", diary.pantryPending([{ ...voiceMeal, pantryTaken: [] }], [voiceEntry], "me", at), []);
check("Записане в застосунку — там уже обрали", diary.pantryPending([voiceMeal], [{ ...voiceEntry, source: "dish" }], "me", at), []);
check("Чужа страва — питаємо господаря", diary.pantryPending([voiceMeal], [voiceEntry], "her", at), []);
check("Позавчора — уже не згадати", diary.pantryPending([voiceMeal], [voiceEntry], "me", new Date("2026-01-05T00:00:00Z")), []);

console.log("── Склад після готування ──");

/*
 * Готували не за рецептом: макаронів менше, бекон з іншої пачки. Розписаний
 * склад — уже число цієї каструлі, і свіже число рецепта його не перебиває.
 */
const carbonara = {
  id: "rc",
  title: "Карбонара",
  servings: 2,
  aiNutrition: { kcal: 1600, protein: 60, fat: 70, carbs: 180 },
  ingredients: [{ key: "makarony", amount: 250, unit: "g" }],
  steps: [],
};
const cookedMeal = diary.mealFromRecipe(carbonara, { id: "mc", ownerId: "me", cookedAt: "2026-01-02T19:00:00Z" });
check("Страва з рецепта — число рецепта", diary.mealNutrition(cookedMeal, carbonara)?.kcal, 1600);
check("Склад, як зварили, — рецепт не перебиває", diary.mealNutrition({
  ...cookedMeal,
  items: [{ name: "Паста", grams: 300, kcal: 1200, protein: 40, fat: 50, carbs: 150, from: "ai" }],
  nutrition: { kcal: 1200, protein: 40, fat: 50, carbs: 150 },
}, carbonara)?.kcal, 1200);
check("Склад без числа — ще рецепт", diary.hasOwnComposition({ items: [{ name: "x" }], nutrition: undefined }), false);

const parts = [
  // Зважили вареними: скільки сухих — каже ШІ.
  { name: "Спагеті Barilla", typeKey: "makarony", productId: "p-pasta", pantryId: "pasta", grams: null, cooked: true, labelled: false },
  // Зважили з пачки: списуємо за мірою людини, хай би ШІ що вважав.
  { name: "Бекон Глобино", typeKey: "bekon", productId: "p-bacon", pantryId: "bacon", grams: 150, cooked: false, labelled: true },
  // Яйця без ваги штуки: міри в грамах немає — ШІ.
  { name: "Яйця", typeKey: "yaitsia", pantryId: "eggs", grams: null, cooked: false, labelled: false },
  // Не з комори — нічого не списуємо.
  { name: "Пармезан", typeKey: "parmezan", grams: 40, cooked: false, labelled: false },
];
const counted = [
  { line: 0, name: "Паста варена", grams: 300, rawGrams: 125, kcal: 470, protein: 17, fat: 3, carbs: 93 },
  { line: 1, name: "Бекон", grams: 150, rawGrams: 140, kcal: 811, protein: 55.5, fat: 63, carbs: 2.1 },
  { line: 2, name: "Яйця", grams: 110, rawGrams: 110, kcal: 157, protein: 14, fat: 11, carbs: 1 },
  { line: 3, name: "Пармезан", grams: 40, rawGrams: 40, kcal: 158, protein: 14, fat: 11, carbs: 1 },
  { line: null, name: "Олія для пательні", grams: 5, rawGrams: 5, kcal: 45, protein: 0, fat: 5, carbs: 0 },
];
const composed = diary.cookedComposition(parts, counted);
check("Назви — пачок людини, а дописане кроками — як назвав ШІ", composed.items.map((i) => i.name), [
  "Спагеті Barilla",
  "Бекон Глобино",
  "Яйця",
  "Пармезан",
  "Олія для пательні",
]);
check("Етикетка — лише там, де її дали й зважили сирим", composed.items.map((i) => i.from), ["ai", "label", "ai", "ai", "ai"]);
check("Склад памʼятає пачку", [composed.items[1].productId, composed.items[1].pantryId], ["p-bacon", "bacon"]);
check("Дописане кроками — без пачки", [composed.items[4].typeKey, composed.items[4].pantryId], [undefined, undefined]);
check("Списуємо: варені — сухими за ШІ, бекон — за мірою людини, яйця — за ШІ", composed.takes, [
  { id: "pasta", grams: 125 },
  { id: "bacon", grams: 150 },
  { id: "eggs", grams: 110 },
]);

console.log("── Склад порції ──");

const two = diary.portionsOf(composed, 2);
check("Дві такі порції — удвічі більше грамів", two.items.map((i) => i.grams), [600, 300, 220, 80, 10]);
check("…і калорій", two.items[1].kcal, 1622);
check("БЖВ — із десятою", two.items[1].carbs, 4.2);
check("Пачка й джерело лишаються", [two.items[1].pantryId, two.items[1].from], ["bacon", "label"]);
check("Списання — на всі порції", two.takes, [
  { id: "pasta", grams: 250 },
  { id: "bacon", grams: 300 },
  { id: "eggs", grams: 220 },
]);
check("Одна порція — той самий склад", diary.portionsOf(composed, 1).items, composed.items);
check("Півтори — округлено до грама", diary.portionsOf(composed, 1.5).takes[0], { id: "pasta", grams: 188 });

console.log("── Ваги посеред готування ──");

const cooked = await jiti.import(path.join(root, "src/lib/cooked.ts"));
const salad = {
  ingredients: [
    { key: "ogirok", amount: 2, unit: "pcs" },
    { key: "pomidor", amount: 3, unit: "pcs" },
    { key: "tsybulya", amount: 0.5, unit: "pcs", optional: true },
    { key: "syr", amount: 50, unit: "g" },
    { key: "oliya", amount: 2, unit: "tbsp" },
  ],
  steps: [
    { text: "Наріж огірки й помідори кубиками, цибулю — півкільцями." },
    { text: "Посип тертим сиром і заправ олією." },
    { text: "Перемішай і подавай." },
  ],
};
const keysOf = (list) => list.map((i) => i.key);
check("Крок згадує огірки, помідори й цибулю — у будь-якому відмінку", keysOf(cooked.stepIngredients(salad, 0)), [
  "ogirok",
  "pomidor",
  "tsybulya",
]);
check("«Посип» — не сир, «сиром» — сир", keysOf(cooked.stepIngredients(salad, 1)), ["syr", "oliya"]);
check("Крок без продуктів — нічого", cooked.stepIngredients(salad, 2), []);
check("Кроку немає — нічого", cooked.stepIngredients(salad, 9), []);

const weighedSalad = cooked.withWeights(
  { ...salad, id: "s", title: "Салат" },
  { ogirok: { amount: 180, unit: "g" }, tsybulya: { amount: 40, unit: "g" }, syr: { amount: 300, unit: "g", cooked: true } },
);
check("Зважене — у списання замість рецепта", weighedSalad.ingredients[0], { key: "ogirok", amount: 180, unit: "g", optional: false });
check("Зважене необовʼязкове — поклали, отже списуємо", weighedSalad.ingredients[2].optional, false);
check("Зважене готовим — поки міра рецепта", weighedSalad.ingredients[3], { key: "syr", amount: 50, unit: "g" });
check("Без ваг — той самий рецепт", cooked.withWeights(salad, {}) === salad, true);

console.log("── Інша міра ──");

check("2 шт яєць — це 120 г", cooked.convertAmount("yajtsya", 2, "pcs", "g"), 120);
check("200 г огірків — 2 шт", cooked.convertAmount("ogirok", 200, "g", "pcs"), 2);
check("150 г — 0,15 кг", cooked.convertAmount("ogirok", 150, "g", "kg"), 0.15);
check("Півштуки дрібного — чвертями, не 0,4", cooked.convertAmount("ogirok", 40, "g", "pcs"), 0.5);
check("Та сама міра — без змін", cooked.convertAmount("yajtsya", 3, "pcs", "pcs"), 3);
check("«За смаком» у грами не переводиться", cooked.convertAmount("syr", 1, "taste", "g"), null);
check("Олію штуками — без ваги штуки не вгадуємо", cooked.convertAmount("oliya", 2, "tbsp", "pcs"), null);

console.log("── Скільки з яких пачок ──");

const pastaCard = { id: "p-pasta", typeKey: "makarony", name: "Спагеті Barilla", version: 1, updatedAt: "", source: "user", archived: false };
const pastaCache = { [pastaCard.id]: pastaCard };
const shelf = [
  { id: "open", key: "makarony", productId: "p-pasta", amount: 100, unit: "g", addedAt: "2026-01-01T00:00:00Z" },
  { id: "full", key: "makarony", productId: "p-pasta", amount: 500, unit: "g", addedAt: "2026-01-02T00:00:00Z" },
  { id: "chumak", key: "makarony", productId: "p-other", amount: 400, unit: "g", addedAt: "2026-01-01T00:00:00Z" },
  { id: "loose", key: "makarony", addedAt: "2026-01-01T00:00:00Z", label: "Макарони з ринку" },
];
check(
  "Обрана пачка першою, решта — з такої самої, а не з чужої",
  pantry.planTakes(shelf, [{ id: "open", grams: 250 }], pastaCache),
  [
    { id: "open", grams: 100 },
    { id: "full", grams: 150 },
  ],
);
check("Вистачило обраної — інших не чіпаємо", pantry.planTakes(shelf, [{ id: "full", grams: 250 }], pastaCache), [
  { id: "full", grams: 250 },
]);
check("Пачка без кількості — не списуємо нічого", pantry.planTakes(shelf, [{ id: "loose", grams: 250 }], pastaCache), []);
check(
  "Дві потреби з однієї пачки — одне списання, і не більше, ніж є",
  pantry.planTakes(shelf, [{ id: "chumak", grams: 300 }, { id: "chumak", grams: 300 }], pastaCache),
  [{ id: "chumak", grams: 400 }],
);

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
