#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка чистої логіки товарів: штрихкоди, підказки з касових назв,
 * мережі, картки, OFF, навчання, розпізнавання й текст сповіщення про строки.
 *
 * Запуск: node scripts/check-products.mjs (npm run check:products)
 *
 * Без мережі й без бази: усе, що ходило б у Supabase чи Open Food Facts,
 * підмінено заглушками, які записують виклики. Вектори normalizeEan — ті самі,
 * що в SQL (design A3): розійдуться — клієнт і база по-різному бачитимуть код.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const load = (file) => jiti.import(path.join(root, file));

const { normalizeEan } = await load("src/lib/ean.ts");
const { productHints, receiptDisplayName } = await load("src/lib/product-hints.ts");
const { chainOf } = await load("src/data/chains.ts");
const { packGrams, productLabel, shortProductName, rowFromProduct } = await load("src/lib/products.ts");
const { productDraftFromOff, lookupOffDraft } = await load("src/lib/off-draft.ts");
const { teachPlan, conflictAction, wrongMappingConflicts } = await load("src/lib/teach.ts");
const { resolveBarcode, resolveReceipt, draftReceiptLines } = await load("src/lib/resolve.ts");
const { expiryMessage, expiryRowName } = await load("src/lib/expiry-text.ts");
const { CatalogError } = await load("src/lib/product-types.ts");

let pass = 0;
let fail = 0;
const check = (what, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    pass++;
    return;
  }
  fail++;
  console.log(`  ✗ ${what}\n      отримано: ${JSON.stringify(actual)}\n      очікувано: ${JSON.stringify(expected)}`);
};
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k]]));

/* ── normalizeEan ─────────────────────────────────────────────────────── */
console.log("── normalizeEan (паритет із SQL) ──");

for (const [raw, expected] of [
  ["4820000000000", null], // заглушка каси: після префікса самі нулі
  ["4820000000017", "4820000000017"],
  ["87021776", "87021776"],
  ["4823096413518", "4823096413518"],
  ["250015026841", null], // UPC-A → 0250015026841 → внутрішній 02…
  ["2500150268410", null], // внутрішній 2…
  ["4823096413519", null], // зіпсована контрольна цифра
  ["0400000000000", null],
  ["1111111111111", null], // одна цифра
  ["0000000000000", null],
  ["036000291452", "0036000291452"], // UPC-A доповнюється нулем
  ["4823 0964 13518", "4823096413518"], // пробіли з етикетки
  ["", null],
  [undefined, null],
  ["12345", null],
]) {
  check(`normalizeEan(${JSON.stringify(raw)})`, normalizeEan(raw), expected);
}

/* ── productHints ─────────────────────────────────────────────────────── */
console.log("── productHints (таблиця C) ──");

const hint = (raw, base) => {
  const h = productHints(raw, base);
  return {
    name: h.suggestedName,
    pack: h.packAmount != null ? `${h.packAmount} ${h.packUnit}${h.packGuessed ? "?" : ""}` : h.weighed ? "weighed" : null,
    type: h.typeKey,
  };
};

check("МолокГалБезл900", hint("МолокГалБезл900", "moloko"), {
  name: "Молоко безлактозне Галичина",
  pack: "900 ml?",
  type: "moloko_bezlaktozne",
});
check("Мол950УлГаличБЛак2.5", hint("Мол950УлГаличБЛак2.5", "moloko"), {
  name: "Молоко безлактозне Галичина 2,5%",
  pack: "950 ml?",
  type: "moloko_bezlaktozne",
});
check("МОЛОКО БЕЗЛАКТ.ГАЛИЧИНА 2,5% 900Г", hint("МОЛОКО БЕЗЛАКТ.ГАЛИЧИНА 2,5% 900Г"), {
  name: "Молоко безлактозне Галичина 2,5%",
  pack: "900 ml",
  type: "moloko_bezlaktozne",
});
check("Масл180МолСолод73", hint("Масл180МолСолод73", "maslo"), {
  name: "Вершкове масло солодковершкове 73%",
  pack: "180 g?",
  type: "maslo",
});
check("Молоко Молокія 1.2% 1л", hint("Молоко Молокія 1.2% 1л"), {
  name: "Молоко Молокія 1,2%",
  pack: "1 l",
  type: "moloko",
});
check("ІмбирКг", hint("ІмбирКг", "imbyr"), { name: "Імбир", pack: "weighed", type: "imbyr" });
check("Кефір без лактози: ознака лише в межах молока", hint("Кефір без лактози 2,5% 900г"), {
  name: "Кефір 2,5%",
  pack: "900 ml",
  type: "kefir",
});

const mol = productHints("Мол950УлГаличБЛак2.5", "moloko");
check("здогадки позначені", [...mol.guessed].sort(), ["brand", "fat", "pack", "type"]);
check("жирність і бренд", pick(mol, ["brand", "fatPct", "weighed"]), { brand: "Галичина", fatPct: 2.5, weighed: false });

