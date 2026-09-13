#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка комори «по товару» (I4): стекування, результат скану, групи,
 * списання за id, перепривʼязка тимчасових id і нормалізація сховища.
 *
 * Запуск: npm run check:pantry-stock (і в складі npm run check:pantry)
 *
 * Усе чисте — без стора й мережі; функції живуть у src/lib/pantry.ts. Черга
 * синхронізації (serialQueue) і дії стору (addPantry, updatePantry, знімок із
 * перепривʼязкою) — у scripts/check-pantry.mjs.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const S = await jiti.import("@/lib/pantry");
const { normalizePersisted, isLegacyId, legacyKey } = await jiti.import("@/lib/store-migrations");
const { formatSummed } = await jiti.import("@/lib/units");

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const TODAY = "2026-09-13";
const AT = "2026-09-13T09:00:00.000Z";
const YESTERDAY = "2026-09-12T09:00:00.000Z";

const product = (id, typeKey, name, extra = {}) => ({
  id, typeKey, name, source: "user", archived: false, version: 1, updatedAt: AT, ...extra,
});
const products = {
  gal: product("gal", "moloko", "Галичина 2,5%", { packAmount: 900, packUnit: "ml" }),
  mlk: product("mlk", "moloko", "Молокія 1,2%", { packAmount: 1, packUnit: "l" }),
  galBez: product("galBez", "moloko_bezlaktozne", "Молоко безлактозне Галичина 2,5%", { packAmount: 900, packUnit: "ml" }),
};
let seq = 0;
const row = (extra) => ({ id: `r${++seq}`, key: "moloko", addedAt: AT, ...extra });

const dish = (ingredients) => ({
  id: "t", authorId: "a", title: "Тест", description: "", emoji: "🍽️", gradient: ["#000", "#111"],
  cuisine: "Домашня", mealTypes: [], moods: [], tags: [], timeMin: 30, difficulty: 1, servings: 2,
  costLevel: 1, ingredients, steps: [], createdAt: AT,
  stats: { likes: 0, saves: 0, cooks: 0, ratingSum: 0, ratingCount: 0 },
});
const qty = (list) => list.map((p) => [p.id, p.amount ?? null, p.unit ?? null]);

