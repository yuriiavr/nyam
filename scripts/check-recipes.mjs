#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка того, що правка рецепта доїжджає до бази і не губиться дорогою.
 *
 * Запуск: npm run check:recipes
 *
 * Мережі не потребує. Скрипт з'явився після реального бага: людина правила
 * рецепт, бачила зміну до перезапуску, а потім вона зникала. Причин було
 * кілька — частина страви не писалась у базу, рецепт з уже вивантаженим фото
 * не писався взагалі, замінене фото лишалось під старим посиланням, а знімок
 * бази затирав правку, яка не встигла долетіти. Кожна з них тут має свій
 * рядок перевірки.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const api = await jiti.import(path.join(root, "src/lib/supabase/api.ts"));
const sync = await jiti.import(path.join(root, "src/lib/sync.ts"));

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

const { recipeToRow, rowToRecipe, RECIPE_SELECT } = api;

/** Що робить із рядком база: jsonb і text[] — це JSON, статистику й час додає сама. */
function throughDatabase(row, extra = {}) {
  const stored = JSON.parse(JSON.stringify(row));
  const selected = {};
  for (const column of RECIPE_SELECT.split(",")) selected[column] = stored[column] ?? null;
  return {
    ...selected,
    created_at: "2026-09-11T20:10:58.726272+00:00",
    updated_at: "2026-09-13T13:32:22.492732+00:00",
    likes: 3,
    saves: 1,
    cooks: 2,
    rating_sum: 9,
    rating_count: 2,
    ...extra,
  };
}

const IMG =
  "https://x.supabase.co/storage/v1/object/public/recipe-images/u1/r1-mfh3k2.jpg";

const full = {
  id: "r1",
  title: "Картопля з куркою",
  authorId: "u1",
  emoji: "🥔",
  gradient: ["#16a34a", "#eab308"],
  image: IMG,
  description: "Ситно й просто",
  cuisine: "Українська",
  mealTypes: ["dinner", "lunch"],
  moods: ["hearty", "cozy"],
  tags: ["мультипіч", "на компанію"],
  timeMin: 50,
  difficulty: 2,
  servings: 3,
  kcal: 420,
  costLevel: 2,
  course: "side",
  ingredients: [
    { key: "kartoplya", amount: 350, unit: "g" },
    { key: "sil", unit: "taste", optional: true },
    { key: "barcode:4820000000000", unit: "g", amount: 100, label: "Сир «Моцарела»", nutrition: { kcal: 280, protein: 22, fat: 21, carbs: 1 } },
    { key: "perets_ch", qty: "2-3 шт" },
  ],
  steps: [
    { text: "Ріжемо кубиками" },
    { text: "Ставимо в аерогріль", timerSec: 900, tip: "Перевір на 12-й хвилині" },
  ],
  createdAt: "2026-09-11T20:10:58.726Z",
  stats: { likes: 0, saves: 0, cooks: 0, ratingSum: 0, ratingCount: 0 },
  sourceId: "5f0c7c1e-1111-4222-8333-944444444444",
  mine: true,
};

console.log("── Рецепт туди й назад ──");

const row = recipeToRow(full, "u1");
const selectColumns = new Set(RECIPE_SELECT.split(","));

// Усе, що пишемо, мусимо й читати — інакше записане при перечитуванні зникає.
check(
  "кожна записана колонка є в select",
  Object.keys(row).filter((c) => !selectColumns.has(c)),
  [],
);
check("select читає course", selectColumns.has("course"), true);
check("select читає updated_at", selectColumns.has("updated_at"), true);
check("статистику в базу не шлемо", ["likes", "saves", "cooks"].filter((c) => c in row), []);

const back = rowToRecipe(throughDatabase(row), "u1");
const fields = [
  "id", "title", "authorId", "emoji", "gradient", "image", "description", "cuisine",
  "mealTypes", "moods", "tags", "timeMin", "difficulty", "servings", "kcal", "costLevel",
  "course", "ingredients", "steps", "sourceId",
];
for (const field of fields) check(`поле ${field} повертається тим самим`, back[field], full[field]);
check("mine — за автором", back.mine, true);
check("чужий рецепт не mine", rowToRecipe(throughDatabase(row), "u2").mine, false);
check("статистика — з бази", back.stats, { likes: 3, saves: 1, cooks: 2, ratingSum: 9, ratingCount: 2 });
check("updatedAt — з бази", back.updatedAt, "2026-09-13T13:32:22.492732+00:00");