const cola = productHints("Напій Кока-Кола Зеро 1,75 л");
check("VARUS: Кока-Кола 1,75 л — упаковка без жирності", pick(cola, ["packAmount", "packUnit", "fatPct"]), {
  packAmount: 1.75,
  packUnit: "l",
  fatPct: undefined,
});
check("«Молоко 1кг» — упаковка, а не ваговий", pick(productHints("Молоко 1кг"), ["weighed", "packAmount", "packUnit"]), {
  weighed: false,
  packAmount: 1,
  packUnit: "l",
});
check("перше слово ніколи не бренд", productHints("Галичина молоко", "moloko").brand, undefined);
check("бренд у відмінку: Яготинський → Яготинське", productHints("Кефір Яготинський 2,5% 400мл").brand, "Яготинське");
check("«Паста томатна» не пастеризована", productHints("Паста томатна 70г").attributes, []);
check("ПАСТ. у молоці — пастеризоване", productHints("МОЛОКО ПАСТ.2,5% ГАЛИЧИНА 900Г").typeKey, "moloko");
check("бренди з кешу карток", productHints("Молоко Ферма Лугова 2,5%", "moloko", ["Лугова"]).brand, "Ферма");
check("бренд із кешу, коли насіння мовчить", productHints("Молоко Лугова 2,5%", "moloko", ["Лугова"]).brand, "Лугова");
check("молоко без лактози двома словами уточнює тип", productHints("Молоко без лактози 900г", "moloko").typeKey, "moloko_bezlaktozne");

check("receiptDisplayName: касовий рядок → людська назва", receiptDisplayName("Мол950УлГаличБЛак2.5", "moloko"), "Молоко безлактозне Галичина 2,5%");
check("receiptDisplayName: без рядка — назва типу", receiptDisplayName(undefined, "moloko"), "Молоко");
check("receiptDisplayName: невідомий рядок — назва типу", receiptDisplayName("ШокБатКрем45", "shokolad"), "Шоколад");

/* ── chainOf ──────────────────────────────────────────────────────────── */
console.log("── chainOf ──");

check("QR і фото АТБ — одна мережа", [chainOf("ТОВ «АТБ-МАРКЕТ»"), chainOf("АТБ")], ["atb", "atb"]);
check("Сільпо", chainOf("ТОВ «Сільпо-Фуд»"), "silpo");
check("ТОВ «Омега» — це VARUS", chainOf("ТОВ «Омега»"), "varus");
check("ФОРА цілим словом", [chainOf("ФОРА"), chainOf("Платформа смаку")], ["fora", undefined]);
check("METRO", chainOf("ТОВ «МЕТРО Кеш енд Кері Україна»"), "metro");
check("невідомий продавець", [chainOf("ФОП Петренко"), chainOf(undefined), chainOf("  ")], [undefined, undefined, undefined]);

/* ── products ─────────────────────────────────────────────────────────── */
console.log("── картки ──");

const P1 = {
  id: "11111111-1111-4111-8111-111111111111",
  typeKey: "moloko_bezlaktozne",
  name: "Молоко безлактозне Галичина 2,5%",
  brand: "Галичина",
  fatPct: 2.5,
  packAmount: 900,
  packUnit: "ml",
  source: "user",
  archived: false,
  version: 3,
  updatedAt: "2026-09-12T10:00:00Z",
};
const P2 = { ...P1, id: "22222222-2222-4222-8222-222222222222", typeKey: "moloko", name: "Молоко Галичина 2,5%", packAmount: 950 };
const P3 = { ...P1, id: "33333333-3333-4333-8333-333333333333", typeKey: "maslo", name: "Масло Яготинське 73%", packAmount: 180, packUnit: "g" };

check("packGrams: 900 мл → 900", packGrams(P1), 900);
check("packGrams: 1 кг → 1000", packGrams({ packAmount: 1, packUnit: "kg" }), 1000);
check("packGrams: 1,5 л → 1500", packGrams({ packAmount: 1.5, packUnit: "l" }), 1500);
check("packGrams: 6 шт по 55 г", packGrams({ packAmount: 6, packUnit: "pcs", gramsPerPiece: 55 }), 330);
check("packGrams: штуки без ваги — невідомо", packGrams({ packAmount: 6, packUnit: "pcs" }), null);
check("packGrams: без упаковки", packGrams({}), null);
check("productLabel", productLabel(P1), "Молоко безлактозне Галичина 2,5% · 900 мл");
check("productLabel без упаковки", productLabel({ name: "Імбир" }), "Імбир");

check("shortProductName у своєму типі", shortProductName(P1.name, "moloko_bezlaktozne"), "Галичина 2,5%");
check("shortProductName у батьківській групі", shortProductName(P1.name, "moloko"), "Безлактозне Галичина 2,5%");
check("shortProductName: масло", shortProductName("Вершкове масло солодковершкове 73%", "maslo"), "Солодковершкове 73%");
check("shortProductName: нічого не лишилось — повна назва", shortProductName("Молоко", "moloko"), "Молоко");
check("shortProductName: не з назви типу — як є", shortProductName("Галичина 2,5%", "moloko"), "Галичина 2,5%");

const row = rowFromProduct(P1, { barcode: "4820000000017" }, new Date("2026-09-13T08:00:00Z"));
check("rowFromProduct", pick(row, ["key", "productId", "amount", "unit", "barcode", "addedAt"]), {
  key: "moloko_bezlaktozne",
  productId: P1.id,
  amount: 900,
  unit: "ml",
  barcode: "4820000000017",
  addedAt: "2026-09-13T08:00:00.000Z",
});
check("rowFromProduct: новий uuid", /^[0-9a-f-]{36}$/.test(row.id), true);
check("rowFromProduct: тип завжди з картки", rowFromProduct(P1, { key: "kefir" }).key, "moloko_bezlaktozne");

/* ── Open Food Facts ──────────────────────────────────────────────────── */
console.log("── productDraftFromOff ──");

