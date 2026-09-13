"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NAV_HEIGHT } from "@/components/BottomNav";
import { Button, Sheet } from "@/components/ui";
import { CAT_LABEL, ing } from "@/data/ingredients";
import { productHints } from "@/lib/product-hints";
import type { IngredientCat, IngredientDef, PantryItem } from "@/lib/types";
import { formatSummed, ingredientQtyLabel, type SummedQuantity } from "@/lib/units";
import { cn, expiryInfo, haptic, plural } from "@/lib/utils";

/*
 * Комора, згрупована за типом (F1, I4).
 *
 * Компонент лише малює: групування рахує groupPantry (src/lib/pantry.ts,
 * друга хвиля), а назву рядка — pantryDisplayName. Обидва приходять пропсами,
 * а не імпортом, бо живуть у файлах, які зараз правлять інші, — і так само
 * тому, що назва залежить від кешу товарів, про який цей файл знати не мусить.
 */

/** Одна група комори: усі рядки одного точного типу (D8). */
export interface PantryGroup {
  key: string;
  rows: PantryItem[];
  /** Разом у типовій для типу мірі («1,9 л») або сумою як є. */
  total: SummedQuantity[];
  /** Рядків без кількості: «+ ще 1 без кількості». */
  unknown: number;
  /** Найближчий строк серед рядків групи, YYYY-MM-DD. */
  soonest?: string;
}

/** Рівно форма, яку повертає groupPantry(rows, products, today) із D8. */
export interface PantryGrouping {
  expired: PantryItem[];
  sections: Array<{ cat: IngredientCat; groups: PantryGroup[] }>;
}

/** «16.09» з «2026-09-16» — у списку рік лише заважає. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${d.slice(0, 2)}.${m}` : iso;
}

/**
 * Чи просити уточнити товар (B7): рядок без картки, але з доказом — назвою
 * з каси чи штрихкодом. Без доказу нагадувати нема про що: «Сир», доданий
 * руками, нічого не знає про свій бренд, і значок лише дратував би.
 *
 * Вагове з каси («ІмбирКг», «Банани ваг») — теж ні: те саме правило, що в
 * needsNaming і «Назвати просто «Імбир»» в ItemSheet. Картка «Імбир» без
 * бренду й упаковки — сміття, а вічний значок підштовхував би саме до неї.
 */
export function wantsRefine(row: PantryItem): boolean {
  if (row.productId) return false;
  if (row.barcode) return true;
  return !!row.receiptName && !productHints(row.receiptName, row.key).weighed;
}

/** Підпис кількості рядка: «900 мл» або старий вільний текст. */
function qtyOf(row: PantryItem): string {
  return ingredientQtyLabel(row);
}

