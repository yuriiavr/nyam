"use client";

import { useEffect, useState } from "react";
import { scopeLabel } from "@/components/ProductSheet";
import { Button, Sheet, useToast } from "@/components/ui";
import { ing, knownIngredient } from "@/data/ingredients";
import type { Product } from "@/lib/product-types";
import { useApp } from "@/lib/store";
import { fetchProductsByIds, reassignIdentifier, toCatalogError } from "@/lib/supabase/products-api";
import { haptic } from "@/lib/utils";
import { mergeableTypes, type ConflictPrompt } from "./catalog";

/*
 * «Цей код зараз означає «Q»» (B9).
 *
 * Людина щойно сказала, що штрихкод чи назва з чека — це її товар, а база
 * вже знає інше. Мовчки переписати чуже не можна (наступний чек у всіх
 * прийшов би з її вибором), мовчки проігнорувати — теж: вона вважатиме, що
 * навчила. Тож питаємо рівно раз, і обидві відповіді чесні:
 * - «Лише для мене зараз» — нічого не пишемо, рядок комори лишається з її товаром;
 * - «Виправити для всіх» — reassign_identifier з версією, яку бачили (історія є).
 * Коли там інша картка того самого типу — це, найпевніше, дублікат: тоді
 * третя кнопка веде в обʼєднання (B10).
 */
export function ConflictSheet({
  prompt,
  onClose,
  onMerge,
}: {
  prompt: ConflictPrompt | null;
  onClose: () => void;
  /** «Це той самий товар — обʼєднати»: відкрити MergeSheet для цих двох карток. */
  onMerge?: (product: Product, other: Product) => void;
}) {
  const toast = useToast();
  const products = useApp((s) => s.products);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = prompt?.result.target;
  const existingId = target && "productId" in target ? target.productId : null;
  // З кешу — одразу, без блимання «іншу картку»; чого там немає, дочитує ефект нижче.
  const existing: Product | null = existingId ? (products[existingId] ?? null) : null;

  // Назву чужої цілі дочитуємо, якщо її ще немає в кеші: «означає «картку товару»» нічого не каже.
  useEffect(() => {
    setError(null);
    setBusy(false);
    if (!existingId || useApp.getState().products[existingId]) return;
    fetchProductsByIds([existingId])
      .then((list) => {
        // У кеш — і аркуш перемалюється з назвою сам.
        if (list.length) useApp.getState().upsertProducts(list);
      })
      .catch(() => {});
  }, [existingId, prompt]);

  if (!prompt) {
    return (
      <Sheet open={false} onClose={onClose}>
        {null}
      </Sheet>
    );
  }

  const mine = products[prompt.productId];
  const meaning = existingId
    ? existing
      ? `«${existing.name}»`
      : "іншу картку товару"
    : target && "typeKey" in target && knownIngredient(target.typeKey)
      ? `«${ing(target.typeKey).label}»`
      : "інше";
  const title =
    prompt.sent.kind === "ean"
      ? `Цей штрихкод зараз означає ${meaning}`
      : `«${prompt.sent.raw}» з чека зараз означає ${meaning}`;
  const canMerge = !!onMerge && !!mine && !!existing && existing.id !== mine.id && mergeableTypes(mine.typeKey, existing.typeKey);

  const fixForAll = async () => {
    const { identifierId, version } = prompt.result;
    if (!identifierId || version == null) return;
    setBusy(true);
    setError(null);
    try {
      const moved = await reassignIdentifier(identifierId, version, { productId: prompt.productId });
      /*
       * Виправлений штрихкод — одразу в офлайн-індекс: наступний скан цього коду
       * без звʼязку має впізнати вже її товар, а не той, що був до виправлення.
       */
      if (moved.kind === "ean") {
        useApp.getState().upsertProducts(mine ? [mine] : [], [
          { kind: "ean", raw: moved.raw, value: moved.value, target: { productId: prompt.productId } },
        ]);
      }
      haptic(14);
      toast(mine ? `Тепер це «${mine.name}» для всіх` : "Виправили для всіх", "✅");
      onClose();
    } catch (e) {
      const err = toCatalogError(e);
      setError(
        err.code === "conflict"
          ? "Привʼязку щойно змінив хтось інший. Відскануй чи додай ще раз — побачиш свіжу."
          : err.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
              Лише для мене зараз
            </Button>
            <Button className="flex-1" onClick={() => void fixForAll()} loading={busy}>
              Виправити для всіх
            </Button>
          </div>
          {canMerge && (
            <Button
              full
              variant="ghost"
              onClick={() => {
                onMerge!(mine!, existing!);
                onClose();
              }}
            >
              Це той самий товар — обʼєднати
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-2 pb-2">
        <p className="text-[13px] leading-relaxed text-muted">
          {/* Назва з каси, навчена для магазину, — кажемо, для якого: у різних
              мережах та сама стрічка буває різними товарами. */}
          {prompt.result.scope && prompt.sent.kind === "receipt_name"
            ? scopeLabel(prompt.result.scope).startsWith("в ")
              ? "Його привʼязав хтось раніше — для одного магазину."
              : `Його привʼязав хтось раніше — для «${scopeLabel(prompt.result.scope)}».`
            : "Його привʼязав хтось раніше."}
          {mine && ` У твоїй коморі він уже лежить як «${mine.name}» — це не зміниться.`}
        </p>
        {error && <p className="text-[12.5px] leading-snug text-berry">{error}</p>}
      </div>
    </Sheet>
  );
}