// Перелік полів вище мусить покривати весь тип: нове поле без рядка тут — провал.
const derived = new Set(["createdAt", "stats", "mine", "updatedAt"]);
check(
  "перевірено кожне поле рецепта",
  Object.keys(full).filter((k) => !fields.includes(k) && !derived.has(k)),
  [],
);

console.log("── Частина страви ──");

for (const course of ["whole", "main", "side", "soup", "salad", "snack", "sauce", "dessert", "drink"]) {
  const r = rowToRecipe(throughDatabase(recipeToRow({ ...full, course }, "u1")), "u1");
  check(`course «${course}» переживає перезапуск`, r.course, course);
}
check("без частини — null у базі", recipeToRow({ ...full, course: undefined }, "u1").course, null);
check("null з бази — не вказано", rowToRecipe(throughDatabase({ ...row, course: null })).course, undefined);
// У колонці немає check-обмеження, тож сміття не пише код.
check("незнайому частину не пишемо", recipeToRow({ ...full, course: "garnish" }, "u1").course, null);
check("незнайому з бази не читаємо", rowToRecipe(throughDatabase({ ...row, course: "garnish" })).course, undefined);
check("«toString» — не частина страви", api.isCourse("toString"), false);

console.log("── Необовʼязкові поля ──");

const bare = rowToRecipe(
  throughDatabase(recipeToRow({ ...full, kcal: undefined, sourceId: undefined, image: null }, "u1")),
);
check("kcal: немає → null → немає", bare.kcal, undefined);
check("sourceId: немає → null → немає", bare.sourceId, undefined);
check("фото прибрали — null", bare.image, null);
check("kcal 0 лишається нулем", rowToRecipe(throughDatabase(recipeToRow({ ...full, kcal: 0 }, "u1"))).kcal, 0);
check(
  "порожні масиви з бази — порожні масиви",
  (({ mealTypes, moods, tags, ingredients, steps }) => ({ mealTypes, moods, tags, ingredients, steps }))(
    rowToRecipe(throughDatabase({ ...row, meal_types: null, moods: null, tags: null, ingredients: null, steps: null })),
  ),
  { mealTypes: [], moods: [], tags: [], ingredients: [], steps: [] },
);
check(
  "градієнт без пари — запасний",
  rowToRecipe(throughDatabase({ ...row, gradient: ["#000"] })).gradient,
  ["#ff6b35", "#ffb020"],
);

console.log("── Шлях і посилання на фото ──");

const { recipeImageObjectPath, recipeImagePath } = api;
const p1 = recipeImageObjectPath("u1", "r1", 1_700_000_000_000);
const p2 = recipeImageObjectPath("u1", "r1", 1_700_000_000_001);
check("шлях у теці користувача", p1.startsWith("u1/r1-") && p1.endsWith(".jpg"), true);
// Нове фото — нове посилання: кеш телефона й CDN не віддадуть старий знімок.
check("друге фото — інший шлях", p1 === p2, false);

const base = "https://x.supabase.co/storage/v1/object/public/recipe-images/";
check("власне фото — шлях", recipeImagePath(`${base}u1/r1-abc.jpg`, "u1"), "u1/r1-abc.jpg");
check("старий шлях без версії — теж власний", recipeImagePath(`${base}u1/r1.jpg`, "u1"), "u1/r1.jpg");
check("хвіст запиту не заважає", recipeImagePath(`${base}u1/r1-abc.jpg?v=2#x`, "u1"), "u1/r1-abc.jpg");
check("чужа тека — не чіпаємо", recipeImagePath(`${base}u2/r1-abc.jpg`, "u1"), null);
check("тека-двійник за префіксом — не чіпаємо", recipeImagePath(`${base}u10/r1.jpg`, "u1"), null);
check("data:URL — не посилання", recipeImagePath("data:image/jpeg;base64,AAAA", "u1"), null);
check("інший бакет — не чіпаємо", recipeImagePath("https://x.supabase.co/storage/v1/object/public/avatars/u1/a.jpg", "u1"), null);
check("стороннє посилання — не чіпаємо", recipeImagePath("https://example.com/u1/r1.jpg", "u1"), null);
check("вихід із теки — не чіпаємо", recipeImagePath(`${base}u1/../u2/r1.jpg`, "u1"), null);

