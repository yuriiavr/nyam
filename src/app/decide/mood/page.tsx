"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, RotateCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RecipeRow } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, EmptyState } from "@/components/ui";
import { applyFilters, emptyFilters } from "@/lib/matching";
import { allRecipes, useApp } from "@/lib/store";
import type { MealType, Mood } from "@/lib/types";
import { haptic, shuffle } from "@/lib/utils";

interface Option {
  emoji: string;
  label: string;
  note?: string;
  moods?: Mood[];
  maxTime?: number;
  meals?: MealType[];
  maxCost?: number;
}

interface Question {
  key: string;
  title: string;
  subtitle: string;
  options: Option[];
}

const QUESTIONS: Question[] = [
  {
    key: "hunger",
    title: "Наскільки ти голодний?",
    subtitle: "Від цього залежить розмір катастрофи",
    options: [
      { emoji: "🐜", label: "Трохи перекусити", note: "Легке і невелике", moods: ["fresh", "fast"] },
      { emoji: "🙂", label: "Нормально", note: "Звичайний прийом їжі", moods: [] },
      { emoji: "🦖", label: "Зʼїв би слона", note: "Щось дуже ситне", moods: ["hearty", "comfort"] },
    ],
  },
  {
    key: "time",
    title: "Скільки є часу?",
    subtitle: "Чесно, без ілюзій",
    options: [
      { emoji: "⚡", label: "15 хвилин", note: "Треба вже зараз", maxTime: 15 },
      { emoji: "⏱️", label: "Пів години", note: "Можу трохи почекати", maxTime: 30 },
      { emoji: "🧘", label: "Скільки треба", note: "Сьогодні я кухар", maxTime: undefined },
    ],
  },
  {
    key: "mood",
    title: "Який настрій?",
    subtitle: "Останнє питання",
    options: [
      { emoji: "🫂", label: "Хочу тепла", note: "Комфорт-фуд", moods: ["comfort", "cozy"] },
      { emoji: "🥗", label: "Хочу легкості", note: "Корисне і свіже", moods: ["healthy", "fresh"] },
      { emoji: "🌶️", label: "Хочу яскраво", note: "Гостре, з характером", moods: ["spicy", "fancy"] },
      { emoji: "🍭", label: "Хочу солодкого", note: "Життя коротке", moods: ["sweet"], meals: ["dessert", "snack"] },
      { emoji: "🪙", label: "Хочу дешево", note: "До зарплати далеко", moods: ["cheap"], maxCost: 1 },
      { emoji: "✨", label: "Хочу вразити", note: "Прийдуть гості", moods: ["fancy"] },
    ],
  },
];

export default function MoodPage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Option[]>([]);

  const results = useMemo(() => {
    if (!hydrated || step < QUESTIONS.length) return [];

    const moods = answers.flatMap((a) => a.moods ?? []);
    const meals = answers.flatMap((a) => a.meals ?? []);
    const times = answers.map((a) => a.maxTime).filter((t): t is number => t != null);
    const costs = answers.map((a) => a.maxCost).filter((c): c is number => c != null);

    const strict = applyFilters(state, {
      ...emptyFilters,
      moods,
      meals,
      maxTime: times.length ? Math.min(...times) : null,
      maxCost: costs.length ? Math.min(...costs) : null,
    });

    if (strict.length >= 3) return shuffle(strict).slice(0, 8);

    // Занадто вузько — послаблюємо до настрою або часу
    const loose = applyFilters(state, {
      ...emptyFilters,
      moods,
      maxTime: times.length ? Math.min(...times) : null,
    });
    if (loose.length >= 3) return shuffle(loose).slice(0, 8);

    return shuffle(allRecipes(state)).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, step, answers, state.myRecipes]);

  const answer = (opt: Option) => {
    haptic(14);
    setAnswers((prev) => [...prev, opt]);
    setStep((s) => s + 1);
  };

  const restart = () => {
    haptic(12);
    setAnswers([]);
    setStep(0);
  };

  const q = QUESTIONS[step];
  const done = step >= QUESTIONS.length;

  return (
    <div className="pb-8">
      <TopBar
        title="Вибір за настроєм"
        subtitle={done ? "Готово" : `Питання ${step + 1} з ${QUESTIONS.length}`}
        right={
          step > 0 ? (
            <button
              onClick={() => {
                haptic(8);
                setAnswers((a) => a.slice(0, -1));
                setStep((s) => s - 1);
              }}
              aria-label="Попереднє питання"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2"
            >
              <ArrowLeft size={17} />
            </button>
          ) : undefined
        }
      />

      {/* Прогрес */}
      <div className="flex gap-1.5 px-4 pt-4">
        {QUESTIONS.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < step ? "bg-brand" : i === step ? "bg-brand/40" : "bg-line"
            }`}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {!done ? (
          <motion.div
            key={q.key}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22 }}
            className="px-4 pt-7"
          >
            <h2 className="font-display text-2xl font-extrabold leading-tight">{q.title}</h2>
            <p className="mt-1.5 text-[13.5px] text-muted">{q.subtitle}</p>

            <div className="mt-6 flex flex-col gap-2.5">
              {q.options.map((o, i) => (
                <motion.button
                  key={o.label}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => answer(o)}
                  className="flex items-center gap-3.5 rounded-xl3 border border-line bg-surface p-4 text-left active:bg-surface-2"
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2 text-2xl">
                    {o.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">{o.label}</span>
                    {o.note && <span className="block text-[12px] text-muted">{o.note}</span>}
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-4 pt-6"
          >
            <div className="flex items-center gap-3 rounded-xl3 border border-line bg-surface p-4">
              <div className="flex -space-x-1 text-2xl">
                {answers.map((a) => (
                  <span key={a.label}>{a.emoji}</span>
                ))}
              </div>
              <p className="flex-1 text-[13px] leading-snug text-muted">
                {answers.map((a) => a.label.toLowerCase()).join(" · ")}
              </p>
            </div>

            <h2 className="mt-6 mb-3 font-display text-[17px] font-bold">
              Ось що підходить під твій настрій
            </h2>

            {results.length === 0 ? (
              <EmptyState emoji="🤷" title="Нічого не знайшлось" />
            ) : (
              <div className="flex flex-col gap-2.5">
                {results.map((r, i) => (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <RecipeRow recipe={r} href={`/recipe/${r.id}`} />
                  </motion.div>
                ))}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={restart}>
                <RotateCw size={16} />
                Ще раз
              </Button>
              <Link href="/decide" className="flex-1">
                <Button variant="ghost" full>
                  Інший спосіб
                </Button>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
