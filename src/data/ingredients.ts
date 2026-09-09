import type { IngredientCat, IngredientDef } from "@/lib/types";

export const CAT_LABEL: Record<IngredientCat, string> = {
  veg: "Овочі та зелень",
  fruit: "Фрукти та ягоди",
  meat: "Мʼясо",
  fish: "Риба та морепродукти",
  dairy: "Молочне та яйця",
  grain: "Крупи, паста, бобові",
  spice: "Спеції та сипке",
  sauce: "Соуси та олії",
  bakery: "Хліб та випічка",
  other: "Інше",
};

export const CAT_ORDER: IngredientCat[] = [
  "veg",
  "meat",
  "fish",
  "dairy",
  "grain",
  "fruit",
  "sauce",
  "spice",
  "bakery",
  "other",
];

const D = (
  key: string,
  label: string,
  emoji: string,
  cat: IngredientCat,
  aliases: string[] = [],
  staple = false,
): IngredientDef => ({ key, label, emoji, cat, aliases, staple });

export const INGREDIENTS: IngredientDef[] = [
  // Овочі та зелень
  D("kartoplya", "Картопля", "🥔", "veg", ["картопля", "картофель", "potato"]),
  D("tsybulya", "Цибуля", "🧅", "veg", ["цибуля", "лук", "onion"], true),
  D("chasnyk", "Часник", "🧄", "veg", ["часник", "чеснок", "garlic"], true),
  D("morkva", "Морква", "🥕", "veg", ["морква", "морковь", "carrot"]),
  D("buryak", "Буряк", "🟣", "veg", ["буряк", "свекла", "beet"]),
  D("kapusta", "Капуста", "🥬", "veg", ["капуста", "cabbage"]),
  D("pomidor", "Помідор", "🍅", "veg", ["помідор", "томат", "tomato"]),
  D("ogirok", "Огірок", "🥒", "veg", ["огірок", "огурец", "cucumber"]),
  D("perets", "Солодкий перець", "🫑", "veg", ["болгарський перець", "паприка свіжа", "bell pepper"]),
  D("gryby", "Гриби", "🍄", "veg", ["гриби", "печериці", "шампіньйони", "mushroom"]),
  D("kabachok", "Кабачок", "🥒", "veg", ["кабачок", "цукіні", "zucchini"]),
  D("baklazhan", "Баклажан", "🍆", "veg", ["баклажан", "eggplant"]),
  D("garbuz", "Гарбуз", "🎃", "veg", ["гарбуз", "тыква", "pumpkin"]),
  D("salat", "Салат листовий", "🥬", "veg", ["листовий салат", "айсберг", "романо", "lettuce"]),
  D("shpynat", "Шпинат", "🍃", "veg", ["шпинат", "spinach"]),
  D("zelen", "Зелень", "🌿", "veg", ["кріп", "петрушка", "зелень", "parsley", "dill"]),
  D("bazylik", "Базилік", "🌱", "veg", ["базилік", "basil"]),
  D("kukurudza", "Кукурудза", "🌽", "veg", ["кукурудза", "corn"]),
  D("goroshok", "Зелений горошок", "🫛", "veg", ["горошок", "peas"]),
  D("brokoli", "Броколі", "🥦", "veg", ["броколі", "броколи", "broccoli"]),
  D("imbyr", "Імбир", "🫚", "veg", ["імбир", "ginger"]),
  D("chili", "Перець чилі", "🌶️", "veg", ["чилі", "гострий перець", "chili"]),

  // Фрукти та ягоди
  D("lymon", "Лимон", "🍋", "fruit", ["лимон", "lemon"]),
  D("lime", "Лайм", "🍈", "fruit", ["лайм", "lime"]),
  D("banan", "Банан", "🍌", "fruit", ["банан", "banana"]),
  D("yabluko", "Яблуко", "🍎", "fruit", ["яблуко", "apple"]),
  D("avokado", "Авокадо", "🥑", "fruit", ["авокадо", "avocado"]),
  D("yagody", "Ягоди", "🫐", "fruit", ["ягоди", "чорниця", "малина", "berries"]),
  D("olivky", "Оливки", "🫒", "fruit", ["оливки", "маслини", "olives"]),

  // Мʼясо
  D("kurka", "Куряче філе", "🍗", "meat", ["курка", "куряче філе", "курица", "chicken"]),
  D("svynyna", "Свинина", "🐖", "meat", ["свинина", "pork"]),
  D("yalovychyna", "Яловичина", "🥩", "meat", ["яловичина", "говядина", "beef"]),
  D("farsh", "Фарш", "🍖", "meat", ["фарш", "minced meat", "ground beef"]),
  D("bekon", "Бекон", "🥓", "meat", ["бекон", "панчета", "гуанчале", "bacon"]),
  D("kovbasa", "Ковбаса", "🌭", "meat", ["ковбаса", "сосиски", "sausage"]),

  // Риба
  D("losos", "Лосось", "🐟", "fish", ["лосось", "сьомга", "salmon"]),
  D("bila_ryba", "Біла риба", "🐠", "fish", ["хек", "минтай", "тріска", "cod"]),
  D("krevetky", "Креветки", "🍤", "fish", ["креветки", "shrimp"]),
  D("tunets", "Тунець", "🐡", "fish", ["тунець", "tuna"]),

  // Молочне та яйця
  D("yajtsya", "Яйця", "🥚", "dairy", ["яйця", "яйце", "яйца", "egg"], true),
  D("moloko", "Молоко", "🥛", "dairy", ["молоко", "milk"]),
  D("smetana", "Сметана", "🥣", "dairy", ["сметана", "sour cream"]),
  D("vershky", "Вершки", "🍶", "dairy", ["вершки", "сливки", "cream"]),
  D("syr", "Твердий сир", "🧀", "dairy", ["твердий сир", "гауда", "чедер", "cheese"]),
  D("parmezan", "Пармезан", "🧀", "dairy", ["пармезан", "пекорино", "parmesan"]),
  D("motsarela", "Моцарела", "🧀", "dairy", ["моцарела", "mozzarella"]),
  D("feta", "Фета", "🧀", "dairy", ["фета", "бринза", "feta"]),
  D("tvorog", "Кисломолочний сир", "🍚", "dairy", ["творог", "кисломолочний сир", "cottage cheese"]),
  D("jogurt", "Йогурт", "🥣", "dairy", ["йогурт", "yogurt"]),
  D("maslo", "Вершкове масло", "🧈", "dairy", ["вершкове масло", "butter"], true),

  // Крупи, паста, бобові
  D("rys", "Рис", "🍚", "grain", ["рис", "rice"]),
  D("grechka", "Гречка", "🌾", "grain", ["гречка", "buckwheat"]),
  D("makarony", "Паста", "🍝", "grain", ["макарони", "спагеті", "паста", "pasta", "spaghetti"]),
  D("lokshyna", "Локшина", "🍜", "grain", ["локшина", "удон", "рамен", "noodles"]),
  D("boroshno", "Борошно", "🌾", "grain", ["борошно", "мука", "flour"], true),
  D("vivsyanka", "Вівсянка", "🥣", "grain", ["вівсянка", "овсянка", "oats"]),
  D("bulgur", "Кус-кус / булгур", "🍛", "grain", ["кускус", "булгур", "couscous"]),
  D("kvasolya", "Квасоля", "🫘", "grain", ["квасоля", "фасоль", "beans"]),
  D("nut", "Нут", "🟤", "grain", ["нут", "chickpeas"]),
  D("sochevytsya", "Сочевиця", "🟠", "grain", ["сочевиця", "чечевица", "lentils"]),

  // Спеції та сипке
  D("sil", "Сіль", "🧂", "spice", ["сіль", "salt"], true),
  D("perets_ch", "Чорний перець", "⚫", "spice", ["чорний перець", "black pepper"], true),
  D("paprika", "Паприка", "🌶️", "spice", ["паприка", "paprika"], true),
  D("kmyn", "Зіра / кмин", "🌰", "spice", ["зіра", "кмин", "cumin"], true),
  D("kari", "Карі", "🍛", "spice", ["карі", "curry"], true),
  D("kurkuma", "Куркума", "🟡", "spice", ["куркума", "turmeric"], true),
  D("oregano", "Орегано", "🍀", "spice", ["орегано", "прованські трави", "oregano"], true),
  D("tsukor", "Цукор", "🍬", "spice", ["цукор", "сахар", "sugar"], true),
  D("kakao", "Какао", "🍫", "spice", ["какао", "cocoa"]),
  D("vanil", "Ваніль", "🌼", "spice", ["ваніль", "vanilla"], true),
  D("rozpushuvach", "Розпушувач / сода", "🧪", "spice", ["розпушувач", "сода", "baking powder"], true),
  D("drizhdzhi", "Дріжджі", "🫧", "spice", ["дріжджі", "yeast"]),

  // Соуси та олії
  D("oliya", "Олія", "🫗", "sauce", ["олія", "соняшникова олія", "oil"], true),
  D("olyvkova", "Оливкова олія", "🫒", "sauce", ["оливкова олія", "olive oil"], true),
  D("soyevyi", "Соєвий соус", "🍶", "sauce", ["соєвий соус", "soy sauce"]),
  D("tomatna_pasta", "Томатна паста", "🥫", "sauce", ["томатна паста", "tomato paste"]),
  D("pomidory_konserv", "Томати в соку", "🥫", "sauce", ["консервовані томати", "пасата", "passata"]),
  D("maionez", "Майонез", "🧴", "sauce", ["майонез", "mayo"]),
  D("girchytsya", "Гірчиця", "🌭", "sauce", ["гірчиця", "mustard"]),
  D("otset", "Оцет", "🧴", "sauce", ["оцет", "бальзамік", "vinegar"], true),
  D("med", "Мед", "🍯", "sauce", ["мед", "honey"]),
  D("kokos_moloko", "Кокосове молоко", "🥥", "sauce", ["кокосове молоко", "coconut milk"]),
  D("tahini", "Тахіні", "🥜", "sauce", ["тахіні", "кунжутна паста", "tahini"]),
  D("bulion", "Бульйон", "🍲", "sauce", ["бульйон", "broth", "stock"], true),
  D("tom_yam_pasta", "Паста том ям", "🌶️", "sauce", ["том ям паста", "tom yum paste"]),

  // Хліб та випічка
  D("khlib", "Хліб", "🍞", "bakery", ["хліб", "багет", "bread"]),
  D("tortylya", "Лаваш / тортилья", "🫓", "bakery", ["лаваш", "тортилья", "піта", "tortilla"]),
  D("bulochka", "Булочка для бургера", "🍔", "bakery", ["булочка", "бургер бан", "bun"]),
  D("savoyardi", "Печиво савоярді", "🍪", "bakery", ["савоярді", "ladyfingers"]),

  // Інше
  D("gorikhy", "Горіхи", "🥜", "other", ["горіхи", "мигдаль", "волоські горіхи", "nuts"]),
  D("kunzhut", "Кунжут", "⚪", "other", ["кунжут", "sesame"]),
  D("shokolad", "Шоколад", "🍫", "other", ["шоколад", "chocolate"]),
  D("kava", "Кава", "☕", "other", ["кава", "еспресо", "coffee"]),
  D("voda", "Вода", "💧", "other", ["вода", "water"], true),
];

