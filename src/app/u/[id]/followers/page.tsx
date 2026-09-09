"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Avatar, Card, EmptyState, Segmented, Spinner } from "@/components/ui";
import { profileById, useApp } from "@/lib/store";
import * as api from "@/lib/supabase/api";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { compactNumber, plural } from "@/lib/utils";

type Tab = "followers" | "following";

export default function FollowersPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const state = useApp();

  const [tab, setTab] = useState<Tab>(search.get("tab") === "following" ? "following" : "followers");
  const [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const profile = profileById(state, params.id);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const load = tab === "followers" ? api.fetchFollowers : api.fetchFollowing;
    void load(params.id)
      .then((list) => {
        if (alive) setPeople(list);
      })
      .catch(() => {
        if (alive) setPeople([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [params.id, tab]);

  return (
    <div className="pb-8">
      <TopBar title={profile.name} subtitle={`@${profile.handle}`} />

      <div className="px-4 pt-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "followers", label: "Підписники" },
            { value: "following", label: "Підписки" },
          ]}
        />
      </div>

      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : people.length === 0 ? (
        <EmptyState
          emoji={tab === "followers" ? "🫧" : "🧭"}
          title={tab === "followers" ? "Ще ніхто не підписався" : "Поки ні на кого не підписані"}
          note={
            tab === "followers"
              ? "Публікуй рецепти — і кухарі почнуть стежити за твоєю кухнею."
              : "Знайди кухарів у розділі «Відкривай нове» і підпишись."
          }
        />
      ) : (
        <div className="space-y-2 px-4 pt-4">
          <p className="px-1 text-[12px] text-muted">
            {people.length} {plural(people.length, "людина", "людини", "людей")}
          </p>
          {people.map((p) => (
            <Link key={p.id} href={`/u/${p.id}`}>
              <Card className="flex items-center gap-3 p-3">
                <Avatar emoji={p.emoji} gradient={p.gradient} src={p.avatar} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-bold">{p.name}</p>
                  <p className="truncate text-[12px] text-muted">@{p.handle}</p>
                </div>
                <span className="shrink-0 text-[11.5px] text-faint">
                  {compactNumber(p.followers)} підп.
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
