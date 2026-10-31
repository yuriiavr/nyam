"use client";

import { ChevronRight, CloudOff, Download, LogOut, Moon, Sun, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { InstallGuide } from "@/components/PushOffer";
import { DiarySettingsCard } from "@/components/settings/DiarySettingsCard";
import { VoiceAssistantCard } from "@/components/settings/VoiceAssistantCard";
import { TopBar } from "@/components/TopBar";
import { Avatar, Button, Panel, PanelHeader, Segmented, Sheet, Spinner, Toggle, useToast } from "@/components/ui";
import { disablePush, enablePush, pushConfigured, pushState, pushSupported } from "@/lib/push";
import { signOut } from "@/lib/session";
import { useApp } from "@/lib/store";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  canInstall,
  currentAppleDevice,
  currentInstallEnvironment,
  isStandalone,
  onInstallAvailability,
  promptInstall,
  type InstallEnvironment,
} from "@/lib/pwa";
import { haptic, plural } from "@/lib/utils";

export default function SettingsPage() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const avoidRecentDays = useApp((s) => s.avoidRecentDays);
  const setAvoidRecentDays = useApp((s) => s.setAvoidRecentDays);
  const myRecipes = useApp((s) => s.myRecipes);
  const hydrated = useApp((s) => s.hydrated);
  const account = useApp((s) => s.account);
  const toast = useToast();

  const [installable, setInstallable] = useState(false);
  /** Де відкрито. До ефекту — «встановлено», щоб рядок не блимав на першому кадрі. */
  const [env, setEnv] = useState<InstallEnvironment>("standalone");
  const [installOpen, setInstallOpen] = useState(false);

  useEffect(() => {
    setInstallable(canInstall());
    setEnv(currentInstallEnvironment());
    return onInstallAvailability(setInstallable);
  }, []);

  const install = async () => {
    haptic(12);
    const res = await promptInstall();
    if (res === "accepted") toast("Готово — застосунок встановлено", "🎉");
    else if (res === "unavailable") toast("Встановлення зараз недоступне", "ℹ️");
  };

  /** Інструкція — для айфона й вбудованих браузерів; деінде браузер питає сам. */
  const guided = env === "ios-safari" || env === "ipad-safari" || env === "ios-other-browser" || env === "in-app";

  return (
    <div className="pb-8">
      <TopBar title="Налаштування" />

      <div className="flex flex-col gap-2.5 px-4 pt-1">
        <AccountCard />

        {/* Щоденник: ціль, апетит, хто бачить */}
        <DiarySettingsCard />

        {/* Що пропонувати */}
        <Panel>
          <PanelHeader label="Що пропонувати" />
          <div className="flex min-h-14 items-center gap-2 border-t border-line px-3.5 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">Без повторів за 7 днів</span>
              <span className="block text-[11.5px] font-semibold leading-snug text-faint">
                Не пропонувати те, що вже готували
              </span>
            </span>
            <Toggle
              checked={avoidRecentDays != null}
              label="Без повторів за 7 днів"
              onChange={(next) => setAvoidRecentDays(next ? 7 : null)}
            />
          </div>
        </Panel>

        {/* Сповіщення */}
        <PushCard />

        {/* Голосовий помічник через MCP */}
        <VoiceAssistantCard />

        {/* Вигляд */}
        <Panel>
          <PanelHeader label="Вигляд" />
          <div className="border-t border-line px-3.5 pb-3 pt-2.5">
            <Segmented
              value={theme}
              onChange={(t) => setTheme(t)}
              className="bg-bg-elev"
              options={[
                { value: "dark", label: "Темна", icon: <Moon size={15} strokeWidth={2.2} /> },
                { value: "light", label: "Світла", icon: <Sun size={15} strokeWidth={2.2} /> },
              ]}
            />
          </div>
        </Panel>

        {/* Про застосунок */}
        <Panel>
          <PanelHeader label="Про Ням" />
          {env !== "standalone" && (
            <SettingsLink
              onClick={() => {
                if (!guided && installable) void install();
                else setInstallOpen(true);
              }}
            >
              {env === "in-app" ? "Відкрити в браузері" : "Встановити застосунок"}
            </SettingsLink>
          )}
          <SettingsLink href="/privacy">Конфіденційність</SettingsLink>
          <SettingsLink href="/terms">Умови використання</SettingsLink>
        </Panel>

        {account && isSupabaseConfigured && <SignOutButton />}

        {hydrated && (
          <p className="py-1 text-center text-[11.5px] font-semibold text-faint">
            Ням 0.1.0 · {myRecipes.length} {plural(myRecipes.length, "власний рецепт", "власні рецепти", "власних рецептів")}
          </p>
        )}
      </div>

      <Sheet open={installOpen} onClose={() => setInstallOpen(false)} title={installCardTitle(env)}>
        <div className="flex flex-col gap-3 pb-2">
          {guided ? (
            <>
              <InstallGuide env={env} signedIn compact />
              {env !== "in-app" && (
                <p className="rounded-[10px] bg-surface-2 p-3 text-[12.5px] leading-relaxed text-muted">
                  Після цього Ням відкриватиметься на весь екран, без адресного рядка, і працюватиме офлайн.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-muted">
                Встанови Ням як застосунок — повний екран, іконка на робочому столі та офлайн-режим.
              </p>
              <Button full onClick={install} disabled={!installable}>
                <Download size={17} />
                {installable ? "Встановити застосунок" : "Встановлення недоступне"}
              </Button>
              {!installable && (
                <p className="text-[11.5px] text-muted">
                  Браузер запропонує встановлення після кількох відвідувань, або скористайся меню браузера →
                  «Встановити застосунок».
                </p>
              )}
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}

/** Рядок-посилання панелі: «Конфіденційність ›». */
function SettingsLink({ href, onClick, children }: { href?: string; onClick?: () => void; children: React.ReactNode }) {
  const inner = (
    <>
      <span className="flex-1 text-[14px] font-semibold">{children}</span>
      <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
    </>
  );
  const cls = "flex h-12 w-full items-center border-t border-line px-3.5 text-left active:bg-surface-2";
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function SignOutButton() {
  const toast = useToast();
  return (
    <button
      onClick={async () => {
        if (!confirm("Вийти з акаунта? Локальні дані на цьому пристрої буде очищено.")) return;
        await signOut();
        toast("Ви вийшли", "👋");
      }}
      className="flex h-[50px] items-center justify-center gap-2 rounded-[10px] border border-line bg-surface text-[14px] font-bold text-berry active:bg-surface-2"
    >
      <LogOut size={16} strokeWidth={2.2} />
      Вийти з акаунта
    </button>
  );
}

/**
 * Заголовок картки встановлення — з правильним пристроєм.
 *
 * Раніше завжди «на телефоні»: і на iPad, і в Chrome на компʼютері, де
 * телефона немає взагалі. Кличеться лише після ефекту (до нього секція
 * схована), тож рядок браузера тут уже справжній.
 */
function installCardTitle(env: InstallEnvironment): string {
  if (env === "in-app") return "Відкрий Ням у браузері";
  const device = currentAppleDevice();
  if (device === "iPad") return "Застосунок на iPad";
  if (device === "iPhone") return "Застосунок на телефоні";
  return "Ням як застосунок";
}

/** Акаунт і сімʼя. */
function AccountCard() {
  const account = useApp((s) => s.account);
  const profile = useApp((s) => s.profile);
  const status = useApp((s) => s.syncStatus);
  const syncError = useApp((s) => s.syncError);
  const family = useApp((st) => st.family);
  const familyMembers = useApp((st) => st.familyMembers);

  const familyRow = (
    <Link href="/family" className="flex h-[52px] items-center gap-3 border-t border-line px-3.5 active:bg-surface-2">
      <Users size={18} className="shrink-0 text-brand" />
      <span className="flex-1 text-[14px] font-semibold">Сімʼя</span>
      <span className="text-[12.5px] font-semibold text-faint">
        {family
          ? `${familyMembers.length} ${plural(familyMembers.length, "учасник", "учасники", "учасників")}`
          : "спільна комора"}
      </span>
      <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
    </Link>
  );

  if (!isSupabaseConfigured) {
    return (
      <Panel>
        <div className="flex items-start gap-3 px-3.5 py-3.5">
          <CloudOff size={18} className="mt-0.5 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="text-[15px] font-extrabold">Локальний режим</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
              Рецепти, комора й історія зберігаються тільки в цьому браузері. Щоб увімкнути акаунти та спільну
              стрічку, додай ключі Supabase у <code>.env.local</code>.
            </p>
          </div>
        </div>
        {familyRow}
      </Panel>
    );
  }

  // Гілки «без акаунта» тут немає: без входу застосунок не показує нічого,
  // крім екрана входу, тож до налаштувань неавторизований не дійде.
  if (!account) return null;

  return (
    <Panel>
      <div className="flex min-h-[72px] items-center gap-3 px-3.5 py-3">
        <Avatar emoji={profile.emoji} gradient={profile.gradient} src={profile.avatar} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold">{profile.name}</p>
          <p className="truncate text-[12.5px] font-semibold text-faint">{account.email}</p>
          {/* Помилку синхронізації сховати не можна: інакше людина вважатиме,
              що все збереглося, тоді як воно лишилось тільки в цьому браузері. */}
          {status === "error" && syncError && <p className="mt-1 truncate text-[11.5px] text-berry">{syncError}</p>}
        </div>
      </div>
      {familyRow}
    </Panel>
  );
}

/**
 * Пуш-сповіщення на цьому пристрої.
 *
 * Дозвіл питаємо лише у відповідь на натиск: браузери карають за питання без
 * приводу, а людина, яку спитали зненацька, тисне «ні» — і назавжди.
 *
 * На айфоні пуш працює тільки в застосунку, доданому на Початковий екран. Це не
 * наша вигадка й не вада — просто так влаштований iOS, і сказати про це
 * чесніше, ніж мовчки показувати перемикач, який нічого не вмикає.
 */
function PushCard() {
  const account = useApp((s) => s.account);
  const setPushOffer = useApp((s) => s.setPushOffer);
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
  /** iPhone чи iPad у вкладці — назву пристрою кажемо точно, а не завжди «iPhone». */
  const apple = currentAppleDevice();
  const iosNotInstalled = apple !== null && !isStandalone();

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
        /*
         * Запамʼятовуємо саме «вимкнено»: дозвіл після відписки лишається, і
         * без цього запису пристрій виглядав би як «дозволено, але не
         * підписано» — і пропозиція на старті вже наступного запуску
         * перепитала б те, від чого людина щойно відмовилась.
         */
        setPushOffer("off");
        toast("Сповіщення вимкнено", "🔕");
        return;
      }

      const result = await enablePush(account.id);
      if (result.state === "on") {
        setOn(true);
        setKnown(true);
        setPushOffer("enabled");
        toast("Сповіщення увімкнено", "🔔");
      } else if (result.state === "denied") {
        toast("Сповіщення заблоковано — увімкни їх у налаштуваннях телефона", "🔕");
      } else if (result.state === "dismissed") {
        // Вікно просто закрили — нічого не заблоковано, і в налаштування
        // телефона відправляти нема за чим.
        toast("Дозвіл не надано — можна спробувати ще раз", "🔕");
      } else {
        // Кажемо, що саме не вийшло: інакше порожня таблиця підписок виглядає
        // як «мабуть, телефон не підтримує».
        toast(`Не вдалося: ${result.reason}`, "⚠️");
      }
    } finally {
      setBusy(false);
    }
  };

  /** Чому перемикача немає або він бреше — одним реченням під рядком. */
  const note = iosNotInstalled
    ? `На ${apple} сповіщення працюють лише в застосунку, доданому на Початковий екран: «Встановити застосунок» нижче.`
    : !ready
      ? "Перевіряю…"
      : !supported
        ? "Цей браузер не вміє сповіщень, або їх ще не налаштовано на сервері."
        : null;

  return (
    <Panel>
      <PanelHeader label="Сповіщення" />
      <div className="flex min-h-14 items-center gap-2 border-t border-line px-3.5 py-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">На цьому пристрої</span>
          <span className="block text-[11.5px] font-semibold leading-snug text-faint">
            Таймер, строки в коморі, коментарі
          </span>
        </span>
        {busy ? (
          <Spinner className="h-5 w-5" />
        ) : (
          <Toggle checked={on} disabled={!!note} label="Сповіщення на цьому пристрої" onChange={() => void toggle()} />
        )}
      </div>
      {note && (
        <p className="border-t border-line px-3.5 py-2.5 text-[12px] font-semibold leading-snug text-muted">{note}</p>
      )}
      {/*
        Підписка живе у двох місцях — у браузері й у базі. Коли вони
        розійшлись, телефон каже «увімкнено», а надсилати нема кому;
        мовчати про це не можна.
      */}
      {!note && on && !known && (
        <p className="border-t border-line px-3.5 py-2.5 text-[12px] font-semibold leading-snug text-berry">
          Цей пристрій підписаний у браузері, але сервер про нього не знає — тому нічого й не приходить. Вимкни й
          увімкни ще раз.
        </p>
      )}
      {!note && on && known && (
        <button
          onClick={() => void sendTest()}
          disabled={testing}
          className="flex h-12 w-full items-center gap-2 border-t border-line px-3.5 text-left active:bg-surface-2"
        >
          <span className="flex-1 text-[14px] font-semibold text-brand">Надіслати пробне</span>
          {testing && <Spinner className="h-4 w-4" />}
        </button>
      )}
    </Panel>
  );
}
