"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Flashlight, Keyboard, ScanBarcode, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BARCODE_FORMATS, hasNativeDetector } from "@/lib/barcode";
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

type Status = "idle" | "starting" | "scanning" | "denied" | "error";

export function BarcodeScanner({
  open,
  onClose,
  onDetect,
}: {
  open: boolean;
  onClose: () => void;
  onDetect: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const zxingRef = useRef<{ reset: () => void } | null>(null);
  const doneRef = useRef(false);

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualCode, setManualCode] = useState("");

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    zxingRef.current?.reset();
    zxingRef.current = null;
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
      onDetect(code);
    },
    [onDetect, stop],
  );

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    doneRef.current = false;
    let cancelled = false;

    const start = async () => {
      setStatus("starting");
      setMessage("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        setTorchAvailable(Boolean(caps?.torch));

        setStatus("scanning");

        if (hasNativeDetector()) {
          runNative(video);
        } else {
          await runZxing(video);
        }
      } catch (err) {
        if (cancelled) return;
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

    const runNative = (video: HTMLVideoElement) => {
      const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
      const detector = new Ctor({ formats: [...BARCODE_FORMATS] });
      let busy = false;

      const tick = async () => {
        if (doneRef.current) return;
        if (!busy && video.readyState >= 2) {
          busy = true;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue?.trim();
            if (value) {
              handleHit(value);
              return;
            }
          } catch {
            /* кадр не розпізнано — пробуємо далі */
          } finally {
            busy = false;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const runZxing = async (video: HTMLVideoElement) => {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      if (doneRef.current || cancelled) return;
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoElement(video, (result) => {
        const text = result?.getText?.();
        if (text) handleHit(text.trim());
      });
      zxingRef.current = { reset: () => controls.stop() };
    };

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, handleHit, stop]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet & { torch: boolean }],
      });
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

          {/* Затемнення з вирізом */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-black/55" />
            <div className="absolute left-1/2 top-1/2 h-[190px] w-[86%] max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]">
              <div className="absolute inset-0 rounded-3xl border-2 border-white/70" />
              <Corner className="left-[-2px] top-[-2px] rounded-tl-3xl border-l-4 border-t-4" />
              <Corner className="right-[-2px] top-[-2px] rounded-tr-3xl border-r-4 border-t-4" />
              <Corner className="bottom-[-2px] left-[-2px] rounded-bl-3xl border-b-4 border-l-4" />
              <Corner className="bottom-[-2px] right-[-2px] rounded-br-3xl border-b-4 border-r-4" />
              {status === "scanning" && (
                <motion.div
                  initial={{ top: "8%" }}
                  animate={{ top: ["8%", "88%", "8%"] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-x-3 h-0.5 rounded-full bg-[var(--brand)] shadow-[0_0_18px_4px_var(--brand)]"
                />
              )}
            </div>
          </div>

          {/* Керування */}
          <div className="pad-safe-t absolute inset-x-0 top-0 flex items-center justify-between p-4">
            <button
              onClick={() => {
                stop();
                onClose();
              }}
              aria-label="Закрити сканер"
              className="grid h-11 w-11 place-items-center rounded-2xl bg-black/50 text-white backdrop-blur"
            >
              <X size={20} />
            </button>
            <div className="flex gap-2">
              {torchAvailable && (
                <button
                  onClick={toggleTorch}
                  aria-label="Ліхтарик"
                  className={`grid h-11 w-11 place-items-center rounded-2xl backdrop-blur ${
                    torchOn ? "bg-white text-black" : "bg-black/50 text-white"
                  }`}
                >
                  <Flashlight size={19} />
                </button>
              )}
              <button
                onClick={() => setManual((v) => !v)}
                aria-label="Ввести код вручну"
                className="grid h-11 w-11 place-items-center rounded-2xl bg-black/50 text-white backdrop-blur"
              >
                <Keyboard size={19} />
              </button>
            </div>
          </div>

          {/* Підказка / помилка / ручний ввід */}
          <div className="pad-safe-b absolute inset-x-0 bottom-0 p-5">
            {manual || status === "denied" || status === "error" ? (
              <div className="rounded-xl3 border border-white/15 bg-black/70 p-4 backdrop-blur">
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
              <div className="flex items-center justify-center gap-2 rounded-full bg-black/60 px-4 py-3 backdrop-blur">
                <ScanBarcode size={17} className="text-[var(--brand)]" />
                <p className="text-[13px] font-semibold text-white">
                  {status === "starting" ? "Вмикаю камеру…" : "Наведи на штрихкод продукту"}
                </p>
              </div>
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
