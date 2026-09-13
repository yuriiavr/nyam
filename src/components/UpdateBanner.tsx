"use client";

import { RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useNavHidden } from "./BottomNav";
import { Button, Sheet } from "./ui";
import { RELOAD_LOOP_WINDOW_MS, isReloadLoop, type ReloadMark } from "@/lib/schema-version";

/**
 * «Застосунок оновився» — коли сервер уже знає новішу форму даних.
 *
 * Закрити не можна ніяк: ні хрестика, ні тла, ні свайпу вниз, ні Escape.
 * Старий код, що лишився працювати, пише в базу по-старому, і кожна його зміна
 * після оновлення схеми — ризик зіпсувати дані (див. src/lib/schema-version.ts).
 * Єдиний вихід — перезапуск. Сам запис у базу тим часом уже замкнено в
 * клієнті Supabase, тож банер — це пояснення й кнопка, а не єдиний захист.
 *
 * Але не скрізь однаково. Готування, створення рецепта, сканер і вхід — ті
 * самі екрани, де ховається навігація: там людина посеред справи, і аркуш на
 * пів екрана закрив би таймер, що саме біжить, чи недописаний рецепт. Там —
 * компактна смужка під заголовком: видно завжди, але крок і таймер лишаються
 * на місці. Перезапуститись людина вирішить сама, коли зніме каструлю, — а
 * «Далі» на останньому кроці вже нічого в базі не спише.
 */

/**
 * Позначка «щойно перезапускались для цієї версії» — див. isReloadLoop.
 *
 * Двічі: у sessionStorage і в history.state поточного запису історії. Друге
 * переживає перезавантаження так само, але не зникає, коли сховище сайту
 * заблоковане, — а без позначки запобіжник мовчки вимикався б, і стара
 * сторінка з кешу щоразу замикалась би аркушем.
 */
const RELOAD_MARK = "nyam-reloaded-for-schema";

/** Скільки чекати на service worker, перш ніж просто перезавантажити. */
const SW_UPDATE_TIMEOUT_MS = 3000;

/** Закрити аркуш не можна — тож і реагувати нема на що. Стабільна, бо Sheet тримає її в залежностях. */
const stay = () => {};

function readReloadMark(): unknown {
  try {
    const raw = sessionStorage.getItem(RELOAD_MARK);
    if (raw) return JSON.parse(raw);
  } catch {
    /* сховища немає чи там сміття — пробуємо історію */
  }
  try {
    const state: unknown = window.history.state;
    if (state && typeof state === "object" && RELOAD_MARK in state) {
      return (state as Record<string, unknown>)[RELOAD_MARK];
    }
  } catch {
    /* немає й там — отже, не перезапускались */
  }
  return null;
}

function writeReloadMark(mark: ReloadMark) {
  try {
    sessionStorage.setItem(RELOAD_MARK, JSON.stringify(mark));
  } catch {
    /* лишається history.state */
  }
  try {
    // Без адреси й зі збереженням стану Next (__NA…): роутер такий виклик пропускає як є.
    const state: unknown = window.history.state;
    window.history.replaceState({ ...(state && typeof state === "object" ? state : {}), [RELOAD_MARK]: mark }, "");
  } catch {
    /* у гіршому разі після перезапуску знову покажемо аркуш */
  }
}

/** Проміс, що завершується не пізніше ms і ніколи не кидає. */
function settle(promise: Promise<unknown> | undefined, ms: number): Promise<void> {
  return Promise.race([
    Promise.resolve(promise).then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

/**
 * Перезапуск: спершу — свіжий service worker, потім — сторінка.
 *
 * Сторінку sw.js і так бере з мережі, а статика в новій версії має нові
 * назви, тож самого reload досить. update() — про запас, на випадок, коли
 * змінився й сам sw.js: без нього новий воркер чекав би наступного запуску.
 * Але на нього — не більше кількох секунд: воркер, що завис чи недоступний
 * (приватний режим, вбудований браузер), не має тримати кнопку вічно.
 */
async function reloadApp(schema: number) {
  writeReloadMark({ schema, at: Date.now() });
  try {
    if ("serviceWorker" in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.getRegistration(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), SW_UPDATE_TIMEOUT_MS)),
      ]);
      await settle(reg?.update(), SW_UPDATE_TIMEOUT_MS);
    }
  } catch {
    /* воркер тут не головне — перезавантажуємось однаково */
  }
  window.location.reload();
}

