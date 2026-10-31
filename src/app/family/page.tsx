"use client";

import { Check, Copy, Crown, LogOut, Plus, UserMinus, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Avatar, Button, EmptyState, Panel, PanelHeader, Spinner, useToast } from "@/components/ui";
import { refreshFamily } from "@/lib/session";
import { useApp } from "@/lib/store";
import * as api from "@/lib/supabase/api";
import { friendlyError, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Family, FamilyMember } from "@/lib/types";
import { haptic, plural } from "@/lib/utils";

export default function FamilyPage() {
  const account = useApp((s) => s.account);
  const family = useApp((s) => s.family);
  const members = useApp((s) => s.familyMembers);

  if (!isSupabaseConfigured) {
    return (
      <Shell>
        <EmptyState
          emoji="🔌"
          title="Потрібен бекенд"
          note="Спільна комора має десь зберігатися, тож у локальному режимі сімʼї немає."
        />
      </Shell>
    );
  }

  if (!account) {
    return (
      <Shell>
        <EmptyState
          emoji="🔑"
          title="Спочатку увійди"
          note="Щоб ділити комору й план з рідними, треба акаунт."
          action={
            <Link href="/auth">
              <Button>Увійти</Button>
            </Link>
          }
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {family ? (
        <FamilyView family={family} members={members} myId={account.id} />
      ) : (
        <NoFamily />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-8">
      <TopBar title="Сімʼя" subtitle="Спільна комора, план і рецепти" />
      {children}
    </div>
  );
}

/* ── Немає сімʼї ───────────────────────────────────────────────────────── */

function NoFamily() {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const run = async (kind: "create" | "join", action: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await action();
      await refreshFamily();
      haptic(14);
      toast(kind === "create" ? "Сімʼю створено" : "Ти в сімʼї", kind === "create" ? "🏡" : "🎉");
    } catch (error) {
      toast(friendlyError(error), "⚠️");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 px-4">
      <p className="px-0.5 text-[13.5px] font-semibold leading-relaxed text-muted">
        Сімʼя — це спільні комора, план харчування, рецепти та збережене. Додав молоко ти — бачать
        усі, і нікому не треба вносити те саме вдруге.
      </p>

      <Panel>
        <PanelHeader label="Створити сімʼю" icon={<Users size={13} strokeWidth={2.4} />} />
        <p className="border-t border-line px-3.5 py-3 text-[12.5px] font-semibold leading-relaxed text-muted">
          Отримаєш код запрошення — надішлеш його рідним.
        </p>
        <ActionRow
          icon={<Plus size={16} strokeWidth={2.4} />}
          loading={busy === "create"}
          onClick={() => {
            haptic(10);
            void run("create", () => api.createFamily());
          }}
        >
          Створити
        </ActionRow>
      </Panel>

      <Panel>
        <PanelHeader label="Приєднатись за кодом" icon={<UserPlus size={13} strokeWidth={2.4} />} />
        <div className="border-t border-line px-3.5 py-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="NYAM42"
            inputMode="text"
            autoCapitalize="characters"
            aria-label="Код запрошення"
            className="h-[46px] w-full rounded-[8px] bg-surface-2 px-3.5 text-center text-[18px] font-extrabold tracking-[0.3em]"
          />
        </div>
        <ActionRow
          icon={<UserPlus size={16} strokeWidth={2.4} />}
          loading={busy === "join"}
          disabled={code.trim().length < 6}
          onClick={() => {
            haptic(10);
            void run("join", () => api.joinFamily(code));
          }}
        >
          Приєднатись
        </ActionRow>
      </Panel>
    </div>
  );
}

/** Рядок-дія панелі: іконка й підпис кольору бренду, під час запиту — спінер. */
function ActionRow({
  icon,
  children,
  onClick,
  loading,
  disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex h-12 w-full items-center gap-2.5 border-t border-line px-3.5 text-left text-brand active:bg-surface-2 disabled:opacity-45"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-[14px] font-bold">{children}</span>
      {loading && <Spinner className="h-4 w-4" />}
    </button>
  );
}

/* ── Є сімʼя ───────────────────────────────────────────────────────────── */

function FamilyView({
  family,
  members,
  myId,
}: {
  family: Family;
  members: FamilyMember[];
  myId: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const iAmOwner = members.some((m) => m.userId === myId && m.role === "owner");

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(family.inviteCode);
      setCopied(true);
      haptic(10);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Не вдалося скопіювати", "⚠️");
    }
  };

  const leave = async () => {
    if (!confirm("Вийти з сімʼї? Спільні комора й план більше не будуть видні.")) return;
    setBusy(true);
    try {
      await api.leaveFamily();
      await refreshFamily();
      toast("Ти вийшов із сімʼї", "👋");
    } catch (error) {
      toast(friendlyError(error), "⚠️");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string, name: string) => {
    if (!confirm(`Виключити ${name} із сімʼї?`)) return;
    try {
      await api.removeFamilyMember(userId);
      await refreshFamily();
      toast("Учасника виключено", "👋");
    } catch (error) {
      toast(friendlyError(error), "⚠️");
    }
  };

  return (
    <div className="flex flex-col gap-2.5 px-4">
      <Panel>
        <PanelHeader label="Код запрошення" aside={copied ? "скопійовано" : undefined} />
        <div className="border-t border-line px-3.5 py-3">
          <button
            onClick={copyCode}
            aria-label="Скопіювати код запрошення"
            className="flex h-[52px] w-full items-center justify-between gap-3 rounded-[8px] border border-dashed border-brand/50 bg-brand/10 px-3.5"
          >
            <span className="font-mono text-[22px] font-extrabold tracking-[0.28em] text-brand">
              {family.inviteCode}
            </span>
            {copied ? (
              <Check size={18} strokeWidth={2.6} className="text-brand" />
            ) : (
              <Copy size={18} className="text-brand" />
            )}
          </button>
          <p className="mt-2 text-[11.5px] font-semibold leading-relaxed text-faint">
            Надішли код рідним — вони введуть його тут і побачать спільну комору.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader label="Учасники" aside={String(members.length)} />
        {members.map((m) => (
          <div key={m.userId} className="flex h-[58px] items-center gap-3 border-t border-line px-3.5">
            <Link href={`/u/${m.userId}`} className="shrink-0">
              <Avatar emoji={m.profile.emoji} gradient={m.profile.gradient} src={m.profile.avatar} size={38} />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-[14px] font-bold">
                <span className="truncate">{m.profile.name}</span>
                {m.userId === myId && (
                  <span className="shrink-0 text-[11.5px] font-semibold text-faint">— це ти</span>
                )}
                {m.role === "owner" && <Crown size={13} className="shrink-0 text-brand-2" />}
              </p>
              <p className="truncate text-[11.5px] font-semibold text-faint">
                @{m.profile.handle}
                {m.role === "owner" && " · власник"}
              </p>
            </div>
            {iAmOwner && m.userId !== myId && (
              <button
                onClick={() => remove(m.userId, m.profile.name)}
                aria-label="Виключити"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-surface-2 text-berry active:bg-line"
              >
                <UserMinus size={15} />
              </button>
            )}
          </div>
        ))}
      </Panel>

      <button
        onClick={() => {
          haptic(10);
          void leave();
        }}
        disabled={busy}
        className="flex h-[50px] items-center justify-center gap-2 rounded-[10px] border border-line bg-surface text-[14px] font-bold text-berry active:bg-surface-2 disabled:opacity-45"
      >
        {busy ? <Spinner className="h-4 w-4" /> : <LogOut size={16} strokeWidth={2.2} />}
        Вийти з сімʼї
      </button>
      <p className="pb-2 text-center text-[11.5px] font-semibold leading-relaxed text-faint">
        Твої рецепти й продукти лишаться при тобі — спільними вони бути перестануть.
      </p>
    </div>
  );
}
