import { INGREDIENTS, findIngredient } from "@/data/ingredients";
import type { IngredientDef, Unit } from "./types";
import { sumQuantities, unitDef } from "./units";

/**
 * Касовий чек як джерело вмісту комори.
 *
 * Фотографувати чек і розпізнавати текст не треба: на кожному українському
 * фіскальному чеку є QR, а за ним податкова віддає той самий чек машинним
 * XML — з назвами, кількостями й цінами. Тобто замість здогадок з термопаперу
 * ми маємо точні дані, і вся робота зводиться до двох речей: зіставити касову
 * назву з нашим каталогом і перевести касову міру в нашу.
 *
 * Модуль навмисно чистий: жодного React і жодного стану. Розбір XML потрібен
 * і на сервері (у проксі, бо податкова не віддає CORS), і в перевірках.
 */

/* ── QR фіскального чека ──────────────────────────────────────────────── */

/**
 * Параметри з QR — рівно те, чим чек шукається в податковій.
 *
 * Формат зафіксовано Положенням про форму розрахункових документів: QR веде
 * на cabinet.tax.gov.ua/cashregs/check?date=…&time=…&id=…&sm=…&fn=…
 */
export interface ReceiptQuery {
  /** Фіскальний номер каси: 3000… — класичний РРО, 4000… — ПРРО. */
  fn: string;
  /** Фіскальний номер самого чека. */
  id: string;
  /** Дата чека, yyyyMMdd. */
  date: string;
  /** Час чека, HHmmss. */
  time: string;
  /** Сума чека з крапкою: «437.40». */
  sm: string;
}

/**
 * Розбирає вміст QR-коду.
 *
 * null означає «це не фіскальний чек» — під камеру рівно так само потрапляє
 * QR з реклами, з платіжки чи з чужої візитівки, і мовчки піти з ним у
 * податкову було б безглуздо.
 */
export function parseReceiptQr(raw: string): ReceiptQuery | null {
  const text = raw.trim();
  if (!text) return null;

  const at = text.indexOf("?");
  const params = new URLSearchParams(at >= 0 ? text.slice(at + 1) : text);

  /*
   * Назви параметрів беремо без огляду на регістр: Положення закріплює
   * формат, але не те, якими літерами його друкують, і каси пишуть і «fn», і
   * «FN». Через це чек із великими літерами мовчки не розпізнавався взагалі.
   */
  const field = (name: string): string => {
    for (const [key, value] of params) {
      if (key.trim().toLowerCase() === name) return value.trim();
    }
    return "";
  };

  const fn = digits(field("fn"));
  const id = field("id").replace(/\s+/g, "");
  // Дату й час подекуди друкують із роздільниками: «2026-04-29», «22:20:06».
  const date = digits(field("date"));
  const time = digits(field("time"));
  const sum = field("sm").replace(",", ".");

  if (!/^\d{6,20}$/.test(fn)) return null;
  // Номер документа майже завжди числовий, але трапляються й літери.
  if (!/^[A-Za-z0-9-]{1,32}$/.test(id)) return null;
  if (!/^\d{8}$/.test(date)) return null;
  if (!/^\d{4,6}$/.test(time)) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(sum)) return null;

  // Секунди в QR є не завжди — податкова толерантна до них, але не до хвилини.
  return { fn, id, date, time: time.padEnd(6, "0"), sm: sum };
}

/** Лишає самі цифри: роздільники в даті й часі формату не псують. */
const digits = (value: string): string => value.replace(/\D+/g, "");

/** «20260429» + «222006» → «2026-04-29 22:20:06», як того чекає податкова. */
export function receiptDateTime(query: ReceiptQuery): string {
  const d = query.date;
  const t = query.time;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
}

/* ── Розбір чека ──────────────────────────────────────────────────────── */

/** Один товар у чеку — рівно так, як його записала каса. */
export interface ReceiptLine {
  /** Назва з каси: «Снек Кіндер Мілк Слайс 28г». */
  name: string;
  /** Кількість у мірі каси. Каса не пише її, коли товар один. */
  qty: number;
  /** Міра каси: «шт», «кг», «л». Порожньо — каса не вказала. */
  measure?: string;
  /** Ціна за одиницю, грн. */
  price?: number;
  /** Сума рядка, грн. */
  sum?: number;
  /** Код товару. У частини мереж це справжній EAN-13. */
  code?: string;
}

export interface Receipt {
  /** Продавець із шапки чека. */
  store?: string;
  lines: ReceiptLine[];
}

