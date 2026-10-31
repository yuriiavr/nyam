#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Меню закладів для щоденника: сирі джерела → src/data/restaurants/*.ts.
 *
 * Запуск: node scripts/build-restaurants.mjs <тека-з-джерелами>
 *
 * У теці (у репозиторій не кладемо — це просто завантажене):
 *
 *   lviv-croissants/menu.html   https://lvivcroissants.com/ua/menu/ як є.
 *   kfc/nutrition.pdf           PDF зі сторінки https://www.kfc.ua/nutritional-values
 *                               («Харчова_Азійська лінійка» — попри назву, це все меню).
 *   kfc/kfc-table.txt           Необовʼязково: `pdftotext -table -enc UTF-8 nutrition.pdf
 *                               kfc-table.txt` (xpdf 4; є в Git for Windows). Немає —
 *                               скрипт сам спробує запустити pdftotext.
 *   mcdonalds/mcdonalds-ua.txt  Вивантаження з калькулятора
 *                               https://www.mcdonalds.com/ua/uk-ua/eat/nutrition_calculator.html.
 *                               Сайт не пускає скрипти (403), тож вивантажуємо з
 *                               відкритої сторінки: MCD_EXPORT нижче — у консоль браузера,
 *                               результат — у файл.
 *
 * Перевірка кожної позиції: 4·Б + 9·Ж + 4·В має сходитися з ккал (±20 % і ще
 * 15 ккал на округлення). Що не сходиться — не мовчки: або позиція є в REVIEW
 * з поясненням, що ми з нею робимо, або скрипт падає зі списком. Позиції без
 * офіційних чисел не вигадуємо — виключаємо й показуємо в звіті.
 *
 * Ключ страви (`key`) — сталий: з нього рахується id запису в щоденнику
 * (src/data/restaurants/index.ts). Змінився ключ — старі записи втратять
 * звʼязок зі стравою (самі записи й калорії лишаться).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "src/data/restaurants");

/**
 * Вивантаження McDonald's: виконати в консолі на сторінці калькулятора.
 * Бере список позицій зі сторінки й КБЖВ — з того ж API, що й сам калькулятор.
 */
export const MCD_EXPORT = `
const d = JSON.parse(document.querySelector('.cmp-nutrition-calculator').getAttribute('data-product-data'));
const ids = [...new Set(d.categoryList.flatMap((c) => c.productId))];
const items = {};
for (let i = 0; i < ids.length; i += 25) {
  const q = ids.slice(i, i + 25).map((x) => x + '()').join('-');
  const j = await (await fetch('/dnaapp/itemList?country=UA&language=uk&showLiveData=true&nutrient_req=Y&item=' + q)).json();
  for (const it of [].concat(j.items.item)) {
    const n = {};
    for (const x of it.nutrient_facts?.nutrient || []) n[x.nutrient_name_id] = [x.value, x.uom];
    items[it.item_id] = { name: it.item_name, n };
  }
}
const g = (x, k) => { const v = x.n[k]?.[0]; return typeof v === 'object' ? JSON.stringify(v) : v; };
const lines = d.categoryList.map((c) => '@' + c.title + '=' + c.productId.join(','));
for (const [id, x] of Object.entries(items)) lines.push([id, d.products[id]?.title, x.name, g(x, 'primary_serving_size'),
  x.n.primary_serving_size?.[1], ...['energy_kJ', 'energy_kcal', 'fat', 'НЖК', 'carbohydrate', 'Цукор', 'protein', 'salt'].map((k) => g(x, k))].join('|'));
copy(lines.join('\\n') + '\\n');
`;

/* ── Спільне ──────────────────────────────────────────────────────────── */

/** «4,5» і «<0,5» → число. «<0,5» — менше пів грама: пишемо 0. */
function num(raw) {
  const s = String(raw).trim().replace(",", ".");
  if (s.startsWith("<")) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Мінімум знаків після коми, але без втрат: 212.70 → 212.7, 4.42557692 → 4.43. */
const tidy = (n) => (n == null ? null : Math.round(n * 100) / 100);

function macroCheck(d) {
  if (d.protein == null || d.fat == null || d.carbs == null) return { ok: true, est: null };
  const est = 4 * d.protein + 9 * d.fat + 4 * d.carbs;
  return { ok: Math.abs(est - d.kcal) <= 0.2 * d.kcal + 15, est: Math.round(est) };
}

const UK_LATIN = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch",
  ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", "'": "", "ʼ": "", "’": "",
};

