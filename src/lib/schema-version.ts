/**
 * Версія застосунку, з якою він уміє говорити з базою: чиста частина.
 *
 * Навіщо. Service worker віддає сторінку з мережі, а статику — з кешу, і
 * VERSION у ньому не міняється ніколи. Тож старий код живе довше за деплой:
 * у вкладці, яку не закривали тиждень, у приспаному застосунку на телефоні,
 * у сторінці, відкритій без інтернету з кешу. Поки база й код змінюються
 * разом, це нічого не коштує. А коли SQL міняє форму даних (мітки з чека,
 * заміна ключа комори), старий код пише по-старому — і тихо псує рядки,
 * які новий уже читає інакше.
 *
 * Тому сервер каже, яку версію він уже знає (/api/version), а застосунок
 * порівнює її зі своєю й просить перезапуститись. SQL, що ламає стару форму,
 * виконуємо не раніше ніж через 14 днів після появи цієї перевірки: за цей
 * час майже кожен живий застосунок уже має її в собі.
 *
 * Жодних залежностей — ні React, ні мережі: це читає і маршрут, і Providers,
 * і клієнт Supabase, і скрипт перевірки (npm run check:push) через jiti.
 */

/**
 * Номер форми даних, під яку написано цей код.
 *
 * Піднімати разом із SQL, після якого старий код писав би неправильно, — у
 * тому ж деплої: I2 → 2 (мітки з чека), I4 → 3 (ключ комори), контракт I6 → 4.
 * Зараз 3: I2–I6 (без контрактного кроку) їдуть одним деплоєм, тож проміжної
 * двійки жоден клієнт не бачив — одразу 3.
 * Зміни, які старий код переживає (нова колонка, яку він просто не читає),
 * номера не потребують: кожен підйом — це перезапуск у всіх, хто зараз у
 * застосунку.
 */
export const CLIENT_SCHEMA = 3;

/**
 * Не частіше, ніж раз на 10 хвилин, — коли сервер відповів.
 *
 * Перевірка йде на старті й щоразу, як застосунок повертається на екран, — а
 * на телефоні це десятки разів на годину (глянула рецепт, переключилась у
 * месенджер, назад). Деплой, від якого вона береже, стається раз на кілька
 * днів, тож 10 хвилин запізнення — ніщо, а запит на кожне повернення — шум.
 */
export const VERSION_CHECK_INTERVAL_MS = 10 * 60_000;

/**
 * Перша пауза після невдалого запиту; далі вона подвоюється до 10 хвилин.
 *
 * Невдача — не відповідь, і 10 хвилин тиші після неї забирали б перевірку
 * саме тоді, коли вона найпотрібніша. Перший запит після того, як iOS
 * розбудила застосунок, що спав три дні, падає часто: мережа ще не
 * піднялась, а navigator.onLine при цьому весь час каже «онлайн», тож події
 * online, яка покликала б нас знову, не буде. Так само подія online
 * приходить раніше, ніж запрацював DNS. Тож повтор — за 15 секунд, а не за
 * 10 хвилин; і лише мережа, що лежить довго, поступово сповільнює спроби.
 */
export const VERSION_RETRY_BASE_MS = 15_000;

/** Пауза перед повтором після failures невдач поспіль (0 і сміття — як одна). */
export function versionRetryDelay(failures: number): number {
  const n = Number.isFinite(failures) && failures >= 1 ? Math.floor(failures) : 1;
  return Math.min(VERSION_RETRY_BASE_MS * 2 ** Math.min(n - 1, 30), VERSION_CHECK_INTERVAL_MS);
}

/**
 * Номер схеми з відповіді сервера — або null, якщо там не номер.
 *
 * Суворо: лише ціле додатне число. Рядок «2», NaN, дріб чи порожнеча — це
 * збій (чужа сторінка замість JSON, проксі, недописаний маршрут), а не нова
 * версія. Прийняти збій за нову версію означало б перезапуск, після якого
 * банер зʼявляється знову, — застосунок, яким неможливо користуватись.
 */
export function readServerSchema(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return null;
  return value;
}

/**
 * Що робити з перевіркою версії просто зараз.
 *
 * - serverSchema — остання відповідь сервера як є (null — ще не питали або
 *   запит не вдався);
 * - clientSchema — CLIENT_SCHEMA цього коду;
 * - lastCheckAt — коли питали востаннє, у мс (null — ще жодного разу);
 * - now — «зараз», у мс;
 * - failures — скільки запитів поспіль не дали номера (для паузи повтору).
 *
 * Відповідь:
 * - true — сервер уже новіший: показати «Оновити». Від часу не залежить:
 *   вищий номер сам собою назад не повертається, і банер не має зникнути
 *   лише тому, що відповідь постаріла;
 * - false — версії сумісні (або сервер старший — скажімо, після відкату
 *   деплою) і питали менше ніж 10 хвилин тому; чи відповіді немає, а пауза
 *   повтору ще не минула: нічого не робити;
 * - null — пора спитати сервер.
 *
 * Зіпсована відповідь поводиться як невдалий запит: не банер, а повтор. Дата
 * «з майбутнього» (годинник перевели назад) — теж привід спитати, а не
 * мовчати до тієї дати.
 */
export function shouldPromptReload(
  serverSchema: unknown,
  clientSchema: number,
  lastCheckAt: number | null,
  now: number,
  failures = 0,
): boolean | null {
  const server = readServerSchema(serverSchema);
  if (server !== null && server > clientSchema) return true;

  if (lastCheckAt === null || !Number.isFinite(lastCheckAt) || !Number.isFinite(now)) return null;
  const age = now - lastCheckAt;
  const wait = server === null ? versionRetryDelay(failures) : VERSION_CHECK_INTERVAL_MS;
  if (age < 0 || age >= wait) return null;
  return false;
}

