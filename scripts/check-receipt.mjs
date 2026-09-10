#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка розбору касового чека.
 *
 * Запуск: npm run check:receipt
 *
 * Мережі не потребує. XML унизу — справжня відповідь податкової на чек VARUS
 * від 29.04.2026, скорочена до товарів; назви решти рядків узяті з чеків
 * українських мереж. Перевіряємо саме те, що ламається найчастіше: касові
 * скорочення, вагу з назви й позиції, які до комори не мають стосунку.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  parseReceiptQr,
  receiptDateTime,
  parseCheckXml,
  normalizeReceiptLine,
  matchReceiptName,
  isNonFood,
  lineQuantity,
  packSize,
  lookupableBarcode,
} = await jiti.import(path.join(root, "src/lib/receipt.ts"));

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

console.log("── QR фіскального чека ──");

const qr = parseReceiptQr(
  "https://cabinet.tax.gov.ua/cashregs/check?date=20260429&time=222006&id=696582&sm=437.40&fn=3000909908",
);
check("розбір QR", qr, {
  fn: "3000909908",
  id: "696582",
  date: "20260429",
  time: "222006",
  sm: "437.40",
});
check("дата для податкової", receiptDateTime(qr), "2026-04-29 22:20:06");

// Час без секунд трапляється частіше, ніж з ними: у Положенні формат HHmm.
check(
  "час без секунд",
  parseReceiptQr("?date=20220904&time=1130&id=45&sm=780.00&fn=3000898168")?.time,
  "113000",
);

// Кома як роздільник суми — саме той випадок, коли податкова віддає порожньо.
check("сума з комою", parseReceiptQr("?date=20220904&time=1130&id=45&sm=780,00&fn=3000898168")?.sm, "780.00");

// Не чек: QR з реклами під камеру потрапляє так само легко, як фіскальний.
check("чужий QR", parseReceiptQr("https://example.com/promo?utm=qr"), null);
check("порожній QR", parseReceiptQr(""), null);

console.log("── Товари з checkXml ──");

/* Справжня відповідь податкової (чек ТОВ «ОМЕГА» / VARUS), лише теги товарів. */
const CHECK_XML = `<?xml version="1.0" encoding="windows-1251"?><RQ><DAT><C>
<P AT_TL="0" C="25" CD="4820000431026" N="5" NM="ВодаНегазованаМиргородська1,5" SM="2340" TX="1">
<P AT_TL="0" C="47" CD="5449000080806" N="6" NM="Напій Кока-Кола Зеро 1,75 л" SM="5890" TX="1">
<P AT_TL="0" C="1392" CD="250015026841" N="7" NM="Сендвіч з бужениною 210г, шт" SM="7990" TX="1">
<P AT_TL="0" AT_TM="шт" C="1178" CD="40084725" N="9" NM="Снек Кіндер Мілк Слайс 28г" PRC="2590" Q="2000" SM="5180" TX="1">
<P AT_TL="0" AT_TM="кг" C="88" CD="4820000000000" N="10" NM="Помідори чері 250г" PRC="8900" Q="548" SM="4877" TX="1">
<P AT_TL="0" C="87" CD="7622300275143" N="11" NM="Бісквіт молочний Барні 30г" SM="1670" TX="1">
</C></DAT></RQ>`;

const lines = parseCheckXml(CHECK_XML);
check("кількість товарів", lines.length, 6);

// Коли товар один, каса не пише ані Q, ані PRC — і це норма, а не збій.
check("товар без Q і PRC", lines[1], {
  name: "Напій Кока-Кола Зеро 1,75 л",
  qty: 1,
  measure: undefined,
  price: 58.9,
  sum: 58.9,
  code: "5449000080806",
});

check("дві штуки з ціною за штуку", lines[3], {
  name: "Снек Кіндер Мілк Слайс 28г",
  qty: 2,
  measure: "шт",
  price: 25.9,
  sum: 51.8,
  code: "40084725",
});

console.log("── Касова назва → інгредієнт ──");

const byName = (name, expected) => check(`«${name}»`, matchReceiptName(name)?.key ?? null, expected);

// Склеєні касою слова: без розділення великими літерами це одне слово.
check(
  "склеєна назва",
  normalizeReceiptLine("ВодаНегазованаМиргородська1,5"),
  "вода негазована миргородська",
);

// Скорочення з крапкою — друга за розміром втрата після склеєних слів.
byName("МОЛОКО ПАСТ.2,5% ГАЛИЧИНА 900Г", "moloko");
byName("Сир кисломол. 9% Яготинське 350г", "tvorog");
byName("ХЛІБ УКР.НАР.0,5КГ", "khlib");
byName("Сметана 20% 350г", "smetana");
byName("КЕФ.1% 450Г", "kefir");
byName("Помідори чері 250г", "pomidory_cherri");
byName("Огірки короткоплідні ваг.", "ogirok");
byName("Філе оселедця 250г", "oseledets");
byName("Сир Гауда 45% 200г", "syr");
byName("Яйця курячі С0 10шт", "yajtsya");

