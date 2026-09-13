/**
 * Яку форму даних знає код, що зараз задеплоєно.
 *
 * Питає застосунок, відкритий у браузері: якщо тут номер вищий за його власний,
 * він сам — старий код із кешу чи з вкладки, якої не закривали, і має
 * перезапуститись раніше, ніж щось запише (див. src/lib/schema-version.ts).
 *
 * Жодного кешу — ні в браузері, ні на CDN. Весь сенс відповіді в тому, що
 * вона свіжа: закешований старий номер і є та сама проблема, від якої
 * перевірка береже. Service worker цей шлях теж не чіпає — це не статика й
 * не навігація (див. isAsset у public/sw.js).
 */

import { CLIENT_SCHEMA } from "@/lib/schema-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    { schema: CLIENT_SCHEMA },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
