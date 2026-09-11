import type { Metadata, Viewport } from "next";
import { Manrope, Unbounded } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-manrope",
  display: "swap",
});

const unbounded = Unbounded({
  subsets: ["latin", "cyrillic"],
  variable: "--font-unbounded",
  weight: ["600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Ням — що поїсти сьогодні",
    template: "%s · Ням",
  },
  description:
    "Соціальна кулінарна книга з рулеткою страв, підбором за холодильником і сканером штрихкодів. Більше не треба думати, що готувати.",
  manifest: "/manifest.webmanifest",
  applicationName: "Ням",
  appleWebApp: {
    capable: true,
    title: "Ням",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: "Ням — що поїсти сьогодні",
    description:
      "Рулетка страв, підбір за вмістом холодильника, рецепти інших кухарів і сканер штрихкодів.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  /*
   * Один колір, без media-запитів. Тема в застосунку своя й лежить у
   * налаштуваннях, а не береться із системної, тож список тут давав браузеру
   * вибір, якого не мало бути: у темному застосунку на світлому телефоні
   * смуга вгорі малювалась кремовою. Далі колір міняє Providers разом з темою.
   */
  themeColor: "#0d0a09",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" data-theme="dark" className={`${manrope.variable} ${unbounded.variable}`}>
      <body>
        <Providers>
          {/* Фонове світіння, щоб десктопна версія не була порожньою */}
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 -z-10 opacity-60"
            style={{
              backgroundImage:
                "radial-gradient(60rem 40rem at 50% -10%, color-mix(in oklab, var(--brand) 16%, transparent), transparent 70%)",
            }}
          />
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
