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
  | "spice" | "sauce" | "bakery" | "drink" | "other";

export interface Nutrition {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface IngredientDef {
  key: string;
  label: string;
  emoji: string;
  cat: IngredientCat;
  /** Синоніми для пошуку / розпізнавання зі штрихкоду */
  aliases?: string[];
  /** Вважається базовим — майже завжди є вдома, не штрафує match */
  staple?: boolean;
  /** Харчова цінність на 100 г. Відсутня — рахунок калорій пропускає продукт. */
  nutrition?: Nutrition;
  /** Середня вага однієї штуки в грамах: «2 яйця» → 120 г. */
  gramsPerPiece?: number;
  /**
   * Вага склянки цього продукту в грамах. Потрібна, бо склянка — міра
   * обʼєму, а не ваги: склянка борошна це 120 г, а склянка цукру — 200 г.
   * З неї ж виводимо ложки (1 скл. = 16 ст. л. = 48 ч. л.).
   */
  gramsPerCup?: number;
  /** Одиниця, яку підставляти у формі рецепта за замовчуванням. */
  defaultUnit?: Unit;
}

/** Одиниці виміру; описані в src/lib/units.ts */
export type Unit =
  | "g"
  | "kg"
  | "ml"
  | "l"
  | "pcs"
  | "tbsp"
  | "tsp"
  | "cup"
  | "bunch"
  | "handful"
  | "pinch"
  | "taste";

export interface RecipeIngredient {
  key: string;
  /** Число окремо від одиниці — щоб список покупок міг сумувати. */
  amount?: number;
  unit?: Unit;
  /**
   * Назва для продукту, якого немає в каталозі — наприклад, конкретного
   * товару, доданого сканером штрихкоду.
   */
  label?: string;
  /**
   * Харчова цінність на 100 г саме цього товару. Має пріоритет над
   * довідковою з каталогу: дані з етикетки точніші за усереднені.
   */
  nutrition?: Nutrition;
  /**
   * Старий вільний текст («2-3 шт», «до смаку»). Лишається заради рецептів,
   * створених до появи одиниць, і як запасний варіант для нестандартних мір.
   */
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
  /** Скільки цього продукту вдома — так само, як у рецепті: число + одиниця. */
  amount?: number;
  unit?: Unit;
  /** Старий вільний текст кількості. Лишається для записів до появи одиниць. */
  qty?: string;
  addedAt: string;
  /** Строк придатності, дата у форматі YYYY-MM-DD. */
  expiresAt?: string;
  /** штрихкод, якщо додано сканером */
  barcode?: string;
  /**
   * Скільки коштував грам цього продукту в останній покупці, грн.
   *
   * Через грам, бо це спільний знаменник із рецептами: там кількість буває
   * у склянках і ложках. Береться з чека — там є і сума, і кількість.
   */
  pricePerGram?: number;
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

/* ── Сімʼя ──────────────────────────────────────────────────────────────── */

/** Сімʼя не має назви — це просто набір людей, повʼязаних кодом запрошення. */
export interface Family {
  id: string;
  inviteCode: string;
  createdBy: string | null;
  createdAt: string;
}

export interface FamilyMember {
  userId: string;
  role: "owner" | "member";
  joinedAt: string;
  profile: Profile;
}

/* ── Сповіщення ─────────────────────────────────────────────────────────── */

export type NotificationType = "follow" | "like" | "save" | "cook" | "rating" | "family_join";

export interface AppNotification {
  id: string;
  type: NotificationType;
  actorId: string | null;
  recipeId: string | null;
  readAt: string | null;
  createdAt: string;
}