const XML_ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#")) {
      const num = code[1]?.toLowerCase() === "x"
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole;
    }
    return XML_ENTITY[code.toLowerCase()] ?? whole;
  });
}

const PRODUCT_TAG = /<P\s([^>]*?)\/?>/gu;
const ATTRIBUTE = /([A-Za-z_][\w-]*)="([^"]*)"/gu;

/**
 * Витягує товари з checkXml.
 *
 * Кожен товар — тег <P> з атрибутами: NM — назва, Q — кількість × 1000,
 * PRC — ціна за одиницю в копійках, SM — сума рядка, AT_TM — міра каси.
 *
 * Головна пастка: коли кількість дорівнює одиниці, атрибутів Q і PRC у чеку
 * просто немає — Положення вимагає їх лише тоді, коли кількість не одна.
 * Тому «немає Q» означає «рівно один», а не «невідомо».
 */
export function parseCheckXml(xml: string): ReceiptLine[] {
  const lines: ReceiptLine[] = [];

  for (const tag of xml.matchAll(PRODUCT_TAG)) {
    const attrs: Record<string, string> = {};
    for (const attr of tag[1].matchAll(ATTRIBUTE)) attrs[attr[1].toUpperCase()] = attr[2];

    const name = decodeXmlText(attrs.NM ?? "").trim();
    if (!name) continue;

    const int = (key: string): number | undefined => {
      const value = Number(attrs[key]);
      return Number.isFinite(value) ? value : undefined;
    };

    const rawQty = int("Q");
    const qty = rawQty != null && rawQty > 0 ? rawQty / 1000 : 1;
    const sumKop = int("SM");
    const priceKop = int("PRC");

    lines.push({
      name,
      qty,
      measure: decodeXmlText(attrs.AT_TM ?? "").trim() || undefined,
      price: priceKop != null ? priceKop / 100 : sumKop != null && qty === 1 ? sumKop / 100 : undefined,
      sum: sumKop != null ? sumKop / 100 : undefined,
      code: attrs.CD?.trim() || undefined,
    });
  }

  return lines;
}

/**
 * Назва продавця з текстової копії чека.
 *
 * У XML окремого поля для неї немає, а текстовий чек починається саме з неї —
 * «ТОВ «АШАН УКРАЇНА ГІПЕРМАРКЕТ»». Це підпис для списку позицій, тож коли
 * здогадка не вдалася, нічого страшного не стається.
 */
export function storeFromCheckText(text: string): string | undefined {
  for (const line of text.split(/\r?\n/, 6)) {
    const trimmed = line.trim();
    if (trimmed.length >= 3 && /\p{L}/u.test(trimmed)) return trimmed.slice(0, 80);
  }
  return undefined;
}

/* ── Касова назва → інгредієнт ────────────────────────────────────────── */

/**
 * Латинські двійники кирилиці.
 *
 * Каси й товарні бази пишуть назви руками, і «Молокo» з латинською «o»
 * трапляється частіше, ніж хотілося б. Для ока це те саме слово, для
 * порівняння рядків — різні, тож зводимо до кирилиці.
 */
const HOMOGLYPH: Record<string, string> = {
  a: "а", c: "с", e: "е", i: "і", o: "о", p: "р", x: "х", y: "у", k: "к",
  b: "ь", h: "н", m: "м", t: "т", u: "и",
};

const CYRILLIC = /\p{Script=Cyrillic}/u;

function foldHomoglyphs(token: string): string {
  // Чіпаємо лише мішанину: «milk» має лишитись латиницею, бо це синонім.
  if (!CYRILLIC.test(token) || !/[a-z]/.test(token)) return token;
  return token.replace(/[a-z]/g, (ch) => HOMOGLYPH[ch] ?? ch);
}

/** Скорочення через дріб, яких у каталозі немає й бути не може. */
const SLASH: Record<string, string> = {
  "с/к": "сирокопчена",
  "в/к": "варено-копчена",
  "х/к": "холодного копчення",
  "г/к": "гарячого копчення",
  "ф/п": "філе",
  "с/м": "заморожена",
  "н/г": "негазована",
  "с/г": "сильногазована",
  "т/м": "",
  "в/г": "",
  "п/е": "",
  "б/а": "",
};

