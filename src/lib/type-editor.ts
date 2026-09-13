/*
 * «Редагувати тип» звідусіль — один аркуш на весь застосунок.
 *
 * Кнопка стоїть глибоко всередині інших аркушів (пікер типів, картка товару,
 * редактор картки), а Sheet малюється на місці, без порталу. Аркуш усередині
 * аркуша опинився б під transform батьківської панелі: fixed-позиція рахувалась
 * би від неї, а жест «потягнути вниз» закривав би обидва. Тому кнопка лише
 * кличе openTypeEditor, а сам редактор живе в TypeEditorHost на рівні Providers.
 *
 * Хост вантажиться лениво (next/dynamic), тож дотик, що випередив його
 * завантаження, не губиться: ключ чекає в `pending`, доки хост не підпишеться.
 */

type Listener = (key: string) => void;

const listeners = new Set<Listener>();
let pending: string | null = null;

/** Відкрити правку дописаного типу `key` (F7) поверх усього, що зараз відкрито. */
export function openTypeEditor(key: string): void {
  if (listeners.size === 0) {
    pending = key;
    return;
  }
  for (const listener of listeners) listener(key);
}

/** Для хоста: підписатись і одразу забрати дотик, що встиг раніше за нього. */
export function subscribeTypeEditor(listener: Listener): () => void {
  listeners.add(listener);
  if (pending !== null) {
    const key = pending;
    pending = null;
    listener(key);
  }
  return () => {
    listeners.delete(listener);
  };
}