console.log("── Порядок запису ──");

const DATA_A = "data:image/jpeg;base64,AAAA";
const DATA_B = "data:image/jpeg;base64,BBBB";
const OLD = `${base}u1/r-old.jpg`;
const NEW = `${base}u1/r-new.jpg`;

/**
 * Несправжня база. `stored` — фото, яке зараз у рядку (null — немає, undefined —
 * прочитати не вдалось). Рядок без колонки фото записується як ["row"]:
 * саме так має писати sync, щоб застаріла копія не повертала мертве посилання.
 */
function fakeBackend({ stored = OLD, uploadError = null, readFails = false } = {}) {
  const calls = [];
  return {
    calls,
    backend: {
      upsertRecipe: async (recipe, _uid, opts) =>
        void calls.push(opts?.withImage === false ? ["row"] : ["row+image", recipe.image]),
      uploadRecipeImage: async (_uid, dataUrl) => {
        calls.push(["upload", dataUrl]);
        if (uploadError) throw uploadError;
        return NEW;
      },
      getRecipeImage: async () => {
        calls.push(["read"]);
        if (readFails) throw new Error("offline");
        return stored;
      },
      setRecipeImage: async (_id, url) => void calls.push(["image", url]),
      deleteRecipe: async () => {
        calls.push(["delete"]);
        return stored;
      },
      deleteRecipeImageIfUnused: async (_uid, url) => void calls.push(["cleanup", url]),
    },
  };
}

const notices = [];
sync.onSyncError((message) => notices.push(message));
const quiet = async (run) => {
  const warn = console.warn;
  console.warn = () => {}; // збій тут очікуваний — не засмічуємо звіт
  try {
    return await run();
  } finally {
    console.warn = warn;
  }
};
const recorder = () => {
  const events = [];
  return {
    events,
    options: (extra = {}) => ({
      onImageUploaded: (dataUrl, url) => events.push(["uploaded", dataUrl, url]),
      onSaved: () => events.push(["saved"]),
      onImageSaved: () => events.push(["image saved"]),
      onImageRejected: (current) => events.push(["image rejected", current]),
      ...extra,
    }),
  };
};

{
  // Нове фото замість старого: рядок одразу і без фото, знімок — потім.
  const { calls, backend } = fakeBackend();
  const { events, options } = recorder();
  await sync.sendRecipe("u1", { ...full, id: "p1", image: DATA_A }, options({ imageChanged: true }), backend);
  check("заміна фото: рядок першим і без фото, потім фото, потім прибирання", calls, [
    ["row"],
    ["read"],
    ["upload", DATA_A],
    ["image", NEW],
    ["cleanup", OLD],
  ]);
  check("заміна фото: рядок збережено одразу, фото — після вивантаження", events, [
    ["saved"],
    ["uploaded", DATA_A, NEW],
    ["image saved"],
  ]);
}

{
  // Та сама правка, поставлена в чергу вдруге, фото вдруге не вантажить.
  const { calls, backend } = fakeBackend({ stored: NEW });
  const { events, options } = recorder();
  await sync.sendRecipe("u1", { ...full, id: "p1", image: DATA_A }, options({ imageChanged: true }), backend);
  check("повтор: без другого вивантаження, запису і прибирання", calls, [["row"], ["read"]]);
  check("повтор: локальний data:URL усе одно міняється на посилання", events, [
    ["saved"],
    ["uploaded", DATA_A, NEW],
    ["image saved"],
  ]);
}

{
  // Рецепт з уже вивантаженим фото — саме те, що раніше не писалось зовсім.
  const { calls, backend } = fakeBackend();
  const { events, options } = recorder();
  await sync.sendRecipe("u1", { ...full, id: "p2", title: "Нова назва", image: OLD }, options(), backend);
  check("правка без зміни фото: лише рядок, колонку фото не чіпаємо", calls, [["row"]]);
  check("правка без зміни фото: збережена", events, [["saved"]]);
}

