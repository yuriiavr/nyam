#!/usr/bin/env node
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Перевірка рішень про сповіщення й встановлення.
 *
 * Запуск: npm run check:push
 *
 * Браузера не потребує: і таблиця «пропонувати чи ні», і розпізнавання, де
 * відкрито сторінку, — чисті функції. Рядки браузерів нижче — справжні, у тому
 * вигляді, в якому їх присилають телефони; саме на них ламається найчастіше:
 * iPad, що називає себе Mac-ом, Safari 26 із застиглою версією iOS і вбудовані
 * браузери, схожі на Safari.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { pushOfferStep, pushOutcome, timerMayAsk, timerPushStep, OFFER_PAUSE_DAYS, OFFER_LATER_LIMIT } =
  await jiti.import(path.join(root, "src/lib/push.ts"));
const {
  installEnvironment,
  inAppName,
  iosBrowserName,
  appleDevice,
  safariVersion,
  iosShareSpot,
  installWaitDue,
  INSTALL_WAIT_PAUSE_DAYS,
} = await jiti.import(path.join(root, "src/lib/pwa.ts"));

let pass = 0;
let fail = 0;
const check = (what, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    pass++;
    return;
  }
  fail++;
  console.log(`  ✗ ${what}\n      отримано: ${JSON.stringify(actual)}\n      очікувано: ${JSON.stringify(expected)}`);
};

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-13T12:00:00Z");
const device = (permission, browser = false, server = false) => ({ permission, browser, server });
const record = (outcome, daysAgo = 0, count = 0) => ({
  outcome,
  at: new Date(NOW - daysAgo * DAY).toISOString(),
  count,
});

/*
 * Те саме, що робить setPushOffer у сховищі: «later» додає до лічильника,
 * будь-яка інша відповідь його скидає. Сховище саме бере «зараз» із годинника,
 * тож для перевірки з часом повторюємо його тут.
 */
const answer = (prev, outcome, at) => ({
  outcome,
  at: new Date(at).toISOString(),
  count: outcome === "later" ? (prev?.count ?? 0) + 1 : 0,
});

console.log("── Пропозиція на старті ──");

check("константи: пауза", OFFER_PAUSE_DAYS, 7);
check("константи: ліміт «не зараз»", OFFER_LATER_LIMIT, 2);

// Заблоковано — питати марно, хоч що записано.
for (const r of [null, record("enabled"), record("later", 30, 1), record("never"), record("off")]) {
  check(`заблоковано, запис ${r?.outcome ?? "немає"}`, pushOfferStep(device("denied"), r, NOW), "skip");
}

check("підписано й сервер знає, запису немає", pushOfferStep(device("granted", true, true), null, NOW), "record-enabled");
check("підписано й сервер знає, «later»", pushOfferStep(device("granted", true, true), record("later", 1, 1), NOW), "record-enabled");
check("підписано й уже «enabled»", pushOfferStep(device("granted", true, true), record("enabled"), NOW), "skip");
check("підписано, а сервер не знає", pushOfferStep(device("granted", true, false), null, NOW), "skip");

check("новий пристрій", pushOfferStep(device("default"), null, NOW), "offer");
check("дозволено, але не підписано", pushOfferStep(device("granted"), null, NOW), "offer");
check("«enabled», а підписка зникла (вихід з акаунта)", pushOfferStep(device("granted"), record("enabled", 40), NOW), "offer");
check("«later» учора", pushOfferStep(device("default"), record("later", 1, 1), NOW), "skip");
check("«later» 6 днів тому", pushOfferStep(device("default"), record("later", 6.9, 1), NOW), "skip");
check("«later» рівно 7 днів тому", pushOfferStep(device("default"), record("later", 7, 1), NOW), "offer");
check("«later» двічі, 30 днів тому", pushOfferStep(device("default"), record("later", 30, 2), NOW), "skip");
check("«never»", pushOfferStep(device("default"), record("never", 90), NOW), "skip");
check("«off»", pushOfferStep(device("granted"), record("off", 90), NOW), "skip");
check(
  "зіпсована дата — мовчимо",
  pushOfferStep(device("default"), { outcome: "later", at: "не дата", count: 1 }, NOW),
  "skip",
);

console.log("── Відповідь після спроби ──");

check("увімкнено", pushOutcome({ state: "on" }), "enabled");
check("закрили вікно", pushOutcome({ state: "dismissed" }), "later");
// Блок — не «never»: його памʼятає сам дозвіл, і розблокування повертає пропозицію.
check("заблокували — не записуємо", pushOutcome({ state: "denied" }), null);
check("збій — не вибір людини", pushOutcome({ state: "failed", reason: "x" }), null);
check("не вміє — не вибір людини", pushOutcome({ state: "unsupported", reason: "x" }), null);

console.log("── Блок і розблокування ──");

{
  // Людина натиснула «Увімкнути», а у вікні — «Заблокувати».
  let rec = null;
  check("спершу пропонуємо", pushOfferStep(device("default"), rec, NOW), "offer");
  const outcome = pushOutcome({ state: "denied" });
  if (outcome) rec = answer(rec, outcome, NOW);
  check("після блоку запис лишився порожнім", rec, null);
  check("поки заблоковано — мовчимо", pushOfferStep(device("denied"), rec, NOW + DAY), "skip");
  check("таймер поки заблоковано — не питає", timerMayAsk("denied", rec, NOW + DAY), false);
  // Розблокувала в налаштуваннях телефона (або Chrome зняв тимчасову заборону).
  check("розблокувала — пропозиція повертається", pushOfferStep(device("default"), rec, NOW + 2 * DAY), "offer");
  check("розблокувала — таймер знову питає", timerMayAsk("default", rec, NOW + 2 * DAY), true);
}

{
  // Блок після «не зараз»: пауза й лічильник мають лишитись, як були.
  let rec = answer(null, "later", NOW - 10 * DAY);
  const outcome = pushOutcome({ state: "denied" });
  if (outcome) rec = answer(rec, outcome, NOW);
  check("блок не скидає лічильник «не зараз»", rec.count, 1);
  check("після розблокування діє стара пауза", pushOfferStep(device("default"), rec, NOW), "offer");
}

console.log("── Скільки разів пропонуємо ──");