/**
 * Чи цей запуск — перезапуск, що не взяв; сам знімається, щойно вікно минуло.
 *
 * Позначку читаємо один раз: після натиску «Оновити» вона зʼявиться знову, але
 * аркуш має лишитись до самого перезавантаження, а не зсутулитись у смужку.
 */
function useReloadLoop(schema: number | null): boolean {
  const [mark] = useState(() => (typeof window === "undefined" ? null : readReloadMark()));
  const [, rerender] = useState(0);
  // Час — у мить рендеру, а не монтування: новіший номер може прийти й за годину після старту.
  const looped = schema !== null && isReloadLoop(mark, schema, Date.now());

  useEffect(() => {
    if (!looped) return;
    const left = (mark as ReloadMark).at + RELOAD_LOOP_WINDOW_MS - Date.now();
    const timer = setTimeout(() => rerender((n) => n + 1), Math.max(0, left) + 50);
    return () => clearTimeout(timer);
  }, [looped, mark]);

  return looped;
}

/**
 * Обгортка всього застосунку і банер над ним.
 *
 * schema — номер новішої схеми сервера, або null, поки все гаразд. Обгортка
 * стоїть завжди (display: contents — жодного впливу на розмітку), щоб поява
 * банера не перемонтовувала сторінку під ним і не губила її стан.
 *
 * Коли банер блокує, сторінка під ним стає inert. Аркуш сам по собі ловить
 * лише дотики: фокус лишався б у полі комори, і Enter чи пробіл додавали б
 * продукт старим кодом просто крізь тло. Inert забирає в сторінки і фокус, і
 * Tab, і клавіші, а сам аркуш піднятий над будь-яким шаром сторінки — навіть
 * над повноекранним сканером (z-70), під яким його інакше не було б видно.
 */
export function UpdateGate({ schema, children }: { schema: number | null; children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const busyScreen = useNavHidden(pathname);
  const looped = useReloadLoop(schema);
  const [reloading, setReloading] = useState(false);
  const blocking = schema !== null && !busyScreen && !looped;

  useEffect(() => {
    if (!blocking) return;
    // Фокус зі сторінки — геть, до єдиної дії, яка лишилась.
    const button = document.querySelector<HTMLElement>("[data-update-gate] button");
    if (button) button.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, [blocking]);

  const reload = () => {
    if (schema === null) return;
    setReloading(true);
    void reloadApp(schema);
  };

  return (
    <>
      <div className="contents" inert={blocking || undefined}>
        {children}
      </div>

      {schema !== null && !blocking && (
        /*
         * Під заголовком (h-14 у TopBar і в режимі готування): кнопки «назад» і
         * «вийти» лишаються досяжними. Нижче за аркуші сторінки (z-50): аркуш
         * «Додати інгредієнт» із клавіатурою займає весь видимий екран, і
         * смужка поверх нього накрила б поле пошуку. Поки аркуш відкритий, вона
         * просто під тлом; закрився — знову видно.
         */
        <div className="pad-safe-t pointer-events-none fixed inset-x-0 top-0 z-[45]">
          <div className="mx-auto w-full max-w-[560px] px-3 pt-[62px]">
            <div
              role="alert"
              className="glass pointer-events-auto flex items-center gap-2.5 rounded-2xl border border-brand/30 py-1.5 pl-3 pr-1.5 shadow-[var(--shadow-card)]"
            >
              <RefreshCw size={16} className="shrink-0 text-brand" />
              <p className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug">
                Застосунок оновився. Перезапусти, щоб зміни не загубились
              </p>
              <Button size="sm" onClick={reload} loading={reloading}>
                Оновити
              </Button>
            </div>
          </div>
        </div>
      )}

      {blocking && (
        // Власний шар над сторінкою: fixed-шари Sheet (z-50) малюються всередині нього.
        <div data-update-gate className="relative z-[80]">
          <Sheet
            open
            onClose={stay}
            footer={
              <Button full onClick={reload} loading={reloading}>
                <RefreshCw size={17} />
                Оновити
              </Button>
            }
          >
            <div role="alert" className="flex items-center gap-3 pb-2 pt-1">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl brand-gradient text-brand-ink">
                <RefreshCw size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-bold leading-snug">Застосунок оновився</p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted">
                  Перезапусти, щоб зміни не загубились
                </p>
              </div>
            </div>
          </Sheet>
        </div>
      )}
    </>
  );
}
