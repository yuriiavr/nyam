/**
 * Хто прийшов на платний маршрут і чи не забагато разів.
 *
 * Те саме, що в маршруті фото чека (src/app/api/receipt/photo/route.ts), винесене,
 * щоб маршрути щоденника не повторювали його втретє: сесію перевіряємо там,
 * де її видали, — у Supabase, без своїх ключів.
 */

/** id користувача за токеном сесії з заголовка Authorization або null. */
export async function userFromRequest(request: Request, timeoutMs = 8000): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return null;

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string };
    return user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Лічильник на людину в памʼяті інстанса. Заслін від зацикленого клієнта й
 * випадкових повторів, а не від рішучого зловмисника: інстансів на Vercel
 * багато. Справжня стеля — на самому ключі Gemini.
 *
 * Рахуємо лише пропущені запити: відбиті не відсувають кінця блокування.
 */
export function rateLimiter(limit: number, windowMs: number): (who: string) => boolean {
  const hits = new Map<string, number[]>();
  return (who) => {
    const now = Date.now();
    if (hits.size > 5_000) hits.clear();
    const recent = (hits.get(who) ?? []).filter((t) => now - t < windowMs);
    hits.set(who, recent);
    if (recent.length >= limit) return false;
    recent.push(now);
    return true;
  };
}
