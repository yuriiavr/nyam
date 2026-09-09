"use client";

import {
  CloudOff,
  Download,
  Eye,
  Github,
  Info,
  LogIn,
  LogOut,
  Moon,
  RefreshCw,
  RotateCcw,
  Share,
  Smartphone,
  Sun,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Button, Card, Spinner, useToast } from "@/components/ui";
import { refreshFromServer, signOut } from "@/lib/session";
import { useApp } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  canInstall,
  isIos,
  isStandalone,
  onInstallAvailability,
  promptInstall,
} from "@/lib/pwa";
import { haptic } from "@/lib/utils";

export default function SettingsPage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const [installable, setInstallable] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setInstallable(canInstall());
    setStandalone(isStandalone());
    setIos(isIos());
    return onInstallAvailability(setInstallable);
  }, []);

  const install = async () => {
    haptic(12);
    const res = await promptInstall();
    if (res === "accepted") toast("Готово — застосунок встановлено", "🎉");
    else if (res === "unavailable") toast("Встановлення зараз недоступне", "ℹ️");
  };

  const resetAll = () => {
    if (!confirm("Видалити всі локальні дані: рецепти, комору, історію та налаштування?")) return;
    try {
      localStorage.removeItem("nyam-v1");
    } catch {
      /* ігноруємо */
    }
    location.reload();
  };

  return (
    <div className="pb-8">
      <TopBar title="Налаштування" />

      {/* Акаунт */}
      <section className="px-4 pt-4">
        <AccountCard />
      </section>

      {/* Встановлення */}
      <section className="px-4 pt-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Smartphone size={17} className="text-brand" />
            <h2 className="font-display text-[16px] font-bold">Застосунок на телефоні</h2>
          </div>

          {standalone ? (
            <p className="mt-2 text-[13px] leading-relaxed text-mint">
              ✓ Ням уже встановлено — ти читаєш це в застосунку.
            </p>
          ) : ios ? (
            <>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                На iPhone встановлення робиться вручну: натисни{" "}
                <Share size={13} className="inline align-text-bottom" /> «Поділитись» унизу Safari →
                «На екран «Домів»».
              </p>
              <div className="mt-3 rounded-2xl bg-surface-2 p-3 text-[12.5px] leading-relaxed text-muted">
                Після цього Ням відкриватиметься на весь екран, без адресного рядка, і працюватиме
                офлайн.
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                Встанови Ням як застосунок — повний екран, іконка на робочому столі та офлайн-режим.
              </p>
              <Button full className="mt-3" onClick={install} disabled={!installable}>
                <Download size={17} />
                {installable ? "Встановити застосунок" : "Встановлення недоступне"}
              </Button>
              {!installable && (
                <p className="mt-2 text-[11.5px] text-muted">
                  Браузер запропонує встановлення після кількох відвідувань, або скористайся меню
                  браузера → «Встановити застосунок».
                </p>
              )}
            </>
          )}
        </Card>
      </section>

      {/* Вигляд */}
      <section className="px-4 pt-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Eye size={17} className="text-brand" />
            <h2 className="font-display text-[16px] font-bold">Вигляд</h2>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(
              [
                { value: "dark", label: "Темна", icon: <Moon size={17} /> },
                { value: "light", label: "Світла", icon: <Sun size={17} /> },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                onClick={() => {
                  haptic(10);
                  state.setTheme(t.value);
                }}
                className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-[13.5px] font-bold ${
                  state.theme === t.value
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-line bg-surface text-muted"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </Card>
      </section>

      {/* Дані */}
      <section className="px-4 pt-4">
        <Card className="divide-y divide-line p-0">
          <Row
            title="Показати приховані страви"
            note={`Ти сховав ${state.dismissed.length} страв у свайпі`}
            icon={<RotateCcw size={17} />}
            action={
              <Button
                size="sm"
                variant="secondary"
                disabled={state.dismissed.length === 0}
                onClick={() => {
                  state.clearDismissed();
                  toast("Приховані страви повернулись", "↩️");
                }}
              >
                Повернути
              </Button>
            }
          />
          <Row
            title="Очистити комору"
            note={`${state.pantry.length} продуктів`}
            icon={<Trash2 size={17} />}
            action={
              <Button
                size="sm"
                variant="secondary"
                disabled={state.pantry.length === 0}
                onClick={() => {
                  state.clearPantry();
                  toast("Комору очищено", "🧹");
                }}
              >
                Очистити
              </Button>
            }
          />
          <Row
            title="Скинути всі дані"
            note="Рецепти, комора, історія, план — усе локально на цьому пристрої"
            icon={<Trash2 size={17} className="text-berry" />}
            action={
              <Button size="sm" variant="danger" onClick={resetAll}>
                Скинути
              </Button>
            }
          />
        </Card>
      </section>

      {/* Про застосунок */}
      <section className="px-4 pt-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Info size={17} className="text-brand" />
            <h2 className="font-display text-[16px] font-bold">Про Ням</h2>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Соціальна кулінарна книга, яка допомагає вирішити, що поїсти. Рулетка, підбір за
            холодильником, свайп, дуель страв, план на тиждень і сканер штрихкодів.
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-faint">
            Дані зберігаються локально у твоєму браузері. Штрихкоди звіряються з відкритою базою
            Open Food Facts, погода — з Open-Meteo.
          </p>
          {hydrated && (
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-faint">
              <Github size={12} />
              версія 0.1.0 · {state.myRecipes.length} власних рецептів
            </p>
          )}
        </Card>
      </section>
    </div>
  );
}

/** Стан підключення до бекенду: гість, авторизований або локальний режим. */
function AccountCard() {
  const account = useApp((s) => s.account);
  const status = useApp((s) => s.syncStatus);
  const syncError = useApp((s) => s.syncError);
  const remoteReady = useApp((s) => s.remoteReady);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!isSupabaseConfigured) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <CloudOff size={17} className="text-muted" />
          <h2 className="font-display text-[16px] font-bold">Локальний режим</h2>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Рецепти, комора й історія зберігаються тільки в цьому браузері. Щоб увімкнути акаунти
          та спільну стрічку, додай ключі Supabase у <code>.env.local</code>.
        </p>
      </Card>
    );
  }

  const refresh = async () => {
    setBusy(true);
    await refreshFromServer();
    setBusy(false);
    toast("Дані оновлено", "🔄");
  };

  if (!account) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <LogIn size={17} className="text-brand" />
          <h2 className="font-display text-[16px] font-bold">Ти без акаунта</h2>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Рецепти спільноти вже видно, але твої власні живуть лише на цьому пристрої. Увійди —
          і вони синхронізуються, а інші кухарі побачать їх у стрічці.
        </p>
        <Link href="/auth">
          <Button full className="mt-3">
            Увійти або створити акаунт
          </Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            status === "ready" ? "bg-mint" : status === "error" ? "bg-berry" : "bg-brand-2"
          }`}
        />
        <h2 className="font-display text-[16px] font-bold">
          {status === "ready" ? "Синхронізовано" : status === "error" ? "Помилка синхронізації" : "Синхронізую…"}
        </h2>
        {status === "loading" && <Spinner className="ml-auto h-4 w-4" />}
      </div>

      <p className="mt-2 truncate text-[13px] text-muted">{account.email}</p>

      {status === "error" && syncError && (
        <p className="mt-2 rounded-2xl border border-berry/30 bg-berry/10 px-3 py-2 text-[12.5px] text-berry">
          {syncError}
        </p>
      )}

      {!remoteReady && status !== "loading" && (
        <p className="mt-2 text-[12.5px] leading-snug text-muted">
          Спільнота не завантажилась — можливо, у базі ще немає таблиць. Виконай{" "}
          <code>supabase/schema.sql</code>.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={refresh} loading={busy}>
          <RefreshCw size={16} />
          Оновити
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            if (!confirm("Вийти з акаунта? Локальні дані на цьому пристрої буде очищено.")) return;
            await signOut();
            toast("Ви вийшли", "👋");
          }}
          aria-label="Вийти"
          className="w-12 px-0"
        >
          <LogOut size={16} />
        </Button>
      </div>
    </Card>
  );
}

function Row({
  title,
  note,
  icon,
  action,
}: {
  title: string;
  note: string;
  icon: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-surface-2 text-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold">{title}</p>
        <p className="truncate text-[11.5px] text-muted">{note}</p>
      </div>
      {action}
    </div>
  );
}
