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

const { matchRecipe, fridgeMatches } = await jiti.import(
  path.join(root, "src/lib/matching.ts"),
);
const { ing, isSeasoning, INGREDIENTS, haveTypes } = await jiti.import(
  path.join(root, "src/data/ingredients.ts"),
);
const INGREDIENT_COUNT = INGREDIENTS.length;

const withSalt = {
  ingredients: [{ key: "kurka" }, { key: "sil" }],
};

/*
 * Базове більше не вважається наявним за замовчуванням: у коморі для нього є
 * власний чеклист, і якщо олії там не позначено, то її справді немає.
 */
check(
  "без солі в коморі вона в списку браку",
  matchRecipe(withSalt, haveTypes(["kurka"])).missing.join(","),
  "sil",
);
check(
  "позначена сіль рахується наявною",
  matchRecipe(withSalt, haveTypes(["kurka", "sil"])).missing.join(","),
  "",
);
check(
  "відсоток збігу теж це враховує",
  matchRecipe(withSalt, haveTypes(["kurka"])).pct,
  50,
);

/*
 * Крупи теж базові: рис і паста лежать у шафі роками, і питання «скільки в
 * тебе рису» має рівно стільки ж сенсу, скільки «скільки в тебе солі».
 */
check("рис — базовий", ing("rys").staple, true);
check("гречка — базова", ing("grechka").staple, true);
check("паста — базова", ing("makarony").staple, true);
check("сочевиця — базова", ing("sochevytsya").staple, true);
// А от те, що псується, базовим не стає — це перевіряли ще на яйцях.
check("яйця не базові", ing("yajtsya").staple, false);
check("курка не базова", ing("kurka").staple, false);

/*
 * Але «базове» і «присмака» — різні речі. Страва з рису це страва з рису,
 * а страва з солі — це ніяка не страва.
 */
check("сіль — присмака", isSeasoning("sil"), true);
check("олія — присмака", isSeasoning("oliya"), true);
check("рис — ні", isSeasoning("rys"), false);
check("паста — ні", isSeasoning("makarony"), false);

/*
 * Через це підбір за холодильником не має губити страви, у яких усе базове:
 * паста з часником і олією — саме те, що готують, коли в холодильнику
 * порожньо.
 */
const pastaGarlic = {
  id: "r_pasta_garlic",
  title: "Паста з часником",
  ingredients: [{ key: "makarony" }, { key: "chasnyk" }, { key: "oliya" }],
};
check(
  "страва, для якої є геть усе, не зникає",
  fridgeMatches([pastaGarlic], haveTypes(["makarony", "chasnyk", "oliya"])).length,
  1,
);
// А ось лише присмака приводом не є: інакше до всього радили б усе.
check(
  "сама лише олія — не привід",
  fridgeMatches([pastaGarlic], haveTypes(["oliya"])).length,
  0,
);

console.log("── Дописані продукти ──");

const { setCustomIngredients, allIngredients, ownKey, knownIngredient } = await jiti.import(
  path.join(root, "src/data/ingredients.ts"),
);

// Ключ власного продукту читабельний, але свідомо не такий, як вбудований:
// збіг означав би, що в чужому рецепті мовчки підмінився продукт.
check("ключ із префіксом", ownKey("Кокосове борошно").startsWith("own_"), true);
// Основа читабельна, а хвіст є завжди: каталог спільноти на пристрої може
// бути неповним, і двоє з однаковою назвою не мають дістати один ключ.
check("ключ із назви", /^own_kokosove_boroshno_[a-z0-9]{4}$/.test(ownKey("Кокосове борошно")), true);
check("двічі — різні ключі", ownKey("Кокосове борошно") === ownKey("Кокосове борошно"), false);
check("порожня назва не ламає ключ", ownKey("🙂").startsWith("own_"), true);

const coconut = {
  key: "own_kokosove_boroshno",
  label: "Кокосове борошно",
  emoji: "🥥",
  cat: "grain",
  aliases: ["кокосове борошно"],
  defaultUnit: "g",
  nutrition: { kcal: 400, protein: 20, fat: 14, carbs: 60 },
};