// Скорочена справжня форма відповідi OFF v2 (лише поля з OFF_FIELDS).
const OFF_FIXTURE = {
  code: "4820001234567",
  status: 1,
  product: {
    product_name: "Lactose free milk",
    product_name_uk: "Молоко безлактозне 2,5%",
    brands: "Галичина, Галичина Україна",
    image_small_url: "https://images.openfoodfacts.org/images/products/482/000/123/4567/front_uk.3.200.jpg",
    categories_tags: ["en:dairies", "en:milks", "en:lactose-free-milks"],
    quantity: "900 ml",
    product_quantity: "900",
    product_quantity_unit: "ml",
    nutriments: {
      "energy-kcal_100g": 52,
      proteins_100g: 3,
      fat_100g: 2.5,
      carbohydrates_100g: 4.7,
    },
  },
};

const off = productDraftFromOff("4820001234567", OFF_FIXTURE);
check("OFF: картка", pick(off, ["typeKey", "name", "brand", "fatPct", "packAmount", "packUnit", "image", "source"]), {
  typeKey: "moloko_bezlaktozne",
  name: "Молоко безлактозне 2,5%",
  brand: "Галичина",
  fatPct: 2.5,
  packAmount: 900,
  packUnit: "ml",
  image: OFF_FIXTURE.product.image_small_url,
  source: "off",
});
check("OFF: КБЖВ", off?.nutrition, { kcal: 52, protein: 3, fat: 2.5, carbs: 4.7 });
check("OFF: звідки й здогадки", [off?.provenance, off?.guessed], [{ from: "off", ean: "4820001234567" }, ["type"]]);

const offRu = productDraftFromOff("4820000000017", {
  product_name_ru: "Кефир 1%",
  quantity: "1 л",
  nutriments: { "energy-kj_100g": 167 },
});
check("OFF: лише російська назва — здогадка", pick(offRu, ["name", "typeKey", "packAmount", "packUnit", "guessed"]), {
  name: "Кефир 1%",
  typeKey: "kefir",
  packAmount: 1,
  packUnit: "l",
  guessed: ["name", "type"],
});
check("OFF: кДж → ккал", offRu?.nutrition?.kcal, 40);
check("OFF: за категорією", productDraftFromOff("1", { product_name: "Nutra X", categories_tags: ["en:lactose-free-milks"] })?.typeKey, "moloko_bezlaktozne");
check("OFF: порожній товар — null", productDraftFromOff("1", { product: {} }), null);
check("OFF: не обʼєкт — null", productDraftFromOff("1", null), null);

let offUrl = "";
const offDraft = await lookupOffDraft("4820001234567", undefined, async (url) => {
  offUrl = String(url);
  return { ok: true, json: async () => OFF_FIXTURE };
});
check("lookupOffDraft: запит і чернетка", [offUrl.includes("/product/4820001234567.json?fields="), offDraft?.name], [true, "Молоко безлактозне 2,5%"]);
check("lookupOffDraft: мережа впала — null", await lookupOffDraft("1", undefined, async () => { throw new Error("offline"); }), null);

/* ── teachPlan / conflictAction ───────────────────────────────────────── */
console.log("── teachPlan (T1–T4) ──");

const EAN = "4820000000017";
const hitOf = (kind, raw, target) => ({ kind, raw, identifierId: `id-${kind}`, scope: "", target, version: 2 });
const none = { via: "none" };
const line = { name: "МолокГалБезл900", ean: EAN };

check("T1: confirmed → назва й EAN до товару", teachPlan(line, none, { kind: "confirmed", productId: P1.id }, "qr"), [
  { kind: "receipt_name", raw: "МолокГалБезл900", product_id: P1.id, source: "qr" },
  { kind: "ean", raw: EAN, product_id: P1.id, source: "qr" },
]);
check("T1: недійсний EAN не вчимо", teachPlan({ name: "Х", ean: "4820000000000" }, none, { kind: "picked-product", productId: P1.id }, "photo"), [
  { kind: "receipt_name", raw: "Х", product_id: P1.id, source: "photo" },
]);
check("T1: те, що вже вказує туди ж, не шлемо", teachPlan(line, { via: "receipt_name", hit: hitOf("receipt_name", line.name, { productId: P1.id }) }, { kind: "confirmed", productId: P1.id }, "qr"), [
  { kind: "ean", raw: EAN, product_id: P1.id, source: "qr" },
]);
check("T1 скан: лише EAN", teachPlan({ name: "Nutella", ean: EAN }, none, { kind: "picked-product", productId: P1.id }, "scan"), [
  { kind: "ean", raw: EAN, product_id: P1.id, source: "scan" },
]);
check("T2: тип — лише назва, EAN чека до типу ніколи", teachPlan(line, none, { kind: "picked-type", typeKey: "moloko" }, "qr"), [
  { kind: "receipt_name", raw: "МолокГалБезл900", type_key: "moloko", source: "qr" },
]);
check("T3: впізнано штрихкодом → назва only_if_unknown", teachPlan(line, { via: "ean", hit: hitOf("ean", EAN, { productId: P1.id }) }, { kind: "untouched" }, "qr"), [
  { kind: "receipt_name", raw: "МолокГалБезл900", product_id: P1.id, source: "qr", only_if_unknown: true },
]);
check("T3: впізнано назвою → EAN only_if_unknown", teachPlan(line, { via: "receipt_name", hit: hitOf("receipt_name", line.name, { productId: P1.id }) }, { kind: "untouched" }, "qr"), [
  { kind: "ean", raw: EAN, product_id: P1.id, source: "qr", only_if_unknown: true },
]);
check("T3: ціль-тип нічого не вчить", teachPlan({ name: "ІмбирКг" }, { via: "receipt_name", hit: hitOf("receipt_name", "ІмбирКг", { typeKey: "imbyr" }) }, { kind: "untouched" }, "photo"), []);
check("T4: скан «Лише тип»", teachPlan({ ean: EAN }, none, { kind: "picked-type", typeKey: "moloko" }, "scan"), [
  { kind: "ean", raw: EAN, type_key: "moloko", source: "scan", only_if_unknown: true },
]);
check("untouched з самою підказкою — нічого", teachPlan(line, { via: "none", suggestion: { product: P1, from: "search" } }, { kind: "untouched" }, "qr"), []);
check("eanConflict без вибору — нічого", teachPlan(line, { via: "ean", hit: hitOf("ean", EAN, { productId: P2.id }), eanConflict: hitOf("receipt_name", line.name, { productId: P1.id }) }, { kind: "untouched" }, "qr"), []);
check("не їжа — нічого", teachPlan({ ...line, nonFood: true }, none, { kind: "confirmed", productId: P1.id }, "qr"), []);
check("без галочки — нічого", teachPlan({ ...line, checked: false }, none, { kind: "confirmed", productId: P1.id }, "qr"), []);
check("B7: рядок без доказів — нічого", teachPlan({}, none, { kind: "picked-product", productId: P1.id }, "manual"), []);
check("B7: зі старою касовою назвою — T1 manual", teachPlan({ name: "Масл180МолСолод73" }, none, { kind: "picked-product", productId: P3.id }, "manual"), [
  { kind: "receipt_name", raw: "Масл180МолСолод73", product_id: P3.id, source: "manual" },
]);

