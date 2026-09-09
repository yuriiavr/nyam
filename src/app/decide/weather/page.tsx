"use client";

import { motion } from "framer-motion";
import { MapPin, RotateCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RecipeRow } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, Card, EmptyState, Spinner } from "@/components/ui";
import { applyFilters, emptyFilters, weatherHint, type WeatherHint } from "@/lib/matching";
import { allRecipes, useApp } from "@/lib/store";
import { haptic, shuffle } from "@/lib/utils";

type Status = "idle" | "locating" | "loading" | "ready" | "manual";

const MANUAL_OPTIONS: Array<{ emoji: string; label: string; temp: number; code: number }> = [
  { emoji: "❄️", label: "Мороз", temp: -5, code: 71 },
  { emoji: "🌧️", label: "Дощ і сіро", temp: 8, code: 61 },
  { emoji: "🌤️", label: "Прохолодно", temp: 12, code: 1 },
  { emoji: "☀️", label: "Тепло", temp: 20, code: 0 },
  { emoji: "🥵", label: "Спека", temp: 30, code: 0 },
];

export default function WeatherPage() {
  const state = useApp();
  const hydrated = useApp((s) => s.hydrated);

  const [status, setStatus] = useState<Status>("idle");
  const [temp, setTemp] = useState<number | null>(null);
  const [code, setCode] = useState<number>(0);
  const [error, setError] = useState("");
  const [seed, setSeed] = useState(0);

  const hint: WeatherHint | null = temp == null ? null : weatherHint(temp, code);

  const fetchWeather = useCallback(async (lat: number, lon: number) => {
    setStatus("loading");
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&current=temperature_2m,weather_code&timezone=auto`,
        { signal: AbortSignal.timeout(9000) },
      );
      if (!res.ok) throw new Error("bad response");
      const json = (await res.json()) as {
        current?: { temperature_2m?: number; weather_code?: number };
      };
      const t = json.current?.temperature_2m;
      if (typeof t !== "number") throw new Error("no data");
      setTemp(t);
      setCode(json.current?.weather_code ?? 0);
      setStatus("ready");
      haptic(12);
    } catch {
      setError("Не вдалося отримати погоду. Обери умови вручну.");
      setStatus("manual");
    }
  }, []);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Геолокація недоступна. Обери погоду вручну.");
      setStatus("manual");
      return;
    }
    setStatus("locating");
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
      () => {
        setError("Доступ до геолокації заборонено. Обери погоду вручну.");
        setStatus("manual");
      },
      { timeout: 9000, maximumAge: 600_000 },
    );
  }, [fetchWeather]);

  useEffect(() => {
    locate();
  }, [locate]);

  const results = useMemo(() => {
    if (!hydrated || !hint) return [];
    const matched = applyFilters(state, { ...emptyFilters, moods: hint.moods });
    const list = matched.length >= 4 ? matched : allRecipes(state);
    return shuffle(list).slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, hint?.title, seed, state.myRecipes]);

  return (
    <div className="pb-8">
      <TopBar
        title="Що їсти за погодою"
        subtitle={hint ? hint.title : "Визначаємо умови"}
        right={
          hint ? (
            <button
              onClick={() => {
                haptic(12);
                setSeed((s) => s + 1);
              }}
              aria-label="Оновити добірку"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2"
            >
              <RotateCw size={17} />
            </button>
          ) : undefined
        }
      />

      <div className="px-4 pt-4">
        {(status === "locating" || status === "loading") && (
          <Card className="flex items-center gap-3 p-4">
            <Spinner />
            <p className="text-[13.5px] text-muted">
              {status === "locating" ? "Визначаю, де ти…" : "Дивлюсь погоду…"}
            </p>
          </Card>
        )}

        {status === "manual" && !hint && (
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-brand" />
              <h2 className="text-[14px] font-bold">Яка зараз погода?</h2>
            </div>
            {error && <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{error}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {MANUAL_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  onClick={() => {
                    haptic(12);
                    setTemp(o.temp);
                    setCode(o.code);
                    setStatus("ready");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3.5 py-2 text-[13px] font-semibold"
                >
                  <span>{o.emoji}</span>
                  {o.label}
                </button>
              ))}
            </div>
            <Button variant="ghost" full className="mt-3" onClick={locate}>
              Спробувати геолокацію ще раз
            </Button>
          </Card>
        )}

        {hint && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-xl3 border border-line bg-surface"
            style={{
              backgroundImage:
                "linear-gradient(140deg, color-mix(in oklab, var(--sky) 18%, transparent), transparent 62%)",
            }}
          >
            <div className="flex items-center gap-4 p-4">
              <span className="text-5xl">{hint.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[19px] font-extrabold leading-tight">
                  {hint.title}
                  {temp != null && status !== "manual" && (
                    <span className="ml-2 text-muted">{Math.round(temp)}°</span>
                  )}
                </p>
                <p className="mt-1 text-[13px] leading-snug text-muted">{hint.note}</p>
              </div>
            </div>
            <button
              onClick={() => {
                setStatus("manual");
                setTemp(null);
              }}
              className="w-full border-t border-line py-2.5 text-[12px] font-semibold text-muted"
            >
              Змінити погоду вручну
            </button>
          </motion.div>
        )}
      </div>

      {hint && (
        <section className="px-4 pt-6">
          <h2 className="mb-3 font-display text-[17px] font-bold">Підходить під таку погоду</h2>
          {results.length === 0 ? (
            <EmptyState emoji="🌦️" title="Нічого не знайшлось" />
          ) : (
            <div className="flex flex-col gap-2.5">
              {results.map((r, i) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.35) }}
                >
                  <RecipeRow recipe={r} href={`/recipe/${r.id}`} />
                </motion.div>
              ))}
            </div>
          )}
          <Link href="/decide">
            <Button variant="ghost" full className="mt-4">
              Інший спосіб вибору
            </Button>
          </Link>
        </section>
      )}
    </div>
  );
}
