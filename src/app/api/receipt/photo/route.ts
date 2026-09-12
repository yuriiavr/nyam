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

/**
 * Яка модель читає чек.
 *
 * Тут потрібні очі, а не розум: переписати те, що надруковано, і не
 * домислювати. Найдешевша модель, яка це вміє, — flash-lite, і різниця з
 * старшими не в якості розпізнавання, а в ціні роздумів, яких ми тут не
 * просимо.
 *
 * Порядок величин на один чек: саме фото — це десяток плиток 768×768,
 * тобто дві-три тисячі вхідних токенів, плюс підказка й сотень вісім
 * вихідних на готовий JSON. Разом виходить менше десятої частини цента;
 * на старшій моделі з увімкненими роздумами — у півтора десятка разів
 * більше за те саме.
 *
 * У змінних оточення цього свідомо немає: вибір моделі — рішення про те,
 * як застосунок працює, і його місце в коді, поруч із підказкою, під яку
 * він і підібраний.
 */
const MODEL = "gemini-2.5-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Ліміт на одного користувача: кожен виклик коштує грошей, на відміну від ДПС.
 *
 * Лічильник живе в памʼяті інстанса, а їх на Vercel багато й вони недовгі —
 * тож це заслін від зациклених клієнтів і випадкового натискання, а не від
 * того, хто справді візьметься витрачати чужий ключ. Справжня стеля має
 * стояти на боці Google, у налаштуваннях самого ключа.
 */
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60 * 60_000;
const hits = new Map<string, number[]>();

/**
 * Стеля для картинки, у символах base64 (це приблизно на третину більше за
 * самі байти). Свідомо нижча за межу тіла запиту на Vercel — інакше перевірка
 * нічого не значила б: платформа відрізала б запит ще до цього коду. Фото
 * чека після стиснення важить пів мегабайта, тож трьох вистачить із запасом.
 */
const MAX_BASE64 = 3 * 1024 * 1024;

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

/**
 * Лічильник по користувачу, а не по адресі.
 *
 * За адресою виходило двічі неправильно: мобільний інтернет міняє IP і дає
 * нову квоту з нічого, а двоє вдома за одним роутером ділять дванадцять
 * спроб на всіх і блокують одне одного. Ідентифікатор ми вже маємо — його
 * щойно підтвердив Supabase.
 */
function overRateLimit(userId: string): boolean {
  const now = Date.now();
  // Мапа живе в памʼяті інстанса; без стелі забутий рядок сусіда тримав би
  // її вічно. Той самий заслін, що й у маршруті до податкової.
  if (hits.size > 5_000) hits.clear();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.set(userId, recent);

  /*
   * Рахуємо лише пропущені запити. Якби сюди потрапляли й відбиті, кожна
   * наступна спроба відсувала б кінець блокування на годину вперед — і той,
   * хто чесно натискає «ще раз», не дочекався б ніколи.
   */
  if (recent.length >= RATE_LIMIT) return true;
  recent.push(now);
  return false;
}

/**
 * Чи це справді наш користувач.
 *
 * На відміну від маршруту до податкової, цей коштує грошей за кожен виклик,
 * тож відкритим він бути не може. Перевіряємо токен сесії там же, де його
 * видали, — у Supabase; своїх ключів для цього не треба.
 */
async function userFromRequest(request: Request, left: () => number): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return null;

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(Math.min(8000, left())),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string };
    return user.id ?? null;
  } catch {
    return null;
  }
}

function fail(reason: string, status = 200) {
  return Response.json({ ok: false, reason }, { status });
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail("nokey");

  /*
   * Спільний дедлайн на весь маршрут. Інакше повільна перевірка сесії
   * додавалася б до очікування моделі, разом вони перевалювали б за
   * клієнтські 55 секунд — і людина бачила б «немає звʼязку» на відповідь,
   * яка вже прийшла й за яку вже заплачено.
   */
  const deadline = Date.now() + 45_000;
  const left = () => Math.max(1000, deadline - Date.now());

  const userId = await userFromRequest(request, left);
  if (!userId) return fail("unauthorized", 401);
  if (overRateLimit(userId)) return fail("throttled", 429);

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
  if (!data) return fail("unreadable");
  if (data.length > MAX_BASE64) return fail("toobig");

  try {
    const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(left()),
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
          /*
           * Роздуми вимкнені. Вони коштують вихідних токенів — найдорожчого,
           * що тут є, — а користі не дають: переписати рядок із чека нема над
           * чим думати. Поле розуміють моделі 2.5; якщо колись поставиш сюди
           * старішу, цей рядок треба прибрати, інакше запит відхилять.
           */
          thinkingConfig: { thinkingBudget: 0 },
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
