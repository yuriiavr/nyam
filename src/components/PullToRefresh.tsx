"use client";

import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { haptic } from "@/lib/utils";

/**
 * Потягування згори оновлює сторінку.
 *
 * У встановленому застосунку власного оновлення браузера немає: адресного
 * рядка нема, а гортання за край вимкнене, щоб сторінка не бовталась. Тож
 * жест доводиться робити самим — і робити його таким, до якого звикли в
 * стрічках: контент іде за пальцем з опором, значок проявляється й
 * доростає, на порозі клацає вібрація, після відпускання сторінка лишається
 * трохи опущеною, поки справді оновлюється.
 */

/** Скільки треба протягнути, щоб оновлення спрацювало. */
const THRESHOLD = 72;
/** На скільки сторінка лишається опущеною, поки триває оновлення. */
const HOLD = 56;
/** Далі не тягнеться: опір стає нескінченним. */
const MAX = 120;
/** Найменший час показу значка — щоб він не блимнув і зник. */
const MIN_SPIN_MS = 600;

const SPRING = { type: "spring", stiffness: 420, damping: 38 } as const;

export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const [busy, setBusy] = useState(false);

  const busyRef = useRef(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  const opacity = useTransform(y, [6, THRESHOLD * 0.8], [0, 1]);
  const scale = useTransform(y, [0, THRESHOLD], [0.5, 1]);
  const spin = useTransform(y, [0, THRESHOLD], [0, 200]);
  const badgeY = useTransform(y, (v) => v * 0.55);

  /*
   * Зсув вмісту пишемо руками й прибираємо стиль повністю, коли жест
   * закінчився. Постійний transform на обгортці зробив би її системою
   * координат для всього, що всередині позиціоноване fixed, — а це аркуші,
   * сканер і тости на кожному екрані. Вони б поїхали разом зі сторінкою.
   */
  useEffect(
    () =>
      y.on("change", (v) => {
        const node = content.current;
        if (!node) return;
        node.style.transform = v > 0.5 ? `translateY(${v}px)` : "";
      }),
    [y],
  );

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    const gentle = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const settle = (to: number) => (gentle ? y.set(to) : animate(y, to, SPRING));

    /*
     * Жест доречний, лише коли сторінка вже вгорі й нічого не перекриває.
     * Відкритий аркуш прибиває сторінку `position: fixed` — тягнути її
     * з-під нього не можна, а ознака цього в нас уже є.
     */
    const canStart = (target: EventTarget | null) =>
      !busyRef.current &&
      window.scrollY <= 0 &&
      document.body.style.position !== "fixed" &&
      !(target instanceof Element && target.closest("[data-no-pull]"));

    const onStart = (e: TouchEvent) => {
      startY.current = canStart(e.target) ? e.touches[0].clientY : null;
      armed.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current == null) return;

      const delta = e.touches[0].clientY - startY.current;
      // Палець пішов угору або сторінку встигли прокрутити — це вже не наш жест.
      if (delta <= 0 || window.scrollY > 0) {
        startY.current = null;
        y.set(0);
        return;
      }

      e.preventDefault();
      // Опір: половина шляху пальця, і не далі стелі.
      const pulled = Math.min(MAX, delta * 0.45);
      y.set(pulled);

      if (pulled >= THRESHOLD && !armed.current) {
        armed.current = true;
        haptic(12);
      } else if (pulled < THRESHOLD && armed.current) {
        armed.current = false;
      }
    };

    const onEnd = () => {
      if (startY.current == null) return;
      const go = armed.current;
      startY.current = null;
      armed.current = false;

      if (!go) {
        settle(0);
        return;
      }

      busyRef.current = true;
      setBusy(true);
      settle(HOLD);

      void Promise.all([
        Promise.resolve(refresh.current()),
        new Promise((done) => setTimeout(done, MIN_SPIN_MS)),
      ])
        .catch(() => undefined)
        .then(() => {
          busyRef.current = false;
          setBusy(false);
          settle(0);
        });
    };

    node.addEventListener("touchstart", onStart, { passive: true });
    // Не passive: під час жесту треба спинити власну прокрутку сторінки.
    node.addEventListener("touchmove", onMove, { passive: false });
    node.addEventListener("touchend", onEnd);
    node.addEventListener("touchcancel", onEnd);

    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
      node.removeEventListener("touchend", onEnd);
      node.removeEventListener("touchcancel", onEnd);
    };
  }, [y]);

  return (
    <div ref={host} className="relative">
      {/* Значок живе над вмістом і їде повільніше за нього. */}
      <motion.div
        aria-hidden={!busy}
        style={{ y: badgeY, opacity, scale }}
        className="pad-safe-t pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center"
      >
        <span className="mt-2 grid h-9 w-9 place-items-center rounded-full border border-line bg-bg-elev shadow-[var(--shadow-card)]">
          <motion.span style={busy ? undefined : { rotate: spin }} className="grid place-items-center">
            <RefreshCw size={16} className={busy ? "animate-spin text-brand" : "text-muted"} />
          </motion.span>
        </span>
      </motion.div>

      <div ref={content}>{children}</div>
    </div>
  );
}