check("доки не додали — невідоме", knownIngredient(coconut.key), false);
check("і в назві не впізнається", findIngredient("Кокосове борошно")?.key ?? null, "boroshno");

setCustomIngredients([coconut]);

check("після додавання — відоме", knownIngredient(coconut.key), true);
check("є в спільному переліку", allIngredients().some((d) => d.key === coconut.key), true);
check("вбудовані не зникли", allIngredients().length > INGREDIENT_COUNT, true);
// Найголовніше: власний продукт упізнається в назві з чека й етикетки —
// інакше він живе лише в пошуку, а це половина користі.
check("впізнається в назві", findIngredient("Кокосове борошно 500 г")?.key ?? null, coconut.key);
// І не перебиває вбудований там, де йдеться про звичайне борошно.
check("звичайне борошно лишається собою", findIngredient("Борошно пшеничне")?.key ?? null, "boroshno");

setCustomIngredients([]);
check("прибрали — знову невідоме", knownIngredient(coconut.key), false);

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

console.log("── Не пропонувати щойно готоване ──");

const { suggestable, applyFilters, emptyFilters } = await jiti.import(
  path.join(root, "src/lib/matching.ts"),
);

const borsch = byTitle("Червоний борщ");
const day = 24 * 60 * 60 * 1000;
const cookedRecently = {
  ...empty,
  avoidRecentDays: 7,
  cooked: [{ recipeId: borsch.id, at: new Date(Date.now() - 2 * day).toISOString() }],
  remoteReady: true,
  remoteRecipes: SEED_RECIPES,
};

const titles = (state) => suggestable(state).map((r) => r.title);

check("готоване два дні тому не пропонуємо", titles(cookedRecently).includes(borsch.title), false);
check("решта страв на місці", titles(cookedRecently).length, SEED_RECIPES.length - 1);

// Вісім днів — уже не «щойно».
const longAgo = {
  ...cookedRecently,
  cooked: [{ recipeId: borsch.id, at: new Date(Date.now() - 8 * day).toISOString() }],
};
check("через тиждень повертається", titles(longAgo).includes(borsch.title), true);

// Знята галочка означає «пропонуй усе».
check(
  "вимкнене уподобання нічого не ховає",
  titles({ ...cookedRecently, avoidRecentDays: null }).includes(borsch.title),
  true,
);

/*
 * А пошук цим не користується навмисно: ховати борщ тому, що його готували
 * вчора, — це не турбота, а поломка.
 */
check(
  "пошук показує все",
  applyFilters(cookedRecently, { ...emptyFilters, query: "борщ" }).length,
  1,
);

console.log("── Різновиди типів ──");

const types = await jiti.import(path.join(root, "src/data/ingredients.ts"));
const { unitDef } = await jiti.import(path.join(root, "src/lib/units.ts"));
const { rescueMatches, shoppingListFor } = await jiti.import(path.join(root, "src/lib/matching.ts"));
const { readFileSync, readdirSync } = await import("node:fs");
const same = (label, actual, expected) => check(label, JSON.stringify(actual), JSON.stringify(expected));

/*
 * Інваріанти вбудованого дерева. Воно живе в коді, а база лише дзеркалить його
 * (supabase/builtin-ingredients.sql), тож помилка тут розійшлась би всюди.
 */
const builtinKeys = new Set(INGREDIENTS.map((d) => d.key));
check(
  "батьки вбудованих — теж вбудовані",
  INGREDIENTS.filter((d) => d.parent && !builtinKeys.has(d.parent)).map((d) => d.key).join(","),
  "",
);
const rawDepth = (def) => {
  let n = 0;
  const seen = new Set([def.key]);
  for (let cur = def.parent; cur; cur = types.ING_BY_KEY.get(cur)?.parent) {
    if (seen.has(cur)) return Infinity;
    seen.add(cur);
    n += 1;
  }
  return n;
};
check("вбудоване дерево без циклів", INGREDIENTS.filter((d) => rawDepth(d) === Infinity).map((d) => d.key).join(","), "");
check("вбудовані різновиди не глибші за 3 рівні", INGREDIENTS.filter((d) => rawDepth(d) > 3).map((d) => d.key).join(","), "");