/* ── Запобіжник від петлі перезапусків ───────────────────────────────── */

/**
 * Скільки після натиску «Оновити» вважати, що перезапуск не взяв.
 *
 * Якщо відразу після перезапуску сервер знову каже «новіше» (сторінка прийшла
 * з кешу, бо мережа зникла саме на навігації, чи CDN ще віддає старе),
 * блокувальний аркуш знову й знову замикав би застосунок. Тож дві хвилини —
 * лише смужка. Але не довше: мережа, що повернулась, робить другий
 * перезапуск цілком здійсненним, а старий код без замка лишався б працювати
 * до кінця вкладки.
 */
export const RELOAD_LOOP_WINDOW_MS = 2 * 60_000;

/** Позначка перед перезапуском: для якої версії сервера і коли. */
export interface ReloadMark {
  schema: number;
  at: number;
}

/**
 * Чи цей запуск — щойно зроблений перезапуск, що не приніс нового коду.
 *
 * Позначка приходить зі сховища як є, тож перевіряємо її форму: старий формат
 * (просто номер), сміття чи час «з майбутнього» — не петля, а звичайний
 * блокувальний аркуш.
 */
export function isReloadLoop(mark: unknown, schema: number, now: number): boolean {
  if (!mark || typeof mark !== "object") return false;
  const { schema: markSchema, at } = mark as Partial<ReloadMark>;
  if (markSchema !== schema || typeof at !== "number" || !Number.isFinite(at) || !Number.isFinite(now)) return false;
  const age = now - at;
  return age >= 0 && age < RELOAD_LOOP_WINDOW_MS;
}

/* ── Замок на запис для старого коду ─────────────────────────────────── */

/*
 * Банер лише просить. А писати старий код може й повз нього: смужка на
 * готуванні не заважає натиснути «Далі» на останньому кроці (і комора
 * списується за старим ключем), сканер штрихкодів додає продукт сам, без
 * жодного натиску, а після перезапуску, що не взяв, замка немає зовсім.
 * Тому, щойно відомо, що сервер новіший, клієнт Supabase відмовляє в будь-
 * якому записі в базу. Читання лишається — старий вигляд даних нічого не
 * псує, — а запис чекає перезапуску й поїде вже новим кодом.
 */
let clientStale = false;

/** Сервер знає новішу форму даних: відтепер цей код у базу не пише. Назад не повертається. */
export function markClientStale(): void {
  clientStale = true;
}

export function isClientStale(): boolean {
  return clientStale;
}

/**
 * Код відмови. Свідомо не схожий на SQLSTATE: sync.isPermanentRejection
 * вважає остаточними лише класи 22/23/42, тож позначка «правка не дійшла»
 * у рецепта лишається, і після перезапуску новий код дошле її сам.
 */
export const STALE_WRITE_CODE = "NYAM_STALE_CLIENT";

/** Це побачить людина: шина помилок sync показує повідомлення тостом як є. */
export const STALE_WRITE_MESSAGE = "Застосунок оновився — перезапусти, щоб зберегти зміни";

/**
 * Чи це запис у базу: PostgREST (/rest/v1/) будь-яким методом, крім читання.
 *
 * RPC теж іде POST-ом, і більшість наших RPC — записи (сімʼя, прочитані
 * сповіщення, картки товарів). Виняток — READ_ONLY_RPCS: пошук, впізнавання,
 * історія. Вони нічого не пишуть, а без них старий код під банером не міг би
 * навіть знайти товар чи показати історію картки. Вхід (/auth/v1/) і сховище
 * фото (/storage/v1/) не чіпаємо: форми даних у базі вони не мають, а вийти з
 * акаунта старий код мусить могти.
 */
export function isDatabaseWrite(url: string, method: string | undefined): boolean {
  const verb = (method ?? "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  try {
    const path = new URL(url, "http://localhost").pathname;
    if (!path.includes("/rest/v1/")) return false;
    const rpc = /\/rest\/v1\/rpc\/([A-Za-z0-9_]+)\/?$/.exec(path)?.[1];
    return !(rpc && READ_ONLY_RPCS.has(rpc));
  } catch {
    return false;
  }
}

/**
 * RPC, що лише читають (security invoker, stable/immutable у SQL). Перелік
 * явний, а не «усе, що не save_*»: нова функція-запис, забута тут, лишиться
 * закритою для старого коду — помилка в безпечний бік.
 */
export const READ_ONLY_RPCS: ReadonlySet<string> = new Set([
  "search_products",
  "resolve_identifiers",
  "community_history",
  "similar_receipt_names",
  "receipt_name_key",
  "normalize_ean",
]);

/**
 * fetch для клієнта Supabase: той самий, лише запис старого коду не пускає.
 *
 * Відмова — готова відповідь 426 (Upgrade Required) з тілом у форматі
 * PostgREST, а не кинутий виняток: так supabase-js віддає її як звичайну
 * помилку з нашим повідомленням, без префікса «TypeError:», і не пробує
 * повторити запит. Глобальний fetch беремо в мить виклику — підмінений
 * у тестах чи розширеннями він так само спрацює.
 */
export function guardStaleWrites(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (clientStale) {
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const url = isRequest ? input.url : String(input);
    const method = init?.method ?? (isRequest ? input.method : undefined);
    if (isDatabaseWrite(url, method)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: STALE_WRITE_CODE, message: STALE_WRITE_MESSAGE, details: null, hint: null }),
          { status: 426, statusText: "Upgrade Required", headers: { "Content-Type": "application/json" } },
        ),
      );
    }
  }
  return fetch(input, init);
}
