import {
  parseCheckXml,
  parseReceiptQr,
  receiptDateTime,
  storeFromCheckText,
  type Receipt,
  type ReceiptResult,
} from "@/lib/receipt";

/**
 * Проксі до пошуку фіскального чека в Електронному кабінеті ДПС.
 *
 * Навіщо взагалі сервер у застосунку, який усе робить у браузері: податкова
 * не віддає CORS-заголовків, тож прямий fetch зі сторінки падає ще до
 * відповіді. Більше цей маршрут не робить нічого — ані бази, ані стану.
 * Ендпоїнт податкової публічний, тож ані ключів, ані змінних оточення тут
 * не потрібно: сканування чека нічого не додає до того, що проєкт і так
 * вимагає для входу.
 *
 * Доступ до чека дає сам чек: без точного номера каси, номера документа,
 * хвилини й суми до копійки нічого не знайдеться. Тобто прочитати чужий чек
 * перебором не вийде — треба тримати папірець із QR у руках.
 *
 * Єдине, що тримає цю обіцянку, — сума з копійками: номер каси надрукований
 * на кожному чеку з неї, номер документа послідовний, дата вгадується. Тому
 * маршрут рахує запити: без ліміту він був би зручним перебирачем сум, ще й
 * з нашим IP у журналах податкової.
 */

const UPSTREAM = "https://cabinet.tax.gov.ua/ws/api_public/rro/chkAllWeb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Податкова відповідає близько трьох секунд; беремо запас на повільну мережу. */
export const maxDuration = 30;

interface UpstreamCheck {
  /** Текстова копія чека, base64 у UTF-8. */
  check?: string | null;
  /** Той самий чек структурою, base64 у windows-1251. */
  checkXml?: string | null;
  /** Продавець окремим полем — надійніше, ніж вгадувати його з шапки. */
  name?: string | null;
}

/**
 * Ліміт запитів на одного відвідувача.
 *
 * Лічильник живе в памʼяті інстансу, а їх на Vercel багато й вони недовгі —
 * тож це заслін від зациклених клієнтів і простих скриптів, а не від того,
 * хто справді візьметься перебирати. Але навіть він перетворює перебір суми
 * на щось, що видно й дорого коштує.
 */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function overRateLimit(request: Request): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();

  const fresh = (hits.get(ip) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  fresh.push(now);
  // Мапа не має рости безмежно: інстанс живе довше за одну хвилину.
  if (hits.size > 5_000) hits.clear();
  hits.set(ip, fresh);

  return fresh.length > RATE_LIMIT;
}

function json(body: ReceiptResult, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Чек — це де і коли людина була. Такому не місце в жодному кеші.
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (overRateLimit(request)) return json({ ok: false, reason: "throttled" }, 429);

  const params = new URL(request.url).searchParams;

  /*
   * Перевіряємо тим самим розбором, що й у браузері: параметри прийшли з QR,
   * і формат у них рівно один. Заразом це відсікає спроби зробити з маршруту
   * універсальний проксі — усе, що не схоже на чек, далі не йде.
   */
  const query = parseReceiptQr(params.toString());
  if (!query) return json({ ok: false, reason: "notfound" }, 400);

  const upstream =
    `${UPSTREAM}?id=${encodeURIComponent(query.id)}` +
    `&date=${encodeURIComponent(receiptDateTime(query))}` +
    `&type=3&captcha=0` +
    `&fn=${encodeURIComponent(query.fn)}` +
    `&sm=${encodeURIComponent(query.sm)}`;

  let payload: UpstreamCheck;
  try {
    const res = await fetch(upstream, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) return json({ ok: false, reason: "upstream" }, 502);
    payload = (await res.json()) as UpstreamCheck;
  } catch {
    return json({ ok: false, reason: "upstream" }, 504);
  }

  /*
   * Ненайдений чек податкова віддає як HTTP 200 з порожнім полем check —
   * не 404. Тому дивимось саме на поле, а не на статус відповіді.
   */
  if (!payload.check) return json({ ok: false, reason: "notfound" }, 404);

  const receipt: Receipt = {
    store: payload.name?.trim() || storeFromCheckText(decodeBase64(payload.check, "utf-8")),
    // XML податкова віддає у windows-1251 — у ньому вся українська номенклатура.
    lines: payload.checkXml ? parseCheckXml(decodeBase64(payload.checkXml, "windows-1251")) : [],
  };

  if (receipt.lines.length === 0) return json({ ok: false, reason: "noitems" }, 404);
  return json({ ok: true, receipt });
}

function decodeBase64(value: string, encoding: string): string {
  const bytes = Buffer.from(value, "base64");
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    // Немає такого кодування в збірці Node — краще частково зіпсований текст,
    // ніж помилка на весь чек.
    return bytes.toString("utf8");
  }
}