/*
 * Міри різновиду й батька мусять зводитись: списання й «є 1,9 л» рахують через
 * грами. Грами й мілілітри — одна родина (1 мл ≈ 1 г, як у nutrition.ts), а
 * штуки — лише коли відома вага штуки: «Помідори чері» в грамах під
 * «Помідором» у штуках по 120 г зводяться, а штуки без ваги — ні.
 */
const measure = (def) => {
  const base = unitDef(def.defaultUnit ?? "g").base;
  if (base === "g" || base === "ml") return "маса";
  if (base === "pcs" && types.typeValue(def.key, "gramsPerPiece")) return "маса";
  return base;
};
check(
  "міри різновиду й батька зводяться",
  INGREDIENTS.filter((d) => d.parent && measure(d) !== measure(types.ing(d.parent))).map((d) => `${d.key}→${d.parent}`).join(", "),
  "",
);

/*
 * Вагу штуки різновид успадковує, лише коли міряється так само, як той, у кого
 * її бере. «Пармезан» у грамах під «Твердим сиром» у грамах — шматочок по 20 г,
 * чесно. А «Помідори чері» в грамах під «Помідором» у штуках без власної ваги
 * важили б по 120 г за штуку: «10 шт» — 1,2 кг калорій і списана вся пачка.
 */
const pieceDonor = (def) => types.lineage(def.key).find((k) => types.ing(k).gramsPerPiece != null);
check(
  "вагу штуки успадковують лише від типу з тією самою мірою",
  INGREDIENTS.filter((d) => d.parent && d.gramsPerPiece == null)
    .filter((d) => {
      const donor = pieceDonor(d);
      return donor && types.ing(donor).defaultUnit !== d.defaultUnit;
    })
    .map((d) => `${d.key}→${pieceDonor(d)}`)
    .join(", "),
  "",
);

// Спільний синонім батька й різновиду — і findIngredient вгадує навмання.
const names = (def) => new Set([def.label, ...(def.aliases ?? [])].map((t) => t.toLowerCase().trim()));
check(
  "батько й різновид не ділять синонімів",
  INGREDIENTS.filter((d) => d.parent)
    .flatMap((d) => types.ancestors(d.key).flatMap((a) => [...names(types.ing(a))].filter((n) => names(d).has(n)).map((n) => `${d.key}/${a}: ${n}`)))
    .join("; "),
  "",
);

const committed = readFileSync(path.join(root, "scripts/builtin-keys.txt"), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
check(
  "ключі вбудованих лише додаються (scripts/builtin-keys.txt)",
  committed.filter((k) => !builtinKeys.has(k)).join(","),
  "",
);

const { renderBuiltinSql, BUILTIN_SQL_PATH } = await import("./generate-builtin-sql.mjs");
check(
  "supabase/builtin-ingredients.sql збігається з каталогом (інакше npm run db:seed-sql)",
  readFileSync(BUILTIN_SQL_PATH, "utf8").replace(/\r\n/g, "\n") === renderBuiltinSql(INGREDIENTS),
  true,
);

/*
 * Тавро HaveSet ловить лише виклики matchRecipe й сусідів. Код, що сам складає
 * набір із ключів комори й питає .has, компілятор не бачить — і такий код мовчки
 * не знав би, що безлактозне молоко теж молоко. Тому шукаємо його в тексті.
 */
const HAND_BUILT = /\bpantry\w*\.map\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.key\s*\)/;
const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : [],
  );
const offenders = [];
for (const file of sources(path.join(root, "src"))) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (rel === "src/lib/store.ts") continue; // pantryTypes і pantryKeyList
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (HAND_BUILT.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
}
check("ключі комори в набір складає лише pantryTypes (store.ts)", offenders.join(", "), "");