{
  /*
   * Ноутбук зі старою копією: фото змінили з телефона, старий файл прибрано,
   * а тут у рецепті досі мертве посилання. Правка кроку не мусить повернути
   * його в базу — раніше upsert писав image_url завжди.
   */
  const { calls, backend } = fakeBackend({ stored: NEW });
  await sync.sendRecipe("u1", { ...full, id: "p2b", image: OLD }, {}, backend);
  check("застаріла копія: мертве посилання в базу не їде", calls, [["row"]]);
}

{
  // Тимчасовий збій сховища: текст збережено, старе фото на місці, позначка фото лишається.
  const { calls, backend } = fakeBackend({ uploadError: new Error("Load failed") });
  const { events, options } = recorder();
  notices.length = 0;
  await quiet(() =>
    sync.sendRecipe("u1", { ...full, id: "p3", image: DATA_B }, options({ imageChanged: true }), backend),
  );
  check("фото впало: рядок без фото, старе не переписане і не прибране", calls, [
    ["row"],
    ["read"],
    ["upload", DATA_B],
  ]);
  check("фото впало тимчасово: текст збережено, фото — ні і не відхилене", events, [["saved"]]);
  check("фото впало: людина про це дізнається", notices, [
    "Фото поки не завантажилось — рецепт збережено, фото дошлемо згодом",
  ]);

  // Повтор того самого фото (перечитування бази) не повторює тост.
  await quiet(() =>
    sync.sendRecipe("u1", { ...full, id: "p3", image: DATA_B }, options({ imageChanged: true }), backend),
  );
  check("фото впало вдруге: тост не повторюється", notices.length, 1);
}

{
  // Остаточна відмова сховища: позначку фото знімаємо, показуємо те, що в базі.
  const tooBig = { name: "StorageApiError", status: 400, statusCode: "413", message: "too large" };
  const { calls, backend } = fakeBackend({ uploadError: tooBig });
  const { events, options } = recorder();
  notices.length = 0;
  await quiet(() =>
    sync.sendRecipe("u1", { ...full, id: "p3b", image: DATA_B }, options({ imageChanged: true }), backend),
  );
  check("фото відхилене: без запису фото", calls, [["row"], ["read"], ["upload", DATA_B]]);
  check("фото відхилене: відповідь несе фото, що лишилось у базі", events, [
    ["saved"],
    ["image rejected", OLD],
  ]);
  check("фото відхилене: людина знає, що лишилось старе", notices, [
    "Нове фото не завантажилось — рецепт збережено зі старим",
  ]);
}

{
  /*
   * Фото, яке зараз у базі, невідоме (офлайн-правка, кешу стрічки немає).
   * Раніше рядок писався з image_url = null і стирав фото в базі.
   */
  const { calls, backend } = fakeBackend({ readFails: true, uploadError: new Error("Load failed") });
  await quiet(() =>
    sync.sendRecipe("u1", { ...full, id: "p3c", image: DATA_B }, { imageChanged: true }, backend),
  );
  check("невідоме старе фото + збій: фото в базі не стерте", calls, [["row"], ["read"], ["upload", DATA_B]]);
}

{
  // Фото прибрали — у базі null, файл зі сховища прибрано.
  const { calls, backend } = fakeBackend();
  await sync.sendRecipe("u1", { ...full, id: "p4", image: null }, { imageChanged: true }, backend);
  check("фото прибрали: null і прибирання", calls, [["row"], ["read"], ["image", null], ["cleanup", OLD]]);
}

{
  // Новий рецепт з фото: поки знімок летить, рядок без фото, а не з data:URL.
  const { calls, backend } = fakeBackend({ stored: null });
  await sync.sendRecipe("u1", { ...full, id: "p5", image: DATA_A }, { imageChanged: true }, backend);
  check("новий з фото: base64 у рядок не потрапляє", calls, [
    ["row"],
    ["read"],
    ["upload", DATA_A],
    ["image", NEW],
  ]);
}

