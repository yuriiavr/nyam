"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChefHat,
  Plus,
  ReceiptText,
  ScanBarcode,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { TopBar } from "@/components/TopBar";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  QuantityInput,
  Sheet,
  Spinner,
  useToast,
} from "@/components/ui";
import { CAT_LABEL, CAT_ORDER, INGREDIENTS, ing, searchIngredients } from "@/data/ingredients";
import {
  RECEIPT_FORMATS,
  lookupBarcode,
  teachBarcode,
  teachReceiptCode,
  type ProductInfo,
} from "@/lib/barcode";
import { priceFromPurchase } from "@/lib/cost";
import { fridgeMatches, shoppingSuggestions } from "@/lib/matching";
import {
  fetchReceipt,
  lineQuantity,
  lookupableBarcode,
  parseReceiptQr,
  receiptDrafts,
  type ReceiptDraft,
  type ReceiptFailure,
} from "@/lib/receipt";
import { allRecipes, useApp } from "@/lib/store";
import type { IngredientCat, IngredientDef, PantryItem, Unit } from "@/lib/types";
import { formatNumber, ingredientQtyLabel } from "@/lib/units";
import { expiryInfo, haptic, plural } from "@/lib/utils";

const POPULAR = [
  "yajtsya",
  "kartoplya",
  "kurka",
  "pomidor",
  "syr",
  "makarony",
  "rys",
  "tsybulya",
  "moloko",
  "gryby",
  "morkva",
  "khlib",
];