{
  // Щовісім днів відкриває застосунок і щоразу тисне «Не зараз».
  let rec = null;
  let shown = 0;
  for (let day = 0; day <= 120; day += 8) {
    const at = NOW + day * DAY;
    if (pushOfferStep(device("default"), rec, at) === "offer") {
      shown++;
      rec = answer(rec, "later", at);
    }
  }
  check("«не зараз» щоразу — аркуш двічі", shown, 2);
}

{
  // Щодня відкриває: між пропозиціями має минати пауза, не менше.
  let rec = null;
  const days = [];
  for (let day = 0; day <= 60; day += 1) {
    const at = NOW + day * DAY;
    if (pushOfferStep(device("default"), rec, at) === "offer") {
      days.push(day);
      rec = answer(rec, "later", at);
    }
  }
  check("щоденні відкриття — у дні 0 і 7", days, [0, 7]);
}

{
  // Закрила системне вікно (dismissed) — це «не зараз», а не блок.
  let rec = answer(null, pushOutcome({ state: "dismissed" }), NOW);
  check("закрите вікно рахується як «не зараз»", [rec.outcome, rec.count], ["later", 1]);
  check("і через тиждень питаємо знову", pushOfferStep(device("default"), rec, NOW + 7 * DAY), "offer");
  rec = answer(rec, "enabled", NOW + 7 * DAY);
  check("«так» скидає лічильник", rec.count, 0);
}

console.log("── Таймер готування ──");

// owner — чи цей акаунт сам вмикав сповіщення на пристрої (див. rememberPushOwner).
const timer = (what, permission, rec, expected, owner = true) =>
  check(`таймер: ${what}`, timerPushStep(permission, rec, owner, NOW), expected);

timer("новий пристрій", "default", null, "ask");
timer("«later» учора", "default", record("later", 1, 1), "none");
timer("«later» 8 днів тому", "default", record("later", 8, 1), "ask");
timer("«later» двічі, давно", "default", record("later", 60, 2), "none");
timer("«never»", "default", record("never", 60), "none");
timer("«off»", "default", record("off", 60), "none");
timer("«enabled», а дозвіл скинули", "default", record("enabled", 60), "ask");
// Уже дозволено: вмикала сама — відновлюємо підписку; не вмикала — мовчки не підписуємо.
timer("дозволено й «enabled» — відновити", "granted", record("enabled", 60), "restore");
timer("дозволено, запису немає", "granted", null, "none");
timer("дозволено, «later» давно й тричі", "granted", record("later", 30, 3), "none");
timer("дозволено, «off»", "granted", record("off", 1), "none");
timer("дозволено, «never»", "granted", record("never", 1), "none");
timer("заблоковано, «enabled»", "denied", record("enabled", 1), "none");
timer("заблоковано, запису немає", "denied", null, "none");
// Спільний планшет: вмикав інший акаунт і вийшов. Мовчки підписувати нового не можна,
// а якщо дозвіл скинуто — вікно спитає його самого.
timer("«enabled» чужого акаунта — не відновлювати", "granted", record("enabled", 1), "none", false);
timer("«enabled» чужого акаунта, дозвіл скинуто — питати", "default", record("enabled", 1), "ask", false);

check("timerMayAsk — лише «ask»", timerMayAsk("granted", record("enabled"), NOW), false);
check("timerMayAsk — новий пристрій", timerMayAsk("default", null, NOW), true);

console.log("── Де відкрито ──");

const UA = {
  iphoneSafari26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iphoneSafari18:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneWebApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  ipadOld:
    "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
  iosInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.108 (iPhone15,2; iOS 17_5; uk_UA; uk; scale=3.00; 1179x2556; 619461904)",
  iosFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.108;FBBV/617094458;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/uk_UA;FBOP/5;FBRV/0]",
  iosMessenger:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0.0.29.109;FBBV/617094458;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/uk_UA;FBOP/0]",
  // Telegram на iPhone відкриває у власному WKWebView — рядок без «Safari/».
  iosTelegram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iosGoogleApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/325.0.681674034 Mobile/15E148 Safari/604.1",
  iosSnapchat:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.0.0.43 (like Safari/8618.1.15.10.15, panda)",
  iosLine:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0",
  iosLinkedIn:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1286",
  iosCrios:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iosFxios:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iosEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.2592.56 Mobile/15E148 Safari/605.1.15",
  ipadCrios:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0",
  androidInstagram:
    "Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 Instagram 339.0.0.30.105 Android (34/14; 480dpi; 1080x2340; samsung; SM-S921B; e1s; s5e9945; uk_UA; 619461904)",
  androidFacebook:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/474.0.0.52.74;]",
  androidMessenger:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/468.0.0.46.108;]",
  androidTelegram:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 Telegram-Android/11.2.2 (Google Pixel 8; Android 14; SDK 34; HIGH)",
  androidTikTok:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36 trill_350803 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/35.8.3 ByteLocale/uk Region/UA BytedanceWebview/d8a21c6",
  androidViber:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36 Viber/22.6.0.0",
  androidWeChat:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36 XWEB/1260117 MMWEBSDK/20240404 MMWEBID/2307 MicroMessenger/8.0.49.2600(0x28003133) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  linuxChrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  desktopEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  desktopFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
};

const env = (what, ua, touch, expected, { standalone = false, bridge = false } = {}) =>
  check(`${what}`, installEnvironment(ua, touch, standalone, bridge), expected);