console.log("── Стекування ──");
{
  const a = row({ productId: "gal", amount: 900, unit: "ml", expiresAt: "2026-09-16" });
  const r = S.stackIntoPantry([a], row({ productId: "gal", amount: 900, unit: "ml", expiresAt: "2026-09-16" }), TODAY, products);
  check("той самий товар + день + строк → один рядок 1,8 л", qty(r.pantry), [[a.id, 1.8, "l"]]);
  check("rowId — наявний рядок, before — він до злиття", [r.rowId, r.before], [a.id, a]);

  const r2 = S.stackIntoPantry([a], row({ productId: "gal", amount: 900, unit: "ml" }), TODAY, products);
  check("нова без строку приєднується до датованої пачки того ж дня", [r2.pantry.length, r2.pantry[0].expiresAt], [1, "2026-09-16"]);

  const d1 = S.stackIntoPantry([a], row({ productId: "gal", amount: 900, unit: "ml", addedAt: YESTERDAY }), TODAY, products);
  check("інший день → новий рядок", d1.pantry.length, 2);
  check("before null для нового рядка", d1.before, null);
  const d2 = S.stackIntoPantry([a], row({ productId: "gal", amount: 900, unit: "ml", expiresAt: "2026-09-20" }), TODAY, products);
  check("інший строк → новий рядок", d2.pantry.length, 2);
  const d3 = S.stackIntoPantry([a], row({ productId: "mlk", amount: 1, unit: "l", expiresAt: "2026-09-16" }), TODAY, products);
  check("інший товар → новий рядок", d3.pantry.length, 2);
  const d4 = S.stackIntoPantry([a], row({ productId: "gal", amount: 2, unit: "pcs", expiresAt: "2026-09-16" }), TODAY, products);
  check("штуки до мл не складаються → новий рядок", d4.pantry.length, 2);

  const edit = { ...a, expiresAt: "2026-09-18" };
  const e = S.stackIntoPantry([a, row({ productId: "mlk", amount: 1, unit: "l" })], edit, TODAY, products);
  check("той самий id → заміна на місці, без дубля", [e.pantry.length, e.pantry[0].expiresAt, e.rowId], [2, "2026-09-18", a.id]);

  const salt = { id: "s1", key: "sil", addedAt: YESTERDAY, ownerId: "userA" };
  const st = S.stackIntoPantry([salt], { id: "s2", key: "sil", addedAt: AT }, TODAY, products);
  check("голий базовий, що вже є (у члена сімʼї) → нічого", [st.pantry, st.rowId], [[salt], "s1"]);

  const p1 = row({ productId: "gal", amount: 900, unit: "ml", pricePerGram: 0.05 });
  const p = S.stackIntoPantry([p1], row({ productId: "gal", amount: 1800, unit: "ml", pricePerGram: 0.08 }), TODAY, products);
  check("ціна — середня зважена за грамами", Number(p.pantry[0].pricePerGram.toFixed(4)), 0.07);

  const t = S.stackIntoPantry([], row({ key: "moloko", productId: "galBez", amount: 900, unit: "ml" }), TODAY, products);
  check("productId ставить тип картки", t.pantry[0].key, "moloko_bezlaktozne");

  const own = row({ productId: "gal", amount: 900, unit: "ml", ownerId: "userA", receiptName: "Мол950УлГалич" });
  const o = S.stackIntoPantry([own], row({ productId: "gal", amount: 900, unit: "ml", ownerId: "userB" }), TODAY, products);
  check("власник і рядок каси — від наявного", [o.pantry[0].ownerId, o.pantry[0].receiptName], ["userA", "Мол950УлГалич"]);

  const line = { key: "imbyr", addedAt: AT, receiptName: "ІмбирКг", amount: 70, unit: "g" };
  const rc = S.stackAllIntoPantry([], [{ ...line, id: "l1" }, { ...line, id: "l2" }], TODAY, products);
  check("однаковий рядок чека двічі → один рядок 140 г", [qty(rc.pantry), rc.rowIds], [[["l1", 140, "g"]], ["l1"]]);
  const rd = S.stackAllIntoPantry([], [{ ...line, id: "l1" }, { ...line, id: "l2", receiptName: "ІмбирМарин" }], TODAY, products);
  check("різні рядки каси одного типу не зливаються", rd.pantry.length, 2);

  const leg = { id: "legacy:moloko", key: "moloko", addedAt: AT, amount: 500, unit: "ml" };
  const lg = S.stackIntoPantry([leg], row({ amount: 500, unit: "ml" }), TODAY, products);
  check("злиття в тимчасовий рядок позначає legacyDirty", [lg.pantry[0].amount, lg.pantry[0].unit, lg.pantry[0].legacyDirty], [1, "l", true]);
}

console.log("── updatePantry (чиста частина) ──");
{
  const r = row({ amount: 900, unit: "ml" });
  check("productId одразу переписує тип", S.patchPantryRow(r, { productId: "galBez" }, products).key, "moloko_bezlaktozne");
  check("id латкою не міняється", S.patchPantryRow(r, { id: "x", amount: 1 }, products).id, r.id);
  const l = S.patchPantryRow({ id: "legacy:moloko", key: "moloko", addedAt: AT }, { amount: 1, unit: "l" }, products);
  check("тимчасовий id → legacyDirty", [l.legacyDirty, isLegacyId(l.id)], [true, true]);
  check("справжній id без legacyDirty", "legacyDirty" in S.patchPantryRow(r, { amount: 1 }, products), false);
}

