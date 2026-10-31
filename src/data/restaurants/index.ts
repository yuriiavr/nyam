import type { RestaurantMenu } from "./types";

export type { DishNutrition, MenuCategory, RestaurantDish, RestaurantMenu } from "./types";

/**
 * Заклади, з меню яких можна записати зʼїдене в щоденник.
 *
 * Власна база: меню лежать у репозиторії (src/data/restaurants/*.ts) — так
 * вони працюють без мережі, мають версію в git і не потребують змін у
 * Supabase. Перезібрати з джерел — scripts/build-restaurants.mjs.
 *
 * Тут лише короткі відомості для плиток; самі меню (сотні страв) вантажимо
 * окремо й лише тоді, коли людина відкрила заклад, — щоденнику вони не
 * потрібні при кожному відкритті.
 */

export type RestaurantId = "mcdonalds" | "kfc" | "lviv-croissants";

export interface Restaurant {
  id: RestaurantId;
  name: string;
  /** Логотип з офіційного сайту, у public/. */
  logo: string;
  /** Фірмовий колір — для плитки, поки логотип вантажиться чи якщо не вдалося. */
  color: string;
  /** Звідки числа — показуємо під меню. */
  source: { label: string; url: string; fetched: string };
  /** Заклад публікує лише ккал, без Б/Ж/В. */
  kcalOnly?: boolean;
}

export const RESTAURANTS: readonly Restaurant[] = [
  {
    id: "mcdonalds",
    name: "McDonald's",
    logo: "/restaurants/mcdonalds.png",
    color: "#DA291C",
    source: {
      label: "Калькулятор харчової цінності McDonald's Україна",
      url: "https://www.mcdonalds.com/ua/uk-ua/eat/nutrition_calculator.html",
      fetched: "2026-10-31",
    },
  },
  {
    id: "kfc",
    name: "KFC",
    logo: "/restaurants/kfc.png",
    color: "#E4002B",
    source: {
      label: "Харчова цінність KFC Україна (PDF)",
      url: "https://www.kfc.ua/nutritional-values",
      fetched: "2026-10-31",
    },
  },
  {
    id: "lviv-croissants",
    name: "Львівські круасани",
    logo: "/restaurants/lviv-croissants.png",
    color: "#1D1D1B",
    source: {
      label: "Меню на сайті Lviv Croissants",
      url: "https://lvivcroissants.com/ua/menu/",
      fetched: "2026-10-31",
    },
    kcalOnly: true,
  },
];

export function restaurantById(id: string): Restaurant | undefined {
  return RESTAURANTS.find((r) => r.id === id);
}

const LOADERS: Record<RestaurantId, () => Promise<RestaurantMenu>> = {
  mcdonalds: () => import("./mcdonalds").then((m) => m.MCDONALDS_MENU),
  kfc: () => import("./kfc").then((m) => m.KFC_MENU),
  "lviv-croissants": () => import("./lviv-croissants").then((m) => m.LVIV_CROISSANTS_MENU),
};

const loaded: Partial<Record<RestaurantId, RestaurantMenu>> = {};
const pending: Partial<Record<RestaurantId, Promise<RestaurantMenu>>> = {};

/** Меню закладу; вдруге — з памʼяті. Невдале завантаження можна повторити. */
export function loadMenu(id: RestaurantId): Promise<RestaurantMenu> {
  const ready = loaded[id];
  if (ready) return Promise.resolve(ready);
  let job = pending[id];
  if (!job) {
    job = LOADERS[id]()
      .then((menu) => (loaded[id] = menu))
      .finally(() => delete pending[id]);
    pending[id] = job;
  }
  return job;
}

/** Уже завантажене меню — без очікування. */
export function cachedMenu(id: RestaurantId): RestaurantMenu | undefined {
  return loaded[id];
}
