import { newId } from "./utils";

/**
 * Нормалізація збереженого стану під час гідратації (D5).
 *
 * Версію persist НЕ піднімаємо: у zustand 5 клієнт із чужою версією й без
 * migrate гідратує типові значення, а перший set() (setHydrated) записує їх
 * назад — і стара закешована сторінка PWA, відкрита офлайн після деплою,
 * витерла б onboarded, тему, дописані типи й комору. Тому версія лишається 2,
 * а все, що нова комора вимагає від старих даних, робимо тут, у merge, який
 * запускається на кожній гідратації. Стара вкладка, що запише рядки без id,
 * просто отримає їх знову наступного разу.
 */

/** Префікс тимчасового id: рядок ще не бачив знімка з бази й у базу не пишеться. */
export const LEGACY_PREFIX = "legacy:";

export const isLegacyId = (id: string | undefined): boolean =>
  typeof id === "string" && id.startsWith(LEGACY_PREFIX);

/**
 * Ключ, під яким рядок лежав у старих даних: «legacy:moloko#» → «moloko».
 *
 * Саме за ним рядок шукається в базі при перепривʼязці, а не за поточним
 * `key`: до першого знімка людина могла обрати товар іншого типу («Молоко
 * безлактозне»), але в базі той рядок досі під старим ключем. null — id не
 * тимчасовий.
 */
export function legacyKey(id: string | undefined): string | null {
  if (!isLegacyId(id)) return null;
  const key = (id as string).slice(LEGACY_PREFIX.length).replace(/#+$/, "");
  return key || null;
}

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Дає кожному рядку комори id і прибирає сміття. Решту стану не чіпає.
 *
 * - Збірка з бекендом: `legacy:<key>` — справжній id знає лише база, а
 *   вигаданий uuid породив би в ній другий рядок; перший знімок перепривʼяже
 *   (rebaseLegacyPantry). Два рядки одного ключа — `legacy:<key>#`, щоб id
 *   лишались унікальними.
 * - Локальний режим (без бекенду): одразу справжні uuid — перепривʼязувати ні до чого.
 * - Рядок без рядкового key чи addedAt викидаємо: з ним однаково нічого не
 *   зробити, а впасти на ньому може будь-який екран.
 *
 * Ніколи не кидає: зламана гідратація гірша за втрачений один рядок.
 */
export function normalizePersisted(persisted: unknown, backend: boolean): Record<string, unknown> {
  if (!isObject(persisted)) return {};
  const s: Loose = { ...persisted };
  try {
    if (Array.isArray(s.pantry)) {
      const seen = new Set<string>();
      s.pantry = s.pantry
        .filter(
          (p): p is Loose =>
            isObject(p) && typeof p.key === "string" && p.key !== "" && typeof p.addedAt === "string",
        )
        .map((p) => {
          const own = typeof p.id === "string" && p.id ? p.id : null;
          let id = own ?? (backend ? `${LEGACY_PREFIX}${p.key}` : newId());
          // Дубль id (два рядки одного ключа чи скопійований рядок): тимчасовий
          // отримує «#», справжній — новий uuid, щоб правка одного не лягла на інший.
          while (seen.has(id)) id = backend && isLegacyId(id) ? `${id}#` : newId();
          seen.add(id);
          return id === own ? p : { ...p, id };
        });
    } else if (s.pantry !== undefined) {
      s.pantry = [];
    }

    if (s.pantryLegacyRemoved !== undefined) {
      s.pantryLegacyRemoved = Array.isArray(s.pantryLegacyRemoved)
        ? s.pantryLegacyRemoved.filter(
            (r) => isObject(r) && typeof r.key === "string" && typeof r.addedAt === "string",
          )
        : [];
    }

    /*
     * Кеш карток і індекс штрихкодів — лише обʼєкти. Будь-що інше (стара
     * вкладка, ручна правка сховища) — порожній кеш: його наповнить перший же
     * знімок, а зламаний обʼєкт ламав би кожен екран, що читає назву товару.
     */
    for (const field of ["products", "eanIndex"] as const) {
      if (s[field] !== undefined && !isObject(s[field])) s[field] = {};
    }
    return s;
  } catch {
    // Сюди JSON із localStorage не доводить, але якщо дійде — лишаємо все,
    // крім комори: її поверне знімок із бази, а тему й онбординг — ні.
    const { pantry: _dropped, ...rest } = s;
    return rest;
  }
}
