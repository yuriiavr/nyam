/**
 * Меню закладів: що там їдять і скільки це КБЖВ.
 *
 * Числа — лише офіційні, із сайту чи PDF закладу; зібрані скриптом
 * scripts/build-restaurants.mjs, звідки й видно, що виключили й чому.
 */

/** Ккал і Б/Ж/В. Б/Ж/В — null, коли заклад їх не публікує (лише ккал). */
export interface DishNutrition {
  kcal: number;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
}

/** Страва — на одну порцію, як її подають. */
export interface RestaurantDish extends DishNutrition {
  /**
   * Сталий ключ у межах закладу: id із джерела або slug англійської назви.
   * З нього рахується id запису в щоденнику — змінювати не можна.
   */
  key: string;
  /** Українською, як у меню. */
  name: string;
  /** Вага порції — коли джерело її дає. */
  amount?: number;
  unit?: "g" | "ml";
  /** На 100 г чи мл — коли джерело дає й це. */
  per100?: DishNutrition;
  /** Чому числа такі: переглянута розбіжність із джерелом. Показуємо біля страви. */
  note?: string;
}

export interface MenuCategory {
  name: string;
  /** Емодзі запису в щоденнику для страв цього розділу. */
  emoji: string;
  dishes: RestaurantDish[];
}

export interface RestaurantMenu {
  categories: MenuCategory[];
}