console.log("── conflictAction (B9) ──");
const sentEan = { kind: "ean", raw: EAN, product_id: P1.id, source: "scan" };
const conflictWith = (target) => ({ kind: "ean", raw: EAN, status: "conflict", identifierId: "x", scope: "", target, version: 4 });
check("тип → товар цього різновиду: refine", conflictAction(sentEan, conflictWith({ typeKey: "moloko" }), "moloko_bezlaktozne"), "refine");
check("тип іншої гілки: prompt", conflictAction(sentEan, conflictWith({ typeKey: "kefir" }), "moloko_bezlaktozne"), "prompt");
check("EAN до іншого товару: prompt", conflictAction(sentEan, conflictWith({ productId: P2.id }), "moloko_bezlaktozne"), "prompt");
check("назва в тій самій області: prompt", conflictAction({ kind: "receipt_name", raw: "X", product_id: P1.id, source: "qr" }, { kind: "receipt_name", raw: "X", status: "conflict", scope: "m:atb", target: { productId: P2.id }, version: 1 }, P1.typeKey), "prompt");
check("область магазину поверх глобальної: none", conflictAction({ kind: "receipt_name", raw: "X", product_id: P1.id, source: "qr" }, { kind: "receipt_name", raw: "X", status: "inserted", scope: "m:atb" }, P1.typeKey), "none");
check("only_if_unknown не сперечається", conflictAction({ ...sentEan, only_if_unknown: true }, conflictWith({ productId: P2.id }), P1.typeKey), "none");

console.log("── «Не той товар?»: хибна привʼязка в області магазину ──");
{
  // Чек АТБ навчив «МолокГалБезл900» → P1 (m:atb); виправлення з комори без магазину вчить глобально → P2.
  const raw = "МолокГалБезл900";
  const ident = (id, scope, target) => ({ id, kind: "receipt_name", scope, raw, value: "x", target, source: "qr", version: 3 });
  const found = [
    ident("atb", "m:atb", { productId: P1.id }),
    ident("glob", "", { productId: P2.id }),            // щойно навчене глобально — уже на новому
    ident("silpo", "m:silpo", { productId: P3.id }),    // інша мережа, інший товар — не наша справа
    ident("type", "s:kolo", { typeKey: "moloko" }),
  ];
  const got = wrongMappingConflicts(found, raw, P1.id, P2.id, new Set(["glob"]));
  check("питаємо лише про привʼязку до попереднього товару — в області АТБ, з версією",
    got.map((c) => [c.result.identifierId, c.result.scope, c.result.status, c.result.version, c.sent.product_id]),
    [["atb", "m:atb", "conflict", 3, P2.id]]);
  check("спитане — «prompt», а не мовчазне уточнення", conflictAction(got[0].sent, got[0].result, P2.typeKey), "prompt");
  check("уже розібране teach не повторюємо", wrongMappingConflicts(found, raw, P1.id, P2.id, new Set(["atb"])), []);
  check("без попереднього товару («Обрати товар») — нічого", wrongMappingConflicts(found, raw, undefined, P2.id), []);
  check("той самий товар — нічого", wrongMappingConflicts(found, raw, P1.id, P1.id), []);
}

/* ── resolveBarcode ───────────────────────────────────────────────────── */
console.log("── resolveBarcode ──");