env("iPhone, Safari 26", UA.iphoneSafari26, 5, "ios-safari");
env("iPhone, Safari 18", UA.iphoneSafari18, 5, "ios-safari");
env("iPhone, з Початкового екрана", UA.iphoneWebApp, 5, "standalone", { standalone: true });
env("iPad, Safari з рядком Mac", UA.ipadDesktop, 5, "ipad-safari");
env("iPad, старий рядок", UA.ipadOld, 5, "ipad-safari");
env("iPad, встановлений", UA.ipadDesktop, 5, "standalone", { standalone: true });
env("Mac, Safari (без дотику)", UA.macSafari, 0, "unsupported");
env("iPhone, Instagram", UA.iosInstagram, 5, "in-app");
env("iPhone, Facebook", UA.iosFacebook, 5, "in-app");
env("iPhone, Messenger", UA.iosMessenger, 5, "in-app");
env("iPhone, Telegram (WKWebView)", UA.iosTelegram, 5, "in-app");
env("iPhone, Telegram з рядком Safari, але з мостом", UA.iphoneSafari26, 5, "in-app", { bridge: true });
env("iPhone, застосунок Google", UA.iosGoogleApp, 5, "in-app");
env("iPhone, Snapchat (з «like Safari/»)", UA.iosSnapchat, 5, "in-app");
env("iPhone, LINE", UA.iosLine, 5, "in-app");
env("iPhone, LinkedIn", UA.iosLinkedIn, 5, "in-app");
env("iPhone, Chrome", UA.iosCrios, 5, "ios-other-browser");
env("iPhone, Firefox", UA.iosFxios, 5, "ios-other-browser");
env("iPhone, Edge", UA.iosEdge, 5, "ios-other-browser");
env("iPad, Chrome", UA.ipadCrios, 5, "ios-other-browser");
env("Android, Chrome", UA.androidChrome, 5, "prompt");
env("Android, Samsung Internet", UA.androidSamsung, 5, "prompt");
env("Android, Chrome, встановлений", UA.androidChrome, 5, "standalone", { standalone: true });
env("Android, Firefox", UA.androidFirefox, 5, "unsupported");
env("Android, Instagram", UA.androidInstagram, 5, "in-app");
env("Android, Facebook", UA.androidFacebook, 5, "in-app");
env("Android, Messenger", UA.androidMessenger, 5, "in-app");
env("Android, Telegram", UA.androidTelegram, 5, "in-app");
env("Android, TikTok", UA.androidTikTok, 5, "in-app");
env("Android, Viber", UA.androidViber, 5, "in-app");
env("Android, WeChat", UA.androidWeChat, 5, "in-app");
env("Android, безіменний WebView", UA.androidWebView, 5, "in-app");
env("Windows, Chrome", UA.desktopChrome, 0, "prompt");
env("Linux, Chrome", UA.linuxChrome, 0, "prompt");
env("Windows, Edge", UA.desktopEdge, 0, "prompt");
env("Windows, Firefox", UA.desktopFirefox, 0, "unsupported");
// Ноутбук із сенсорним екраном — не iPad: рядок не Mac.
env("Windows, Chrome із сенсорним екраном", UA.desktopChrome, 10, "prompt");

console.log("── Як назвати людині ──");

check("назва: Instagram", inAppName(UA.iosInstagram), "Instagram");
check("назва: Facebook", inAppName(UA.androidFacebook), "Facebook");
check("назва: Messenger, а не Facebook (iPhone)", inAppName(UA.iosMessenger), "Messenger");
check("назва: Messenger, а не Facebook (Android)", inAppName(UA.androidMessenger), "Messenger");
check("назва: Telegram", inAppName(UA.androidTelegram), "Telegram");
check("назва: TikTok", inAppName(UA.androidTikTok), "TikTok");
check("назва: Viber", inAppName(UA.androidViber), "Viber");
check("назва: WeChat", inAppName(UA.androidWeChat), "WeChat");
check("назва: LINE", inAppName(UA.iosLine), "LINE");
check("назва: LinkedIn", inAppName(UA.iosLinkedIn), "LinkedIn");
check("назва: Snapchat", inAppName(UA.iosSnapchat), "Snapchat");
check("«Linux» — не LINE", inAppName(UA.linuxChrome), null);
check("Safari — не вбудований", inAppName(UA.iphoneSafari26), null);
check("безіменний WebView — без назви", inAppName(UA.androidWebView), null);
check("браузер: Chrome на iPhone", iosBrowserName(UA.iosCrios), "Chrome");
check("браузер: Firefox на iPhone", iosBrowserName(UA.iosFxios), "Firefox");
check("браузер: Edge на iPhone", iosBrowserName(UA.iosEdge), "Edge");
check("браузер: Safari — не «інший»", iosBrowserName(UA.iphoneSafari26), null);

console.log("── Де кнопка «Поширити» ──");

check("пристрій: iPhone", appleDevice(UA.iphoneSafari26, 5), "iPhone");
check("пристрій: iPad з рядком Mac", appleDevice(UA.ipadDesktop, 5), "iPad");
check("пристрій: Mac", appleDevice(UA.macSafari, 0), null);
check("пристрій: Android", appleDevice(UA.androidChrome, 5), null);
check("версія Safari 26", safariVersion(UA.iphoneSafari26), 26);
check("версія Safari 18", safariVersion(UA.iphoneSafari18), 18);
check("без версії Safari", safariVersion(UA.iosTelegram), null);
// iOS 26: у компактній панелі «Поширити» сховано в «•••».
check("iPhone, Safari 26 — у меню «•••»", iosShareSpot(UA.iphoneSafari26, 5), "more-menu");
check("iPhone, Safari 18 — на панелі внизу", iosShareSpot(UA.iphoneSafari18, 5), "toolbar");
check("iPad — угорі праворуч", iosShareSpot(UA.ipadDesktop, 5), "top-right");
check("iPad зі старим рядком — угорі праворуч", iosShareSpot(UA.ipadOld, 5), "top-right");

console.log("── Очікування на вікно встановлення ──");

{
  const ago = (days) => new Date(NOW - days * DAY).toISOString();
  check("константа: пауза очікування", INSTALL_WAIT_PAUSE_DAYS, 7);
  check("ще не чекали — чекаємо", installWaitDue(null, NOW), true);
  check("чекали марно вчора — не чекаємо", installWaitDue(ago(1), NOW), false);
  check("чекали марно 6.9 дня тому — не чекаємо", installWaitDue(ago(6.9), NOW), false);
  check("минув тиждень — чекаємо знову", installWaitDue(ago(7), NOW), true);
  check("зіпсована дата — чекаємо", installWaitDue("не дата", NOW), true);
  // Годинник перевели назад: дата «з майбутнього» не має вимкнути очікування надовго.
  check("дата з майбутнього — чекаємо", installWaitDue(ago(-30), NOW), true);

  // Chrome, де вікна не буде ніколи (Ням уже встановлено, відкрито вкладку): щоденні запуски.
  let last = null;
  let waits = 0;
  for (let day = 0; day < 30; day += 1) {
    const at = NOW + day * DAY;
    if (installWaitDue(last, at)) {
      waits++;
      last = new Date(at).toISOString();
    }
  }
  check("місяць щоденних запусків — чекаємо раз на тиждень", waits, 5);
}

