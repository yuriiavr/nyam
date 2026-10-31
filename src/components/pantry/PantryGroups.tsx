"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NAV_HEIGHT } from "@/components/BottomNav";
import { Button, Sheet } from "@/components/ui";
import { CAT_LABEL, ing } from "@/data/ingredients";
import { productHints } from "@/lib/product-hints";
import type { IngredientCat, IngredientDef, PantryItem } from "@/lib/types";
import { formatSummed, ingredientQtyLabel, type SummedQuantity } from "@/lib/units";
import { cn, expiryInfo, haptic, plural } from "@/lib/utils";

/*
 * Комора, згрупована за типом (F1, I4), у вигляді з редизайну: кожна
 * категорія — одна картка-список, рядок — одна покупка, прибирається свайпом.
 *
 * Компонент лише малює: групування рахує groupPantry (src/lib/pantry.ts),
 * а назву рядка — pantryDisplayName. Обидва приходять пропсами, бо назва
 * залежить від кешу товарів, про який цей файл знати не мусить.
 */

/** Одна група комори: усі рядки одного точного типу (D8). */
export interface PantryGroup {
  key: string;
  rows: PantryItem[];
  /** Разом у типовій для типу мірі («1,9 л») або сумою як є. */
  total: SummedQuantity[];
  /** Рядків без кількості. */
  unknown: number;
  /** Найближчий строк серед рядків групи, YYYY-MM-DD. */
  soonest?: string;
}

/** Рівно форма, яку повертає groupPantry(rows, products, today, soonUntil). */
export interface PantryGrouping {
  expired: PantryItem[];
  /** Ще не прострочене, але от-от: разом із простроченим це «Варто вжити». */
  soon: PantryItem[];
  sections: Array<{ cat: IngredientCat; groups: PantryGroup[] }>;
}

/** «16.09» з «2026-09-16» — у списку рік лише заважає. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${d.slice(0, 2)}.${m}` : iso;
}

/**
 * Строк одним словом, як його думають: «завтра», «3 дні», а далекий — датою.
 * «12 днів» людина однаково перераховувала б на календар.
 */
