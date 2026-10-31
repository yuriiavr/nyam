"use client";

import {
  AnimatePresence,
  motion,
  type PanInfo,
  type HTMLMotionProps,
} from "framer-motion";
import { Loader2, Star, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { macroShares } from "@/lib/nutrition";
import { UNIT_GROUPS, unitLabel } from "@/lib/units";
import type { Nutrition, Unit } from "@/lib/types";
import { cn, haptic } from "@/lib/utils";

/* ── Button ───────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "brand-gradient text-brand-ink font-bold shadow-[0_10px_30px_-12px] shadow-brand/70",
  secondary: "bg-surface-2 text-ink font-semibold",
  ghost: "bg-transparent text-muted font-semibold",
  outline: "bg-transparent text-ink font-semibold border border-line",
  danger: "bg-berry/15 text-berry font-semibold border border-berry/30",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13px] rounded-[8px] gap-1.5",
  md: "h-12 px-5 text-[15px] rounded-[10px] gap-2",
  lg: "h-14 px-6 text-base rounded-[12px] gap-2.5",
};

export interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  full?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  full,
  className,
  children,
  onClick,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: disabled || loading ? 1 : 0.95 }}
      transition={{ type: "spring", stiffness: 520, damping: 28 }}
      disabled={disabled || loading}
      onClick={(e) => {
        if (!disabled && !loading) haptic(10);
        onClick?.(e);
      }}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap transition-colors",
        "disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        full && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : children}
    </motion.button>
  );
}

export function IconButton({
  className,
  children,
  label,
  ...rest
}: ButtonProps & { label: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.88 }}
      aria-label={label}
      onClick={(e) => {
        haptic(8);
        rest.onClick?.(e);
      }}
      className={cn(
        "grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink transition-colors active:bg-line",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/* ── Chip ─────────────────────────────────────────────────────────────── */

export function Chip({
  active,
  onClick,
  children,
  className,
  size = "md",
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      whileTap={onClick ? { scale: 0.94 } : undefined}
      onClick={
        onClick
          ? () => {
              haptic(8);
              onClick();
            }
          : undefined
      }
      className={cn(
        "inline-flex shrink-0 select-none items-center gap-1.5 rounded-full border font-semibold transition-colors",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        active
          ? "border-transparent brand-gradient text-brand-ink"
          : "border-line bg-surface text-muted",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

/* ── Card ─────────────────────────────────────────────────────────────── */

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[10px] border border-line bg-surface",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────── */

/**
 * Картка-список з дизайну: заголовок дрібними великими літерами, далі рядки,
 * розділені лінією. Так зібрані всі екрани — від головної до налаштувань.
 */
export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("overflow-hidden rounded-[10px] border border-line bg-surface", className)} {...rest}>
      {children}
    </div>
  );
}

/** Заголовок панелі: «СЬОГОДНІ             Щоденник ›». */
export function PanelHeader({
  label,
  aside,
  icon,
  tone,
  className,
}: {
  label: ReactNode;
  /** Праворуч: лічильник, посилання «Усе ›» тощо. Рядок — тьмяним. */
  aside?: ReactNode;
  icon?: ReactNode;
  tone?: "brand";
  className?: string;
}) {
  return (
    <div className={cn("flex h-9 items-center justify-between gap-3 pl-3.5 pr-3.5", className)}>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 truncate text-[11px] font-extrabold uppercase tracking-[0.07em]",
          tone === "brand" ? "text-brand" : "text-muted",
        )}
      >
        {icon}
        {label}
      </span>
      {typeof aside === "string" || typeof aside === "number" ? (
        <span className="shrink-0 text-[11.5px] font-bold text-faint">{aside}</span>
      ) : (
        aside
      )}
    </div>
  );
}

/** Квадратна кнопка шапки 38×38: налаштування, назад, «+». */
export const TILE_BUTTON =
  "grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink transition-colors active:bg-line";
export const TILE_BUTTON_BRAND =
  "grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] brand-gradient text-brand-ink";

/** Перемикач 44×26 з дизайну. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        haptic(8);
        onChange(!checked);
      }}
      className={cn(
        "relative h-[26px] w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-brand" : "bg-line-strong",
      )}
    >
      <span
        className={cn(
          "absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
          checked && "translate-x-[18px]",
        )}
      />
    </button>
  );
}

/**
 * Три стовпчики БЖВ з дизайну: квадратик кольору й назва, тонка смужка і
 * «62 / 110 г». Без цілі смужка показує частку нутрієнта в калоріях.
 */