function stubDeps(overrides = {}) {
  const calls = { resolve: [], fetch: [], search: [], similar: [], off: [] };
  const deps = {
    configured: true,
    online: () => true,
    resolveIdentifiers: async (...args) => {
      calls.resolve.push(args.slice(0, 4));
      return overrides.hits ?? [];
    },
    fetchProductsByIds: async (ids) => {
      calls.fetch.push([...ids]);
      const all = overrides.products ?? [];
      return all.filter((p) => [...ids].includes(p.id));
    },
    searchProducts: async (...args) => {
      calls.search.push(args.slice(0, 3));
      return overrides.search?.(args[0]) ?? [];
    },
    similarReceiptNames: async (...args) => {
      calls.similar.push(args.slice(0, 3));
      return overrides.similar ?? [];
    },
    lookupOff: async (ean) => {
      calls.off.push(ean);
      return overrides.off?.[ean] ?? null;
    },
    ...overrides.deps,
  };
  return { deps, calls };
}

{
  const { deps, calls } = stubDeps({ deps: { configured: false } });
  const res = await resolveBarcode(EAN, deps);
  check("локальний режим: via none без RPC", [res.via, res.ean, calls.resolve.length, calls.fetch.length], ["none", EAN, 0, 0]);
}
{
  const { deps, calls } = stubDeps();
  const res = await resolveBarcode("CODE128-ABC", deps);
  check("не EAN: ean null, без запитів", [res.via, res.ean, calls.resolve.length], ["none", null, 0]);
}
{
  const { deps, calls } = stubDeps({ deps: { online: () => false, cache: { products: { [P1.id]: P1 }, eanIndex: { [EAN]: P1.id } } } });
  const res = await resolveBarcode(EAN, deps);
  check("кеш офлайн: товар одразу, без запиту й без revalidate", [res.via, res.product?.id, res.from, calls.resolve.length, typeof res.revalidate], ["ean", P1.id, "cache", 0, "undefined"]);
}
{
  const { deps } = stubDeps({ deps: { online: () => false } });
  check("офлайн без кешу: offline", pick(await resolveBarcode(EAN, deps), ["via", "error"]), { via: "none", error: "offline" });
}
{
  const hit = hitOf("ean", EAN, { productId: P1.id });
  const { deps, calls } = stubDeps({ hits: [hit], products: [P1] });
  const res = await resolveBarcode(EAN, deps);
  check("база: товар", [res.via, res.product?.id, res.typeKey, res.hit?.identifierId, calls.resolve[0]], ["ean", P1.id, "moloko_bezlaktozne", "id-ean", [[EAN], [], null, null]]);
}
{
  const hit = hitOf("ean", EAN, { typeKey: "moloko" });
  const { deps } = stubDeps({ hits: [hit], off: { [EAN]: { typeKey: "moloko_bezlaktozne", name: "Молоко безлактозне", guessed: ["type"], source: "off", provenance: { from: "off", ean: EAN } } } });
  const res = await resolveBarcode(EAN, deps);
  check("база: лише тип, OFF уточнює назву й різновид", [res.via, res.typeKey, res.product, res.draft?.name, res.draft?.guessed], ["ean", "moloko_bezlaktozne", undefined, "Молоко безлактозне", ["type"]]);
}
{
  const { deps } = stubDeps({ hits: [hitOf("ean", EAN, { typeKey: "moloko_zguschene" })] });
  const res = await resolveBarcode(EAN, deps);
  check("база знає лише тип, OFF мовчить: картка не каже «ніхто не знає»", res.draft?.provenance, { from: "scan", ean: EAN, known: "type", label: "Згущене молоко" });
}
{
  const { deps } = stubDeps({ off: { [EAN]: { typeKey: "kefir", name: "Кефір", guessed: ["type"], source: "off", provenance: { from: "off", ean: EAN } } } });
  const res = await resolveBarcode(EAN, deps);
  check("промах → OFF: лише підказка", [res.via, res.suggestion, res.draft?.name], ["none", { typeKey: "kefir", from: "off" }, "Кефір"]);
}
{
  const { deps } = stubDeps();
  const res = await resolveBarcode(EAN, deps);
  check("промах без OFF: порожня чернетка скану", [res.via, res.draft], ["none", { typeKey: "", name: "", guessed: [], provenance: { from: "scan", ean: EAN, known: "none" } }]);
}
{
  const { deps } = stubDeps({ deps: { resolveIdentifiers: async () => { throw new CatalogError("offline", "Немає звʼязку"); } } });
  check("база не відповіла: код помилки", pick(await resolveBarcode(EAN, deps), ["via", "error"]), { via: "none", error: "offline" });
}

/* ── resolveReceipt ───────────────────────────────────────────────────── */
console.log("── resolveReceipt ──");

const EAN2 = "4823096413518";
const receipt = {
  store: "ТОВ «АТБ-МАРКЕТ»",
  lines: [
    { name: "МолокГалБезл900", qty: 2, code: EAN }, // EAN і назва → той самий товар
    { name: "Мол950УлГаличБЛак2.5", qty: 1, code: EAN2 }, // EAN → P2, назва → P1: сперечаються
    { name: "ІмбирКг", qty: 0.07, measure: "кг" }, // назва → лише тип
    { name: "Масл180МолСолод73", qty: 1 }, // нічого не знаємо → підказка з пошуку
    { name: "ШокБатКрем45", qty: 1 }, // зовсім невідоме
    { name: "Пакет майка", qty: 1 }, // не їжа
  ],
};
const receiptHits = [
  hitOf("ean", EAN, { productId: P1.id }),
  hitOf("receipt_name", "МолокГалБезл900", { productId: P1.id }),
  hitOf("ean", EAN2, { productId: P2.id }),
  hitOf("receipt_name", "Мол950УлГаличБЛак2.5", { productId: P1.id }),
  hitOf("receipt_name", "ІмбирКг", { typeKey: "imbyr" }),
];