console.log("── Результат скану: різниця й скасування ──");
{
  const before = row({ productId: "gal", amount: 900, unit: "ml" });
  const stacked = S.stackIntoPantry([before], row({ productId: "gal", amount: 900, unit: "ml" }), TODAY, products);
  const plan = S.scanQuantityPlan(stacked.before, { amount: 1, unit: "l" });
  check("було 900 мл, введено 1 л → разом 1,9 л", plan, { kind: "set", amount: 1.9, unit: "l" });
  const edited = stacked.pantry.map((r) => (r.id === stacked.rowId ? S.patchPantryRow(r, { amount: plan.amount, unit: plan.unit }, products) : r));
  check("правка лише цієї пачки", qty(edited), [[before.id, 1.9, "l"]]);

  const undo = S.scanUndoPlan(stacked.rowId, stacked.before);
  const restored = S.stackIntoPantry(edited, undo.row, TODAY, products).pantry;
  check("«Скасувати» повертає 900 мл", qty(restored), [[before.id, 900, "ml"]]);

  const fresh = S.stackIntoPantry([], row({ productId: "gal", amount: 900, unit: "ml" }), TODAY, products);
  const u2 = S.scanUndoPlan(fresh.rowId, fresh.before);
  check("«Не той товар?» без попередньої пачки → прибрати рядок", [u2.kind, fresh.pantry.filter((r) => r.id !== u2.id).length], ["remove", 0]);

  const un = S.scanQuantityPlan(before, { amount: 2, unit: "pcs" });
  check("штуки до мл → розстекування", [un.kind, un.restore, un.add], ["unstack", before, { amount: 2, unit: "pcs" }]);
  check("без before → просто введене", S.scanQuantityPlan(null, { amount: 1, unit: "l" }), { kind: "set", amount: 1, unit: "l" });
}

console.log("── groupPantry ──");
{
  const rows = [
    row({ id: "m1", productId: "mlk", amount: 1, unit: "l", expiresAt: "2026-09-20" }),
    row({ id: "m2", productId: "gal", amount: 900, unit: "ml", expiresAt: "2026-09-16" }),
    row({ id: "m3", productId: "galBez", key: "moloko_bezlaktozne", amount: 900, unit: "ml" }),
    row({ id: "k1", key: "kefir", label: "Кефір Яготинський", amount: 400, unit: "ml", expiresAt: "2026-09-11" }),
    { id: "s1", key: "sil", addedAt: AT, ownerId: "A" },
    { id: "s2", key: "sil", addedAt: YESTERDAY, ownerId: "B" },
    row({ id: "e1", key: "yajtsya", amount: 6, unit: "pcs" }),
    row({ id: "e2", key: "yajtsya" }),
    row({ id: "c1", key: "tsybulya", amount: 2, unit: "pcs" }),
    row({ id: "c2", key: "tsybulya", amount: 200, unit: "g" }),
  ];
  const g = S.groupPantry(rows, products, TODAY);
  const groups = Object.fromEntries(g.sections.flatMap((s) => s.groups.map((gr) => [gr.key, gr])));
  check("прострочене окремо", g.expired.map((r) => r.id), ["k1"]);
  check("900 мл + 1 л → «1,9 л»", formatSummed(groups.moloko.total), "1,9 л");
  check("рядки: датовані за строком", groups.moloko.rows.map((r) => r.id), ["m2", "m1"]);
  check("найближчий строк групи", groups.moloko.soonest, "2026-09-16");
  check("безлактозне — окрема група", groups.moloko_bezlaktozne.rows.map((r) => r.id), ["m3"]);
  check("«Сіль» двох членів сімʼї — одна", [groups.sil.rows.length, groups.sil.unknown], [1, 1]);
  check("unknown: рядок без кількості", [formatSummed(groups.yajtsya.total), groups.yajtsya.unknown], ["6 шт", 1]);
  check("розділи за CAT_ORDER", g.sections.map((s) => s.cat)[0], "veg");
  const onion = groups.tsybulya;
  check("штучний тип зі змішаними одиницями — окремими мірами", formatSummed(onion.total), "2 шт · 200 г");
  check("лічильник: сіль раз", S.pantryCounts(rows), { items: 9, types: 6 });
}
{
  // Суміш без ваги штуки: чесної суми немає — показуємо обидві міри.
  const g = S.groupPantry([row({ id: "x1", key: "own_nevidome", amount: 2, unit: "pcs" }), row({ id: "x2", key: "own_nevidome", amount: 200, unit: "g" })], {}, TODAY);
  check("змішані одиниці без ваги штуки → «2 шт · 200 г»", formatSummed(g.sections[0].groups[0].total), "2 шт · 200 г");
}