export function MacroGrid({
  nutrition,
  goals,
  className,
}: {
  nutrition: Nutrition;
  goals?: { protein?: number; fat?: number; carbs?: number };
  className?: string;
}) {
  const shares = macroShares(nutrition);
  const parts = [
    { key: "protein", label: "Білки", value: nutrition.protein, goal: goals?.protein, share: shares.protein, color: "var(--macro-protein)" },
    { key: "fat", label: "Жири", value: nutrition.fat, goal: goals?.fat, share: shares.fat, color: "var(--macro-fat)" },
    { key: "carbs", label: "Вуглеводи", value: nutrition.carbs, goal: goals?.carbs, share: shares.carbs, color: "var(--macro-carbs)" },
  ] as const;
  return (
    <div className={cn("grid grid-cols-3 gap-3", className)}>
      {parts.map((p) => {
        const width = p.goal ? Math.min(100, (p.value / p.goal) * 100) : p.share * 100;
        return (
          <div key={p.key} className="flex min-w-0 flex-col gap-1.5">
            <span className="flex items-center gap-[5px] truncate text-[11.5px] font-bold text-muted">
              <span className="h-[7px] w-[7px] shrink-0 rounded-[2px]" style={{ background: p.color }} />
              {p.label}
            </span>
            <div className="h-1 overflow-hidden rounded-[2px] bg-surface-2">
              <div className="h-full rounded-[2px] transition-[width] duration-500" style={{ width: `${width}%`, background: p.color }} />
            </div>
            <span className="truncate text-[12px] font-bold">
              {Math.round(p.value)}
              <span className="text-faint">{p.goal ? ` / ${p.goal} г` : " г"}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** «1 240» — тисячі через вузький пробіл, як у дизайні. */
export function formatKcal(n: number): string {
  return Math.round(n).toLocaleString("uk-UA");
}

/* ── Bottom sheet ─────────────────────────────────────────────────────── */

/**
 * Видима частина екрана — та, що лишається поверх клавіатури.
 *
 * Раніше тут рахувалась висота клавіатури, і аркуш підіймався на це число.
 * Виходило крихко: iOS шле подію посеред анімації, а ще сам прокручує
 * сторінку, щоб показати поле, — і будь-яке одне невдало піймане значення
 * лишало аркуш під клавіатурою. Саме тому він зникав, коли стерти назву й
 * почати писати іншу.
 *
 * Тепер числа нема. Є контейнер, який дорівнює видимій області (висота й
 * зсув беруться з visualViewport), а аркуш просто притиснутий до його низу.
 * Що б не робив браузер із viewport, контейнер їде разом із ним, і «низ
 * видимого» лишається низом видимого.
 */
function useVisibleViewport(active: boolean) {
  const [view, setView] = useState(() => ({
    height: typeof window === "undefined" ? 0 : window.innerHeight,
    offsetTop: 0,
    keyboard: false,
  }));

  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;

    const update = () => {
      if (!vv) {
        setView({ height: window.innerHeight, offsetTop: 0, keyboard: false });
        return;
      }
      setView({
        height: Math.round(vv.height),
        offsetTop: Math.round(vv.offsetTop),
        // Адресний рядок теж рухає viewport, але не на цілу клавіатуру.
        keyboard: window.innerHeight - vv.height > 80,
      });
    };

    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active]);

  return view;
}

/**
 * Скільки аркушів відкрито просто зараз.
 *
 * Живе в модулі, а не в стані: замок прокрутки — це властивість сторінки, а
 * не окремого аркуша, і знімати його має лише останній, хто йшов.
 */
let sheetDepth = 0;
let lockedScrollY = 0;
let lockedStyles: Record<string, string> | null = null;

/**
 * Чи відкритий зараз хоч один аркуш.
 *
 * Для того, що зʼявляється саме, без натиску (пропозиція сповіщень): влізти
 * поверх аркуша, у якому людина щось заповнює, означає збити її з думки.
 */
export function anySheetOpen(): boolean {
  return sheetDepth > 0;
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  maxHeight = "88dvh",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxHeight?: string;
}) {
  /*
   * Сторінку під аркушем тримаємо нерухомо жорстко: не `overflow: hidden`, а
   * `position: fixed` зі збереженою прокруткою.
   *
   * На iOS самого overflow замало. Коли клавіатуру ховаєш і знову викликаєш,
   * Safari прокручує сторінку сам, щоб показати поле, — а аркуш позиціонований
   * fixed, тобто відносно сторінки. Вона їде, і поле пошуку разом із нею
   * відлітає вгору. Прибити сторінку на місці дешевше, ніж потім вираховувати
   * цей зсув: коли прокручуватись нічому, з'їжджати теж нема чому.
   */
  useEffect(() => {
    if (!open) return;

    const body = document.body;
    /*
     * Аркуші складаються в стос: із картки товару відкривається вибір
     * продукту, з нього — створення свого. Тому і замок прокрутки, і Escape
     * рахують глибину. Без цього другий аркуш запамʼятовував би як
     * «початковий» вже прибитий стан сторінки й на виході повертав її на
     * початок, а Escape закривав би весь стос замість верхнього аркуша.
     */
    const depth = ++sheetDepth;
    if (depth === 1) {
      lockedStyles = {
        overflow: body.style.overflow,
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
      };
      lockedScrollY = window.scrollY;

      body.style.overflow = "hidden";
      body.style.position = "fixed";
      body.style.top = `-${lockedScrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sheetDepth === depth) onClose();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      sheetDepth = Math.max(0, sheetDepth - 1);
      window.removeEventListener("keydown", onKey);
      if (sheetDepth === 0 && lockedStyles) {
        Object.assign(body.style, lockedStyles);
        // Повертаємо точно туди, де були: інакше закриття аркуша щоразу
        // викидало б на початок стрічки.
        window.scrollTo(0, lockedScrollY);
        lockedStyles = null;
      }
    };
  }, [open, onClose]);

  const view = useVisibleViewport(open);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 620) {
      haptic(10);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
          />
          {/*
            Контейнер дорівнює видимій області екрана й їде разом із нею;
            аркуш усередині просто притиснутий до низу. Клавіатура від цього
            перестає бути окремим випадком: вона просто зменшує видиме.
          */}
          <div
            style={{ height: view.height, transform: `translateY(${view.offsetTop}px)` }}
            className="pointer-events-none fixed inset-x-0 top-0 z-50"
          >
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
            style={{ maxHeight: `min(${maxHeight}, 100%)` }}
            className="pointer-events-auto absolute bottom-0 left-1/2 flex w-full max-w-[560px] -translate-x-1/2 flex-col overflow-hidden rounded-t-[20px] border-t border-line bg-bg-elev"
          >
            <div className="flex cursor-grab justify-center pt-2.5 pb-2 active:cursor-grabbing">
              <div className="h-1 w-9 rounded-full bg-line-strong" />
            </div>
            {title && (
              <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-1">
                <h2 className="min-w-0 flex-1 font-display text-base font-bold">{title}</h2>
                <IconButton label="Закрити" onClick={onClose} className="h-9 w-9 rounded-[10px]">
                  <X size={17} />
                </IconButton>
              </div>
            )}
            <div className="no-scrollbar flex-1 overflow-y-auto overscroll-contain px-5 pb-2">
              {children}
            </div>
            {footer && (
              <div className="pad-safe-b border-t border-line bg-bg-elev px-5 py-3">{footer}</div>
            )}
            {/* Відступ під вирізи телефона потрібен лише коли аркуш справді
                внизу екрана: над клавіатурою він просто марно займає місце. */}
            {!view.keyboard && <div className="pad-safe-b" />}
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Rating ───────────────────────────────────────────────────────────── */

export function Stars({
  value,
  size = 14,
  onChange,
  className,
}: {
  value: number;
  size?: number;
  onChange?: (v: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = value >= i - 0.25;
        const star = (
          <Star
            size={size}
            className={filled ? "fill-brand-2 text-brand-2" : "text-faint"}
            strokeWidth={2}
          />
        );
        return onChange ? (
          <motion.button
            key={i}
            whileTap={{ scale: 0.8 }}
            aria-label={`${i} з 5`}
            onClick={() => {
              haptic(12);
              onChange(i);
            }}
            className="p-1"
          >
            {star}
          </motion.button>
        ) : (
          <span key={i}>{star}</span>
        );
      })}
    </div>
  );
}

/* ── Skeleton / empty ─────────────────────────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-2xl bg-surface-2", className)} />;
}

export function EmptyState({
  emoji,
  title,
  note,
  action,
}: {
  emoji: string;
  title: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="floaty text-5xl">{emoji}</div>
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {note && <p className="max-w-[280px] text-sm leading-relaxed text-muted">{note}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

/* ── Segmented control ────────────────────────────────────────────────── */

/**
 * Перемикач із «повзунком», як у редизайні комори: тонка рамка, повзунок
 * кольору лінії. `count` — тьмяне число поруч із підписом («У коморі 11»):
 * воно не мусить кричати, але й ховати його в дужки — зайвий шум.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count?: ReactNode; icon?: ReactNode }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "no-scrollbar flex overflow-x-auto rounded-[10px] border border-line bg-surface p-[3px]",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => {
              haptic(8);
              onChange(o.value);
            }}
            aria-pressed={active}
            className="relative min-h-[32px] shrink-0 flex-1 whitespace-nowrap rounded-[7px] px-3 py-1.5 text-[13.5px] font-extrabold"
          >
            {active && (
              <motion.span
                layoutId={`seg-${options.map((x) => x.value).join()}`}
                transition={{ type: "spring", stiffness: 480, damping: 38 }}
                className="absolute inset-0 rounded-[7px] bg-line shadow-[0_4px_14px_-4px_rgb(0_0_0_/_0.7)] light:shadow-none"
              />
            )}
            <span
              className={cn(
                "relative z-10 inline-flex items-center gap-1.5 transition-colors",
                active ? "text-ink" : "text-muted",
              )}
            >
              {o.icon}
              {o.label}
              {o.count != null && o.count !== "" && (
                <span className="text-[11.5px] text-faint">{o.count}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Toast ────────────────────────────────────────────────────────────── */

interface ToastItem {
  id: number;
  text: string;
  emoji?: string;
}

const ToastCtx = createContext<(text: string, emoji?: string) => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((text: string, emoji?: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, text, emoji }].slice(-3));
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2600);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/*
        Відступ під виріз і видимий відступ — на різних елементах. Разом вони
        сперечаються за padding-top, і pt-3 перемагає (він пізніше в CSS), тож
        тост виїжджав просто під острів, поверх годинника.
      */}
      <div className="pad-safe-t pointer-events-none fixed inset-x-0 top-0 z-[60] px-4">
        <div className="flex flex-col items-center gap-2 pt-3">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ y: -40, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -20, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="glass flex max-w-[92%] items-center gap-2.5 rounded-full border border-line px-4 py-2.5 shadow-[var(--shadow-card)]"
            >
              {t.emoji && <span className="text-base leading-none">{t.emoji}</span>}
              <span className="text-[13px] font-semibold leading-tight">{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        </div>
      </div>
    </ToastCtx.Provider>
  );
}

/* ── Дрібниці ─────────────────────────────────────────────────────────── */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("animate-spin text-muted", className)} size={20} />;
}

export function SectionTitle({
  title,
  note,
  action,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-4">
      <div className="min-w-0">
        <h2 className="font-display text-[17px] font-bold leading-tight">{title}</h2>
        {note && <p className="mt-0.5 truncate text-[12px] text-muted">{note}</p>}
      </div>
      {action}
    </div>
  );
}

export function Avatar({
  emoji,
  gradient,
  src,
  size = 40,
  ring,
}: {
  emoji: string;
  gradient: [string, string];
  src?: string | null;
  size?: number;
  ring?: boolean;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundImage: src ? undefined : `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
        fontSize: size * 0.46,
      }}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full",
        ring && "ring-2 ring-brand ring-offset-2 ring-offset-bg",
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="leading-none">{emoji}</span>
      )}
    </div>
  );
}

/* ── Кількість ────────────────────────────────────────────────────────── */

/**
 * Число плюс одиниця виміру — той самий контрол у формі рецепта і в коморі.
 *
 * Свідомо один компонент на обидва місця: кількість продукту вдома і
 * кількість у рецепті мають вводитись однаково, інакше «200 г» в одному
 * екрані й вільний текст в іншому неможливо ані порівняти, ані скласти.
 *
 * `defaultUnit` — типова одиниця продукту (молоко в мл, яйця в штуках).
 * Її показуємо в селекті ще до вибору, але щойно вводять число, вона
 * фіксується у стані: інакше кількість зберігалась би без одиниці.
 */
export function QuantityInput({
  amount,
  unit,
  defaultUnit = "g",
  onChange,
  allowTaste = true,
  placeholder = "200",
  label,
  className,
}: {
  amount?: number;
  unit?: Unit;
  defaultUnit?: Unit;
  onChange: (next: { amount?: number; unit: Unit }) => void;
  /** «За смаком» доречне в рецепті, але не в коморі. */
  allowTaste?: boolean;
  placeholder?: string;
  /** Для доступності: до чого саме ця кількість. */
  label?: string;
  className?: string;
}) {
  const current = unit ?? defaultUnit;

  /*
   * Поле тримає сирий текст, а не число зі стану.
   *
   * Інакше «2,» одразу перетворювалось на «2» — Number("2,") це 2, і кома
   * зникала просто під пальцями, набрати «2,5» ставало неможливо.
   * Зі стану підхоплюємо лише тоді, коли там справді інше число: так
   * значення, що прийшло ззовні, поле побачить, а набір не переб'ється.
   */
  const [text, setText] = useState(amount != null ? String(amount) : "");
  useEffect(() => {
    const typed = Number(text.replace(",", "."));
    const same = amount == null ? text === "" : Number.isFinite(typed) && typed === amount;
    if (!same) setText(amount != null ? String(amount) : "");
  }, [amount]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = allowTaste
    ? UNIT_GROUPS
    : UNIT_GROUPS.map((g) => ({ ...g, units: g.units.filter((u) => u !== "taste") })).filter(
        (g) => g.units.length > 0,
      );

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <input
        value={text}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.,]/g, "");
          setText(raw);
          const next = raw === "" ? undefined : Number(raw.replace(",", "."));
          onChange({ amount: Number.isFinite(next) ? next : undefined, unit: current });
        }}
        inputMode="decimal"
        placeholder={placeholder}
        disabled={current === "taste"}
        aria-label={label ? `Кількість: ${label}` : "Кількість"}
        className="h-9 w-[62px] rounded-[8px] bg-surface-2 px-2 text-center text-[13px] font-semibold disabled:opacity-40"
      />
      <select
        value={current}
        onChange={(e) => {
          const next = e.target.value as Unit;
          onChange({ amount: next === "taste" ? undefined : amount, unit: next });
        }}
        aria-label={label ? `Одиниця для ${label}` : "Одиниця виміру"}
        className="h-9 w-[76px] shrink-0 rounded-[8px] bg-surface-2 px-1.5 text-center text-[12px] font-semibold"
      >
        {groups.map((group) => (
          <optgroup key={group.title} label={group.title}>
            {group.units.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/* ── Розподіл БЖВ ─────────────────────────────────────────────────────── */

/**
 * Смужка розподілу білків, жирів і вуглеводів у калоріях.
 *
 * Відтінок закріплений за нутрієнтом, а не за порядком: синій завжди білок,
 * бурштиновий завжди жир, зелений завжди вуглеводи — і на головній, і в
 * щоденнику. Підписи з цифрами під смужкою обовʼязкові, а не для краси:
 * зелений і бурштиновий сусідять, і при дальтонізмі їх розрізняє саме
 * підпис, а не колір. З тієї ж причини між сегментами є проміжок.
 */
export function MacroBar({
  nutrition,
  goals,
  className,
}: {
  nutrition: Nutrition;
  /** Денні цілі БЖВ, г: є — підпис «Б 80 / 150 г». */
  goals?: { protein?: number; fat?: number; carbs?: number };
  className?: string;
}) {
  const shares = macroShares(nutrition);
  const parts = [
    { key: "protein", share: shares.protein, grams: nutrition.protein, goal: goals?.protein, label: "Б", color: "var(--macro-protein)" },
    { key: "fat", share: shares.fat, grams: nutrition.fat, goal: goals?.fat, label: "Ж", color: "var(--macro-fat)" },
    { key: "carbs", share: shares.carbs, grams: nutrition.carbs, goal: goals?.carbs, label: "В", color: "var(--macro-carbs)" },
  ];

  return (
    <div className={className}>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-surface-2">
        {parts.map((p) => (
          <div
            key={p.key}
            style={{ width: `${p.share * 100}%`, background: p.color }}
            className="rounded-full"
          />
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-muted">
        {parts.map((p, i) => (
          <span key={p.key}>
            {i > 0 && " · "}
            <span className="font-bold" style={{ color: p.color }}>
              {p.label} {p.grams}
              {p.goal ? ` / ${p.goal}` : ""} г
            </span>
          </span>
        ))}
      </p>
    </div>
  );
}