{
  const { deps, calls } = stubDeps({ deps: { configured: false } });
  const res = await resolveReceipt(receipt, "qr", deps);
  check("чек у локальному режимі: без RPC, усе via none", [calls.resolve.length, res.lines.every((l) => l.resolution.via === "none")], [0, true]);
}
{
  const { deps, calls } = stubDeps({
    hits: receiptHits,
    products: [P1, P2],
    search: (q) => (q.startsWith("Вершкове масло") ? [P3] : []),
  });
  const { lines, products, error } = await resolveReceipt(receipt, "qr", deps);
  const [milk, conflict, ginger, butter, unknown, bag] = lines;

  check("один запит: EAN, назви їжі, продавець і мережа", calls.resolve, [[
    [EAN, EAN2],
    ["МолокГалБезл900", "Мол950УлГаличБЛак2.5", "ІмбирКг", "Масл180МолСолод73", "ШокБатКрем45"],
    "ТОВ «АТБ-МАРКЕТ»",
    "atb",
  ]]);
  check("без помилки, картки для кешу", [error, products.map((p) => p.id).sort()], [undefined, [P1.id, P2.id, P3.id].sort()]);

  check("впізнаний товар: упаковка × кількість", pick(milk, ["typeKey", "amount", "unit", "checked"]), { typeKey: "moloko_bezlaktozne", amount: 1.8, unit: "l", checked: true });
  check("впізнаний товар: hit і product", [milk.resolution.via, milk.product?.id, milk.resolution.eanConflict], ["ean", P1.id, undefined]);

  check("EAN перемагає назву, рядок без галочки", [conflict.resolution.via, conflict.product?.id, conflict.resolution.eanConflict?.target, conflict.checked], ["ean", P2.id, { productId: P1.id }, false]);

  check("ціль-тип → рядок типу, вагове як на касі", pick(ginger, ["typeKey", "product", "amount", "unit", "checked"]), { typeKey: "imbyr", product: undefined, amount: 70, unit: "g", checked: true });
  check("ціль-тип: via назва", ginger.resolution.via, "receipt_name");

  check("підказка: з галочкою, але не впізнано", [butter.resolution.via, butter.resolution.suggestion?.from, butter.resolution.suggestion?.product?.id, butter.product, butter.checked], ["none", "search", P3.id, undefined, true]);
  check("підказка: кількість із назви, а не з підказаного товару", [butter.typeKey, butter.amount, butter.unit], ["maslo", 180, "g"]);
  check("пошук у родині типу", calls.search.find((c) => c[0].startsWith("Вершкове"))?.[1]?.includes("maslo"), true);

  check("невідоме — без галочки", [unknown.resolution.via, unknown.typeKey, unknown.checked], ["none", undefined, false]);
  check("не їжа — без галочки й без запиту", [bag.nonFood, bag.checked], [true, false]);
  check("OFF лише для рядків із дійсним EAN, які не впізнали", calls.off, []);
}
{
  // Фото: без EAN, «схожі назви» дають підказку.
  const photo = { store: "АТБ", lines: [{ name: "Молоко безлакт. Галичина 2.5 % 900 г", qty: 1 }] };
  const { deps, calls } = stubDeps({
    products: [P1],
    similar: [{ raw: "Молоко безлакт. Галичина 2.5 % 900 г", identifierId: "s1", value: "молокобезлактгаличина2.5%900г", similarity: 0.9, productId: P1.id }],
  });
  const { lines } = await resolveReceipt(photo, "photo", deps);
  check("фото: EAN не шлемо, мережа та сама", calls.resolve[0].slice(0, 1).concat(calls.resolve[0].slice(3)), [[], "atb"]);
  check("фото: «схоже на» — підказка, не впізнано", [lines[0].resolution.via, lines[0].resolution.suggestion?.from, lines[0].resolution.suggestion?.product?.id, lines[0].checked], ["none", "similar", P1.id, true]);
  check("фото: схожі назви з продавцем і мережею", calls.similar[0], [["Молоко безлакт. Галичина 2.5 % 900 г"], "АТБ", "atb"]);
}
{
  // Дві хвилі (B2.2): знайомі товари не чекають на повільний OFF.
  let releaseOff;
  const offGate = new Promise((resolve) => { releaseOff = resolve; });
  const { deps } = stubDeps({
    hits: receiptHits,
    products: [P1, P2],
    deps: { lookupOff: async () => { offCalls++; await offGate; return null; } },
  });
  let offCalls = 0;
  // Невідомий рядок із дійсним EAN — саме його OFF дочитує повільно.
  const withUnknownEan = { ...receipt, lines: [...receipt.lines, { name: "ЧайЗел100", qty: 1, code: "5449000000996" }] };
  let early = null;
  let offDone = false;
  let finished = false;
  const pending = resolveReceipt(withUnknownEan, "qr", deps, (res) => {
    early = { offDone, ids: res.lines.map((l) => l.id), products: res.products.map((p) => p.id).sort(), via: res.lines.map((l) => l.resolution.via) };
  });
  pending.then(() => { finished = true; });
  // Даємо мікрозадачам бази відпрацювати; OFF ще не відповів.
  for (let i = 0; i < 20 && (!early || offCalls === 0); i++) await new Promise((r) => setTimeout(r, 0));
  check("OFF справді ще думає, а відповіді ще немає", [normalizeEan("5449000000996") !== null, offCalls > 0, finished], [true, true, false]);
  check("збіги віддано до відповіді OFF, лише рядки зі збігом і їхні картки", early, {
    offDone: false,
    ids: ["0:МолокГалБезл900", "1:Мол950УлГаличБЛак2.5", "2:ІмбирКг"],
    products: [P1.id, P2.id].sort(),
    via: ["ean", "ean", "receipt_name"],
  });
  offDone = true;
  releaseOff();
  const final = await pending;
  check("фінальна відповідь — усі рядки, як і раніше", final.lines.length, withUnknownEan.lines.length);
}
{
  const { deps } = stubDeps({ deps: { resolveIdentifiers: async () => { throw new CatalogError("rate_limit", "Забагато"); } } });
  const res = await resolveReceipt(receipt, "qr", deps);
  check("збій запиту: евристика й код помилки", [res.error, res.lines[2].typeKey, res.lines[2].resolution.via], ["rate_limit", "imbyr", "none"]);
}
check("draftReceiptLines: ключі як у receiptDrafts", draftReceiptLines(receipt, "qr").map((l) => l.id).slice(0, 2), ["0:МолокГалБезл900", "1:Мол950УлГаличБЛак2.5"]);
check("draftReceiptLines: ваговий рядок фото без міри — у кг", pick(draftReceiptLines({ lines: [{ name: "ІмбирКг", qty: 0.25 }] }, "photo")[0], ["amount", "unit"]), { amount: 250, unit: "g" });

