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
  expandAbbreviation,
  foldHomoglyphs,
  lineQuantity,
  packSize,
  lookupableBarcode,
  geminiFailure,
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

/*
 * Форма запису буває різна, а чек той самий. Раніше будь-яке відхилення
 * давало мовчазний null: QR прочитано, а застосунок ніби нічого й не бачив.
 */
check(
  "великі літери в назвах",
  parseReceiptQr("?DATE=20260429&TIME=222006&ID=696582&SM=437.40&FN=3000909908")?.fn,
  "3000909908",
);
check(
  "роздільники в даті й часі",
  parseReceiptQr("?date=2026-04-29&time=22:20:06&id=696582&sm=437.40&fn=3000909908")?.time,
  "222006",
);
check(
  "номер документа з літерами",
  parseReceiptQr("?date=20260429&time=1130&id=A1-45&sm=780.00&fn=3000898168")?.id,
  "A1-45",
);
check(
  "сума без копійок",
  parseReceiptQr("?date=20260429&time=1130&id=45&sm=780&fn=3000898168")?.sm,
  "780",
);

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

/*
 * Різновид типу. «БЕЗЛАКТ.» розкривається однозначно, бо слово «безлактозне»
 * є в каталозі лише в безлактозного молока (фразою, не окремим синонімом), а
 * «б/лак» — касовий дріб. Звичайне пастеризоване лишається молоком.
 */
byName("МОЛОКО БЕЗЛАКТ.ГАЛИЧИНА 2,5% 900Г", "moloko_bezlaktozne");
byName("Молоко б/лак Галичина 2,5% 900г", "moloko_bezlaktozne");
byName("Молоко без лактози 2,5% 900г", "moloko_bezlaktozne");
check("«безлакт.» розкривається однозначно", expandAbbreviation("безлакт"), "безлактозне");
// Без крапки, зліплене з сусідами — так пише реальна каса.
byName("МолокГалБезл900", "moloko_bezlaktozne");
byName("Молок Гал Безл 900", "moloko_bezlaktozne");
// «Мол950Ул» не розібрати ні як молоко, ні як щось інше — такий рядок
// впізнається навчанням (назва з чека → товар), а тут лише «БЛак» розкрито.
check("«БЛак» розкрито", normalizeReceiptLine("Мол950УлГаличБЛак2.5").split(" ").includes("безлактозне"), true);
// Безлактозного кефіру в каталозі немає: лишається кефіром, а не молоком.
byName("КефірБезл", "kefir");
// «Безлюдна» чи «безладно» цілим словом «безл» не є — нічого не розкриваємо.
check("«безл» лише цілим словом", normalizeReceiptLine("Вода Безлюдна 1,5"), "вода безлюдна");
check("латинська «o» у кириличному слові", foldHomoglyphs("молокo"), "молоко");

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
// «Лак» ловить лак для волосся, але не лактозу: безлактозне молоко — їжа.
nonFood("Лак для волосся 250мл");
food("Молоко без лактози");
food("МОЛОКО БЕЗЛАКТ.ГАЛИЧИНА 2,5% 900Г");

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

console.log("── Відмова розпізнавання фото ──");

/*
 * Те, що людина прочитає після невдалого фото. Раніше все, крім 429, ставало
 * «спробуй за кілька хвилин» — зокрема й відкликаний ключ, який сам не мине.
 */
const google = (code, status, message, reason) =>
  JSON.stringify({
    error: {
      code,
      status,
      message,
      details: reason
        ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com" }]
        : undefined,
    },
  });
const failure = (what, status, body, expected) =>
  check(what, geminiFailure(status, body).reason, expected);

