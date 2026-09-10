import { ing } from "@/data/ingredients";
import type { RecipeIngredient, Unit } from "./types";

/**
 * Одиниці виміру для інгредієнтів.
 *
 * Навіщо структура замість рядка «200 г»: щоб список покупок міг додавати
 * однакове разом (200 г + 300 г = 500 г), а перерахунок на іншу кількість
 * порцій не залежав від регулярки по тексту.
 */

export interface UnitDef {
  key: Unit;
  label: string;
  /** Одиниця, до якої зводимо для сумування. null — не сумується. */
  base: Unit | null;
  /** Скільки базових одиниць в одній цій. */
  factor: number;
  /** Скільки знаків після коми має сенс показувати. */
  decimals: number;
}

export const UNITS: UnitDef[] = [
  { key: "g", label: "г", base: "g", factor: 1, decimals: 0 },
  { key: "kg", label: "кг", base: "g", factor: 1000, decimals: 2 },
  { key: "ml", label: "мл", base: "ml", factor: 1, decimals: 0 },
  { key: "l", label: "л", base: "ml", factor: 1000, decimals: 2 },
  { key: "pcs", label: "шт", base: "pcs", factor: 1, decimals: 1 },
  { key: "tbsp", label: "ст. л.", base: "tbsp", factor: 1, decimals: 1 },
  { key: "tsp", label: "ч. л.", base: "tsp", factor: 1, decimals: 1 },
  { key: "cup", label: "скл.", base: "cup", factor: 1, decimals: 2 },
  { key: "bunch", label: "пучок", base: "bunch", factor: 1, decimals: 1 },
  { key: "handful", label: "жменя", base: "handful", factor: 1, decimals: 1 },
  { key: "pinch", label: "дрібка", base: "pinch", factor: 1, decimals: 1 },
  // «За смаком» свідомо без бази: складати такі не можна й не треба.
  { key: "taste", label: "за смаком", base: null, factor: 1, decimals: 0 },
];

const BY_KEY = new Map(UNITS.map((u) => [u.key, u]));

export const unitDef = (unit: Unit): UnitDef => BY_KEY.get(unit) ?? UNITS[0];
export const unitLabel = (unit: Unit): string => unitDef(unit).label;

/** Одиниці, які має сенс пропонувати у формі рецепта, згруповані. */
export const UNIT_GROUPS: Array<{ title: string; units: Unit[] }> = [
  { title: "Вага", units: ["g", "kg"] },
  { title: "Обʼєм", units: ["ml", "l", "cup"] },
  { title: "Штуки", units: ["pcs", "bunch", "handful"] },
  { title: "Ложки", units: ["tbsp", "tsp", "pinch"] },
  { title: "Без міри", units: ["taste"] },
];

/* ── Форматування ─────────────────────────────────────────────────────── */

/** 1500 → «1,5»; 4 → «4». Кома, бо українською так пишуть. */
export function formatNumber(value: number, decimals = 2): string {
  if (!isFinite(value)) return "";
  const rounded = Number(value.toFixed(decimals));
  return String(rounded).replace(".", ",");
}

/** Готовий підпис на кшталт «200 г» або «за смаком». */
export function formatQuantity(amount: number | undefined, unit: Unit | undefined): string {
  if (!unit) return amount != null ? formatNumber(amount) : "";
  if (unit === "taste") return unitLabel(unit);
  if (amount == null) return unitLabel(unit);
  return `${formatNumber(amount, unitDef(unit).decimals)} ${unitLabel(unit)}`;
}

/**
 * Підпис кількості інгредієнта з урахуванням множника порцій.
 * Старі рецепти зберігали лише текст `qty` — його показуємо як є,
 * бо надійно масштабувати довільний рядок не вийде.
 */
export function ingredientQtyLabel(item: RecipeIngredient, factor = 1): string {
  const unit = resolveUnit(item);
  if (item.amount != null && unit) {
    return formatQuantity(scaleAmount(item.amount, unit, factor), unit);
  }
  if (unit === "taste") return unitLabel("taste");
  return scaleLegacyQty(item.qty, factor);
}

/**
 * Одиниця інгредієнта з підстраховкою.
 *
 * Якщо число є, а одиниці немає — беремо типову для цього продукту (молоко в
 * мл, яйця в штуках). Без цього кількість просто зникала б з екрана: показати
 * «150 мл» за замовчуванням чесніше, ніж не показати нічого.
 */
export function resolveUnit(item: RecipeIngredient): Unit | undefined {
  if (item.unit) return item.unit;
  if (item.amount == null) return undefined;
  return ing(item.key).defaultUnit ?? "g";
}

/**
 * Масштабує старий вільний рядок («200 г», «1/2 склянки») через перше число
 * в ньому. Менш надійно за структуровану кількість, але краще, ніж показати
 * рецепт на 2 порції як рецепт на 4.
 */
