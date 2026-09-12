"use client";

import { useEffect, useState } from "react";
import { IngredientPicker } from "@/components/IngredientPicker";
import { NewIngredientSheet } from "@/components/NewIngredientSheet";
import { Button, QuantityInput, Sheet } from "@/components/ui";
import { ing } from "@/data/ingredients";
import type { ProductInfo } from "@/lib/barcode";
import type { IngredientDef, Nutrition, Unit } from "@/lib/types";
import { haptic } from "@/lib/utils";

/**
 * Картка товару, якого не знає ніхто.
 *
 * Open Food Facts український ринок майже не покриває, тож на коди 482…
 * відповіді немає ні в них, ні у нас — поки хтось не розкаже. Досі єдине, що
 * можна було сказати, це «чим воно є» з переліку: назва з етикетки, вага
 * пачки й КБЖВ зникали, і наступного разу все повторювалось.
 *
 * Тут людина заповнює картку один раз — і вона лягає в спільний довідник.
 * Обовʼязкове лише те, без чого картки не існує: назва й те, чим цей товар є.
 * Решту можна лишити порожньою: вигадані калорії гірші за відсутні.
 */
export function ProductCardSheet({
  product,
  open,
  onClose,
  onSave,
}: {
  product: ProductInfo | null;
  open: boolean;
  onClose: () => void;
  /** Готова картка: назва з етикетки, вага пачки, КБЖВ і продукт каталогу. */
  onSave: (filled: ProductInfo, def: IngredientDef) => void;
}) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [unit, setUnit] = useState<Unit>("g");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");
  const [carbs, setCarbs] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  /*
   * Наперед заповнюємо тим, що вже відомо. Для геть невідомого коду назва —
   * це «Товар 4820…», і показувати таке в полі безглуздо: людина однаково
   * напише своє.
   */
  useEffect(() => {
    if (!open || !product) return;
    setName(product.source === "unknown" ? "" : product.name);
    setBrand(product.brand ?? "");
    setAmount(product.amount);
    setUnit(product.unit ?? "g");
    setKcal(product.nutrition ? String(product.nutrition.kcal) : "");
    setProtein(product.nutrition ? String(product.nutrition.protein) : "");
    setFat(product.nutrition ? String(product.nutrition.fat) : "");
    setCarbs(product.nutrition ? String(product.nutrition.carbs) : "");
    setKey(product.ingredient?.key ?? null);
  }, [open, product]);

  const num = (v: string) => {
    const n = Number(v.replace(",", "."));
    return v.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  /*
   * Ті самі межі, що й для даних із Open Food Facts: понад 900 ккал у 100 г
   * не буває навіть у чистої олії, а білки з жирами й вуглеводами не можуть
   * важити більше за самі 100 грамів. Помилку в комі краще спіймати тут, ніж
   * потім дивуватись тисячам калорій у щоденнику.
   */
  const nutrition = ((): Nutrition | undefined => {
    const k = num(kcal);
    if (k == null || k > 900) return undefined;
    const p = num(protein) ?? 0;
    const f = num(fat) ?? 0;
    const c = num(carbs) ?? 0;
    if (p + f + c > 105) return undefined;
    return { kcal: k, protein: p, fat: f, carbs: c };
  })();

  const nutritionBroken = kcal.trim() !== "" && !nutrition;
  const def = key ? ing(key) : null;
  const ready = name.trim().length > 0 && !!def && !nutritionBroken;

  const save = () => {
    if (!product || !def) return;
    haptic(14);
    onSave(
      {
        ...product,
        name: name.trim(),
        brand: brand.trim() || undefined,
        amount,
        unit: amount != null ? unit : undefined,
        nutrition,
        ingredient: def,
      },
      def,
    );
    onClose();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Картка товару"
        footer={
          <Button full onClick={save} disabled={!ready}>
            Зберегти й додати в комору
          </Button>
        }
      >
        {product && (
          <div className="flex flex-col gap-4 pb-2">
            <p className="rounded-2xl bg-surface-2 px-3.5 py-3 text-[12px] leading-snug text-muted">
              Цього коду не знає ні Open Food Facts, ні ми. Заповни один раз — і
              наступного разу товар додасться сам, із вагою й калоріями.
              <span className="mt-1 block font-mono text-[11px] text-faint">
                {product.barcode}
              </span>
            </p>

            <div>
              <Field>Назва на упаковці</Field>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Молоко Галичина 2,5%"
                autoFocus
                className="h-11 w-full rounded-2xl border border-line bg-surface px-3.5 text-[15px]"
              />
              <p className="mt-1.5 text-[11px] leading-snug text-faint">
                Саме так, як на пачці: «молоко» ти й без сканера впізнаєш, а
                отут корисно бачити, яке саме.
              </p>
            </div>

            <div>
              <Field>Виробник</Field>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Галичина"
                className="h-11 w-full rounded-2xl border border-line bg-surface px-3.5 text-[15px]"
              />
            </div>

            <div>
              <Field>Чим це є</Field>
              {def ? (
                <button
                  onClick={() => setPicking(true)}
                  className="flex w-full items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-3 text-left"
                >
                  <span className="text-lg">{def.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold">
                    {def.label}
                  </span>
                  <span className="shrink-0 text-[12px] font-bold text-brand">змінити</span>
                </button>
              ) : (
                <Button full variant="secondary" onClick={() => setPicking(true)}>
                  Обрати продукт
                </Button>
              )}
              <p className="mt-1.5 text-[11px] leading-snug text-faint">
                Рецепти рахують молоко, а не «Молоко Галичина», — тому картка
                товару окремо, а продукт каталогу окремо. Немає потрібного —
                створи свій.
              </p>
            </div>

            <div>
              <Field>Скільки в упаковці</Field>
              <QuantityInput
                amount={amount}
                unit={unit}
                defaultUnit={def?.defaultUnit ?? "g"}
                allowTaste={false}
                label="упаковка"
                onChange={(next) => {
                  setAmount(next.amount);
                  setUnit(next.unit);
                }}
              />
            </div>

            <div>
              <Field>Харчова цінність на 100 г</Field>
              <div className="grid grid-cols-4 gap-2">
                <NumField value={kcal} onChange={setKcal} label="ккал" />
                <NumField value={protein} onChange={setProtein} label="білки" />
                <NumField value={fat} onChange={setFat} label="жири" />
                <NumField value={carbs} onChange={setCarbs} label="вугл." />
              </div>
              {nutritionBroken ? (
                <p className="mt-1.5 text-[11.5px] leading-snug text-berry">
                  Такого не буває: у 100 г не більше 900 ккал, а білки, жири й
                  вуглеводи разом важать менше за самі 100 грамів. Перевір кому.
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] leading-snug text-faint">
                  З пачки, збоку. Можна лишити порожнім — тоді страви з цим
                  товаром просто не рахуватимуть калорій.
                </p>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <IngredientPicker
        open={picking}
        onClose={() => setPicking(false)}
        title="Чим це є"
        onPick={(picked) => setKey(picked.key)}
        onCreate={(typed) => {
          setPicking(false);
          setCreating(typed || name.trim());
        }}
      />

      <NewIngredientSheet
        open={creating !== null}
        initialName={creating ?? ""}
        onClose={() => setCreating(null)}
        onCreated={(created) => setKey(created.key)}
      />
    </>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">{children}</p>
  );
}

function NumField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        inputMode="decimal"
        placeholder="0"
        aria-label={label}
        className="h-11 w-full rounded-2xl border border-line bg-surface px-2 text-center text-[15px]"
      />
      <span className="text-center text-[10.5px] text-muted">{label}</span>
    </label>
  );
}
