"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Flashlight, Keyboard, ScanBarcode, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BARCODE_FORMATS, nativeDetectorSupports } from "@/lib/barcode";
import { BACKUP_PACE, SOLO_PACE, decodeDue, frameScheduler, scanCrop, type DecodePace } from "@/lib/scanFrame";
import { haptic } from "@/lib/utils";
import { Button } from "./ui";

/* Мінімальні типи для нативного BarcodeDetector — у lib.dom їх ще немає. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

/* Керування камерою з Image Capture — його в lib.dom теж немає. */
type CameraCaps = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: { min: number; max: number };
  focusMode?: string[];
};
type CameraSet = MediaTrackConstraintSet & { torch?: boolean; zoom?: number; focusMode?: string };

type Status = "idle" | "starting" | "scanning" | "denied" | "error";

/*
 * Один запуск камери. Цикли розпізнавання перевіряють alive після кожного
 * await і перед тим, як просити наступний кадр: скасувати вже запланований
 * кадр мало, бо цикл, що саме чекав на detect(), сам себе перепланував би —
 * і після кожного закриття сканера лишався б крутитися ще один.
 */
interface ScanRun {
  alive: boolean;
}

const loadZxing = () => Promise.all([import("@zxing/browser"), import("@zxing/library")]);
type Zxing = Awaited<ReturnType<typeof loadZxing>>;

/*
 * Скільки даємо нативному детектору, перш ніж підстрахувати його ZXing.
 * Порожні відповіді — норма, поки код не в кадрі, але так само порожньо
 * відповідає й Android, у якого модуль штрихкодів Play Services ще не
 * завантажився. Тож нативний цикл не вимикаємо, а додаємо рідкий ZXing:
 * саме розпізнавання нативний робить поза головним потоком, і на справному
 * телефоні він так і лишиться першим, хто впізнає код.
 */
const NATIVE_WATCHDOG_MS = 4000;

/*
 * Нативний детектор вважаємо живим, поки його detect() хоч раз
 * завершився за цей час. Той, що завис чи впав, уже не конкурент за
 * головний потік, і ZXing має отримати повний темп.
 */
const NATIVE_STALE_MS = 1000;

