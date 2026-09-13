#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка списання з комори з урахуванням різновидів типів.
 *
 * Запуск: npm run check:pantry
 *
 * Потреба рецепта закривається і самим типом, і його різновидом: у млинці
 * пішло безлактозне молоко — з комори зникає саме воно. Тут перевіряємо
 * порядок, у якому беруться рядки, і те, чого списання не чіпає. Прості
 * випадки (сік мінус 200 мл, порції, «за смаком») — у check:nutrition.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { consumeForRecipe, consumptionOrder, availableFor } = await jiti.import("@/lib/pantry");
const { formatSummed } = await jiti.import("@/lib/units");
const { dateKey } = await jiti.import("@/lib/utils");

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

const dish = (ingredients) => ({
  id: "t",
  authorId: "a",
  title: "Тест",
  description: "",
  emoji: "🍽️",
  gradient: ["#000", "#111"],
  cuisine: "Домашня",
  mealTypes: [],
  moods: [],
  tags: [],
  timeMin: 30,
  difficulty: 1,
  servings: 2,
  costLevel: 1,
  ingredients,
  steps: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  stats: { likes: 0, saves: 0, cooks: 0, ratingSum: 0, ratingCount: 0 },
});

// Строки — відносно сьогодні: списання дивиться на місцеву дату.
const day = (offset) => dateKey(new Date(Date.now() + offset * 86_400_000));
const row = (key, amount, unit, extra = {}) => ({ key, amount, unit, addedAt: "2026-09-01T10:00:00.000Z", ...extra });
const amounts = (pantry) => Object.fromEntries(pantry.map((p) => [p.key, p.amount ?? null]));

console.log("── Точний тип раніше за різновид ──");
{
  const { pantry, consumed } = consumeForRecipe(
    [row("moloko_bezlaktozne", 1, "l"), row("moloko", 1, "l")],
    dish([{ key: "moloko", amount: 500, unit: "ml" }]),
  );
  check("звичайне молоко пішло першим", amounts(pantry), { moloko_bezlaktozne: 1, moloko: 0.5 });
  check("списано одне", consumed.map((c) => `${c.key} −${c.used}`), ["moloko −0,5 л"]);
}
{
  // Звичайного бракує — добираємо різновидом.
  const { pantry, consumed } = consumeForRecipe(
    [row("moloko", 200, "ml"), row("moloko_bezlaktozne", 1, "l")],
    dish([{ key: "moloko", amount: 500, unit: "ml" }]),
  );
  check("звичайне скінчилось, решта з безлактозного", amounts(pantry), { moloko_bezlaktozne: 0.7 });
  check("два рядки в підсумку", consumed.map((c) => [c.key, c.used, c.left]), [
    ["moloko", "200 мл", null],
    ["moloko_bezlaktozne", "0,3 л", "0,7 л"],
  ]);
}
{
  // Навпаки не буває: безлактозному рецепту звичайне молоко не підходить.
  const { pantry, consumed } = consumeForRecipe(
    [row("moloko", 1, "l")],
    dish([{ key: "moloko_bezlaktozne", amount: 500, unit: "ml" }]),
  );
  check("звичайне молоко не списується за безлактозне", [amounts(pantry), consumed.length], [{ moloko: 1 }, 0]);
}

console.log("── Конкретніші потреби беруть першими ──");
{
  // У складі спершу «Молоко», далі «Молоко безлактозне». Якби «Молоко» брало
  // першим, воно забрало б безлактозне, якого рецепт просить окремо.
  const { consumed } = consumeForRecipe(
    [row("moloko", 300, "ml"), row("moloko_bezlaktozne", 500, "ml")],
    dish([
      { key: "moloko", amount: 500, unit: "ml" },
      { key: "moloko_bezlaktozne", amount: 500, unit: "ml" },
    ]),
  );
  check("безлактозне пішло на безлактозну потребу", consumed.map((c) => [c.key, c.used]), [
    ["moloko_bezlaktozne", "500 мл"],
    ["moloko", "300 мл"],
  ]);
}

