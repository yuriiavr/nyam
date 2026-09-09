"use client";

import { Check, Copy, Crown, LogOut, Pencil, UserMinus, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Avatar, Button, Card, EmptyState, useToast } from "@/components/ui";
import { refreshFamily } from "@/lib/session";
import { useApp } from "@/lib/store";
import * as api from "@/lib/supabase/api";
import { isSupabaseConfigured, friendlyError } from "@/lib/supabase/client";
import { haptic } from "@/lib/utils";

export default function FamilyPage() {
  const account = useApp((s) => s.account);
  const family = useApp((s) => s.family);
  const members = useApp((s) => s.familyMembers);
  const myId = account?.id;

  if (!isSupabaseConfigured) {
    return (
      <Shell>
        <EmptyState
          emoji="🔌"
          title="Потрібен бекенд"
          note="Сімʼя живе в базі: спільна комора має десь зберігатися. У локальному режимі її немає."
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
        <FamilyCard family={family} members={members} myId={myId!} />
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

/* ── Немає сімʼї: створити або приєднатись ─────────────────────────────── */

function NoFamily() {
  const toast = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const create = async () => {
    setBusy("create");
    try {
      await api.createFamily(name);
      await refreshFamily();
      haptic(14);
      toast("Сімʼю створено", "🏡");
    } catch (error) {
      toast(friendlyError(error), "⚠️");
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    setBusy("join");
    try {
      await api.joinFamily(code);
      await refreshFamily();
      haptic(14);
      toast("Ти в сімʼї", "🎉");
    } catch (error) {
      toast(friendlyError(error), "⚠️");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 px-4 pt-4">
      <p className="text-[14px] leading-relaxed text-muted">
        Сімʼя — це спільні комора, план харчування, рецепти та збережене. Додав молоко ти —
        бачать усі, і нікому не треба вносити те саме вдруге.
      </p>

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Users size={17} className="text-brand" />
          <h2 className="font-display text-[16px] font-bold">Створити сімʼю</h2>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Назва, напр. «Аврамці»"
          className="mt-3 h-11 w-full rounded-2xl border border-line bg-surface-2 px-3.5 text-[15px]"
        />
        <Button full className="mt-3" loading={busy === "create"} onClick={create}>
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
          className="mt-3 h-11 w-full rounded-2xl border border-line bg-surface-2 px-3.5 text-center text-[18px] font-bold tracking-[0.3em]"
        />
        <Button
          full
          variant="secondary"
          className="mt-3"
          loading={busy === "join"}
          disabled={code.trim().length < 6}
          onClick={join}
        >
          Приєднатись
        </Button>
      </Card>
    </div>
  );
}

/* ── Є сімʼя ───────────────────────────────────────────────────────────── */

function FamilyCard({
  family,
  members,
  myId,
}: {
  family: NonNullable<ReturnType<typeof useApp.getState>["family"]>;
  members: ReturnType<typeof useApp.getState>["familyMembers"];
  myId: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(family.name);
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

  const rename = async () => {
    setBusy(true);
    try {
      await api.renameFamily(draft);
      await refreshFamily();
      setRenaming(false);
      toast("Назву змінено", "✏️");
    } catch (error) {
      toast(friendlyError(error), "⚠️");
    } finally {
      setBusy(false);
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
        {renaming ? (
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={60}
              className="h-11 flex-1 rounded-2xl border border-line bg-surface-2 px-3.5 text-[15px]"
            />
            <Button size="sm" loading={busy} onClick={rename}>
              Ок
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-[19px] font-extrabold leading-tight">{family.name}</h2>
            {iAmOwner && (
              <button
                onClick={() => {
                  setDraft(family.name);
                  setRenaming(true);
                }}
                aria-label="Перейменувати"
                className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 text-muted"
              >
                <Pencil size={15} />
              </button>
            )}
          </div>
        )}

        <p className="mt-1 text-[12.5px] text-muted">
          {members.length} {members.length === 1 ? "учасник" : "учасників"}
        </p>

        <div className="mt-4">
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
            Надішли код рідним — вони введуть його на цьому екрані й побачать спільну комору.
          </p>
        </div>
      </Card>

      <div>
        <h3 className="mb-2 px-1 font-display text-[15px] font-bold">Учасники</h3>
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
