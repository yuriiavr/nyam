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

/**
 * Чим страва є на столі — на відміну від mealType, який каже, коли її їдять.
 *
 * «whole» означає самодостатню: паста, піца чи бургер не потребують пари, і
 * пропонувати до них гарнір безглуздо. Саме за цим полем працюють і фільтри,
 * і підказки «до цього підійде…».
 */
export type Course =
  | "whole"
  | "main"
  | "side"
  | "soup"
  | "salad"
  | "snack"
  | "sauce"
  | "dessert"
  | "drink";

export type IngredientCat =
  | "veg" | "fruit" | "meat" | "fish" | "dairy" | "grain"
  | "spice" | "sauce" | "bakery" | "drink" | "other";

export interface Nutrition {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

/**
 * КБЖВ усієї страви, пораховані ШІ за складом і кроками (src/lib/nutrition-ai.ts).
 * На всю страву, а не на порцію: від кількості порцій вона не залежить.
 */
export interface AiNutrition extends Nutrition {
  /** Припущення, від яких число залежить найбільше, — показуємо під ним. */
  note?: string;
}

export interface IngredientDef {
  key: string;
  label: string;
  emoji: string;
  cat: IngredientCat;
  /** Синоніми для пошуку / розпізнавання зі штрихкоду */
  aliases?: string[];
  /**
   * Базовий продукт: сіль, олія, спеції. Живе в коморі окремим чеклистом —
   * такі речі або є, або немає, і скільки їх лишилось, ніхто не міряє.
   *
   * Наявність більше не припускається: якщо в чеклисті не позначено, рецепт
   * рахує продукт відсутнім.
   */
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
  /**
   * Загальніший тип, різновидом якого є цей: «Молоко безлактозне» → «Молоко».
   *
   * Рецепт, якому треба молоко, рахує наявним і безлактозне — навпаки ні:
   * безлактозному рецепту звичайне молоко не підходить. Вбудовані вказують
   * лише на вбудовані (так їх дзеркалить supabase/builtin-ingredients.sql),
   * дописані — на будь-який тип.
   */
  parent?: string;
  /**
   * Лише для дописаних (I6): цей ключ — псевдонім іншого типу, з яким його
   * обʼєднали. Рецепти зі старим ключем читаються як новий.
   */
  mergedInto?: string;
  /**
   * Лише для дописаних: номер правки рядка в базі (custom_ingredients.version).
   * Вікі-правка (save_custom_ingredient) шле його як очікувану версію — хто
   * змінив тип раніше, той і перемагає, а друга правка чесно отримує «конфлікт»
   * замість тихого перезапису. Вбудовані типи правляться лише кодом — без версії.
   */
  version?: number;
}

/** Одиниці виміру; описані в src/lib/units.ts */
export type Unit =
  | "g"
  | "kg"
  | "ml"
  | "l"
  | "pcs"
  | "clove"
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
   * Спільна картка товару, з якої взято назву й етикетку («з холодильника»,
   * сканер). Лише посилання: рецепт їде у спільноту, і числа в ньому мусять
   * жити й без картки.
   */
  productId?: string;
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
  /** Калорії порції, вписані автором руками, — з часів до підрахунку ШІ. */
  kcal?: number;
  /**
   * Порахував ШІ; немає — ще не порахував (щойно збережено, немає бекенду чи
   * ключа). Пише лише сервер: тригер бази не дає записати сюди клієнтові й
   * сам стирає число, щойно змінились назва, опис, склад чи кроки.
   */
  aiNutrition?: AiNutrition;
  /** 1 — дешево, 3 — дорого */
  costLevel: 1 | 2 | 3;
  /**
   * Частина прийому їжі. Необовʼязкове: рецепти, створені до появи поля,
   * нікуди не зникають — для них частина виводиться з того, що вже відомо.
   */
  course?: Course;
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

/**
 * Рядок у списку покупок.
 *
 * Тут дві різні речі під одним дахом, і це навмисно. Позиція з каталогу
 * (`key`) знає свій відділ у магазині, емодзі й одиниці — її можна скласти з
 * тим, що просить рецепт, і перенести в комору однією дією. Довільний запис
 * (`text`) не знає нічого: «батарейки», «щось до чаю», «спитати про сир». У
 * магазин ходять з одним списком, а не з двома, тож розділяти їх на два
 * екрани було б знущанням.
 */
export interface ShoppingItem {
  /** Власний ідентифікатор: у списку буває два однакові рядки з різних причин. */
  id: string;
  /** Продукт із каталогу. Немає — значить, це довільний запис. */
  key?: string;
  /** Назва для довільного запису або уточнення до каталожного. */
  text?: string;
  amount?: number;
  unit?: Unit;
  /** Куплено. Рядок лишається в списку до кінця походу — викреслений. */
  done: boolean;
  addedAt: string;
  /** Звідки взялось: рука, рецепт, план чи порожня комора. */
  source?: "manual" | "recipe" | "plan" | "pantry";
  /** Рецепт, заради якого це купують. */
  recipeId?: string;
  /**
   * Хто цей рядок створив.
   *
   * Ключ рядка власний, і без цього поля будь-яка галочка переписувала б
   * власника на того, хто її поставив, — а разом із сімʼєю розійшлись би й
   * списки: те, що додав ти, пішло б за іншою людиною. Комора з I4 живе за тим
   * самим правилом (PantryItem.ownerId).
   */
  ownerId?: string;
}

/**
 * Рядок комори: одна покупка — один рядок зі своїм id (D1).
 *
 * Раніше ключем була пара «людина + тип», і дві різні пачки молока (Галичина
 * і Молокія) фізично не вміщались: друга витирала першу разом зі строком і
 * кількістю. Тепер особа рядка — лише `id`; `key` — тип, за яким рядок
 * збігається з рецептами, і коли є `productId`, він завжди дорівнює типу
 * картки (за цим стежать і стор, і тригер у базі).
 */
export interface PantryItem {
  /**
   * uuid рядка. На збірці з бекендом старі збережені рядки отримують
   * «legacy:<key>» (store-migrations.ts): справжній id знає лише база, і
   * такий рядок у базу не пишеться ніколи — перший знімок перепривʼязує його.
   */
  id: string;
  /** Тип (ключ каталогу, вбудований чи own_*). */
  key: string;
  /** Спільна картка товару (products.id). Лише з відповіді сервера — офлайн картки не створюються. */
  productId?: string;
  /**
   * Хто з сімʼї цей рядок додав (user_id). Правка іншим учасником власника не
   * міняє: інакше рядок «переїжджав» би до того, хто востаннє торкнувся кількості.
   */
  ownerId?: string;
  /** Вільна назва для рядка без картки: з Open Food Facts, списку покупок, руками. */
  label?: string;
  /**
   * Сирий текст каси («Мол950УлГаличБЛак2.5») — приватне «звідки», а не назва:
   * людям показуємо receiptDisplayName, а сам рядок лише вчить базу впізнавати.
   */
  receiptName?: string;
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
  /** Коли рядок востаннє писали в базу (тригер pantry_items_touch). Клієнт його не шле. */
  updatedAt?: string;
  /** Змінено, поки id ще був «legacy:» — перший знімок донесе правку до справжнього рядка. */
  legacyDirty?: true;
}

/*
 * Товари, ідентифікатори, історія — окремим файлом (src/lib/product-types.ts),
 * а тут лише реекспорт: так «усі клієнтські типи з types.ts» лишається правдою,
 * а сам великий контракт каталогу не заважає читати решту.
 */
export type {
  CatalogErrorCode,
  CommunityChange,
  CommunityTable,
  IdentifierHit,
  IdentifierKind,
  LineChoice,
  NutritionSource,
  PackUnit,
  Product,
  ProductDraft,
  ProductHints,
  ProductIdentifier,
  Resolution,
  Target,
  TeachItem,
  TeachResult,
} from "./product-types";

export interface CookEvent {
  recipeId: string;
  at: string;
}

/* ── Щоденник ───────────────────────────────────────────────────────────── */

/** Прийом їжі в щоденнику. Десерт і напій — це перекус: окремих полиць не треба. */
export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

/** Звідки запис: сканер, пошук, «що зʼїв» словами, готування, залишки, голос. */
export type FoodSource = "scan" | "search" | "dish" | "cook" | "leftover" | "voice" | "manual";

/**
 * Один продукт у страві — як його порахували.
 *
 * Числа на цю кількість, а не на 100 г: так склад складається додаванням.
 * `from` каже, чому вірити: етикетка конкретного товару точніша за довідник
 * типу, а довідник — за оцінку ШІ.
 */
export interface MealItem {
  name: string;
  grams: number;
  productId?: string;
  typeKey?: string;
  /** Рядок комори, з якого взяли, — щоб списати саме його. */
  pantryId?: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  from: "label" | "catalog" | "ai";
}

/**
 * Що взяли з комори: рядок до списання й скільки з нього пішло — в його
 * одиницях. Повертаємо саме цю кількість, а не знімок рядка: поки запис жив,
 * із тієї ж пачки могли взяти ще.
 */
export interface PantryTaken {
  row: PantryItem;
  amount: number;
}

/**
 * Страва, приготована на кількох: рецепт або «запечена картопля з сосискою».
 *
 * Знає КБЖВ усієї страви й скільки з неї вийшло порцій; хто скільки зʼїв —
 * у записах щоденника (FoodEntry.mealId + share). Так один казан ділиться
 * між людьми з різним апетитом, а недоїдене лишається залишком на завтра.
 */
export interface Meal {
  id: string;
  /** Хто готував. Страву бачить уся сімʼя — як комору. */
  ownerId: string;
  recipeId?: string;
  title: string;
  emoji: string;
  /** Скільки порцій вийшло. */
  servings: number;
  /** КБЖВ усієї страви. Немає — не знаємо (рецепт ще не порахований). */
  nutrition?: Nutrition;
  items: MealItem[];
  /** Припущення ШІ, від яких число залежить найбільше. */
  note?: string;
  cookedAt: string;
  /** Скільки страви вже записали в щоденники (0..1). Веде база. */
  eaten: number;
  /** Доїли чи викинули — залишком більше не пропонуємо. */
  finished: boolean;
  /**
   * Що страва взяла з комори. Немає — ще не вирішили (записали голосом і
   * чекаємо підтвердження); порожньо — нічого не брали.
   */
  pantryTaken?: PantryTaken[];
}

/**
 * Запис щоденника: що людина зʼїла.
 *
 * Або товар (`productId` + `grams`: батончик, йогурт), або частка страви
 * (`mealId` + `share`). `nutrition` — зʼїдене, а не на 100 г; для частки
 * страви база тримає його рівним страві × частка.
 */
export interface FoodEntry {
  id: string;
  /** Чий це запис — хто зʼїв. */
  userId: string;
  /** Хто записав: сам або кухар, що ділив страву. */
  loggedBy?: string;
  eatenAt: string;
  slot: MealSlot;
  title: string;
  emoji: string;
  productId?: string;
  mealId?: string;
  /** Частка страви (0..1]. */
  share?: number;
  grams?: number;
  nutrition?: Nutrition;
  source: FoodSource;
  /** Що цей запис узяв із комори: прибрали запис — повертається назад. */
  pantryTaken?: PantryTaken[];
}

/** Налаштування щоденника — свої й (лише для читання) рідних. */
export interface DiarySettings {
  userId: string;
  /** Ціль калорій на день. */
  kcalGoal?: number;
  /** Скільки людина зʼїдає відносно звичайної порції: 1,5 — у півтора раза більше. */
  appetite: number;
  /** Чи бачить сімʼя цей щоденник. */
  shareDiary: boolean;
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

export type NotificationType =
  | "follow"
  | "like"
  | "save"
  | "cook"
  | "rating"
  | "family_join"
  | "comment";

/** Враження від рецепта, залишене тим, хто його готував. */
export interface RecipeComment {
  id: string;
  recipeId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  actorId: string | null;
  recipeId: string | null;
  readAt: string | null;
  createdAt: string;
}
