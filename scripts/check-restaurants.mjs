#!/usr/bin/env node
import { createJiti } from "jiti";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка меню закладів: офіційні числа сходяться, id сталі й унікальні,
 * меню не порожні, а запис у щоденник — порція × кількість.
 *
 * Запуск: npm run check:restaurants
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const data = await jiti.import(path.join(root, "src/data/restaurants/index.ts"));
const lib = await jiti.import(path.join(root, "src/lib/restaurants.ts"));

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
const problems = (name, list) => check(`${name}${list.length ? `: ${list.slice(0, 8).join("; ")}` : ""}`, list.length, 0);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const allIds = new Map();
const menus = {};

for (const r of data.RESTAURANTS) {
  console.log(`── ${r.name} ──`);
  const menu = await data.loadMenu(r.id);
  menus[r.id] = menu;
  const dishes = menu.categories.flatMap((c) => c.dishes);
  console.log(`  ${dishes.length} страв у ${menu.categories.length} розділах`);

  check("меню не порожнє", dishes.length > 0, true);
  problems(
    "порожніх розділів немає",
    menu.categories.filter((c) => c.dishes.length === 0).map((c) => c.name),
  );
  problems(
    "назви розділів не повторюються",
    menu.categories.map((c) => c.name).filter((n, i, all) => all.indexOf(n) !== i),
  );
  check("логотип є в public/", fs.existsSync(path.join(root, "public", r.logo)), true);
  check("логотип невеликий (до 32 КБ)", fs.statSync(path.join(root, "public", r.logo)).size <= 32 * 1024, true);

  const keys = dishes.map((d) => d.key);
  problems("ключі страв унікальні", keys.filter((k, i) => keys.indexOf(k) !== i));
  const names = dishes.map((d) => d.name);
  problems("назви страв унікальні", names.filter((n, i) => names.indexOf(n) !== i));
  problems(
    "назви охайні (без ®, подвійних пробілів, порожніх)",
    names.filter((n) => !n.trim() || /[®™]|\s{2}|^\s|\s$/.test(n)),
  );

  problems(
    "ккал — невідʼємне число",
    dishes.filter((d) => !(Number.isFinite(d.kcal) && d.kcal >= 0)).map((d) => d.name),
  );
  problems(
    "вага порції — додатна й з одиницею",
    dishes.filter((d) => d.amount != null && !(d.amount > 0 && (d.unit === "g" || d.unit === "ml"))).map((d) => d.name),
  );

  if (r.kcalOnly) {
    problems(
      "лише ккал: Б/Ж/В порожні (не вигадані)",
      dishes.filter((d) => d.protein != null || d.fat != null || d.carbs != null).map((d) => d.name),
    );
  } else {
    problems(
      "Б/Ж/В — невідʼємні числа",
      dishes.filter((d) => [d.protein, d.fat, d.carbs].some((v) => !(typeof v === "number" && v >= 0))).map((d) => d.name),
    );
  }

  // 4·Б + 9·Ж + 4·В ≈ ккал; виняток — лише переглянутий, з приміткою (пиво: алкоголь).
  const off = dishes.filter((d) => !lib.macrosAgree(d));
  problems(
    "Б/Ж/В сходяться з ккал (або є примітка, чому ні)",
    off.filter((d) => !d.note).map((d) => `${d.name}: ${d.kcal} ккал, Б ${d.protein} Ж ${d.fat} В ${d.carbs}`),
  );
  if (off.length) console.log(`  переглянуті винятки: ${off.map((d) => d.name).join(", ")}`);

  // Рядок на 100 г має давати ті самі ккал на порцію.
  problems(
    "на 100 г × вага ≈ ккал порції",
    dishes
      .filter((d) => d.per100 && d.amount)
      .filter((d) => Math.abs((d.per100.kcal * d.amount) / 100 - d.kcal) > 0.05 * d.kcal + 3)
      .map((d) => `${d.name}: ${d.kcal} проти ${Math.round((d.per100.kcal * d.amount) / 100)}`),
  );

  // Обмеження food_log у базі: запис, що їх порушує, не синхронізувався б.
  problems(
    "запис проходить перевірки бази (назва ≤ 160, емодзі ≤ 16, г ≤ 10 000, ккал ≤ 20 000) навіть на максимум порцій",
    dishes.filter((d) => {
      const max = lib.maxPortions(d);
      const n = lib.dishNutrition(d, max);
      const g = lib.dishGrams(d, max);
      return (
        max < 1 ||
        d.name.length > 160 ||
        [...lib.dishEmoji(menu, d)].length > 16 ||
        n.kcal > 20000 ||
        (g != null && (g <= 0 || g > 10000))
      );
    }).map((d) => d.name),
  );
  problems(
    "розділ має емодзі",
    menu.categories.filter((c) => !c.emoji).map((c) => c.name),
  );

  for (const d of dishes) {
    const id = lib.dishId(r.id, d.key);
    if (!UUID.test(id)) check(`UUID версії 8: ${d.name}`, id, "UUID");
    if (allIds.has(id)) check(`id не збігається: ${d.name} і ${allIds.get(id)}`, id, "унікальний");
    allIds.set(id, d.name);
    if (lib.restaurantOfProductId(id)?.id !== r.id) check(`з id видно заклад: ${d.name}`, lib.restaurantOfProductId(id)?.id, r.id);
    if (lib.dishById(menu, r.id, id) !== d) check(`страва знаходиться за id: ${d.name}`, false, true);
  }
}

