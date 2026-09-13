"use client";

import { Pencil } from "lucide-react";
import { ing, isOwnKey, knownIngredient } from "@/data/ingredients";
import { openTypeEditor } from "@/lib/type-editor";
import { cn, haptic } from "@/lib/utils";

/**
 * «Редагувати тип» біля дописаного типу будь-де, де його видно: картка й
 * редактор товару, пікери типів, форма рецепта. Дописаний тип правлять усі — з
 * історією й обʼєднанням (F7/F8), — і це не мусить залежати від того, чи лежить
 * такий тип у когось у коморі. Для вбудованих типів не рендериться нічого.
 *
 * Сам редактор відкриває TypeEditorHost (див. src/lib/type-editor.ts): аркуш
 * усередині аркуша ламав би позицію й жести.
 *
 * `icon` — лише олівець (для чипів у пікерах), інакше посилання текстом.
 */
export function EditTypeButton({
  typeKey,
  icon = false,
  className,
}: {
  typeKey: string | null | undefined;
  icon?: boolean;
  className?: string;
}) {
  if (!typeKey || !isOwnKey(typeKey) || !knownIngredient(typeKey)) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        // Кнопка буває поруч із вибором типу: дотик до олівця — не вибір.
        e.stopPropagation();
        haptic(8);
        openTypeEditor(typeKey);
      }}
      aria-label={`Редагувати тип «${ing(typeKey).label}»`}
      className={cn(
        icon ? "grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted" : "text-[12px] font-bold text-brand",
        className,
      )}
    >
      {icon ? <Pencil size={13} /> : "Редагувати тип"}
    </button>
  );
}
