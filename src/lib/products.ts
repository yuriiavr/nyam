import { ing } from "@/data/ingredients";
import type { Product } from "./product-types";
import type { PantryItem } from "./types";
import { formatQuantity, unitDef } from "./units";
import { newId } from "./utils";

/**
 * Дрібні чисті правила довкола картки товару: скільки важить пачка, як її
 * підписати, як скоротити назву всередині групи типу і який рядок комори з
 * неї виходить. Без React і без мережі — це читають і список комори, і
 * готування, і вартість, і перевірки.
 */

/**
 * Грами однієї пачки: г/кг/мл/л → грами (1 мл = 1 г, як у nutrition.ts);
 * штуки → штуки × вага штуки. Невідомо — null, і тоді рахує тип (D8), а не
 * вигадане число: краще «без кількості», ніж фальшиві 100 г.
 */
export function packGrams(product: Pick<Product, "packAmount" | "packUnit" | "gramsPerPiece">): number | null {
  const { packAmount, packUnit, gramsPerPiece } = product;
  if (packAmount == null || !(packAmount > 0) || !packUnit) return null;
  if (packUnit === "pcs") return gramsPerPiece != null && gramsPerPiece > 0 ? packAmount * gramsPerPiece : null;
  const def = unitDef(packUnit);
  return def.base === "g" || def.base === "ml" ? packAmount * def.factor : null;
}

/** «Молоко безлактозне Галичина 2,5% · 900 мл» — назва й упаковка, як у пікері й «Це він?». */
export function productLabel(product: Pick<Product, "name" | "packAmount" | "packUnit">): string {
  const pack = product.packAmount != null && product.packUnit ? formatQuantity(product.packAmount, product.packUnit) : "";
  return pack ? `${product.name} · ${pack}` : product.name;
}

/** Слова однакові з точністю до закінчення: «Молоко» = «молока», «вершкове» = «вершковий». */
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  const cut = (w: string) => (w.length >= 5 ? w.slice(0, -2) : w.length === 4 ? w.slice(0, -1) : w);
  return a.length >= 4 && b.length >= 4 && cut(a) === cut(b);
}

/**
 * Назва всередині групи свого типу: під «🥛 Молоко» рядок «Молоко безлактозне
 * Галичина 2,5%» читається як «Галичина 2,5%» — тип уже написано заголовком.
 *
 * Відкидаємо лише слова НА ПОЧАТКУ, які збігаються зі словами назви типу.
 * Нічого не лишилось («Молоко» у групі «Молоко») — повна назва: порожній
 * рядок у списку гірший за повтор.
 */
export function shortProductName(name: string, typeKey: string): string {
  const label = ing(typeKey)
    .label.toLowerCase()
    .split(/[^\p{L}ʼ']+/u)
    .filter(Boolean);
  const words = name.trim().split(/\s+/);
  const unused = [...label];
  let cut = 0;
  while (cut < words.length) {
    const word = words[cut].toLowerCase().replace(/[^\p{L}ʼ']/gu, "");
    const at = unused.findIndex((w) => sameStem(w, word));
    if (!word || at < 0) break;
    unused.splice(at, 1);
    cut += 1;
  }
  const rest = words.slice(cut).join(" ");
  if (!rest || cut === 0) return name.trim();
  return rest[0].toLocaleUpperCase("uk") + rest.slice(1);
}

/**
 * Новий рядок комори з картки: тип — з картки, кількість — одна пачка.
 *
 * `extra` — те, що знає лише місце виклику: штрихкод скану, касовий рядок,
 * строк. Id завжди новий: одна покупка — один рядок, а злиття однакових пачок
 * вирішує stackIntoPantry, не тут.
 */
export function rowFromProduct(
  product: Product,
  extra: Partial<Omit<PantryItem, "productId" | "key">> = {},
  now: Date = new Date(),
): PantryItem {
  const pack = product.packAmount != null && product.packAmount > 0 && product.packUnit;
  return {
    id: newId(),
    addedAt: now.toISOString(),
    ...(pack ? { amount: product.packAmount, unit: product.packUnit } : {}),
    ...extra,
    key: product.typeKey,
    productId: product.id,
  };
}
