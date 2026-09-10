import type { IngredientCat, IngredientDef, Unit } from "@/lib/types";

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

/**
 * Харчова цінність на 100 г продукту: [ккал, білки, жири, вуглеводи].
 * Значення довідкові й усереднені — для домашнього обліку цього досить,
 * але це не медичні дані.
 */
type Nut = [kcal: number, protein: number, fat: number, carbs: number];

interface Extra {
  staple?: boolean;
  /** Середня вага однієї штуки в грамах — щоб «2 шт» перевести у вагу. */
  perPiece?: number;
  /**
   * Вага склянки в грамах. Задаємо там, де продукт легший або важчий за воду:
   * склянка борошна — 120 г, склянка меду — 340 г, а не 240 г, як в усіх
   * рідин. З неї ж виводимо ложки, тож ст. л. борошна стає 7,5 г замість 15.
   */
  cup?: number;
  /** Одиниця, яку підставляти за замовчуванням у формі рецепта. */
  unit?: Unit;
}

const D = (
  key: string,
  label: string,
  emoji: string,
  cat: IngredientCat,
  aliases: string[] = [],
  nut?: Nut,
  extra: Extra = {},
): IngredientDef => ({
  key,
  label,
  emoji,
  cat,
  aliases,
  staple: extra.staple ?? false,
  gramsPerPiece: extra.perPiece,
  gramsPerCup: extra.cup,
  defaultUnit: extra.unit ?? (extra.perPiece ? "pcs" : "g"),
  nutrition: nut
    ? { kcal: nut[0], protein: nut[1], fat: nut[2], carbs: nut[3] }
    : undefined,
});

