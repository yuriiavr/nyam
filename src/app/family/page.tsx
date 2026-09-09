"use client";

import { Check, Copy, Crown, LogOut, UserMinus, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Avatar, Button, Card, EmptyState, useToast } from "@/components/ui";
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
    <div className="space-y-4 px-4 pt-4">
      <p className="text-[14px] leading-relaxed text-muted">
        Сімʼя — це спільні комора, план харчування, рецепти та збережене. Додав молоко ти — бачать
        усі, і нікому не треба вносити те саме вдруге.
      </p>

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Users size={17} className="text-brand" />
          <h2 className="font-display text-[16px] font-bold">Створити сімʼю</h2>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Отримаєш код запрошення — надішлеш його рідним.
        </p>
        <Button
          full
          className="mt-3"
          loading={busy === "create"}
          onClick={() => run("create", () => api.createFamily())}
        >
          Створити
        </Button>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <UserPlus size={17} className="text-brand" />
          <h2 className="font-display text-[16px] font-bold">Приєднатись за кодом</h2>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="NYAM42"
          inputMode="text"
          autoCapitalize="characters"
          className="mt-3 h-11 w-full rounded-2xl border border-line bg-surface-2 px-3.5 text-center text-[18px] font-bold tracking-[0.3em]"
        />
        <Button
          full
          variant="secondary"
          className="mt-3"
          loading={busy === "join"}
          disabled={code.trim().length < 6}
          onClick={() => run("join", () => api.joinFamily(code))}
        >
          Приєднатись
        </Button>
      </Card>
    </div>
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
    <div className="space-y-4 px-4 pt-4">
      <Card className="p-4">
        <p className="text-[12px] text-muted">Код запрошення</p>
        <button
          onClick={copyCode}
          className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-brand/50 bg-brand/10 px-4 py-3"
        >
          <span className="font-mono text-[22px] font-extrabold tracking-[0.28em] text-brand">
            {family.inviteCode}
          </span>
          {copied ? (
            <Check size={18} className="text-mint" />
          ) : (
            <Copy size={18} className="text-brand" />
          )}
        </button>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
          Надішли код рідним — вони введуть його тут і побачать спільну комору.
        </p>
      </Card>

      <div>
        <h3 className="mb-2 px-1 font-display text-[15px] font-bold">
          Учасники · {members.length}
        </h3>
        <div className="space-y-2">
          {members.map((m) => (
            <Card key={m.userId} className="flex items-center gap-3 p-3">
              <Link href={`/u/${m.userId}`}>
                <Avatar
                  emoji={m.profile.emoji}
                  gradient={m.profile.gradient}
                  src={m.profile.avatar}
                  size={42}
                />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[14.5px] font-bold">
                  {m.profile.name}
                  {m.userId === myId && (
                    <span className="shrink-0 text-[11px] font-normal text-muted">— це ти</span>
                  )}
                  {m.role === "owner" && <Crown size={13} className="shrink-0 text-brand-2" />}
                </p>
                <p className="truncate text-[12px] text-muted">@{m.profile.handle}</p>
              </div>
              {iAmOwner && m.userId !== myId && (
                <button
                  onClick={() => remove(m.userId, m.profile.name)}
                  aria-label="Виключити"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted"
                >
                  <UserMinus size={15} />
                </button>
              )}
            </Card>
          ))}
        </div>
      </div>

      <Button full variant="secondary" loading={busy} onClick={leave}>
        <LogOut size={16} />
        Вийти з сімʼї
      </Button>
      <p className="pb-2 text-center text-[11.5px] leading-relaxed text-faint">
        Твої рецепти й продукти лишаться при тобі — спільними вони бути перестануть.
      </p>
    </div>
  );
}