console.log("── Списання за id (D9) ──");
{
  const gal = row({ id: "gal-row", productId: "gal", amount: 900, unit: "ml", expiresAt: "2026-09-16" });
  const mlk = row({ id: "mlk-row", productId: "mlk", amount: 1, unit: "l", expiresAt: "2026-09-20" });
  const pantry = [mlk, gal];

  const a = S.consumeForRecipe(pantry, dish([{ key: "moloko", amount: 500, unit: "ml" }]), 1, products, TODAY);
  check("500 мл: Галичина лишається 400 мл", qty(a.pantry), [["mlk-row", 1, "l"], ["gal-row", 400, "ml"]]);
  check("підсумок із id і назвою товару", a.consumed.map((c) => [c.id, c.label, c.used, c.left]), [["gal-row", "Галичина 2,5%", "500 мл", "400 мл"]]);

  const b = S.consumeForRecipe(pantry, dish([{ key: "moloko", amount: 1.5, unit: "l" }]), 1, products, TODAY);
  check("1,5 л: Галичина зникає, Молокія 400 мл", qty(b.pantry), [["mlk-row", 0.4, "l"]]);
  check("два рядки в підсумку", b.consumed.map((c) => [c.id, c.left]), [["gal-row", null], ["mlk-row", "0,4 л"]]);

  const restored = S.restorePantryById(b.pantry, pantry.filter((p) => b.consumed.some((c) => c.id === p.id)));
  check("«Повернути в комору» за id", qty(restored).sort(), qty(pantry).sort());

  const bez = row({ id: "bez", key: "moloko_bezlaktozne", productId: "galBez", amount: 900, unit: "ml", expiresAt: "2026-09-14" });
  const plain = row({ id: "plain", productId: "gal", amount: 900, unit: "ml", expiresAt: "2026-09-25" });
  const c = S.consumeForRecipe([bez, plain], dish([{ key: "moloko", amount: 300, unit: "ml" }]), 1, products, TODAY);
  check("потреба «Молоко» бере звичайне раніше за безлактозне", qty(c.pantry), [["bez", 900, "ml"], ["plain", 600, "ml"]]);

  const old = row({ id: "old", productId: "gal", amount: 900, unit: "ml", expiresAt: "2026-09-10" });
  const ok = row({ id: "ok", productId: "mlk", amount: 1, unit: "l", expiresAt: "2026-09-30" });
  const d = S.consumeForRecipe([old, ok], dish([{ key: "moloko", amount: 200, unit: "ml" }]), 1, products, TODAY);
  check("прострочене — останнім", qty(d.pantry), [["old", 900, "ml"], ["ok", 0.8, "l"]]);

  const pcs = row({ id: "pcs", productId: "gal", amount: 2, unit: "pcs" });
  const e = S.consumeForRecipe([pcs], dish([{ key: "moloko", amount: 900, unit: "ml" }]), 1, products, TODAY);
  check("штуки товару — через упаковку 900 мл", qty(e.pantry), [["pcs", 1, "pcs"]]);

  const bare = row({ id: "bare" });
  check("рядок без кількості не списується", S.consumeForRecipe([bare], dish([{ key: "moloko", amount: 200, unit: "ml" }]), 1, products, TODAY).consumed, []);

  const leg = { id: "legacy:moloko", key: "moloko", addedAt: AT, amount: 1, unit: "l" };
  check("списання з тимчасового рядка → legacyDirty", S.consumeForRecipe([leg], dish([{ key: "moloko", amount: 200, unit: "ml" }]), 1, products, TODAY).pantry[0].legacyDirty, true);
}

