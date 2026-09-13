import { BRANDS, type BrandDef } from "@/data/brands";
import { ing, knownIngredient, lineage, satisfies } from "@/data/ingredients";
import type { PackUnit, ProductHints } from "./product-types";
import { foldHomoglyphs, matchReceiptName, packSize } from "./receipt";
import { unitDef } from "./units";

export type { ProductHints };

/**
 * Підказки для картки товару з касової назви: «Мол950УлГаличБЛак2.5» →
 * «Молоко безлактозне Галичина 2,5%», 950 мл, тип «Молоко безлактозне».
 *
 * Чисто й без мережі: це лише заповнює редактор, де кожне вгадане поле
 * підкреслене як «здогадка», і без «Зберегти» нічого нікуди не йде. Тому
 * помилитись тут дешево, а промовчати дорого: порожній редактор людина не
 * заповнить, а виправити «950 мл?» — один дотик.
 *
 * Жодне правило не переписує того, що людина вже сказала: `baseTypeKey` з
 * рядка комори чи вибору лише уточнюється вниз по дереву (молоко → безлактозне),
 * ніколи вбік.
 */

/* ── Розбір на слова ──────────────────────────────────────────────────── */

/**
 * «Мол950УлГаличБЛак2.5» → «Мол 950 Ул Галич БЛак 2.5».
 *
 * Каса зліплює все: слова великими літерами, числа з буквами. Межі видно лише
 * до зниження регістру, тож ріжемо спершу. Десяткові й відсотки лишаються
 * при числі: «2,5 %» → «2.5%» — інакше жирність розпадається на два числа.
 */
function spaced(raw: string): string {
  return raw
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{L})(\d)/gu, "$1 $2")
    .replace(/(\d)(\p{L})/gu, "$1 $2")
    .replace(/(\d)\s*[.,]\s*(\d)/gu, "$1.$2")
    .replace(/(\d)\s+%/gu, "$1%")
    .replace(/%(?=[\p{L}\d])/gu, "% ");
}

