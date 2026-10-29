"use client";

import { useMemo, useState } from "react";
import { ProductPicker } from "@/components/ProductPicker";
import { slotAt } from "@/lib/diary";
import { useApp } from "@/lib/store";
import type { FoodSource, MealSlot } from "@/lib/types";
import { dateKey } from "@/lib/utils";
import { AddFoodSheet } from "./AddFoodSheet";
import { AmountSheet, type FoodTarget } from "./AmountSheet";
import { DishSheet } from "./DishSheet";
import { FoodScanner } from "./FoodScanner";
import { SplitSheet, type SplitRequest } from "./SplitSheet";

type Step =
  | { kind: "idle" }
  | { kind: "add" }
  | { kind: "scan" }
  | { kind: "search" }
  | { kind: "describe"; text?: string }
  | { kind: "amount"; target: FoodTarget; source: FoodSource }
  | { kind: "split"; request: SplitRequest };

/**
 * Усі шляхи «записати зʼїдене» одним ланцюжком аркушів — для щоденника,
 * сторінки рецепта й бібліотеки товарів.
 *
 * Відкритий завжди один аркуш: наступний крок замінює попередній, а не
 * лягає зверху — так «Назад» на телефоні й свайп униз поводяться очікувано.
 */
export function useFoodFlows({ day = dateKey(), forUser }: { day?: string; forUser?: string } = {}) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [slot, setSlot] = useState<MealSlot>(() => slotAt());
  const products = useApp((s) => s.products);
  const foodLog = useApp((s) => s.foodLog);

  /*
   * Закриваємо лише свій крок: пікер спершу віддає вибір, а потім сам себе
   * закриває — безумовне «idle» стерло б щойно відкритий наступний аркуш.
   */
  const closeIf = (kind: Step["kind"]) => () => setStep((s) => (s.kind === kind ? { kind: "idle" } : s));

  const recent = useMemo(() => {
    const ids = [...new Set(foodLog.filter((e) => e.productId).map((e) => e.productId as string))];
    return ids.flatMap((id) => products[id] ?? []).slice(0, 12);
  }, [foodLog, products]);

  const api = {
    /** «＋» щоденника: усі способи додати. */
    add: (at?: MealSlot) => {
      setSlot(at ?? slotAt());
      setStep({ kind: "add" });
    },
    scan: (at?: MealSlot) => {
      setSlot(at ?? slotAt());
      setStep({ kind: "scan" });
    },
    describe: (at?: MealSlot, text?: string) => {
      setSlot(at ?? slotAt());
      setStep({ kind: "describe", text });
    },
    amount: (target: FoodTarget, source: FoodSource = "search", at?: MealSlot) => {
      setSlot(at ?? slotAt());
      setStep({ kind: "amount", target, source });
    },
    split: (request: SplitRequest) => setStep({ kind: "split", request }),
  };

  const ui = (
    <>
      <AddFoodSheet
        open={step.kind === "add"}
        onClose={closeIf("add")}
        title={`Додати: ${slotTitle(slot)}`}
        onScan={() => setStep({ kind: "scan" })}
        onSearch={() => setStep({ kind: "search" })}
        onDescribe={() => setStep({ kind: "describe" })}
        onPick={(target) => setStep({ kind: "amount", target, source: "search" })}
        onLeftover={(meal) =>
          setStep({ kind: "split", request: { meal, isNew: false, source: "leftover", slot, day } })
        }
      />

      <FoodScanner
        open={step.kind === "scan"}
        onClose={closeIf("scan")}
        saveLabel="Зберегти й записати"
        onProduct={(product) => setStep({ kind: "amount", target: { kind: "product", product }, source: "scan" })}
      />

      <ProductPicker
        open={step.kind === "search"}
        onClose={closeIf("search")}
        title="Що зʼїв?"
        recentProducts={recent}
        cachedProducts={Object.values(products)}
        saveLabel="Зберегти й записати"
        onPickProduct={(product) => setStep({ kind: "amount", target: { kind: "product", product }, source: "search" })}
        onPickType={(def, typed) =>
          setStep({
            kind: "amount",
            target: { kind: "type", typeKey: def.key, label: typed?.name || def.label },
            source: "search",
          })
        }
        onProductSaved={(p) => useApp.getState().upsertProducts([p])}
      />

      <DishSheet
        open={step.kind === "describe"}
        onClose={closeIf("describe")}
        slot={slot}
        day={day}
        initialText={step.kind === "describe" ? step.text : undefined}
        onNext={(request) => setStep({ kind: "split", request })}
      />

      <AmountSheet
        open={step.kind === "amount"}
        onClose={closeIf("amount")}
        target={step.kind === "amount" ? step.target : null}
        source={step.kind === "amount" ? step.source : "search"}
        slot={slot}
        day={day}
        forUser={forUser}
      />

      <SplitSheet request={step.kind === "split" ? step.request : null} onClose={closeIf("split")} />
    </>
  );

  return { ...api, ui };
}

function slotTitle(slot: MealSlot): string {
  return { breakfast: "сніданок", lunch: "обід", dinner: "вечеря", snack: "перекус" }[slot];
}