/* ══ Будильник готування з сервера ═════════════════════════════════════════
 *
 * Окремий блок, і не про браузер: вибір, кому дзвонити (src/lib/timer-push.ts),
 * і числа, що мусять збігатися з supabase/timer-push.sql. Розбіжність між ними
 * не бачать ні типи, ні збірка — SQL для них просто текст, — а виглядала б
 * вона як будильник, що запізнюється, або база, що кличе маршрут даремно.
 * push-server.ts сюди не завантажити ("server-only" кидає поза Next), тому
 * вся чиста частина лежить у timer-push.ts.
 */
{
  const { readFileSync } = await import("node:fs");
  const {
    alarmUrl,
    parseAlarmUrl,
    pickDueTimers,
    timerTag,
    TIMER_BURST_PER_DEVICE,
    TIMER_LEAD_MS,
    TIMER_STALE_MS,
    TIMER_TTL_SEC,
    TIMER_PUSH_COLUMNS,
  } = await jiti.import(path.join(root, "src/lib/timer-push.ts"));

  console.log("── Будильник: кому дзвонити ──");

  const PHONE = "https://web.push.apple.com/QGuQyavXutnMH";
  const LAPTOP = "https://fcm.googleapis.com/fcm/send/cX9k";
  const alarm = (id, user, inMs, endpoint = PHONE) => ({
    id,
    user_id: user,
    fire_at: new Date(NOW + inMs).toISOString(),
    title: "Ням",
    body: "Час вийшов — перевір страву",
    url: "/recipe/r1/cook",
    endpoint,
  });
  const pick = (rows) => {
    const { due, stale } = pickDueTimers(rows, NOW);
    return { due: due.map((r) => r.id).sort(), stale };
  };

  check("константа: запас", TIMER_LEAD_MS, 2000);
  check("константа: прострочено після", TIMER_STALE_MS, 10 * 60_000);
  check("константа: строк життя в дорозі", TIMER_TTL_SEC, 120);
  check("константа: будильників пристрою за виклик", TIMER_BURST_PER_DEVICE, 4);

  check("порожньо", pick([]), { due: [], stale: 0 });
  check("настав щойно", pick([alarm("a", "u1", 0)]), { due: ["a"], stale: 0 });
  check("ще в межах запасу — забираємо", pick([alarm("a", "u1", 1500)]), { due: ["a"], stale: 0 });
  // Два таймери одного готування (макарони й соус) скінчились разом: у кожного свій тег, дзвонять обидва.
  check(
    "той самий пристрій, два таймери — обидва",
    pick([alarm("a", "u1", -5000), alarm("b", "u1", 0)]),
    { due: ["a", "b"], stale: 0 },
  );
  {
    const burst = Array.from({ length: 7 }, (_, i) => alarm(`t${i}`, "u1", -i * 1000));
    check(
      "забагато будильників пристрою разом — лише найпізніші",
      pick(burst),
      { due: burst.slice(0, TIMER_BURST_PER_DEVICE).map((r) => r.id).sort(), stale: 0 },
    );
    check(
      "порядок рядків не важить",
      pick([...burst].reverse()),
      { due: burst.slice(0, TIMER_BURST_PER_DEVICE).map((r) => r.id).sort(), stale: 0 },
    );
    check(
      "межа — на пристрій, а не на людину",
      pick([...burst, alarm("l", "u1", -9000, LAPTOP)]).due.length,
      TIMER_BURST_PER_DEVICE + 1,
    );
  }
  // Спільний тег ховав би перший «час вийшов» під другим; однаковий у місцевого й серверного — склеює їх.
  check("тег: свій у кожного таймера", timerTag("a") !== timerTag("b"), true);
  check("тег: той самий для того самого будильника", timerTag("a"), timerTag("a"));

  console.log("── Будильник: адреса рецепта й кроку ──");
  const RECIPE = "3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c";
  // З адреси загублений будильник повертають на екран — вона мусить читатись назад.
  check("адреса: туди й назад", parseAlarmUrl(alarmUrl(RECIPE, 2)), { recipeId: RECIPE, step: 2 });
  check("адреса: демо-рецепт", parseAlarmUrl(alarmUrl("r1", 0)), { recipeId: "r1", step: 0 });
  check("адреса: вміщується в межу timer_pushes_url_local", alarmUrl(RECIPE, 99).length <= 300, true);
  // Будильник попередньої версії — без кроку: не наш, щоб судити.
  check("адреса: стара, без кроку — не читається", parseAlarmUrl(`/recipe/${RECIPE}/cook`), null);
  check("адреса: чужа сторінка — не читається", parseAlarmUrl("/pantry?step=1"), null);
  check("адреса: зіпсований крок — не читається", parseAlarmUrl(`/recipe/${RECIPE}/cook?step=-1`), null);
  check("адреса: null", parseAlarmUrl(null), null);
  // Телефон і ноутбук одного акаунта скінчили в ту саму секунду: дзвонять обидва, кожен собі.
  check(
    "два пристрої однієї людини — обидва",
    pick([alarm("a", "u1", -1000), alarm("b", "u1", 0, LAPTOP)]),
    { due: ["a", "b"], stale: 0 },
  );
  check("двоє людей — обидва", pick([alarm("a", "u1", 0), alarm("b", "u2", 0)]), { due: ["a", "b"], stale: 0 });
  // Рядок з часів до колонки endpoint: маршрут сам вирішить (не надішле), але пристрій із адресою не зʼїсть.
  check(
    "рядок без адреси не витісняє пристрій з адресою",
    pick([alarm("a", "u1", 0), alarm("b", "u1", 500, null)]),
    { due: ["a", "b"], stale: 0 },
  );
  check("рівно на межі прострочення — ще дзвонимо", pick([alarm("a", "u1", -TIMER_STALE_MS)]), {
    due: ["a"],
    stale: 0,
  });
  check("на мить за межею — прострочено", pick([alarm("a", "u1", -TIMER_STALE_MS - 1)]), { due: [], stale: 1 });
  check("зіпсована дата — прострочено", pick([{ ...alarm("a", "u1", 0), fire_at: "не дата" }]), {
    due: [],
    stale: 1,
  });
  check(
    "прострочений не заважає свіжому того ж пристрою",
    pick([alarm("a", "u1", -DAY), alarm("b", "u1", -TIMER_STALE_MS - 1), alarm("c", "u1", -60_000)]),
    { due: ["c"], stale: 2 },
  );

  console.log("── Будильник: код і supabase/timer-push.sql ──");

  // Коментарі геть: у них теж трапляються «2 секунди» й «10 хвилин», а звіряти треба код.
  const sql = readFileSync(path.join(root, "supabase/timer-push.sql"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
  const UNIT_MS = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };
  const intervalMs = (m) => (m ? Number(m[1]) * (UNIT_MS[m[2].replace(/s$/, "")] ?? NaN) : null);
  const body = (fn) => sql.match(new RegExp(`function\\s+public\\.${fn}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`))?.[1] ?? "";

  const dispatch = body("dispatch_timer_pushes");
  check("SQL: dispatch_timer_pushes знайдено", dispatch.length > 0, true);
  check(
    "SQL: запас у dispatch_timer_pushes = TIMER_LEAD_MS",
    intervalMs(dispatch.match(/fire_at\s*<=\s*now\(\)\s*\+\s*interval\s*'(\d+)\s+([a-z]+)'/)),
    TIMER_LEAD_MS,
  );
  // Саме «>=»: pickDueTimers на самій межі ще дзвонить, тож і база на ній ще кличе.
  check(
    "SQL: межа прострочення в dispatch_timer_pushes = TIMER_STALE_MS",
    intervalMs(dispatch.match(/fire_at\s*>=\s*now\(\)\s*-\s*interval\s*'(\d+)\s+([a-z]+)'/)),
    TIMER_STALE_MS,
  );
  const cleanup = intervalMs(
    sql.match(/cron\.schedule\(\s*'nyam-timer-pushes-cleanup'[\s\S]*?fire_at\s*<\s*now\(\)\s*-\s*interval\s*'(\d+)\s+([a-z]+)'/),
  );
  check("SQL: прибирання знайдено", cleanup != null && !Number.isNaN(cleanup), true);
  // Інакше прибирання зносило б будильники, які маршрут після збою ще надіслав би.
  check("SQL: прибирання не раніше за межу прострочення", cleanup >= TIMER_STALE_MS, true);

  const table = sql.match(/create table if not exists public\.timer_pushes\s*\(([\s\S]*?)\n\);/)?.[1] ?? "";
  const created = [...table.matchAll(/^\s*([a-z_]+)\s+(?:uuid|text|timestamptz)\b/gm)].map((m) => m[1]);
  const altered = [...sql.matchAll(/alter table public\.timer_pushes\s[\s\S]*?;/g)].flatMap((m) =>
    [...m[0].matchAll(/add column if not exists\s+([a-z_]+)/g)].map((c) => c[1]),
  );
  for (const column of TIMER_PUSH_COLUMNS.split(",")) {
    check(`SQL: колонка ${column}, яку забирає маршрут, є в схемі`, [...created, ...altered].includes(column), true);
  }
  // Перша версія файлу колонки не мала: create table if not exists її на такій базі не допише.
  check("SQL: endpoint дописується окремим add column if not exists", altered.includes("endpoint"), true);

  const guard = body("timer_pushes_guard");
  check("SQL: запобіжник вимагає адресу", /new\.endpoint\s+is\s+null/.test(guard), true);
  check(
    "SQL: запобіжник шукає підписку за адресою і власником",
    /from\s+public\.push_subscriptions\s+where\s+endpoint\s*=\s*new\.endpoint\s+and\s+user_id\s*=\s*new\.user_id/.test(guard),
    true,
  );

  // Повторний запуск: кожне завдання знімається за назвою раніше, ніж ставиться знову.
  const unscheduleAt = sql.search(/cron\.unschedule\(/);
  const unscheduled = (sql.match(/cron\.unschedule\(jobid\)\s*from\s+cron\.job\s+where\s+jobname\s+in\s*\(([^)]*)\)/)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""));
  const scheduled = [...sql.matchAll(/cron\.schedule\(\s*'([^']+)'/g)];
  check("SQL: завдання розкладу є", scheduled.length, 3);
  for (const m of scheduled) {
    check(
      `SQL: «${m[1]}» знімається перед постановкою`,
      unscheduled.includes(m[1]) && unscheduleAt !== -1 && unscheduleAt < m.index,
      true,
    );
  }

  /*
   * Повторний запуск — не лише розклад. Файл виконують удруге на базі, де все
   * вже є, і SQL Editor жене його однією транзакцією: одне «already exists»
   * відкочує все разом, зокрема й нову колонку з запобіжником. Тож кожне
   * create мусить або не зважати на наявне, або стояти після свого drop.
   */
  const creates = [...sql.matchAll(/\bcreate\s+(or\s+replace\s+)?(?:unique\s+)?([a-z]+)\s+(if\s+not\s+exists\s+)?("[^"]+"|[a-z_.]+)/gi)];
  check("SQL: create-и знайдено", creates.length > 0, true);
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dropBefore = (kind, name, table, at) => {
    const drop = new RegExp(`drop\\s+${kind}\\s+if\\s+exists\\s+${escape(name)}\\s+on\\s+${escape(table)}\\b`, "i");
    const found = drop.exec(sql);
    return Boolean(found) && found.index < at;
  };
  for (const m of creates) {
    const [, orReplace, rawKind, ifNotExists, name] = m;
    const kind = rawKind.toLowerCase();
    // Таблиця тригера стоїть не одразу за назвою («before insert … on …») — шукаємо до кінця інструкції.
    const statement = sql.slice(m.index, sql.indexOf(";", m.index) >>> 0);
    const table = statement.match(/\bon\s+([a-z_.]+)/i)?.[1];
    let safe;
    if (["table", "index", "extension", "schema", "sequence"].includes(kind)) safe = Boolean(ifNotExists);
    else if (["function", "view", "procedure"].includes(kind)) safe = Boolean(orReplace);
    else if (kind === "trigger") safe = Boolean(orReplace) || (Boolean(table) && dropBefore("trigger", name, table, m.index));
    else if (kind === "policy") safe = Boolean(table) && dropBefore("policy", name, table, m.index);
    // Тип, домен тощо: «if not exists» у них немає — хай вирішує людина, а не мовчить перевірка.
    else safe = false;
    check(`SQL: create ${kind} ${name} переживе повторний запуск`, safe, true);
  }
  check("SQL: кожен add column — if not exists", /add\s+column\s+(?!if\s+not\s+exists)/i.test(sql), false);
  check("SQL: жодного add constraint поза create table", /add\s+constraint/i.test(sql), false);

  // Загублений будильник на зайнятому кроці скасовують — тож шукати їх можна лише серед своїх.
  const api = readFileSync(path.join(root, "src/lib/supabase/api.ts"), "utf8");
  const lookup = api.match(/export async function fetchTimerPushes\(([\s\S]*?)\r?\n\}/)?.[1] ?? "";
  check("fetchTimerPushes знайдено", lookup.length > 0, true);
  check(
    "загублені будильники — лише цього пристрою (фільтр за endpoint)",
    /\.eq\(\s*"endpoint"\s*,\s*endpoint\s*\)/.test(lookup),
    true,
  );
  const host = readFileSync(path.join(root, "src/components/CookingHost.tsx"), "utf8");
  check(
    "застосунок без підписки загублених не шукає",
    /const endpoint = await deviceEndpoint\(\);\s*if \(!endpoint\) return;\s*for \(const row of await fetchTimerPushes\(endpoint\)\)/.test(host),
    true,
  );
  // Знайдений, але вже скасовуваний (пауза, що не дійшла через мережу) — не таймер, який треба повертати.
  check(
    "загублений будильник зі скасуванням у дорозі не повертається на екран",
    /if \(knownAlarm\(row\.id\) \|\| cancelPending\(row\.id\)\) continue;/.test(host),
    true,
  );
  const alarms = readFileSync(path.join(root, "src/lib/cook-alarms.ts"), "utf8");
  check("місцевий будильник — з тегом timerTag", /tag:\s*timerTag\(id\)/.test(alarms), true);

  // push-server тягне "server-only" і web-push: чиста частина — лише напряму з timer-push.
  const pushServer = readFileSync(path.join(root, "src/lib/push-server.ts"), "utf8");
  check("push-server.ts не передає далі timer-push", /from\s+["']\.\/timer-push["']/.test(pushServer), false);

  const route = readFileSync(path.join(root, "src/app/api/push/timers/route.ts"), "utf8");
  check("маршрут забирає колонки з TIMER_PUSH_COLUMNS", /\.select\(\s*TIMER_PUSH_COLUMNS\s*\)/.test(route), true);
  check("серверний будильник — з тегом timerTag того самого рядка", /tag:\s*timerTag\(row\.id\)/.test(route), true);
  // Регрес, заради якого все це: будильник на всі пристрої акаунта замість одного.
  check(
    "маршрут дзвонить лише на пристрій таймера",
    /sendPushToDevice\(/.test(route) && !/\bsendPush\(/.test(route),
    true,
  );
}

/* ══ Версія застосунку ═════════════════════════════════════════════════════
 *
 * Окремий блок, і теж не про сповіщення: перевірка, чи код у браузері не
 * старший за базу (src/lib/schema-version.ts, /api/version, банер у
 * Providers, замок запису в клієнті Supabase). Тут вона тому, що це той самий
 * клас рішень «коли щось показати людині без її натиску» і так само без
 * браузера.
 *
 * Ламається вона тихо з обох боків: зайвий банер — застосунок, яким не
 * користуватись, пропущений — старий код, що псує нові дані. А кеш, який
 * віддав би старий номер, звів би нанівець усе інше, тож звіряємо й тексти
 * маршруту та service worker.
 */
{
  const { readFileSync } = await import("node:fs");
  const {
    CLIENT_SCHEMA,
    VERSION_CHECK_INTERVAL_MS,
    VERSION_RETRY_BASE_MS,
    RELOAD_LOOP_WINDOW_MS,
    STALE_WRITE_CODE,
    STALE_WRITE_MESSAGE,
    versionRetryDelay,
    readServerSchema,
    shouldPromptReload,
    isReloadLoop,
    isDatabaseWrite,
    guardStaleWrites,
    markClientStale,
    isClientStale,
  } = await jiti.import(path.join(root, "src/lib/schema-version.ts"));
  const SEC = 1000;
  const MIN = 60_000;

  console.log("── Версія: відповідь сервера ──");

  check("константа: CLIENT_SCHEMA — ціле додатне", Number.isSafeInteger(CLIENT_SCHEMA) && CLIENT_SCHEMA >= 1, true);
  check("константа: пауза між перевірками", VERSION_CHECK_INTERVAL_MS, 10 * MIN);
  check("константа: перший повтор після невдачі", VERSION_RETRY_BASE_MS, 15 * SEC);

  for (const [what, value, expected] of [
    ["1", 1, 1],
    ["7", 7, 7],
    ["рядок «2»", "2", null],
    ["NaN", NaN, null],
    ["нескінченність", Infinity, null],
    ["дріб", 1.5, null],
    ["нуль", 0, null],
    ["відʼємне", -1, null],
    ["null", null, null],
    ["undefined", undefined, null],
    ["обʼєкт", { schema: 2 }, null],
    ["true", true, null],
    ["завелике для точного цілого", 2 ** 60, null],
  ]) {
    check(`номер сервера: ${what}`, readServerSchema(value), expected);
  }

  for (const [failures, expected] of [
    [0, 15 * SEC],
    [1, 15 * SEC],
    [2, 30 * SEC],
    [3, 60 * SEC],
    [6, 480 * SEC],
    [7, 10 * MIN],
    [1000, 10 * MIN],
    [NaN, 15 * SEC],
    [-3, 15 * SEC],
  ]) {
    check(`пауза повтору: ${failures} невдач`, versionRetryDelay(failures), expected);
  }

  console.log("── Версія: показати «Оновити» чи ні ──");

  const gate = (what, server, client, checkedAgoMs, expected, failures) =>
    check(
      `версія: ${what}`,
      shouldPromptReload(server, client, checkedAgoMs === null ? null : NOW - checkedAgoMs, NOW, failures),
      expected,
    );

  gate("ще не питали — питати", null, 1, null, null);
  gate("однакові, питали щойно", 1, 1, 0, false);
  gate("однакові, питали 9.9 хв тому", 1, 1, 9.9 * MIN, false);
  gate("однакові, рівно 10 хв — питати знову", 1, 1, 10 * MIN, null);
  gate("однакові, година тому — питати", 1, 1, 60 * MIN, null);
  // Успішна відповідь скидає лічильник невдач: навіть переданий, він не скорочує 10 хв.
  gate("однакові після низки невдач — усе одно 10 хв", 1, 1, 1 * MIN, false, 5);
  gate("сервер старший (відкат деплою) — мовчати", 1, 2, 1 * MIN, false);
  gate("сервер старший, давно — питати", 1, 2, 60 * MIN, null);
  gate("сервер новіший — банер", 2, 1, 0, true);
  gate("сервер новіший на кілька версій — банер", 4, 1, 0, true);
  // Банер не зникає від того, що відповідь постаріла: вищий номер назад не повертається.
  gate("сервер новіший, відповідь давня — банер", 2, 1, 60 * 24 * MIN, true);
  gate("сервер новіший, час перевірки невідомий — банер", 2, 1, null, true);
  // Невдалий запит — короткий повтор, а не 10 хв тиші і не шквал запитів.
  gate("запит не вдався 10 с тому — мовчати", null, 1, 10 * SEC, false, 1);
  gate("запит не вдався 15 с тому — питати", null, 1, 15 * SEC, null, 1);
  gate("невдача без лічильника — як перша", null, 1, 15 * SEC, null);
  gate("третя невдача, 50 с тому — мовчати", null, 1, 50 * SEC, false, 3);
  gate("третя невдача, 60 с тому — питати", null, 1, 60 * SEC, null, 3);
  gate("сьома невдача, 9.9 хв тому — мовчати", null, 1, 9.9 * MIN, false, 7);
  gate("сьома невдача, 10 хв — питати", null, 1, 10 * MIN, null, 7);
  gate("сміття «2» щойно — не банер", "2", 1, 5 * SEC, false, 1);
  gate("сміття NaN щойно — не банер", NaN, 1, 5 * SEC, false, 1);
  gate("сміття NaN за паузою — питати", NaN, 1, 16 * SEC, null, 1);
  gate("сміття-обʼєкт — не банер", { schema: 9 }, 1, 5 * SEC, false, 1);
  gate("HTML замість JSON — не банер", "<!doctype html>", 1, 5 * SEC, false, 1);
  gate("дата перевірки з майбутнього — питати", 1, 1, -30 * MIN, null);
  check("версія: дата перевірки NaN — питати", shouldPromptReload(1, 1, NaN, NOW), null);
  check("версія: «зараз» NaN — питати", shouldPromptReload(1, 1, NOW, NaN), null);

  console.log("── Версія: як часто питаємо ──");

  /*
   * Те, що робить Providers: кожен «привід» (повернення на екран, фокус,
   * 15-секундний тік) спершу питає shouldPromptReload; null — запит, і тоді
   * час ставиться до відповіді, а невдача збільшує лічильник.
   * answer(t) — що сервер відповість у мить t (null — запит не вдався).
   */
  const simulate = ({ stepMs, untilMs, answer }) => {
    let server = null;
    let at = null;
    let failures = 0;
    const asked = [];
    let promptedAt = null;
    for (let t = 0; t < untilMs && promptedAt === null; t += stepMs) {
      const step = shouldPromptReload(server, CLIENT_SCHEMA, at === null ? null : NOW + at, NOW + t, failures);
      if (step === true) promptedAt = t;
      if (step !== null) continue;
      asked.push(t);
      at = t;
      server = answer(t);
      failures = readServerSchema(server) === null ? failures + 1 : 0;
      if (shouldPromptReload(server, CLIENT_SCHEMA, NOW + at, NOW + t, failures)) promptedAt = t;
    }
    return { asked, promptedAt };
  };

  {
    // Година, і застосунок повертається на екран щохвилини, а деплою немає.
    const { asked } = simulate({ stepMs: MIN, untilMs: 60 * MIN, answer: () => CLIENT_SCHEMA });
    check("щохвилинні повернення — питаємо раз на 10 хв", asked.map((t) => t / MIN), [0, 10, 20, 30, 40, 50]);
  }

  {
    // Вікно просто стоїть видимим: лише 15-секундний тік — і все одно раз на 10 хв.
    const { asked } = simulate({ stepMs: 15 * SEC, untilMs: 60 * MIN, answer: () => CLIENT_SCHEMA });
    check("видиме вікно без подій — теж раз на 10 хв", asked.map((t) => t / MIN), [0, 10, 20, 30, 40, 50]);
  }

  {
    // Деплой на 25-й хвилині: з цієї миті сервер каже номер на один вищий.
    const { promptedAt } = simulate({
      stepMs: MIN,
      untilMs: 60 * MIN,
      answer: (t) => (t >= 25 * MIN ? CLIENT_SCHEMA + 1 : CLIENT_SCHEMA),
    });
    check("деплой на 25-й хв — банер на 30-й", promptedAt / MIN, 30);
  }

  {
    /*
     * iOS розбудила застосунок після деплою, а мережа ще не піднялась: перші
     * два запити падають, з 20-ї секунди все гаразд. Раніше перша ж невдача
     * вмикала 10 хвилин тиші.
     */
    const { asked, promptedAt } = simulate({
      stepMs: SEC,
      untilMs: 60 * MIN,
      answer: (t) => (t < 20 * SEC ? null : CLIENT_SCHEMA + 1),
    });
    check("пробудження без мережі — банер за 45 с, а не за 10 хв", [asked.map((t) => t / SEC), promptedAt / SEC], [[0, 15, 45], 45]);
  }

  {
    // Мережа лежить годину: жоден запит не вдається. Спроби рідшають до 10 хв, банера немає.
    const { asked, promptedAt } = simulate({ stepMs: 5 * SEC, untilMs: 60 * MIN, answer: () => null });
    check(
      "без мережі годину — 11 спроб, що рідшають, і без банера",
      [asked.map((t) => t / SEC), promptedAt],
      [[0, 15, 45, 105, 225, 465, 945, 1545, 2145, 2745, 3345], null],
    );
  }

  console.log("── Версія: запобіжник від петлі перезапусків ──");

  check("константа: вікно петлі", RELOAD_LOOP_WINDOW_MS, 2 * MIN);
  for (const [what, mark, schema, expected] of [
    ["щойно перезапускались для цієї версії — смужка", { schema: 2, at: NOW - 20 * SEC }, 2, true],
    ["1.9 хв тому — ще смужка", { schema: 2, at: NOW - 1.9 * MIN }, 2, true],
    ["рівно 2 хв тому — знову аркуш", { schema: 2, at: NOW - 2 * MIN }, 2, false],
    ["година тому — аркуш", { schema: 2, at: NOW - 60 * MIN }, 2, false],
    ["для іншої версії — аркуш", { schema: 2, at: NOW - 20 * SEC }, 3, false],
    ["позначка з майбутнього — аркуш", { schema: 2, at: NOW + MIN }, 2, false],
    ["старий формат (просто номер) — аркуш", 2, 2, false],
    ["рядок — аркуш", "2", 2, false],
    ["без часу — аркуш", { schema: 2 }, 2, false],
    ["час NaN — аркуш", { schema: 2, at: NaN }, 2, false],
    ["позначки немає — аркуш", null, 2, false],
  ]) {
    check(`петля: ${what}`, isReloadLoop(mark, schema, NOW), expected);
  }

  console.log("── Версія: замок запису для старого коду ──");

  const SB = "https://abc.supabase.co";
  for (const [what, url, method, expected] of [
    ["вставка в комору", `${SB}/rest/v1/pantry_items`, "POST", true],
    ["правка", `${SB}/rest/v1/pantry_items?key=eq.milk`, "PATCH", true],
    ["видалення", `${SB}/rest/v1/pantry_items?key=eq.milk`, "DELETE", true],
    ["PUT", `${SB}/rest/v1/recipes`, "PUT", true],
    ["метод малими літерами", `${SB}/rest/v1/recipes`, "post", true],
    ["RPC (у нас усі — записи)", `${SB}/rest/v1/rpc/join_family`, "POST", true],
    ["читання", `${SB}/rest/v1/pantry_items?select=*`, "GET", false],
    ["HEAD (підрахунок)", `${SB}/rest/v1/recipes`, "HEAD", false],
    ["без методу — це GET", `${SB}/rest/v1/recipes`, undefined, false],
    ["вхід", `${SB}/auth/v1/token?grant_type=refresh_token`, "POST", false],
    ["вихід", `${SB}/auth/v1/logout`, "POST", false],
    ["сховище фото", `${SB}/storage/v1/object/recipes/a.jpg`, "POST", false],
  ]) {
    check(`запис у базу: ${what}`, isDatabaseWrite(url, method), expected);
  }
  // Схожість на SQLSTATE зробила б відмову «остаточною» в sync.isPermanentRejection — і правка рецепта пропала б.
  check("код відмови не схожий на SQLSTATE", /^[0-9A-Z]{5}$/.test(STALE_WRITE_CODE), false);

  {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response("[]", { status: 200 });
    };
    try {
      const write = [`${SB}/rest/v1/pantry_items`, { method: "POST", body: "{}" }];
      const read = [`${SB}/rest/v1/pantry_items?select=*`, { method: "GET" }];

      check("замок: спершу відкритий", isClientStale(), false);
      check("замок: відкритий — запис іде в мережу", (await guardStaleWrites(...write)).status, 200);

      markClientStale();
      check("замок: після новішого сервера — зачинений", isClientStale(), true);
      const refused = await guardStaleWrites(...write);
      const body = await refused.json();
      check("замок: запис — відмова 426 без мережі", [refused.status, body.code, body.message], [426, STALE_WRITE_CODE, STALE_WRITE_MESSAGE]);
      check("замок: відмова в тілі PostgREST (supabase-js віддасть message як є)", Object.keys(body).sort(), ["code", "details", "hint", "message"]);
      check("замок: Request із POST — теж відмова", (await guardStaleWrites(new Request(write[0], write[1]))).status, 426);
      check("замок: читання — іде", (await guardStaleWrites(...read)).status, 200);
      check("замок: вихід з акаунта — іде", (await guardStaleWrites(`${SB}/auth/v1/logout`, { method: "POST" })).status, 200);
      check("замок: у мережу пішло лише дозволене", calls, [
        `POST ${SB}/rest/v1/pantry_items`,
        `GET ${SB}/rest/v1/pantry_items?select=*`,
        `POST ${SB}/auth/v1/logout`,
      ]);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  console.log("── Версія: маршрут, service worker, Providers, клієнт ──");

  const route = readFileSync(path.join(root, "src/app/api/version/route.ts"), "utf8");
  check("маршрут віддає CLIENT_SCHEMA", /\{\s*schema:\s*CLIENT_SCHEMA\s*\}/.test(route), true);
  check("маршрут: Cache-Control no-store", /"Cache-Control":\s*"no-store\b/.test(route), true);
  check("маршрут: force-dynamic", /export const dynamic = "force-dynamic"/.test(route), true);

  /*
   * Service worker кешує лише статику (isAsset) і навігації. Запит fetch() —
   * не навігація, тож лишається одне: щоб /api/version не впізнався як статика.
   * Беремо сам предикат із файлу, а не його копію, — інакше перевірка
   * пропустила б ту зміну sw.js, від якої мала вберегти.
   */
  const sw = readFileSync(path.join(root, "public/sw.js"), "utf8");
  const assetBody = sw.match(/const isAsset = \(url\) =>([\s\S]*?);\r?\n/)?.[1];
  check("sw.js: предикат isAsset знайдено", Boolean(assetBody), true);
  if (assetBody) {
    const isAsset = new Function("url", `return (${assetBody});`);
    const at = (p) => isAsset(new URL(p, "https://nyam.example"));
    check("sw.js: /_next/static — статика (контроль)", at("/_next/static/chunks/app.js"), true);
    check("sw.js: /api/version — не статика", at("/api/version"), false);
    check("sw.js: /api/version?t=1 — не статика", at("/api/version?t=1"), false);
  }
  // Нова гілка кешу (скажімо, «усі GET про запас») могла б зачепити й /api/version — хай її помітить людина.
  check("sw.js: кладе в кеш лише статику й навігації", (sw.match(/cache\.put\(/g) ?? []).length, 2);

  const providers = readFileSync(path.join(root, "src/components/Providers.tsx"), "utf8");
  check(
    "Providers питає /api/version без кешу браузера",
    /fetch\("\/api\/version",\s*\{[\s\S]*?cache:\s*"no-store"/.test(providers),
    true,
  );
  check("Providers без бази не питає", /if \(!isSupabaseConfigured\) return;/.test(providers), true);
  check("Providers без мережі не питає", /navigator\.onLine === false/.test(providers), true);
  check("Providers зачиняє запис, щойно сервер новіший", /markClientStale\(\)/.test(providers), true);
  check("Providers звіряє версію й без подій видимості", /setInterval\(check,/.test(providers), true);

  const client = readFileSync(path.join(root, "src/lib/supabase/client.ts"), "utf8");
  check("клієнт Supabase пише в базу лише через замок", /global:\s*\{\s*fetch:\s*guardStaleWrites\s*\}/.test(client), true);
}

console.log(`\nПройдено: ${pass}, провалено: ${fail}`);
process.exit(fail ? 1 : 0);