// Справжня відповідь, яку віддавав відкликаний ключ у вересні 2026.
const revoked = google(
  401,
  "UNAUTHENTICATED",
  "The bound service account is deleted or disabled. The service account bound to the API key must be active.",
  "ACCOUNT_STATE_INVALID",
);
failure("відкликаний ключ", 401, revoked, "misconfigured");
check(
  "у журналі видно, що саме з ключем",
  geminiFailure(401, revoked).cause.includes("UNAUTHENTICATED/ACCOUNT_STATE_INVALID"),
  true,
);
failure(
  "недійсний ключ — 400, а не 401",
  400,
  google(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", "API_KEY_INVALID"),
  "misconfigured",
);
failure(
  "API вимкнене в проєкті",
  403,
  google(403, "PERMISSION_DENIED", "Generative Language API has not been used in project 1", "SERVICE_DISABLED"),
  "misconfigured",
);
failure(
  "модель зникла",
  404,
  google(404, "NOT_FOUND", "models/gemini-3.1-flash-lite is not found for API version v1beta"),
  "misconfigured",
);
// Запит не пасує до моделі — так 3.5 відповідає на thinkingBudget. Теж не мине саме.
failure(
  "поле, якого модель не знає",
  400,
  google(400, "INVALID_ARGUMENT", "Unable to submit request because thinking_budget is not supported by this model."),
  "misconfigured",
);
// Скарга на саму картинку — тут новий знімок справді допоможе.
failure(
  "картинка не відкрилась",
  400,
  google(400, "INVALID_ARGUMENT", "Unable to process input image. Please retry or report in https://ai.google.dev"),
  "unreadable",
);
/*
 * 429 від Google — квота проєкту, а не спроби людини, тож «throttled» («забагато
 * спроб») тут не буває ніколи. Тексти — у форматі, яким Gemini відповідає на
 * вичерпану квоту: «limit: 0» стоїть далеко за двохсотим символом.
 */
const quota = (metric, limit, quotaId, { details = true } = {}) =>
  JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message:
        "You exceeded your current quota, please check your plan and billing details. For more " +
        "information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. " +
        "To monitor your current usage, head to: https://ai.dev/usage?tab=rate-limit. \n" +
        `* Quota exceeded for metric: generativelanguage.googleapis.com/${metric}, limit: ${limit}, ` +
        "model: gemini-3.1-flash-lite\nPlease retry in 41.7s.",
      details: details
        ? [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                {
                  quotaMetric: `generativelanguage.googleapis.com/${metric}`,
                  quotaId,
                  quotaDimensions: { location: "global", model: "gemini-3.1-flash-lite" },
                  ...(limit === 0 ? {} : { quotaValue: String(limit) }),
                },
              ],
            },
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "41s" },
          ]
        : undefined,
    },
  });
failure(
  "хвилинна квота — мине сама, людина не винна",
  429,
  quota("generate_content_free_tier_requests", 15, "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"),
  "upstream",
);
failure(
  "хвилинна квота на токени — теж мине",
  429,
  quota("generate_content_paid_tier_input_token_count", 4000000, "GenerateContentInputTokensPerModelPerMinute"),
  "upstream",
);
// Новий ключ із проєкту без оплати: моделі безкоштовно не дають зовсім.
failure(
  "квота з нулем — налаштування, а не черга",
  429,
  quota("generate_content_free_tier_requests", 0, "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"),
  "misconfigured",
);
failure(
  "квота з нулем без деталей — видно лише з тексту",
  429,
  quota("generate_content_free_tier_requests", 0, "", { details: false }),
  "misconfigured",
);
failure(
  "добова квота вичерпана — до завтра не мине",
  429,
  quota("generate_content_free_tier_requests", 1000, "GenerateRequestsPerDayPerProjectPerModel-FreeTier"),
  "misconfigured",
);
failure("квота без жодних подробиць", 429, google(429, "RESOURCE_EXHAUSTED", "Quota exceeded"), "upstream");
check(
  "у журналі видно, що це квота",
  geminiFailure(429, quota("generate_content_free_tier_requests", 0, "")).cause.startsWith("429 RESOURCE_EXHAUSTED"),
  true,
);
failure("збій у Google", 503, google(503, "UNAVAILABLE", "The model is overloaded."), "upstream");
failure("не JSON від балансувальника", 502, "<html>Bad Gateway</html>", "upstream");
failure("порожнє тіло", 500, "", "upstream");
failure("тіло null", 500, "null", "upstream");

console.log(`\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