/** Слова, які є на кожному другому чеку й нічого не кажуть про продукт. */
const NOISE = new Set([
  "тм", "шт", "уп", "упак", "упаковка", "пак", "пач", "ваг", "ваговий", "вагова",
  "акція", "акц", "пдв", "бонус", "новинка", "власна", "марка",
  "товар", "продукт", "код", "арт", "артикул", "гатунку", "ґатунку", "сорт",
  "вищого", "першого", "фас", "фасований", "фасовка", "лоток", "піддон",
]);

/**
 * Слова, після яких позицію в комору не несуть.
 *
 * Фільтр стоїть ПЕРЕД зіставленням, бо саме такі товари дають найгірші хибні
 * влучання: «Корм для котів з куркою» інакше стає куркою, «Серветки з
 * ароматом лимона» — лимоном, а «Сендвіч з беконом» — беконом.
 *
 * Готові страви тут не помилка: сендвіч чи піца — це їжа, але не інгредієнт.
 * У коморі вони не потрібні, бо з них нічого не готують.
 */
const NON_FOOD = [
  "пакет", "майка", "торба", "серветк", "туалетн", "рушник", "мило", "шампун",
  "зубн", "пральн", "миюч", "губк", "мішк", "сміттєв", "батарейк", "лампа",
  "запальничк", "сірник", "сигарет", "цигарк", "тютюн", "презерватив",
  "прокладк", "підгузк", "тампон", "бахіл", "рукавичк", "шкарпет", "зошит",
  "олівец", "клей", "скотч", "свічк", "корм", "наповнювач", "букет",
  "газета", "журнал", "картк", "поповненн", "послуг", "доставк", "оренд",
  "посуд", "стакан", "виделк", "трубочк", "фольг", "плівк", "освіжувач",
  "антисептик", "пластир", "бинт", "шприц", "дезодорант", "гель", "лак",
  "фарб", "засіб", "пелюшк", "іграшк", "знижка", "заокругленн", "решта",
  "пакування", "депозит",
  "сендвіч", "сандвіч", "бургер", "шаурм", "піц", "хот-дог", "хотдог", "суші", "ролл",
  "пранн", "прально", "собак", "котів", "кішок", "тварин", "цуцен", "кошен",
];

/** Нехарчове, яке впізнається лише парою слів, а не одним. */
const NON_FOOD_PAIRS = [["зуб", "паста"]];

/** Слово каталогу → продукти, у назвах яких воно трапляється. */
const CATALOG_WORDS: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const def of INGREDIENTS) {
    for (const raw of [def.label, ...(def.aliases ?? [])]) {
      for (const word of raw.toLowerCase().split(/[^\p{L}']+/u)) {
        if (word.length < 3) continue;
        const owners = map.get(word) ?? new Set<string>();
        owners.add(def.key);
        map.set(word, owners);
      }
    }
  }
  return map;
})();

/**
 * Розкриває скорочення з крапкою: «кисломол.» → «кисломолочний».
 *
 * Крапка на чеку означає рівно одне — слово обрізали, — тож шукаємо в
 * каталозі слово з таким початком. Але розкриваємо лише тоді, коли всі
 * знайдені слова ведуть до ОДНОГО продукту: «кеф.» — це завжди кефір, а от
 * «печ.» це і печінка, і печиво, і вгадування тут коштує дорого. Свого часу
 * саме на цьому «Печ.вівсяне» ставало печінкою, а «Гор.шоколад» — горохом.
 *
 * Дволітерні не чіпаємо взагалі: з «п.» чи «к.» починається пів каталогу.
 */
function expandAbbreviation(token: string): string {
  if (token.length < 3) return token;

  const owners = new Set<string>();
  let shortest: string | null = null;

  for (const [word, keys] of CATALOG_WORDS) {
    if (word.length <= token.length || !word.startsWith(token)) continue;
    for (const key of keys) owners.add(key);
    if (owners.size > 1) return token;
    if (!shortest || word.length < shortest.length) shortest = word;
  }

  return shortest ?? token;
}

/**
 * Чистить касову назву перед зіставленням.
 *
 * Каса пише «МОЛОКО ПАСТ.2,5% ГАЛИЧИНА 900Г»: капс, жирність, вага пакування
 * і скорочення в одному рядку. Каталог такого не знає, і без чистки зіставити
 * вдається приблизно три чверті рядків.
 */
export function normalizeReceiptLine(raw: string): string {
  return receiptTokens(raw, true).join(" ");
}

/**
 * Розбирає касову назву на слова.
 *
 * `expand` вмикає розкриття скорочень. Вимикати його потрібно там, де слово
 * важливе саме в тому вигляді, як його надрукувала каса: «Кор.для собак» при
 * розкритті стає «корінь», і фільтр нехарчового вже не бачить там корму.
 */
