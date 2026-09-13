/**
 * Торговельні мережі за назвою продавця з чека.
 *
 * Навіщо. Назви з каси у кожної мережі свої: «МолокГалБезл900» в АТБ і в
 * Сільпо можуть означати різне, а власні марки мереж і поготів. Тому назву з
 * чека вчимо в області мережі (receipt_scope → «m:atb»), і сусідня мережа її
 * не підхопить. Сама область рахується лише в базі — клієнт шле сиру назву
 * продавця і slug звідси.
 *
 * Продавця QR-чек пише юридичною назвою («ТОВ «АТБ-МАРКЕТ»»), а фото — тим, що
 * видно в шапці («АТБ»). Обидва мусять дати один slug, інакше чек і фото того ж
 * магазину вчили б дві різні області.
 *
 * Словник — насіння, його ще звіряти зі справжніми чеками (ризик H1.12).
 * Slug: 2–24 символи [a-z0-9_] — так його перевіряє receipt_scope; інакше база
 * мовчки рахує область продавця замість мережі.
 */

interface ChainDef {
  slug: string;
  match: RegExp;
}

/*
 * \b у JavaScript знає лише латиницю, тож межі слова для кирилиці — через
 * \p{L}: «ФОРА» має впізнатись, а «форель» чи «платформа» — ні.
 */
const CHAINS: readonly ChainDef[] = [
  { slug: "atb", match: /атб/iu },
  { slug: "silpo", match: /сільпо|сильпо/iu },
  // ТОВ «Омега» — юридична назва VARUS.
  { slug: "varus", match: /varus|варус|омега/iu },
  { slug: "novus", match: /novus|новус/iu },
  { slug: "auchan", match: /ашан|auchan/iu },
  { slug: "metro", match: /metro|метро\s*кеш/iu },
  { slug: "eko", match: /еко[-\s]?маркет/iu },
  { slug: "fora", match: /(?<!\p{L})фора(?!\p{L})/iu },
  { slug: "kopiyka", match: /копійк/iu },
  { slug: "thrash", match: /траш|thrash/iu },
];

/** Slug мережі або undefined, коли продавця немає чи мережу не впізнали. */
export function chainOf(store?: string | null): string | undefined {
  const text = store?.trim();
  if (!text) return undefined;
  return CHAINS.find((chain) => chain.match.test(text))?.slug;
}