{
  // Рядок не записався — далі нічого не робимо: ні фото, ні «збережено».
  const { calls, backend } = fakeBackend();
  let saved = false;
  const error = await sync
    .sendRecipe("u1", { ...full, id: "p6", image: DATA_A }, { imageChanged: true, onSaved: () => (saved = true) }, {
      ...backend,
      upsertRecipe: async () => {
        calls.push(["row"]);
        throw { message: "TypeError: Load failed", code: "" };
      },
    })
    .then(() => null, (e) => e);
  check("збій рядка: помилка летить нагору (у тост)", error?.message, "TypeError: Load failed");
  check("збій рядка: без фото і без «збережено»", [calls, saved], [[["row"]], false]);
}

{
  // Видалення: рядок, потім файл фото, яке було саме в цьому рядку.
  const { calls, backend } = fakeBackend({ stored: NEW });
  let deleted = false;
  await sync.sendRecipeDelete("u1", "d1", { onDeleted: () => (deleted = true) }, backend);
  check("видалення: рядок, потім фото з рядка", calls, [["delete"], ["cleanup", NEW]]);
  check("видалення: підтверджене", deleted, true);
}

console.log("── Остаточна відмова чи тимчасовий збій ──");

check("RLS — остаточно", sync.isPermanentRejection({ code: "42501" }), true);
check("порушене обмеження — остаточно", sync.isPermanentRejection({ code: "23514" }), true);
check("невідома колонка — остаточно", sync.isPermanentRejection({ code: "42703" }), true);
check("мережа — тимчасово", sync.isPermanentRejection({ message: "Load failed", code: "" }), false);
check("прострочений токен — тимчасово", sync.isPermanentRejection({ code: "PGRST301" }), false);
check("не обʼєкт — тимчасово", sync.isPermanentRejection(new Error("x")), false);
check("сховище: заборонено — остаточно", sync.isPermanentRejection({ status: 403, statusCode: "403" }), true);
check("сховище: завеликий файл — остаточно", sync.isPermanentRejection({ status: 413, code: "EntityTooLarge" }), true);
check("сховище: прострочений токен — тимчасово", sync.isPermanentRejection({ status: 403, code: "InvalidJWT" }), false);
check("сховище: 500 — тимчасово", sync.isPermanentRejection({ status: 500, statusCode: "500" }), false);

console.log("── Злиття з базою ──");

const { mergeRecipes } = sync;
const nobody = () => false;
const rec = (id, title, extra = {}) => ({ ...full, id, title, ...extra });
const ids = (list) => list.map((r) => `${r.id}:${r.title}`);
const marks = (rows = {}, images = {}, deletes = {}) => ({ rows, images, deletes });
const noMarks = marks();

{
  const m = mergeRecipes([rec("a", "локальна")], [rec("a", "з бази", { updatedAt: "2026-09-13T13:00:00Z" })], noMarks, nobody);
  check("без позначки база перемагає", ids(m.recipes), ["a:з бази"]);
  check("без позначки нічого не дописуємо", m.resend.length, 0);
}

{
  // Правку зробили о 13:05, а в базі рядок від 13:00 — запит не дійшов.
  const m = mergeRecipes(
    [rec("a", "локальна")],
    [rec("a", "з бази", { updatedAt: "2026-09-13T13:00:00.123456+00:00" })],
    marks({ a: "2026-09-13T13:05:00.000Z" }),
    nobody,
  );
  check("недоставлена правка лишається", ids(m.recipes), ["a:локальна"]);
  check("недоставлена правка їде ще раз", ids(m.resend), ["a:локальна"]);
  check("позначка лишається до відповіді", m.marks.rows, { a: "2026-09-13T13:05:00.000Z" });
}

{
  // Запит дійшов (updated_at пізніше правки), лише відповідь загубилась.
  const m = mergeRecipes(
    [rec("a", "локальна")],
    [rec("a", "з бази", { updatedAt: "2026-09-13T13:05:00.412345+00:00" })],
    marks({ a: "2026-09-13T13:05:00.000Z" }),
    nobody,
  );
  check("доставлена правка — база перемагає", ids(m.recipes), ["a:з бази"]);
  check("доставлена правка — позначку знято", m.marks.rows, {});
  check("доставлена правка — без повтору", m.resend.length, 0);
}