check("безлактозне годиться там, де треба молоко", types.satisfies("moloko_bezlaktozne", "moloko"), true);
check("звичайне молоко не годиться як безлактозне", types.satisfies("moloko", "moloko_bezlaktozne"), false);
check("тип годиться сам собі", types.satisfies("moloko", "moloko"), true);
check("відстань різновиду до батька", types.typeDistance("moloko_bezlaktozne", "moloko"), 1);
check("відстань, коли не годиться", types.typeDistance("moloko", "moloko_bezlaktozne"), -1);
same("родовід", types.lineage("moloko_bezlaktozne"), ["moloko_bezlaktozne", "moloko"]);
same("різновиди грибів", [...types.descendants("gryby")].sort(), ["bilyi_hryb", "hlyva", "pecherytsi"]);
same("набір із загальнішими", [...types.haveTypes(["moloko_bezlaktozne"])].sort(), ["moloko", "moloko_bezlaktozne"]);
same("загальний тип не тягне різновидів", [...types.haveTypes(["moloko"])], ["moloko"]);

/*
 * Присмака за родоводом. «Оливкова» тут не годиться: вона сама в SEASONINGS і
 * без батька, тож пройшла б і без родоводу. Потрібен дописаний різновид олії
 * з категорією не «спеції». Реєструємо його в екземплярі «@/data/ingredients»:
 * саме той бачить fridgeMatches (jiti тримає окремий модуль на кожне написання
 * імпорту), а isSeasoning беремо звідти ж.
 */
{
  const aliased = await jiti.import("@/data/ingredients");
  const pumpkinOil = { key: "own_oliya_garbuz", label: "Олія гарбузова", emoji: "🫒", cat: "sauce", aliases: [], defaultUnit: "ml", parent: "oliya" };
  aliased.setCustomIngredients([pumpkinOil]);
  check("присмака за родоводом: «Олія гарбузова» → «Олія»", aliased.isSeasoning("own_oliya_garbuz"), true);
  check(
    "холодильник: сама гарбузова олія — не привід радити страву",
    fridgeMatches([{ id: "r_oil", ingredients: [{ key: "own_oliya_garbuz" }, { key: "makarony" }] }], aliased.haveTypes(["own_oliya_garbuz"])).length,
    0,
  );
  aliased.setCustomIngredients([]);
}

/*
 * «Новий тип продукту»: кого запропонувати в батьки й коли назва — дублікат.
 * Пропозиція строга: соєве молоко не молоко (H2.1), рисове борошно не рис.
 */
for (const [name, expected] of [
  ["Кефір безлактозний", "kefir"],
  ["Олія гарбузова", "oliya"],
  ["Сметана безлактозна", "smetana"],
  ["Помідори чері жовті", "pomidory_cherri"],
  ["Соєве молоко", null],
  ["Мигдальне молоко", null],
  ["Сухе молоко", null],
  ["Рисове борошно", null],
  ["Рисове молоко", null],
  ["Кокосове борошно", null],
  ["Гречане борошно", null],
  ["Горіхова паста", null],
  ["Кефір", null],
]) {
  check(`батько для «${name}»`, types.variantParentGuess(name)?.key ?? null, expected);
}
check("дублікат за синонімом: «Шампіньйони» — це «Печериці»", types.sameNameIngredient("Шампіньйони")?.key, "pecherytsi");
check("дублікат за назвою важливіший за синонім", types.sameNameIngredient("  молоко ")?.key, "moloko");
check("не дублікат", types.sameNameIngredient("Молоко козяче"), null);

const custom = (key, parent, extra = {}) => ({
  key,
  label: key,
  emoji: "🥛",
  cat: "dairy",
  aliases: [],
  defaultUnit: "ml",
  ...(parent ? { parent } : {}),
  ...extra,
});

const v0 = types.currentRegistryVersion();
types.setCustomIngredients([custom("own_kefir_bezl", "kefir")]);
check("версія реєстру росте з каталогом", types.currentRegistryVersion() > v0, true);
check("дописаний різновид вбудованого", types.satisfies("own_kefir_bezl", "kefir"), true);
check("і кефір із ним у рецепті є", matchRecipe({ ingredients: [{ key: "kefir" }] }, haveTypes(["own_kefir_bezl"])).pct, 100);