export function scaleLegacyQty(qty: string | undefined, factor: number): string {
  if (!qty) return "";
  if (factor === 1) return qty;
  return qty.replace(/(\d+(?:[.,]\d+)?)(\s*\/\s*(\d+))?/, (match, a: string, _frac, b: string) => {
    const num = b ? Number(a.replace(",", ".")) / Number(b) : Number(a.replace(",", "."));
    if (!isFinite(num)) return match;
    const scaled = num * factor;
    const rounded = scaled < 1 ? Math.round(scaled * 4) / 4 : Math.round(scaled * 10) / 10;
    return String(rounded).replace(".", ",");
  });
}

/** Масштабування з підйомом у більшу одиницю: 1500 г → лишається 1500 г. */
export function scaleAmount(amount: number, unit: Unit, factor: number): number {
  if (factor === 1) return amount;
  const scaled = amount * factor;
  // Дрібні значення округлюємо до чверті, щоб не було «0,3333 ч. л.».
  const def = unitDef(unit);
  if (scaled < 1 && def.decimals > 0) return Math.round(scaled * 4) / 4;
  return Number(scaled.toFixed(def.decimals));
}

/* ── Розбір старих рядків ─────────────────────────────────────────────── */

/**
 * Слова, які означають одиницю виміру.
 *
 * Класи символів — через \p{L}, а не \w: \w це тільки латиниця й цифри,
 * тож «щіпка», «жменя», «склянка» повз такий шаблон просто пролітали. Порядок має значення лише всередині
 * однакової довжини — довші варіанти («ст. л.») перевіряємо раніше за коротші.
 *
 * Побутові міри — «зубчик», «скибка», «стейк» — зводимо до штук: скільки
 * важить одна, знає довідник інгредієнтів (gramsPerPiece). Так «2 зубчики
 * часнику» стають 6 г, а не зникають з підрахунку.
 */
const ALIASES: Array<[RegExp, Unit]> = [
  [/^(кг|kg|кілограм\p{L}*)$/iu, "kg"],
  [/^(г|гр|g|грам\p{L}*)$/iu, "g"],
  [/^(мл|ml|мілілітр\p{L}*)$/iu, "ml"],
  [/^(л|l|літр\p{L}*)$/iu, "l"],
  [/^(шт|шт\.|штук\p{L}*|pcs)$/iu, "pcs"],
  [/^(зубчик|зубчик\p{L}*|зубок|зубк\p{L}*|clove)$/iu, "pcs"],
  [/^(скиб\p{L}*|шматок|шматк\p{L}*|шматочок|шматочк\p{L}*|slice)$/iu, "pcs"],
  [/^(стейк|стейк\p{L}*|філе|steak|fillet)$/iu, "pcs"],
  [/^(головк\p{L}*|качан\p{L}*|head)$/iu, "pcs"],
  [/^(листок|листк\p{L}*|листочок|листочк\p{L}*|leaf|leaves)$/iu, "pcs"],
  [/^(ст\.?\s*л\.?|столов\p{L}*\s*ложк\p{L}*|tbsp)$/iu, "tbsp"],
  [/^(ч\.?\s*л\.?|чайн\p{L}*\s*ложк\p{L}*|tsp)$/iu, "tsp"],
  [/^(скл\.?|склянк\p{L}*|стакан\p{L}*|cup)$/iu, "cup"],
  [/^(пучок|пучк\p{L}*|bunch)$/iu, "bunch"],
  [/^(жмен\p{L}*|горстк\p{L}*|handful)$/iu, "handful"],
  [/^(дрібк\p{L}*|щіпк\p{L}*|pinch)$/iu, "pinch"],
  [/^(за\s+смаком|до\s+смаку|на\s+смак|taste)$/iu, "taste"],
];

/** Скільки слів максимум може займати назва одиниці («ст. л.» — два). */
const MAX_UNIT_WORDS = 2;

/**
 * Шукає одиницю на початку рядка й повертає її разом із рештою тексту.
 * Саме «на початку», а не «весь рядок»: у реальних рецептах після одиниці
 * майже завжди йде уточнення — «400 г консервованого», «300 мл міцної».
 * Стара версія вимагала точного збігу всього хвоста й через це викидала
 * такі інгредієнти з підрахунку калорій цілком.
 */
function matchUnitPrefix(text: string): { unit: Unit; rest: string } | null {
  const words = text.split(/\s+/).filter(Boolean);
  for (let n = Math.min(MAX_UNIT_WORDS, words.length); n >= 1; n--) {
    const candidate = words.slice(0, n).join(" ");
    for (const [re, unit] of ALIASES) {
      if (re.test(candidate)) return { unit, rest: words.slice(n).join(" ") };
    }
  }
  return null;
}

/**
 * Зчитує число на початку рядка. Розуміє дроби («1/2»), змішані числа
 * («1 1/2») і діапазони («2-3») — від діапазону беремо середину, бо це
 * оцінка, а не рецептура з ваговою точністю.
 */
