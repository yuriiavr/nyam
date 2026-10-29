#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка меню під ціль калорій і БЖВ (src/lib/menu.ts) — того, що складає
 * голосовий помічник (plan_menu).
 *
 * Запуск: npm run check:menu
 *
 * Страви — справжні рецепти сімʼї з порціями, як їх порахував ШІ: саме на
 * такому наборі (три сніданки, карбонара на 1270 ккал за порцію) видно, чи
 * добір вміє попасти в ціль порціями.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const menu = await jiti.import(path.join(root, "src/lib/menu.ts"));

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
const near = (name, actual, expected, tolerance) => {
  const ok = Math.abs(actual - expected) <= expected * tolerance;
  if (ok) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}\n      отримано: ${actual}\n      очікувано: ${expected} ± ${Math.round(tolerance * 100)}%`);
  }
};

const dish = (id, title, slots, [kcal, protein, fat, carbs]) => ({
  id,
  title,
  emoji: "🍽️",
  slots,
  perServing: { kcal, protein, fat, carbs },
});
const LD = ["lunch", "dinner"];
const DISHES = [
  dish("waffles", "Бельгійські вафлі", ["breakfast"], [1047, 20, 61, 105]),
  dish("pancakes", "Млинці", ["breakfast"], [654, 26, 30, 71]),
  dish("hashbrown", "Хешбраун", ["breakfast", "lunch", "dinner"], [197, 2, 13, 19]),
  dish("baked-fillet", "Запечене куряче філе з овочами", ["dinner"], [386, 48, 17, 10]),
  dish("spiced-meat", "Запечене мʼясо зі спеціями", LD, [251, 35, 11, 1]),
  dish("carbonara", "Карбонара", LD, [1272, 43, 82, 97]),
  dish("potato-chicken", "Картопля з куркою", LD, [529, 36, 29, 32]),
  dish("noodles", "Китайська локшина з куркою", LD, [731, 42, 30, 74]),
  dish("skewers", "Курячі шашлички з ананасом", LD, [211, 36, 2, 11]),
  dish("french-meat", "Мʼясо по-французьки", LD, [1294, 116, 79, 26]),
  dish("eggs", "Мариновані яйця", ["dinner"], [431, 30, 19, 35]),
  dish("fried-rice", "Смажений рис з куркою", LD, [950, 57, 31, 110]),
  dish("thighs", "Філе стегна з паприкою", LD, [563, 40, 41, 5]),
  dish("khachapuri", "Хачапурі з кисломолочного сиру", LD, [569, 46, 25, 39]),
];
const TARGET = { kcal: 2000, protein: 150, fat: 70, carbs: 200 };
const WEEK = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
const SLOTS = ["breakfast", "lunch", "dinner"];

console.log("── Частки дня й порції ──");

check("Усі три прийоми — уся доба", menu.slotShare(SLOTS), 1);
check("Обід — 0,4 доби", menu.slotShare(["lunch"]), 0.4);
check("Ціль на обід і вечерю", menu.scaleTargets(TARGET, menu.slotShare(["lunch", "dinner"])), {
  kcal: 1500,
  protein: 113,
  fat: 53,
  carbs: 150,
});
check("Незадане в цілі не зʼявляється", menu.scaleTargets({ kcal: 2000 }, 0.5), { kcal: 1000 });
check("Порції від апетиту 1", menu.portionOptions(1), [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5]);
check("Порції від апетиту 1,5 — з кроком у чверть", menu.portionOptions(1.5), [0.75, 1.25, 1.5, 2, 2.25, 3, 3.75]);
check("Влучно — нуль промаху", menu.menuMiss(TARGET, TARGET), 0);
check("Незадане не штрафує", menu.menuMiss({ kcal: 2000, protein: 0, fat: 999, carbs: 0 }, { kcal: 2000 }), 0);

console.log("── Рецепт як страва меню ──");

const recipe = (over) => ({
  id: "r",
  authorId: "a",
  title: "Борщ",
  description: "",
  emoji: "🍲",
  gradient: ["#000", "#fff"],
  cuisine: "",
  mealTypes: ["lunch", "dinner"],
  moods: [],
  tags: [],
  timeMin: 60,
  difficulty: 1,
  servings: 4,
  costLevel: 1,
  ingredients: [],
  steps: [],
  createdAt: "",
  stats: { likes: 0, saves: 0, cooks: 0, ratingSum: 0, ratingCount: 0 },
  aiNutrition: { kcal: 1600, protein: 80, fat: 60, carbs: 180 },
  ...over,
});
check("Порція — від усієї страви ШІ", menu.menuDish(recipe({})).perServing, { kcal: 400, protein: 20, fat: 15, carbs: 45 });
check("Прийоми — з типів рецепта", menu.menuDish(recipe({})).slots, ["lunch", "dinner"]);
check("Гарнір сам — не обід", menu.menuDish(recipe({ course: "side" })).slots, []);
check("Соус за назвою — не обід", menu.menuDish(recipe({ title: "Соус песто" })).slots, []);
check("Без КБЖВ — у добір не йде", menu.menuDish(recipe({ aiNutrition: undefined })).perServing, undefined);

console.log("── День під ціль ──");

const t0 = Date.now();
const [day] = menu.planMenu({ dishes: DISHES, days: [WEEK[0]], slots: SLOTS, target: TARGET });
check("Три прийоми", day.picks.map((p) => p.slot), SLOTS);
check("Сніданок — зі сніданків", ["waffles", "pancakes", "hashbrown"].includes(day.picks[0].dish.id), true);
near("Калорії біля цілі", day.total.kcal, 2000, 0.07);
near("Білок біля цілі", day.total.protein, 150, 0.12);
near("Жири біля цілі", day.total.fat, 70, 0.15);
near("Вуглеводи біля цілі", day.total.carbs, 200, 0.15);
check("Обід і вечеря — різні страви", day.picks[1].dish.id !== day.picks[2].dish.id, true);

const lean = menu.planMenu({ dishes: DISHES, days: [WEEK[0]], slots: SLOTS, target: { kcal: 1500 } })[0];
near("Лише калорії — теж влучає", lean.total.kcal, 1500, 0.05);

console.log("── Тиждень ──");

const week = menu.planMenu({ dishes: DISHES, days: WEEK, slots: SLOTS, target: TARGET });
const ms = Date.now() - t0;
check("Сім днів", week.length, 7);
for (const d of week) near(`${d.day}: калорії біля цілі`, d.total.kcal, 2000, 0.1);
const lunchesAndDinners = week.flatMap((d) => d.picks.filter((p) => p.slot !== "breakfast").map((p) => p.dish.id));
check("Обіди й вечері не з двох-трьох страв", new Set(lunchesAndDinners).size >= 6, true);
const repeatsNextDay = week.slice(1).filter((d, i) => {
  const before = new Set(week[i].picks.filter((p) => p.slot !== "breakfast").map((p) => p.dish.id));
  return d.picks.some((p) => p.slot !== "breakfast" && before.has(p.dish.id));
}).length;
check("Обід чи вечеря рідко повторюють учорашні", repeatsNextDay <= 2, true);
check(
  "Той самий варіант — те саме меню",
  JSON.stringify(menu.planMenu({ dishes: DISHES, days: WEEK, slots: SLOTS, target: TARGET })),
  JSON.stringify(week),
);
const other = menu.planMenu({ dishes: DISHES, days: WEEK, slots: SLOTS, target: TARGET, variant: 1 });
check(
  "Інший варіант — інше меню",
  JSON.stringify(other.map((d) => d.picks.map((p) => p.dish.id))) !== JSON.stringify(week.map((d) => d.picks.map((p) => p.dish.id))),
  true,
);
check(`Тиждень рахується швидко (${ms} мс)`, ms < 3000, true);

console.log("── Заплановане й порожні прийоми ──");

const carbonara = DISHES.find((d) => d.id === "carbonara");
const [withKept] = menu.planMenu({
  dishes: DISHES,
  days: [WEEK[0]],
  slots: SLOTS,
  target: TARGET,
  kept: { [WEEK[0]]: { dinner: carbonara } },
});
const keptDinner = withKept.picks.find((p) => p.slot === "dinner");
check("Заплановане лишається", [keptDinner.dish.id, keptDinner.kept, keptDinner.portions], ["carbonara", true, 1]);
check("Заплановане в ціль зараховано", withKept.total.kcal >= 1272, true);
near("Решта підібрана під залишок", withKept.total.kcal, 2000, 0.1);

const unknown = { id: "x", title: "Без КБЖВ", emoji: "🍽️", slots: [] };
const [withUnknown] = menu.planMenu({
  dishes: DISHES,
  days: [WEEK[0]],
  slots: SLOTS,
  target: TARGET,
  kept: { [WEEK[0]]: { lunch: unknown } },
});
check("Заплановане без КБЖВ — без чисел", withUnknown.picks.find((p) => p.slot === "lunch").nutrition, undefined);

const noBreakfast = DISHES.filter((d) => !d.slots.includes("breakfast"));
const [skipped] = menu.planMenu({ dishes: noBreakfast, days: [WEEK[0]], slots: SLOTS, target: TARGET });
check("Немає сніданків — прийом порожній", skipped.empty, ["breakfast"]);
check("…і ціль дня без його частки", skipped.target, { kcal: 1500, protein: 113, fat: 53, carbs: 150 });
check("…а обід і вечеря є", skipped.picks.map((p) => p.slot), ["lunch", "dinner"]);

const [dinnerOnly] = menu.planMenu({
  dishes: DISHES,
  days: [WEEK[0]],
  slots: ["dinner"],
  target: { kcal: 600, protein: 60 },
});
check("Лише вечеря", dinnerOnly.picks.map((p) => p.slot), ["dinner"]);
near("Вечеря під залишок калорій", dinnerOnly.total.kcal, 600, 0.12);
near("Вечеря під залишок білка", dinnerOnly.total.protein, 60, 0.15);

console.log(`\n${pass} пройшло, ${fail} впало`);
if (fail) process.exit(1);
