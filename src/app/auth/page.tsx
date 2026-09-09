"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AtSign, KeyRound, MailCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Button, Card, Segmented, useToast } from "@/components/ui";
import {
  fetchEnabledProviders,
  resetPassword,
  signIn,
  signInWithGoogle,
  signUp,
} from "@/lib/session";
import { useApp } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { haptic } from "@/lib/utils";

type Mode = "in" | "up";

export default function AuthPage() {
  const router = useRouter();
  const toast = useToast();
  const account = useApp((s) => s.account);

  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentConfirmation, setSentConfirmation] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState<boolean | null>(null);

  // Щойно зʼявилась сесія — вертаємось у застосунок.
  useEffect(() => {
    if (account) router.replace("/me");
  }, [account, router]);

  // Кнопку Google показуємо, лише якщо провайдер справді ввімкнено в Supabase.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let alive = true;
    fetchEnabledProviders().then((providers) => {
      if (!alive) return;
      // Не змогли перевірити (офлайн, CORS) — краще показати кнопку:
      // якщо провайдер вимкнено, текст помилки це пояснить.
      setGoogleEnabled(providers === null ? true : Boolean(providers.google));
    });
    return () => {
      alive = false;
    };
  }, []);

  const google = async () => {
    haptic(12);
    setGoogleBusy(true);
    setError("");
    const result = await signInWithGoogle();
    if (!result.ok) {
      setGoogleBusy(false);
      setError(result.message ?? "Не вдалося.");
    }
    // Успіх = редірект на Google, стан лишаємо в busy.
  };

  const valid = email.includes("@") && password.length >= 6 && (mode === "in" || name.trim());

  const submit = async () => {
    if (!valid || busy) return;
    haptic(12);
    setBusy(true);
    setError("");

    const result =
      mode === "in" ? await signIn(email, password) : await signUp(email, password, name);

    setBusy(false);

    if (!result.ok) {
      setError(result.message ?? "Не вдалося.");
      haptic([40, 60, 40]);
      return;
    }
    if (result.needsConfirmation) {
      setSentConfirmation(true);
      return;
    }
    toast(mode === "in" ? "З поверненням!" : "Вітаємо на кухні!", "🎉");
  };

  const forgot = async () => {
    if (!email.includes("@")) {
      setError("Спершу введи пошту.");
      return;
    }
    setBusy(true);
    const result = await resetPassword(email);
    setBusy(false);
    toast(result.message ?? "Перевір пошту", "📬");
  };

  if (!isSupabaseConfigured) {
    return (
      <div>
        <TopBar title="Акаунт" />
        <div className="px-4 pt-6">
          <Card className="p-5">
            <h2 className="font-display text-[17px] font-bold">Бекенд не налаштовано</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              Застосунок працює в локальному режимі: рецепти й комора зберігаються тільки на
              цьому пристрої. Щоб зʼявились акаунти та спільна стрічка, додай у{" "}
              <code className="rounded bg-surface-2 px-1">.env.local</code> ключі{" "}
              <code className="rounded bg-surface-2 px-1">NEXT_PUBLIC_SUPABASE_URL</code> і{" "}
              <code className="rounded bg-surface-2 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  if (sentConfirmation) {
    return (
      <div>
        <TopBar title="Майже готово" />
        <div className="flex flex-col items-center px-8 pt-12 text-center">
          <div className="pop-in grid h-20 w-20 place-items-center rounded-[28px] bg-mint/15">
            <MailCheck size={34} className="text-mint" />
          </div>
          <h2 className="mt-5 font-display text-xl font-extrabold">Перевір пошту</h2>
          <p className="mt-2 max-w-[320px] text-[13.5px] leading-relaxed text-muted">
            Ми надіслали лист на <span className="font-bold text-ink">{email}</span>. Перейди за
            посиланням, щоб підтвердити акаунт — і повертайся сюди.
          </p>
          <Button
            variant="secondary"
            className="mt-6 w-full max-w-xs"
            onClick={() => {
              setSentConfirmation(false);
              setMode("in");
            }}
          >
            Я підтвердив — увійти
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <TopBar title={mode === "in" ? "Вхід" : "Реєстрація"} />

      <div className="px-4 pt-5">
        <div className="mb-5 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] brand-gradient text-3xl shadow-[var(--shadow-pop)]">
            🍲
          </div>
          <h1 className="mt-3 font-display text-[22px] font-extrabold leading-tight">
            {mode === "in" ? "З поверненням" : "Приєднуйся до кухні"}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            Акаунт синхронізує твої рецепти між пристроями і відкриває стрічку інших кухарів.
          </p>
        </div>

        {googleEnabled && (
          <>
            <GoogleButton loading={googleBusy} onClick={google} />
            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11.5px] font-semibold text-faint">або поштою</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        <Segmented
          value={mode}
          onChange={(v) => {
            setMode(v);
            setError("");
          }}
          options={[
            { value: "in", label: "Увійти" },
            { value: "up", label: "Створити акаунт" },
          ]}
        />

        <div className="mt-5 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {mode === "up" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <Field icon={<UserRound size={17} />}>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Як тебе звати"
                    autoComplete="name"
                    className="h-full flex-1 text-[15px]"
                  />
                </Field>
              </motion.div>
            )}
          </AnimatePresence>

          <Field icon={<AtSign size={17} />}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Пошта"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              className="h-full flex-1 text-[15px]"
            />
          </Field>

          <Field icon={<KeyRound size={17} />}>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Пароль (від 6 символів)"
              type="password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              className="h-full flex-1 text-[15px]"
            />
          </Field>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-berry/30 bg-berry/10 px-3.5 py-2.5 text-[13px] font-semibold text-berry"
            >
              {error}
            </motion.p>
          )}

          <Button full size="lg" disabled={!valid} loading={busy} onClick={submit}>
            {mode === "in" ? "Увійти" : "Створити акаунт"}
          </Button>

          {mode === "in" && (
            <button
              onClick={forgot}
              className="py-1 text-center text-[12.5px] font-semibold text-muted"
            >
              Забув пароль?
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-[12px] leading-relaxed text-faint">
          Можна користуватись і без акаунта — тоді все зберігається лише на цьому пристрої.
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
      className="flex h-13 w-full items-center justify-center gap-3 rounded-2xl border border-line bg-surface text-[15px] font-bold disabled:opacity-50"
    >
      {loading ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
      ) : (
        <GoogleMark size={19} />
      )}
      {loading ? "Переходимо до Google…" : "Продовжити з Google"}
    </motion.button>
  );
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-13 items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-3">
      <span className="shrink-0 text-muted">{icon}</span>
      {children}
    </div>
  );
}
