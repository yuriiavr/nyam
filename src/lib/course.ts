import type { Course, Recipe } from "./types";

/**
 * Допустимі частини страви. У базі на course немає check-обмеження — тож
 * сторожем виступає код: у колонку йде лише те, що застосунок уміє прочитати.
 * `satisfies` не дасть додати нову частину в тип і забути її тут.
 */
const COURSES = {
  whole: true,
  main: true,
  side: true,
  soup: true,
  salad: true,
  snack: true,
  sauce: true,
  dessert: true,
  drink: true,
} satisfies Record<Course, true>;

export function isCourse(value: unknown): value is Course {
  // hasOwnProperty, а не `in`: інакше «toString» теж зійшов би за частину страви.
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COURSES, value);
}

/**
 * Чим страва є на столі.
 *
 * Поле необовʼязкове, і для рецептів, створених до його появи, частину
 * виводимо з того, що вже відомо. Здогадка свідомо обережна: коли ознак
 * немає, страва вважається самодостатньою й у підказки не лізе.
 *
 * Окремим модулем, бо потрібна й серверу (меню помічника, src/lib/menu.ts),
 * а pairing.ts тягне за собою стор застосунку.
 */
export function courseOf(recipe: Pick<Recipe, "course" | "title" | "tags" | "mealTypes">): Course {
  if (recipe.course) return recipe.course;

  const text = `${recipe.title} ${recipe.tags.join(" ")}`.toLowerCase();
  if (recipe.mealTypes.includes("drink")) return "drink";
  if (recipe.mealTypes.includes("dessert")) return "dessert";
  if (/суп|борщ|бульйон|юшка/.test(text)) return "soup";
  if (/салат/.test(text)) return "salad";
  if (/гарнір/.test(text)) return "side";
  if (/соус|заправ/.test(text)) return "sauce";
  if (recipe.mealTypes.includes("snack")) return "snack";
  return "whole";
}
