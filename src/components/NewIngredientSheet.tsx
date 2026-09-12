"use client";

import { useEffect, useState } from "react";
import { CAT_LABEL, CAT_ORDER, ownKey } from "@/data/ingredients";
import { FOOD_EMOJI } from "@/data/emoji";
import { useApp } from "@/lib/store";
import type { IngredientCat, IngredientDef, Unit } from "@/lib/types";
import { UNIT_GROUPS, unitLabel } from "@/lib/units";
import { haptic } from "@/lib/utils";
import { Button, Chip, Sheet } from "./ui";

/**
 * Власний продукт.
 *
 * Каталог на сотню позицій покриває звичайну кухню, але не кожну: комусь
 * потрібне кокосове борошно, комусь — домашня ковбаса від сусідки. Досі
 * такий продукт було нікуди подіти, і рецепт просто не дописувався.
 *
 * Обовʼязкова тут лише назва. Решта — категорія, міра, калорії — має
 * розумні замовчування, бо людина відкрила цей аркуш посеред запису рецепта
 * і повертатись до нього має якнайшвидше. Калорії можна не вводити: тоді
 * страва з цим продуктом просто не рахуватиме калорій, і це чесніше за
 * вигадане число.
 */
export function NewIngredientSheet({
  open,
  initialName = "",
  onClose,
  onCreated,
}: {
  open: boolean;
  initialName?: string;
  onClose: () => void;
  onCreated?: (def: IngredientDef) => void;
}) {
  const addCustomIngredient = useApp((s) => s.addCustomIngredient);
  const customIngredients = useApp((s) => s.customIngredients);

  const [label, setLabel] = useState(initialName);
  const [emoji, setEmoji] = useState("📦");
  const [cat, setCat] = useState<IngredientCat>("other");
  const [unit, setUnit] = useState<Unit>("g");
  const [perPiece, setPerPiece] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");
  const [carbs, setCarbs] = useState("");
  const [more, setMore] = useState(false);

  /*
   * Аркуш відкривають із рядка пошуку — те, що вже набрали, і є назвою.
   * Решту скидаємо тут, а не після збереження: закрити можна й не зберігши,
   * а компонент лишається змонтованим. Інакше наступний продукт відкривався б
   * із чужим значком, категорією й калоріями від попередньої спроби.
   */
  useEffect(() => {
    if (!open) return;
    setLabel(initialName);
    setEmoji("📦");
    setCat("other");
    setUnit("g");
    setPerPiece("");
    setKcal("");
    setProtein("");
    setFat("");
    setCarbs("");
    setMore(false);
  }, [open, initialName]);

  const num = (v: string) => {
    const n = Number(v.replace(",", "."));
    return v.trim() && Number.isFinite(n) ? n : undefined;
  };

  const save = () => {
    const name = label.trim();
    if (!name) return;

    const def: IngredientDef = {
      key: ownKey(name, (k) => customIngredients.some((d) => d.key === k)),
      label: name,
      emoji,
      cat,
      // Назва сама собі синонім: за нею продукт знайдеться в пошуку й у чеку.
      aliases: [name.toLowerCase()],
      defaultUnit: unit,
      gramsPerPiece: unit === "pcs" ? num(perPiece) : undefined,
      nutrition:
        num(kcal) != null
          ? {
              kcal: num(kcal) as number,
              protein: num(protein) ?? 0,
              fat: num(fat) ?? 0,
              carbs: num(carbs) ?? 0,
            }
          : undefined,
    };

    haptic(14);
    addCustomIngredient(def);
    onCreated?.(def);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Свій продукт"
      footer={
        <Button full onClick={save} disabled={!label.trim()}>
          Додати в каталог
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div>
          <Field>Назва</Field>
          <div className="flex gap-2">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-xl">
              {emoji}
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Кокосове борошно"
              autoFocus
              className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-3.5 text-[15px]"
            />
          </div>
          <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
            {FOOD_EMOJI.map((e) => (
              <button
                key={e}
                onClick={() => {
                  haptic(6);
                  setEmoji(e);
                }}
                aria-label={`Значок ${e}`}
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg ${
                  emoji === e ? "bg-brand/15 ring-2 ring-brand" : "bg-surface-2"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Field>Де його шукати</Field>
          <div className="flex flex-wrap gap-2">
            {CAT_ORDER.map((c) => (
              <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
                {CAT_LABEL[c]}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-faint">
            Від категорії залежить і місце в коморі, і відділ у списку покупок.
          </p>
        </div>

        <div>
          <Field>Чим міряти</Field>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            className="h-11 w-full rounded-2xl border border-line bg-surface px-3 text-[15px]"
          >
            {UNIT_GROUPS.map((group) => (
              <optgroup key={group.title} label={group.title}>
                {group.units.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {unit === "pcs" && (
            <div className="mt-2">
              <input
                value={perPiece}
                onChange={(e) => setPerPiece(e.target.value.replace(/[^\d.,]/g, ""))}
                inputMode="decimal"
                placeholder="Скільки грамів у штуці"
                className="h-11 w-full rounded-2xl border border-line bg-surface px-3.5 text-[15px]"
              />
              <p className="mt-1.5 text-[11px] leading-snug text-faint">
                Потрібно, щоб «2 шт» перетворились на грами — інакше калорії не
                порахуються.
              </p>
            </div>
          )}
        </div>

        {more ? (
          <div>
            <Field>Харчова цінність на 100 г</Field>
            <div className="grid grid-cols-4 gap-2">
              <NumField value={kcal} onChange={setKcal} label="ккал" />
              <NumField value={protein} onChange={setProtein} label="білки" />
              <NumField value={fat} onChange={setFat} label="жири" />
              <NumField value={carbs} onChange={setCarbs} label="вугл." />
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-faint">
              Можна не вводити. Тоді страви з цим продуктом просто не
              рахуватимуть калорій — це чесніше за вигадане число.
            </p>
          </div>
        ) : (
          <button
            onClick={() => setMore(true)}
            className="self-start text-[13px] font-bold text-brand"
          >
            + Харчова цінність
          </button>
        )}
      </div>
    </Sheet>
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