{
  /*
   * Рядок долетів (updated_at 13:05:00.300), а фото — ні: застосунок змахнули
   * посеред вивантаження. Раніше база перемагала, і нове фото мовчки мінялось
   * на старе, а позначка зникала.
   */
  const m = mergeRecipes(
    [rec("a", "локальна", { image: DATA_B })],
    [rec("a", "з бази", { image: OLD, updatedAt: "2026-09-13T13:05:00.300+00:00" })],
    marks({ a: "2026-09-13T13:05:00.000Z" }, { a: "2026-09-13T13:05:00.000Z" }),
    nobody,
  );
  check("рядок є, фото ні: текст з бази, фото локальне", m.recipes.map((r) => [r.title, r.image]), [["з бази", DATA_B]]);
  check("рядок є, фото ні: позначка фото лишається, рядка — знята", m.marks, {
    rows: {},
    images: { a: "2026-09-13T13:05:00.000Z" },
    deletes: {},
  });
  check("рядок є, фото ні: фото їде ще раз", m.resend.map((r) => r.image), [DATA_B]);
}

{
  // Нове фото вже вивантажене, посилання записати не встигли.
  const m = mergeRecipes(
    [rec("a", "локальна", { image: NEW })],
    [rec("a", "з бази", { image: OLD, updatedAt: "2026-09-13T13:05:00.300Z" })],
    marks({}, { a: "2026-09-13T13:05:00.000Z" }),
    nobody,
  );
  check("вивантажене, не записане: посилання їде ще раз", m.resend.map((r) => r.image), [NEW]);
}

{
  // Фото в базі вже те саме — позначка фото відслужила.
  const m = mergeRecipes(
    [rec("a", "локальна", { image: NEW })],
    [rec("a", "з бази", { image: NEW, updatedAt: "2026-09-13T13:05:00.300Z" })],
    marks({}, { a: "2026-09-13T13:05:00.000Z" }),
    nobody,
  );
  check("фото вже в базі: позначку знято, без повтору", [m.marks.images, m.resend.length], [{}, 0]);
}

{
  const m = mergeRecipes(
    [rec("a", "локальна")],
    [rec("a", "з бази", { updatedAt: "2026-09-13 13:00:00.5+00" })],
    marks({ a: "2026-09-13T13:05:00.000Z" }),
    nobody,
  );
  check("час з пробілом замість T теж читається", ids(m.recipes), ["a:локальна"]);
}

{
  const m = mergeRecipes([rec("a", "локальна")], [rec("a", "щойно перенесена")], marks({ a: "2026-09-13T13:05:00Z" }), nobody);
  check("копія без updated_at (перенесення) — перемагає", ids(m.recipes), ["a:щойно перенесена"]);
  check("копія без updated_at — позначку знято", m.marks.rows, {});
}

{
  const m = mergeRecipes(
    [rec("new", "новий"), rec("old", "старий локальний")],
    [rec("old", "старий", { updatedAt: "2026-09-12T10:00:00Z" })],
    marks({ new: "2026-09-13T13:05:00Z" }),
    nobody,
  );
  check("новий, що не долетів, — нагорі й лишається", ids(m.recipes), ["new:новий", "old:старий"]);
  check("новий, що не долетів, — їде ще раз", ids(m.resend), ["new:новий"]);
}

{
  const m = mergeRecipes([rec("gone", "видалений деінде")], [], noMarks, nobody);
  check("без позначки й без запису рецепт, якого немає в базі, зникає", m.recipes, []);
}

{
  const flying = (id) => id === "a" || id === "b";
  const m = mergeRecipes(
    [rec("a", "локальна")],
    [
      rec("a", "стара з бази", { updatedAt: "2026-09-13T14:00:00Z" }),
      rec("b", "видаляється", { updatedAt: "2026-09-13T14:00:00Z" }),
    ],
    marks({ a: "2026-09-13T13:05:00Z" }),
    flying,
  );
  check("запис у дорозі: локальна версія, навіть якщо база «новіша»", ids(m.recipes), ["a:локальна"]);
  check("запис у дорозі: другий раз не шлемо", m.resend.length, 0);
  check("запис у дорозі: позначка лишається", m.marks.rows, { a: "2026-09-13T13:05:00Z" });
}

{
  const m = mergeRecipes([], [rec("a", "з бази", { updatedAt: "2026-09-13T13:00:00Z" })], marks({ ghost: "2026-09-13T13:05:00Z" }), nobody);
  check("позначка без рецепта — зникає", m.marks.rows, {});
}