// I6: обʼєднані дописані типи. Рецептів ніхто не переписує — рецепт зі старим
// ключем (own_b) і комора з новим (own_a), або навпаки, мусять зустрітись.
types.setCustomIngredients([custom("own_a", "kefir"), custom("own_b", "kefir", { mergedInto: "own_a" })]);
check("злитий тип: канонічний ключ — переможець", types.canonicalKey("own_b"), "own_a");
check("рецепт з A, у коморі злитий B → є", matchRecipe({ ingredients: [{ key: "own_a" }] }, haveTypes(["own_b"])).pct, 100);
check("рецепт зі злитим B, у коморі A → є", matchRecipe({ ingredients: [{ key: "own_b" }] }, haveTypes(["own_a"])).pct, 100);
check("злитий B лишається різновидом кефіру через A", matchRecipe({ ingredients: [{ key: "kefir" }] }, haveTypes(["own_b"])).pct, 100);
check("чужий тип злиттям не підхоплюється", matchRecipe({ ingredients: [{ key: "own_a" }] }, haveTypes(["kefir"])).pct, 0);

// Новий каталог — новий родовід: памʼять не тримає старого батька.
types.setCustomIngredients([custom("own_kefir_bezl", null)]);
check("батька прибрали — вже не кефір", types.satisfies("own_kefir_bezl", "kefir"), false);

// Цикл, зібраний із дописаних (у базі його не пустить запобіжник, але локальне
// сховище може принести що завгодно), обривається, а не вішає застосунок.
types.setCustomIngredients([custom("own_a", "own_b"), custom("own_b", "own_c"), custom("own_c", "own_a")]);
same("цикл дописаних обривається", types.ancestors("own_a"), ["own_b", "own_c"]);
check("і набір збирається", types.haveTypes(["own_a"]).size, 3);
same("різновиди в циклі — теж без безкінечності", [...types.descendants("own_a")].sort(), ["own_b", "own_c"]);

const chain = Array.from({ length: 10 }, (_, i) => custom(`own_l${i}`, i ? `own_l${i - 1}` : "moloko"));
types.setCustomIngredients(chain);
check("родовід не глибший за MAX_TYPE_DEPTH", types.ancestors("own_l9").length, types.MAX_TYPE_DEPTH);
check("глибина типу", types.typeDepth("own_l2"), 3);
types.setCustomIngredients([]);

// Підбір страв: різновид у коморі закриває потребу в загальнішому.
const pancakes = byTitle("Млинці");
const lactoseFree = haveTypes(["moloko_bezlaktozne"]);
check("рецепт із молоком бачить безлактозне", matchRecipe(pancakes, lactoseFree).missing.includes("moloko"), false);
check(
  "безлактозному рецепту звичайне молоко не підходить",
  matchRecipe({ ingredients: [{ key: "moloko_bezlaktozne" }] }, haveTypes(["moloko"])).missing.join(","),
  "moloko_bezlaktozne",
);
check(
  "холодильник: безлактозне відкриває страву з молоком",
  fridgeMatches([{ id: "r_milk", ingredients: [{ key: "moloko" }, { key: "banan" }] }], lactoseFree).length,
  1,
);
check("список покупок не радить молоко, коли є безлактозне", shoppingListFor([pancakes], lactoseFree).some((x) => x.key === "moloko"), false);
check("а бананів таки бракує", shoppingListFor([pancakes], lactoseFree).some((x) => x.key === "banan"), true);

const noon = new Date(2026, 8, 10, 12, 0, 0);
const rescue = rescueMatches(
  [{ id: "r_milk", ingredients: [{ key: "moloko" }, { key: "yajtsya" }] }],
  [{ key: "moloko_bezlaktozne", addedAt: noon.toISOString(), expiresAt: "2026-09-11" }],
  { now: noon },
);
check("безлактозне, що псується завтра, рятує рецепт із молоком", rescue.length, 1);
same("і рятує саме «Молоко»", rescue[0]?.saves, [{ key: "moloko", days: 1 }]);

const kokteil = suggestDrinks({ ...empty, pantry: [{ key: "moloko_bezlaktozne" }] }, pancakes, 3, at(13)).find(
  (p) => p.drink.key === "kokteil",
);
check("напій із молоком — «вже вдома», коли є безлактозне", kokteil?.home, true);

