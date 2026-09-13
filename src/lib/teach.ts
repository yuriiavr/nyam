import { satisfies } from "@/data/ingredients";
import { normalizeEan } from "./ean";
import type {
  ConflictAction,
  IdentifierHit,
  LineChoice,
  ProductIdentifier,
  Resolution,
  Target,
  TeachItem,
  TeachResult,
} from "./product-types";

export type { ConflictAction, LineChoice, TeachItem, TeachResult };

/**
 * Чого вчити спільну базу після рядка чека чи скану (B8, таблиця T1–T4).
 *
 * Чисто: лише план. Виконує його teach_identifiers, а конфлікти розбирає
 * conflictAction нижче. Головне правило — вчимо лише з того, що людина
 * СКАЗАЛА або що база вже знала напевно. Підказка, евристика, OFF чи «схоже
 * на» нічого не вчать: хибна здогадка, записана для всіх, наступного разу
 * прийшла б уже як «знайомий товар», і виправляти її довелось би всім.
 */

/** Рядок, з якого вчимо: касова назва і/або штрихкод. */
export interface TeachLine {
  name?: string;
  ean?: string | null;
  /** Не їжа — не вчимо нічого. */
  nonFood?: boolean;
  /** Галочку зняли — рядок не додали, отже й не підтвердили. */
  checked?: boolean;
}

/**
 * Звідки рядок. `manual` — «Обрати товар» на старому рядку комори (B7):
 * докази там є (касова назва, штрихкод), а от чек уже невідомо який.
 */
export type TeachSource = "qr" | "photo" | "scan" | "manual";

const sameTarget = (a: Target | undefined, b: Target): boolean =>
  !!a &&
  (("productId" in a && "productId" in b && a.productId === b.productId) ||
    ("typeKey" in a && "typeKey" in b && a.typeKey === b.typeKey));

/** Уже вказує саме туди — вчити нічого (teach однаково відповів би `same`). */
const alreadyThere = (res: Resolution, kind: TeachItem["kind"], target: Target): boolean =>
  [res.hit, res.eanConflict].some((hit: IdentifierHit | undefined) => hit?.kind === kind && sameTarget(hit.target, target));

/**
 * План навчання для одного рядка.
 *
 * | ситуація                                   | назва з чека         | EAN                        |
 * |--------------------------------------------|----------------------|----------------------------|
 * | T1 confirmed / picked-product P            | → P                  | → P, якщо EAN дійсний      |
 * | T2 чек, picked-type T                      | → T                  | нічого (EAN чека ≠ тип)    |
 * | T3 чек, untouched, впізнано одним до P     | → P, only_if_unknown | → P, only_if_unknown       |
 * | T4 скан, picked-type T («Лише тип»)        | —                    | → T, only_if_unknown       |
 * | untouched лише з підказкою                 | нічого               | нічого                     |
 * | не їжа, без галочки, eanConflict untouched | нічого               | нічого                     |
 *
 * eanConflict блокує лише автоматичне (T3): явний вибір людини і є
 * відповіддю на «штрихкод і назва ведуть до різних товарів».
 * Скан назви з чека не має — назву вчать лише чеки й старі рядки з нею.
 */