export function PantryGroups({
  grouping,
  displayName,
  shortName,
  canUseProducts,
  onOpenRow,
  onRemoveRow,
  onOpenGroup,
  onRefineRow,
}: {
  grouping: PantryGrouping;
  /** pantryDisplayName(row, products) — назва рядка поза групою. */
  displayName: (row: PantryItem) => string;
  /**
   * Назва всередині групи: shortProductName(name, typeKey) скидає слова типу,
   * бо «Молоко» вже написано в заголовку. Немає — повна назва.
   */
  shortName?: (row: PantryItem) => string;
  /** Локальний режим (без бекенду) карток товарів не має — і значка теж. */
  canUseProducts: boolean;
  onOpenRow: (row: PantryItem) => void;
  /** Сторінка прибирає рядок і показує «Прибрано «…»» з [Повернути]. */
  onRemoveRow: (row: PantryItem) => void;
  /** «🥛 Молоко — 2 товари, разом 1,9 л» з [Додати ще] [Рецепти з цим]. */
  onOpenGroup: (group: PantryGroup) => void;
  /** «Уточнити товар». Немає — значок відкриває сам рядок. */
  onRefineRow?: (row: PantryItem) => void;
}) {
  /*
   * Згорнуті групи, а не розгорнуті: за замовчуванням видно всі пачки, як у
   * макеті. Згортання — рідкісна дія людини з великою коморою, і памʼятати
   * його між сесіями не варто: завтра в групі вже інші пачки.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) => {
    haptic(8);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const row = (item: PantryItem, name: string, withEmoji: boolean) => (
    <PantryRow
      key={item.id}
      item={item}
      name={name}
      withEmoji={withEmoji}
      refine={canUseProducts && wantsRefine(item)}
      onOpen={() => onOpenRow(item)}
      onRemove={() => onRemoveRow(item)}
      onRefine={onRefineRow ? () => onRefineRow(item) : undefined}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Прострочене — понад категоріями: з ним треба щось зробити сьогодні,
          а в «Молочному» між шістьма пачками його ніхто б не помітив. */}
      {grouping.expired.length > 0 && (
        <div>
          <h3 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-berry">
            <TriangleAlert size={13} />
            Прострочене · {grouping.expired.length}
          </h3>
          <div className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {grouping.expired.map((item) => row(item, displayName(item), true))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {grouping.sections.map(({ cat, groups }) => (
        <div key={cat}>
          <h3 className="mb-2.5 text-[12px] font-bold uppercase tracking-wide text-muted">
            {CAT_LABEL[cat]}
          </h3>
          <div className="flex flex-col gap-2">
            {groups.map((group) => {
              /*
               * Група з одного рядка — просто рядок. Заголовок «Молоко · 900 мл»
               * над єдиною пачкою «Галичина · 900 мл» повторював би те саме двічі.
               */
              if (group.rows.length === 1) {
                const only = group.rows[0];
                return (
                  <div key={group.key} className="flex flex-col">
                    {row(only, displayName(only), true)}
                  </div>
                );
              }
              const def = ing(group.key);
              const open = !collapsed.has(group.key);
              const total = formatSummed(group.total);
              return (
                <div key={group.key} className="rounded-2xl border border-line bg-surface">
                  <div className="flex items-center gap-1 pr-1.5">
                    <button
                      onClick={() => {
                        haptic(8);
                        onOpenGroup(group);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-3 text-left"
                    >
                      <span className="text-lg leading-none">{def.emoji}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-bold">
                          {def.label}
                          {total && <span className="font-semibold text-brand"> · {total}</span>}
                        </span>
                        {(group.soonest || group.unknown > 0) && (
                          <span className="block truncate text-[11px] text-faint">
                            {group.soonest && `найближче до ${shortDate(group.soonest)}`}
                            {group.soonest && group.unknown > 0 && " · "}
                            {group.unknown > 0 && `+ ще ${group.unknown} без кількості`}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      onClick={() => toggle(group.key)}
                      aria-expanded={open}
                      aria-label={open ? `Згорнути ${def.label}` : `Розгорнути ${def.label}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted"
                    >
                      <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} />
                    </button>
                  </div>
                  {open && (
                    <div className="flex flex-col gap-1 border-t border-line/60 px-1.5 py-1.5">
                      <AnimatePresence initial={false}>
                        {group.rows.map((item) =>
                          row(item, shortName ? shortName(item) : displayName(item), false),
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Один рядок комори — одна покупка.
 *
 * Прострочене червоним, те, що скоро зіпсується, — бурштиновим, і колір
 * завжди дублює підпис: самим кольором стан не передати ані дальтоніку, ані
 * скрінрідеру. Далекий строк показуємо датою («до 16.09») — «12 днів» людина
 * однаково перераховувала б на календар.
 */
function PantryRow({
  item,
  name,
  withEmoji,
  refine,
  onOpen,
  onRemove,
  onRefine,
}: {
  item: PantryItem;
  name: string;
  withEmoji: boolean;
  refine: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onRefine?: () => void;
}) {
  const def = ing(item.key);
  const exp = expiryInfo(item.expiresAt);
  const qty = qtyOf(item);
  const expLabel = exp && item.expiresAt ? (exp.tone === "ok" ? `до ${shortDate(item.expiresAt)}` : exp.label) : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className={cn(
        "flex items-center gap-1 rounded-2xl border pr-1.5",
        exp?.tone === "expired"
          ? "border-berry bg-berry/15"
          : exp?.tone === "soon"
            ? "border-brand-2/50 bg-brand-2/10"
            : withEmoji
              ? "border-line bg-surface"
              : "border-transparent bg-transparent",
      )}
    >
      <button
        onClick={() => {
          haptic(8);
          onOpen();
        }}
        className={cn("flex min-w-0 flex-1 items-center gap-2 py-2 text-left", withEmoji ? "pl-3" : "pl-8")}
      >
        {withEmoji && <span className="text-lg leading-none">{def.emoji}</span>}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-[13px] font-semibold",
              exp?.tone === "expired" && "text-berry",
            )}
          >
            {name}
            {qty && <span className="text-[11.5px] font-bold text-brand"> · {qty}</span>}
          </span>
          {expLabel && (
            <span
              className={cn(
                "block truncate text-[10.5px] font-bold",
                exp?.tone === "expired" ? "text-berry" : exp?.tone === "soon" ? "text-brand-2" : "text-faint",
              )}
            >
              {expLabel}
            </span>
          )}
        </span>
      </button>
      {refine && (
        <button
          onClick={() => {
            haptic(8);
            (onRefine ?? onOpen)();
          }}
          className="shrink-0 rounded-full border border-brand/40 bg-brand/10 px-2 py-1 text-[10.5px] font-bold text-brand"
        >
          Уточнити товар
        </button>
      )}
      <button
        onClick={() => {
          haptic(10);
          onRemove();
        }}
        aria-label={`Прибрати ${name}`}
        className="grid h-8 w-8 shrink-0 place-items-center"
      >
        <X size={14} className="text-faint" />
      </button>
    </motion.div>
  );
}

/**
 * Аркуш групи: «🥛 Молоко — 2 товари, разом 1,9 л».
 *
 * Сюди приходять спитати «скільки молока взагалі є» і «що з нього зварити»,
 * тож і кнопок рівно дві: докласти ще й рецепти з цим типом.
 */
export function PantryGroupSheet({
  group,
  displayName,
  shortName,
  onClose,
  onOpenRow,
  onAddMore,
  onRecipes,
  onEditType,
  onMergeType,
  mergedTypes = [],
  onUnmergeType,
}: {
  group: PantryGroup | null;
  displayName: (row: PantryItem) => string;
  shortName?: (row: PantryItem) => string;
  onClose: () => void;
  onOpenRow: (row: PantryItem) => void;
  onAddMore: (group: PantryGroup) => void;
  onRecipes: (group: PantryGroup) => void;
  /**
   * Дописаний тип правлять усі (F7) — з історією змін. Немає — рядка не
   * показуємо: вбудовані типи живуть у коді й вікі-правці не підлягають.
   */
  onEditType?: (key: string) => void;
  /** «Це той самий тип, що…» (F8): дублікат дописаного типу. */
  onMergeType?: (key: string) => void;
  /**
   * Дописані типи, обʼєднані з цим. Для вбудованого переможця це єдине місце,
   * де «Розʼєднати» можна знайти: редактора в нього немає.
   */
  mergedTypes?: readonly IngredientDef[];
  onUnmergeType?: (key: string) => void;
}) {
  const def = group ? ing(group.key) : null;
  const count = group?.rows.length ?? 0;
  const total = group ? formatSummed(group.total) : "";

  return (
    <Sheet
      open={!!group}
      onClose={onClose}
      title={def ? `${def.emoji} ${def.label}` : ""}
      footer={
        group ? (
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => onAddMore(group)}>
              Додати ще
            </Button>
            <Button className="flex-1" onClick={() => onRecipes(group)}>
              Рецепти з цим
            </Button>
          </div>
        ) : undefined
      }
    >
      {group && (
        <div className="pb-2">
          <p className="text-[12.5px] text-muted">
            {count} {plural(count, "товар", "товари", "товарів")}
            {total && `, разом ${total}`}
            {group.unknown > 0 && ` · ще ${group.unknown} без кількості`}
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {group.rows.map((item) => {
              const exp = expiryInfo(item.expiresAt);
              const qty = qtyOf(item);
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    haptic(8);
                    onOpenRow(item);
                  }}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5 text-left active:bg-surface-2"
                >
                  <span className="min-w-0 truncate text-[13px] font-semibold">
                    {shortName ? shortName(item) : displayName(item)}
                    {qty && <span className="font-bold text-brand"> · {qty}</span>}
                  </span>
                  {exp && item.expiresAt && (
                    <span
                      className={cn(
                        "shrink-0 text-[11px] font-bold",
                        exp.tone === "expired" ? "text-berry" : exp.tone === "soon" ? "text-brand-2" : "text-faint",
                      )}
                    >
                      {exp.tone === "ok" ? `до ${shortDate(item.expiresAt)}` : exp.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {onUnmergeType && mergedTypes.length > 0 && (
            <div className="mt-4 flex flex-col gap-1.5">
              <p className="text-[12px] font-bold text-muted">Обʼєднано з цим типом</p>
              {mergedTypes.map((d) => (
                <div key={d.key} className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3 py-2">
                  <span className="text-lg">{d.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{d.label}</span>
                  <Button size="sm" variant="outline" onClick={() => onUnmergeType(d.key)}>
                    Розʼєднати
                  </Button>
                </div>
              ))}
            </div>
          )}
          {(onEditType || onMergeType) && (
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
              <span className="text-muted">Дописаний тип:</span>
              {onEditType && (
                <button onClick={() => onEditType(group.key)} className="font-bold text-brand">
                  Редагувати тип
                </button>
              )}
              {onMergeType && (
                <button onClick={() => onMergeType(group.key)} className="font-bold text-brand">
                  Це дублікат іншого типу…
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Тост із дією: «Прибрано «Галичина 2,5%»» [Повернути], «Додано 14 · 3 без
 * картки товару» [Назвати].
 *
 * Звичайний тост з ui.tsx кнопок не має і висить угорі, куди великий палець
 * не дістає. Скасування ж мусить бути поруч із місцем дії й жити довше за
 * дві з половиною секунди — інакше до [Повернути] просто не встигнути.
 * Кандидат на переїзд у ui.tsx у другій хвилі.
 */
export function ActionToast({
  id,
  text,
  emoji,
  actionLabel,
  onAction,
  onDismiss,
  duration = 6000,
}: {
  /**
   * Кожна пропозиція — свій id, і саме він перезапускає відлік і анімацію.
   * Не текст: два прибрані «Молоко» поспіль дають ту саму стрічку, і друга
   * пропозиція доживала б на таймері першої — зникала б раніше, ніж обіцяно.
   */
  id?: string | number;
  /** null — сховано. */
  text: string | null;
  emoji?: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
  duration?: number;
}) {
  const offerKey = id ?? text;
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerKey, duration, onDismiss]);

  return (
    <div
      style={{ bottom: `calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom) + 12px)` }}
      className="pointer-events-none fixed inset-x-0 z-[45] flex justify-center px-4"
    >
      <AnimatePresence>
        {text && (
          <motion.div
            key={offerKey}
            role="status"
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="glass pointer-events-auto flex max-w-[520px] items-center gap-2.5 rounded-3xl border border-line py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-card)]"
          >
            {emoji && <span className="text-base leading-none">{emoji}</span>}
            {/* До двох рядків, а не обрізання: у «Додано 14 позицій · 3 без картки
                товару» саме хвіст — причина натиснути «Назвати». */}
            <span className="line-clamp-2 min-w-0 text-[13px] font-semibold leading-snug">{text}</span>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0 rounded-full"
              onClick={() => {
                onAction();
                onDismiss();
              }}
            >
              {actionLabel}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
