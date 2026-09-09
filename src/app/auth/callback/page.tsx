"use client";

import { motion } from "framer-motion";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Сюди Google повертає користувача після згоди.
 *
 * Обмін коду на сесію робить сам supabase-js — у клієнта увімкнено
 * detectSessionInUrl. Нам лишається дочекатись сесії й піти далі.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Провайдер міг повернути відмову — вона приїжджає і в query, і в hash.
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const providerError =
      query.get("error_description") ??
      query.get("error") ??
      hash.get("error_description") ??
      hash.get("error");

    if (providerError) {
      setError(
        /access_denied|cancel/i.test(providerError)
          ? "Вхід скасовано."
          : decodeURIComponent(providerError),
      );
      return;
    }

    const sb = getSupabase();
    if (!sb) {
      setError("Бекенд не налаштовано.");
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      router.replace("/me");
    };

    sb.auth.getSession().then(({ data }) => {
      if (data.session) finish();
    });

    const { data: listener } = sb.auth.onAuthStateChange((_event, session) => {
      if (session) finish();
    });

    // Якщо за 12 секунд сесії немає — щось пішло не так.
    const timer = setTimeout(() => {
      if (!done) setError("Не вдалося завершити вхід. Спробуй ще раз.");
    }, 12_000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [router]);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-[22px] bg-berry/15">
          <TriangleAlert size={30} className="text-berry" />
        </div>
        <h1 className="mt-4 font-display text-xl font-extrabold">Вхід не вдався</h1>
        <p className="mt-2 max-w-[320px] text-[13.5px] leading-relaxed text-muted">{error}</p>
        <Link href="/auth" className="mt-6 w-full max-w-xs">
          <Button full>Спробувати ще раз</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <motion.div
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 1.6, repeat: Infinity }}
        className="grid h-20 w-20 place-items-center rounded-[28px] brand-gradient text-4xl shadow-[var(--shadow-pop)]"
      >
        🍲
      </motion.div>
      <div className="mt-6 flex items-center gap-2.5">
        <Spinner />
        <p className="text-[14px] font-semibold text-muted">Заходимо на кухню…</p>
      </div>
    </div>
  );
}