function receiptTokens(raw: string, expand: boolean): string[] {
  const text = raw
    /*
     * «ВодаНегазованаМиргородська1,5» — не вигадка, а реальний рядок із чека
     * VARUS. Каса зліплює слова, і без розділення великими літерами такий
     * рядок лишається одним нерозпізнаваним словом. Робимо це до зниження
     * регістру — потім межі вже не видно.
     */
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .replace(/[ʼ’`´]/g, "'")
    // Жирність і міцність: «2,5%» до продукту не додає нічого, а слова плутає.
    .replace(/\d+(?:[.,]\d+)?\s*%/gu, " ");

  const out: string[] = [];
  for (const chunk of text.split(/[^\p{L}\p{N}'.,/]+/u)) {
    if (!chunk) continue;

    /*
     * Крапка всередині — це склеєні скорочення: «укр.нар.0,5кг» каса пише
     * одним шматком. Ріжемо по ній, але памʼятаємо, за яким шматком крапка
     * стояла: саме вона й означає, що слово обрізали.
     */
    const pieces = chunk.split(".");
    pieces.forEach((piece, index) => {
      // Цифри й усе, що з них починається («900г», «0,5л»), — це кількість.
      // Її розбирає packSize, а зіставленню вона тільки заважає. Хвіст із
      // цифр відрізаємо з тієї ж причини: «Миргородська1,5» — це назва.
      if (/^[\d,]/.test(piece)) return;
      const token = foldHomoglyphs(piece.replace(/[\d.,]+$/u, "").trim());
      if (!token) return;

      if (token in SLASH) {
        if (SLASH[token]) out.push(SLASH[token]);
        return;
      }

      if (expand && index < pieces.length - 1) {
        /*
         * Обрізок, який не розкрився однозначно, у зіставленні не бере
         * участі взагалі. Інакше він бреше: «слив.» має ту саму основу, що
         * й «слива», і «Слив.масло» ставало сливами замість вершкового.
         * Виняток — коли обрізок сам є словом каталогу: «Сир.Гауда».
         */
        const expanded = expandAbbreviation(token);
        if (expanded === token && !CATALOG_WORDS.has(token)) return;
        if (NOISE.has(expanded)) return;
        out.push(expanded);
        return;
      }

      if (NOISE.has(token)) return;
      out.push(token);
    });
  }

  return out;
}

/**
 * Чи це взагалі їжа. Пакет, батарейки й рядок знижки в комору не несуть.
 *
 * Перевіряємо і розкриті слова, і те, що каса надрукувала насправді: після
 * розкриття «Кор.для собак» перетворюється на «корінь», і стоп-слово «корм»
 * у ньому вже не знайти.
 */
export function isNonFood(name: string): boolean {
  const words = [...receiptTokens(name, true), ...receiptTokens(name, false)];
  if (NON_FOOD.some((stop) => words.some((word) => word.startsWith(stop)))) return true;
  // Пари для слів, які поодинці означають їжу: «зуб» — це ще й зубатка.
  return NON_FOOD_PAIRS.some((pair) => pair.every((word) => words.includes(word)));
}

/** Закінчення ознак: «молочний», «сирний», «оливкова». */
const ADJECTIVE = ["ий", "ій", "ова", "ове", "ові"];

const isAdjective = (word: string) => ADJECTIVE.some((end) => word.endsWith(end));

/**
 * Зіставляє касову назву з каталогом — обережніше, ніж просто findIngredient.
 *
 * Причина в ознаках. У каталозі є синоніми-прикметники («молочний» для
 * молока), бо без них не зіставиться «Сік томатний». Але на чеку такий
 * прикметник часто описує зовсім інший товар: «Бісквіт молочний Барні» — це
 * не молоко, і класти 30 г молока в комору через слово «молочний» не можна.
 *
 * Тому збіг приймаємо, лише коли він спирається бодай на щось міцніше за
 * саму ознаку: на кілька слів разом, на головне слово назви або на іменник.
 */
export function matchReceiptName(name: string): IngredientDef | null {
  const text = normalizeReceiptLine(name);
  const found = findIngredient(text);
  if (!found) return null;

  const words = text.split(" ").filter(Boolean);
  const head = words[0];

  // Слова, які щось знаходять самі по собі. Порожньо — збіг тримається на
  // кількох словах разом, а це вже точний опис товару, а не випадковість.
  const alone = words.filter((word) => findIngredient(word) !== null);
  if (alone.length === 0) return found;

  if (head && findIngredient(head)) return found;
  return alone.some((word) => !isAdjective(word)) ? found : null;
}

/* ── Касова міра → наша кількість ─────────────────────────────────────── */

const MEASURE_UNIT: Record<string, Unit> = {
  кг: "kg", г: "g", гр: "g", грам: "g", л: "l", мл: "ml", шт: "pcs", уп: "pcs", пач: "pcs",
};

/** «4х115 г», «6 x 0,33 л» — упаковка з кількох однакових одиниць. */
const PACK_MULTI = /(\d+)\s*[xх×]\s*(\d+(?:[.,]\d+)?)\s*(кг|гр|г|мл|л)(?![\p{L}])/iu;

const PACK_SIZE = /(\d+(?:[.,]\d+)?)\s*(кг|гр|г|мл|л)(?![\p{L}])/iu;

/** «10 шт» у назві — це вміст упаковки, а не кількість покупок. */
const PACK_COUNT = /(\d+)\s*шт(?![\p{L}])/iu;

/**
 * Вага або обʼєм пакування з назви: «Молоко 900г» → 900 г.
 *
 * Потрібно тому, що каса рахує пачки, а комора — вміст: «2 шт» молока це
 * 1,8 л, а не «2 штуки молока», і рецепт із таким не звірити.
 */
export function packSize(name: string): { amount: number; unit: Unit } | null {
  const cleaned = name.replace(/\d+(?:[.,]\d+)?\s*%/gu, " ");

  // «4х115 г» — спершу, бо всередині є і звичайний розмір, і він менший.
  const multi = PACK_MULTI.exec(cleaned);
  if (multi) {
    const count = Number(multi[1]);
    const each = Number(multi[2].replace(",", "."));
    const unit = MEASURE_UNIT[multi[3].toLowerCase()];
    if (unit && count > 0 && each > 0) return tidy(count * each, unit);
  }

  const size = PACK_SIZE.exec(cleaned);
  const count = Number(PACK_COUNT.exec(cleaned)?.[1] ?? 0);

  if (size) {
    const amount = Number(size[1].replace(",", "."));
    const unit = MEASURE_UNIT[size[2].toLowerCase()];
    // «1,5 л 6 шт» — це шість пляшок, а не одна: інакше вода виходить
    // ушестеро дорожчою за кілограм, ніж коштувала.
    if (unit && amount > 0) return tidy(amount * (count > 1 ? count : 1), unit);
  }

  // Сам лічильник: «Яйця 10 шт» — це десяток, а не одна штука.
  if (count > 0) return { amount: count, unit: "pcs" };
  return null;
}

/**
 * Наводить кількість на людський вигляд: 0,548 кг → 548 г, 1500 мл → 1,5 л.
 *
 * Рахує це той самий код, що зводить кількості в списку покупок, — щоб
 * «півкіло» в коморі й «півкіло» в списку виглядали однаково.
 */
function tidy(amount: number, unit: Unit): { amount: number; unit: Unit } {
  const [summed] = sumQuantities([{ amount, unit }]);
  if (!summed || summed.amount == null) return { amount, unit };
  return { amount: Number(summed.amount.toFixed(unitDef(summed.unit).decimals)), unit: summed.unit };
}

/**
 * Скільки цього продукту принесли додому.
 *
 * Кілограми й літри каса рахує сама. Штуки — ні: там кількість пачок треба
 * помножити на вміст пачки, і саме тому вага з назви важливіша за міру каси.
 * «2 шт» молока — це 1,8 л, а з «двома штуками молока» жоден рецепт не звірити.
 */
export function lineQuantity(line: ReceiptLine): { amount: number; unit: Unit } | null {
  const measure = line.measure?.toLowerCase().replace(/\./g, "").trim();
  const unit = measure ? MEASURE_UNIT[measure] : undefined;
  const pack = packSize(line.name);

  if (unit && unit !== "pcs") return tidy(line.qty, unit);
  if (pack) return tidy(pack.amount * line.qty, pack.unit);
  if (line.qty > 0) return { amount: line.qty, unit: "pcs" };
  return null;
}

/* ── Код товару з чека ────────────────────────────────────────────────── */

/**
 * Чи має сенс шукати цей код у базі товарів.
 *
 * Частина мереж кладе в чек справжній EAN — тоді нерозпізнану назву рятує
 * той самий пошук, що й сканер штрихкодів. Але поруч у тому ж полі бувають
 * внутрішні артикули, і йти з ними в Open Food Facts безглуздо: коди, що
 * починаються з 2, зарезервовані під внутрішні потреби магазину, а решту
 * відсіює контрольна цифра.
 */
export function lookupableBarcode(code: string | undefined): string | null {
  if (!code || !/^\d+$/.test(code)) return null;
  if (code.length !== 13 && code.length !== 8) return null;
  if (code.startsWith("2")) return null;

  const digits = [...code].map(Number);
  const check = digits.pop() as number;
  // Множники чергуються, і в EAN-8 та EAN-13 ряд починається з різного боку.
  const weights = code.length === 13 ? [1, 3] : [3, 1];
  const sum = digits.reduce((acc, digit, i) => acc + digit * weights[i % 2], 0);
  return (10 - (sum % 10)) % 10 === check ? code : null;
}

/* ── Готова до підтвердження позиція ──────────────────────────────────── */

/** Рядок чека, зіставлений із каталогом, — те, що бачить людина перед «Додати». */
export interface ReceiptDraft {
  /** Стабільний ключ для React: у чеку бувають два однакові рядки. */
  id: string;
  line: ReceiptLine;
  ingredient: IngredientDef | null;
  /** Не їжа: пакет, батарейки, рядок знижки. */
  nonFood: boolean;
  amount?: number;
  unit?: Unit;
}

/**
 * Перетворює чек на список позицій для підтвердження.
 *
 * Нічого не додаємо мовчки: касова назва зіставляється з каталогом лише
 * приблизно, і остаточне рішення — за людиною, яка цей чек тримає в руках.
 */
export function receiptDrafts(lines: ReceiptLine[]): ReceiptDraft[] {
  return lines.map((line, index) => {
    const nonFood = isNonFood(line.name);
    const ingredient = nonFood ? null : matchReceiptName(line.name);
    const quantity = ingredient ? lineQuantity(line) : null;

    return {
      id: `${index}:${line.name}`,
      line,
      ingredient,
      nonFood,
      amount: quantity?.amount,
      unit: quantity?.unit,
    };
  });
}

/* ── Запит до нашого проксі ───────────────────────────────────────────── */

export type ReceiptFailure =
  | "notfound"
  | "noitems"
  | "upstream"
  | "offline"
  | "throttled"
  /** Розпізнавання фото не налаштоване: немає ключа Gemini. */
  | "nokey"
  /** Сесія протухла — фото читає платний сервіс, тож лише для своїх. */
  | "unauthorized"
  /** На фото не видно чека. */
  | "unreadable";

export type ReceiptResult =
  | { ok: true; receipt: Receipt }
  | { ok: false; reason: ReceiptFailure };

/**
 * Питає чек у податкової через власний маршрут.
 *
 * Через власний, бо cabinet.tax.gov.ua не віддає CORS-заголовків: прямий
 * запит із браузера впаде ще до відповіді. Ключів проксі не потребує —
 * ендпоїнт публічний, а доступ до чека дає сам чек: без точної суми,
 * хвилини й номера каси нічого не знайдеться.
 */
/**
 * Чек із фотографії — коли QR немає або він не читається.
 *
 * Повертає рівно те саме, що й пошук за QR, тож далі працює той самий код:
 * зіставлення касових назв, підтвердження людиною, запис у комору. Модель
 * лише замінює очі там, де в чека немає машинного коду.
 */
export async function readReceiptPhoto(
  image: string,
  token: string | null,
): Promise<ReceiptResult> {
  try {
    const res = await fetch("/api/receipt/photo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ image }),
      // Фото читається довше за запит до податкової: модель дивиться на
      // картинку, а не дістає готовий рядок із бази.
      signal: AbortSignal.timeout(55_000),
    });
    const json = (await res.json()) as ReceiptResult;
    if (!res.ok && !("reason" in json)) return { ok: false, reason: "upstream" };
    return json;
  } catch {
    return { ok: false, reason: "offline" };
  }
}

export async function fetchReceipt(query: ReceiptQuery): Promise<ReceiptResult> {
  const params = new URLSearchParams(query as unknown as Record<string, string>);

  try {
    const res = await fetch(`/api/receipt?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    });
    const json = (await res.json()) as ReceiptResult;
    if (!res.ok && !("reason" in json)) return { ok: false, reason: "upstream" };
    return json;
  } catch {
    return { ok: false, reason: "offline" };
  }
}