export const ING_BY_KEY: Map<string, IngredientDef> = new Map(
  INGREDIENTS.map((i) => [i.key, i]),
);

/** Опис інгредієнта за ключем; для невідомих ключів повертає безпечний фолбек. */
export function ing(key: string): IngredientDef {
  const found = ING_BY_KEY.get(key);
  if (found) return found;
  return { key, label: key, emoji: "🍽️", cat: "other", aliases: [] };
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ʼ’`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Знаходить інгредієнт за довільним текстом — використовується пошуком у коморі
 * та для мапінгу назви товару, отриманої зі штрихкоду.
 */
export function findIngredient(text: string): IngredientDef | null {
  const q = normalize(text);
  if (!q) return null;
  let best: { def: IngredientDef; score: number } | null = null;
  for (const def of INGREDIENTS) {
    const haystack = [def.label, def.key, ...(def.aliases ?? [])].map(normalize);
    for (const h of haystack) {
      let score = 0;
      if (h === q) score = 1000;
      else if (h.length >= 3 && q.includes(h)) score = 500 + h.length;
      else if (q.length >= 3 && h.includes(q)) score = 200 + q.length;
      if (score > 0 && (!best || score > best.score)) best = { def, score };
    }
  }
  return best ? best.def : null;
}

export function searchIngredients(query: string, limit = 30): IngredientDef[] {
  const q = normalize(query);
  if (!q) return [];
  return INGREDIENTS.filter((def) =>
    [def.label, ...(def.aliases ?? [])].some((h) => normalize(h).includes(q)),
  ).slice(0, limit);
}