// Ознака не має перетягувати головне слово назви.
byName("Ковбаса Молочна ваг.", "kovbasa");
byName("С/К ковбаса Салямі 90г", "kovbasa");

// Ознака без іменника — це вже не той продукт: у бісквіті молока нема.
byName("Бісквіт молочний Барні 30г", null);
byName("Снек Кіндер Мілк Слайс 28г", null);

// Товару немає в каталозі — краще нічого, ніж навмання.
byName("Сендвіч з бужениною 210г, шт", null);

/*
 * Неоднозначні скорочення. «кеф.» веде рівно до кефіру, а от «печ.» — і до
 * печінки, і до печива; «гор.» — і до гороху, і до горіхів. Розкривати такі
 * не можна: колись саме на цьому вівсяне печиво ставало печінкою.
 */
byName("Печ.вівсяне 300г", null);
byName("Гор.шоколад 25г", "shokolad");
byName("Мор.морожена суміш", null);
byName("Слив.масло 200г", "maslo");

// Цифра 3 — це цифра, а не буква «з»: «300г» не має ставати «з00г».
check("цифри не гомогліфи", normalizeReceiptLine("Печиво вівсяне 300г"), "печиво вівсяне");

console.log("── Не їжа ──");

const nonFood = (name) => check(`«${name}» — не їжа`, isNonFood(name), true);
const food = (name) => check(`«${name}» — їжа`, isNonFood(name), false);

nonFood("Пакет майка 40х60");
nonFood("Корм для котів Whiskas з куркою 85г");
nonFood("Серветки вологі з ароматом лимона");
nonFood("Знижка на чек");
nonFood("Батарейки Duracell AA");
// Готова страва — їжа, але не інгредієнт: інакше сендвіч стає беконом.
nonFood("Сендвіч з беконом та скремблом 190г, шт");
nonFood("Піца Пепероні 350г");
// Скорочення не має ховати нехарчове: «Кор.» розкрилось би в «корінь».
nonFood("Кор.для собак 400г");
nonFood("Пор.для прання 3кг");
nonFood("Зуб.паста 75мл");
food("Крем-сир Філадельфія 175г");
food("Оцет бальзамічний 250мл");
food("Мед квітковий 400г");

console.log("── Скільки принесли ──");

check("вага з назви", packSize("МОЛОКО ПАСТ.2,5% 900Г"), { amount: 900, unit: "g" });
check("обʼєм з назви", packSize("Вода Моршинська 1,5л н/г"), { amount: 1.5, unit: "l" });
check("жирність — не вага", packSize("Сметана 20% 350г"), { amount: 350, unit: "g" });

/*
 * Лічильники в назві. Без них десяток яєць лягав у комору як «1 шт», а ціна
 * грама виходила вдесятеро більшою — і саме таке число потім показувалось у
 * вартості страви з виглядом перевіреного.
 */
check("десяток яєць", packSize("Яйця курячі С1 10шт"), { amount: 10, unit: "pcs" });
check("упаковка з чотирьох", packSize("Йогурт Активіа 4х115г"), { amount: 460, unit: "g" });
check("шість пляшок по 1,5 л", packSize("Вода Моршинська 1,5л 6шт"), { amount: 9, unit: "l" });
check("одна пачка лишається пачкою", packSize("МОЛОКО ПАСТ.2,5% 900Г"), { amount: 900, unit: "g" });
check(
  "два десятки",
  lineQuantity({ name: "Яйця курячі С1 10шт", qty: 2, measure: "шт" }),
  { amount: 20, unit: "pcs" },
);

// Ваговий товар: каса рахує в кілограмах, комора читає в грамах.
check(
  "0,548 кг",
  lineQuantity({ name: "Помідори чері", qty: 0.548, measure: "кг" }),
  { amount: 548, unit: "g" },
);

// Дві пачки — це вміст двох пачок, а не «дві штуки молока».
check(
  "2 шт × 900 г",
  lineQuantity({ name: "МОЛОКО ПАСТ.2,5% 900Г", qty: 2, measure: "шт" }),
  { amount: 1.8, unit: "kg" },
);

// Ані міри, ані ваги в назві — лишається рахувати штуками.
check(
  "без міри й ваги",
  lineQuantity({ name: "Сендвіч з бужениною", qty: 1 }),
  { amount: 1, unit: "pcs" },
);

console.log("── Код товару ──");

check("справжній EAN-13", lookupableBarcode("4820000431026"), "4820000431026");
check("справжній EAN-8", lookupableBarcode("40084725"), "40084725");
check("внутрішній код мережі", lookupableBarcode("2065509500008"), null);
check("артикул на 12 цифр", lookupableBarcode("250015026841"), null);
check("зіпсована контрольна цифра", lookupableBarcode("4820000431027"), null);

console.log(`\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