{
  const m = mergeRecipes(
    [rec("a", "локальна")],
    [rec("a", "з бази", { updatedAt: "not a date" })],
    marks({ a: "2026-09-13T13:05:00Z" }),
    nobody,
  );
  check("зіпсований час у базі — база перемагає", ids(m.recipes), ["a:з бази"]);
}

{
  // Видалили без мережі: база досі має рядок.
  const m = mergeRecipes(
    [],
    [rec("x", "видалений офлайн", { updatedAt: "2026-09-13T13:00:00Z" })],
    marks({}, {}, { x: "2026-09-13T13:05:00Z" }),
    nobody,
  );
  check("недоставлене видалення: рецепт не повертається", m.recipes, []);
  check("недоставлене видалення: їде ще раз", m.redelete, ["x"]);
  check("недоставлене видалення: позначка лишається", m.marks.deletes, { x: "2026-09-13T13:05:00Z" });
}

{
  const m = mergeRecipes([], [], marks({}, {}, { x: "2026-09-13T13:05:00Z" }), nobody);
  check("видалення дійшло (рядка немає) — позначку знято", [m.marks.deletes, m.redelete], [{}, []]);
}

{
  const m = mergeRecipes([], [rec("x", "ще в базі")], marks({}, {}, { x: "2026-09-13T13:05:00Z" }), (id) => id === "x");
  check("видалення в дорозі: не показуємо, не шлемо вдруге, позначку тримаємо", [m.recipes, m.redelete, m.marks.deletes], [
    [],
    [],
    { x: "2026-09-13T13:05:00Z" },
  ]);
}

console.log("── Сховище стану: правка → перезапуск ──");