function matchAmountPrefix(text: string): { amount: number; rest: string } | null {
  const re = /^(\d+(?:[.,]\d+)?)(?:\s+(\d+)\s*\/\s*(\d+)|\s*\/\s*(\d+))?(?:\s*[-–—]\s*(\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+))?)?/u;
  const m = text.match(re);
  if (!m) return null;

  const n = (v: string | undefined) => (v == null ? null : Number(v.replace(",", ".")));
  const first = n(m[1]);
  if (first == null || !isFinite(first)) return null;

  let amount = first;
  const mixedNum = n(m[2]);
  const mixedDen = n(m[3]);
  const den = n(m[4]);
  if (mixedNum != null && mixedDen) amount = first + mixedNum / mixedDen;
  else if (den) amount = first / den;

  const hiNum = n(m[5]);
  const hiDen = n(m[6]);
  if (hiNum != null) {
    const hi = hiDen ? hiNum / hiDen : hiNum;
    if (hi > amount) amount = (amount + hi) / 2;
  }

  if (!isFinite(amount)) return null;
  return { amount, rest: text.slice(m[0].length).trim() };
}

/**
 * Витягує число й одиницю зі старого рядка: «200 г» → { amount: 200, unit: 'g' }.
 * Якщо не вдалося — повертає null, і рядок далі живе як вільний текст.
 */
export function parseQty(raw: string | undefined): { amount?: number; unit: Unit } | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase().replace(/\s+/gu, " ");
  if (!text) return null;

  const num = matchAmountPrefix(text);

  // Без числа рядок має сенс, лише якщо він сам — назва міри: «пучок»,
  // «щіпка», «за смаком». Одна міра без числа означає одну штуку міри.
  if (!num) {
    const bare = matchUnitPrefix(text);
    if (!bare) return null;
    if (bare.unit === "taste") return { unit: "taste" };
    // «пучок петрушки» — так, «мл» окремим словом — ні: це залишок розбору.
    if (unitDef(bare.unit).base === "g" || unitDef(bare.unit).base === "ml") return null;
    return { amount: 1, unit: bare.unit };
  }

  const { amount, rest } = num;
  if (!rest) return { amount, unit: "pcs" };

  const matched = matchUnitPrefix(rest);
  if (matched) {
    return matched.unit === "taste" ? { unit: "taste" } : { amount, unit: matched.unit };
  }

  // «1/2 червоної», «2 жовтки» — число є, а слово після нього одиницею не є.
  // Це майже завжди рахунок штук із уточненням, тож рахуємо як штуки:
  // краще приблизна вага, ніж викинутий з калорій інгредієнт.
  return { amount, unit: "pcs" };
}

/** Кількість інгредієнта у придатному для сумування вигляді. */
export function quantityOf(item: RecipeIngredient): { amount?: number; unit: Unit } | null {
  const unit = resolveUnit(item);
  if (unit) return { amount: item.amount, unit };
  return parseQty(item.qty);
}

/* ── Сумування для списку покупок ─────────────────────────────────────── */

export interface SummedQuantity {
  amount?: number;
  unit: Unit;
}

/**
 * Складає кількості одного інгредієнта. Те, що зводиться до спільної бази
 * (г і кг, мл і л), сумується в одне; решта лишається окремими рядками —
 * «2 шт» і «1 ст. л.» об'єднати чесно неможливо.
 */
export function sumQuantities(list: Array<{ amount?: number; unit: Unit }>): SummedQuantity[] {
  const byBase = new Map<string, { total: number; unit: Unit }>();
  const loose: SummedQuantity[] = [];

  for (const q of list) {
    const def = unitDef(q.unit);
    if (!def.base || q.amount == null) {
      // «за смаком» і кількості без числа не сумуються — але показати варто раз.
      if (!loose.some((l) => l.unit === q.unit && l.amount == null)) {
        loose.push({ unit: q.unit });
      }
      continue;
    }
    const entry = byBase.get(def.base) ?? { total: 0, unit: def.base };
    entry.total += q.amount * def.factor;
    byBase.set(def.base, entry);
  }

  const summed: SummedQuantity[] = [];
  for (const [base, { total }] of byBase) {
    summed.push(prettify(total, base as Unit));
  }
  return [...summed, ...loose];
}

/** 1500 г → 1,5 кг; 2500 мл → 2,5 л. Дрібне лишаємо як є. */
function prettify(totalInBase: number, base: Unit): SummedQuantity {
  const bigger = UNITS.find((u) => u.base === base && u.factor > 1);
  if (bigger && totalInBase >= bigger.factor) {
    return { amount: totalInBase / bigger.factor, unit: bigger.key };
  }
  return { amount: totalInBase, unit: base };
}

/** Готовий підпис для списку покупок: «500 г», «1,5 кг · 2 шт». */
export function formatSummed(list: SummedQuantity[]): string {
  return list.map((q) => formatQuantity(q.amount, q.unit)).filter(Boolean).join(" · ");
}
