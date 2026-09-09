import type { ReactElement } from "react";

/**
 * Іконка застосунку, намальована примітивами — жодних зовнішніх шрифтів
 * та емодзі, тож рендериться однаково й офлайн.
 *
 * `maskable` додає безпечні поля (~10%), щоб Android не обрізав малюнок.
 */
export function iconArt(size: number, maskable = false): ReactElement {
  const pad = maskable ? size * 0.18 : size * 0.1;
  const inner = size - pad * 2;

  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #ff6b35 0%, #ffb020 100%)",
        borderRadius: maskable ? 0 : size * 0.22,
      }}
    >
      <div
        style={{
          width: inner,
          height: inner,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Пара */}
        <div
          style={{
            display: "flex",
            gap: inner * 0.09,
            marginBottom: inner * 0.09,
          }}
        >
          {[0.16, 0.22, 0.16].map((h, i) => (
            <div
              key={i}
              style={{
                width: inner * 0.055,
                height: inner * h,
                borderRadius: inner,
                background: "rgba(26, 13, 5, 0.55)",
              }}
            />
          ))}
        </div>

        {/* Миска */}
        <div
          style={{
            width: inner * 0.82,
            height: inner * 0.41,
            background: "#1a0d05",
            borderBottomLeftRadius: inner,
            borderBottomRightRadius: inner,
            borderTopLeftRadius: inner * 0.06,
            borderTopRightRadius: inner * 0.06,
            display: "flex",
          }}
        />

        {/* Підставка */}
        <div
          style={{
            width: inner * 0.44,
            height: inner * 0.085,
            marginTop: inner * 0.06,
            borderRadius: inner,
            background: "rgba(26, 13, 5, 0.75)",
            display: "flex",
          }}
        />
      </div>
    </div>
  );
}