/** Латинський slug для ключа: «Круасан з лососем» → «kruasan-z-lososem». */
function slug(text) {
  return [...text.toLowerCase()]
    .map((c) => UK_LATIN[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const CYR = "А-ЯІЇЄҐа-яіїєґ";

/**
 * «ТАУЕР БУРГЕР гострий» → «Тауер бургер гострий». Латинські слова лишаються
 * як є («BERRY WHITE»), з великої — початок і те, що в лапках. Латинська «I»
 * посеред кирилиці («ЧIЗБУРГЕР») — це «І», інакше слово сприйметься латиницею.
 */
function sentenceCase(text) {
  const fixed = text.replace(new RegExp(`(?<=[${CYR}])I|I(?=[${CYR}])`, "g"), "І");
  const out = fixed
    .split(/(\s+|\+)/)
    .map((w) => (new RegExp(`[${CYR}]`).test(w) && !/[A-Za-z]/.test(w) ? w.toLocaleLowerCase("uk") : w))
    .join("");
  return out.replace(/(^|\s["«“])(\p{Ll})/gu, (_, pre, ch) => pre + ch.toLocaleUpperCase("uk"));
}

const clean = (s) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();

/* ── Львівські круасани ───────────────────────────────────────────────── */

/**
 * Сайт дає лише вагу порції й ккал на 100 г — Б/Ж/В не публікує зовсім.
 * Тож тут лише калорії; напої без ккал виключаємо.
 */
function lvivCroissants(dir, report) {
  const html = fs.readFileSync(path.join(dir, "lviv-croissants/menu.html"), "utf8");
  const decode = (s) =>
    clean(
      s
        .replace(/<[^>]+>/g, " ")
        .replace(/&#0?39;|&#8217;|&rsquo;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#8211;/g, "–")
        .replace(/&nbsp;/g, " "),
    );

  const tabs = [...html.matchAll(/id="category-(\d+)-tab"[^>]*>\s*([^<]+?)\s*<\/button>/g)].map((m) => ({
    n: m[1],
    title: decode(m[2]),
  }));
  const categories = [];
  for (const tab of tabs) {
    const start = html.indexOf(`id="category-${tab.n}" role="tabpanel"`);
    if (start < 0) throw new Error(`Львівські круасани: немає вкладки ${tab.title}`);
    const next = html.indexOf('<div class="tab-pane', start + 10);
    const pane = html.slice(start, next < 0 ? undefined : next);
    const name = { "КРУАСАНИ СЕНДВІЧІ": "Круасани-сендвічі" }[tab.title] ?? sentenceCase(tab.title);
    const dishes = [];
    for (const block of pane.split('class="product-block').slice(1)) {
      const title = decode(block.match(/block-title">([\s\S]*?)<\/div>/)?.[1] ?? "");
      const cal = decode(block.match(/block-calories">([\s\S]*?)<\/div>/)?.[1] ?? "");
      const m = cal.match(/^(\d+(?:[.,]\d+)?)\s*(г|мл)\s*\|\s*(\d+(?:[.,]\d+)?)\s*ккал\s*\/\s*100\s*(г|мл)$/);
      if (!m) {
        report.excluded.push({ r: "lviv-croissants", name: title, why: cal ? `немає ккал («${cal}»)` : "немає ккал" });
        continue;
      }
      const amount = num(m[1]);
      const kcal100 = num(m[3]);
      dishes.push({
        key: slug(title),
        name: title,
        amount,
        unit: m[2] === "мл" ? "ml" : "g",
        kcal: Math.round((amount * kcal100) / 100),
        protein: null,
        fat: null,
        carbs: null,
        per100: { kcal: kcal100, protein: null, fat: null, carbs: null },
      });
    }
    if (dishes.length) categories.push({ name, dishes });
  }
  return categories;
}

/* ── KFC ──────────────────────────────────────────────────────────────── */

/** Розділи PDF → наші категорії. Однакова назва — один розділ у меню. */
const KFC_SECTIONS = [
  [/^БУРГЕРИ\/BURGERS/, "Бургери"],
  [/^ТОРТИЛЬЇ\/TORTILLAS$/, "Тортильї й шаурма"],
  [/^ДОДАТКОВИЙ ІНГРЕДІЄНТ/, "Додатки й соуси до страв"],
  [/^ВЕДЖІ МЕНЮ/, "Веджі"],
  [/^МЕНЮ\/MEALS$/, "Комбо з картоплею"],
  [/^СОКОВИТА Н[IІ]ЖКА/, "Ніжки"],
  [/^КУРЯЧІ КРИЛЬЦЯ/, "Крильця"],
  [/^СТРІПСИ З КУРЯЧОГО ФІЛЕ/, "Стріпси"],
  [/^НАГЕТСИ/, "Нагетси"],
  [/^БАКЕТИ\/BUCKETS$/, "Бакети"],
  [/^БАКЕТИ ТІЛЬКИ НА ДОСТАВКУ/, "Бакети на доставку"],
  [/^ЛОКАЛЬНІ НОВИНКИ/, "Новинки"],
  [/^ГАРНІРИ/, "Гарніри"],
  [/^ЛАНЧ БОКС\/LUNCH BOX$/, "Ланч бокси"],
  [/^НА ВИБІР ГОСТЯ ДО ЛАНЧ БОКСУ$/, "До ланч боксу на вибір"],
  [/^СНЕКИ/, "Снеки"],
  [/^САЛАТ\/SALAD$/, "Салати"],
  [/^СОУСИ\//, "Соуси"],
  [/^ХОЛОДНІ НАПОЇ/, "Холодні напої"],
  [/^ПИВО\/BEER$/, "Пиво й сидр"],
  [/^ГАРЯЧІ НАПОЇ/, "Гарячі напої"],
  [/^ДЕСЕРТИ\/DESSERTS$/, "Десерти"],
  [/^МОРОЗИВО\/ICE CREAM$/, "Морозиво"],
];

/** Сніданки в PDF ідуть без заголовка — розділ починаємо з першої позиції. */
const KFC_SECTION_STARTS = [
  [/^СНІДАНКОВИЙ БУРГЕР\/BREAKFAST BURGER$/, "Сніданки"],
  [/^СНІДАНКОВИЙ БУРГЕР\+КАРТОПЛЯ/, "Комбо з картоплею"],
];

/** Шапка таблиці й примітки внизу — не назви. */
const KFC_IGNORE = [/^4\.1868$/, /^Вихід/, /^продукта,/, /^weight, g\/ml/, /^fats,g$/, /^\* RI/, /^Ми виготовляємо/];

/**
 * Назва вручну: джерело дало англійську, без «/», з одруківкою чи обрізало
 * рядок; власні назви (пиво, вода) — з великої. Числа звідси не беруться.
 */
const KFC_NAMES = {
  "AMERICANO COFFEE WITH BANANA MILK стандартна": "Кава американо на банановому молоці стандартна",
  "МОРОЗИВО З ТОПІНГОМ шоколад ICE CREAM WITH chocolate TOPPING": "Морозиво з топінгом шоколад",
  "КАША ВІВСЯНА (БЕЗ НАПОВНЮВАЧА) НА БАНАНОВОМУ": "Каша вівсяна (без наповнювача) на банановому молоці",
  КАРПОПЛЯНИК: "Картопляник",
  "КАВА КАПУЧНИНО стандартна": "Кава капучино стандартна",
  "КАВА КАПУЧНИНО НА БАНАНОВОМУ МОЛОЦІ стандартна": "Кава капучино на банановому молоці стандартна",
  "КРАНЧ ШЕЙК ШОКОЛАДИЙ": "Кранч шейк шоколадний",
  "КРАНЧ ШЕЙК ШОКОЛАДИЙ спешл": "Кранч шейк шоколадний спешл",
  "СНІДАНКОВИЙ БУРГЕР ГОСТРИ": "Сніданковий бургер гострий",
  "ПЕПСІ- КОЛА рефіл 0,4 л": "Пепсі-Кола рефіл 0,4 л",
  "КИСЛО- СОЛОДКИЙ соус": "Кисло-солодкий соус",
  'МІНЕРАЛЬНА ВОДА "Карпатська Джерельна" газована/ негазована, пляшка 0,5 л':
    "Мінеральна вода «Карпатська Джерельна» газована / негазована, 0,5 л",
  "БАКЕТ КОЛОМИЯ": "Бакет «Коломия»",
  "ПИВО КАРЛСБЕРГ": "Пиво «Карлсберг»",
  "ПИВО КАРЛСБЕРГ З/Б": "Пиво «Карлсберг» з/б",
  'ПИВО "КРОНЕНБУРГ 1664 БЛАНК"': "Пиво «Кроненбург 1664 Бланк»",
  'ПИВО "КРОНЕНБУРГ БЛАНК 1664 БЛАНК" З/Б': "Пиво «Кроненбург 1664 Бланк» з/б",
  'ПИВО "ЛЬВІВСЬКЕ РІЗДВЯНЕ"': "Пиво «Львівське Різдвяне»",
  'ПИВО "ЛЬВІВСЬКЕ РІЗДВЯНЕ" З/Б': "Пиво «Львівське Різдвяне» з/б",
  'ПИВО ПРАВДА "LVIV IPA" З/Б': "Пиво «Правда Lviv IPA» з/б",
  'ПИВО ПРАВДА "LVIV PILSNER " З/Б': "Пиво «Правда Lviv Pilsner» з/б",
  'ПИВО ПРАВДА "LVIV STOUT " З/Б': "Пиво «Правда Lviv Stout» з/б",
  'СИДР "СОМЕРСБІ"': "Сидр «Сомерсбі»",
};

/**
 * Рядки PDF, яким не віримо, — за назвою й вагою порції. Числа не правимо:
 * просто не показуємо.
 */
const KFC_SKIP = {
  "Кава лате велика|220": "друга «велика» лате на 220 мл (є й на 400 мл) з іншими числами — незрозуміло, що це за позиція",
};

const KFC_ROW = /^(.*?)\s{2,}(\d+(?:[.,]\d+)?)\s?(г|Г|мл)\s+(\S+(?:\s+\S+){7})\s*$/;

function kfcTable(dir) {
  const txt = path.join(dir, "kfc/kfc-table.txt");
  if (!fs.existsSync(txt)) {
    execFileSync("pdftotext", ["-table", "-enc", "UTF-8", path.join(dir, "kfc/nutrition.pdf"), txt]);
  }
  return fs.readFileSync(txt, "utf8");
}

function kfc(dir, report) {
  const lines = kfcTable(dir)
    .split(/\r?\n/)
    .map((l) => l.replace(/\f/g, ""))
    .filter((l) => l.trim());

  const rows = [];
  let section = null;
  let pending = "";
  let current = null; // позиція, що чекає рядка «100 г»

  for (const line of lines) {
    const text = clean(line);
    if (KFC_IGNORE.some((re) => re.test(text))) continue;
    const header = KFC_SECTIONS.find(([re]) => re.test(text));
    if (header) {
      section = header[1];
      pending = "";
      current = null;
      continue;
    }
    const m = line.match(KFC_ROW);
    if (!m) {
      // Продовження назви: між рядками позиції або латиниця/дужки після неї.
      if (current) current.raw += " " + text;
      else if (/^[A-Za-z(]/.test(text) && rows.length) rows[rows.length - 1].raw += " " + text;
      else pending = pending ? `${pending} ${text}` : text;
      continue;
    }
    const lead = clean(m[1]);
    const amount = num(m[2]);
    const unit = m[3] === "мл" ? "ml" : "g";
    const values = m[4].split(/\s+/);
    const [, kcal, fat, , carbs, , protein] = values.map(num);
    const nutrition = { kcal, protein, fat, carbs };
    if (current && amount === 100) {
      if (lead) current.raw += " " + lead;
      current.per100 = nutrition;
      current = null;
      continue;
    }
    const raw = clean(`${pending} ${lead}`);
    pending = "";
    const start = KFC_SECTION_STARTS.find(([re]) => re.test(raw));
    if (start) section = start[1];
    current = { raw, section, amount, unit, ...nutrition, per100: null, values };
    rows.push(current);
  }

  const categories = [];
  const usedNames = new Set();
  for (const r of rows) {
    const [ukRaw, enRaw = ""] = r.raw.split(/\s*\/\s*(?=[A-Za-z“"«(0-9])/);
    const uk = clean(ukRaw).replace(/БОКСМАЙТЕР/g, "БОКСМАЙСТЕР");
    if (KFC_NAMES[uk]) usedNames.add(uk);
    const name = KFC_NAMES[uk] ?? sentenceCase(uk);
    // «LUNCH BOX (бургер+фрі мала)» — українська приписка в англійській частині ключа не потрібна.
    const en = clean(enRaw.split(/\s*\/\s*/)[0].replace(new RegExp(`\\([^)]*[${CYR}][^)]*\\)`, "g"), ""));
    if (!r.section) throw new Error(`KFC: позиція без розділу: ${r.raw}`);
    const skip = KFC_SKIP[`${name}|${r.amount}`];
    if (skip) {
      report.excluded.push({ r: "kfc", name, why: skip });
      continue;
    }
    if ([r.kcal, r.protein, r.fat, r.carbs].some((v) => v == null)) {
      report.excluded.push({ r: "kfc", name, why: `не розібрати числа: ${r.values.join(" ")}` });
      continue;
    }
    const p = r.per100;
    const dish = {
      key: slug(en || name),
      name,
      amount: r.amount,
      unit: r.unit,
      kcal: tidy(r.kcal),
      protein: tidy(r.protein),
      fat: tidy(r.fat),
      carbs: tidy(r.carbs),
      ...(p ? { per100: { kcal: tidy(p.kcal), protein: tidy(p.protein), fat: tidy(p.fat), carbs: tidy(p.carbs) } } : {}),
    };
    let cat = categories.find((c) => c.name === r.section);
    if (!cat) categories.push((cat = { name: r.section, dishes: [] }));
    cat.dishes.push(dish);
  }
  for (const uk of Object.keys(KFC_NAMES)) {
    if (!usedNames.has(uk)) console.warn(`KFC: назва з KFC_NAMES не трапилась у PDF: ${uk}`);
  }
  return categories;
}

/* ── McDonald's ───────────────────────────────────────────────────────── */

/** Позиція в кількох розділах калькулятора — беремо перший за цим порядком. */
const MCD_ORDER = [
  "Сніданок",
  "Бургери та роли",
  "Курка",
  "Картопля, каша та салати",
  "Кава",
  "Напої",
  "Десерти",
  "Соуси",
  "Топінги та сиропи",
];
/**
 * Картопля фрі є й у «Сніданку», але шукати її будуть серед картоплі.
 * Креветки калькулятор показує лише в «МакМеню» — кладемо до курки.
 */
const MCD_CATEGORY = {
  200051: "Картопля, каша та салати",
  200052: "Картопля, каша та салати",
  200053: "Картопля, каша та салати",
  200478: "Курка",
};
const MCD_NAMES = {
  "Бургери та роли": "Бургери й роли",
  Курка: "Курка й креветки",
  "Картопля, каша та салати": "Картопля, каша й салати",
  "Топінги та сиропи": "Топінги й сиропи",
};

function mcdonalds(dir, report) {
  const lines = fs
    .readFileSync(path.join(dir, "mcdonalds/mcdonalds-ua.txt"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  const groups = new Map();
  const items = [];
  for (const line of lines) {
    if (line.startsWith("@")) {
      const [title, ids] = line.slice(1).split("=");
      groups.set(title, ids.split(","));
      continue;
    }
    const [id, title, , amount, uom, , kcal, fat, , carbs, , protein] = line.split("|");
    items.push({ id, title, amount, uom, kcal, fat, carbs, protein });
  }

  const categories = MCD_ORDER.map((name) => ({ name: MCD_NAMES[name] ?? name, dishes: [] }));
  // Порядок позицій — як у калькуляторі всередині розділу.
  const position = new Map();
  for (const [title, ids] of groups) ids.forEach((id, i) => !position.has(`${title}:${id}`) && position.set(`${title}:${id}`, i));

  const placed = [];
  for (const it of items) {
    const name = clean(it.title.replace(/[®™]/g, ""));
    const values = [it.kcal, it.protein, it.fat, it.carbs].map(num);
    if (values.some((v) => v == null)) {
      report.excluded.push({ r: "mcdonalds", name, why: `калькулятор не дає КБЖВ (${it.kcal})` });
      continue;
    }
    const group = MCD_CATEGORY[it.id] ?? MCD_ORDER.find((g) => groups.get(g)?.includes(it.id));
    if (!group) {
      report.excluded.push({ r: "mcdonalds", name, why: "лише в розділах-наборах (Хеппі Міл, МакМеню)" });
      continue;
    }
    const [kcal, protein, fat, carbs] = values.map(tidy);
    placed.push({
      group,
      order: position.get(`${group}:${it.id}`) ?? 999,
      dish: {
        key: it.id,
        name,
        amount: num(it.amount),
        // Вода в калькуляторі має «г» на 250 мл — одиниця з назви розділу важить менше.
        unit: it.uom.startsWith("мл") ? "ml" : "g",
        kcal,
        protein,
        fat,
        carbs,
      },
    });
  }
  placed.sort((a, b) => MCD_ORDER.indexOf(a.group) - MCD_ORDER.indexOf(b.group) || a.order - b.order);
  for (const p of placed) categories[MCD_ORDER.indexOf(p.group)].dishes.push(p.dish);
  return categories.filter((c) => c.dishes.length);
}

/* ── Огляд того, що не сходиться ──────────────────────────────────────── */

const BEER = {
  action: "keep",
  note: "Більшість калорій пива дає алкоголь (7 ккал/г), а його в Б/Ж/В немає.",
};

/**
 * Позиції, де 4·Б + 9·Ж + 4·В не сходиться з ккал, — переглянуті вручну.
 * Ключ — «заклад:ключ страви».
 *
 * keep — числа офіційні, розбіжність пояснена; `note` іде в дані, і
 *   застосунок показує її біля страви.
 * per100 — рядок порції в PDF зіпсований, а рядок «на 100 г» сходиться і
 *   дає ті самі ккал на порцію: Б/Ж/В = на 100 г × вага. З приміткою.
 * exclude — офіційні числа суперечать самі собі, і котре правильне, не
 *   знаємо: краще не показати, ніж показати хибне.
 */
const REVIEW = {
  "mcdonalds:200059": {
    action: "exclude",
    why: "Б/Ж/В ті самі, що в малого соку (300 мл), а ккал — від великого (450 мл): числа суперечать",
  },
  "kfc:street-beat-shake-spin": {
    action: "exclude",
    why: "жири (21 г на порцію, 23,8 г на 100 г) не сходяться з ккал ні в рядку порції, ні в рядку на 100 г",
  },
  "kfc:cheesy-spicy-triangles": {
    action: "per100",
    note: "У PDF у рядку порції стовпці зсунуті; Б/Ж/В пораховано з рядка «на 100 г» того ж PDF (ккал збігаються).",
  },
  "kfc:green-tea-with-mango": {
    action: "keep",
    note: "У джерелі 6 ккал, хоча 5,3 г вуглеводів — це ≈21 ккал. Різниця невелика, лишаємо як є.",
  },
  "kfc:carlsberg-beer": BEER,
  "kfc:carlsberg-beer-can": BEER,
  "kfc:kronenburg-1664-blank-beer": BEER,
  "kfc:kronenburg-1664-blank-beer-can": BEER,
  "kfc:lvivske-rizdvyane-beer": BEER,
  "kfc:lvivske-rizdvyane-beer-can": BEER,
  "kfc:pravda-lviv-ipa-beer-can": BEER,
  "kfc:pravda-lviv-pilsner-beer-can": BEER,
  "kfc:pravda-lviv-stout-beer-can": BEER,
  "kfc:somersby-cider": { ...BEER, note: "Більшість калорій сидру дає алкоголь (7 ккал/г), а його в Б/Ж/В немає." },
};

/* ── Запис ────────────────────────────────────────────────────────────── */

const RESTAURANTS = [
  { id: "mcdonalds", build: mcdonalds, constName: "MCDONALDS_MENU" },
  { id: "kfc", build: kfc, constName: "KFC_MENU" },
  { id: "lviv-croissants", build: lvivCroissants, constName: "LVIV_CROISSANTS_MENU" },
];

const FIELDS = ["key", "name", "amount", "unit", "kcal", "protein", "fat", "carbs", "per100", "note"];

/** Один рядок обʼєкта в стилі репозиторію: `{ key: "…", kcal: 526 }`. */
function literal(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const keys = Object.keys(value).sort((a, b) => FIELDS.indexOf(a) - FIELDS.indexOf(b));
  return `{ ${keys.map((k) => `${k}: ${literal(value[k])}`).join(", ")} }`;
}

/** Емодзі запису в щоденнику — за розділом меню. */
function emojiOf(category) {
  const c = category.toLowerCase();
  const rules = [
    [/сніданок|сніданки/, "🍳"],
    [/тортил|шаурм/, "🌯"],
    [/бургер|комбо|ланч/, "🍔"],
    [/курк|ніжк|крил|стріпс|нагетс|бакет/, "🍗"],
    [/картопл|гарнір|снек/, "🍟"],
    [/салат|веджі/, "🥗"],
    [/соус|додатк|топінг/, "🥫"],
    [/кава|гаряч/, "☕"],
    [/пиво/, "🍺"],
    [/напо/, "🥤"],
    [/десерт|морозиво/, "🍦"],
    [/круасан/, "🥐"],
  ];
  return rules.find(([re]) => re.test(c))?.[1] ?? "🍽️";
}

function writeMenu(r, categories) {
  const body = categories
    .map((c) => {
      const dishes = c.dishes.map((d) => `        ${literal(d)},`).join("\n");
      return [
        "    {",
        `      name: ${JSON.stringify(c.name)},`,
        `      emoji: ${JSON.stringify(emojiOf(c.name))},`,
        "      dishes: [",
        dishes,
        "      ],",
        "    },",
      ].join("\n");
    })
    .join("\n");
  const file = `// Згенеровано scripts/build-restaurants.mjs — руками не правити, а перезібрати.
import type { RestaurantMenu } from "./types";

export const ${r.constName}: RestaurantMenu = {
  categories: [
${body}
  ],
};
`;
  fs.writeFileSync(path.join(OUT, `${r.id}.ts`), file);
}

/**
 * Однакові назви в межах закладу: той самий рядок двічі — лишаємо один;
 * різні порції («Соус часниковий» до страви й окремий стакан) — обидва, з
 * вагою в назві й ключі.
 */
function dedupe(r, categories, report) {
  const byName = new Map();
  for (const c of categories) for (const d of c.dishes) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
  const drop = new Set();
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const kept = [];
    for (const d of list) {
      const twin = kept.find((k) => ["amount", "kcal", "protein", "fat", "carbs"].every((f) => k[f] === d[f]));
      if (twin) {
        drop.add(d);
        report.excluded.push({ r: r.id, name, why: "той самий рядок у джерелі ще раз" });
      } else kept.push(d);
    }
    if (kept.length > 1) {
      for (const d of kept) {
        d.name = `${name} · ${String(d.amount).replace(".", ",")} ${d.unit === "ml" ? "мл" : "г"}`;
        d.key = `${d.key}-${d.amount}`;
      }
    }
  }
  for (const c of categories) c.dishes = c.dishes.filter((d) => !drop.has(d));
}

const dir = process.argv[2];
if (!dir) {
  console.error("Вкажи теку з джерелами: node scripts/build-restaurants.mjs <тека>");
  process.exit(1);
}

const report = { excluded: [], reviewed: [], unreviewed: [], per100: [] };
const outputs = [];
for (const r of RESTAURANTS) {
  const categories = r.build(dir, report);
  dedupe(r, categories, report);
  for (const c of categories) {
    c.dishes = c.dishes.filter((d) => {
      const check = macroCheck(d);
      if (check.ok) return true;
      const id = `${r.id}:${d.key}`;
      const review = REVIEW[id];
      const line = { r: r.id, key: d.key, name: d.name, kcal: d.kcal, est: check.est, p: d.protein, f: d.fat, c: d.carbs, amount: d.amount };
      if (!review) {
        report.unreviewed.push(line);
        return false;
      }
      report.reviewed.push({ ...line, ...review });
      if (review.action === "exclude") {
        report.excluded.push({ r: r.id, name: d.name, why: review.why });
        return false;
      }
      if (review.action === "per100") {
        const k = d.amount / 100;
        d.protein = tidy(d.per100.protein * k);
        d.fat = tidy(d.per100.fat * k);
        d.carbs = tidy(d.per100.carbs * k);
        if (!macroCheck(d).ok) throw new Error(`${id}: і з рядка на 100 г не сходиться`);
      }
      d.note = review.note;
      return true;
    });
    /*
     * Рядок «на 100 г», що не дає ккал порції, — не зберігаємо: котра з
     * цифр хибна (вага чи сам рядок), невідомо. Порція перевірена по Б/Ж/В
     * вище, її й пишемо в щоденник.
     */
    for (const d of c.dishes) {
      if (!d.per100 || !d.amount) continue;
      const fromPer100 = (d.per100.kcal * d.amount) / 100;
      if (Math.abs(fromPer100 - d.kcal) <= 0.05 * d.kcal + 3) continue;
      report.per100.push(`${r.id} · ${d.name}: ${d.amount} ${d.unit}, ${d.kcal} ккал, а на 100 г × вага = ${Math.round(fromPer100)}`);
      delete d.per100;
    }
  }
  // Різні назви з однаковим англійським ключем («Соус сирний» до страви й «Сирний соус» у стакані).
  const keys = new Set();
  for (const c of categories)
    for (const d of c.dishes) {
      if (keys.has(d.key)) d.key = `${d.key}-${d.amount}`;
      if (keys.has(d.key)) throw new Error(`${r.id}: ключ ${d.key} двічі`);
      keys.add(d.key);
    }
  const live = categories.filter((c) => c.dishes.length);
  outputs.push([r, live]);
}

for (const id of Object.keys(REVIEW)) {
  if (!report.reviewed.some((e) => `${e.r}:${e.key}` === id)) console.warn(`REVIEW: ${id} уже сходиться або зник — прибрати з REVIEW`);
}

if (report.unreviewed.length) {
  console.log(`НЕ ПЕРЕГЛЯНУТО (додай у REVIEW): ${report.unreviewed.length}`);
  for (const e of report.unreviewed)
    console.log(`  ${e.r}:${e.key} | ${e.name} | ${e.amount} | ${e.kcal} ккал, з БЖВ ${e.est} | Б ${e.p} Ж ${e.f} В ${e.c}`);
  process.exit(2);
}

for (const [r, live] of outputs) {
  writeMenu(r, live);
  const count = live.reduce((n, c) => n + c.dishes.length, 0);
  console.log(`${r.id}: ${count} позицій у ${live.length} розділах → src/data/restaurants/${r.id}.ts`);
}
console.log(`\nВиключено: ${report.excluded.length}`);
for (const e of report.excluded) console.log(`  ${e.r} · ${e.name} — ${e.why}`);
console.log(`\nНе сходиться, переглянуто (REVIEW): ${report.reviewed.length}`);
for (const e of report.reviewed) console.log(`  ${e.r}:${e.key} ${e.name} — ${e.kcal} ккал проти ${e.est} з БЖВ → ${e.action}`);
console.log(`\nРядок «на 100 г» не сходиться з порцією — його не зберігаємо: ${report.per100.length}`);
for (const line of report.per100) console.log(`  ${line}`);
