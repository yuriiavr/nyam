export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "dessert" | "drink";

export type Mood =
  | "fast"      // швидко
  | "comfort"   // комфорт-фуд
  | "healthy"   // легке / корисне
  | "hearty"    // ситне
  | "spicy"     // гостре
  | "sweet"     // солодке
  | "fancy"     // вразити гостей
  | "cheap"     // бюджетно
  | "cozy"      // зігрітись
  | "fresh";    // освіжитись

export type IngredientCat =
  | "veg" | "fruit" | "meat" | "fish" | "dairy" | "grain"
  | "spice" | "sauce" | "bakery" | "other";

export interface IngredientDef {
  key: string;
  label: string;
  emoji: string;
  cat: IngredientCat;
  /** Синоніми для пошуку / розпізнавання зі штрихкоду */
  aliases?: string[];
  /** Вважається базовим — майже завжди є вдома, не штрафує match */
  staple?: boolean;
}

export interface RecipeIngredient {
  key: string;
  qty?: string;
  optional?: boolean;
}

export interface RecipeStep {
  text: string;
  /** Таймер у секундах для кроку (режим готування) */
  timerSec?: number;
  tip?: string;
}

export interface RecipeStats {
  likes: number;
  saves: number;
  cooks: number;
  ratingSum: number;
  ratingCount: number;
}

export interface Recipe {
  id: string;
  title: string;
  authorId: string;
  emoji: string;
  /** Стилізований фон-градієнт, коли немає фото */
  gradient: [string, string];
  /** URL або data:URL завантаженого фото */
  image?: string | null;
  description: string;
  cuisine: string;
  mealTypes: MealType[];
  moods: Mood[];
  tags: string[];
  timeMin: number;
  difficulty: 1 | 2 | 3;
  servings: number;
  kcal?: number;
  /** 1 — дешево, 3 — дорого */
  costLevel: 1 | 2 | 3;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  createdAt: string;
  stats: RecipeStats;
  /** id оригіналу, якщо рецепт «форкнули» собі в галерею */
  sourceId?: string;
  /** true — створений локальним користувачем */
  mine?: boolean;
}

export interface Profile {
  id: string;
  handle: string;
  name: string;
  emoji: string;
  gradient: [string, string];
  bio: string;
  city?: string;
  followers: number;
  avatar?: string | null;
}

export interface PantryItem {
  key: string;
  /** довільна назва, якщо продукт не з каталогу (напр. зі штрихкоду) */
  label?: string;
  qty?: string;
  addedAt: string;
  /** штрихкод, якщо додано сканером */
  barcode?: string;
}

export interface CookEvent {
  recipeId: string;
  at: string;
}

export type PlanSlot = "breakfast" | "lunch" | "dinner";
export type WeekPlan = Record<string, Partial<Record<PlanSlot, string>>>;

export interface MatchResult {
  recipe: Recipe;
  have: string[];
  missing: string[];
  pct: number;
}
