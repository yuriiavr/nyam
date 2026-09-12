import type { Course, Mood } from "@/lib/types";

/**
 * Напої, під які не треба заводити рецепт.
 *
 * Сік, кава чи мінералка — це не страва: їх купують або роблять за хвилину,
 * і «рецепт апельсинового соку» в галереї виглядав би сміттям. Але порада
 * «що до цього випити» потрібна саме тоді, коли рецепта немає, тож напої
 * живуть окремим коротким списком.
 *
 * Тут єдине місце в застосунку зі свідомо ручною таблицею. Пари страв
 * виводяться з даних, бо їх тисячі й заповнити це неможливо; напоїв
 * двадцять, і те, з чим вони пасують, — властивість самого напою, а не
 * конкретної пари. Двадцять рядків, написаних один раз, чесніші за
 * здогадку.
 */

export type DrinkKind =
  "hot" | "juice" | "soft" | "water" | "dairy" | "alcohol";

export interface DrinkDef {
  key: string;
  label: string;
  emoji: string;
  kind: DrinkKind;
  /** До яких страв пасує. Порожньо тут не буває — інакше напій не порадиться. */
  courses: Course[];
  /**
   * Уривки назв кухонь, з якими напій пасує особливо. Кухня в рецепті —
   * вільний текст («Азійська», «Японська»), тож зіставляємо за підрядком.
   */
  cuisines?: string[];
  /** Що напій врівноважує: гостре пече менше з кефіром, ситне легше з чаєм. */
  tames?: Mood[];
  /** Ключ продукту в коморі, якщо такий у довіднику є. */
  ingredient?: string;
  /** Кава і чай увечері — погана порада. */
  caffeine?: boolean;
  /** Вино до сніданку — теж. */
  alcohol?: boolean;
  /** Не додає ситності: те, що добре після важкої страви. */
  light?: boolean;
}

/**
 * Порядок у списку — це порядок переваги за рівного рахунку: вище стоїть
 * те, що наливають частіше. Саме тому зранку виграє кава, а не чай.
 */
export const DRINKS: DrinkDef[] = [
  /* Гаряче */
  {
    key: "kava",
    label: "Кава",
    emoji: "☕",
    kind: "hot",
    courses: ["dessert", "snack", "whole"],
    caffeine: true,
    light: true,
    ingredient: "kava",
  },
  {
    key: "chai_chornyi",
    label: "Чорний чай",
    emoji: "🍵",
    kind: "hot",
    courses: ["dessert", "snack", "whole", "main"],
    caffeine: true,
    light: true,
    tames: ["hearty"],
    ingredient: "chai",
  },
  {
    key: "chai_zelenyi",
    label: "Зелений чай",
    emoji: "🍃",
    kind: "hot",
    courses: ["main", "side", "whole", "snack"],
    cuisines: ["япон", "азій", "тай", "китай", "корей"],
    caffeine: true,
    light: true,
    tames: ["hearty"],
    ingredient: "chai",
  },
  {
    key: "chai_travyanyi",
    label: "Трав'яний чай",
    emoji: "🌿",
    kind: "hot",
    courses: ["main", "whole", "soup", "dessert", "side"],
    light: true,
    tames: ["hearty"],
  },
  {
    key: "kakao",
    label: "Какао",
    emoji: "🍫",
    kind: "hot",
    courses: ["dessert", "snack"],
    ingredient: "kakao",
  },

  /* Соки */
  {
    key: "sik_apelsynovyi",
    label: "Апельсиновий сік",
    emoji: "🍊",
    kind: "juice",
    courses: ["whole", "snack", "dessert", "salad"],
    ingredient: "sik_apelsynovyi",
  },
  {
    key: "sik_yablunyi",
    label: "Яблучний сік",
    emoji: "🍏",
    kind: "juice",
    courses: ["whole", "main", "side", "snack"],
    ingredient: "sik_yablunyi",
  },
  {
    key: "sik_tomatnyi",
    label: "Томатний сік",
    emoji: "🍅",
    kind: "juice",
    courses: ["main", "side", "whole"],
    cuisines: ["україн", "домашн"],
  },

  /* Солодке */
  {
    key: "kola",
    label: "Кола",
    emoji: "🥤",
    kind: "soft",
    courses: ["whole", "snack", "main"],
    cuisines: ["америк"],
    ingredient: "lymonad",
  },
  {
    key: "lymonad",
    label: "Лимонад",
    emoji: "🍋",
    kind: "soft",
    courses: ["whole", "main", "snack", "side", "soup"],
    tames: ["spicy"],
    ingredient: "lymonad",
  },
  {
    key: "ays_ti",
    label: "Холодний чай",
    emoji: "🧊",
    kind: "soft",
    courses: ["whole", "salad", "snack"],
    light: true,
  },
  {
    key: "kompot",
    label: "Компот",
    emoji: "🍶",
    kind: "soft",
    courses: ["whole", "main", "side", "soup", "salad", "dessert"],
    cuisines: ["україн", "домашн"],
    ingredient: "kompot",
  },
  {
    key: "kvas",
    label: "Квас",
    emoji: "🫙",
    kind: "soft",
    courses: ["whole", "main", "side", "soup", "snack"],
    cuisines: ["україн", "домашн"],
    ingredient: "kvas",
  },

  /* Вода */
  {
    key: "voda_gazovana",
    label: "Мінералка",
    emoji: "🫧",
    kind: "water",
    courses: ["whole", "main", "side", "soup", "salad", "snack", "dessert"],
    light: true,
    tames: ["hearty"],
    ingredient: "voda_gazovana",
  },
  {
    key: "voda_lymon",
    label: "Вода з лимоном",
    emoji: "💧",
    kind: "water",
    courses: ["whole", "main", "salad", "side", "soup"],
    light: true,
    tames: ["hearty", "spicy"],
  },

  /* Кисломолочне */
  {
    key: "kefir",
    label: "Кефір",
    emoji: "🥛",
    kind: "dairy",
    courses: ["main", "side", "whole", "snack"],
    cuisines: ["узбе", "близькосхід", "кавказ", "грузин"],
    tames: ["spicy"],
    ingredient: "kefir",
  },
  {
    key: "ayran",
    label: "Айран",
    emoji: "🥛",
    kind: "dairy",
    courses: ["main", "whole", "side"],
    cuisines: ["близькосхід", "турец", "узбе", "кавказ"],
    tames: ["spicy"],
  },
  {
    key: "kokteil",
    label: "Молочний коктейль",
    emoji: "🥤",
    kind: "dairy",
    courses: ["dessert", "snack"],
    ingredient: "moloko",
  },

  /* Алкоголь */
  {
    key: "vyno_chervone",
    label: "Червоне вино",
    emoji: "🍷",
    kind: "alcohol",
    courses: ["main", "whole"],
    cuisines: ["італій", "європей", "францу", "грец"],
    alcohol: true,
    ingredient: "vyno_chervone",
  },
  {
    key: "vyno_bile",
    label: "Біле вино",
    emoji: "🥂",
    kind: "alcohol",
    courses: ["main", "salad", "whole", "snack"],
    cuisines: ["італій", "грец", "європей", "японс"],
    alcohol: true,
    ingredient: "vyno_bile",
  },
  {
    key: "pyvo",
    label: "Пиво",
    emoji: "🍺",
    kind: "alcohol",
    courses: ["snack", "whole", "main"],
    cuisines: ["америк", "чесь", "німе", "домашн"],
    alcohol: true,
    ingredient: "pyvo",
  },
];
