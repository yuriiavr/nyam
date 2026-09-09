import type { ReactNode } from "react";

/** Пошта підтримки — та сама, що вказана в Google OAuth consent screen. */
export const SUPPORT_EMAIL = (
  <a href="mailto:nyam.foodapp@gmail.com" className="underline underline-offset-2">
    nyam.foodapp@gmail.com
  </a>
);

/**
 * Обгортка для юридичних сторінок: вузька колонка з читабельною типографікою.
 * Навмисно без інтерактиву — це серверні компоненти, щоб сторінки віддавались
 * статикою і Google міг їх прочитати без JS.
 */
export function LegalPage({ updated, children }: { updated: string; children: ReactNode }) {
  return (
    <article className="px-4 pt-4 text-[15px] leading-relaxed text-muted">
      <p className="text-[13px] text-muted/70">Оновлено: {updated}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </article>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-2">
      <h2 className="font-display text-[17px] font-extrabold leading-tight text-ink">{title}</h2>
      <p className="mt-1.5">{children}</p>
    </section>
  );
}
