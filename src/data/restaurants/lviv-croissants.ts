// Згенеровано scripts/build-restaurants.mjs — руками не правити, а перезібрати.
import type { RestaurantMenu } from "./types";

export const LVIV_CROISSANTS_MENU: RestaurantMenu = {
  categories: [
    {
      name: "Круасани-сендвічі",
      emoji: "🥐",
      dishes: [
        { key: "kruasan-z-lososem-ta-avokado", name: "Круасан з лососем та авокадо", amount: 251, unit: "g", kcal: 689, protein: null, fat: null, carbs: null, per100: { kcal: 274.4, protein: null, fat: null, carbs: null } },
        { key: "kruasan-z-indychkoiu-po-italiisky", name: "Круасан з індичкою по-італійськи", amount: 224, unit: "g", kcal: 710, protein: null, fat: null, carbs: null, per100: { kcal: 317.1, protein: null, fat: null, carbs: null } },
        { key: "kruasan-z-proshuto-motsareloiu-ta-vialenymy-tomatamy", name: "Круасан з прошуто, моцарелою та в'яленими томатами", amount: 154, unit: "g", kcal: 534, protein: null, fat: null, carbs: null, per100: { kcal: 346.5, protein: null, fat: null, carbs: null } },
        { key: "kruasan-z-lososem-ta-kapersamy", name: "Круасан з лососем та каперсами", amount: 171, unit: "g", kcal: 411, protein: null, fat: null, carbs: null, per100: { kcal: 240.6, protein: null, fat: null, carbs: null } },
        { key: "kruasan-z-krevetkoiu-ta-parmezanom", name: "Круасан з креветкою та пармезаном", amount: 131, unit: "g", kcal: 416, protein: null, fat: null, carbs: null, per100: { kcal: 317.7, protein: null, fat: null, carbs: null } },
        { key: "kruasan-z-krevetkoiu-po-aziisky", name: "Круасан з креветкою по-азійськи", amount: 237, unit: "g", kcal: 581, protein: null, fat: null, carbs: null, per100: { kcal: 245, protein: null, fat: null, carbs: null } },
        { key: "kruasan-chyzburher", name: "Круасан Чизбургер", amount: 245, unit: "g", kcal: 796, protein: null, fat: null, carbs: null, per100: { kcal: 324.7, protein: null, fat: null, carbs: null } },
        { key: "kruasan-dabl-chyzburher", name: "Круасан Дабл Чизбургер", amount: 325, unit: "g", kcal: 998, protein: null, fat: null, carbs: null, per100: { kcal: 307, protein: null, fat: null, carbs: null } },
        { key: "kruasan-kurka-teriiaki", name: "Круасан Курка Теріякі", amount: 212, unit: "g", kcal: 636, protein: null, fat: null, carbs: null, per100: { kcal: 299.9, protein: null, fat: null, carbs: null } },
        { key: "kruasan-halytskyi", name: "Круасан Галицький", amount: 215, unit: "g", kcal: 635, protein: null, fat: null, carbs: null, per100: { kcal: 295.4, protein: null, fat: null, carbs: null } },
        { key: "kruasan-z-tuntsem", name: "Круасан з тунцем", amount: 225, unit: "g", kcal: 684, protein: null, fat: null, carbs: null, per100: { kcal: 304.2, protein: null, fat: null, carbs: null } },
        { key: "kruasan-korolivskyi", name: "Круасан Королівський", amount: 220, unit: "g", kcal: 722, protein: null, fat: null, carbs: null, per100: { kcal: 328, protein: null, fat: null, carbs: null } },
        { key: "kruasan-lvivskyi", name: "Круасан Львівський", amount: 228, unit: "g", kcal: 760, protein: null, fat: null, carbs: null, per100: { kcal: 333.2, protein: null, fat: null, carbs: null } },
        { key: "kruasan-filadelfiia-z-lososem", name: "Круасан Філадельфія з лососем", amount: 175, unit: "g", kcal: 539, protein: null, fat: null, carbs: null, per100: { kcal: 308.2, protein: null, fat: null, carbs: null } },
        { key: "kruasan-filadelfiia-z-balykom", name: "Круасан Філадельфія з баликом", amount: 235, unit: "g", kcal: 756, protein: null, fat: null, carbs: null, per100: { kcal: 321.5, protein: null, fat: null, carbs: null } },
        { key: "kruasan-tsezar-z-kurkoiu", name: "Круасан Цезар з куркою", amount: 206, unit: "g", kcal: 596, protein: null, fat: null, carbs: null, per100: { kcal: 289.3, protein: null, fat: null, carbs: null } },
        { key: "kruasan-hiros", name: "Круасан Гірос", amount: 292, unit: "g", kcal: 658, protein: null, fat: null, carbs: null, per100: { kcal: 225.5, protein: null, fat: null, carbs: null } },
        { key: "kruasan-bbq-pork-and-cheese", name: "Круасан BBQ Pork and cheese", amount: 280, unit: "g", kcal: 643, protein: null, fat: null, carbs: null, per100: { kcal: 229.6, protein: null, fat: null, carbs: null } },
        { key: "kruasan-grill-z-balykom", name: "Круасан GRILL з баликом", amount: 165, unit: "g", kcal: 655, protein: null, fat: null, carbs: null, per100: { kcal: 396.8, protein: null, fat: null, carbs: null } },
        { key: "kruasan-grill-tsezar-z-kurkoiu", name: "Круасан GRILL Цезар з куркою", amount: 165, unit: "g", kcal: 372, protein: null, fat: null, carbs: null, per100: { kcal: 225.7, protein: null, fat: null, carbs: null } },
        { key: "kruasan-grill-z-tuntsem-210", name: "Круасан GRILL з тунцем · 210 г", amount: 210, unit: "g", kcal: 672, protein: null, fat: null, carbs: null, per100: { kcal: 319.8, protein: null, fat: null, carbs: null } },
        { key: "kruasan-grill-z-balykom-ta-syrom", name: "Круасан GRILL з баликом та сиром", amount: 145, unit: "g", kcal: 527, protein: null, fat: null, carbs: null, per100: { kcal: 363.6, protein: null, fat: null, carbs: null } },
        { key: "kruasan-grill-z-kurkoiu-ta-syrom", name: "Круасан GRILL з куркою та сиром", amount: 145, unit: "g", kcal: 441, protein: null, fat: null, carbs: null, per100: { kcal: 304.3, protein: null, fat: null, carbs: null } },
        { key: "kruasan-grill-z-tuntsem-157", name: "Круасан GRILL з тунцем · 157 г", amount: 157, unit: "g", kcal: 557, protein: null, fat: null, carbs: null, per100: { kcal: 354.9, protein: null, fat: null, carbs: null } },
      ],
    },
    {
      name: "Солодкі круасани",
      emoji: "🥐",
      dishes: [
        { key: "kruasan-shtrudel-z-iablukom", name: "Круасан Штрудель з яблуком", amount: 155, unit: "g", kcal: 389, protein: null, fat: null, carbs: null, per100: { kcal: 250.9, protein: null, fat: null, carbs: null } },
        { key: "kruasan-z-kremom-maskarpone-ta-lokhynoiu", name: "Круасан з кремом маскарпоне та лохиною", amount: 140, unit: "g", kcal: 467, protein: null, fat: null, carbs: null, per100: { kcal: 333.6, protein: null, fat: null, carbs: null } },
        { key: "kruasan-fistashkovyi", name: "Круасан Фісташковий", amount: 130, unit: "g", kcal: 589, protein: null, fat: null, carbs: null, per100: { kcal: 453, protein: null, fat: null, carbs: null } },
        { key: "kruasan-z-shokoladno-horikhovoiu-pastoiu", name: "Круасан з шоколадно-горіховою пастою", amount: 126, unit: "g", kcal: 680, protein: null, fat: null, carbs: null, per100: { kcal: 539.3, protein: null, fat: null, carbs: null } },
        { key: "kruasan-z-shokoladom-ta-bananom", name: "Круасан з шоколадом та бананом", amount: 166, unit: "g", kcal: 615, protein: null, fat: null, carbs: null, per100: { kcal: 370.6, protein: null, fat: null, carbs: null } },
        { key: "kruasan-malynova-nasoloda", name: "Круасан Малинова насолода", amount: 186, unit: "g", kcal: 658, protein: null, fat: null, carbs: null, per100: { kcal: 353.5, protein: null, fat: null, carbs: null } },
        { key: "kruasan-z-shokoladom", name: "Круасан з шоколадом", amount: 116, unit: "g", kcal: 500, protein: null, fat: null, carbs: null, per100: { kcal: 431.2, protein: null, fat: null, carbs: null } },
      ],
    },
    {
      name: "Десерти",
      emoji: "🍦",
      dishes: [
        { key: "syrnyky-z-smetanoiu-ta-malynovym-dzhemom", name: "Сирники з сметаною та малиновим джемом", amount: 243, unit: "g", kcal: 452, protein: null, fat: null, carbs: null, per100: { kcal: 186, protein: null, fat: null, carbs: null } },
        { key: "ekler-vyshnia-shokolad", name: "Еклер Вишня-шоколад", amount: 55, unit: "g", kcal: 204, protein: null, fat: null, carbs: null, per100: { kcal: 371.5, protein: null, fat: null, carbs: null } },
        { key: "ekler-hrusha-dorbliu", name: "Еклер Груша-дорблю", amount: 50, unit: "g", kcal: 178, protein: null, fat: null, carbs: null, per100: { kcal: 355.9, protein: null, fat: null, carbs: null } },
        { key: "ekler-dubaiskyi", name: "Еклер Дубайський", amount: 55, unit: "g", kcal: 291, protein: null, fat: null, carbs: null, per100: { kcal: 528.7, protein: null, fat: null, carbs: null } },
        { key: "ekler-solona-karamel", name: "Еклер Солона карамель", amount: 50, unit: "g", kcal: 209, protein: null, fat: null, carbs: null, per100: { kcal: 418.9, protein: null, fat: null, carbs: null } },
        { key: "ekler-fistashka-malyna", name: "Еклер Фісташка-малина", amount: 55, unit: "g", kcal: 260, protein: null, fat: null, carbs: null, per100: { kcal: 473.6, protein: null, fat: null, carbs: null } },
      ],
    },
    {
      name: "Напої",
      emoji: "🥤",
      dishes: [
        { key: "kuriachyi-bulion", name: "Курячий бульйон", amount: 281, unit: "g", kcal: 132, protein: null, fat: null, carbs: null, per100: { kcal: 47, protein: null, fat: null, carbs: null } },
      ],
    },
  ],
};
