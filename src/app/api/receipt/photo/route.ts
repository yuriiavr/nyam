import type { Receipt, ReceiptLine } from "@/lib/receipt";

/**
 * Чек із фотографії.
 *
 * QR на фіскальному чеку дає ідеальні дані — назви, кількості й ціни просто з
 * податкової. Але QR є не завжди: він вицвітає, його зминають, а на
 * нефіскальному папірці з ринку його не було й не буде. Тоді лишається те, що
 * бачить людина, — і Gemini читає з фото те саме.
 *
 * Модель навмисно просимо переписати касові назви буквально, не «покращуючи»:
 * «МОЛОКО ПАСТ.2,5% ГАЛИЧИНА 900Г» наш розбір скорочень уже вміє, а от
 * вигадане нею «молоко» втрачає і жирність, і вагу, і виробника. Тобто модель
 * тут виконує роботу очей, а не голови: далі все робить той самий код, що й
 * для QR, і останнє слово однаково лишається за людиною.
 *
 * Ключ живе лише на сервері: у браузер він не потрапляє ніколи.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Розпізнавання фото триває довше за запит до податкової. */
export const maxDuration = 60;

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Ліміт на одного відвідувача: кожен виклик коштує грошей, на відміну від ДПС. */
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60 * 60_000;
const hits = new Map<string, number[]>();

/** Більше за це не пропускаємо: фото чека після стиснення важить пів мегабайта. */
const MAX_BYTES = 6 * 1024 * 1024;

const PROMPT = `Це фотографія касового чека з українського магазину.

Перепиши з нього ЛИШЕ рядки товарів. Для кожного:
- name: назва точно як надрукована, включно зі скороченнями, вагою, відсотками
  й виробником. Нічого не виправляй, не перекладай і не «покращуй»: «МОЛОКО
  ПАСТ.2,5% ГАЛИЧИНА 900Г» лишається саме таким рядком.
- qty: кількість у мірі каси (число). Якщо не вказана — 1.
- measure: міра каси, як надрукована: «шт», «кг», «л».
- price: ціна за одиницю в гривнях.
- sum: сума рядка в гривнях.

Не включай: суму до сплати, решту, знижки, ПДВ, акцизи, бонуси, номер каси,
адресу, слова подяки. Якщо рядок нерозбірливий — пропусти його, не вгадуй.
store: назва мережі або магазину з шапки чека, якщо видно.

Якщо на фото взагалі не чек — поверни порожній масив lines.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    store: { type: "STRING" },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          qty: { type: "NUMBER" },
          measure: { type: "STRING" },
          price: { type: "NUMBER" },
          sum: { type: "NUMBER" },
        },
        required: ["name"],
      },
    },
  },
  required: ["lines"],
};

function overRateLimit(request: Request): boolean {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

/**
 * Чи це справді наш користувач.
 *
 * На відміну від маршруту до податкової, цей коштує грошей за кожен виклик,
 * тож відкритим він бути не може. Перевіряємо токен сесії там же, де його
 * видали, — у Supabase; своїх ключів для цього не треба.
 */
async function authorized(request: Request): Promise<boolean> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return false;

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function fail(reason: string, status = 200) {
  return Response.json({ ok: false, reason }, { status });
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail("nokey");

  if (!(await authorized(request))) return fail("unauthorized", 401);
  if (overRateLimit(request)) return fail("throttled", 429);

  let image: string;
  try {
    const body = (await request.json()) as { image?: string };
    image = body.image ?? "";
  } catch {
    return fail("unreadable");
  }

  // Приймаємо і data:URL, і чистий base64 — залежить від того, звідки прийшло.
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(image);
  const mime = match ? match[1] : "image/jpeg";
  const data = match ? match[2] : image;
  if (!data || data.length > MAX_BYTES) return fail("unreadable");

  try {
    const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(50_000),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data } }],
          },
        ],
        generationConfig: {
          // Нуль, бо це переписування побаченого, а не творчість.
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[receipt-photo] ${res.status}: ${detail.slice(0, 300)}`);
      return fail(res.status === 429 ? "throttled" : "upstream");
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) return fail("unreadable");

    const parsed = JSON.parse(text) as {
      store?: string;
      lines?: Array<Partial<ReceiptLine>>;
    };

    /*
     * Чистимо те, що прийшло. Модель просили не вигадувати, але перевірити
     * дешевше, ніж довіряти: рядок без назви не товар, а відʼємна кількість
     * не буває.
     */
    const lines: ReceiptLine[] = (parsed.lines ?? [])
      .filter((l) => typeof l.name === "string" && l.name.trim().length > 1)
      .slice(0, 120)
      .map((l) => ({
        name: (l.name as string).trim(),
        qty: typeof l.qty === "number" && l.qty > 0 ? l.qty : 1,
        measure: typeof l.measure === "string" ? l.measure.trim() || undefined : undefined,
        price: typeof l.price === "number" && l.price >= 0 ? l.price : undefined,
        sum: typeof l.sum === "number" && l.sum >= 0 ? l.sum : undefined,
      }));

    if (lines.length === 0) return fail("noitems");

    const receipt: Receipt = {
      store: typeof parsed.store === "string" ? parsed.store.trim() || undefined : undefined,
      lines,
    };
    return Response.json({ ok: true, receipt });
  } catch (error) {
    console.warn("[receipt-photo]", error);
    return fail("upstream");
  }
}