// Назви: фраза різновиду перемагає однослівного батька, але не тягне сусідів.
byName("Молоко безлактозне Галичина 900мл", "moloko_bezlaktozne");
byName("Молоко Галичина 2,5% 900 мл", "moloko");
byName("Кефір безлактозний", "kefir");
byName("печериці", "pecherytsi");
byName("Шампіньйони свіжі", "pecherytsi");
byName("Малина заморожена", "malyna");
byName("Свинячий ошийок", "oshyjok");
byName("кукурудзяне борошно", "kukurudziane_boroshno");
byName("кукурудзяний крохмаль", "krokhmal_kukurudz");
byCat(["en:dairies", "en:milks", "en:lactose-free-milks"], "moloko_bezlaktozne");

// Дописані без мережі йдуть у базу пачкою: батьки раніше за різновиди.
const api = await jiti.import(path.join(root, "src/lib/supabase/api.ts"));
{
  const stored = new Set();
  const written = [];
  const insert = async (def) => {
    if (def.parent?.startsWith("own_") && !stored.has(def.parent)) {
      throw Object.assign(new Error(`Немає типу ${def.parent}`), { code: "23503" });
    }
    stored.add(def.key);
    written.push(def.key);
  };
  await api.upsertCustomIngredientsInOrder(
    [custom("own_kefir_dom_bezl", "own_kefir_dom"), custom("own_kefir_dom", "kefir")],
    "u",
    insert,
  );
  same("батько записаний раніше за різновид", written, ["own_kefir_dom", "own_kefir_dom_bezl"]);
}
{
  // Батько — чужий тип, який інший пристрій дописує саме зараз: перша спроба
  // впала на 23503, повтор після решти проходить.
  let parentArrived = false;
  const written = [];
  const insert = async (def) => {
    if (def.key === "own_x" && !parentArrived) {
      parentArrived = true;
      throw Object.assign(new Error("Немає типу own_chuzhyi"), { code: "23503" });
    }
    written.push(def.key);
  };
  await api.upsertCustomIngredientsInOrder([custom("own_x", "own_chuzhyi"), custom("own_y", null)], "u", insert);
  same("23503 — повтор наприкінці вдається", written, ["own_y", "own_x"]);
}
{
  // Інша помилка не зупиняє решту пачки, але не губиться.
  const written = [];
  let thrown = null;
  const insert = async (def) => {
    if (def.key === "own_bad") throw Object.assign(new Error("rls"), { code: "42501" });
    written.push(def.key);
  };
  await api
    .upsertCustomIngredientsInOrder([custom("own_bad", null), custom("own_ok", null)], "u", insert)
    .catch((e) => (thrown = e));
  same("решта пачки записана", written, ["own_ok"]);
  check("помилка дійшла до викликача", thrown?.code, "42501");
}
{
  /*
   * Спільнота перезавантажується від кожної чужої правки й приносить каталог
   * новим масивом. Той самий вміст не має бути новою версією реєстру: інакше
   * головна перемішує «Для тебе» під пальцем. Сховище бачить реєстр через
   * «@/data/ingredients» — звідти й читаємо версію.
   */
  // Без браузера persist лише попереджає, що localStorage немає, — тут це шум.
  const warn = console.warn;
  console.warn = () => {};
  const { useApp } = await jiti.import("@/lib/store");
  const registry = await jiti.import("@/data/ingredients");
  const catalog = () => [custom("own_kefir_bezl", "kefir", { nutrition: { kcal: 40, protein: 3, fat: 1, carbs: 4 } })];
  useApp.getState().setCustomIngredients(catalog());
  const before = registry.currentRegistryVersion();
  const list = useApp.getState().customIngredients;
  useApp.getState().setCustomIngredients(catalog());
  check("той самий каталог новим масивом — версія та сама", registry.currentRegistryVersion(), before);
  check("і стан не міняється", useApp.getState().customIngredients === list, true);
  useApp.getState().setCustomIngredients([custom("own_kefir_bezl", null)]);
  check("інший батько — нова версія", registry.currentRegistryVersion() > before, true);
  useApp.getState().setCustomIngredients([]);
  console.warn = warn;
}

console.log(`\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