export default function PantryPage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanned, setScanned] = useState<ProductInfo | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [pickFor, setPickFor] = useState<ProductInfo | null>(null);
  /** Ключ продукту, картку якого зараз відкрито: кількість і строк придатності. */
  const [detailsFor, setDetailsFor] = useState<string | null>(null);

  /* Чек: сканер QR → очікування відповіді податкової → список позицій. */
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ store?: string; drafts: ReceiptDraft[] } | null>(null);
  /** Позиції, які підуть у комору. Решту людина зняла галочкою. */
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  /** Рядок чека, для якого зараз обирають продукт вручну. */
  const [pickForLine, setPickForLine] = useState<string | null>(null);
  /** Невдача читання чека разом із тим, що саме прочиталось із QR. */
  const [receiptError, setReceiptError] = useState<{ message: string; scanned: string } | null>(
    null,
  );

  const pantryKeys = state.pantry.map((p) => p.key);

  /*
   * Прострочене виносимо з категорій у власну групу на самому верху.
   * Інакше пакет зіпсованого кефіру лежав би десь у «Молочному» між іншими
   * шістьма продуктами — а це єдине в коморі, на що треба зреагувати сьогодні.
   */
  const { expired, groups } = useMemo(() => {
    const gone: PantryItem[] = [];
    const map = new Map<IngredientCat, PantryItem[]>();

    for (const item of state.pantry) {
      if (expiryInfo(item.expiresAt)?.tone === "expired") {
        gone.push(item);
        continue;
      }
      const cat = ing(item.key).cat;
      map.set(cat, [...(map.get(cat) ?? []), item]);
    }

    // Найдавніше прострочене — першим: воно найгірше.
    gone.sort((a, b) => (expiryInfo(a.expiresAt)?.days ?? 0) - (expiryInfo(b.expiresAt)?.days ?? 0));

    // Всередині категорії наперед виходить те, чий строк ближче.
    // Продукти без дати йдуть після датованих — про них нема що сказати.
    for (const [cat, items] of map) {
      map.set(
        cat,
        [...items].sort(
          (a, b) =>
            (expiryInfo(a.expiresAt)?.days ?? Infinity) -
            (expiryInfo(b.expiresAt)?.days ?? Infinity),
        ),
      );
    }

    return {
      expired: gone,
      groups: CAT_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const),
    };
  }, [state.pantry]);

  /* Ще не зіпсоване, але от-от. Прострочене сюди не потрапляє: воно вже
     має власну помітну групу, і дублювати його тут нема сенсу. */
  const expiring = useMemo(
    () =>
      state.pantry
        .map((item) => ({ item, exp: expiryInfo(item.expiresAt) }))
        .filter((x): x is { item: PantryItem; exp: NonNullable<ReturnType<typeof expiryInfo>> } =>
          x.exp !== null && x.exp.tone === "soon",
        )
        .sort((a, b) => a.exp.days - b.exp.days),
    [state.pantry],
  );

  const { matchCount, suggestions } = useMemo(() => {
    if (!hydrated || pantryKeys.length === 0) return { matchCount: 0, suggestions: [] };
    const recipes = allRecipes(state);
    return {
      matchCount: fridgeMatches(recipes, pantryKeys, { minPct: 60 }).length,
      suggestions: shoppingSuggestions(recipes, pantryKeys, 6),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, state.pantry, state.myRecipes]);

  const add = (
    key: string,
    extra?: { label?: string; barcode?: string; amount?: number; unit?: Unit },
  ) => {
    haptic(12);
    state.addPantry({ key, addedAt: new Date().toISOString(), ...extra });
  };

  const handleDetect = async (code: string) => {
    setScanOpen(false);
    setScanLoading(true);
    const info = await lookupBarcode(code);
    setScanLoading(false);
    setScanned(info);
    if (info.ingredient) {
      // Вагу упаковки беремо з етикетки: «500 г» на пачці вводити руками
      // безглуздо, коли база вже це знає.
      add(info.ingredient.key, {
        label: info.name,
        barcode: info.barcode,
        amount: info.amount,
        unit: info.unit,
      });
    }
  };

  /**
   * QR з чека → позиції з податкової → список на підтвердження.
   *
   * У комору мовчки не кладемо нічого: касова назва зіставляється з каталогом
   * приблизно, і останнє слово має лишитись за людиною, яка цей чек тримає.
   */
  const handleReceipt = async (raw: string) => {
    setReceiptOpen(false);

    /*
     * Про невдачу повідомляємо аркушем, а не тостом. Тост тут з'являвся
     * рівно тоді, коли на весь екран згасав сканер, і його просто не
     * помічали: виглядало так, ніби QR прочитано, а далі нічого не сталось.
     * Аркуш заразом показує, що саме зчиталось, — з цим уже можна щось робити.
     */
    const query = parseReceiptQr(raw);
    if (!query) {
      setReceiptError({
        message: "Це не схоже на фіскальний чек. QR прочитано, але в ньому немає полів чека.",
        scanned: raw,
      });
      return;
    }

    setReceiptBusy(true);
    const result = await fetchReceipt(query);
    if (!result.ok) {
      setReceiptBusy(false);
      setReceiptError({ message: RECEIPT_FAILURE[result.reason], scanned: raw });
      return;
    }

    const drafts = await enrichByBarcode(receiptDrafts(result.receipt.lines));
    setReceiptBusy(false);
    setReceipt({ store: result.receipt.store, drafts });
    // Наперед позначаємо лише впізнане: решту людина або підкаже, або пропустить.
    setChosen(new Set(drafts.filter((d) => d.ingredient).map((d) => d.id)));
    haptic(14);
  };

  const patchDraft = (id: string, patch: Partial<ReceiptDraft>) =>
    setReceipt((prev) =>
      prev
        ? { ...prev, drafts: prev.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) }
        : prev,
    );

  const toggleDraft = (id: string) => {
    haptic(8);
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Кладе підтверджені позиції в комору — одним записом на весь чек. */
  const importReceipt = () => {
    if (!receipt) return;
    const addedAt = new Date().toISOString();
    const items: PantryItem[] = receipt.drafts
      .filter((d) => chosen.has(d.id) && d.ingredient)
      .map((d) => ({
        key: d.ingredient!.key,
        label: d.line.name,
        amount: d.amount,
        unit: d.unit,
        addedAt,
        /*
         * Ціну рахуємо з підтвердженої кількості, а не з тієї, що вгадав
         * розбір: якщо людина виправила «1 шт» на «900 г», ціна грама має
         * піти за виправленням, інакше страва вийде дорожчою в дев'ять разів.
         */
        pricePerGram:
          priceFromPurchase(d.ingredient!.key, d.amount, d.unit, d.line.sum) ?? undefined,
      }));

    if (items.length === 0) {
      setReceipt(null);
      return;
    }

    haptic([12, 30, 12]);
    state.importPantry(items);
    setReceipt(null);
    toast(`Додано ${items.length} ${plural(items.length, "позицію", "позиції", "позицій")}`, "🧾");
  };

  const pickedCount = receipt
    ? receipt.drafts.filter((d) => chosen.has(d.id) && d.ingredient).length
    : 0;

  const searchResults = query.trim() ? searchIngredients(query) : [];

  return (
    <div className="pb-8">
      <TopBar
        back={false}
        title="Моя комора"
        subtitle={
          state.pantry.length
            ? `${state.pantry.length} ${plural(state.pantry.length, "продукт", "продукти", "продуктів")}`
            : "Що є вдома"
        }
        right={
          state.pantry.length > 0 ? (
            <button
              onClick={() => {
                if (confirm("Очистити всю комору?")) {
                  state.clearPantry();
                  toast("Комору очищено", "🧹");
                }
              }}
              aria-label="Очистити"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2 text-muted"
            >
              <Trash2 size={17} />
            </button>
          ) : undefined
        }
      />

      {/* Дії */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-4">
        <button
          onClick={() => {
            haptic(14);
            setScanOpen(true);
          }}
          className="flex flex-col items-start gap-2 rounded-xl3 border border-line bg-surface p-4 active:bg-surface-2"
          style={{
            backgroundImage:
              "radial-gradient(circle at 100% 0%, color-mix(in oklab, var(--brand) 16%, transparent), transparent 62%)",
          }}
        >
          <span className="grid h-11 w-11 place-items-center rounded-2xl brand-gradient text-brand-ink">
            <ScanBarcode size={20} />
          </span>
          <span className="text-[14px] font-bold">Сканувати штрихкод</span>
          <span className="text-[11.5px] leading-snug text-muted">
            Наведи камеру — продукт додасться сам
          </span>
        </button>

        <button
          onClick={() => {
            haptic(12);
            setAddOpen(true);
          }}
          className="flex flex-col items-start gap-2 rounded-xl3 border border-line bg-surface p-4 active:bg-surface-2"
        >
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-surface-2">
            <Plus size={20} />
          </span>
          <span className="text-[14px] font-bold">Додати вручну</span>
          <span className="text-[11.5px] leading-snug text-muted">Пошук по каталогу продуктів</span>
        </button>

        {/*
          Чек окремою широкою кнопкою: це найшвидший спосіб наповнити комору
          після магазину — один QR замість двадцяти штрихкодів.
        */}
        <button
          onClick={() => {
            haptic(14);
            setReceiptOpen(true);
          }}
          className="col-span-2 flex items-center gap-3 rounded-xl3 border border-line bg-surface p-4 text-left active:bg-surface-2"
          style={{
            backgroundImage:
              "radial-gradient(circle at 0% 0%, color-mix(in oklab, var(--mint) 16%, transparent), transparent 62%)",
          }}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-mint/15 text-mint">
            <ReceiptText size={20} />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold">Сканувати чек</span>
            <span className="block text-[11.5px] leading-snug text-muted">
              QR на касовому чеку — і всі покупки одразу в коморі
            </span>
          </span>
        </button>
      </div>

      {/* Швидке додавання */}
      {hydrated && state.pantry.length < 4 && (
        <section className="pt-6">
          <h2 className="mb-2.5 px-4 text-[12px] font-bold uppercase tracking-wide text-muted">
            Часто додають
          </h2>
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4">
            {POPULAR.filter((k) => !pantryKeys.includes(k)).map((k) => {
              const def = ing(k);
              return (
                <Chip key={k} onClick={() => add(k)}>
                  <span>{def.emoji}</span>
                  {def.label}
                  <Plus size={13} className="opacity-60" />
                </Chip>
              );
            })}
          </div>
        </section>
      )}

      {/* Що можна приготувати */}
      {hydrated && state.pantry.length > 0 && (
        <section className="px-4 pt-6">
          <Link href="/decide/fridge">
            <motion.div whileTap={{ scale: 0.98 }}>
              <Card className="flex items-center gap-3 border-mint/30 p-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-mint/15 text-2xl">
                  🧊
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold">
                    {matchCount > 0
                      ? `${matchCount} ${plural(matchCount, "страва", "страви", "страв")} майже готові`
                      : "Подивитись, що можна приготувати"}
                  </p>
                  <p className="text-[12px] text-muted">
                    Підбір за вмістом холодильника — з відсотком збігу
                  </p>
                </div>
                <ChefHat size={18} className="shrink-0 text-mint" />
              </Card>
            </motion.div>
          </Link>
        </section>
      )}

      {/* Список комори */}
      <section className="px-4 pt-6">
        {hydrated && expiring.length > 0 && (
          <Card className="mb-4 border-brand-2/40 bg-brand-2/8 p-3.5">
            <p className="text-[13px] font-bold">Треба зʼїсти найближчим часом</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {expiring.map(({ item, exp }) => (
                <button
                  key={item.key}
                  onClick={() => {
                    haptic(8);
                    setDetailsFor(item.key);
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[12px] font-semibold"
                >
                  <span>{ing(item.key).emoji}</span>
                  <span>{ing(item.key).label}</span>
                  <span className="text-brand-2">· {exp.label}</span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {!hydrated ? null : state.pantry.length === 0 ? (
          <EmptyState
            emoji="🧊"
            title="Комора порожня"
            note="Додай продукти — і застосунок покаже, що з них можна приготувати прямо зараз."
            action={<Button onClick={() => setScanOpen(true)}>Сканувати перший продукт</Button>}
          />
        ) : (
          <div className="flex flex-col gap-5">
            {/* Прострочене — понад категоріями: це те, з чим треба щось
                зробити зараз, а не просто інвентар холодильника. */}
            {expired.length > 0 && (
              <div>
                <h3 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-berry">
                  <TriangleAlert size={13} />
                  Прострочене · {expired.length}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <AnimatePresence initial={false}>
                    {expired.map((item) => (
                      <PantryChip
                        key={item.key}
                        item={item}
                        onOpen={() => setDetailsFor(item.key)}
                        onRemove={() => state.removePantry(item.key)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {groups.map(([cat, items]) => (
              <div key={cat}>
                <h3 className="mb-2.5 text-[12px] font-bold uppercase tracking-wide text-muted">
                  {CAT_LABEL[cat]}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <AnimatePresence initial={false}>
                    {items.map((item) => (
                      <PantryChip
                        key={item.key}
                        item={item}
                        onOpen={() => setDetailsFor(item.key)}
                        onRemove={() => state.removePantry(item.key)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Що докупити */}
      {suggestions.length > 0 && (
        <section className="px-4 pt-7">
          <div className="mb-2.5 flex items-center gap-2">
            <Sparkles size={15} className="text-brand" />
            <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted">
              Докупи — відкриє нові рецепти
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map(({ key, unlocks }) => {
              const def = ing(key);
              return (
                <button
                  key={key}
                  onClick={() => add(key)}
                  className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 py-2 pl-3 pr-3.5 text-[13px] font-semibold"
                >
                  <span>{def.emoji}</span>
                  {def.label}
                  <span className="rounded-full bg-brand/20 px-1.5 text-[11px] font-extrabold text-brand">
                    +{unlocks}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Картка продукту: скільки є і доки придатний */}
      <ItemSheet
        itemKey={detailsFor}
        onClose={() => setDetailsFor(null)}
        onAddMore={() => {
          setDetailsFor(null);
          setAddOpen(true);
        }}
      />

      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetect={handleDetect} />

      {/* Сканер QR з чека */}
      <BarcodeScanner
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        onDetect={handleReceipt}
        formats={RECEIPT_FORMATS}
        hint="Наведи на QR-код унизу чека"
        manualEntry={false}
      />

      {/* Очікування відповіді податкової */}
      <Sheet open={receiptBusy} onClose={() => {}} title="Читаю чек">
        <div className="flex items-center gap-3 py-6">
          <Spinner />
          <p className="text-[14px] text-muted">
            Питаю податкову, що саме було в цьому чеку…
          </p>
        </div>
      </Sheet>

      {/* Не вдалося прочитати чек */}
      <Sheet
        open={!!receiptError}
        onClose={() => setReceiptError(null)}
        title="Чек не прочитався"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setReceiptError(null)}>
              Закрити
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                setReceiptError(null);
                setReceiptOpen(true);
              }}
            >
              Сканувати ще
            </Button>
          </div>
        }
      >
        {receiptError && (
          <div className="pb-2">
            <p className="text-[14px] leading-relaxed">{receiptError.message}</p>
            <p className="mt-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
              Що зчиталося з коду
            </p>
            <p className="mt-1.5 break-all rounded-2xl bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-muted">
              {receiptError.scanned.slice(0, 300) || "— порожньо —"}
            </p>
          </div>
        )}
      </Sheet>

      {/* Позиції чека */}
      <Sheet
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title="Що було в чеку"
        footer={
          receipt ? (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setReceipt(null)}>
                Скасувати
              </Button>
              <Button className="flex-1" onClick={importReceipt} disabled={pickedCount === 0}>
                {pickedCount > 0
                  ? `Додати ${pickedCount} ${plural(pickedCount, "позицію", "позиції", "позицій")}`
                  : "Нічого не обрано"}
              </Button>
            </div>
          ) : undefined
        }
      >
        {receipt && (
          <div className="pb-2">
            <p className="mb-3 text-[12px] text-muted">
              {receipt.store ? `${receipt.store} · ` : ""}
              {receipt.drafts.length} {plural(receipt.drafts.length, "рядок", "рядки", "рядків")}.
              Познач, що несемо в комору.
            </p>

            <div className="flex flex-col gap-2">
              {receipt.drafts.map((draft) => (
                <ReceiptRow
                  key={draft.id}
                  draft={draft}
                  checked={chosen.has(draft.id)}
                  onToggle={() => toggleDraft(draft.id)}
                  onPick={() => setPickForLine(draft.id)}
                  onQuantity={(next) => patchDraft(draft.id, next)}
                />
              ))}
            </div>
          </div>
        )}
      </Sheet>

      {/* Ручний вибір продукту для рядка чека */}
      <IngredientPicker
        open={!!pickForLine}
        onClose={() => setPickForLine(null)}
        title="Що це за продукт?"
        onPick={(def) => {
          const draft = receipt?.drafts.find((d) => d.id === pickForLine);
          if (!draft) return;
          const quantity = lineQuantity(draft.line);
          patchDraft(draft.id, {
            ingredient: def,
            nonFood: false,
            amount: quantity?.amount,
            unit: quantity?.unit,
          });
          setChosen((prev) => new Set(prev).add(draft.id));

          /*
           * Підказуємо довіднику спільноти — так само, як це давно робить
           * сканер штрихкодів. Людина щойно тримала товар у руках і сказала,
           * що це таке; наступного разу вгадувати вже не доведеться ані їй,
           * ані будь-кому іншому. Мовчки: це побічний ефект вибору.
           */
          const code = lookupableBarcode(draft.line.code);
          if (code) void teachReceiptCode(code, draft.line.name, def.key);
        }}
      />

      {/* Індикатор пошуку товару */}
      <Sheet open={scanLoading} onClose={() => {}} title="Шукаю товар">
        <div className="flex items-center gap-3 py-6">
          <Spinner />
          <p className="text-[14px] text-muted">Звіряю штрихкод з базою Open Food Facts…</p>
        </div>
      </Sheet>

      {/* Результат сканування */}
      <Sheet open={!!scanned} onClose={() => setScanned(null)} title="Результат сканування">
        {scanned && (
          <div className="pb-4">
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
              {scanned.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={scanned.image}
                  alt=""
                  className="h-16 w-16 rounded-2xl bg-surface-2 object-contain"
                />
              ) : (
                <span className="grid h-16 w-16 place-items-center rounded-2xl bg-surface-2 text-2xl">
                  {scanned.ingredient?.emoji ?? "📦"}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold">{scanned.name}</p>
                {scanned.brand && <p className="truncate text-[12px] text-muted">{scanned.brand}</p>}
                <p className="mt-0.5 font-mono text-[11px] text-faint">{scanned.barcode}</p>
              </div>
            </div>

            {scanned.ingredient ? (
              <div className="mt-4 rounded-2xl border border-mint/30 bg-mint/10 p-3.5">
                <p className="text-[13px] font-bold text-mint">
                  ✓ Додано в комору як «{scanned.ingredient.label}»
                </p>
                {scanned.source === "community" && (
                  <p className="mt-1 text-[11.5px] text-muted">
                    Цей штрихкод розпізнав хтось із користувачів
                  </p>
                )}

                {/* Скільки саме принесли — етикетка цього не знає. */}
                <div className="mt-3 flex items-center gap-2.5">
                  <span className="text-[12px] font-semibold text-muted">Скільки:</span>
                  <ScannedQuantity itemKey={scanned.ingredient.key} />
                </div>

                <p className="mt-3 text-[12px] text-muted">
                  Не те? Обери правильний продукт зі списку.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2.5"
                  onClick={() => {
                    state.removePantry(scanned.ingredient!.key);
                    setPickFor(scanned);
                    setScanned(null);
                  }}
                >
                  Обрати інший
                </Button>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-3.5">
                <p className="text-[13px] font-bold">
                  {scanned.source === "unknown"
                    ? "Такого штрихкоду немає в базі"
                    : "Не вдалося визначити продукт"}
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  {scanned.source === "unknown"
                    ? "Open Food Facts мало знає про українські товари. Обери зі списку, чим це є — і наступний, хто відсканує цей код, побачить готову відповідь."
                    : "Обери зі списку, чим це є — і наступний, хто відсканує цей код, побачить готову відповідь."}
                </p>
                <Button
                  size="sm"
                  className="mt-2.5"
                  onClick={() => {
                    setPickFor(scanned);
                    setScanned(null);
                  }}
                >
                  Обрати продукт
                </Button>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setScanned(null);
                  setScanOpen(true);
                }}
              >
                Сканувати ще
              </Button>
              <Button className="flex-1" onClick={() => setScanned(null)}>
                Готово
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      {/* Ручний вибір продукту після сканування */}
      <IngredientPicker
        open={!!pickFor}
        onClose={() => setPickFor(null)}
        title="Що це за продукт?"
        exclude={pantryKeys}
        onPick={(def) => {
          add(def.key, {
            label: pickFor?.name,
            barcode: pickFor?.barcode,
            amount: pickFor?.amount,
            unit: pickFor?.unit,
          });
          // Наступному, хто відсканує цей код, вгадувати вже не доведеться.
          if (pickFor) void teachBarcode(pickFor, def.key);
          setPickFor(null);
          setDetailsFor(def.key);
        }}
      />

      {/* Додавання вручну */}
      <IngredientPicker
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setQuery("");
        }}
        title="Додати продукт"
        exclude={pantryKeys}
        query={query}
        onQueryChange={setQuery}
        results={searchResults}
        onPick={(def) => {
          add(def.key);
          setQuery("");
          // Одразу відкриваємо картку: питання «скільки його є» краще
          // ставити тоді, коли продукт щойно в руках, а не колись потім.
          setDetailsFor(def.key);
        }}
      />
    </div>
  );
}

/* ── Чек ──────────────────────────────────────────────────────────────── */

const RECEIPT_FAILURE: Record<ReceiptFailure, string> = {
  notfound: "Податкова не знайшла такого чека",
  noitems: "У цьому чеку немає списку товарів",
  upstream: "Податкова не відповідає — спробуй пізніше",
  offline: "Немає звʼязку — чек читається тільки онлайн",
  throttled: "Забагато спроб поспіль. Спробуй за хвилину",
};

/**
 * Другий заход для нерозпізнаних назв — за кодом товару з чека.
 *
 * Частина мереж кладе в чек справжній EAN, а отже нерозпізнану касову назву
 * можна довизначити тим самим пошуком, що й сканер штрихкодів: спершу
 * довідник спільноти, далі Open Food Facts. Беремо не більше восьми рядків
 * за раз — решта чекає на людину, і це чесніший обмін, ніж хвилина очікування.
 */
async function enrichByBarcode(drafts: ReceiptDraft[]): Promise<ReceiptDraft[]> {
  const targets = drafts
    .filter((d) => !d.ingredient && !d.nonFood && lookupableBarcode(d.line.code))
    .slice(0, 8);
  if (targets.length === 0) return drafts;

  const found = new Map<string, ProductInfo>();
  await Promise.all(
    targets.map(async (draft) => {
      const code = lookupableBarcode(draft.line.code);
      if (!code) return;
      const info = await lookupBarcode(code).catch(() => null);
      if (info?.ingredient) found.set(draft.id, info);
    }),
  );

  return drafts.map((draft) => {
    const info = found.get(draft.id);
    if (!info?.ingredient) return draft;

    /*
     * Кількість беремо з чека, але коли він рахує штуками, вагу однієї
     * пачки знає етикетка: «2 шт» плюс «900 мл» з бази — це 1,8 л.
     */
    const fromLine = lineQuantity(draft.line);
    const fromLabel =
      info.amount != null && info.unit
        ? { amount: info.amount * draft.line.qty, unit: info.unit }
        : null;
    const quantity = fromLine?.unit === "pcs" && fromLabel ? fromLabel : fromLine ?? fromLabel;

    return { ...draft, ingredient: info.ingredient, ...quantity };
  });
}

/**
 * Рядок чека перед тим, як стати продуктом у коморі.
 *
 * Касову назву показуємо завжди, навіть коли продукт впізнано: саме за нею
 * людина звіряє рядок із папірцем у руці, а «Молоко» без уточнення в чеку на
 * двадцять позицій ні про що не каже.
 */
function ReceiptRow({
  draft,
  checked,
  onToggle,
  onPick,
  onQuantity,
}: {
  draft: ReceiptDraft;
  checked: boolean;
  onToggle: () => void;
  onPick: () => void;
  onQuantity: (next: { amount?: number; unit: Unit }) => void;
}) {
  const def = draft.ingredient;

  return (
    <div
      className={`rounded-2xl border p-3 ${
        checked ? "border-line bg-surface" : "border-line/50 bg-surface/40"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <button
          onClick={onToggle}
          disabled={!def}
          role="checkbox"
          aria-checked={checked}
          aria-label={`Додати ${def?.label ?? draft.line.name}`}
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${
            checked ? "border-brand bg-brand text-brand-ink" : "border-line"
          } ${def ? "" : "opacity-40"}`}
        >
          {checked && <Check size={13} strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1">
          <p className={`truncate text-[13.5px] font-bold ${checked ? "" : "text-muted"}`}>
            {def?.label ?? draft.line.name}
          </p>
          <p className="truncate text-[11px] text-faint">
            {draft.line.name}
            {draft.line.sum != null && ` · ${formatNumber(draft.line.sum)} ₴`}
          </p>
        </div>

        <span className="shrink-0 text-lg">{def?.emoji ?? "📦"}</span>
      </div>

      {def ? (
        <div className="mt-2 flex items-center gap-2 pl-[30px]">
          <span className="text-[12px] font-semibold text-muted">Скільки:</span>
          <QuantityInput
            amount={draft.amount}
            unit={draft.unit}
            defaultUnit={def.defaultUnit}
            allowTaste={false}
            label={def.label}
            onChange={onQuantity}
          />
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2 pl-[30px]">
          <p className="text-[11.5px] text-muted">
            {draft.nonFood ? "Не для комори" : "Немає в каталозі"}
          </p>
          <Button size="sm" variant="secondary" onClick={onPick}>
            Обрати продукт
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Вибір інгредієнта ────────────────────────────────────────────────── */

function IngredientPicker({
  open,
  onClose,
  title,
  onPick,
  exclude = [],
  query: controlledQuery,
  onQueryChange,
  results,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onPick: (def: IngredientDef) => void;
  exclude?: string[];
  query?: string;
  onQueryChange?: (v: string) => void;
  results?: IngredientDef[];
}) {
  const [localQuery, setLocalQuery] = useState("");
  const q = controlledQuery ?? localQuery;
  const setQ = onQueryChange ?? setLocalQuery;

  const list = useMemo(() => {
    const found = q.trim() ? results ?? searchIngredients(q) : INGREDIENTS;
    return found.filter((d) => !exclude.includes(d.key));
  }, [q, results, exclude]);

  const grouped = useMemo(() => {
    const map = new Map<IngredientCat, IngredientDef[]>();
    for (const d of list) map.set(d.cat, [...(map.get(d.cat) ?? []), d]);
    return CAT_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [list]);

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="sticky top-0 z-10 -mx-5 mb-2 bg-bg-elev px-5 pb-3">
        <div className="flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5">
          <Search size={17} className="shrink-0 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Помідор, курка, рис…"
            className="h-full flex-1 text-[15px]"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Очистити">
              <X size={16} className="text-muted" />
            </button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">
          Нічого не знайшлось. Спробуй іншу назву.
        </p>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-muted">
                {CAT_LABEL[cat]}
              </h3>
              <div className="flex flex-wrap gap-2">
                {items.map((def) => (
                  <button
                    key={def.key}
                    onClick={() => {
                      onPick(def);
                      // Рядок пошуку скидаємо разом із вибором: продукт уже
                      // додано, і наступного разу аркуш має відкритись чистим.
                      setQ("");
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-2 pl-3 pr-3 text-[13px] font-semibold active:bg-surface-2"
                  >
                    <span>{def.emoji}</span>
                    {def.label}
                    <Plus size={13} className="text-brand" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Продукт у коморі.
 *
 * Прострочене — червоним, те, що псується найближчим часом, — бурштиновим.
 * Колір дублюється підписом («прострочено 2 дн. тому»), бо самим кольором
 * стан передавати не можна: його не побачить ані дальтонік, ані скрінрідер.
 */
function PantryChip({
  item,
  onOpen,
  onRemove,
}: {
  item: PantryItem;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const def = ing(item.key);
  const exp = expiryInfo(item.expiresAt);
  const qty = qtyLabel(item);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      className={`inline-flex items-center gap-1.5 rounded-full border py-2 pl-3 pr-2 text-[13px] font-semibold ${
        exp?.tone === "expired"
          ? "border-berry bg-berry/15"
          : exp?.tone === "soon"
            ? "border-brand-2/50 bg-brand-2/10"
            : "border-line bg-surface"
      }`}
    >
      <button
        onClick={() => {
          haptic(8);
          onOpen();
        }}
        className="inline-flex items-center gap-1.5"
      >
        <span>{def.emoji}</span>
        <span className={exp?.tone === "expired" ? "text-berry" : undefined}>{def.label}</span>
        {qty && <span className="text-[11px] font-bold text-brand">{qty}</span>}
        {exp && (
          <span
            className={`text-[10px] font-bold ${
              exp.tone === "expired"
                ? "text-berry"
                : exp.tone === "soon"
                  ? "text-brand-2"
                  : "text-faint"
            }`}
          >
            {exp.label}
          </span>
        )}
        {item.barcode && !exp && <span className="text-[9px] text-faint">скан</span>}
      </button>
      <button
        onClick={() => {
          haptic(10);
          onRemove();
        }}
        aria-label={`Прибрати ${def.label}`}
        className="grid h-5 w-5 place-items-center"
      >
        <X size={13} className="text-faint" />
      </button>
    </motion.div>
  );
}

/**
 * Кількість щойно відсканованого продукту — прямо в аркуші результату,
 * щоб не змушувати шукати той самий чип у списку після сканування.
 */
function ScannedQuantity({ itemKey }: { itemKey: string }) {
  const state = useApp();
  const item = state.pantry.find((p) => p.key === itemKey);
  const def = ing(itemKey);
  if (!item) return null;

  return (
    <QuantityInput
      amount={item.amount}
      unit={item.unit}
      defaultUnit={def.defaultUnit}
      label={item.label ?? def.label}
      allowTaste={false}
      onChange={({ amount, unit }) =>
        state.addPantry({ ...item, amount, unit, qty: undefined })
      }
    />
  );
}

/**
 * Підпис кількості для чипа: «200 г», «2 шт». Порожньо, якщо не вказано —
 * комора має сенс і без цифр, це не обовʼязкове поле.
 */
function qtyLabel(item: PantryItem): string {
  return ingredientQtyLabel(item);
}

/**
 * Картка продукту з комори: скільки його є і доки він придатний.
 *
 * Кількість вводиться тим самим контролом, що й у формі рецепта, — число
 * плюс одиниця. Раніше комора знала тільки «є / немає», тож на питання
 * «чи вистачить на цей рецепт» відповісти не могла.
 */
function ItemSheet({
  itemKey,
  onClose,
  onAddMore,
}: {
  itemKey: string | null;
  onClose: () => void;
  /** Показує кнопку «додати ще» — щоб наповнювати комору не по одному аркушу. */
  onAddMore?: () => void;
}) {
  const state = useApp();
  const item = state.pantry.find((p) => p.key === itemKey);
  const def = itemKey ? ing(itemKey) : null;

  const patch = (changes: Partial<PantryItem>) => {
    if (!item) return;
    state.addPantry({ ...item, ...changes });
  };

  const saveExpiry = (expiresAt: string | undefined) => {
    haptic(10);
    patch({ expiresAt });
    onClose();
  };

  // Швидкі варіанти замість вибору дати: так зазвичай і думають про продукти.
  const inDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  return (
    <Sheet
      open={itemKey !== null}
      onClose={onClose}
      title={def ? `${def.emoji} ${item?.label ?? def.label}` : ""}
    >
      <div className="pb-4">
        <label className="block text-[12px] font-semibold text-muted">Скільки є вдома</label>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <QuantityInput
            amount={item?.amount}
            unit={item?.unit}
            defaultUnit={def?.defaultUnit}
            label={def?.label}
            allowTaste={false}
            onChange={({ amount, unit }) => {
              // Старий вільний текст прибираємо: разом із числом він
              // конфліктував би за те, що саме показувати.
              patch({ amount, unit, qty: undefined });
            }}
          />
          {item?.amount != null && (
            <button
              onClick={() => patch({ amount: undefined, unit: undefined, qty: undefined })}
              className="text-[12px] font-semibold text-faint"
            >
              Прибрати
            </button>
          )}
        </div>
        {item?.qty && item.amount == null && (
          <p className="mt-1.5 text-[11.5px] text-faint">Було записано як «{item.qty}»</p>
        )}

        <div className="mt-5 h-px bg-line" />

        {/*
          Обіцяти тут можна лише те, що застосунок справді робить. Сповіщень
          він не шле — ані пуш, ані бейдж не написані. Зате продукт із
          близьким строком підіймається вгору списку, а «Врятувати продукт»
          збирає з нього страви. Про це й пишемо.
        */}
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          До якого числа це ще їстівне? Продукт із близьким строком підніметься вгору
          комори, а «Врятувати продукт» покаже, що з нього приготувати.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: "Завтра", days: 1 },
            { label: "3 дні", days: 3 },
            { label: "Тиждень", days: 7 },
            { label: "2 тижні", days: 14 },
            { label: "Місяць", days: 30 },
          ].map((opt) => (
            <Chip key={opt.days} onClick={() => saveExpiry(inDays(opt.days))}>
              {opt.label}
            </Chip>
          ))}
        </div>

        <label className="mt-4 block text-[12px] text-muted">Або точна дата</label>
        <input
          type="date"
          value={item?.expiresAt ?? ""}
          onChange={(e) => saveExpiry(e.target.value || undefined)}
          className="mt-1.5 h-11 w-full rounded-2xl border border-line bg-surface-2 px-3.5 text-[15px]"
        />

        {item?.expiresAt && (
          <Button full variant="secondary" className="mt-3" onClick={() => saveExpiry(undefined)}>
            Прибрати строк
          </Button>
        )}

        <div className="mt-3 flex gap-2">
          {onAddMore && (
            <Button variant="secondary" className="flex-1" onClick={onAddMore}>
              Додати ще
            </Button>
          )}
          <Button className="flex-1" onClick={onClose}>
            Готово
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