console.log("── availableFor ──");
{
  const pantry = [
    row({ id: "a", productId: "gal", amount: 900, unit: "ml" }),
    row({ id: "b", key: "moloko_bezlaktozne", productId: "galBez", amount: 1, unit: "l" }),
    row({ id: "c", key: "kefir", amount: 500, unit: "ml" }),
  ];
  check("потреба «Молоко» рахує і різновид: 1,9 л", formatSummed(S.availableFor("moloko", pantry, products)), "1,9 л");
  check("потреба «безлактозне» — лише його", formatSummed(S.availableFor("moloko_bezlaktozne", pantry, products)), "1 л");
  check("нічого немає → []", S.availableFor("syr", pantry, products), []);
}

console.log("── rebaseLegacyPantry ──");
{
  const remote = [
    { id: "srv-early", key: "moloko", addedAt: "2026-09-01T08:00:00+00:00", amount: 1, unit: "l", ownerId: "A" },
    { id: "srv-same", key: "moloko", addedAt: "2026-09-05T08:00:00+00:00", amount: 1, unit: "l", ownerId: "B", productId: "gal" },
    { id: "srv-butter", key: "maslo", addedAt: "2026-09-02T08:00:00+00:00", amount: 200, unit: "g", ownerId: "A" },
  ];
  const dirty = { id: "legacy:moloko", key: "moloko", addedAt: "2026-09-05T08:00:00.000Z", amount: 500, unit: "ml", legacyDirty: true };
  const r1 = S.rebaseLegacyPantry([dirty], remote, []);
  check("змінений → серверний id із тим самим addedAt", r1.upserts.map((u) => [u.id, u.amount, u.ownerId, u.productId, "legacyDirty" in u]), [["srv-same", 500, "B", "gal", false]]);
  check("знімок із правкою на місці", r1.pantry.map((p) => [p.id, p.amount]), [["srv-early", 1], ["srv-same", 500], ["srv-butter", 200]]);

  const r2 = S.rebaseLegacyPantry([{ ...dirty, addedAt: "2026-09-09T00:00:00.000Z" }], remote, []);
  check("інший addedAt → найраніший рядок ключа", r2.upserts[0].id, "srv-early");
  check("чужий (сімейний) рядок лишає власника", r2.upserts[0].ownerId, "A");

  const r3 = S.rebaseLegacyPantry([{ id: "legacy:syr", key: "syr", addedAt: AT, amount: 100, unit: "g", legacyDirty: true }], remote, []);
  check("немає серверного → новий uuid", [UUID.test(r3.upserts[0].id), r3.pantry.length], [true, 4]);

  const r4 = S.rebaseLegacyPantry([{ id: "legacy:maslo", key: "maslo", addedAt: AT, amount: 1, unit: "g" }], remote, []);
  check("незмінений тимчасовий → зникає", [r4.upserts, r4.pantry.map((p) => p.id)], [[], ["srv-early", "srv-same", "srv-butter"]]);

  const later = { id: "srv-later", key: "moloko", addedAt: "2026-09-12T08:00:00+00:00", amount: 900, unit: "ml" };
  const r5 = S.rebaseLegacyPantry(
    [later],
    [...remote, later],
    [{ key: "moloko", addedAt: "2026-09-01T08:00:00.000Z" }],
  );
  check("прибране → рівно один рядок із тим самим addedAt", r5.removeIds, ["srv-early"]);
  check("пізніша пачка вціліла", r5.pantry.map((p) => p.id), ["srv-same", "srv-butter", "srv-later"]);

  const r6 = S.rebaseLegacyPantry(
    [{ id: "srv-early", key: "moloko", addedAt: "2026-09-01T08:00:00+00:00" }],
    [remote[0]],
    [{ key: "moloko", addedAt: "2026-09-01T08:00:00.000Z" }],
  );
  check("рядок, чий справжній id є локально, не видаляється", r6.removeIds, []);

  // До першого знімка людина обрала картку іншого типу — у базі рядок досі під старим ключем.
  const linked = { ...dirty, key: "moloko_bezlaktozne", productId: "galBez" };
  const r7 = S.rebaseLegacyPantry([linked], remote, []);
  check("обрана картка іншого типу → той самий серверний рядок, картка й тип локальні",
    r7.upserts.map((u) => [u.id, u.productId, u.key]), [["srv-same", "galBez", "moloko_bezlaktozne"]]);

  // SQL I2 переписав касове безлактозне молоко: у базі moloko_bezlaktozne, локально — legacy:moloko.
  const refined = [{ id: "srv-bez", key: "moloko_bezlaktozne", addedAt: "2026-09-05T08:00:00+00:00", amount: 1900, unit: "g", receiptName: "Мол950УлГаличБЛак2.5", ownerId: "A" }];
  const r8 = S.rebaseLegacyPantry([{ ...dirty, label: "Мол950УлГаличБЛак2.5" }], refined, []);
  check("тип, уточнений у базі, → той самий рядок без другої пачки",
    [r8.upserts.map((u) => [u.id, u.key, u.label ?? null, u.receiptName]), r8.pantry.length],
    [[["srv-bez", "moloko_bezlaktozne", null, "Мол950УлГаличБЛак2.5"]], 1]);
  const r9 = S.rebaseLegacyPantry([], refined, [{ key: "moloko", addedAt: "2026-09-05T08:00:00.000Z" }]);
  check("прибране під старим ключем → уточнений рядок тієї ж миті", r9.removeIds, ["srv-bez"]);
  check("чужа мить неспорідненого типу не підхоплюється",
    S.rebaseLegacyPantry([], [{ ...refined[0], key: "kefir" }], [{ key: "moloko", addedAt: "2026-09-05T08:00:00.000Z" }]).removeIds, []);

  // Поруч звичайне молоко дружини (інша мить): та сама мить спорідненого типу важить більше за «найраніший ключа».
  const wife = { id: "srv-wife", key: "moloko", addedAt: "2026-09-01T08:00:00+00:00", amount: 1, unit: "l", ownerId: "B" };
  const r10 = S.rebaseLegacyPantry([{ ...dirty, label: "Мол950УлГаличБЛак2.5" }], [...refined, wife], []);
  check("правка тимчасового → рядок тієї ж миті, не пачка дружини",
    [r10.upserts.map((u) => [u.id, u.amount, u.ownerId]), r10.pantry.find((p) => p.id === "srv-wife").amount],
    [[["srv-bez", 500, "A"]], 1]);
  const r11 = S.rebaseLegacyPantry([], [...refined, wife], [{ key: "moloko", addedAt: "2026-09-05T08:00:00.000Z" }]);
  check("прибране під старим ключем → рядок тієї ж миті, молоко дружини ціле", r11.removeIds, ["srv-bez"]);
  check("без рядка тієї ж миті — як і раніше, найраніший ключа",
    S.rebaseLegacyPantry([], [wife], [{ key: "moloko", addedAt: "2026-09-05T08:00:00.000Z" }]).removeIds, ["srv-wife"]);
}

