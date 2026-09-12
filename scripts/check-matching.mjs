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

/*
 * Родовий відмінок коротких назв. Відрізання закінчення вимагало, щоб після
 * нього лишалось чотири букви, тож найкоротші слова не скорочувались узагалі
 * й не впізнавались: «сиру», «рису», «меду», «води».
 */
byName("200 г сиру", "syr");
byName("склянка рису", "rys");
byName("ложка меду", "med");
byName("180 мл води", "voda");
byName("2 ст. л. олії", "oliya");
byName("500 г борошна", "boroshno");

/*
 * Чергування «і» з «о»: у закритому складі «сіль» і «сік», у відкритому —
 * «солі» й «соку». Відрізанням закінчення такі пари не звести.
 */
byName("1 ч. л. солі", "sil");
byName("склянка соку", "sik");

/*
 * Межа правила. «Мілк» у назві снека — не молоко: чергування застосовуємо
 * лише до односкладових коренів, інакше транслітерації починають збігатися
 * з українськими словами.
 */
byName("Снек Кіндер Мілк Слайс 28г", null);
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

console.log("── Базові продукти ──");

const { matchRecipe } = await jiti.import(path.join(root, "src/lib/matching.ts"));

const withSalt = {
  ingredients: [{ key: "kurka" }, { key: "sil" }],
};

/*
 * Базове більше не вважається наявним за замовчуванням: у коморі для нього є
 * власний чеклист, і якщо олії там не позначено, то її справді немає.
 */
check(
  "без солі в коморі вона в списку браку",
  matchRecipe(withSalt, new Set(["kurka"])).missing.join(","),
  "sil",
);
check(
  "позначена сіль рахується наявною",
  matchRecipe(withSalt, new Set(["kurka", "sil"])).missing.join(","),
  "",
);
check(
  "відсоток збігу теж це враховує",
  matchRecipe(withSalt, new Set(["kurka"])).pct,
  50,
);

console.log("── Що до чого подавати ──");

const { suggestPairs, suggestDrinks, courseOf, WHEEL_COURSES } = await jiti.import(
  path.join(root, "src/lib/pairing.ts"),
);
const { SEED_RECIPES } = await jiti.import(path.join(root, "src/data/seed.ts"));

const byTitle = (t) => SEED_RECIPES.find((r) => r.title.startsWith(t));
const empty = { cooked: [], pantry: [], myRecipes: [], remoteRecipes: [] };
const titlesFor = (recipe, state = empty) =>
  suggestPairs(state, recipe, SEED_RECIPES, 3).map((p) => p.recipe.title);

const salmon = byTitle("Лосось");
const buckwheat = byTitle("Гречка");
const pizza = byTitle("Піца");

check("тип страви з поля", courseOf(salmon), "main");
check("гарнір лишається гарніром", courseOf(buckwheat), "side");

// До самодостатньої страви гарнір не пропонують — мовчання теж відповідь.
check("до піци нічого не радимо", suggestPairs(empty, pizza, SEED_RECIPES).length, 0);

// До основної страви йде гарнір, і гречка має бути серед підказок.
check("до риби радять гарнір", titlesFor(salmon).includes(buckwheat.title), true);

// Сама себе страва не радить.
check("без самого себе", titlesFor(buckwheat).includes(buckwheat.title), false);

/*
 * Найсильніший сигнал — власна історія. Дві страви, які вже готували одного
 * дня, мають виходити наперед, навіть коли інші ознаки за них не говорять.
 */
const together = {
  ...empty,
  cooked: [
    { recipeId: salmon.id, at: "2026-09-01T18:00:00.000Z" },
    { recipeId: byTitle("Овочеве рагу").id, at: "2026-09-01T18:30:00.000Z" },
  ],
};
check("історія готувань важить найбільше", titlesFor(salmon, together)[0], byTitle("Овочеве рагу").title);

console.log("\n── Напої ──");

/* Час доби: та сама страва, різна відповідь. */
const at = (hour) => new Date(2026, 8, 10, hour, 0, 0);
const drinksAt = (recipe, hour, state = empty) =>
  suggestDrinks(state, recipe, 3, at(hour)).map((p) => p.drink.key);

check("кава ввечері не радиться", drinksAt(byTitle("Тірамісу"), 22).includes("kava"), false);
check("кава зранку радиться", drinksAt(byTitle("Тірамісу"), 9).includes("kava"), true);
check("вино зранку не радиться", drinksAt(byTitle("Справжня карбонара"), 10).includes("vyno_chervone"), false);
check("вино ввечері доречне", drinksAt(byTitle("Справжня карбонара"), 19).includes("vyno_chervone"), true);

// Три чаї підряд — це не вибір: з кожного роду щонайбільше один.
const kinds = suggestDrinks(empty, byTitle("Гречка"), 3, at(13)).map((p) => p.drink.kind);
check("напої різного роду", new Set(kinds).size, kinds.length);

// Гостре запивають кисломолочним — і саме це й має бути написано причиною.
const tomYam = suggestDrinks(empty, byTitle("Том ям"), 3, at(19));
const tamed = tomYam.find((p) => p.drink.kind === "dairy" || p.drink.key === "lymonad");
check("до гострого — те, що його гасить", tamed?.reason, "гостре стане мʼякшим");

// Те, що вже стоїть у холодильнику, виходить наперед.
const withKompot = { ...empty, pantry: [{ key: "kompot" }] };
const first = suggestDrinks(withKompot, byTitle("Гречка"), 3, at(13))[0];
check("напій із комори — першим", first?.drink.key, "kompot");
check("і з поясненням", first?.reason, "вже є в коморі");

// У барабан рулетки напої та соуси не потрапляють.
check("колесо без напоїв", WHEEL_COURSES.includes("drink"), false);
check("колесо без соусів", WHEEL_COURSES.includes("sauce"), false);
check("колесо з гарнірами", WHEEL_COURSES.includes("side"), true);

console.log(`\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
