"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { Avatar } from "@/components/ui";
import { settingsOf } from "@/lib/diary";
import { diaryUserId, useApp } from "@/lib/store";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Людина за столом: хто вона, який апетит і чи це я. */
export interface Person {
  userId: string;
  profile: Profile;
  appetite: number;
  shareDiary: boolean;
  me: boolean;
}

/**
 * Хто їсть: я першим, далі сімʼя. Без сімʼї — лише я: тоді щоденник
 * поводиться як звичайний особистий.
 */
export function usePeople(): Person[] {
  const account = useApp((s) => s.account);
  const profile = useApp((s) => s.profile);
  const members = useApp((s) => s.familyMembers);
  const settings = useApp((s) => s.diarySettings);

  return useMemo(() => {
    const me = diaryUserId({ account });
    const person = (userId: string, p: Profile, isMe: boolean): Person => {
      const s = settingsOf(settings, userId);
      return { userId, profile: p, appetite: s.appetite, shareDiary: s.shareDiary, me: isMe };
    };
    return [
      person(me, profile, true),
      ...members.filter((m) => m.userId !== me).map((m) => person(m.userId, m.profile, false)),
    ];
  }, [account, profile, members, settings]);
}

/** Імʼя для підпису: «Я» для себе, інакше перше слово імені. */
export function personName(person: Person): string {
  if (person.me) return "Я";
  return person.profile.name.split(/\s+/)[0] || person.profile.handle || "Хтось";
}

export function PersonAvatar({ person, size = 32, ring }: { person: Person; size?: number; ring?: boolean }) {
  return (
    <Avatar
      emoji={person.profile.emoji}
      gradient={person.profile.gradient}
      src={person.profile.avatar}
      size={size}
      ring={ring}
    />
  );
}

/** Рядок аватарок-перемикачів: «чий щоденник» чи «кому записати». */
export function PeopleSwitch({
  people,
  value,
  onChange,
  className,
}: {
  people: readonly Person[];
  value: string;
  onChange: (userId: string) => void;
  className?: string;
}) {
  if (people.length < 2) return null;
  return (
    <div
      className={cn(
        "no-scrollbar flex h-11 overflow-x-auto rounded-[10px] border border-line bg-surface p-[3px]",
        className,
      )}
    >
      {people.map((p) => {
        const active = p.userId === value;
        return (
          <button
            key={p.userId}
            onClick={() => onChange(p.userId)}
            aria-pressed={active}
            className="relative flex min-w-[96px] flex-1 items-center justify-center rounded-[7px] px-3"
          >
            {active && (
              <motion.span
                layoutId="people-switch"
                transition={{ type: "spring", stiffness: 480, damping: 38 }}
                className="absolute inset-0 rounded-[7px] bg-line shadow-[0_4px_14px_-4px_rgb(0_0_0_/_0.7)] light:shadow-none"
              />
            )}
            <span
              className={cn(
                "relative z-10 flex min-w-0 items-center gap-2 text-[13.5px] font-extrabold transition-colors",
                active ? "text-ink" : "text-muted",
              )}
            >
              <PersonAvatar person={p} size={26} />
              <span className="truncate">{personName(p)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
