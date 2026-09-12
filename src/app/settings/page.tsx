"use client";

import {
  Bell,
  Check,
  ChevronRight,
  CloudOff,
  Download,
  Eye,
  Github,
  Info,
  LogOut,
  Moon,
  Share,
  Smartphone,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Avatar, Button, Card, useToast } from "@/components/ui";
import { disablePush, enablePush, pushConfigured, pushState, pushSupported } from "@/lib/push";
import { signOut } from "@/lib/session";
import { useApp } from "@/lib/store";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  canInstall,
  isIos,
  isStandalone,
  onInstallAvailability,
  promptInstall,
} from "@/lib/pwa";
import { haptic, plural } from "@/lib/utils";

export default function SettingsPage() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const avoidRecentDays = useApp((s) => s.avoidRecentDays);
  const setAvoidRecentDays = useApp((s) => s.setAvoidRecentDays);
  const myRecipes = useApp((s) => s.myRecipes);
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  const family = useApp((st) => st.family);
  const familyMembers = useApp((st) => st.familyMembers);

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


  return (
    <div className="pb-8">
      <TopBar title="Налаштування" />

      {/* Акаунт */}
      <section className="px-4 pt-4">
        <AccountCard />
      </section>

      {/* Сімʼя */}
      <section className="px-4 pt-4">
        <Link href="/family">
          <Card className="flex items-center gap-3 p-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-surface-2">
              <Users size={18} className="text-brand" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold">Сімʼя</p>
              <p className="truncate text-[12px] text-muted">
                {family
                  ? `${familyMembers.length} ${plural(familyMembers.length, "учасник", "учасники", "учасників")} · спільна комора`
                  : "Спільна комора, план і рецепти для всіх удома"}
              </p>
            </div>
            <ChevronRight size={17} className="shrink-0 text-muted" />
          </Card>
        </Link>
      </section>

      {/* Встановлення. Коли застосунок уже на телефоні, розповідати про це
          нема сенсу — прибираємо секцію цілком. */}
      {!standalone && (
  <section className="px-4 pt-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Smartphone size={17} className="text-brand" />
              <h2 className="font-display text-[16px] font-bold">Застосунок на телефоні</h2>
            </div>

            {ios ? (
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
      )}

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
                  setTheme(t.value);
                }}
                className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-[13.5px] font-bold ${
                  theme === t.value
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

      {/* Що пропонувати */}
      <section className="px-4 pt-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Sparkles size={17} className="text-brand" />
            <h2 className="font-display text-[16px] font-bold">Що пропонувати</h2>
          </div>
          <button
            onClick={() => {
              haptic(10);
              setAvoidRecentDays(avoidRecentDays == null ? 7 : null);
            }}
            aria-pressed={avoidRecentDays != null}
            className="mt-3 flex w-full items-start gap-3 text-left"
          >
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${
                avoidRecentDays != null
                  ? "border-brand bg-brand text-brand-ink"
                  : "border-line"
              }`}
            >
              {avoidRecentDays != null && <Check size={12} strokeWidth={3.5} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold">
                Не пропонувати те, що готували минулі 7 днів
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                Діє в рулетці, дуелі, холодильнику, порятунку, «поки є світло», разом і
                в плані на тиждень. Пошук це не зачіпає: там шукають конкретну страву.
              </span>
            </span>
          </button>
        </Card>
      </section>

      {/* Сповіщення */}
      <PushCard />

      {/* Про застосунок */}
      <section className="px-4 pt-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Info size={17} className="text-brand" />
            <h2 className="font-display text-[16px] font-bold">Про Ням</h2>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Соціальна кулінарна книга, яка допомагає вирішити, що поїсти. Рулетка, підбір за
            холодильником, дуель страв, план на тиждень, сканер штрихкодів і чеків.
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-faint">
            Штрихкоди звіряються з відкритою базою Open Food Facts, а позиції чека приходять із
            реєстру фіскальних чеків податкової.
          </p>
          <p className="mt-3 flex gap-3 text-[12px]">
            <Link href="/privacy" className="text-brand underline underline-offset-2">
              Конфіденційність
            </Link>
            <Link href="/terms" className="text-brand underline underline-offset-2">
              Умови використання
            </Link>
          </p>
          {hydrated && (
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-faint">
              <Github size={12} />
              версія 0.1.0 · {myRecipes.length} власних рецептів
            </p>
          )}
        </Card>
      </section>
    </div>
  );
}

/** Стан підключення до бекенду і кнопка виходу. */
function AccountCard() {
  const account = useApp((s) => s.account);
  const profile = useApp((s) => s.profile);
  const status = useApp((s) => s.syncStatus);
  const syncError = useApp((s) => s.syncError);
  const toast = useToast();

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

  // Гілки «без акаунта» тут немає: без входу застосунок не показує нічого,
  // крім екрана входу, тож до налаштувань неавторизований не дійде.
  if (!account) return null;

  return (
    <Card className="flex items-center gap-3 p-4">
      <Avatar
        emoji={profile.emoji}
        gradient={profile.gradient}
        src={profile.avatar}
        size={48}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold">{profile.name}</p>
        <p className="truncate text-[12px] text-muted">{account.email}</p>
        {/* Помилку синхронізації сховати не можна: інакше людина вважатиме,
            що все збереглося, тоді як воно лишилось тільки в цьому браузері. */}
        {status === "error" && syncError && (
          <p className="mt-1 truncate text-[11.5px] text-berry">{syncError}</p>
        )}
      </div>
      <Button
        variant="secondary"
        onClick={async () => {
          if (!confirm("Вийти з акаунта? Локальні дані на цьому пристрої буде очищено.")) return;
          await signOut();
          toast("Ви вийшли", "👋");
        }}
        aria-label="Вийти"
        className="w-12 shrink-0 px-0"
      >
        <LogOut size={16} />
      </Button>
    </Card>
  );
}

/**
 * Пуш-сповіщення на цьому пристрої.
 *
 * Дозвіл питаємо лише у відповідь на натиск: браузери карають за питання без
 * приводу, а людина, яку спитали зненацька, тисне «ні» — і назавжди.
 *
 * На айфоні пуш працює тільки в застосунку, доданому на екран «Домів». Це не
 * наша вигадка й не вада — просто так влаштований iOS, і сказати про це
 * чесніше, ніж мовчки показувати перемикач, який нічого не вмикає.
 */
function PushCard() {
  const account = useApp((s) => s.account);
  const toast = useToast();

  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [testing, setTesting] = useState(false);
  /** Чи налаштований пуш на сервері. Питаємо запитом, а не зі змінної. */
  const [configured, setConfigured] = useState(false);

  /** Чи знає про цей пристрій сервер. Без цього «увімкнено» нічого не означає. */
  const [known, setKnown] = useState(true);

  useEffect(() => {
    void Promise.all([pushState(), pushConfigured()]).then(([state, ok]) => {
      setOn(state.browser);
      setKnown(state.server);
      setConfigured(ok);
      setReady(true);
    });
  }, []);

  if (!account || !isSupabaseConfigured) return null;

  const supported = pushSupported() && configured;
  const iosNotInstalled = isIos() && !isStandalone();

  /**
   * Пробне сповіщення — єдиний чесний спосіб перевірити ланцюг.
   *
   * Він довгий: браузер, запис у базі, ключі VAPID, служба пуша Google або
   * Apple, налаштування самого телефона. Будь-яка ланка може мовчки не
   * спрацювати, і без кнопки «перевірити» людина дізнається про це лише з
   * того, що сповіщення не приходять.
   */
  const sendTest = async () => {
    setTesting(true);
    try {
      const token = (await getSupabase()?.auth.getSession())?.data.session?.access_token;
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json()) as { ok?: boolean; sent?: number; reason?: string };
      if (data.ok && (data.sent ?? 0) > 0) toast("Надіслано — зараз прилетить", "🔔");
      else if (data.ok) toast("Сервер не знайшов жодного пристрою", "⚠️");
      else toast(`Не вийшло: ${data.reason ?? "невідомо"}`, "⚠️");
    } catch {
      toast("Не вийшло: немає звʼязку", "⚠️");
    } finally {
      setTesting(false);
    }
  };

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setOn(false);
        toast("Сповіщення вимкнено", "🔕");
        return;
      }

      const result = await enablePush(account.id);
      if (result.state === "on") {
        setOn(true);
        setKnown(true);
        toast("Сповіщення увімкнено", "🔔");
      } else if (result.state === "denied") {
        toast("Дозвіл не надано — увімкни в налаштуваннях телефона", "🔕");
      } else {
        // Кажемо, що саме не вийшло: інакше порожня таблиця підписок виглядає
        // як «мабуть, телефон не підтримує».
        toast(`Не вдалося: ${result.reason}`, "⚠️");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="px-4 pt-4">
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Bell size={17} className="text-brand" />
          <h2 className="font-display text-[16px] font-bold">Сповіщення</h2>
        </div>

        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Нагадаємо, коли продукт у коморі доживає останній день, і скажемо про коментар до
          твого рецепта. Приходить на цей пристрій, навіть коли застосунок закрито.
        </p>

        {iosNotInstalled ? (
          <p className="mt-3 rounded-2xl bg-surface-2 p-3 text-[12.5px] leading-relaxed text-muted">
            На iPhone сповіщення працюють лише в застосунку, доданому на екран «Домів».
            Додай Ням туди — і перемикач зʼявиться.
          </p>
        ) : !ready ? (
          <p className="mt-3 rounded-2xl bg-surface-2 p-3 text-[12.5px] text-muted">
            Перевіряю…
          </p>
        ) : !supported ? (
          <p className="mt-3 rounded-2xl bg-surface-2 p-3 text-[12.5px] leading-relaxed text-muted">
            Цей браузер не вміє сповіщень, або їх ще не налаштовано на сервері.
          </p>
        ) : (
          <>
            {/*
              Підписка живе у двох місцях — у браузері й у базі. Коли вони
              розійшлись, телефон каже «увімкнено», а надсилати нема кому;
              мовчати про це не можна.
            */}
            {on && !known && (
              <p className="mt-3 rounded-2xl border border-berry/30 bg-berry/10 p-3 text-[12.5px] leading-relaxed text-berry">
                Цей пристрій підписаний у браузері, але сервер про нього не знає — тому
                нічого й не приходить. Вимкни й увімкни ще раз.
              </p>
            )}
            <Button
              full
              variant={on ? "secondary" : "primary"}
              className="mt-3"
              onClick={() => void toggle()}
              loading={busy}
            >
              {on ? "Вимкнути на цьому пристрої" : "Увімкнути сповіщення"}
            </Button>
            {on && known && (
              <Button
                full
                variant="ghost"
                className="mt-2"
                loading={testing}
                onClick={() => void sendTest()}
              >
                Надіслати пробне
              </Button>
            )}
          </>
        )}
      </Card>
    </section>
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
