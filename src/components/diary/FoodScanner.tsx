"use client";

import { useRef, useState } from "react";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { ProductEditorSheet } from "@/components/ProductEditorSheet";
import { Sheet, Spinner, useToast } from "@/components/ui";
import { catalogDeps, teachAndSettle } from "@/components/pantry/catalog";
import { normalizeEan } from "@/lib/ean";
import type { Product, ProductDraft } from "@/lib/product-types";
import { resolveBarcode, type BarcodeResult } from "@/lib/resolve";
import { useApp } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { teachPlan } from "@/lib/teach";

/**
 * Сканер для щоденника й бібліотеки: штрихкод → товар.
 *
 * Знайомий товар — одразу далі. Незнайомий — редактор картки, заповнений з
 * Open Food Facts, якщо там є; збережена картка вчить штрихкод, і наступного
 * разу цей батончик впізнається з першого кадру — у всіх.
 */
export function FoodScanner({
  open,
  onClose,
  onProduct,
  saveLabel = "Зберегти",
}: {
  open: boolean;
  onClose: () => void;
  onProduct: (product: Product) => void;
  saveLabel?: string;
}) {
  const toast = useToast();
  const upsertProducts = useApp((s) => s.upsertProducts);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const ctx = useRef<{ ean: string | null; res: BarcodeResult } | null>(null);
  const seq = useRef(0);

  const detect = async (code: string) => {
    onClose();
    setLoading(true);
    const mine = ++seq.current;
    let res: BarcodeResult;
    try {
      res = await resolveBarcode(code, catalogDeps());
    } catch {
      res = { via: "none", ean: normalizeEan(code), error: "other" };
    }
    if (mine !== seq.current) return;
    setLoading(false);
    ctx.current = { ean: res.ean, res };

    if (res.product) {
      upsertProducts([res.product], res.hit ? [res.hit] : undefined);
      onProduct(res.product);
      return;
    }
    if (!isSupabaseConfigured) {
      toast("Каталог товарів доступний лише з акаунтом", "🔒");
      return;
    }
    if (res.error) {
      toast("Немає звʼязку з каталогом — знайди товар пошуком", "📡");
      return;
    }
    setDraft(
      res.draft ?? {
        typeKey: res.typeKey ?? "",
        name: "",
        guessed: [],
        provenance: res.ean ? { from: "scan", ean: res.ean, known: "none" } : { from: "manual" },
      },
    );
  };

  const saved = (product: Product) => {
    upsertProducts([product]);
    setDraft(null);
    onProduct(product);
    const c = ctx.current;
    if (!c?.ean) return;
    void teachAndSettle(
      teachPlan({ ean: c.ean }, c.res, { kind: "picked-product", productId: product.id }, "scan"),
    ).then((r) => {
      if (!r.ok) toast("Товар збережено, але штрихкод запамʼятати не вдалося", "⚠️");
    });
  };

  return (
    <>
      <BarcodeScanner open={open} onClose={onClose} onDetect={(code) => void detect(code)} />

      <Sheet open={loading} onClose={() => {
        seq.current += 1;
        setLoading(false);
      }}>
        <div className="flex items-center justify-center gap-3 py-8 text-[14px] font-semibold text-muted">
          <Spinner />
          Шукаю товар…
        </div>
      </Sheet>

      <ProductEditorSheet
        open={!!draft}
        onClose={() => setDraft(null)}
        draft={draft}
        title="Новий товар"
        saveLabel={saveLabel}
        onSaved={saved}
        onProductChanged={(p) => upsertProducts([p])}
      />
    </>
  );
}
