#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка зіставлення товару з довідником інгредієнтів.
 *
 * Запуск: npm run check:matching
 *
 * Мережі не потребує: перевіряємо саме логіку, а не доступність
 * Open Food Facts. Назви й категорії взяті з реальних відповідей API.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { findIngredient, findIngredientByCategory } = await jiti.import(
  path.join(root, "src/data/ingredients.ts"),
);

let pass = 0;
let fail = 0;
const check = (input, actual, expected) => {
  if (actual === expected) {
    pass++;
    return;
  }
  fail++;
  console.log(`  ✗ «${input}»\n      отримано: ${actual ?? "нічого"}\n      очікувано: ${expected ?? "нічого"}`);
};

const byName = (text, expected) => check(text, findIngredient(text)?.key ?? null, expected);
const byCat = (tags, expected) =>
  check(tags.join(" "), findIngredientByCategory(tags)?.key ?? null, expected);

console.log("── Назва товару ──");

// Звичайні назви з полиці
byName("Сметана 20%", "smetana");
byName("Молоко пастеризоване 2,5%", "moloko");
byName("Хліб Київський нарізний", "khlib");
byName("Цукор білий кристалічний", "tsukor");
byName("Яйця курячі С0", "yajtsya");

// Порядок слів. Синонім записано як «томатний сік», на етикетці — навпаки.
byName("Сік томатний", "tomatnyi_sik");
byName("Сир кисломолочний 9% Яготинське", "tvorog");

// Синонім із двох слів має перемагати односкладовий: інакше «Томати
// консервовані» стають свіжими помідорами.
byName("Томати консервовані в соку", "pomidory_konserv");
byName("Peanut Butter Smooth", "arahisova_pasta");
byName("Coconut Milk", "kokos_moloko");

// Відмінювання: «молока» і «молоко» мають зводитись до спільної основи
byName("Пляшка молока", "moloko");
byName("Банка сметани", "smetana");

/*
 * Випадний голосний і мʼякий знак. У називному відмінку голосний є, у решті
 * форм зникає — «огірок» проти «огірки», «оселедець» проти «оселедця», —
 * і саме тому відкидання закінчень такі пари не зводило.
 */
byName("Огірки", "ogirok");
byName("Огірок", "ogirok");
byName("Філе оселедця", "oseledets");
byName("Перцю чорного меленого", "perets_ch");
byName("Сіль морська", "sil");

/*
 * Головне слово назви важить більше за ознаку. Синонім «молочний» потрібен
 * молоку, щоб зіставлялось «Молочний коктейль», але «Ковбаса Молочна» — це
 * ковбаса, і без цього правила вона ставала молоком.
 */
byName("Ковбаса Молочна", "kovbasa");
byName("Сир Гауда", "syr");
byName("Сир кисломолочний", "tvorog");
byName("Помідори чері", "pomidory_cherri");

// Різні основи — беруться зі списку синонімів, не з відкидання закінчень
byName("Крупа гречана ядриця", "grechka");
byName("Масло солодковершкове 82%", "maslo");

// Регресія: пошук ішов підрядком і по латинських ключах, тож ключ «nut»
// знаходився всередині «Nutella», «Peanut», «Coconut».
byName("Nutella", null);
byName("Nutella Biscuits", "pechyvo");
byName("Coca-Cola", "lymonad");

console.log("── Категорії Open Food Facts ──");

// Тег і є назвою продукту
byCat(["en:dairies", "en:milks"], "moloko");
byCat(["en:cheeses"], "syr");
byCat(["en:sauces", "en:pestos"], "pesto");
byCat(["en:tomatoes"], "pomidor");
byCat(["en:potatoes"], "kartoplya");
byCat(["en:olive-oils"], "olyvkova");

// Регресія: у ланцюжку категорій Fanta є "orange-soft-drinks", і слово
// «orange» саме по собі робило з газованки апельсин. Лимонад — правильна
// відповідь, апельсин — ні, і саме це тут перевіряється.
byCat(
  ["en:beverages", "en:carbonated-drinks", "en:sodas", "en:orange-soft-drinks"],
  "lymonad",
);
byCat(["en:beverages", "en:waters", "en:sparkling-waters"], "voda_gazovana");
byCat(["en:beverages", "en:juices"], "sik");
byCat(["en:beverages", "en:alcoholic-beverages", "en:beers"], "pyvo");

// Конкретніший тег важить більше за загальний
byCat(["en:groceries", "en:canned-foods", "en:canned-tomatoes"], "pomidory_konserv");

console.log("── Чим готувати ──");

const { cookingNeeds, needsSocket } = await jiti.import(path.join(root, "src/lib/power.ts"));

const dish = (...steps) => ({ steps: steps.map((text) => ({ text })) });
const needs = (text, field, expected) =>
  check(`«${text}» → ${field}`, cookingNeeds(dish(text))[field], expected);

needs("Розігрій духовку до 200° і запікай 40 хвилин", "oven", true);
needs("Обсмаж цибулю на сковороді до золотого", "stove", true);
needs("Звари макарони в підсоленій воді", "stove", true);
needs("Пробий нут із тахіні до гладкості", "appliance", true);
needs("Наріж овочі й заправ олією", "stove", false);
needs("Наріж овочі й заправ олією", "oven", false);

// Газова плита працює й без світла, духовка — ні: у цьому вся різниця
// між «світла немає» і «готувати нічим».
check(
  "плита не потребує розетки",
  needsSocket(cookingNeeds(dish("Обсмаж на сковороді"))),
  false,
);
check(
  "духовка потребує розетки",
  needsSocket(cookingNeeds(dish("Запікай у духовці"))),
  true,
);

console.log(`\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
