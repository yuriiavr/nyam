import type { Recipe } from "./types";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Тактильний відгук — працює на Android; на iOS мовчки ігнорується. */
export function haptic(pattern: number | number[] = 12) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* не критично */
    }
  }
}

/** Ідентифікатор у форматі UUID — саме його очікує Postgres. */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Запасний варіант для дуже старих браузерів.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const uid = (prefix = "id") =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} хв`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} год ${m} хв` : `${h} год`;
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(".0", "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(".0", "")}M`;
}

const RTF = ["щойно", "хв", "год", "дн", "тиж"];
export function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const min = diff / 60000;
  if (min < 2) return RTF[0];
  if (min < 60) return `${Math.floor(min)} ${RTF[1]} тому`;
  const h = min / 60;
  if (h < 24) return `${Math.floor(h)} ${RTF[2]} тому`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)} ${RTF[3]}. тому`;
  return `${Math.floor(d / 7)} ${RTF[4]}. тому`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(arr: readonly T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

export function avgRating(r: Recipe): number {
  if (!r.stats.ratingCount) return 0;
  return r.stats.ratingSum / r.stats.ratingCount;
}

/** Ключ дня у форматі YYYY-MM-DD у локальному часі. */
export function dateKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function startOfWeek(d: Date = new Date()): Date {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7; // понеділок = 0
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Нічний дожор";
  if (h < 11) return "Доброго ранку";
  if (h < 16) return "Доброго дня";
  if (h < 22) return "Доброго вечора";
  return "Пізній вечір";
}

/** Який прийом їжі логічно пропонувати зараз. */
export function currentMeal(now: Date = new Date()): "breakfast" | "lunch" | "dinner" | "snack" {
  const h = now.getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 22) return "dinner";
  return "snack";
}

/**
 * Стискає зображення у data:URL, щоб воно поміщалось у localStorage
 * і швидко вантажилось на мобільному.
 */
export function compressImage(file: File, maxSide = 1080, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Не вдалося відкрити зображення"));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas недоступний"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const MEAL_LABEL: Record<string, string> = {
  breakfast: "Сніданок",
  lunch: "Обід",
  dinner: "Вечеря",
  snack: "Перекус",
  dessert: "Десерт",
  drink: "Напій",
};

export const MOOD_META: Record<string, { label: string; emoji: string }> = {
  fast: { label: "Швидко", emoji: "⚡" },
  comfort: { label: "Комфорт-фуд", emoji: "🫂" },
  healthy: { label: "Корисне", emoji: "🥗" },
  hearty: { label: "Ситно", emoji: "💪" },
  spicy: { label: "Гостре", emoji: "🌶️" },
  sweet: { label: "Солодке", emoji: "🍭" },
  fancy: { label: "Вразити", emoji: "✨" },
  cheap: { label: "Бюджетно", emoji: "🪙" },
  cozy: { label: "Зігрітись", emoji: "🔥" },
  fresh: { label: "Освіжитись", emoji: "🧊" },
};

export const DIFFICULTY_LABEL = ["", "Просто", "Середньо", "Складно"];

/* ── Строк придатності ────────────────────────────────────────────────── */

export interface ExpiryInfo {
  /** Днів до кінця; відʼємне — вже прострочено. */
  days: number;
  label: string;
  tone: "expired" | "soon" | "ok";
}

/**
 * Скільки лишилось продукту. Рахуємо в цілих днях за місцевою датою:
 * «сьогодні» для користувача важливіше за точність до годин.
 */
export function expiryInfo(expiresAt: string | undefined, now = new Date()): ExpiryInfo | null {
  if (!expiresAt) return null;
  const end = new Date(`${expiresAt}T00:00:00`);
  if (isNaN(end.getTime())) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((end.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) {
    const ago = Math.abs(days);
    return {
      days,
      tone: "expired",
      label: ago === 1 ? "прострочено вчора" : `прострочено ${ago} дн. тому`,
    };
  }
  if (days === 0) return { days, tone: "soon", label: "сьогодні останній день" };
  if (days === 1) return { days, tone: "soon", label: "завтра" };
  if (days <= 3) return { days, tone: "soon", label: `${days} дні` };
  return { days, tone: "ok", label: `${days} ${plural(days, "день", "дні", "днів")}` };
}
