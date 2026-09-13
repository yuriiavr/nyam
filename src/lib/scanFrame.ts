/**
 * Геометрія й ритм кадрів для сканера на ZXing.
 *
 * Винесено окремо від компонента, бо це чиста арифметика: її можна
 * перевірити без камери, а в самому сканері вона лише заважала б читати,
 * що відбувається з потоком.
 */

/** Квадрат — під QR чека, широка смуга — під лінійний штрихкод. */
export type ScanShape = "square" | "band";

export interface ScanCrop {
  /** Прямокутник у пікселях кадру камери, який розпізнаємо. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Розмір полотна, на яке його малюємо. */
  dw: number;
  dh: number;
}

/*
 * Виріз мусить накривати рамку на екрані за будь-якої орієнтації: камера
 * може віддати і 1080×1920, і 1920×1080, а видошукач із object-cover
 * показує лише середину довгої сторони. Що людина бачить у рамці, те й
 * має потрапити в розпізнавання.
 *
 * Квадратна рамка не ширша за 65vw і не вища за 55svh, тож при object-cover
 * ніколи не займає більше 65% короткої сторони кадру — квадрат у 72% від неї
 * накриває рамку з запасом. Смуга під штрихкод (86% ширини × 190px) по
 * ширині не більша за 86% ширини кадру, а по висоті вміщується в 55%
 * короткої сторони на будь-якому екрані від iPhone SE. Широка смуга
 * дешева: лінійний код ZXing читає окремими рядками, а не всю площу.
 */
const SQUARE_SHARE = 0.72;
const BAND_WIDTH_SHARE = 0.9;
const BAND_HEIGHT_SHARE = 0.55;

/*
 * Стеля для полотна. Звичайний потік 1920×1080 до неї не дотягує, тож
 * пікселі на модуль коду не губляться; стискаємо лише 4K-камери, де повний
 * виріз коштував би кілька мегапікселів сірого буфера на кожен кадр.
 */
const MAX_SIDE: Record<ScanShape, number> = { square: 1024, band: 1280 };

/**
 * Центральний виріз кадру для розпізнавання.
 *
 * Менше пікселів — швидше кадр, а для QR ще й густіший пошук: ZXing
 * пропускає рядки кроком, пропорційним висоті зображення, і в повному
 * портретному кадрі дрібний QR проскакував між ними.
 *
 * Повертає null, поки відео не знає свого розміру (0×0 до першого кадру).
 */
export function scanCrop(videoWidth: number, videoHeight: number, shape: ScanShape): ScanCrop | null {
  if (!(videoWidth > 0 && videoHeight > 0)) return null;

  const short = Math.min(videoWidth, videoHeight);
  const square = shape === "square";
  const sw = Math.max(1, Math.round(square ? short * SQUARE_SHARE : videoWidth * BAND_WIDTH_SHARE));
  const sh = Math.max(1, Math.round(short * (square ? SQUARE_SHARE : BAND_HEIGHT_SHARE)));
  const scale = Math.min(1, MAX_SIDE[shape] / Math.max(sw, sh));

  return {
    sx: Math.floor((videoWidth - sw) / 2),
    sy: Math.floor((videoHeight - sh) / 2),
    sw,
    sh,
    dw: Math.max(1, Math.round(sw * scale)),
    dh: Math.max(1, Math.round(sh * scale)),
  };
}

/*
 * ZXing декодує синхронно, у головному потоці — там само, де крутиться
 * анімація рамки й обробляються дотики. Тому між спробами лишаємо паузу:
 * не менше за minInterval і не менше за costFactor тривалостей самої
 * спроби. Множник і задає частку головного потоку: 2 — щонайбільше половина.
 */
export interface DecodePace {
  minInterval: number;
  costFactor: number;
}

/*
 * Коли ZXing — єдиний рушій: не частіше, ніж камера дає нові кадри
 * (~30 к/с), і щонайбільше половина часу. На швидкому телефоні все одно
 * встигає на кожен кадр.
 */