console.log("── Строки ──");
{
  // Обидва — різновиди грибів, тож рівні за типом: першим те, що псується раніше.
  const { pantry } = consumeForRecipe(
    [row("pecherytsi", 500, "g", { expiresAt: day(7) }), row("hlyva", 200, "g", { expiresAt: day(1) })],
    dish([{ key: "gryby", amount: 300, unit: "g" }]),
  );
  check("спершу найближчий строк", amounts(pantry), { pecherytsi: 400 });
}
{
  const { pantry } = consumeForRecipe(
    [row("pecherytsi", 500, "g"), row("hlyva", 200, "g", { expiresAt: day(5) })],
    dish([{ key: "gryby", amount: 100, unit: "g" }]),
  );
  check("датоване раніше за недатоване", amounts(pantry), { pecherytsi: 500, hlyva: 100 });
}
{
  const { pantry } = consumeForRecipe(
    [row("hlyva", 200, "g", { expiresAt: day(-2) }), row("pecherytsi", 500, "g")],
    dish([{ key: "gryby", amount: 100, unit: "g" }]),
  );
  check("прострочене — останнім", amounts(pantry), { hlyva: 200, pecherytsi: 400 });
}
{
  const order = consumptionOrder("gryby", [
    row("hlyva", 200, "g", { expiresAt: day(-2) }),
    row("bilyi_hryb", 100, "g", { addedAt: "2026-09-05T10:00:00.000Z" }),
    row("pecherytsi", 500, "g", { addedAt: "2026-09-02T10:00:00.000Z" }),
    row("gryby", 50, "g", { expiresAt: day(9) }),
    row("moloko", 1, "l"),
  ]).map((p) => p.key);
  check("черга: точний тип, датоване, недатоване за часом, прострочене; чуже — ні", order, [
    "gryby",
    "pecherytsi",
    "bilyi_hryb",
    "hlyva",
  ]);
}

console.log("── Чого списання не чіпає ──");
{
  const pantry = [row("moloko", 1, "l"), { key: "yajtsya", addedAt: "2026-09-01T10:00:00.000Z" }, row("smetana", 200, "g")];
  const { pantry: left, consumed } = consumeForRecipe(
    pantry,
    dish([
      { key: "yajtsya", amount: 2, unit: "pcs" },
      { key: "smetana", amount: 50, unit: "g", optional: true },
      { key: "moloko", unit: "taste" },
    ]),
  );
  check("без кількості, «за бажанням», «за смаком» — нічого", consumed.length, 0);
  check("і комора та сама", left === pantry, true);
}
{
  const { pantry, consumed } = consumeForRecipe(
    [row("kefir", 1, "l"), row("yajtsya", 2, "pcs"), row("sil", 500, "g")],
    dish([{ key: "yajtsya", amount: 2, unit: "pcs" }]),
  );
  check("до нуля — рядок зникає, порядок решти той самий", pantry.map((p) => p.key), ["kefir", "sil"]);
  check("позначено як закінчене", consumed[0].left, null);
}

console.log("── Скільки є для потреби ──");
check(
  "молоко: і звичайне, і безлактозне",
  formatSummed(availableFor("moloko", [row("moloko", 1, "l"), row("moloko_bezlaktozne", 900, "ml"), row("kefir", 1, "l")])),
  "1,9 л",
);
check("безлактозне: лише воно", formatSummed(availableFor("moloko_bezlaktozne", [row("moloko", 1, "l")])), "");

