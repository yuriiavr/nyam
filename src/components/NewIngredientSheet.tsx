"use client";

import { History, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  CAT_LABEL,
  CAT_ORDER,
  MAX_TYPE_DEPTH,
  ancestors,
  descendants,
  ing,
  isOwnKey,
  knownIngredient,
  ownKey,
  sameNameIngredient,
  typeDepth,
  variantParentGuess,
} from "@/data/ingredients";
import { FOOD_EMOJI } from "@/data/emoji";
import { refreshFromServer } from "@/lib/session";
import { useApp } from "@/lib/store";
import { fetchCustomIngredients } from "@/lib/supabase/api";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { saveCustomIngredient, toCatalogError, unmergeCustomIngredient } from "@/lib/supabase/products-api";
import type { IngredientCat, IngredientDef, Unit } from "@/lib/types";
import { UNIT_GROUPS, unitLabel } from "@/lib/units";
import { subscribeTypeEditor } from "@/lib/type-editor";
import { haptic } from "@/lib/utils";
import { HistorySheet } from "./HistorySheet";
import { IngredientPicker } from "./IngredientPicker";
import { MergeSheet } from "./MergeSheet";
import { Button, Chip, Sheet, useToast } from "./ui";

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
 *
 * «Це різновид…» — теж необовʼязкове, але саме воно робить новий тип
 * корисним у підборі страв: «Кефір безлактозний» із батьком «Кефір» закриває
 * кожен рецепт, якому треба кефір. Навпаки — ні.
 *
 * З `ingredient` аркуш стає правкою дописаного типу (F7, I3). Дописані типи
 * спільні, як і картки товарів: правка йде через save_custom_ingredient з
 * номером версії й пишеться в історію, звідки її можна повернути. Без бекенду
 * тип живе лише на цьому пристрої — там правка просто замінює його локально.
 */