export function teachPlan(line: TeachLine, res: Resolution, choice: LineChoice, source: TeachSource): TeachItem[] {
  if (line.nonFood || line.checked === false) return [];

  const name = source === "scan" ? undefined : line.name?.trim() || undefined;
  const ean = normalizeEan(line.ean) ?? undefined;
  const items: TeachItem[] = [];
  const push = (kind: TeachItem["kind"], raw: string, target: Target, onlyIfUnknown = false) => {
    if (alreadyThere(res, kind, target)) return;
    items.push({
      kind,
      raw,
      ...("productId" in target ? { product_id: target.productId } : { type_key: target.typeKey }),
      source,
      ...(onlyIfUnknown ? { only_if_unknown: true } : {}),
    });
  };

  switch (choice.kind) {
    case "confirmed":
    case "picked-product": {
      const target = { productId: choice.productId };
      if (name) push("receipt_name", name, target);
      if (ean) push("ean", ean, target);
      break;
    }
    case "picked-type": {
      const target = { typeKey: choice.typeKey };
      // T4: скан «Лише тип» — лише якщо код ще нікому не відомий.
      if (source === "scan") {
        if (ean) push("ean", ean, target, true);
      } else if (name) {
        push("receipt_name", name, target); // T2; EAN чека до типу не вчимо ніколи
      }
      break;
    }
    case "untouched": {
      // T3: база вже впізнала рядок одним ідентифікатором як товар — дописуємо другий, якщо його ще не знають.
      const hit = res.hit;
      if (source === "scan" || res.eanConflict || !hit || !("productId" in hit.target)) break;
      if (hit.kind === "ean" && name) push("receipt_name", name, hit.target, true);
      if (hit.kind === "receipt_name" && ean) push("ean", ean, hit.target, true);
      break;
    }
  }
  return items;
}

/**
 * Що робити з відповіддю teach_identifiers на надісланий елемент (B9).
 *
 * - не конфлікт (зокрема `inserted` в області магазину поверх глобального
 *   рядка — це і є «для цього магазину по-своєму») → `none`;
 * - `only_if_unknown` (T3, T4) → `none`: така вставка ніколи не сперечається;
 * - уже знали лише ТИП, а новий товар цього типу чи його різновиду →
 *   `refine`: уточнюємо тип до товару мовчки (reassign_identifier, в історії);
 * - решта явних виборів → `prompt`: «Цей код зараз означає «Q»» з [Лише для
 *   мене зараз] / [Виправити для всіх]. Чуже мовчки не переписуємо ніколи.
 *
 * `productType` — тип товару, до якого вчили (для перевірки уточнення).
 */
export function conflictAction(sent: TeachItem, result: TeachResult, productType?: string): ConflictAction {
  if (result.status !== "conflict" || sent.only_if_unknown) return "none";
  const existing = result.target;
  if (existing && "typeKey" in existing && sent.product_id && productType && satisfies(productType, existing.typeKey)) {
    return "refine";
  }
  return "prompt";
}

/**
 * «Не той товар?» на рядку з назвою з каси: які привʼязки цієї назви досі
 * ведуть до хибного товару — щоб спитати про кожну (B9).
 *
 * Навіщо окремо від teach_identifiers. Чек навчив назву в області магазину
 * (m:atb → P1), а виправлення з комори магазину вже не знає й учить
 * глобально (P2). Глобальний рядок інший, тож teach відповідає «inserted»,
 * конфлікту немає, а область магазину, яку база ставить першою, і далі
 * впізнає P1 у кожному чеку АТБ. Тому шукаємо назву в усіх областях і
 * повертаємо ті, що вказують саме на попередній товар рядка, — як конфлікт
 * з їхньою версією для «Виправити для всіх». Уже розібрані teach (`skip` —
 * id з його відповіді) і ті, що вже на новому товарі, не повторюємо.
 */
export function wrongMappingConflicts(
  identifiers: readonly ProductIdentifier[],
  raw: string,
  previousProductId: string | undefined,
  productId: string,
  skip: ReadonlySet<string> = new Set(),
): Array<{ sent: TeachItem; result: TeachResult }> {
  if (!previousProductId || previousProductId === productId) return [];
  return identifiers
    .filter(
      (i) =>
        i.kind === "receipt_name" &&
        i.raw === raw &&
        !skip.has(i.id) &&
        "productId" in i.target &&
        i.target.productId === previousProductId,
    )
    .map((i) => ({
      sent: { kind: "receipt_name", raw, product_id: productId, source: "manual" },
      result: {
        kind: "receipt_name",
        raw,
        status: "conflict",
        identifierId: i.id,
        scope: i.scope,
        target: i.target,
        version: i.version,
      },
    }));
}