/* ═══ Комора по id: стор, синхронізація, кеш карток (I4, D3–D5) ═══════════ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const P = await jiti.import("@/lib/pantry");
const sync = await jiti.import("@/lib/sync");
const { normalizePersisted } = await jiti.import("@/lib/store-migrations");
// Сховище в памʼяті замість localStorage: persist тоді живий (merge, версія) і не сипле попереджень.
globalThis.localStorage ??= (() => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
})();
const { useApp, mergePantry, pruneProductCache } = await jiti.import("@/lib/store");

const AT = "2026-09-13T09:00:00.000Z";
const card = (id, typeKey, name, extra = {}) => ({ id, typeKey, name, source: "user", archived: false, version: 1, updatedAt: AT, ...extra });
const GAL = card("11111111-1111-4111-8111-111111111111", "moloko", "Галичина 2,5%", { packAmount: 900, packUnit: "ml" });
const GAL_BEZ = card("22222222-2222-4222-8222-222222222222", "moloko_bezlaktozne", "Молоко безлактозне Галичина 2,5%", { packAmount: 900, packUnit: "ml" });
const idRow = (id, extra = {}) => ({ id, key: "moloko", addedAt: AT, ...extra });
const remoteState = (pantry, extra = {}) => ({
  profile: null, likes: [], saves: [], wishlist: [], dismissed: [], ratings: {},
  cooked: [], following: [], pantry, shopping: [], plan: {}, ...extra,
});
const reset = (patch = {}) =>
  useApp.setState({ pantry: [], products: {}, eanIndex: {}, pantryLegacyRemoved: [], customIngredients: [], ...patch });

console.log("── Назва рядка ──");
check("картка → назва картки", P.pantryDisplayName(idRow("a", { productId: GAL.id }), { [GAL.id]: GAL }), "Галичина 2,5%");
check("вільна назва", P.pantryDisplayName(idRow("a", { label: "Молоко з ферми" })), "Молоко з ферми");
check(
  "касовий рядок → людська назва, не сирий текст",
  P.pantryDisplayName(idRow("a", { receiptName: "Мол950УлГаличБЛак2.5" })),
  "Молоко безлактозне Галичина 2,5%",
);
check("нічого — назва типу", P.pantryDisplayName(idRow("a")), "Молоко");

console.log("── Списання за id: рядки одного типу окремо ──");
{
  const pantry = [
    idRow("r-late", { amount: 1, unit: "l", expiresAt: day(9) }),
    idRow("r-soon", { amount: 900, unit: "ml", expiresAt: day(2) }),
  ];
  const { pantry: left, consumed } = P.consumeForRecipe(pantry, dish([{ key: "moloko", amount: 500, unit: "ml" }]));
  check("пішла пачка з ближчим строком", left.map((p) => [p.id, p.amount]), [["r-late", 1], ["r-soon", 400]]);
  check("у підсумку — id рядка", consumed.map((c) => c.id), ["r-soon"]);
  check(
    "«Повернути в комору» за id",
    P.restorePantryById(left, pantry.filter((p) => consumed.some((c) => c.id === p.id))).map((p) => [p.id, p.amount]),
    [["r-late", 1], ["r-soon", 900]],
  );
}

console.log("── Стор: addPantry / updatePantry / removePantry ──");
{
  reset({ products: { [GAL.id]: GAL, [GAL_BEZ.id]: GAL_BEZ } });
  const s = useApp.getState();
  const first = s.addPantry({ key: "moloko", productId: GAL.id, amount: 900, unit: "ml", addedAt: new Date().toISOString() });
  check("без id — новий uuid, before null", [UUID.test(first.rowId), first.before], [true, null]);
  const second = useApp.getState().addPantry({ key: "moloko", productId: GAL.id, amount: 900, unit: "ml", addedAt: new Date().toISOString() });
  check("той самий товар сьогодні — складається в «Тепер разом»", [second.rowId === first.rowId, second.before?.amount, useApp.getState().pantry[0].amount, useApp.getState().pantry[0].unit], [true, 900, 1.8, "l"]);

  const edited = useApp.getState().addPantry({ ...useApp.getState().pantry[0], expiresAt: "2026-09-30" });
  check("той самий id — заміна на місці, без другого рядка", [useApp.getState().pantry.length, edited.before?.expiresAt], [1, undefined]);

  useApp.getState().updatePantry(first.rowId, { productId: GAL_BEZ.id });
  check("productId одразу переписує тип", useApp.getState().pantry[0].key, "moloko_bezlaktozne");
  useApp.getState().updatePantry(first.rowId, { expiresAt: undefined });
  check("undefined у латці стирає поле", "expiresAt" in useApp.getState().pantry[0], false);
  useApp.getState().updatePantry("немає-такого", { amount: 1 });
  check("чужий id — нічого", useApp.getState().pantry.length, 1);

  useApp.getState().removePantry(first.rowId);
  check("прибрано за id", [useApp.getState().pantry.length, useApp.getState().pantryLegacyRemoved], [0, []]);

  const salt = useApp.getState().addPantry({ key: "sil", addedAt: AT });
  const again = useApp.getState().addPantry({ key: "sil", addedAt: new Date().toISOString() });
  check("голий базовий удруге — той самий рядок", [again.rowId, useApp.getState().pantry.length], [salt.rowId, 1]);
}
{
  reset({
    pantry: [
      idRow("legacy:moloko", { amount: 1, unit: "l" }),
      idRow("33333333-3333-4333-8333-333333333333", { key: "oliya" }),
      idRow("44444444-4444-4444-8444-444444444444", { key: "oliya", productId: GAL.id }),
      idRow("55555555-5555-4555-8555-555555555555", { key: "olyvkova" }),
    ],
  });
  useApp.getState().updatePantry("legacy:moloko", { amount: 2 });
  check("правка тимчасового рядка → legacyDirty", useApp.getState().pantry[0].legacyDirty, true);
  useApp.getState().removePantryType("oliya");
  check("removePantryType — лише рівно цей тип", useApp.getState().pantry.map((p) => p.key), ["moloko", "olyvkova"]);
  useApp.getState().removePantry("legacy:moloko");
  check("прибраний тимчасовий рядок чекає знімка", useApp.getState().pantryLegacyRemoved, [{ key: "moloko", addedAt: AT }]);
  useApp.getState().clearPantry();
  check("очищення прибирає й відкладені видалення", [useApp.getState().pantry, useApp.getState().pantryLegacyRemoved], [[], []]);
}

console.log("── Стор: списання й повернення ──");
{
  const soon = idRow("66666666-6666-4666-8666-666666666666", { amount: 200, unit: "ml", expiresAt: day(1) });
  const late = idRow("77777777-7777-4777-8777-777777777777", { amount: 1, unit: "l", expiresAt: day(8) });
  const legacy = idRow("legacy:vershky", { key: "vershky", amount: 100, unit: "ml" });
  reset({ pantry: [soon, late, legacy] });
  const before = useApp.getState().pantry;
  const consumed = useApp.getState().consumePantry(dish([
    { key: "moloko", amount: 500, unit: "ml" },
    { key: "vershky", amount: 100, unit: "ml" },
  ]));
  check("спорожніла пачка зникла, друга зменшилась", useApp.getState().pantry.map((p) => [p.id, p.amount]), [[late.id, 0.7]]);
  check("спорожнілий тимчасовий рядок — у відкладених видаленнях", useApp.getState().pantryLegacyRemoved, [{ key: "vershky", addedAt: AT }]);
  useApp.getState().restorePantry(before.filter((p) => consumed.some((c) => c.id === p.id)));
  check("«Повернути в комору» — усе на місці", useApp.getState().pantry.map((p) => [p.id, p.amount]).sort(), before.map((p) => [p.id, p.amount]).sort());
  check("повернутий тимчасовий рядок більше не «прибраний»", useApp.getState().pantryLegacyRemoved, []);
}

console.log("── Знімок бази: перепривʼязка тимчасових id і кеш карток ──");
{
  const srvEarly = { id: "88888888-8888-4888-8888-888888888888", key: "moloko", addedAt: "2026-09-01T08:00:00+00:00", amount: 1, unit: "l", ownerId: "A" };
  const srvSame = { id: "99999999-9999-4999-8999-999999999999", key: "moloko", addedAt: "2026-09-05T08:00:00+00:00", amount: 1, unit: "l", ownerId: "B", productId: GAL.id, barcode: "4820000000017" };
  const srvButter = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", key: "maslo", addedAt: "2026-09-02T08:00:00+00:00", amount: 200, unit: "g" };
  const legacy = normalizePersisted(
    { pantry: [{ key: "moloko", addedAt: "2026-09-05T08:00:00.000Z", amount: 500, unit: "ml" }, { key: "maslo", addedAt: AT }] },
    true,
  ).pantry;
  check("стара комора на збірці з бекендом — legacy-id", legacy.map((p) => p.id), ["legacy:moloko", "legacy:maslo"]);
  reset({ pantry: [{ ...legacy[0], legacyDirty: true }, legacy[1]], pantryLegacyRemoved: [{ key: "moloko", addedAt: "2026-09-01T08:00:00.000Z" }] });
  useApp.getState().applyRemoteUserState(remoteState([srvEarly, srvSame, srvButter], { products: [GAL], productsComplete: true }), []);
  const st = useApp.getState();
  check(
    "змінений офлайн рядок ліг на серверний (той самий addedAt), прибраний — зник",
    st.pantry.map((p) => [p.id, p.amount, p.ownerId ?? null]),
    [[srvSame.id, 500, "B"], [srvButter.id, 200, null]],
  );
  check("жодного legacy-id після знімка", st.pantry.some((p) => p.id.startsWith("legacy:")), false);
  check("відкладені видалення виконано", st.pantryLegacyRemoved, []);
  check("картка з знімка в кеші", Object.keys(st.products), [GAL.id]);
  check("штрихкод рядка з карткою — у eanIndex", st.eanIndex, { "4820000000017": GAL.id });

  // Другий знімок без змін: нічого не перепривʼязується і не видаляється.
  const again = mergePantry(st.pantry, [srvSame, srvButter], [], () => false);
  check("чиста комора — без перепривʼязки", [again.rebased, again.upserts, again.removeIds], [false, [], []]);
  // Рядок, чий запис ще в дорозі, лишається локальним.
  const typing = { ...srvButter, amount: 150 };
  const kept = mergePantry([typing], [srvButter], [], (id) => id === srvButter.id);
  check("незбережена правка переживає знімок", kept.pantry.map((p) => p.amount), [150]);
}
{
  const products = {};
  for (let i = 0; i < 160; i++) products[`p${i}`] = card(`p${i}`, "moloko", `Товар ${i}`);
  products.p0 = card("p0", "moloko", "Переможений", { mergedInto: "p1" });
  const pruned = pruneProductCache(products, { "4820000000017": "p0", "4823096413518": "p5" }, [idRow("r", { productId: "p0" })]);
  check("підрізання: картки комори + переможець + 150 останніх", [Object.keys(pruned.products).length, "p0" in pruned.products, "p1" in pruned.products, "p5" in pruned.products], [152, true, true, false]);
  check("eanIndex — лише на картки, що лишились", pruned.eanIndex, { "4820000000017": "p0" });
}
{
  reset({ pantry: [idRow("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { productId: GAL.id })] });
  useApp.getState().upsertProducts([{ ...GAL, typeKey: "moloko_bezlaktozne", version: 2 }], [
    { kind: "ean", raw: "4823096413518", target: { productId: GAL.id } },
    { kind: "receipt_name", raw: "МолокГалБезл900", target: { productId: GAL.id } },
    { kind: "ean", raw: "4820000000000", target: { productId: GAL.id } },
  ]);
  const st = useApp.getState();
  check("upsertProducts: тип картки змінився — рядок комори теж", st.pantry[0].key, "moloko_bezlaktozne");
  check("upsertProducts: лише дійсні EAN у eanIndex", st.eanIndex, { "4823096413518": GAL.id });
  useApp.getState().resetToLocal();
  const out = useApp.getState();
  check("вихід з акаунта чистить кеш карток і відкладені видалення", [out.products, out.eanIndex, out.pantryLegacyRemoved], [{}, {}, []]);
}
{
  reset();
  useApp.getState().upsertCustomIngredientRow({
    key: "own_kefir_dom", label: "Кефір домашній", emoji: "🥛", cat: "dairy", aliases: [], staple: false,
    grams_per_piece: null, grams_per_cup: 240, default_unit: "ml", kcal: 50, protein: 3, fat: "2.5", carbs: 4,
    parent_key: "kefir", version: 3, merged_into: null, created_by: "x",
  });
  const def = useApp.getState().customIngredients[0];
  check("рядок realtime → тип у реєстрі з версією й батьком", [def.key, def.parent, def.version, def.nutrition.fat, def.defaultUnit], ["own_kefir_dom", "kefir", 3, 2.5, "ml"]);
  useApp.getState().upsertCustomIngredientRow({ ...def, label: "Кефір домашній 2,5%", version: 4 });
  check("готовий опис замінює за ключем", [useApp.getState().customIngredients.length, useApp.getState().customIngredients[0].label], [1, "Кефір домашній 2,5%"]);
  useApp.getState().setCustomIngredients([]);
}
{
  // Гідратація: merge нормалізує, версія сховища лишається 2.
  const opts = useApp.persist.getOptions();
  const merged = opts.merge({ theme: "light", pantry: [{ key: "sil", addedAt: AT }], products: "зламано" }, useApp.getState());
  check("persist: версія 2 назавжди", opts.version, 2);
  check("persist merge: рядок отримав id, зламаний кеш — порожній, решта як була", [UUID.test(merged.pantry[0].id), merged.products, merged.theme], [true, {}, "light"]);
}

console.log("── Черга записів комори ──");
{
  const order = [];
  const errors = [];
  const enqueue = sync.serialQueue((e) => errors.push(String(e)));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  enqueue(async () => { await wait(30); order.push("upsert A"); });
  enqueue(async () => { throw new Error("збій"); });
  await enqueue(async () => { order.push("delete A"); });
  check("upsert, потім delete — строго по черзі, збій не рве черги", [order, errors], [["upsert A", "delete A"], ["Error: збій"]]);
  check("legacy-id у базу не йде ніколи", sync.sendablePantry([{ id: "legacy:moloko" }, { id: GAL.id }]).map((x) => x.id), [GAL.id]);
}

console.log(`\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
