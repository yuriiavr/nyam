"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { signInWithGoogle } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { haptic } from "@/lib/utils";

/**
 * Єдиний вхід у застосунок — через Google.
 *
 * Пошта з паролем свідомо не підтримується: це ще один пароль, який треба
 * вигадати й забути, плюс листи підтвердження та відновлення, які регулярно
 * летять у спам. Google-акаунт є практично в кожного, у кого є телефон.
 *
 * Екран показується і як окрема сторінка /auth, і замість вмісту застосунку,
 * поки користувач не увійшов — див. AuthGate.
 */
export function AuthScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const google = async () => {
    haptic(12);
    setBusy(true);
    setError("");
    const result = await signInWithGoogle();
    if (!result.ok) {
      setBusy(false);
      setError(result.message ?? "Не вдалося.");
    }
    // Успіх = редірект на Google, стан лишаємо в busy.
  };

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-[22px] bg-surface-2 text-3xl">
          🔌
        </div>
        <h1 className="mt-4 font-display text-xl font-extrabold">Бекенд не налаштовано</h1>
        <p className="mt-2 max-w-[330px] text-[13.5px] leading-relaxed text-muted">
          Вхід працює через Supabase. Додай у{" "}
          <code className="rounded bg-surface-2 px-1">.env.local</code> ключі{" "}
          <code className="rounded bg-surface-2 px-1">NEXT_PUBLIC_SUPABASE_URL</code> і{" "}
          <code className="rounded bg-surface-2 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> —
          і перезапусти застосунок.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 pb-10">
      <div className="mx-auto w-full max-w-[360px] text-center">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="mx-auto grid h-20 w-20 place-items-center rounded-[28px] brand-gradient text-4xl shadow-[var(--shadow-pop)]"
        >
          🍲
        </motion.div>

        <h1 className="mt-5 font-display text-[26px] font-extrabold leading-tight">Ням</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Рулетка страв, підбір за вмістом холодильника і рецепти інших кухарів.
          Увійди, щоб почати.
        </p>

        <div className="mt-8">
          <GoogleButton loading={busy} onClick={google} />
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 rounded-2xl border border-berry/30 bg-berry/10 px-3.5 py-2.5 text-[13px] font-semibold text-berry"
          >
            {error}
          </motion.p>
        )}

        <p className="mt-6 text-[11.5px] leading-relaxed text-faint">
          Продовжуючи, ти погоджуєшся з{" "}
          <a href="/terms" className="font-semibold underline">
            умовами
          </a>{" "}
          та{" "}
          <a href="/privacy" className="font-semibold underline">
            політикою приватності
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/** Офіційна кольорова «G» — Google вимагає саме її, не перемальовану. */
function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0 0 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18a13.2 13.2 0 0 1 0-8.36v-5.7H4.34a22 22 0 0 0 0 19.76l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 9.5c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 2.92 29.93 1 24 1 15.4 1 7.96 5.93 4.34 13.12l7.35 5.7C13.42 13.62 18.27 9.5 24 9.5z"
      />
    </svg>
  );
}

function GoogleButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={loading}
      className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-line bg-surface text-[15px] font-bold disabled:opacity-50"
    >
      {loading ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
      ) : (
        <GoogleMark size={20} />
      )}
      {loading ? "Переходимо до Google…" : "Продовжити з Google"}
    </motion.button>
  );
}