export const SOLO_PACE: DecodePace = { minInterval: 30, costFactor: 2 };

/*
 * Коли ZXing лише підстраховує живий нативний детектор. Той теж не
 * безкоштовний для головного потоку: Chrome знімає кадр із відео й
 * копіює його пікселі саме там, на кожен detect(). Щільний ZXing поруч
 * гальмував би нативну спробу якраз на тих слабких Android, де вона
 * працює, і затримував би дотики. Тож кілька спроб на секунду і не більше
 * п'ятої частини потоку — досить, щоб підхопити код, якого нативний не
 * бачить (скажімо, поки модуль Play Services ще не завантажився).
 */
export const BACKUP_PACE: DecodePace = { minInterval: 200, costFactor: 5 };

/** Чи час починати нову спробу, якщо попередня стартувала в lastStart і тривала lastCost. */
export function decodeDue(now: number, lastStart: number, lastCost: number, pace: DecodePace = SOLO_PACE): boolean {
  return now - lastStart >= Math.max(pace.minInterval, lastCost * pace.costFactor);
}

/*
 * Навіть у темряві камера дає щонайменше кілька кадрів на секунду, тож
 * коли новий кадр не прийшов за чверть секунди, щось його затримало.
 */
const VIDEO_FRAME_TIMEOUT_MS = 250;

/*
 * Скільки прострочених кадрів поспіль вважаємо ознакою того, що rVFC для
 * цього потоку не працює взагалі. Один прострочений — ще не ознака:
 * повернення з іншого застосунку чи applyConstraints із зумом на кілька
 * сотень мілісекунд зупиняють камеру й на справному телефоні.
 */
const MAX_VIDEO_FRAME_MISSES = 3;

/**
 * Планувальник для одного циклу розпізнавання: next(cb) викликає cb, щойно
 * у відео з'явиться новий кадр.
 *
 * requestVideoFrameCallback кращий за requestAnimationFrame: той на екрані
 * 60–120 Гц смикав би нас двічі-чотири рази на кожен кадр камери, і ми б
 * розпізнавали ту саму картинку повторно. Але перевірити його на кожному
 * телефоні ми не можемо, а якщо він колись не спрацює для потоку з камери,
 * сканер тихо стояв би. Тому кадр, що не прийшов вчасно, заміняємо
 * таймером, а після кількох таких поспіль — rAF (частоту однаково стримує
 * decodeDue).
 *
 * Жоден із запасних шляхів не остаточний: rVFC просимо на кожен виклик,
 * і щойно він спрацює, лічильник скидається. Колбеки rVFC браузер виконує
 * в тому самому кроці рендеру, що й rAF, але перед ним, тож після затримки
 * камери перший же новий кадр повертає нас на rVFC, а не лишає на rAF до
 * кінця сканування.
 */
export function frameScheduler(video: HTMLVideoElement): (cb: () => void) => void {
  if (typeof video.requestVideoFrameCallback !== "function") {
    return (cb) => {
      requestAnimationFrame(() => cb());
    };
  }

  let misses = 0;

  return (cb) => {
    let fired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;

    const fire = (fromVideo: boolean) => {
      if (fired) return;
      fired = true;
      if (fromVideo) misses = 0;
      else video.cancelVideoFrameCallback(handle);
      if (timer !== undefined) clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      cb();
    };

    const handle = video.requestVideoFrameCallback(() => fire(true));
    if (misses >= MAX_VIDEO_FRAME_MISSES) {
      frame = requestAnimationFrame(() => fire(false));
    } else {
      timer = setTimeout(() => {
        /*
         * У прихованій вкладці кадрів і не має бути, а таймери там ще й
         * пригальмовані — такий пропуск нічого не каже про rVFC.
         */
        if (typeof document === "undefined" || !document.hidden) misses++;
        fire(false);
      }, VIDEO_FRAME_TIMEOUT_MS);
    }
  };
}