export const INGREDIENTS: IngredientDef[] = [
  /* ── Овочі та зелень ─────────────────────────────────────────────────── */
  D("kartoplya", "Картопля", "🥔", "veg", ["картопля", "картофель", "potato"], [77, 2, 0.1, 17], { perPiece: 120 }),
  D("tsybulya", "Цибуля", "🧅", "veg", ["цибуля", "лук", "onion"], [40, 1.1, 0.1, 9.3], { staple: true, perPiece: 110 }),
  D("chasnyk", "Часник", "🧄", "veg", ["часник", "чеснок", "garlic"], [149, 6.4, 0.5, 33], { staple: true, perPiece: 3 }),
  D("morkva", "Морква", "🥕", "veg", ["морква", "морковь", "carrot"], [41, 0.9, 0.2, 9.6], { perPiece: 80 }),
  D("buryak", "Буряк", "🟣", "veg", ["буряк", "свекла", "beet"], [43, 1.6, 0.2, 9.6], { perPiece: 150 }),
  D("kapusta", "Капуста", "🥬", "veg", ["капуста", "cabbage"], [25, 1.3, 0.1, 5.8]),
  D("kapusta_pekinska", "Пекінська капуста", "🥬", "veg", ["пекінська капуста", "napa"], [16, 1.2, 0.2, 3.2]),
  D("kapusta_chervona", "Червона капуста", "🥬", "veg", ["червона капуста", "краснокочанная"], [31, 1.4, 0.2, 7.4]),
  D("tsvitna_kapusta", "Цвітна капуста", "🥦", "veg", ["цвітна капуста", "цветная", "cauliflower"], [25, 1.9, 0.3, 5]),
  D("brusselska", "Брюссельська капуста", "🥬", "veg", ["брюссельська", "brussels sprouts"], [43, 3.4, 0.3, 9]),
  D("brokoli", "Броколі", "🥦", "veg", ["броколі", "броколи", "broccoli"], [34, 2.8, 0.4, 7]),
  D("pomidor", "Помідор", "🍅", "veg", ["помідор", "томат", "tomato"], [18, 0.9, 0.2, 3.9], { perPiece: 120 }),
  D("pomidory_cherri", "Помідори чері", "🍅", "veg", ["чері", "черри", "cherry tomatoes"], [18, 0.9, 0.2, 3.9]),
  D("ogirok", "Огірок", "🥒", "veg", ["огірок", "огурец", "cucumber"], [15, 0.7, 0.1, 3.6], { perPiece: 100 }),
  D("perets", "Солодкий перець", "🫑", "veg", ["болгарський перець", "паприка свіжа", "bell pepper"], [31, 1, 0.3, 6], { perPiece: 150 }),
  D("chili", "Перець чилі", "🌶️", "veg", ["чилі", "гострий перець", "chili"], [40, 1.9, 0.4, 9], { perPiece: 15 }),
  D("gryby", "Гриби", "🍄", "veg", ["гриби", "печериці", "шампіньйони", "mushroom"], [22, 3.1, 0.3, 3.3]),
  D("hlyva", "Гливи", "🍄", "veg", ["гливи", "вешенки", "oyster mushroom"], [33, 3.3, 0.4, 4.2]),
  D("bilyi_hryb", "Білі гриби", "🍄", "veg", ["білі гриби", "боровик", "porcini"], [34, 3.7, 1.7, 1.1]),
  D("kabachok", "Кабачок", "🥒", "veg", ["кабачок", "цукіні", "zucchini"], [17, 1.2, 0.3, 3.1], { perPiece: 200 }),
  D("baklazhan", "Баклажан", "🍆", "veg", ["баклажан", "eggplant"], [25, 1, 0.2, 6], { perPiece: 250 }),
  D("garbuz", "Гарбуз", "🎃", "veg", ["гарбуз", "тыква", "pumpkin"], [26, 1, 0.1, 6.5]),
  D("batat", "Батат", "🍠", "veg", ["батат", "солодка картопля", "sweet potato"], [86, 1.6, 0.1, 20], { perPiece: 150 }),
  D("salat", "Салат листовий", "🥬", "veg", ["листовий салат", "айсберг", "романо", "lettuce"], [15, 1.4, 0.2, 2.9]),
  D("ruccola", "Рукола", "🌿", "veg", ["рукола", "руккола", "arugula"], [25, 2.6, 0.7, 3.7]),
  D("shpynat", "Шпинат", "🍃", "veg", ["шпинат", "spinach"], [23, 2.9, 0.4, 3.6]),
  D("zelen", "Зелень", "🌿", "veg", ["кріп", "петрушка", "зелень", "parsley", "dill"], [36, 3, 0.8, 6], { unit: "bunch" }),
  D("kinza", "Кінза", "🌿", "veg", ["кінза", "коріандр свіжий", "cilantro"], [23, 2.1, 0.5, 3.7], { unit: "bunch" }),
  D("bazylik", "Базилік", "🌱", "veg", ["базилік", "basil"], [23, 3.2, 0.6, 2.7], { unit: "bunch" }),
  D("myata", "Мʼята", "🌿", "veg", ["мʼята", "мята", "mint"], [70, 3.8, 0.9, 15], { unit: "bunch" }),
  D("rozmaryn", "Розмарин", "🌿", "veg", ["розмарин", "rosemary"], [131, 3.3, 5.9, 21]),
  D("chebrets", "Чебрець", "🌿", "veg", ["чебрець", "тимʼян", "thyme"], [101, 5.6, 1.7, 24]),
  D("kukurudza", "Кукурудза", "🌽", "veg", ["кукурудза", "corn"], [86, 3.3, 1.4, 19]),
  D("goroshok", "Зелений горошок", "🫛", "veg", ["горошок", "peas"], [81, 5.4, 0.4, 14]),
  D("strukova_kvasolya", "Стручкова квасоля", "🫛", "veg", ["стручкова квасоля", "спаржева", "green beans"], [31, 1.8, 0.1, 7]),
  D("sparzha", "Спаржа", "🌱", "veg", ["спаржа", "asparagus"], [20, 2.2, 0.1, 3.9]),
  D("selera", "Селера", "🌿", "veg", ["селера", "сельдерей", "celery"], [16, 0.7, 0.2, 3]),
  D("redys", "Редиска", "🔴", "veg", ["редиска", "редис", "radish"], [16, 0.7, 0.1, 3.4]),
  D("daykon", "Дайкон", "⚪", "veg", ["дайкон", "редька", "daikon"], [18, 0.6, 0.1, 4.1]),
  D("porey", "Цибуля-порей", "🧅", "veg", ["порей", "порій", "leek"], [61, 1.5, 0.3, 14]),
  D("zelena_tsybulya", "Зелена цибуля", "🌱", "veg", ["зелена цибуля", "зеленый лук", "spring onion"], [32, 1.8, 0.2, 7.3], { unit: "bunch" }),
  D("shalot", "Шалот", "🧅", "veg", ["шалот", "shallot"], [72, 2.5, 0.1, 17], { perPiece: 30 }),
  D("imbyr", "Імбир", "🫚", "veg", ["імбир", "ginger"], [80, 1.8, 0.8, 18]),
  D("khrin", "Хрін", "🥢", "veg", ["хрін", "хрен", "horseradish"], [48, 1.2, 0.7, 11]),
  D("koren_selery", "Корінь селери", "🥔", "veg", ["корінь селери", "celeriac"], [42, 1.5, 0.3, 9.2]),
  D("pasternak", "Пастернак", "🥕", "veg", ["пастернак", "parsnip"], [75, 1.2, 0.3, 18]),

  /* ── Фрукти та ягоди ─────────────────────────────────────────────────── */
  D("lymon", "Лимон", "🍋", "fruit", ["лимон", "lemon"], [29, 1.1, 0.3, 9], { perPiece: 100 }),
  D("lime", "Лайм", "🍈", "fruit", ["лайм", "lime"], [30, 0.7, 0.2, 11], { perPiece: 70 }),
  D("apelsyn", "Апельсин", "🍊", "fruit", ["апельсин", "orange"], [47, 0.9, 0.1, 12], { perPiece: 200 }),
  D("mandaryn", "Мандарин", "🍊", "fruit", ["мандарин", "tangerine"], [53, 0.8, 0.3, 13], { perPiece: 90 }),
  D("grejpfrut", "Грейпфрут", "🍊", "fruit", ["грейпфрут", "grapefruit"], [42, 0.8, 0.1, 11], { perPiece: 300 }),
  D("banan", "Банан", "🍌", "fruit", ["банан", "banana"], [89, 1.1, 0.3, 23], { perPiece: 120 }),
  D("yabluko", "Яблуко", "🍎", "fruit", ["яблуко", "apple"], [52, 0.3, 0.2, 14], { perPiece: 180 }),
  D("grusha", "Груша", "🍐", "fruit", ["груша", "pear"], [57, 0.4, 0.1, 15], { perPiece: 180 }),
  D("avokado", "Авокадо", "🥑", "fruit", ["авокадо", "avocado"], [160, 2, 15, 9], { perPiece: 200 }),
  D("vynograd", "Виноград", "🍇", "fruit", ["виноград", "grapes"], [69, 0.7, 0.2, 18]),
  D("kavun", "Кавун", "🍉", "fruit", ["кавун", "арбуз", "watermelon"], [30, 0.6, 0.2, 8]),
  D("dynya", "Диня", "🍈", "fruit", ["диня", "дыня", "melon"], [34, 0.8, 0.2, 8]),
  D("persyk", "Персик", "🍑", "fruit", ["персик", "нектарин", "peach"], [39, 0.9, 0.3, 10], { perPiece: 150 }),
  D("abrykos", "Абрикос", "🍑", "fruit", ["абрикос", "apricot"], [48, 1.4, 0.4, 11], { perPiece: 40 }),
  D("slyva", "Слива", "🫐", "fruit", ["слива", "plum"], [46, 0.7, 0.3, 11], { perPiece: 60 }),
  D("vyshnya", "Вишня", "🍒", "fruit", ["вишня", "черешня", "cherry"], [50, 1, 0.3, 12]),
  D("yagody", "Ягоди", "🫐", "fruit", ["ягоди", "чорниця", "малина", "berries"], [57, 0.7, 0.3, 14]),
  D("klubnika", "Полуниця", "🍓", "fruit", ["полуниця", "клубника", "strawberry"], [32, 0.7, 0.3, 7.7]),
  D("malyna", "Малина", "🫐", "fruit", ["малина", "raspberry"], [52, 1.2, 0.7, 12]),
  D("chornytsya", "Чорниця", "🫐", "fruit", ["чорниця", "черника", "blueberry"], [57, 0.7, 0.3, 14]),
  D("smorodyna", "Смородина", "🫐", "fruit", ["смородина", "currant"], [56, 1.4, 0.4, 14]),
  D("ananas", "Ананас", "🍍", "fruit", ["ананас", "pineapple"], [50, 0.5, 0.1, 13]),
  D("manho", "Манго", "🥭", "fruit", ["манго", "mango"], [60, 0.8, 0.4, 15], { perPiece: 200 }),
  D("kivi", "Ківі", "🥝", "fruit", ["ківі", "киви", "kiwi"], [61, 1.1, 0.5, 15], { perPiece: 75 }),
  D("granat", "Гранат", "🔴", "fruit", ["гранат", "pomegranate"], [83, 1.7, 1.2, 19]),
  D("hurma", "Хурма", "🟠", "fruit", ["хурма", "persimmon"], [70, 0.6, 0.2, 18]),
  D("inzhyr", "Інжир", "🟤", "fruit", ["інжир", "смоква", "fig"], [74, 0.8, 0.3, 19]),
  D("finiky", "Фініки", "🌴", "fruit", ["фініки", "финики", "dates"], [282, 2.5, 0.4, 75]),
  D("izyum", "Родзинки", "🍇", "fruit", ["родзинки", "изюм", "raisins"], [299, 3.1, 0.5, 79], { cup: 145 }),
  D("kurah", "Курага", "🟠", "fruit", ["курага", "dried apricot"], [241, 3.4, 0.5, 63]),
  D("chornoslyv", "Чорнослив", "🟤", "fruit", ["чорнослив", "prunes"], [240, 2.2, 0.4, 64]),
  D("kokos", "Кокос", "🥥", "fruit", ["кокос", "coconut"], [354, 3.3, 33, 15]),
  D("olivky", "Оливки", "🫒", "fruit", ["оливки", "маслини", "olives"], [115, 0.8, 11, 6]),

  /* ── Мʼясо ───────────────────────────────────────────────────────────── */
  D("kurka", "Куряче філе", "🍗", "meat", ["курка", "куряче філе", "курица", "chicken"], [165, 31, 3.6, 0], { perPiece: 180, unit: "g" }),
  D("kuryachi_stegna", "Курячі стегна", "🍗", "meat", ["стегна", "окорочка", "chicken thigh"], [209, 26, 11, 0]),
  D("kuryachi_krylsya", "Курячі крильця", "🍗", "meat", ["крильця", "крылья", "chicken wings"], [203, 30, 8, 0]),
  D("indychka", "Індичка", "🦃", "meat", ["індичка", "индейка", "turkey"], [189, 29, 7, 0]),
  D("kachka", "Качка", "🦆", "meat", ["качка", "утка", "duck"], [337, 19, 28, 0]),
  D("svynyna", "Свинина", "🐖", "meat", ["свинина", "pork"], [242, 27, 14, 0]),
  D("yalovychyna", "Яловичина", "🥩", "meat", ["яловичина", "говядина", "beef"], [250, 26, 15, 0]),
  D("barannyna", "Баранина", "🐑", "meat", ["баранина", "ягня", "lamb"], [294, 25, 21, 0]),
  D("kroliatyna", "Кролятина", "🐰", "meat", ["кролятина", "кролик", "rabbit"], [173, 33, 3.5, 0]),
  D("farsh", "Фарш", "🍖", "meat", ["фарш", "minced meat", "ground beef"], [254, 17, 20, 0]),
  D("pechinka", "Печінка", "🍖", "meat", ["печінка", "печень", "liver"], [165, 26, 4.4, 3.9]),
  D("bekon", "Бекон", "🥓", "meat", ["бекон", "панчета", "гуанчале", "bacon"], [541, 37, 42, 1.4], { perPiece: 25, unit: "g" }),
  D("vetchyna", "Шинка", "🍖", "meat", ["шинка", "ветчина", "ham"], [145, 18, 8, 1.5], { perPiece: 25, unit: "g" }),
  D("kovbasa", "Ковбаса", "🌭", "meat", ["ковбаса", "сосиски", "sausage"], [301, 12, 27, 3], { perPiece: 50, unit: "g" }),
  D("salo", "Сало", "🥓", "meat", ["сало", "шпик", "lard"], [797, 2.4, 89, 0]),
  D("smalets", "Смалець", "🫙", "meat", ["смалець", "смалец", "лярд"], [900, 0, 100, 0]),

  /* ── Риба та морепродукти ────────────────────────────────────────────── */
  D("losos", "Лосось", "🐟", "fish", ["лосось", "сьомга", "salmon"], [208, 20, 13, 0], { perPiece: 150, unit: "g" }),
  D("forel", "Форель", "🐟", "fish", ["форель", "trout"], [148, 21, 7, 0], { perPiece: 150, unit: "g" }),
  D("bila_ryba", "Біла риба", "🐠", "fish", ["хек", "минтай", "тріска", "cod"], [82, 18, 0.7, 0], { perPiece: 150, unit: "g" }),
  D("tunets", "Тунець", "🐡", "fish", ["тунець", "tuna"], [132, 28, 1.3, 0]),
  D("skumbriya", "Скумбрія", "🐟", "fish", ["скумбрія", "макрель", "mackerel"], [205, 19, 14, 0]),
  D("oseledets", "Оселедець", "🐟", "fish", ["оселедець", "селедка", "herring"], [158, 18, 9, 0]),
  D("sardyny", "Сардини", "🐟", "fish", ["сардини", "sardines"], [208, 25, 11, 0]),
  D("krevetky", "Креветки", "🍤", "fish", ["креветки", "shrimp"], [99, 24, 0.3, 0.2]),
  D("midiyi", "Мідії", "🦪", "fish", ["мідії", "мидии", "mussels"], [86, 12, 2.2, 3.7]),
  D("kalmar", "Кальмар", "🦑", "fish", ["кальмар", "squid"], [92, 16, 1.4, 3]),
  D("ikra", "Ікра", "🐟", "fish", ["ікра", "икра", "caviar"], [264, 24, 18, 4]),
  D("krab_palychky", "Крабові палички", "🦀", "fish", ["крабові палички", "surimi"], [88, 6, 1, 15]),

  /* ── Молочне та яйця ─────────────────────────────────────────────────── */
  D("yajtsya", "Яйця", "🥚", "dairy", ["яйця", "яйце", "яйца", "egg"], [155, 13, 11, 1.1], { staple: true, perPiece: 60 }),
  D("yajtsya_perepel", "Перепелині яйця", "🥚", "dairy", ["перепелині", "quail egg"], [158, 13, 11, 0.4], { perPiece: 12 }),
  D("moloko", "Молоко", "🥛", "dairy", ["молоко", "milk"], [60, 3.2, 3.2, 4.8], { unit: "ml" }),
  D("kefir", "Кефір", "🥛", "dairy", ["кефір", "кефир", "kefir"], [41, 3.4, 1, 4.7], { unit: "ml" }),
  D("ryazhanka", "Ряжанка", "🥛", "dairy", ["ряжанка"], [54, 2.9, 2.5, 4.2], { unit: "ml" }),
  D("smetana", "Сметана", "🥣", "dairy", ["сметана", "sour cream"], [193, 2.8, 20, 3.4], { cup: 230 }),
  D("vershky", "Вершки", "🍶", "dairy", ["вершки", "сливки", "cream"], [292, 2.5, 30, 3.2], { unit: "ml" }),
  D("syr", "Твердий сир", "🧀", "dairy", ["твердий сир", "гауда", "чедер", "cheese"], [380, 25, 30, 2], { cup: 100, perPiece: 20, unit: "g" }),
  D("parmezan", "Пармезан", "🧀", "dairy", ["пармезан", "пекорино", "parmesan"], [431, 38, 29, 4.1], { cup: 90 }),
  D("motsarela", "Моцарела", "🧀", "dairy", ["моцарела", "mozzarella"], [280, 22, 22, 2.2]),
  D("feta", "Фета", "🧀", "dairy", ["фета", "бринза", "feta"], [264, 14, 21, 4.1]),
  D("rikotta", "Рікота", "🧀", "dairy", ["рікота", "ricotta"], [174, 11, 13, 3]),
  D("mascarpone", "Маскарпоне", "🧀", "dairy", ["маскарпоне", "mascarpone"], [429, 4.6, 44, 4.8]),
  D("kamember", "Камамбер", "🧀", "dairy", ["камамбер", "брі", "camembert", "brie"], [300, 20, 24, 0.5]),
  D("blakytnyi_syr", "Блакитний сир", "🧀", "dairy", ["дорблю", "горгонзола", "blue cheese"], [353, 21, 29, 2.3]),
  D("vershkovyi_syr", "Вершковий сир", "🧀", "dairy", ["вершковий сир", "філадельфія", "cream cheese"], [342, 6, 34, 4]),
  D("syr_plavlenyi", "Плавлений сир", "🧀", "dairy", ["плавлений сир", "processed cheese"], [285, 10, 23, 8]),
  D("tvorog", "Кисломолочний сир", "🍚", "dairy", ["творог", "кисломолочний сир", "cottage cheese"], [121, 17, 5, 3]),
  D("jogurt", "Йогурт", "🥣", "dairy", ["йогурт", "yogurt"], [59, 10, 0.4, 3.6]),
  D("maslo", "Вершкове масло", "🧈", "dairy", ["вершкове масло", "butter"], [717, 0.9, 81, 0.1], { staple: true }),
  D("moloko_zguschene", "Згущене молоко", "🥛", "dairy", ["згущене молоко", "сгущенка"], [321, 8, 8, 55]),
  D("yajechnyi_bilok", "Яєчний білок", "🥚", "dairy", ["білок", "яєчний білок", "egg white"], [52, 11, 0.2, 0.7], { perPiece: 33 }),
  D("yajechnyi_zhovtok", "Яєчний жовток", "🟡", "dairy", ["жовток", "яєчний жовток", "egg yolk"], [322, 16, 27, 3.6], { perPiece: 18 }),
  D("moloko_roslynne", "Рослинне молоко", "🥛", "dairy", ["рослинне молоко", "мигдалеве молоко", "вівсяне молоко", "oat milk"], [40, 1, 1.5, 5], { unit: "ml" }),

  /* ── Крупи, паста, бобові ────────────────────────────────────────────── */
  D("rys", "Рис", "🍚", "grain", ["рис", "rice"], [360, 7, 0.7, 79], { cup: 185 }),
  D("ris_burui", "Бурий рис", "🍚", "grain", ["бурий рис", "brown rice"], [370, 7.9, 2.9, 77], { cup: 190 }),
  D("grechka", "Гречка", "🌾", "grain", ["гречка", "buckwheat"], [343, 13, 3.4, 72], { cup: 170 }),
  D("makarony", "Паста", "🍝", "grain", ["макарони", "спагеті", "паста", "pasta", "spaghetti"], [371, 13, 1.5, 75], { cup: 100 }),
  D("lokshyna", "Локшина", "🍜", "grain", ["локшина", "удон", "рамен", "noodles"], [348, 12, 1.4, 71], { cup: 100 }),
  D("boroshno", "Борошно", "🌾", "grain", ["борошно", "мука", "flour"], [364, 10, 1, 76], { cup: 120, staple: true }),
  D("kukurudziane_boroshno", "Кукурудзяне борошно", "🌽", "grain", ["кукурудзяне борошно", "cornmeal"], [361, 7, 3.9, 76], { cup: 140 }),
  D("vivsyanka", "Вівсянка", "🥣", "grain", ["вівсянка", "овсянка", "oats"], [389, 17, 7, 66], { cup: 90 }),
  D("bulgur", "Кус-кус / булгур", "🍛", "grain", ["кускус", "булгур", "couscous"], [342, 12, 1.3, 76], { cup: 180 }),
  D("kinoa", "Кіноа", "🌾", "grain", ["кіноа", "квіноа", "quinoa"], [368, 14, 6, 64], { cup: 170 }),
  D("perlivka", "Перлова крупа", "🌾", "grain", ["перлівка", "перловка", "barley"], [352, 9.9, 1.2, 77], { cup: 200 }),
  D("pshono", "Пшоно", "🌾", "grain", ["пшоно", "пшено", "millet"], [378, 11, 4.2, 73], { cup: 200 }),
  D("manka", "Манна крупа", "🌾", "grain", ["манка", "манна крупа", "semolina"], [333, 10, 1, 73], { cup: 167 }),
  D("kvasolya", "Квасоля", "🫘", "grain", ["квасоля", "фасоль", "beans"], [333, 24, 0.8, 60], { cup: 190 }),
  D("nut", "Нут", "🟤", "grain", ["нут", "chickpeas"], [364, 19, 6, 61], { cup: 200 }),
  D("sochevytsya", "Сочевиця", "🟠", "grain", ["сочевиця", "чечевица", "lentils"], [353, 25, 1.1, 60], { cup: 192 }),
  D("horokh", "Горох", "🟢", "grain", ["горох", "peas dried"], [348, 23, 1.2, 60], { cup: 200 }),
  D("soya", "Соя", "🫘", "grain", ["соя", "soybean"], [446, 36, 20, 30]),
  D("krokhmal", "Крохмаль", "🤍", "grain", ["крохмаль", "крахмал", "starch"], [381, 0.1, 0.1, 91], { cup: 128, staple: true }),
  D("panirovka", "Панірувальні сухарі", "🍞", "grain", ["панірувальні сухарі", "паніровка", "breadcrumbs"], [395, 13, 5, 72], { cup: 108 }),
  D("otrubi", "Висівки", "🌾", "grain", ["висівки", "отруби", "bran"], [216, 16, 4.3, 65], { cup: 60 }),

  /* ── Спеції та сипке ─────────────────────────────────────────────────── */
  D("sil", "Сіль", "🧂", "spice", ["сіль", "salt"], [0, 0, 0, 0], { cup: 273, staple: true }),
  D("perets_ch", "Чорний перець", "⚫", "spice", ["чорний перець", "black pepper"], [251, 10, 3.3, 64], { staple: true }),
  D("perets_chervonyi", "Червоний мелений перець", "🌶️", "spice", ["червоний перець", "кайєнський"], [318, 12, 17, 57], { staple: true }),
  D("paprika", "Паприка", "🌶️", "spice", ["паприка", "paprika"], [282, 14, 13, 54], { staple: true }),
  D("kmyn", "Зіра / кмин", "🌰", "spice", ["зіра", "кмин", "cumin"], [375, 18, 22, 44], { staple: true }),
  D("kari", "Карі", "🍛", "spice", ["карі", "curry"], [325, 14, 14, 56], { staple: true }),
  D("kurkuma", "Куркума", "🟡", "spice", ["куркума", "turmeric"], [354, 8, 10, 65], { staple: true }),
  D("oregano", "Орегано", "🍀", "spice", ["орегано", "прованські трави", "oregano"], [265, 9, 4.3, 69], { staple: true }),
  D("korytsya", "Кориця", "🟤", "spice", ["кориця", "корица", "cinnamon"], [247, 4, 1.2, 81], { staple: true }),
  D("muskat", "Мускатний горіх", "🌰", "spice", ["мускатний горіх", "nutmeg"], [525, 6, 36, 49], { staple: true }),
  D("gvozdyka", "Гвоздика", "🌰", "spice", ["гвоздика", "cloves"], [274, 6, 13, 66], { staple: true }),
  D("kardamon", "Кардамон", "🌰", "spice", ["кардамон", "cardamom"], [311, 11, 7, 68], { staple: true }),
  D("lavrovyi", "Лавровий лист", "🍃", "spice", ["лавровий лист", "лаврушка", "bay leaf"], [313, 8, 8, 75], { staple: true }),
  D("suneli", "Хмелі-сунелі", "🌿", "spice", ["хмелі-сунелі", "сунели"], [320, 12, 8, 50], { staple: true }),
  D("imbyr_moloty", "Мелений імбир", "🟡", "spice", ["мелений імбир", "ground ginger"], [335, 9, 4.2, 72], { staple: true }),
  D("tsukor", "Цукор", "🍬", "spice", ["цукор", "сахар", "sugar"], [387, 0, 0, 100], { cup: 200, staple: true }),
  D("tsukor_korychnevyi", "Коричневий цукор", "🟤", "spice", ["коричневий цукор", "brown sugar"], [380, 0, 0, 98], { cup: 220 }),
  D("tsukrova_pudra", "Цукрова пудра", "🤍", "spice", ["цукрова пудра", "сахарная пудра"], [389, 0, 0, 100], { cup: 120 }),
  D("vanilnyi_tsukor", "Ванільний цукор", "🍚", "spice", ["ванільний цукор", "ванильный сахар", "vanilla sugar"], [389, 0, 0, 99], { cup: 200 }),
  D("kakao", "Какао", "🍫", "spice", ["какао", "cocoa"], [228, 20, 14, 58], { cup: 85 }),
  D("vanil", "Ваніль", "🌼", "spice", ["ваніль", "ванільний екстракт", "vanilla"], [288, 0.1, 0.1, 13], { staple: true }),
  D("rozpushuvach", "Розпушувач / сода", "🧪", "spice", ["розпушувач", "сода", "baking powder"], [53, 0, 0, 28], { cup: 230, staple: true }),
  D("drizhdzhi", "Дріжджі", "🫧", "spice", ["дріжджі", "yeast"], [105, 12, 2, 13], { cup: 150 }),
  D("zhelatyn", "Желатин", "🧊", "spice", ["желатин", "gelatin"], [355, 87, 0.1, 0], { cup: 150 }),

  /* ── Соуси та олії ───────────────────────────────────────────────────── */
  D("oliya", "Олія", "🫗", "sauce", ["олія", "соняшникова олія", "oil"], [899, 0, 100, 0], { cup: 218, staple: true, unit: "ml" }),
  D("olyvkova", "Оливкова олія", "🫒", "sauce", ["оливкова олія", "olive oil"], [884, 0, 100, 0], { cup: 218, staple: true, unit: "ml" }),
  D("kunzhutna_oliya", "Кунжутна олія", "🫗", "sauce", ["кунжутна олія", "sesame oil"], [884, 0, 100, 0], { cup: 218, unit: "ml" }),
  D("kokosova_oliya", "Кокосова олія", "🥥", "sauce", ["кокосова олія", "coconut oil"], [862, 0, 100, 0], { cup: 218 }),
  D("soyevyi", "Соєвий соус", "🍶", "sauce", ["соєвий соус", "soy sauce"], [53, 8, 0.6, 4.9], { cup: 255, unit: "ml" }),
  D("rybnyi_sous", "Рибний соус", "🐟", "sauce", ["рибний соус", "fish sauce"], [35, 5, 0, 4], { unit: "ml" }),
  D("ustrychnyi", "Устричний соус", "🦪", "sauce", ["устричний соус", "oyster sauce"], [51, 2, 0, 11], { unit: "ml" }),
  D("teriyaki", "Соус теріякі", "🍶", "sauce", ["теріякі", "teriyaki"], [89, 5.9, 0, 15], { unit: "ml" }),
  D("sriracha", "Соус шрірача", "🌶️", "sauce", ["шрірача", "sriracha"], [93, 1.9, 1, 19], { unit: "ml" }),
  D("worcester", "Вустерський соус", "🧴", "sauce", ["вустерський", "worcestershire"], [78, 0, 0, 19], { unit: "ml" }),
  D("tomatna_pasta", "Томатна паста", "🥫", "sauce", ["томатна паста", "tomato paste"], [82, 4.3, 0.5, 19], { cup: 260 }),
  D("pomidory_konserv", "Томати в соку", "🥫", "sauce", ["консервовані томати", "пасата", "passata"], [32, 1.6, 0.3, 7]),
  D("ketchup", "Кетчуп", "🍅", "sauce", ["кетчуп", "ketchup"], [112, 1.3, 0.2, 26], { cup: 270 }),
  D("maionez", "Майонез", "🧴", "sauce", ["майонез", "mayo"], [680, 1, 75, 2.6], { cup: 220 }),
  D("girchytsya", "Гірчиця", "🌭", "sauce", ["гірчиця", "mustard"], [66, 4.4, 3.4, 5.8], { cup: 250 }),
  D("otset", "Оцет", "🧴", "sauce", ["оцет", "vinegar"], [21, 0, 0, 0.9], { staple: true, unit: "ml" }),
  D("balsamik", "Бальзамічний оцет", "🍷", "sauce", ["бальзамік", "balsamic"], [88, 0.5, 0, 17], { unit: "ml" }),
  D("med", "Мед", "🍯", "sauce", ["мед", "honey"], [304, 0.3, 0, 82], { cup: 340 }),
  D("dzhem", "Джем", "🍓", "sauce", ["джем", "варення", "jam"], [278, 0.4, 0.1, 69], { cup: 320 }),
  D("kokos_moloko", "Кокосове молоко", "🥥", "sauce", ["кокосове молоко", "coconut milk"], [230, 2.3, 24, 6], { unit: "ml" }),
  D("tahini", "Тахіні", "🥜", "sauce", ["тахіні", "кунжутна паста", "tahini"], [595, 17, 54, 21], { cup: 240 }),
  D("arahisova_pasta", "Арахісова паста", "🥜", "sauce", ["арахісова паста", "peanut butter"], [588, 25, 50, 20], { cup: 258 }),
  D("humus", "Хумус", "🫓", "sauce", ["хумус", "hummus"], [166, 8, 10, 14]),
  D("pesto", "Песто", "🌿", "sauce", ["песто", "pesto"], [450, 5, 45, 6]),
  D("bulion", "Бульйон", "🍲", "sauce", ["бульйон", "broth", "stock"], [15, 1, 0.5, 1.5], { staple: true, unit: "ml" }),
  D("tom_yam_pasta", "Паста том ям", "🌶️", "sauce", ["том ям паста", "tom yum paste"], [150, 3, 8, 15]),
  D("lymonnyi_sik", "Лимонний сік", "🍋", "sauce", ["лимонний сік", "lemon juice"], [22, 0.4, 0.2, 6.9], { unit: "ml" }),
  D("tomatnyi_sik", "Томатний сік", "🍅", "sauce", ["томатний сік", "tomato juice"], [17, 0.8, 0.1, 3.6], { unit: "ml" }),
  D("vyno_bile", "Біле вино", "🥂", "sauce", ["біле вино", "white wine"], [82, 0.1, 0, 2.6], { unit: "ml" }),
  D("vyno_chervone", "Червоне вино", "🍷", "sauce", ["червоне вино", "red wine"], [85, 0.1, 0, 2.6], { unit: "ml" }),

  /* ── Хліб та випічка ─────────────────────────────────────────────────── */
  D("khlib", "Хліб", "🍞", "bakery", ["хліб", "багет", "bread"], [265, 9, 3.2, 49], { perPiece: 30, unit: "g" }),
  D("baton", "Батон", "🥖", "bakery", ["батон", "loaf"], [264, 8, 3, 51], { perPiece: 30, unit: "g" }),
  D("khlib_zhytniy", "Житній хліб", "🍞", "bakery", ["житній хліб", "чорний хліб", "rye bread"], [259, 8.5, 3.3, 48], { perPiece: 30, unit: "g" }),
  D("tortylya", "Лаваш / тортилья", "🫓", "bakery", ["лаваш", "тортилья", "піта", "tortilla"], [297, 8, 7.9, 50], { perPiece: 60 }),
  D("bulochka", "Булочка для бургера", "🍔", "bakery", ["булочка", "бургер бан", "bun"], [279, 9, 4.9, 50], { perPiece: 70 }),
  D("kruassan", "Круасан", "🥐", "bakery", ["круасан", "croissant"], [406, 8, 21, 46], { perPiece: 60 }),
  D("tisto_slojene", "Листкове тісто", "🥐", "bakery", ["листкове тісто", "puff pastry"], [558, 7, 38, 45]),
  D("tisto_pisochne", "Пісочне тісто", "🥧", "bakery", ["пісочне тісто", "shortcrust"], [471, 6, 25, 55]),
  D("lasagna_lysty", "Листи для лазаньї", "🍝", "bakery", ["лазанья листи", "lasagna sheets"], [371, 13, 1.5, 75]),
  D("sukhary", "Сухарі", "🍞", "bakery", ["сухарі", "crouton"], [395, 11, 6, 72]),
  D("pechyvo", "Печиво", "🍪", "bakery", ["печиво", "cookies"], [417, 6, 17, 62], { perPiece: 15, unit: "g" }),
  D("savoyardi", "Печиво савоярді", "🍪", "bakery", ["савоярді", "ladyfingers"], [393, 8, 6, 76], { perPiece: 12 }),

  /* ── Інше ────────────────────────────────────────────────────────────── */
  D("gorikhy", "Горіхи", "🥜", "other", ["горіхи", "nuts"], [654, 15, 65, 14], { cup: 120 }),
  D("voloski", "Волоські горіхи", "🌰", "other", ["волоські горіхи", "walnuts"], [654, 15, 65, 14], { cup: 120 }),
  D("mygdal", "Мигдаль", "🌰", "other", ["мигдаль", "миндаль", "almonds"], [579, 21, 50, 22], { cup: 140 }),
  D("funduk", "Фундук", "🌰", "other", ["фундук", "hazelnut"], [628, 15, 61, 17], { cup: 135 }),
  D("keshyu", "Кешʼю", "🌰", "other", ["кешʼю", "кешью", "cashew"], [553, 18, 44, 30], { cup: 130 }),
  D("fistashky", "Фісташки", "🌰", "other", ["фісташки", "pistachio"], [560, 20, 45, 28], { cup: 125 }),
  D("arahis", "Арахіс", "🥜", "other", ["арахіс", "peanut"], [567, 26, 49, 16], { cup: 145 }),
  D("kunzhut", "Кунжут", "⚪", "other", ["кунжут", "sesame"], [573, 18, 50, 23], { cup: 144 }),
  D("nasinnya_soniashnyka", "Соняшникове насіння", "🌻", "other", ["соняшникове насіння", "семечки"], [584, 21, 51, 20], { cup: 140 }),
  D("garbuzove_nasinnya", "Гарбузове насіння", "🎃", "other", ["гарбузове насіння", "pumpkin seeds"], [559, 30, 49, 11], { cup: 130 }),
  D("chia", "Насіння чіа", "⚫", "other", ["чіа", "chia"], [486, 17, 31, 42], { cup: 170 }),
  D("lnyane", "Насіння льону", "🟤", "other", ["льон", "лляне насіння", "flax"], [534, 18, 42, 29], { cup: 150 }),
  D("kokosova_struzhka", "Кокосова стружка", "🥥", "other", ["кокосова стружка", "coconut flakes"], [660, 7, 65, 24], { cup: 80 }),
  D("shokolad", "Шоколад", "🍫", "other", ["шоколад", "chocolate"], [546, 4.9, 31, 61], { cup: 170 }),
  D("tofu", "Тофу", "⬜", "other", ["тофу", "tofu"], [76, 8, 4.8, 1.9]),
  D("morozyvo", "Морозиво", "🍦", "other", ["морозиво", "мороженое", "ice cream"], [207, 3.5, 11, 24]),
  D("kava", "Кава", "☕", "other", ["кава", "еспресо", "coffee"], [2, 0.1, 0, 0]),
  D("chai", "Чай", "🍵", "other", ["чай", "tea"], [1, 0, 0, 0]),
  D("voda", "Вода", "💧", "other", ["вода", "water"], [0, 0, 0, 0], { staple: true, unit: "ml" }),
];

export const ING_BY_KEY: Map<string, IngredientDef> = new Map(
  INGREDIENTS.map((i) => [i.key, i]),
);

/** Опис інгредієнта за ключем; для невідомих ключів повертає безпечний фолбек. */
export function ing(key: string): IngredientDef {
  const found = ING_BY_KEY.get(key);
  if (found) return found;
  return { key, label: key, emoji: "🍽️", cat: "other", aliases: [], defaultUnit: "g" };
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