export function NewIngredientSheet({
  open,
  initialName = "",
  ingredient = null,
  onClose,
  onCreated,
  onSaved,
  onMerged,
  onUnmerged,
}: {
  open: boolean;
  initialName?: string;
  /** Дописаний тип (own_*), який правимо. Немає — створюємо новий. */
  ingredient?: IngredientDef | null;
  onClose: () => void;
  /** existing — людина обрала наявний тип замість нового: у каталог нічого не лягло. */
  onCreated?: (def: IngredientDef, meta: { existing: boolean }) => void;
  /** Правку збережено (для всіх або локально). */
  onSaved?: (def: IngredientDef) => void;
  /**
   * Тип обʼєднали з іншим. Каталог аркуш перечитує сам; екрану лишається
   * підтягнути свої рядки (комора, список) до переможця.
   */
  onMerged?: (loserKey: string, winnerKey: string) => void;
  /** Тип розʼєднали: каталог і знімок комори аркуш перечитує сам. */
  onUnmerged?: (loserKey: string) => void;
}) {
  const addCustomIngredient = useApp((s) => s.addCustomIngredient);
  const setCustomIngredients = useApp((s) => s.setCustomIngredients);
  const upsertCustomIngredientRow = useApp((s) => s.upsertCustomIngredientRow);
  const customIngredients = useApp((s) => s.customIngredients);
  const toast = useToast();
  const editing = ingredient;
  /** Спільна правка: з бекендом. Без нього тип і так лише на цьому пристрої. */
  const shared = !!editing && isSupabaseConfigured;
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * Обʼєднання з іншим типом (F8): undefined — закрито; null — ще не обрали з
   * яким; ключ — уже відомо (дублікат за назвою).
   */
  const [mergeWith, setMergeWith] = useState<string | null | undefined>(undefined);
  const [unmerging, setUnmerging] = useState<string | null>(null);

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
  /** Загальніший тип; null — самостійний. */
  const [parent, setParent] = useState<string | null>(null);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  // Екранний читач називає поле батька підписом і значенням, а не лише «Самостійний тип».
  const parentId = useId();
  /** Поля, які людина міняла сама, — батько їх не переписує. */
  const [touched, setTouched] = useState<ReadonlySet<Filled>>(new Set());
  /** Пропозицію «Це різновид …?» відхилили — не показуємо її знову для того самого типу. */
  const [declined, setDeclined] = useState<string | null>(null);

  const edit =
    <T,>(field: Filled, setter: (v: T) => void) =>
    (value: T) => {
      setter(value);
      setTouched((s) => (s.has(field) ? s : new Set(s).add(field)));
    };

  /*
   * Батько підказує все, що в різновиду зазвичай таке саме: значок, відділ,
   * міру, вагу штуки й КБЖВ. Лише підказує — і лише в поля, яких людина ще
   * не чіпала: КБЖВ, переписані з етикетки безлактозного, важливіші за молоко.
   *
   * Неторкані поля — просто відбиток батька, тож інший батько чи × міняють їх
   * цілком: прибраний батько не лишає по собі чужих калорій, а батько без
   * КБЖВ не стирає введеного.
   */
  const applyParent = (key: string | null) => {
    setParent(key);
    const def = key ? ing(key) : null;
    const nut = def?.nutrition;
    const fill = <T,>(field: Filled, setter: (v: T) => void, value: T) => {
      if (!touched.has(field)) setter(value);
    };
    fill("emoji", setEmoji, def?.emoji ?? "📦");
    fill("cat", setCat, def?.cat ?? "other");
    fill<Unit>("unit", setUnit, def?.defaultUnit ?? "g");
    fill("perPiece", setPerPiece, def?.gramsPerPiece != null ? String(def.gramsPerPiece) : "");
    fill("kcal", setKcal, nut ? String(nut.kcal) : "");
    fill("protein", setProtein, nut ? String(nut.protein) : "");
    fill("fat", setFat, nut ? String(nut.fat) : "");
    fill("carbs", setCarbs, nut ? String(nut.carbs) : "");
    if (nut) setMore(true);
  };

  /*
   * Правка починається з того, що тип уже має, і всі його поля вважаються
   * «торканими»: зміна батька в дописаному «Кефірі домашньому» не має мовчки
   * переписати його КБЖВ батьківськими — їх хтось уже вводив з етикетки.
   */
  const fillFrom = (def: IngredientDef) => {
    setLabel(def.label);
    setEmoji(def.emoji);
    setCat(def.cat);
    setUnit(def.defaultUnit ?? "g");
    setPerPiece(def.gramsPerPiece != null ? String(def.gramsPerPiece) : "");
    setKcal(def.nutrition ? String(def.nutrition.kcal) : "");
    setProtein(def.nutrition ? String(def.nutrition.protein) : "");
    setFat(def.nutrition ? String(def.nutrition.fat) : "");
    setCarbs(def.nutrition ? String(def.nutrition.carbs) : "");
    setMore(Boolean(def.nutrition));
    setParent(def.parent ?? null);
    setTouched(new Set<Filled>(["emoji", "cat", "unit", "perPiece", "kcal", "protein", "fat", "carbs"]));
  };

  /*
   * Аркуш відкривають із рядка пошуку — те, що вже набрали, і є назвою.
   * Решту скидаємо тут, а не після збереження: закрити можна й не зберігши,
   * а компонент лишається змонтованим. Інакше наступний продукт відкривався б
   * із чужим значком, категорією й калоріями від попередньої спроби.
   */
  useEffect(() => {
    if (!open) return;
    setParentPickerOpen(false);
    setDeclined(null);
    setProblem(null);
    setSaving(false);
    if (editing) {
      fillFrom(editing);
      return;
    }
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
    setParent(null);
    setTouched(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName, editing?.key]);

  /**
   * Такий тип уже є — за назвою чи синонімом: «Шампіньйони» — це «Печериці».
   * Краще обрати його, ніж завести другий з тим самим змістом.
   */
  const duplicate = useMemo(() => {
    if (!label.trim()) return null;
    const found = sameNameIngredient(label);
    // Власна назва типу, який правимо, — не дублікат.
    return found && found.key !== editing?.key ? found : null;
    // Каталог дописаних теж частина відповіді.
  }, [label, customIngredients, editing?.key]);

  /*
   * Кандидат у батьки з назви — лише пропозиція з кнопкою «Так», а не
   * заповнене поле. Заповнене зберігалось би непрочитаним: з телефона назву
   * вводять і одразу тиснуть «Додати», а хибний батько тихо рахує соєве молоко
   * молоком у кожному рецепті. Рахується наново з кожною літерою назви.
   */
  const suggestion = useMemo(() => {
    // У правці батька вже обирали свідомо — не підсовуємо здогадку поверх.
    if (editing || parent || duplicate || !label.trim()) return null;
    const guess = variantParentGuess(label);
    return guess && guess.key !== declined ? guess : null;
    // Каталог дописаних теж частина відповіді.
  }, [label, parent, duplicate, declined, customIngredients]);

  /*
   * Та сама межа, що в базі (custom_ingredients_guard): різновид різновиду
   * глибше шести рівнів не запишеться, і краще сказати це тут, ніж тостом
   * після того, як тип уже зʼявився в рецепті.
   */
  const tooDeep = parent != null && typeDepth(parent) + 1 > MAX_TYPE_DEPTH;

  const num = (v: string) => {
    const n = Number(v.replace(",", "."));
    return v.trim() && Number.isFinite(n) ? n : undefined;
  };

  /** Те, що людина бачить у формі, — однаково для нового типу й для правки. */
  const fields = (name: string) => ({
    label: name,
    emoji,
    cat,
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
  });

  /** Свіжий каталог дописаних з бази — після конфлікту чи повернення версії. */
  const reloadCatalog = async (): Promise<IngredientDef | null> => {
    const list = await fetchCustomIngredients().catch(() => null);
    if (!list) return null;
    setCustomIngredients(list);
    return editing ? (list.find((d) => d.key === editing.key) ?? null) : null;
  };

  /*
   * Типи, обʼєднані з цим. Переможеного типу вже ніде не видно (пікери його
   * ховають, рядки комори переїхали сюди), тож «Розʼєднати» мусить жити на
   * переможці — інакше обіцянка «обʼєднання можна скасувати» була б порожньою.
   */
  const mergedHere = editing ? customIngredients.filter((d) => d.mergedInto === editing.key) : [];

  const unmerge = async (key: string) => {
    setUnmerging(key);
    setProblem(null);
    try {
      await unmergeCustomIngredient(key);
      haptic(12);
      toast(`«${ing(key).label}» знову окремий тип`, "↩️");
      await reloadCatalog();
      // Картки, рядки комори й списку, що повернулись до типу, — зі знімка.
      void refreshFromServer().catch(() => {});
      onUnmerged?.(key);
    } catch (error) {
      setProblem(toCatalogError(error).message);
    } finally {
      setUnmerging(null);
    }
  };

  const save = async () => {
    const name = label.trim();
    if (!name || tooDeep || saving) return;

    if (!editing) {
      const def: IngredientDef = {
        key: ownKey(name, (k) => customIngredients.some((d) => d.key === k)),
        // Назва сама собі синонім: за нею продукт знайдеться в пошуку й у чеку.
        aliases: [name.toLowerCase()],
        ...fields(name),
        ...(parent ? { parent } : {}),
      };
      haptic(14);
      addCustomIngredient(def);
      onCreated?.(def, { existing: false });
      onClose();
      return;
    }

    /*
     * Стара назва лишається синонімом: рецепт чи чек, що знав тип як
     * «Кефір дом.», мусять і далі його знаходити.
     */
    const aliases = [...new Set([...(editing.aliases ?? []), name.toLowerCase()])];
    const { parent: _previousParent, ...kept } = editing;
    const next: IngredientDef = { ...kept, aliases, ...fields(name), ...(parent ? { parent } : {}) };

    if (!shared) {
      haptic(14);
      addCustomIngredient(next);
      onSaved?.(next);
      onClose();
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setProblem("Правку типу можна зберегти, коли є звʼязок.");
      return;
    }

    setSaving(true);
    setProblem(null);
    try {
      /*
       * Номер версії, з якою людина відкрила аркуш. Реєстр типів про версії
       * здебільшого не знає (каталог з бази їх не несе), тож тоді питаємо сам
       * рядок: правка, яку хтось зробив між відкриттям і збереженням, однаково
       * дасть чесний конфлікт на наступному збереженні, а не тихе затирання.
       */
      let version = (editing as IngredientDef & { version?: number }).version;
      if (version == null) {
        const res = await getSupabase()
          ?.from("custom_ingredients")
          .select("version")
          .eq("key", editing.key)
          .maybeSingle();
        version = Number((res?.data as { version?: number } | null)?.version) || 1;
      }
      const saved = await saveCustomIngredient(editing.key, version, next);
      haptic(14);
      // Відповідь бази — одразу в реєстр, з новою версією: наступна правка не питатиме її знову.
      upsertCustomIngredientRow(saved);
      toast("Тип оновлено для всіх", "✅");
      onSaved?.(saved);
      onClose();
    } catch (error) {
      const e = toCatalogError(error);
      if (e.code === "conflict") {
        const fresh = await reloadCatalog();
        if (fresh) fillFrom(fresh);
        setProblem("Тип щойно змінив хтось інший — ось свіжа версія. Внеси свою правку ще раз.");
      } else if (e.code === "invalid" && e.pgCode === "23514") {
        setProblem("Забагато рівнів різновидів — обери загальніший тип.");
      } else {
        setProblem(e.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={editing ? "Редагувати тип" : "Новий тип продукту"}
        footer={
          <Button full onClick={() => void save()} disabled={!label.trim() || tooDeep} loading={saving}>
            {shared ? "Зберегти для всіх" : editing ? "Зберегти" : "Додати в каталог"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          {shared && (
            <p className="rounded-2xl border border-brand/30 bg-brand/5 px-3.5 py-3 text-[12.5px] leading-snug">
              Дописані типи спільні: правку побачать усі. Кожна зміна пишеться в історію, і її можна
              повернути.{" "}
              <button
                onClick={() => setHistoryOpen(true)}
                className="inline-flex items-center gap-1 font-bold text-brand"
              >
                <History size={13} /> Історія змін
              </button>
              {" · "}
              <button onClick={() => setMergeWith(null)} className="font-bold text-brand">
                Це дублікат іншого типу…
              </button>
            </p>
          )}
          {problem && (
            <p className="rounded-2xl border border-berry/30 bg-berry/10 px-3.5 py-3 text-[12.5px] leading-snug text-berry">
              {problem}
            </p>
          )}
          {shared && mergedHere.length > 0 && (
            <div className="rounded-2xl border border-line bg-surface px-3.5 py-2.5">
              <p className="text-[12px] font-bold text-muted">Обʼєднано з цим типом</p>
              {mergedHere.map((d) => (
                <div key={d.key} className="mt-1.5 flex items-center gap-2.5">
                  <span className="text-lg">{d.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{d.label}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={unmerging === d.key}
                    disabled={unmerging !== null}
                    onClick={() => void unmerge(d.key)}
                  >
                    Розʼєднати
                  </Button>
                </div>
              ))}
            </div>
          )}
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
                // Правку відкривають, щоб поміняти що завгодно, а не лише назву.
                autoFocus={!editing}
                className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-3.5 text-[15px]"
              />
            </div>
            <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
              {FOOD_EMOJI.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    haptic(6);
                    edit("emoji", setEmoji)(e);
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

          {duplicate && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-brand/40 bg-brand/5 px-3.5 py-2.5">
              <span className="text-lg">{duplicate.emoji}</span>
              <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
                {editing
                  ? `Така назва вже є в типу «${duplicate.label}». Якщо це той самий тип — краще обʼєднати їх, ніж мати два.`
                  : `Вже є: «${duplicate.label}» — обрати його?`}
              </p>
              {!editing ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    haptic(10);
                    onCreated?.(duplicate, { existing: true });
                    onClose();
                  }}
                >
                  Обрати
                </Button>
              ) : (
                shared && (
                  <Button size="sm" variant="secondary" onClick={() => setMergeWith(duplicate.key)}>
                    Обʼєднати
                  </Button>
                )
              )}
            </div>
          )}

          <div>
            <Field>
              <span id={`${parentId}-label`}>Це різновид… (необовʼязково)</span>
            </Field>
            <div className="flex gap-2">
              <button
                onClick={() => setParentPickerOpen(true)}
                aria-labelledby={`${parentId}-label ${parentId}-value`}
                className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 text-left text-[15px]"
              >
                {parent ? (
                  <>
                    <span>{ing(parent).emoji}</span>
                    <span id={`${parentId}-value`} className="truncate">
                      {[parent, ...ancestors(parent)].map((k) => ing(k).label).join(" › ")}
                    </span>
                  </>
                ) : (
                  <span id={`${parentId}-value`} className="text-faint">
                    Самостійний тип
                  </span>
                )}
              </button>
              {parent && (
                <button
                  onClick={() => {
                    // Не лише поле: неторкані значок, міра й КБЖВ були відбитком батька.
                    applyParent(null);
                    setDeclined(parent);
                  }}
                  aria-label="Без батьківського типу"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2"
                >
                  <X size={16} className="text-muted" />
                </button>
              )}
            </div>
            {suggestion && (
              <div className="mt-2 flex items-center gap-2.5 rounded-2xl border border-line bg-surface-2 px-3.5 py-2">
                <span className="text-lg">{suggestion.emoji}</span>
                <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
                  Це різновид «{suggestion.label}»?
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    haptic(10);
                    applyParent(suggestion.key);
                  }}
                >
                  Так
                </Button>
                <button
                  onClick={() => setDeclined(suggestion.key)}
                  aria-label={`Ні, не різновид «${suggestion.label}»`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
                >
                  <X size={15} className="text-muted" />
                </button>
              </div>
            )}
            <p className={`mt-1.5 text-[11px] leading-snug ${tooDeep ? "text-berry" : "text-faint"}`}>
              {tooDeep
                ? "Забагато рівнів різновидів — обери загальніший тип."
                : parent
                  ? `Рецепти, яким треба «${ing(parent).label}», рахуватимуть і цей тип. Навпаки — ні.`
                  : "Скажімо, «Кефір безлактозний» — різновид «Кефір»: тоді він підійде кожному рецепту з кефіром."}
            </p>
          </div>

          <div>
            <Field>Де його шукати</Field>
            <div className="flex flex-wrap gap-2">
              {CAT_ORDER.map((c) => (
                <Chip key={c} active={cat === c} onClick={() => edit("cat", setCat)(c)}>
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
              onChange={(e) => edit("unit", setUnit)(e.target.value as Unit)}
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
                  onChange={(e) => edit("perPiece", setPerPiece)(e.target.value.replace(/[^\d.,]/g, ""))}
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
                <NumField value={kcal} onChange={edit("kcal", setKcal)} label="ккал" />
                <NumField value={protein} onChange={edit("protein", setProtein)} label="білки" />
                <NumField value={fat} onChange={edit("fat", setFat)} label="жири" />
                <NumField value={carbs} onChange={edit("carbs", setCarbs)} label="вугл." />
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
      {/* Поруч, а не всередині: аркуші складаються в стос (Sheet рахує глибину). */}
      <IngredientPicker
        open={parentPickerOpen}
        onClose={() => setParentPickerOpen(false)}
        title={label.trim() ? `Різновидом чого є «${label.trim()}»?` : "Різновидом чого є новий тип?"}
        placeholder="Кефір, молоко, сир…"
        pickIcon={false}
        editOwn={false}
        // Тип не може бути різновидом себе чи власного різновиду — база однаково не пустить цикл.
        exclude={editing ? [editing.key, ...descendants(editing.key)] : undefined}
        onPick={(def) => applyParent(def.key)}
      />
      {shared && editing && (
        <MergeSheet
          mode="types"
          open={mergeWith !== undefined}
          onClose={() => setMergeWith(undefined)}
          typeKey={editing.key}
          otherTypeKey={mergeWith ?? null}
          onMerged={(loser, winner) => {
            // Переможеного вже немає як окремого типу — правити нема чого.
            void reloadCatalog();
            onMerged?.(loser, winner);
            onClose();
          }}
        />
      )}
      {shared && editing && (
        <HistorySheet
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          table="custom_ingredients"
          rowId={editing.key}
          title={`Історія: «${editing.label}»`}
          onRestored={() => {
            // Повернена версія — теж правка: перечитуємо тип і показуємо саме її.
            void reloadCatalog().then((fresh) => {
              if (fresh) fillFrom(fresh);
            });
          }}
        />
      )}
    </>
  );
}

/**
 * Єдиний аркуш «Редагувати тип» для EditTypeButton звідусіль (див.
 * src/lib/type-editor.ts). Живе в Providers, поза будь-яким іншим аркушем.
 * Тип, якого реєстр (уже) не знає, не відкриваємо: правити нема чого.
 */
export function TypeEditorHost() {
  const [key, setKey] = useState<string | null>(null);
  const customIngredients = useApp((s) => s.customIngredients);
  useEffect(() => subscribeTypeEditor(setKey), []);
  const def = useMemo(
    () => (key && isOwnKey(key) && knownIngredient(key) ? ing(key) : null),
    // customIngredients — щоб правка, яка щойно приїхала, відкрилась свіжою.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, customIngredients],
  );
  return (
    <NewIngredientSheet
      open={def !== null}
      ingredient={def}
      onClose={() => setKey(null)}
      // Рядки комори й списку база вже переписала на переможця — підтягуємо знімок.
      onMerged={() => void refreshFromServer().catch(() => {})}
    />
  );
}

/** Поля, які батько заповнює, поки людина їх не чіпала. */
type Filled = "emoji" | "cat" | "unit" | "perPiece" | "kcal" | "protein" | "fat" | "carbs";

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