console.log("── «Повернути в комору» після першого знімка (rebaseRestored) ──");
{
  const A = "2026-09-10T09:00:00.000Z";
  const legacyMilk = { id: "legacy:moloko", key: "moloko", addedAt: A, amount: 900, unit: "ml" };
  // Знімка ще не було: видалення чекає — рядок повертається тим самим тимчасовим.
  check("знімка не було → той самий тимчасовий рядок",
    S.rebaseRestored([], [legacyMilk], [{ key: "moloko", addedAt: A }]), [legacyMilk]);
  // Знімок уже перепривʼязав змінений рядок — кількість у справжній рядок.
  const rebased = { id: "srv-1", key: "moloko", addedAt: "2026-09-10T09:00:00+00:00", amount: 400, unit: "ml", ownerId: "B", receiptName: "Мол" };
  check("знімок дав справжній id → кількість туди ж, власник і каса — з нього",
    S.rebaseRestored([rebased], [legacyMilk], []), [{ ...rebased, amount: 900, unit: "ml", qty: undefined }]);
  // Знімок уже прибрав спорожнілий рядок у базі — новий рядок з uuid, без legacyDirty.
  const back = S.rebaseRestored([], [{ ...legacyMilk, legacyDirty: true }], []);
  check("знімок прибрав рядок → новий uuid, щоб дійшов до бази",
    [UUID.test(back[0].id), back[0].amount, "legacyDirty" in back[0]], [true, 900, false]);
  check("справжній id — як є", S.rebaseRestored([], [rebased], []), [rebased]);
}