/** Слова рядка: нижній регістр, латинські двійники кирилиці зведені, «2.5%» — одним словом. */
export function hintTokens(raw: string): string[] {
  const out: string[] = [];
  const text = spaced(raw).toLowerCase().replace(/[ʼ’`´']/g, "ʼ");
  for (const chunk of text.split(/[^\p{L}\p{N}.%/ʼ]+/u)) {
    // Крапка між літерами — склеєні скорочення («безлакт.галичина»), між цифрами — дріб.
    for (const piece of chunk.split(/(?<!\d)\.|\.(?!\d)/u)) {
      const token = foldHomoglyphs(piece.replace(/^\/+|\/+$/g, ""));
      if (token) out.push(token);
    }
  }
  return out;
}

const hasLetter = (token: string) => /\p{L}/u.test(token);
const isLetter = (ch: string | undefined) => !!ch && /\p{L}/u.test(ch);

/* ── Правила ──────────────────────────────────────────────────────────── */

/**
 * Межі жирності за типом — щоб «Масл180…73» дало 73%, а «Молоко…900» не дало
 * 900%. Лише молочне: у ковбасі чи печиві число в кінці рядка — будь-що.
 */
const FAT_RANGE: Record<string, readonly [number, number]> = {
  moloko: [0, 6],
  kefir: [0, 6],
  ryazhanka: [0, 6],
  jogurt: [0, 10],
  smetana: [5, 42],
  vershky: [8, 40],
  maslo: [50, 99],
  tvorog: [0, 18],
};

interface AttributeRule {
  match: RegExp;
  attribute: string;
  /** Ознака має сенс лише для цього типу та його різновидів. */
  within?: string;
  /** Уточнює тип до цього різновиду — лише вниз по дереву. */
  refine?: string;
}

/*
 * `within` там, де слово двозначне поза типом: «солод» — це й солодовий
 * напій, а «Селянське» ще й марка молока, тож ознакою масла воно є лише в
 * маслі. «паст» тільки ціле або «пастер…»: «Паста томатна» — не пастеризована.
 */
const ATTRIBUTE_RULES: readonly AttributeRule[] = [
  { match: /^(безл|блак|б\/лак|lactose)/u, attribute: "безлактозне", within: "moloko", refine: "moloko_bezlaktozne" },
  { match: /^(ультрапаст|у\/паст)/u, attribute: "ультрапастеризоване" },
  { match: /^паст(ер|$)/u, attribute: "пастеризоване" },
  { match: /^солод(ковершк|$)/u, attribute: "солодковершкове", within: "maslo" },
  { match: /^селян/u, attribute: "селянське", within: "maslo" },
];

/** Одиниця з касової «кг», «ваг.» — ваговий товар: без упаковки й без картки. */
const WEIGHED_TOKEN = /^(кг|ваг(ов\p{L}*)?)$/u;

/** Сімейство одиниць типу: молоко — в мл, решта — в г. */
function packFamily(typeKey: string | undefined): "g" | "ml" {
  if (!typeKey) return "g";
  for (const key of lineage(typeKey)) {
    const unit = ing(key).defaultUnit;
    if (unit) return unitDef(unit).base === "ml" ? "ml" : "g";
  }
  return "g";
}

function fatRange(typeKey: string | undefined): readonly [number, number] | undefined {
  if (!typeKey) return undefined;
  for (const key of lineage(typeKey)) if (FAT_RANGE[key]) return FAT_RANGE[key];
  return undefined;
}

/* ── Бренди ───────────────────────────────────────────────────────────── */

interface BrandIndex {
  name: string;
  words: string[];
  abbr: string[][];
  exact: boolean;
}

const indexBrand = (def: BrandDef): BrandIndex => ({
  name: def.name,
  words: hintTokens(def.name),
  abbr: (def.abbr ?? []).map(hintTokens).sort((a, b) => b.length - a.length),
  exact: def.exact ?? false,
});

const SEED_BRANDS = BRANDS.map(indexBrand);

/**
 * Виробник серед слів рядка.
 *
 * Точний збіг → відоме скорочення → однозначний початок від 4 літер. Перше
 * слово назви брендом не буває ніколи: українська назва починається з того,
 * чим товар є («Мол…», «Масл…»), і «Молок» не має ставати «Молокією».
 */
function findBrand(
  tokens: readonly string[],
  head: number,
  taken: ReadonlySet<number>,
  extra: readonly string[],
): { name: string; guessed: boolean } | undefined {
  const brands = extra.length
    ? [...SEED_BRANDS, ...extra.filter((b) => b.trim()).map((name) => indexBrand({ name }))]
    : SEED_BRANDS;
  const free = (at: number, length: number) => {
    if (at <= head || at + length > tokens.length) return false;
    for (let i = at; i < at + length; i++) if (taken.has(i)) return false;
    return true;
  };
  const findSeq = (seq: readonly string[]) => {
    if (seq.length === 0) return false;
    for (let at = 0; at < tokens.length; at++) {
      if (free(at, seq.length) && seq.every((word, i) => tokens[at + i] === word)) return true;
    }
    return false;
  };

  const exact = brands.find((b) => findSeq(b.words));
  if (exact) return { name: exact.name, guessed: false };

  const byAbbr = brands.find((b) => b.abbr.some(findSeq));
  if (byAbbr) return { name: byAbbr.name, guessed: true };

  for (let at = head + 1; at < tokens.length; at++) {
    const token = tokens[at];
    if (taken.has(at) || token.length < 4 || !/^\p{L}+$/u.test(token)) continue;
    /*
     * Однозначний початок у будь-який бік: «прост» — обрізана «Простоквашино»,
     * а «яготинський», «галичини» — та сама назва в іншому роді чи відмінку
     * (слово починається зі скорочення від 4 літер або з назви без закінчення).
     */
    const owners = new Set(
      brands
        .filter((b) => {
          if (b.exact) return false;
          const word = b.words[0] ?? "";
          if (word.startsWith(token)) return true;
          if (b.words.length !== 1) return false;
          return (
            (word.length >= 6 && token.startsWith(word.slice(0, -1))) ||
            b.abbr.some((a) => a.length === 1 && a[0].length >= 4 && token.startsWith(a[0]))
          );
        })
        .map((b) => b.name),
    );
    if (owners.size === 1) return { name: [...owners][0], guessed: true };
  }
  return undefined;
}

/* ── Числа ────────────────────────────────────────────────────────────── */

interface NumberAt {
  value: number;
  percent: boolean;
  integer: boolean;
  /** Зліплене з літерами: «Безл900», «950Ул». */
  glued: boolean;
  /** Одразу за ним одиниця: «900г», «1 л», «10 шт». */
  withUnit: boolean;
  index: number;
}

function numbersIn(raw: string): NumberAt[] {
  const out: NumberAt[] = [];
  for (const m of raw.matchAll(/\d+(?:\s?[.,]\s?\d+)?(\s*%)?/gu)) {
    const index = m.index ?? 0;
    const text = m[0];
    const end = index + text.length;
    const body = text.replace(/%/g, "").replace(/\s/g, "").replace(",", ".");
    /*
     * Одиниця — лише коли за нею не йде мала літера: «900Г» і «1ЛГалич» — так,
     * «900Гал» — ні. Малу перевіряємо окремо: з прапорцем i \p{Ll} ловить і великі.
     */
    const after = raw.slice(end);
    const unit = /^\s*(кг|гр|г|мл|л|шт)/i.exec(after);
    const next = unit ? after[unit[0].length] : undefined;
    out.push({
      value: Number(body),
      percent: text.includes("%"),
      integer: /^\d+$/.test(body),
      glued: isLetter(raw[index - 1]) || isLetter(raw[end]),
      withUnit: !!unit && !(next && /\p{Ll}/u.test(next)),
      index,
    });
  }
  return out;
}

const toPackUnit = (unit: string): PackUnit | undefined =>
  unit === "g" || unit === "kg" || unit === "ml" || unit === "l" || unit === "pcs" ? unit : undefined;

/* ── Головне ──────────────────────────────────────────────────────────── */

/**
 * Усе, що вдається вичитати з назви.
 *
 * `baseTypeKey` — тип, який уже відомо (рядок комори, вибір людини); без
 * нього тип шукає matchReceiptName з тією ж обережністю до прикметників.
 * `extraBrands` — бренди з кешу карток: те, що люди вже назвали, впізнається
 * наступного разу. `measure` — міра каси: «кг» означає ваговий товар.
 */
export function productHints(
  raw: string,
  baseTypeKey?: string,
  extraBrands: readonly string[] = [],
  measure?: string,
): ProductHints {
  const tokens = hintTokens(raw);
  const guessed: ProductHints["guessed"] = [];
  const head = tokens.findIndex(hasLetter);

  /* Тип і ознаки. */
  let typeKey = baseTypeKey || matchReceiptName(raw)?.key;
  if (typeKey && !baseTypeKey) guessed.push("type");

  const attributes: string[] = [];
  const taken = new Set<number>();
  tokens.forEach((token, at) => {
    // «без лактози» двома словами — те саме, що «безлакт».
    const probe = token === "без" && tokens[at + 1]?.startsWith("лакт") ? "безл" : token;
    for (const rule of ATTRIBUTE_RULES) {
      if (!rule.match.test(probe)) continue;
      if (rule.within && !(typeKey && satisfies(typeKey, rule.within))) continue;
      taken.add(at);
      if (probe !== token) taken.add(at + 1);
      if (!attributes.includes(rule.attribute)) attributes.push(rule.attribute);
      /*
       * Лише вниз по дереву: «Молоко» → «Молоко безлактозне». Власний різновид
       * («Козяче», дописаний під молоко) безлактозним не стає — втратився б тип,
       * який людина обрала свідомо.
       */
      if (
        rule.refine &&
        typeKey &&
        knownIngredient(rule.refine) &&
        !satisfies(typeKey, rule.refine) &&
        satisfies(rule.refine, typeKey)
      ) {
        typeKey = rule.refine;
        if (!guessed.includes("type")) guessed.push("type");
      }
      break;
    }
  });

  /* Ваговий товар. «1кг» — це упаковка, а «ІмбирКг» — ні. */
  const measureWeighed = /^кг\.?$/iu.test(measure?.trim() ?? "");
  const weighed =
    measureWeighed ||
    tokens.some((token, at) => WEIGHED_TOKEN.test(token) && !(at > 0 && /^\d/.test(tokens[at - 1])));

  /* Упаковка. */
  const numbers = numbersIn(raw);
  let packAmount: number | undefined;
  let packUnit: PackUnit | undefined;
  let packGuessed = false;
  let packIndex = -1;
  const family = packFamily(typeKey);

  if (!weighed) {
    const size = packSize(raw) ?? packSize(spaced(raw));
    if (size && toPackUnit(size.unit)) {
      packAmount = size.amount;
      packUnit = toPackUnit(size.unit);
    } else {
      // «Безл900»: число без одиниці, зліплене з літерами, — упаковка в одиницях типу.
      const bare = numbers.find((n) => n.integer && !n.percent && !n.withUnit && n.glued && n.value >= 50 && n.value <= 5000);
      if (bare) {
        packAmount = bare.value;
        packUnit = family;
        packGuessed = true;
        packIndex = bare.index;
        guessed.push("pack");
      }
    }
    // Молоко «900 г» на касі — це 900 мл: рідке рахуємо в мл, як нутрієнти (1 мл = 1 г).
    if (family === "ml" && packUnit === "g") packUnit = "ml";
    else if (family === "ml" && packUnit === "kg") packUnit = "l";
  }

  /* Жирність — лише молочне й лише в межах типу. */
  let fatPct: number | undefined;
  const range = fatRange(typeKey);
  if (range) {
    const inRange = (n: NumberAt) => n.value >= range[0] && n.value <= range[1];
    const percent = numbers.find((n) => n.percent && /^\d{1,2}(\.\d{1,2})?$/.test(String(n.value)) && inRange(n));
    if (percent) {
      fatPct = percent.value;
    } else {
      const unitless = numbers.filter((n) => !n.percent && !n.withUnit && n.index !== packIndex);
      const last = unitless[unitless.length - 1];
      if (last && inRange(last)) {
        fatPct = last.value;
        guessed.push("fat");
      }
    }
  }

  /* Виробник. */
  const brand = findBrand(tokens, head < 0 ? tokens.length : head, taken, extraBrands);
  if (brand?.guessed) guessed.push("brand");

  return {
    typeKey,
    brand: brand?.name,
    ...(packAmount != null && packUnit ? { packAmount, packUnit, packGuessed } : {}),
    fatPct,
    attributes,
    weighed,
    tokens,
    suggestedName: suggestName(typeKey, attributes, brand?.name, fatPct),
    guessed,
  };
}

/** Два слова однакові з точністю до закінчення: «безлактозне» = «безлактозний». */
const sameStem = (a: string, b: string) =>
  a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, -2) === b.slice(0, -2));

/**
 * «Молоко безлактозне Галичина 2,5%»: назва типу, ознаки, яких у ній ще немає,
 * виробник і жирність. Упаковки тут немає ніколи — її показують окремо
 * («· 900 мл»), інакше дві пачки різного розміру звались би по-різному.
 */
function suggestName(
  typeKey: string | undefined,
  attributes: readonly string[],
  brand: string | undefined,
  fatPct: number | undefined,
): string | undefined {
  if (!typeKey || !knownIngredient(typeKey)) return undefined;
  const label = ing(typeKey).label;
  const labelWords = label.toLowerCase().split(/\s+/);
  const parts = [
    label,
    ...attributes.filter((a) => !labelWords.some((w) => sameStem(w, a))),
    brand,
    fatPct != null ? `${String(fatPct).replace(".", ",")}%` : undefined,
  ];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of parts.filter(Boolean).join(" ").split(/\s+/)) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words.join(" ");
}

/**
 * Назва для людей там, де є лише касовий рядок і тип: «Мол950УлГаличБЛак2.5»
 * + moloko → «Молоко безлактозне Галичина 2,5%»; не вийшло — назва типу.
 * Касовий текст людині не показуємо ніколи: це приватне «звідки», а не назва.
 */
export function receiptDisplayName(raw: string | null | undefined, typeKey: string): string {
  const suggested = raw ? productHints(raw, typeKey).suggestedName : undefined;
  return suggested ?? ing(typeKey).label;
}