/* ── Сповіщення про строки ────────────────────────────────────────────── */
console.log("── expiryMessage ──");

const custom = new Map([["own_kombucha_ab12", "Комбуча домашня"]]);
const productNames = new Map([[P1.id, P1.name]]);
check("назва: картка товару", expiryRowName({ ingredient_key: "moloko", expires_at: "2026-09-14", product_id: P1.id, label: "Щось" }, { products: productNames }), P1.name);
check("назва: власна мітка", expiryRowName({ ingredient_key: "teriyaki", expires_at: "2026-09-14", label: "Teriyaki Sauce" }), "Teriyaki Sauce");
check("назва: касовий рядок", expiryRowName({ ingredient_key: "moloko", expires_at: "2026-09-14", receipt_name: "Мол950УлГаличБЛак2.5" }), "Молоко безлактозне Галичина 2,5%");
check("назва: own_* з дописаних", expiryRowName({ ingredient_key: "own_kombucha_ab12", expires_at: "2026-09-14", receipt_name: "КомбучаДом" }, { customLabels: custom }), "Комбуча домашня");
check("назва: вбудований тип", expiryRowName({ ingredient_key: "vershky", expires_at: "2026-09-14" }), "Вершки");

const today = "2026-09-13";
const rowsOf = (n) => [
  { expires_at: "2026-09-14", name: "Кефір" },
  { expires_at: today, name: "Молоко безлактозне Галичина" },
  ...Array.from({ length: n - 2 }, (_, i) => ({ expires_at: "2026-09-14", name: `Продукт ${i}` })),
];
check("один рядок, завтра", expiryMessage([{ expires_at: "2026-09-14", name: "Вершки" }], today), {
  title: "Вершки: псується завтра",
  body: "Зазирни в комору — можливо, саме з нього щось вийде.",
});
check("найтерміновіше в заголовку", expiryMessage(rowsOf(2), today).title, "Молоко безлактозне Галичина — сьогодні останній день");
for (const [rest, word] of [[1, "продукт"], [2, "продукти"], [5, "продуктів"], [11, "продуктів"], [21, "продукт"], [22, "продукти"]]) {
  check(`І ще ${rest}`, expiryMessage(rowsOf(rest + 1), today).body, `І ще ${rest} ${word} на черзі. Зазирни, що з них приготувати.`);
}
check("порожньо — порожньо", expiryMessage([], today), { title: "", body: "" });

/* ── Шар даних: рядки бази, чек, сканер, ціна, замок версії ─────────────── */
console.log("── Рядок комори ↔ база ──");
{
  const api = await load("src/lib/supabase/api.ts");
  const row = {
    id: "11111111-1111-4111-8111-111111111111", user_id: "owner-a", ingredient_key: "moloko",
    product_id: "22222222-2222-4222-8222-222222222222", label: null, receipt_name: "Мол950УлГаличБЛак2.5",
    amount: "1.9", unit: "l", qty: null, barcode: null, added_at: "2026-09-13T09:00:00+00:00",
    expires_at: "2026-09-20", price_per_gram: "0.05", updated_at: "2026-09-13T10:00:00+00:00",
  };
  const item = api.rowToPantryItem(row);
  check("з бази: id, власник, картка, касовий рядок, числа", pick(item, ["id", "ownerId", "productId", "receiptName", "amount", "pricePerGram", "label"]), {
    id: row.id, ownerId: "owner-a", productId: row.product_id, receiptName: row.receipt_name, amount: 1.9, pricePerGram: 0.05, label: undefined,
  });
  const back = api.pantryToRow("editor-b", item);
  check("у базу: власник лишається власником, усі колонки на місці, без updated_at", [back.user_id, back.receipt_name, "updated_at" in back, Object.keys(back).length], ["owner-a", row.receipt_name, false, 13]);
  check("у базу: не-uuid картка → null", api.pantryToRow("u", { ...item, productId: "local-draft" }).product_id, null);
  check("PANTRY_SELECT — id, власник, картка, касовий рядок", ["id", "user_id", "product_id", "receipt_name", "updated_at"].every((c) => api.PANTRY_SELECT.split(",").includes(c)), true);
  check("legacy-id не uuid", [api.isUuid("legacy:moloko"), api.isUuid(row.id)], [false, true]);
  const def = api.rowToIngredient({ key: "own_x", label: "Х", emoji: "", cat: "dairy", aliases: null, staple: false, grams_per_piece: "30", grams_per_cup: null, default_unit: "g", kcal: null, protein: null, fat: null, carbs: null, parent_key: "kefir", version: 7, merged_into: "own_y" });
  check("дописаний тип: версія, батько, псевдонім, числа", pick(def, ["version", "parent", "mergedInto", "gramsPerPiece", "nutrition"]), { version: 7, parent: "kefir", mergedInto: "own_y", gramsPerPiece: 30, nutrition: undefined });
  check("CUSTOM_INGREDIENT_SELECT — з версією й merged_into", ["parent_key", "version", "merged_into"].every((c) => api.CUSTOM_INGREDIENT_SELECT.split(",").includes(c)), true);
  check("старих записів barcode_cache в api немає", ["cacheBarcode", "saveBarcodeCard", "fetchCachedBarcode", "deletePantryItem"].filter((n) => n in api), []);
}