export function expiryShort(expiresAt: string | undefined): string {
  const exp = expiryInfo(expiresAt);
  if (!exp || !expiresAt) return "";
  if (exp.days < 0) return "прострочено";
  if (exp.days === 0) return "сьогодні";
  if (exp.days === 1) return "завтра";
  if (exp.days <= 4) return `${exp.days} дні`;
  return shortDate(expiresAt);
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

/** Заголовок картки-списку: «МОЛОЧНЕ ТА ЯЙЦЯ        4». */
export function ListHeader({ label, aside }: { label: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-between gap-3 px-3.5">
      <span className="truncate text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">{label}</span>
      {aside != null && <span className="shrink-0 text-[11.5px] font-bold text-faint">{aside}</span>}
    </div>
  );
}

export function PantryGroups({
  grouping,
  displayName,
  shortName,
  canUseProducts,
  onOpenRow,
  onRemoveRow,
  onOpenGroup,
  onRescue,
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
  /** «Що приготувати» з того, що псується. */
  onRescue?: () => void;
}) {
  /*
   * Згорнуті групи, а не розгорнуті: за замовчуванням видно всі пачки.
   * Згортання — рідкісна дія людини з великою коморою, і памʼятати його між
   * сесіями не варто: завтра в групі вже інші пачки.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Рядок, відсунутий свайпом до кнопки «Прибрати». Одночасно — лише один. */
  const [swiped, setSwiped] = useState<string | null>(null);

  const toggle = (key: string) => {
    haptic(8);
    setSwiped(null);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const row = (item: PantryItem, name: string, variant: RowVariant) => (
    <PantryRow
      key={item.id}
      item={item}
      name={name}
      variant={variant}
      refine={canUseProducts && wantsRefine(item)}
      open={swiped === item.id}
      onSwipe={(open) => setSwiped(open ? item.id : null)}
      onTap={() => {
        // Перший дотик після свайпу лише закриває відсунутий рядок: так
        // ніхто не відкриє картку, коли просто передумав прибирати.
        if (swiped) {
          setSwiped(null);
          return;
        }
        haptic(8);
        onOpenRow(item);
      }}
      onOpen={() => onOpenRow(item)}
      onRemove={() => {
        haptic(10);
        setSwiped(null);
        onRemoveRow(item);
      }}
    />
  );

  /*
   * Прострочене й те, що зіпсується за кілька днів, — понад категоріями: з ним
   * треба щось зробити сьогодні, а в «Молочному» між шістьма пачками його
   * ніхто б не помітив.
   */
  const urgent = [...grouping.expired, ...grouping.soon];

  return (
    <div className="flex flex-col gap-2.5">
      {urgent.length > 0 && (
        <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <div className="flex h-11 items-center gap-2.5 pl-3.5 pr-2.5">
            <TriangleAlert size={16} strokeWidth={2.2} className="shrink-0 text-muted" />
            <span className="flex-1 text-[14px] font-extrabold">Варто вжити</span>
            {onRescue && (
              <button
                onClick={() => {
                  haptic(8);
                  onRescue();
                }}
                className="flex h-[30px] items-center gap-0.5 rounded-[7px] bg-surface-2 pl-2.5 pr-2 text-[12.5px] font-extrabold"
              >
                Що приготувати
                <ChevronRight size={14} strokeWidth={2.6} />
              </button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {urgent.map((item) => row(item, displayName(item), "urgent"))}
          </AnimatePresence>
        </div>
      )}

      {grouping.sections.map(({ cat, groups }) => (
        <div key={cat} className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <ListHeader label={CAT_LABEL[cat]} aside={groups.reduce((n, g) => n + g.rows.length, 0)} />
          <AnimatePresence initial={false}>
            {groups.map((group) => {
              /*
               * Група з одного рядка — просто рядок. Заголовок «Молоко · 900 мл»
               * над єдиною пачкою «Галичина · 900 мл» повторював би те саме двічі.
               */
              if (group.rows.length === 1) return row(group.rows[0], displayName(group.rows[0]), "single");
              const def = ing(group.key);
              const open = !collapsed.has(group.key);
              const total = formatSummed(group.total);
              return (
                <div key={group.key} className="border-t border-line">
                  <div className="flex h-[46px] items-center pl-3.5 pr-1">
                    <button
                      onClick={() => {
                        haptic(8);
                        setSwiped(null);
                        onOpenGroup(group);
                      }}
                      className="flex h-full min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="w-[22px] shrink-0 text-lg leading-none">{def.emoji}</span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold">
                        {def.label} <span className="font-semibold text-faint">· {group.rows.length}</span>
                      </span>
                      {total && <span className="shrink-0 text-[12.5px] font-bold text-muted">{total}</span>}
                    </button>
                    <button
                      onClick={() => toggle(group.key)}
                      aria-expanded={open}
                      aria-label={open ? `Згорнути ${def.label}` : `Розгорнути ${def.label}`}
                      className="grid h-[38px] w-[38px] shrink-0 place-items-center text-faint"
                    >
                      <ChevronDown size={16} strokeWidth={2.2} className={cn("transition-transform", open && "rotate-180")} />
                    </button>
                  </div>
                  {open && (
                    <div className="bg-bg-elev">
                      <AnimatePresence initial={false}>
                        {group.rows.map((item) => row(item, shortName ? shortName(item) : displayName(item), "nested"))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              );
            })}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

/**
 * Як виглядає рядок: у «Варто вжити» строк — головне, і він яскравий; у
 * категорії — тьмяна довідка; усередині групи рядок нижчий і без емодзі,
 * бо емодзі вже стоїть у заголовку групи.
 */
type RowVariant = "urgent" | "single" | "nested";

/** На скільки відʼїжджає рядок, відкриваючи «Прибрати». */
const SWIPE_OPEN = 84;
/** Далі цього свайп відкривається, ближче — повертається на місце. */
const SWIPE_SNAP = 45;

/**
 * Один рядок комори — одна покупка.
 *
 * Свайп уліво відкриває «Прибрати»; дотик — картку. Хрестика на кожному рядку
 * більше немає: він займав місце в усіх, а потрібен був зрідка й легко
 * натискався повз. Без свайпу (клавіатура, скрінрідер) прибирають із картки.
 *
 * Прострочене — червоним, і колір завжди дублює підпис: самим кольором стан
 * не передати ані дальтоніку, ані скрінрідеру.
 */
function PantryRow({
  item,
  name,
  variant,
  refine,
  open,
  onSwipe,
  onTap,
  onOpen,
  onRemove,
}: {
  item: PantryItem;
  name: string;
  variant: RowVariant;
  refine: boolean;
  /** Рядок відсунуто до кнопки «Прибрати». */
  open: boolean;
  onSwipe: (open: boolean) => void;
  /** Дотик без руху: картка або, якщо щось відсунуто, — закрити. */
  onTap: () => void;
  /** Клавіатура: Enter і пробіл відкривають картку одразу. */
  onOpen: () => void;
  onRemove: () => void;
}) {
  const def = ing(item.key);
  const exp = expiryInfo(item.expiresAt);
  const qty = ingredientQtyLabel(item);
  const expLabel = expiryShort(item.expiresAt);

  /*
   * Поки палець веде рядок, зсув живе тут, а не у верхньому стані: інакше
   * кожен піксель руху перемальовував би всю комору. `last` — останній зсув
   * для pointerup: замикання в обробнику могло б тримати застаріле значення.
   */
  const [dx, setDx] = useState<number | null>(null);
  const drag = useRef<{ x: number; base: number; moved: boolean; last: number } | null>(null);
  const offset = dx ?? (open ? -SWIPE_OPEN : 0);

  const nested = variant === "nested";

  return (
    <motion.div
      initial={false}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("relative overflow-hidden border-t border-line bg-berry", nested ? "h-10" : "h-[46px]")}
    >
      <button
        onClick={onRemove}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        className="absolute inset-y-0 right-0 grid w-[84px] place-items-center text-[12px] font-extrabold text-white"
      >
        Прибрати
      </button>
      <div
        role="button"
        tabIndex={0}
        aria-label={[name, qty, exp ? (exp.tone === "ok" && item.expiresAt ? `до ${shortDate(item.expiresAt)}` : exp.label) : ""]
          .filter(Boolean)
          .join(", ")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          const base = open ? -SWIPE_OPEN : 0;
          drag.current = { x: e.clientX, base, moved: false, last: base };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const delta = e.clientX - d.x;
          if (!d.moved && Math.abs(delta) <= 6) return;
          d.moved = true;
          d.last = Math.max(-110, Math.min(0, d.base + delta));
          setDx(d.last);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          setDx(null);
          if (!d.moved) {
            onTap();
            return;
          }
          const opened = d.last < -SWIPE_SNAP;
          if (opened && !open) haptic(8);
          onSwipe(opened);
        }}
        onPointerCancel={() => {
          // Браузер забрав жест собі (вертикальна прокрутка) — повертаємо як було.
          drag.current = null;
          setDx(null);
        }}
        style={{ transform: `translateX(${offset}px)`, transition: dx == null ? "transform .25s ease" : "none" }}
        className={cn(
          "absolute inset-0 flex cursor-pointer touch-pan-y select-none items-center gap-3 outline-none focus-visible:bg-surface-2",
          nested ? "bg-bg-elev pl-12 pr-3.5" : "bg-surface px-3.5",
        )}
      >
        {!nested && <span className="w-[22px] shrink-0 text-lg leading-none">{def.emoji}</span>}
        <span className="flex min-w-0 flex-1 items-center gap-[7px]">
          <span
            className={cn(
              "truncate",
              nested ? "text-[13px] font-semibold text-ink/80" : "text-[14px] font-semibold",
            )}
          >
            {name}
          </span>
          {refine && (
            <span aria-label="Варто уточнити товар" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
          )}
        </span>
        {qty && <span className="shrink-0 text-[12px] font-semibold text-muted">{qty}</span>}
        <span
          className={cn(
            "shrink-0 text-right text-[12px]",
            variant === "urgent"
              ? cn("w-[78px] font-extrabold", exp?.tone === "expired" ? "text-berry" : "text-ink")
              : cn("w-[52px] font-semibold", exp?.tone === "expired" ? "text-berry" : "text-faint"),
          )}
        >
          {expLabel}
        </span>
      </div>
    </motion.div>
  );
}

/**
 * Аркуш групи: «🥛 Молоко — 2 товари, разом 1,9 л».
 *
 * Сюди приходять спитати «скільки молока взагалі є» і «що з нього зварити»,
 * тож і кнопок унизу рівно дві: докласти ще й рецепти з цим типом.
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
      title={
        def ? (
          <span className="flex items-center gap-3">
            <span className="text-[26px] leading-none">{def.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{def.label}</span>
              <span className="block font-sans text-[12px] font-semibold text-faint">
                {count} {plural(count, "товар", "товари", "товарів")}
                {group && group.unknown > 0 && ` · ${group.unknown} без кількості`}
              </span>
            </span>
            {total && <span className="shrink-0 text-[20px]">{total}</span>}
          </span>
        ) : (
          ""
        )
      }
      footer={
        group ? (
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => onAddMore(group)}>
              Додати ще
            </Button>
            <Button className="flex-[1.3]" onClick={() => onRecipes(group)}>
              Рецепти з цим
            </Button>
          </div>
        ) : undefined
      }
    >
      {group && (
        <div className="flex flex-col gap-3 pb-3">
          <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
            {group.rows.map((item, i) => {
              const exp = expiryInfo(item.expiresAt);
              const qty = ingredientQtyLabel(item);
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    haptic(8);
                    onOpenRow(item);
                  }}
                  className={cn(
                    "flex h-12 w-full items-center gap-3 px-3.5 text-left active:bg-surface-2",
                    i > 0 && "border-t border-line",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    {shortName ? shortName(item) : displayName(item)}
                  </span>
                  {qty && <span className="shrink-0 text-[12px] font-semibold text-muted">{qty}</span>}
                  <span
                    className={cn(
                      "w-[52px] shrink-0 text-right text-[12px] font-semibold",
                      exp?.tone === "expired" ? "text-berry" : "text-faint",
                    )}
                  >
                    {expiryShort(item.expiresAt)}
                  </span>
                </button>
              );
            })}
          </div>

          {onUnmergeType && mergedTypes.length > 0 && (
            <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
              <ListHeader label="Обʼєднано з цим типом" />
              {mergedTypes.map((d) => (
                <div key={d.key} className="flex h-12 items-center gap-3 border-t border-line pl-3.5 pr-2">
                  <span className="text-lg leading-none">{d.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{d.label}</span>
                  <Button size="sm" variant="outline" onClick={() => onUnmergeType(d.key)}>
                    Розʼєднати
                  </Button>
                </div>
              ))}
            </div>
          )}

          {(onEditType || onMergeType) && (
            <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
              {onEditType && <LinkRow onClick={() => onEditType(group.key)}>Редагувати тип</LinkRow>}
              {onMergeType && (
                <LinkRow divided={!!onEditType} onClick={() => onMergeType(group.key)}>
                  Це дублікат іншого типу
                </LinkRow>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Рядок-посилання в картці аркуша: «Картка товару ›», «Редагувати тип ›». */
export function LinkRow({
  children,
  onClick,
  divided,
  tone,
  icon,
  aside,
}: {
  children: ReactNode;
  onClick: () => void;
  /** Лінія згори — для всіх, крім першого рядка картки. */
  divided?: boolean;
  /** Небезпечна дія («Прибрати з комори») — червоним і без стрілки. */
  tone?: "danger" | "brand";
  /** Замість стрілки праворуч, напр. «+» у «Додати ще». */
  icon?: ReactNode;
  /** Тьмяна довідка перед стрілкою: «з чека». */
  aside?: ReactNode;
}) {
  return (
    <button
      onClick={() => {
        haptic(8);
        onClick();
      }}
      className={cn(
        "flex h-12 w-full items-center gap-2.5 px-3.5 text-left active:bg-surface-2",
        divided && "border-t border-line",
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[14px]",
          tone === "danger" ? "font-semibold text-berry" : tone === "brand" ? "font-bold" : "font-semibold",
        )}
      >
        {children}
      </span>
      {aside}
      {tone !== "danger" && (icon ?? <ChevronRight size={15} strokeWidth={2.2} className="shrink-0 text-faint" />)}
    </button>
  );
}

/**
 * Тост із дією: «Прибрано «Галичина 2,5%»» [Повернути], «Додано 14 · 3 без
 * картки товару» [Назвати].
 *
 * Звичайний тост з ui.tsx кнопок не має і висить угорі, куди великий палець
 * не дістає. Скасування ж мусить бути поруч із місцем дії й жити довше за
 * дві з половиною секунди — інакше до [Повернути] просто не встигнути.
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
      style={{ bottom: `calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom) + var(--cook-dock, 0px) + 12px)` }}
      className="pointer-events-none fixed left-1/2 z-[45] w-full max-w-[560px] -translate-x-1/2 px-4"
    >
      <AnimatePresence>
        {text && (
          <motion.div
            key={offerKey}
            role="status"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="pointer-events-auto flex min-h-[46px] items-center gap-2.5 rounded-[12px] bg-surface-2 py-1.5 pl-3.5 pr-1.5 shadow-[0_12px_30px_-10px_rgb(0_0_0_/_0.8)] light:shadow-[var(--shadow-card)]"
          >
            {emoji && <span className="text-base leading-none">{emoji}</span>}
            {/* До двох рядків, а не обрізання: у «Додано 14 позицій · 3 без картки
                товару» саме хвіст — причина натиснути «Назвати». */}
            <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-snug">{text}</span>
            <button
              onClick={() => {
                haptic(10);
                onAction();
                onDismiss();
              }}
              className="h-[34px] shrink-0 rounded-[8px] px-3 text-[13px] font-extrabold text-brand"
            >
              {actionLabel}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