export function BarcodeScanner({
  open,
  onClose,
  onDetect,
  formats = BARCODE_FORMATS,
  hint = "Наведи на штрихкод продукту",
  manualEntry = true,
}: {
  open: boolean;
  onClose: () => void;
  onDetect: (code: string) => void;
  /** Що саме шукаємо в кадрі: товарні коди чи QR чека. */
  formats?: readonly string[];
  hint?: string;
  /** Ручне введення має сенс для цифр під штрихкодом, але не для QR. */
  manualEntry?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef<ScanRun>({ alive: false });
  const tuningRef = useRef<CameraSet[]>([]);
  const doneRef = useRef(false);

  /*
   * Перелік форматів тримаємо в ref, а не в залежностях ефекту: інакше
   * викликач, який передав літерал масиву, перезапускав би камеру на кожен
   * рендер — а це чорний кадр і згаслий ліхтарик.
   */
  const formatsRef = useRef(formats);
  formatsRef.current = formats;

  /*
   * З onDetect та сама історія: сторінки передають свіжу функцію на кожен
   * рендер, а рендерів під час сканування вистачає — синхронізація комори,
   * дії родини. Через залежність handleHit → ефект кожен такий рендер гасив
   * камеру й запускав заново, і сканування починалось спочатку.
   */
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualCode, setManualCode] = useState("");

  const qrMode = formats.includes("qr_code");

  const stop = useCallback(() => {
    runRef.current.alive = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStatus("idle");
    setTorchOn(false);
  }, []);

  const handleHit = useCallback(
    (code: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      haptic([25, 40, 25]);
      stop();
      onDetectRef.current(code);
    },
    [stop],
  );

  // handleHit і stop стабільні, тож насправді ефект залежить лише від open.
  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    doneRef.current = false;
    const run: ScanRun = { alive: true };
    runRef.current = run;
    tuningRef.current = [];

    const wanted = [...formatsRef.current];
    const isQr = wanted.includes("qr_code");

    const start = async () => {
      setStatus("starting");
      setMessage("");

      /*
       * Рушій вибираємо паралельно із запитом камери, а не після play(): на
       * iPhone це завжди ZXing, і при першому скануванні його ~100 КБ інакше
       * вантажились би вже при живому, але сліпому видошукачі. Відмову
       * гасимо тут лише для того, щоб вона не вилетіла необробленою, якщо
       * камера впаде раніше; нижче її все одно дочекаємось і покажемо.
       */
      const nativeP = nativeDetectorSupports(wanted);
      const zxingP = nativeP.then((native) => (native ? null : loadZxing()));
      zxingP.catch(() => {});

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            /*
             * QR чека дрібний і друкований на термопапері, тож для нього
             * просимо Full HD: розпізнаємо все одно лише центральний виріз,
             * і зайві пікселі йдуть у різкість коду, а не в роботу процесора.
             */
            width: { ideal: isQr ? 1920 : 1280 },
            height: { ideal: isQr ? 1080 : 720 },
          },
          audio: false,
        });
        if (!run.alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (!run.alive) return;

        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities?.() as CameraCaps | undefined;
        setTorchAvailable(Boolean(caps?.torch));
        tuneCamera(track, caps);

        const [native, zxing] = await Promise.all([nativeP, zxingP]);
        if (!run.alive) return;
        setStatus("scanning");

        if (native) {
          runNative(video);
        } else if (zxing) {
          runZxing(video, zxing);
        }
      } catch (err) {
        if (!run.alive) return;
        const name = (err as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
          setMessage("Доступ до камери заборонено. Дозволь його в налаштуваннях браузера.");
        } else if (name === "NotFoundError") {
          setStatus("error");
          setMessage("Камеру не знайдено. Введи код вручну.");
        } else {
          setStatus("error");
          setMessage("Не вдалося увімкнути камеру. Спробуй ввести код вручну.");
        }
      }
    };

    /*
     * Безперервний фокус і помірний зум. Головна камера багатьох телефонів
     * не фокусується ближче 15–20 см, а з такої відстані чек займає крихту
     * кадру — людина підносить телефон ближче, картинка розмивається, і код
     * не читається взагалі. Зум дає той самий розмір коду з відстані, на якій
     * фокус працює. Для QR більший, бо він дрібніший за штрихкод на пачці.
     * Чого камера не вміє, просто не просимо; помилка тут не заважає сканувати.
     */
    const tuneCamera = (track: MediaStreamTrack, caps: CameraCaps | undefined) => {
      const sets: CameraSet[] = [];
      if (caps?.focusMode?.includes("continuous")) sets.push({ focusMode: "continuous" });

      const wantZoom = isQr ? 2 : 1.5;
      if (caps?.zoom && caps.zoom.min <= wantZoom) {
        const zoom = Math.min(caps.zoom.max, wantZoom);
        const current = (track.getSettings() as { zoom?: number }).zoom ?? caps.zoom.min;
        // Лише наближаємо: якщо камера вже стоїть ближче, віддаляти нема чого.
        if (zoom > current) sets.push({ zoom });
      }

      if (!sets.length) return;
      track
        .applyConstraints({ advanced: sets })
        .then(() => {
          if (run.alive) tuningRef.current = sets;
        })
        .catch(() => {});
    };

    const runNative = (video: HTMLVideoElement) => {
      const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
      const detector = new Ctor({ formats: wanted });
      let backup = false;
      let stopped = false;
      let lastSettled = performance.now();

      /*
       * Сторож на таймері, а не перевіркою в самому циклі: цикл доходить до
       * неї лише після того, як detect() завершився, і детектор, що завис
       * на першому ж кадрі, так і не дочекався б підстраховки.
       */
      setTimeout(() => {
        if (!run.alive) return;
        backup = true;
        loadZxing()
          .then((zxing) => {
            if (!run.alive) return;
            runZxing(video, zxing, () =>
              !stopped && performance.now() - lastSettled < NATIVE_STALE_MS ? BACKUP_PACE : SOLO_PACE,
            );
          })
          .catch(() => {});
      }, NATIVE_WATCHDOG_MS);

      const tick = async () => {
        if (!run.alive) return;
        if (video.readyState >= 2) {
          try {
            const codes = await detector.detect(video);
            if (!run.alive) return;
            lastSettled = performance.now();
            const value = codes[0]?.rawValue?.trim();
            if (value) {
              handleHit(value);
              return;
            }
          } catch {
            if (!run.alive) return;
            lastSettled = performance.now();
            // Коли вже є ZXing, детектор, що сиплеться помилками, лише заважає йому.
            if (backup) {
              stopped = true;
              return;
            }
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    /*
     * Власний цикл замість decodeFromVideoElement. Бібліотечний після кожного
     * невдалого кадру чекає 500 мс, тобто пробує двічі на секунду, а
     * змазаний у руці кадр — звичайна справа, і кожен коштував пів секунди.
     * До того ж він малює повний кадр у полотно, розмір якого запам'ятав на
     * старті, і тихо помирає на першій же не-ZXing помилці. Тут розмір
     * і виріз рахуємо з поточного кадру, а будь-яку помилку ковтаємо.
     */
    const runZxing = (
      video: HTMLVideoElement,
      [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }]: Zxing,
      /* Темп питаємо на кожному кадрі: нативний сусід може впасти посеред сканування. */
      pace: () => DecodePace = () => SOLO_PACE,
    ) => {
      /*
       * Перелік форматів ZXing треба передати явно: без підказок він читає
       * усе підряд, і сканер продукту ловив би QR з акційної наліпки, а
       * сканер чека — штрихкод із пачки. Назви форматів у W3C і в ZXing
       * збігаються з точністю до регістру, тож перекладаємо їх напряму.
       */
      const hints = new Map<number, unknown>();
      hints.set(
        DecodeHintType.POSSIBLE_FORMATS,
        wanted
          .map((format) => BarcodeFormat[format.toUpperCase() as keyof typeof BarcodeFormat])
          .filter((format) => format !== undefined),
      );
      /*
       * TRY_HARDER для QR: без нього пошук шукає опорні квадрати лише в
       * кожному n-му рядку, і дрібний QR чека між ними проскакує. Для
       * лінійних кодів не вмикаємо — порожній кадр там дорожчає в рази.
       * І лише true: бібліотека вважає підказку увімкненою за будь-якого
       * значення, навіть false.
       */
      if (isQr) hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints);
      const canvas = document.createElement("canvas");
      // Перший getContext фіксує параметри; ZXing далі бере цей самий контекст.
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas 2D недоступний");
      const nextFrame = frameScheduler(video);
      const shape = isQr ? "square" : "band";
      let lastStart = -Infinity;
      let lastCost = 0;

      /*
       * Safari звільняє пам'ять полотен неохоче, а сумарний ліміт на них
       * невеликий — після десятка сканувань нові полотна переставали б
       * створюватись. Обнулений розмір віддає пам'ять одразу.
       */
      const release = () => {
        canvas.width = 0;
        canvas.height = 0;
      };

      /*
       * Декодування синхронне, тож дві спроби не можуть накластися: наступний
       * кадр просимо лише після того, як поточна закінчилась.
       */
      const tick = () => {
        if (!run.alive) {
          release();
          return;
        }
        const now = performance.now();
        const crop = video.readyState >= 2 ? scanCrop(video.videoWidth, video.videoHeight, shape) : null;
        if (crop && decodeDue(now, lastStart, lastCost, pace())) {
          lastStart = now;
          if (canvas.width !== crop.dw) canvas.width = crop.dw;
          if (canvas.height !== crop.dh) canvas.height = crop.dh;
          try {
            ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.dw, crop.dh);
            const text = reader.decodeFromCanvas(canvas).getText().trim();
            if (text) {
              release();
              handleHit(text);
              return;
            }
          } catch {
            /* коду в кадрі немає або кадр ще не готовий — пробуємо наступний */
          }
          lastCost = performance.now() - now;
        }
        nextFrame(tick);
      };
      nextFrame(tick);
    };

    start();
    return () => {
      stop();
    };
  }, [open, handleHit, stop]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const torch: CameraSet = { torch: !torchOn };
    try {
      /*
       * Фокус і зум повторюємо разом із ліхтариком: за специфікацією новий
       * applyConstraints замінює попередні обмеження, і браузер, що читає її
       * буквально, скинув би зум. Якщо ж разом не вийшло — пробуємо сам
       * ліхтарик, щоб через зум не зникла кнопка.
       */
      try {
        await track.applyConstraints({ advanced: [...tuningRef.current, torch] });
      } catch (err) {
        if (!tuningRef.current.length) throw err;
        await track.applyConstraints({ advanced: [torch] });
      }
      setTorchOn((v) => !v);
      haptic(10);
    } catch {
      setTorchAvailable(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] bg-black"
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 h-full w-full object-cover"
          />

          {/*
           * Затемнення з вирізом. Темніє лише те, що довкола рамки, — тінню
           * самої рамки. Усередині кадр лишається яскравим: інакше на
           * термопапері не видно, чи код уже різкий і чи весь у рамці.
           * Квадрат під QR, широка смуга під штрихкод; розміри узгоджені
           * з вирізом у scanCrop, тож усе, що в рамці, розпізнається.
           */}
          <div className="pointer-events-none absolute inset-0">
            <div
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] ${
                qrMode ? "aspect-square w-[min(65vw,300px,55svh)]" : "h-[190px] w-[86%] max-w-[380px]"
              }`}
            >
              <div className="absolute inset-0 rounded-3xl border-2 border-white/70" />
              <Corner className="left-[-2px] top-[-2px] rounded-tl-3xl border-l-4 border-t-4" />
              <Corner className="right-[-2px] top-[-2px] rounded-tr-3xl border-r-4 border-t-4" />
              <Corner className="bottom-[-2px] left-[-2px] rounded-bl-3xl border-b-4 border-l-4" />
              <Corner className="bottom-[-2px] right-[-2px] rounded-br-3xl border-b-4 border-r-4" />
              {status === "scanning" && (
                /*
                 * Лінію рухаємо через transform на обгортці заввишки з рамку:
                 * відсотки translateY рахуються від неї. Таку анімацію
                 * framer-motion віддає браузеру, і вона не ділить головний
                 * потік з ZXing, як ділила анімація top.
                 */
                <motion.div
                  initial={{ transform: "translateY(8%)" }}
                  animate={{ transform: ["translateY(8%)", "translateY(88%)", "translateY(8%)"] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-x-3 inset-y-0"
                >
                  <div className="h-0.5 rounded-full bg-[var(--brand)] shadow-[0_0_18px_4px_var(--brand)]" />
                </motion.div>
              )}
            </div>
          </div>

          {/*
           * Керування без backdrop-blur: розмиття під ним перераховується на
           * кожен кадр відео, а над затемненням і так читається.
           */}
          <div className="pad-safe-t absolute inset-x-0 top-0 flex items-center justify-between p-4">
            <button
              onClick={() => {
                stop();
                onClose();
              }}
              aria-label="Закрити сканер"
              className="grid h-11 w-11 place-items-center rounded-2xl bg-black/60 text-white"
            >
              <X size={20} />
            </button>
            <div className="flex gap-2">
              {torchAvailable && (
                <button
                  onClick={toggleTorch}
                  aria-label="Ліхтарик"
                  className={`grid h-11 w-11 place-items-center rounded-2xl ${
                    torchOn ? "bg-white text-black" : "bg-black/60 text-white"
                  }`}
                >
                  <Flashlight size={19} />
                </button>
              )}
              {manualEntry && (
                <button
                  onClick={() => setManual((v) => !v)}
                  aria-label="Ввести код вручну"
                  className="grid h-11 w-11 place-items-center rounded-2xl bg-black/60 text-white"
                >
                  <Keyboard size={19} />
                </button>
              )}
            </div>
          </div>

          {/* Підказка / помилка / ручний ввід */}
          <div className="pad-safe-b absolute inset-x-0 bottom-0 p-5">
            {(manualEntry && manual) || (manualEntry && (status === "denied" || status === "error")) ? (
              <div className="rounded-xl3 border border-white/15 bg-black/80 p-4">
                {message && <p className="mb-3 text-[13px] leading-snug text-white/80">{message}</p>}
                <label className="mb-2 block text-[12px] font-bold text-white/70">
                  Введи цифри під штрихкодом
                </label>
                <div className="flex gap-2">
                  <input
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    placeholder="4820000000000"
                    className="h-12 flex-1 rounded-2xl border border-white/20 bg-white/10 px-4 text-white placeholder:text-white/40"
                  />
                  <Button
                    onClick={() => manualCode.length >= 6 && handleHit(manualCode)}
                    disabled={manualCode.length < 6}
                  >
                    Ок
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-center gap-2 rounded-full bg-black/70 px-4 py-3">
                  <ScanBarcode size={17} className="text-[var(--brand)]" />
                  <p className="text-[13px] font-semibold text-white">
                    {status === "starting" ? "Вмикаю камеру…" : message || hint}
                  </p>
                </div>
                {/*
                 * Інстинкт — піднести телефон до чека впритул, а саме там
                 * камера й не фокусується. Зум у tuneCamera розраховано на
                 * цю відстань.
                 */}
                {qrMode && status === "scanning" && !message && (
                  <p className="mt-2 text-center text-[12px] font-semibold text-white/75">
                    Не підноси впритул — тримай за 15–20 см, так камера сфокусується
                  </p>
                )}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Corner({ className }: { className: string }) {
  return <span className={`absolute h-7 w-7 border-[var(--brand)] ${className}`} />;
}
