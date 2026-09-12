#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

/**
 * Що вміє твій ключ Gemini і скільки коштуватиме чек.
 *
 *   npm run check:gemini              — які моделі доступні саме цьому ключу
 *   npm run check:gemini фото.jpg     — плюс справжнє розпізнавання цього фото
 *
 * Навіщо: перелік моделей і ціни міняються швидше за будь-який README, а
 * назва, якої в ключа немає, падає звичайним 404 уже в застосунку. Простіше
 * спитати сам сервіс, ніж вірити документації піврічної давнини.
 */

function loadEnv() {
  const merged = {};
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.includes("=") || line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      merged[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return merged;
}

const env = loadEnv();
const KEY = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

if (!KEY) {
  console.error("✗ Немає GEMINI_API_KEY. Поклади його в .env.local за зразком .env.example");
  process.exit(1);
}

const API = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Модель і налаштування роздумів беремо з того самого файлу, що й застосунок:
 * інакше перевірка одного дня почне хвалити не те, що працює.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { GEMINI_MODEL: IN_USE, GEMINI_THINKING } = await jiti.import(
  path.join(root, "src/lib/vision.ts"),
);

const res = await fetch(`${API}/models?pageSize=200`, {
  headers: { "x-goog-api-key": KEY },
});

if (!res.ok) {
  console.error(`✗ Ключ не прийнято (${res.status}). Перевір його в Google AI Studio.`);
  console.error((await res.text()).slice(0, 400));
  process.exit(1);
}

const { models = [] } = await res.json();

// Лишаємо те, що вміє відповідати на запит із картинкою.
const usable = models
  .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
  .map((m) => m.name.replace(/^models\//, ""))
  .filter((n) => !/embedding|aqa|imagen|veo|tts|image-generation/i.test(n))
  .sort();

console.log(`── Доступно моделей: ${usable.length} ──\n`);

// Найдешевші — «lite»; саме серед них шукати заміну.
const lite = usable.filter((n) => n.includes("lite"));
console.log("Найдешевший ряд (lite):");
for (const n of lite) console.log(`  ${n === IN_USE ? "→" : " "} ${n}`);

console.log("\nРешта:");
for (const n of usable.filter((n) => !n.includes("lite"))) console.log(`    ${n}`);

/*
 * Перелік — не обіцянка. Частину моделей Google лишає в `models.list`, але
 * новим ключам уже не дає: gemini-2.5-flash-lite у списку є, а на запит
 * відповідає 404. Тому перевіряємо справжнім викликом, найменшою можливою
 * картинкою — і заразом тим самим набором налаштувань, що й застосунок.
 */
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function probe(model, thinking) {
  const res = await fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: "Перепиши товари з чека." },
            { inline_data: { mime_type: "image/png", data: PIXEL } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        ...(thinking ? { thinkingConfig: GEMINI_THINKING } : {}),
      },
    }),
  });
  return { ok: res.ok, status: res.status, body: res.ok ? "" : (await res.text()).slice(0, 200) };
}

console.log(`\n── Чи працює те, що просить застосунок ──`);
const withThinking = await probe(IN_USE, true);
if (withThinking.ok) {
  console.log(`✓ «${IN_USE}» відповідає, і роздуми вимикаються — саме так її й викликаємо.`);
} else {
  const plain = await probe(IN_USE, false);
  if (plain.ok) {
    console.log(
      `⚠ «${IN_USE}» відповідає, але не приймає ці роздуми (${withThinking.status}).` +
        "\n  Виправ GEMINI_THINKING у src/lib/vision.ts — інакше кожне фото падатиме.",
    );
  } else {
    console.log(
      `✗ «${IN_USE}» не відповідає (${withThinking.status}). Фото чека падатиме.` +
        `\n  ${withThinking.body}` +
        "\n  Постав у src/lib/vision.ts іншу назву з переліку вище.",
    );
  }
}

console.log(
  "\nЦіни тут не показати: їх немає в API. Дивись ai.google.dev/pricing —" +
    "\nдля цієї роботи важливі лише дві цифри: вхід і вихід за мільйон токенів.",
);

/* ── Справжнє розпізнавання, якщо дали фото ───────────────────────────── */

const photo = process.argv[2];
if (!photo) {
  console.log("\nДодай шлях до фото чека, щоб перевірити розпізнавання:");
  console.log("  npm run check:gemini -- ~/чек.jpg");
  process.exit(0);
}

if (!existsSync(photo)) {
  console.error(`\n✗ Немає файлу ${photo}`);
  process.exit(1);
}

const bytes = readFileSync(photo);
const mime = /\.png$/i.test(photo) ? "image/png" : "image/jpeg";
console.log(`\n── Читаю ${photo} (${Math.round(bytes.length / 1024)} КБ) ──`);

const started = Date.now();
const answer = await fetch(`${API}/models/${IN_USE}:generateContent`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
  body: JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Це фотографія касового чека з українського магазину. Перепиши з нього" +
              " лише рядки товарів: назву точно як надруковано, кількість, міру, ціну" +
              " за одиницю й суму. Поверни JSON {store, lines:[{name,qty,measure,price,sum}]}.",
          },
          { inline_data: { mime_type: mime, data: bytes.toString("base64") } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      thinkingConfig: GEMINI_THINKING,
    },
  }),
});

if (!answer.ok) {
  console.error(`✗ ${answer.status}: ${(await answer.text()).slice(0, 500)}`);
  process.exit(1);
}

const json = await answer.json();
const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
const usage = json.usageMetadata ?? {};

console.log(
  `Токенів: вхід ${usage.promptTokenCount ?? "?"}, вихід ${usage.candidatesTokenCount ?? "?"}` +
    ` · ${((Date.now() - started) / 1000).toFixed(1)} с`,
);

try {
  const parsed = JSON.parse(text);
  const lines = parsed.lines ?? [];
  console.log(`\n${parsed.store ? parsed.store + " · " : ""}${lines.length} рядків:\n`);
  for (const l of lines.slice(0, 40)) {
    const qty = l.qty ? `${l.qty}${l.measure ? " " + l.measure : ""}` : "";
    console.log(`  ${l.name}${qty ? `  — ${qty}` : ""}${l.sum ? `  ${l.sum} грн` : ""}`);
  }
} catch {
  console.log("\nВідповідь не розібралась як JSON:\n", text.slice(0, 800));
}
