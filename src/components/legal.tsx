import type { ReactNode } from "react";

/** Пошта підтримки — та сама, що вказана в Google OAuth consent screen. */
export const SUPPORT_EMAIL = (
  <a href="mailto:nyam.foodapp@gmail.com" className="font-semibold text-brand underline underline-offset-2">
    nyam.foodapp@gmail.com
  </a>
);

/**
 * Обгортка для юридичних сторінок: вузька колонка з читабельною типографікою.
 * Навмисно без інтерактиву — це серверні компоненти, щоб сторінки віддавались
 * статикою і Google міг їх прочитати без JS.
 *
 * Тому панелі тут зібрані тими самими класами, що Panel і PanelHeader з ui.tsx,
 * а не самими компонентами: ui.tsx — клієнтський модуль, а заголовок розділу
 * має лишатися справжнім <h2>, а не <span> заголовка панелі.
 */
export function LegalPage({ updated, children }: { updated: string; children: ReactNode }) {
  return (
    <article className="flex flex-col gap-2.5 px-4 text-[13.5px] leading-relaxed text-muted">
      <p className="px-0.5 text-[12px] font-semibold text-faint">Оновлено: {updated}</p>
      {children}
    </article>
  );
}

/** Вступ угорі сторінки — панель без заголовка. */
export function LegalIntro({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <p className="px-3.5 py-3 text-[13.5px] font-semibold leading-relaxed text-muted">{children}</p>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <h2 className="flex min-h-9 items-center px-3.5 py-2 text-[11px] font-extrabold uppercase leading-tight tracking-[0.07em] text-muted">
        {title}
      </h2>
      <p className="border-t border-line px-3.5 py-3 text-[13.5px] leading-relaxed text-muted [&_b]:font-bold [&_b]:text-ink">
        {children}
      </p>
    </section>
  );
}