console.log("── Чек: уточнення типу підказками ──");
{
  const { receiptDrafts, lookupableBarcode } = await load("src/lib/receipt.ts");
  const lines = [
    { name: "Молоко Галичина lactose free 1л", qty: 2, measure: "шт" },
    { name: "ІмбирКг", qty: 0.07, measure: "кг" },
    { name: "Пакет майка", qty: 1 },
  ];
  const plain = receiptDrafts(lines);
  const hinted = receiptDrafts(lines, productHints);
  check("без підказок — як раніше", [plain[0].ingredient?.key, plain[0].hints], ["moloko", undefined]);
  check("з підказками — безлактозне", hinted[0].ingredient?.key, "moloko_bezlaktozne");
  check("упаковка з назви × кількість", [hinted[0].amount, hinted[0].unit], [2, "l"]);
  check("ваговий — як на касі", [hinted[1].ingredient?.key, hinted[1].amount, hinted[1].unit], ["imbyr", 70, "g"]);
  check("нехарчове — без підказок", [hinted[2].nonFood, hinted[2].hints], [true, undefined]);
  check("код чека: EAN через normalizeEan", [lookupableBarcode("4820000000017"), lookupableBarcode("4820000000000"), lookupableBarcode("АРТ-12345670")], ["4820000000017", null, null]);
}

console.log("── Сканер: стара форма відповіді ──");
{
  const barcode = await load("src/lib/barcode.ts");
  check("без бекенду — локальний режим", barcode.catalogDeps().configured, false);
  check("бренди з кешу", barcode.cachedBrands({ [P1.id]: P1, x: { ...P1, id: "x", brand: "Молокія" } }).sort(), ["Галичина", "Молокія"].sort());
  const known = barcode.productInfoFromResult("4820000000017", { via: "ean", ean: "4820000000017", product: P1, typeKey: P1.typeKey });
  check("відома картка → community з назвою й упаковкою", pick(known, ["name", "source", "amount", "unit"]), { name: P1.name, source: "community", amount: P1.packAmount, unit: P1.packUnit });
  const typeOnly = barcode.productInfoFromResult("4820000000017", {
    via: "ean", ean: "4820000000017", typeKey: "moloko_zguschene",
    hit: { kind: "ean", raw: "4820000000017", identifierId: "i", scope: "", target: { typeKey: "moloko_zguschene" }, version: 1 },
  });
  check("лише тип → community, тип відомий", [typeOnly.source, typeOnly.ingredient?.key], ["community", "moloko_zguschene"]);
  check("невідомий код → unknown «Товар …»", pick(barcode.productInfoFromResult("123", { via: "none", ean: null }), ["name", "source"]), { name: "Товар 123", source: "unknown" });
}

console.log("── Ціна з карткою товару ──");
{
  const cost = await load("src/lib/cost.ts");
  check("2 шт пачки 900 мл за 90 ₴ — 0,05 ₴/г", cost.priceFromPurchase("moloko", 2, "pcs", 90, P1), 0.05);
  const dish = { id: "d", ingredients: [{ key: "moloko", amount: 900, unit: "ml" }], servings: 1 };
  const pantry = [{ id: "r", key: "moloko", productId: P1.id, amount: 1, unit: "pcs", addedAt: "2026-09-13T09:00:00Z", pricePerGram: 0.05 }];
  check("вартість страви зі штучним рядком картки", cost.recipeCost(dish, pantry, { [P1.id]: P1 })?.total, 45);
}

console.log("── Замок версії: читання каталогу під банером ──");
{
  const sv = await load("src/lib/schema-version.ts");
  check("CLIENT_SCHEMA = 3 (I2–I6 одним деплоєм)", sv.CLIENT_SCHEMA, 3);
  const SB = "https://x.supabase.co/rest/v1/rpc/";
  for (const fn of ["search_products", "resolve_identifiers", "community_history", "similar_receipt_names", "receipt_name_key", "normalize_ean"]) {
    check(`читання ${fn} — не запис`, sv.isDatabaseWrite(`${SB}${fn}`, "POST"), false);
  }
  for (const fn of ["save_product", "teach_identifiers", "restore_community_version", "join_family", "search_products_evil"]) {
    check(`${fn} — запис`, sv.isDatabaseWrite(`${SB}${fn}`, "POST"), true);
  }
}

console.log(`\n${pass} пройдено, ${fail} впало`);
process.exit(fail ? 1 : 0);
