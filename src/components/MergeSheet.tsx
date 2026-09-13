"use client";

import { ArrowLeftRight, Check, Search, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IngredientPicker } from "@/components/IngredientPicker";
import { Button, Sheet, Spinner, useToast } from "@/components/ui";
import { ancestors, ing, isOwnKey, satisfies } from "@/data/ingredients";
import type { Product } from "@/lib/product-types";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchProductIdentifiers,
  mergeCustomIngredients,
  mergeProducts,
  searchProducts,
  toCatalogError,
} from "@/lib/supabase/products-api";
import { cn, haptic } from "@/lib/utils";
import { productMeta, typeFamily, typeTrail } from "./ProductEditorSheet";

/*
 * Обʼєднання дублікатів (F8, I6).
 *
 * Дві картки одного товару — звичайна річ для спільного каталогу: один
 * сканував, другий вводив із чека, і назви вийшли різні. Обʼєднання не
 * видаляє жодної: переможена картка стає посиланням на переможця
 * (merged_into), штрихкоди й назви з чеків переїжджають із позначкою
 * «звідки» (merged_from), і «Розʼєднати» в історії повертає рівно їх.
 *
 * Типи мусять бути сумісні — один є тим самим або загальнішим за інший.
 * Інакше «Кефір» став би «Молоком» у чиїйсь коморі, і рецепти порахували б
 * його не туди. База перевіряє те саме; тут — щоб кнопка не обіцяла
 * неможливого.
 */

type ProductsProps = {
  mode?: "products";
  open: boolean;
  onClose: () => void;
  /** Картка, з якої відкрили «Це дублікат…». */
  product: Product | null;
  /** Друга картка, якщо вже відома (дублікат при перейменуванні, конфлікт штрихкоду). */
  other?: Product | null;
  onMerged: (loserId: string, winnerId: string) => void;
};

type TypesProps = {
  mode: "types";
  open: boolean;
  onClose: () => void;
  /** Дописаний тип, з якого відкрили обʼєднання. */
  typeKey: string | null;
  otherTypeKey?: string | null;
  onMerged: (loserKey: string, winnerKey: string) => void;
};

export function MergeSheet(props: ProductsProps | TypesProps) {
  if (!isSupabaseConfigured) return null;
  return props.mode === "types" ? <MergeTypes {...props} /> : <MergeProducts {...props} />;
}

/** Чи можна злити типи: один — той самий або загальніший за інший. */
const compatibleTypes = (a: string, b: string) => satisfies(a, b) || satisfies(b, a);