{
  /*
   * Без бекенду pushRecipe у Node нічого не шле, тож дивимось на те, що
   * лишається після дії: позначки і те, як їх сприймає наступне читання бази.
   * localStorage тут немає — persist про це попереджає, звіт не засмічуємо.
   */
  const warn = console.warn;
  console.warn = () => {};
  const { useApp, recipeById } = await jiti.import(path.join(root, "src/lib/store.ts"));

  const remoteState = {
    profile: null, likes: [], saves: [], wishlist: [], dismissed: [], ratings: {},
    cooked: [], following: [], pantry: [], shopping: [], plan: {},
  };
  const clean = { unsyncedRecipes: {}, unsyncedImages: {}, pendingRecipeDeletes: {} };
  const stale = rec("s1", "стара назва", { image: OLD, course: undefined, updatedAt: "2020-01-01T00:00:00Z" });

  useApp.setState({ myRecipes: [stale], remoteRecipes: [], ...clean });
  // Форма завжди передає фото разом з рештою — у рецепта з фото це посилання.
  useApp.getState().updateRecipe("s1", { title: "нова назва", course: "side", image: OLD });
  check("правка рецепта з фото-посиланням позначена до відправки", Object.keys(useApp.getState().unsyncedRecipes), ["s1"]);
  check("те саме фото — позначки фото немає (колонку не чіпаємо)", useApp.getState().unsyncedImages, {});

  // Перезапуск: база ще віддає стару версію, бо запит не дійшов.
  useApp.getState().applyRemoteUserState(remoteState, [stale]);
  const after = recipeById(useApp.getState(), "s1");
  check("після перечитування правка на місці", [after.title, after.course], ["нова назва", "side"]);
  check("після перечитування позначка на місці", Object.keys(useApp.getState().unsyncedRecipes), ["s1"]);

  // А коли база вже має новішу версію — вона й перемагає.
  useApp.getState().applyRemoteUserState(remoteState, [
    { ...stale, title: "нова назва", course: "side", updatedAt: "2999-01-01T00:00:00Z" },
  ]);
  check("доставлену правку база підтверджує, позначка знята", useApp.getState().unsyncedRecipes, {});

  const first = (() => {
    useApp.getState().updateRecipe("s1", { title: "раз" });
    return useApp.getState().unsyncedRecipes.s1;
  })();
  useApp.getState().updateRecipe("s1", { title: "два" });
  check("дві правки поспіль — різні позначки", useApp.getState().unsyncedRecipes.s1 > first, true);

  // Нове фото: позначка фото ставиться і переживає перечитування, де рядок уже є.
  useApp.setState({ myRecipes: [stale], remoteRecipes: [], ...clean });
  useApp.getState().updateRecipe("s1", { title: "з новим фото", image: DATA_B });
  const photoMark = useApp.getState().unsyncedImages.s1;
  check("нове фото позначене окремо", typeof photoMark, "string");
  useApp.getState().applyRemoteUserState(remoteState, [
    { ...stale, title: "з новим фото", updatedAt: "2999-01-01T00:00:00Z" },
  ]);
  const withPhoto = recipeById(useApp.getState(), "s1");
  check("рядок долетів, фото ні: після перечитування фото нове", [withPhoto.title, withPhoto.image], ["з новим фото", DATA_B]);
  check("рядок долетів, фото ні: позначка фото на місці", useApp.getState().unsyncedImages, { s1: photoMark });
  // Наступна правка тексту позначку фото не збиває — фото й далі чекає своєї черги.
  useApp.getState().updateRecipe("s1", { title: "ще правка", image: DATA_B });
  check("правка тексту не збиває позначку фото", useApp.getState().unsyncedImages, { s1: photoMark });

  // Прибрали фото — теж зміна фото.
  useApp.setState({ myRecipes: [stale], remoteRecipes: [], ...clean });
  useApp.getState().updateRecipe("s1", { image: null });
  check("прибране фото теж позначене", Object.keys(useApp.getState().unsyncedImages), ["s1"]);

  // Власний рецепт лише в кеші стрічки: правка більше не губиться мовчки.
  useApp.setState({
    myRecipes: [],
    remoteRecipes: [rec("c1", "у стрічці", { mine: true })],
    ...clean,
  });
  useApp.getState().updateRecipe("c1", { title: "виправлено" });
  check("власний рецепт із кешу стрічки теж правиться", ids(useApp.getState().myRecipes), ["c1:виправлено"]);

  useApp.setState({ myRecipes: [], remoteRecipes: [rec("f1", "чужий", { mine: false, authorId: "u9" })] });
  useApp.getState().updateRecipe("f1", { title: "злам" });
  check("чужий рецепт із кешу стрічки не правиться", useApp.getState().myRecipes, []);

  useApp.setState({ myRecipes: [], remoteRecipes: [], ...clean });
  useApp.getState().addRecipe(rec("n1", "новий", { image: DATA_A }));
  check("новий рецепт позначений", Object.keys(useApp.getState().unsyncedRecipes), ["n1"]);
  check("новий рецепт з фото — фото позначене окремо", Object.keys(useApp.getState().unsyncedImages), ["n1"]);
  useApp.getState().applyRemoteUserState(remoteState, []);
  check("новий, що не долетів, переживає перечитування", ids(useApp.getState().myRecipes), ["n1:новий"]);

  // Видалення без мережі: рядок у базі лишився.
  useApp.getState().deleteRecipe("n1");
  check("видалення знімає позначки правки", [useApp.getState().unsyncedRecipes, useApp.getState().unsyncedImages], [{}, {}]);
  check("видалення ставить свою позначку", Object.keys(useApp.getState().pendingRecipeDeletes), ["n1"]);
  const stillInDb = rec("n1", "новий", { updatedAt: "2026-09-13T13:00:00Z" });
  useApp.getState().applyRemoteUserState(remoteState, [stillInDb]);
  check("видалений без мережі не воскресає в галереї", useApp.getState().myRecipes, []);
  check("позначка видалення тримається, поки рядок у базі", Object.keys(useApp.getState().pendingRecipeDeletes), ["n1"]);
  useApp.getState().setCommunity({ recipes: [stillInDb, rec("z1", "чужий")], profiles: [] });
  check("видалений без мережі не воскресає у стрічці", ids(useApp.getState().remoteRecipes), ["z1:чужий"]);
  useApp.getState().applyRemoteUserState(remoteState, []);
  check("рядка вже немає — позначку видалення знято", useApp.getState().pendingRecipeDeletes, {});

  console.warn = warn;
}

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} пройшло, ${fail} ні`);
process.exit(fail === 0 ? 0 : 1);