console.log("── normalizePersisted ──");
{
  check("legacyKey: старий ключ із тимчасового id", [legacyKey("legacy:moloko"), legacyKey("legacy:moloko##"), legacyKey("srv-1"), legacyKey(undefined)], ["moloko", "moloko", null, null]);
  const v2 = {
    onboarded: true,
    theme: "dark",
    customIngredients: [{ key: "own_x" }],
    pantry: [
      { key: "moloko", addedAt: AT, amount: 1, unit: "l" },
      { key: "moloko", addedAt: YESTERDAY },
      { key: "sil", addedAt: AT },
      { id: "keep-me", key: "maslo", addedAt: AT },
      { key: 5, addedAt: AT },
      null,
      { key: "syr" },
    ],
  };
  const b = normalizePersisted(v2, true);
  check("бекенд: legacy-id, дублі ключа різні", b.pantry.map((p) => p.id), ["legacy:moloko", "legacy:moloko#", "legacy:sil", "keep-me"]);
  check("рядок з id не чіпаємо (та сама посилка)", b.pantry[3] === v2.pantry[3], true);
  check("решта стану як була", [b.onboarded, b.theme, b.customIngredients === v2.customIngredients], [true, "dark", true]);
  check("вхід не змінено", "id" in v2.pantry[0], false);

  const l = normalizePersisted(v2, false);
  check("локальний режим → uuid", l.pantry.slice(0, 3).every((p) => UUID.test(p.id)), true);
  check("uuid різні", new Set(l.pantry.map((p) => p.id)).size, 4);

  const dup = normalizePersisted({ pantry: [{ id: "same", key: "a", addedAt: AT }, { id: "same", key: "b", addedAt: AT }] }, true);
  check("дубль справжнього id → новий uuid", [dup.pantry[0].id, UUID.test(dup.pantry[1].id)], ["same", true]);

  check("не обʼєкт → {}", [normalizePersisted(null, true), normalizePersisted("x", true), normalizePersisted([1], false)], [{}, {}, {}]);
  check("без комори — як є", normalizePersisted({ theme: "light" }, true), { theme: "light" });
  check("зламаний pantryLegacyRemoved → []", normalizePersisted({ pantryLegacyRemoved: "x" }, true), { pantryLegacyRemoved: [] });
  check("pantryLegacyRemoved без сміття", normalizePersisted({ pantryLegacyRemoved: [{ key: "a", addedAt: AT }, { key: 1 }] }, true).pantryLegacyRemoved, [{ key: "a", addedAt: AT }]);
}

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
