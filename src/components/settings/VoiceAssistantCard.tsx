"use client";

import { Copy, KeyRound, Mic, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, Sheet, useToast } from "@/components/ui";
import { ConfirmSheet } from "@/components/ProductEditorSheet";
import { useApp } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { createApiToken, deleteApiToken, listApiTokens, type ApiToken } from "@/lib/supabase/diary-api";
import { haptic, timeAgo } from "@/lib/utils";

/**
 * Ключі для голосового помічника: «додай молоко безлактозне Галичина».
 *
 * Помічник ходить у Ням через MCP — той самий стандарт розуміють і Gemini, і
 * Claude. Ключ показуємо один раз: у базі лишається тільки його відбиток, і
 * навіть ми не зможемо показати його вдруге. Загубився — створи новий,
 * старий відклич.
 */
export function VoiceAssistantCard() {
  const account = useApp((s) => s.account);
  const toast = useToast();
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);

  useEffect(() => {
    if (!account || !isSupabaseConfigured) return;
    listApiTokens()
      .then(setTokens)
      .catch(() => setTokens([]));
  }, [account]);

  if (!account || !isSupabaseConfigured) return null;

  const create = async () => {
    setBusy(true);
    try {
      const { token, secret: value } = await createApiToken(defaultLabel());
      setTokens((list) => [token, ...(list ?? [])]);
      setSecret(value);
      haptic(14);
    } catch {
      toast("Не вдалося створити ключ — перевір звʼязок", "⚠️");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: ApiToken) => {
    try {
      await deleteApiToken(token.id);
      setTokens((list) => (list ?? []).filter((t) => t.id !== token.id));
      toast("Ключ відкликано", "🔒");
    } catch {
      toast("Не вдалося відкликати ключ", "⚠️");
    }
  };

  return (
    <section className="px-4 pt-4">
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Mic size={17} className="text-brand" />
          <h2 className="font-display text-[16px] font-bold">Голосовий помічник</h2>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Скажи помічнику «я зʼїв батончик Корона» чи «додай у комору молоко Галичина» — він запише сам. Працює з
          Gemini і Claude через MCP.
        </p>

        {tokens && tokens.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {tokens.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2">
                <KeyRound size={16} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold">
                    {t.label} <span className="font-normal text-faint">…{t.hint}</span>
                  </p>
                  <p className="text-[11.5px] text-muted">
                    {t.lastUsedAt ? `востаннє ${timeAgo(t.lastUsedAt)}` : "ще не користувались"}
                  </p>
                </div>
                <button
                  aria-label={`Відкликати ключ ${t.label}`}
                  onClick={() => setRevoking(t)}
                  className="grid h-9 w-9 place-items-center rounded-xl text-muted active:bg-line"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <Button full variant="secondary" className="mt-3" loading={busy} onClick={() => void create()}>
          <KeyRound size={16} />
          Підключити помічника
        </Button>
      </Card>

      <ConnectSheet secret={secret} onClose={() => setSecret(null)} />

      <ConfirmSheet
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Відкликати ключ?"
        body="Помічник із цим ключем більше не зможе нічого записати. Скасувати це не можна."
        confirmLabel="Відкликати"
        danger
        onConfirm={() => {
          if (revoking) void revoke(revoking);
          setRevoking(null);
        }}
      />
    </section>
  );
}

function defaultLabel(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const device = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "компʼютер";
  return `Помічник · ${device}`;
}

/** Ключ один раз і готові налаштування для кожного помічника. */
function ConnectSheet({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const toast = useToast();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = `${origin}/api/mcp`;
  const keyed = secret ? `${origin}/api/mcp/${secret}` : "";
  const gemini = secret
    ? JSON.stringify(
        { mcpServers: { nyam: { httpUrl: url, headers: { Authorization: `Bearer ${secret}` } } } },
        null,
        2,
      )
    : "";

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      haptic(10);
      toast(`${what} скопійовано`, "📋");
    } catch {
      toast("Не вдалося скопіювати — виділи й скопіюй вручну", "⚠️");
    }
  };

  return (
    <Sheet
      open={!!secret}
      onClose={onClose}
      title="Ключ створено"
      footer={
        <Button full size="lg" onClick={onClose}>
          Готово, я зберіг
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <p className="rounded-2xl bg-berry/10 px-3 py-2.5 text-[12.5px] leading-snug text-berry">
          Ключ показуємо лише зараз. Хто має ключ, той пише у твій щоденник і комору, — не публікуй його.
        </p>

        <Block title="Claude" note="Налаштування → Конектори → Додати власний конектор → URL:">
          <Code text={keyed} onCopy={() => void copy(keyed, "Адресу")} />
        </Block>

        <Block title="Gemini CLI" note="Додай у ~/.gemini/settings.json:">
          <Code text={gemini} onCopy={() => void copy(gemini, "Налаштування")} />
        </Block>

        <Block title="Інший MCP-клієнт" note="Streamable HTTP, заголовок Authorization: Bearer <ключ>.">
          <Code text={url} onCopy={() => void copy(url, "Адресу")} />
          <Code text={secret ?? ""} onCopy={() => void copy(secret ?? "", "Ключ")} />
        </Block>
      </div>
    </Sheet>
  );
}

function Block({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13.5px] font-bold">{title}</p>
      <p className="mb-1.5 mt-0.5 text-[12px] text-muted">{note}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Code({ text, onCopy }: { text: string; onCopy: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-surface-2 p-2.5">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11.5px] leading-snug">
        {text}
      </pre>
      <button
        aria-label="Скопіювати"
        onClick={onCopy}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-bg-elev active:bg-line"
      >
        <Copy size={15} />
      </button>
    </div>
  );
}