function MergeProducts({ open, onClose, product, other: initialOther, onMerged }: ProductsProps) {
  const toast = useToast();
  const [other, setOther] = useState<Product | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOther(initialOther ?? null);
    setQuery(product?.name ?? "");
    setResults(null);
    setCounts({});
    setWinnerId(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Пошук другої картки — лише серед сумісних типів: інші однаково не обʼєднаються.
  useEffect(() => {
    if (!open || !product || other || query.trim().length < 2) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      searchProducts(query, typeFamily(product.typeKey), 10, ctrl.signal)
        .then((found) => !ctrl.signal.aborted && setResults(found.filter((p) => p.id !== product.id)))
        .catch((e) => !ctrl.signal.aborted && setError(toCatalogError(e).message));
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, product, other, query]);

  /*
   * Лишається та, яку частіше впізнають: більше штрихкодів і назв із чеків —
   * менше переїздів і менше шансів, що хтось саме зараз сканує переможену.
   * Нічия — друга картка: «Це дублікат…» натискають на зайвій.
   */
  useEffect(() => {
    if (!open || !product || !other) return;
    let alive = true;
    fetchProductIdentifiers([product.id, other.id])
      .then((list) => {
        if (!alive) return;
        const next: Record<string, number> = { [product.id]: 0, [other.id]: 0 };
        for (const i of list) if ("productId" in i.target) next[i.target.productId] = (next[i.target.productId] ?? 0) + 1;
        setCounts(next);
        setWinnerId((cur) => cur ?? (next[product.id] > next[other.id] ? product.id : other.id));
      })
      .catch(() => alive && setWinnerId((cur) => cur ?? other.id));
    return () => {
      alive = false;
    };
  }, [open, product, other]);

  if (!product) return null;

  const winner = other && winnerId ? (winnerId === product.id ? product : other) : null;
  const loser = winner && other ? (winner.id === product.id ? other : product) : null;
  const compatible = other ? compatibleTypes(product.typeKey, other.typeKey) : true;

  const merge = async () => {
    if (!winner || !loser || !compatible) return;
    setBusy(true);
    setError(null);
    try {
      await mergeProducts(loser.id, winner.id);
      haptic(14);
      toast(`Обʼєднали з «${winner.name}»`, "🔗");
      onMerged(loser.id, winner.id);
      onClose();
    } catch (e) {
      const err = toCatalogError(e);
      setError(err.code === "invalid" ? "Спершу зроби однаковий тип." : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Обʼєднати два записи одного товару?"
      footer={
        other ? (
          <Button full onClick={() => void merge()} loading={busy} disabled={!winner || !compatible}>
            Обʼєднати
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 pb-3">
        {error && (
          <p className="flex items-start gap-2 rounded-2xl border border-berry/30 bg-berry/10 px-3.5 py-3 text-[12.5px] leading-snug text-berry">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {!other ? (
          <>
            <p className="text-[13px] leading-snug text-muted">Яка картка — той самий товар, що «{product.name}»?</p>
            <div className="flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5">
              <Search size={17} className="shrink-0 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Назва чи виробник"
                className="h-full min-w-0 flex-1 text-[15px]"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Очистити">
                  <X size={16} className="text-muted" />
                </button>
              )}
            </div>
            {results === null && query.trim().length >= 2 && !error && <Spinner className="mx-auto my-4" />}
            {results?.length === 0 && (
              <p className="py-6 text-center text-[13px] text-muted">Схожих карток цього типу не знайшлось.</p>
            )}
            {results?.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  haptic(8);
                  setOther(p);
                }}
                className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-left active:bg-surface-2"
              >
                <span className="text-lg">{ing(p.typeKey).emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{p.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {[productMeta(p), ing(p.typeKey).label].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {[product, other].map((p) => {
                const active = winnerId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      haptic(8);
                      setWinnerId(p.id);
                    }}
                    className={cn(
                      "flex min-w-0 flex-col gap-1 rounded-2xl border bg-surface p-3 text-left",
                      active ? "border-brand ring-2 ring-brand/40" : "border-line",
                    )}
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className="text-lg">{ing(p.typeKey).emoji}</span>
                      {active && <Check size={15} className="text-brand" />}
                    </span>
                    <span className="line-clamp-3 text-[13.5px] font-bold leading-snug">{p.name}</span>
                    {productMeta(p) && <span className="text-[11.5px] leading-snug text-muted">{productMeta(p)}</span>}
                    <span className="text-[11px] leading-snug text-faint">{typeTrail(p.typeKey)}</span>
                    {counts[p.id] != null && (
                      <span className="text-[11px] text-faint">
                        {counts[p.id] === 0 ? "штрихкодів і назв з чеків немає" : `штрихкодів і назв з чеків: ${counts[p.id]}`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {!initialOther && (
              <button
                onClick={() => {
                  setOther(null);
                  setWinnerId(null);
                }}
                className="flex items-center gap-1.5 self-start text-[12.5px] font-bold text-brand"
              >
                <ArrowLeftRight size={13} /> Інша картка
              </button>
            )}

            {!compatible ? (
              <p className="rounded-2xl bg-surface-2 px-3.5 py-3 text-[12.5px] leading-snug text-berry">
                Спершу зроби однаковий тип.
              </p>
            ) : winner ? (
              <>
                <p className="text-[14px] font-bold">Лишиться: «{winner.name}»</p>
                <p className="text-[13px] leading-relaxed text-muted">
                  Штрихкоди й назви з чеків перейдуть до «{winner.name}», і в коморах теж буде «{winner.name}».
                  Розʼєднати можна пізніше — у картці «{winner.name}».
                </p>
              </>
            ) : (
              <Spinner className="mx-auto" />
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function MergeTypes({ open, onClose, typeKey, otherTypeKey, onMerged }: TypesProps) {
  const toast = useToast();
  const [other, setOther] = useState<string | null>(null);
  const [loserKey, setLoserKey] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOther(otherTypeKey ?? null);
    setLoserKey(typeKey);
    setError(null);
    setPicking(!otherTypeKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!typeKey) return null;

  /*
   * Зникає лише дописаний тип: вбудовані ключі живуть у коді й у рецептах
   * назавжди. Коли дописані обидва, людина обирає, який лишити.
   */
  const pair = other ? [typeKey, other] : [typeKey];
  const owns = pair.filter(isOwnKey);
  const loser = other ? (loserKey && owns.includes(loserKey) ? loserKey : (owns[0] ?? null)) : null;
  const winner = other && loser ? (loser === typeKey ? other : typeKey) : null;
  /*
   * Злити тип у його ж різновид не можна: різновиди переможеного отримують
   * батьком переможця — і переможець став би різновидом самого себе.
   */
  const intoOwnChild = winner && loser ? winner !== loser && satisfies(winner, loser) : false;
  /*
   * Те саме правило, що в базі (merge_custom_ingredients): один тип — той самий
   * чи загальніший за інший, або в них спільний батько (два «Кефіри без
   * лактози» — різновиди «Кефіру»; два самостійні — теж). «Кефір безлактозний»
   * у «Сіль» — ні: інакше кефір став би сіллю в коморах і списках усіх.
   */
  const sameFamily =
    !!other && (satisfies(typeKey, other) || satisfies(other, typeKey) || (ancestors(typeKey)[0] ?? null) === (ancestors(other)[0] ?? null));
  const blocked = !other
    ? null
    : other === typeKey
      ? "Це той самий тип."
      : owns.length === 0
        ? "Вбудовані типи не обʼєднуються — лише дописані."
        : !sameFamily
          ? "Спершу зроби однаковий тип: обʼєднуються лише різновиди одне одного або одного батька."
          : intoOwnChild
            ? "Не можна обʼєднати тип із його ж різновидом — обери навпаки."
            : null;

  const merge = async () => {
    if (!loser || !winner || blocked) return;
    setBusy(true);
    setError(null);
    try {
      await mergeCustomIngredients(loser, winner);
      haptic(14);
      toast(`Тепер «${ing(loser).label}» — це «${ing(winner).label}»`, "🔗");
      onMerged(loser, winner);
      onClose();
    } catch (e) {
      setError(toCatalogError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Обʼєднати типи"
        footer={
          <Button full onClick={() => void merge()} loading={busy} disabled={!winner || !!blocked}>
            Обʼєднати
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-3">
          {error && (
            <p className="flex items-start gap-2 rounded-2xl border border-berry/30 bg-berry/10 px-3.5 py-3 text-[12.5px] leading-snug text-berry">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <button
            onClick={() => setPicking(true)}
            className="flex h-11 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 text-left text-[14px]"
          >
            {other ? (
              <>
                <span>{ing(other).emoji}</span>
                <span className="min-w-0 flex-1 truncate font-bold">{typeTrail(other)}</span>
                <span className="shrink-0 text-[12px] font-bold text-brand">змінити</span>
              </>
            ) : (
              <span className="text-faint">З яким типом обʼєднати?</span>
            )}
          </button>

          {blocked ? (
            <p className="rounded-2xl bg-surface-2 px-3.5 py-3 text-[12.5px] leading-snug text-berry">{blocked}</p>
          ) : (
            loser &&
            winner && (
              <>
                <p className="text-[14px] leading-relaxed">
                  Обʼєднати тип «{ing(loser).label}» з «{ing(winner).label}»? Рецепти з «{ing(loser).label}»
                  рахуватимуться як «{ing(winner).label}».
                </p>
                <p className="text-[12.5px] leading-snug text-muted">
                  {isOwnKey(winner)
                    ? `Розʼєднати можна пізніше — у «Редагувати тип» для «${ing(winner).label}».`
                    : `Розʼєднати можна пізніше — у групі «${ing(winner).label}» в коморі.`}
                </p>
                {owns.length === 2 && (
                  <button
                    onClick={() => setLoserKey(winner)}
                    className="flex items-center gap-1.5 self-start text-[12.5px] font-bold text-brand"
                  >
                    <ArrowLeftRight size={13} /> Лишити «{ing(loser).label}»
                  </button>
                )}
              </>
            )
          )}
        </div>
      </Sheet>
      <IngredientPicker
        open={picking}
        onClose={() => setPicking(false)}
        title="З яким типом обʼєднати"
        editOwn={false}
        exclude={[typeKey]}
        onPick={(def) => {
          setOther(def.key);
          setLoserKey(typeKey);
        }}
      />
    </>
  );
}