console.log("── id ──");
check("той самий ключ — той самий id", lib.dishId("mcdonalds", "200148"), lib.dishId("mcdonalds", "200148"));
check("інший заклад — інший id", lib.dishId("mcdonalds", "x") === lib.dishId("kfc", "x"), false);
check("товар (UUID v4) — не страва закладу", lib.restaurantOfProductId("3f2b8c1e-5d4a-4c3b-9a1e-2b3c4d5e6f70"), undefined);
check("без id — не страва", lib.restaurantOfProductId(undefined), undefined);

console.log("── Запис у щоденник ──");
const mcd = menus.mcdonalds;
const bigMac = mcd.categories.flatMap((c) => c.dishes).find((d) => d.key === "200148");
check("Біг Мак є в меню", bigMac?.name, "Біг Мак");
check("1 порція — як у калькуляторі", lib.dishNutrition(bigMac, 1), { kcal: 526, protein: 27, fat: 27, carbs: 43 });
check("2 порції — удвічі", lib.dishNutrition(bigMac, 2), { kcal: 1052, protein: 54, fat: 54, carbs: 86 });
check("½ порції — навпіл", lib.dishNutrition(bigMac, 0.5), { kcal: 263, protein: 13.5, fat: 13.5, carbs: 21.5 });
check("Грами — вага порції × кількість", lib.dishGrams(bigMac, 1.5), 318);
check("Порції з грамів запису", lib.portionsOfEntry(bigMac, { grams: 424 }), 2);
check("Порції з ккал, коли грамів немає", lib.portionsOfEntry(bigMac, { nutrition: { kcal: 263, protein: 0, fat: 0, carbs: 0 } }), 0.5);

for (const r of data.RESTAURANTS) {
  const dishes = menus[r.id].categories.flatMap((c) => c.dishes);
  const bad = dishes.filter((d) => {
    const n = lib.dishNutrition(d, 2);
    return Math.abs(n.kcal - d.kcal * 2) > 0.5 || Math.abs(n.protein - (d.protein ?? 0) * 2) > 0.05;
  });
  problems(`${r.name}: записане = порція × кількість`, bad.map((d) => d.name));
}

const lc = menus["lviv-croissants"].categories.flatMap((c) => c.dishes)[0];
check("Лише ккал: Б/Ж/В у записі нулі, ккал — з офіційних", lib.dishNutrition(lc, 1), {
  kcal: lc.kcal,
  protein: 0,
  fat: 0,
  carbs: 0,
});

console.log("── Пошук ──");
const found = (menu, q) => lib.filterMenu(menu, q).categories.flatMap((c) => c.dishes.map((d) => d.name));
check("«біг мак» знаходить Біг Мак", found(mcd, "біг мак").includes("Біг Мак"), true);
check("регістр не важить", found(mcd, "БІГ МАК").includes("Біг Мак"), true);
check("слова в будь-якому порядку", found(mcd, "мак біг").includes("Біг Мак"), true);
check("порожній запит — усе меню", lib.filterMenu(mcd, "  "), mcd);
check("нічого — порожньо", found(mcd, "борщ"), []);
check("KFC: «твістер гострий»", found(menus.kfc, "твістер гострий").includes("Твістер гострий"), true);

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
