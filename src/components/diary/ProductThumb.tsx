"use client";

import { useState } from "react";
import { ing } from "@/data/ingredients";
import type { Product } from "@/lib/product-types";
import { cn } from "@/lib/utils";

/**
 * Обличчя товару: фото з картки, а без нього — емодзі типу на мʼякому тлі.
 * Битий лінк (OFF часом прибирає фото) тихо стає емодзі, а не сірим квадратом.
 */
export function ProductThumb({
  product,
  typeKey,
  className,
  emojiClass = "text-[34px]",
}: {
  product?: Pick<Product, "image" | "typeKey" | "name"> | null;
  typeKey?: string;
  className?: string;
  emojiClass?: string;
}) {
  const [broken, setBroken] = useState(false);
  const key = product?.typeKey ?? typeKey ?? "";
  const image = !broken ? product?.image : undefined;
  return (
    <div className={cn("grid place-items-center overflow-hidden bg-surface-2", className)}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-contain p-2 mix-blend-multiply dark:mix-blend-normal"
        />
      ) : (
        <span className={cn("leading-none", emojiClass)}>{ing(key).emoji}</span>
      )}
    </div>
  );
}
