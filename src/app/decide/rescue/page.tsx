"use client";

import { motion } from "framer-motion";
import { Plus, ShoppingBasket, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, Card, EmptyState } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { rescueMatches, type RescueMatch, suggestable } from "@/lib/matching";
import { useApp } from "@/lib/store";
import type { PantryItem } from "@/lib/types";
import { expiryInfo, formatMinutes, plural } from "@/lib/utils";

/**
 * Страви за строками придатності.
 *
 * «Що в холодильнику» відповідає на питання «що я можу приготувати». Тут
 * питання інше: «що я маю приготувати сьогодні, поки воно не пропало». Тому
 * і порядок інший — наперед виходить не найзручніша страва, а та, що рятує
 * найбільше й найтерміновіше.
 */
export default function RescuePage() {
  const hydrated = useApp((s) => s.hydrated);
  const pantry = useApp((s) => s.pantry);
  const myRecipes = useApp((s) => s.myRecipes);

  const { matches, expiring, expired } = useMemo(() => {
    if (!hydrated) return { matches: [], expiring: [], expired: [] };

    const soon: PantryItem[] = [];
    const gone: PantryItem[] = [];
    for (const item of pantry) {
      const exp = expiryInfo(item.expiresAt);
      if (!exp) continue;
      if (exp.tone === "expired") gone.push(item);
      else if (exp.tone === "soon") soon.push(item);
    }
    soon.sort((a, b) => (expiryInfo(a.expiresAt)?.days ?? 0) - (expiryInfo(b.expiresAt)?.days ?? 0));

    return {
      matches: rescueMatches(suggestable(useApp.getState()), pantry),
      expiring: soon,
      expired: gone,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, pantry, myRecipes]);

  if (hydrated && expiring.length === 0) {
    return (
      <div className="pb-8">
        <TopBar title="Врятувати продукт" />
        <EmptyState
          emoji="🌿"
          title="Нічого не горить"
          note={
            pantry.some((p) => p.expiresAt)
              ? "Жоден продукт не псується найближчими днями. Заходь, коли строк почне спливати."
              : "Тут з'являться страви для продуктів, чий строк спливає. Щоб це працювало, вкажи дати на картках продуктів у коморі."
          }
          action={
            <Link href="/pantry">
              <Button>
                <Plus size={17} />
                До комори
              </Button>
            </Link>
          }
        />
        {expired.length > 0 && <ExpiredNote items={expired} />}
      </div>
    );
  }

  return (
    <div className="pb-8">
      <TopBar
        title="Врятувати продукт"
        subtitle={`${expiring.length} ${plural(expiring.length, "продукт псується", "продукти псуються", "продуктів псуються")}`}
      />

      {/* Що саме горить — щоб було видно, заради чого все це. */}
      <section className="px-4 pt-4">
        <Card className="border-brand-2/40 p-4">
          <h2 className="mb-2.5 text-[12px] font-bold uppercase tracking-wide text-muted">
            Треба з'їсти
          </h2>
          <div className="flex flex-wrap gap-2">
            {expiring.map((item) => {
              const def = ing(item.key);
              const exp = expiryInfo(item.expiresAt);
              return (
                <span
                  key={item.key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-2/50 bg-brand-2/10 px-3 py-1.5 text-[13px] font-semibold"
                >
                  <span>{def.emoji}</span>
                  {def.label}
                  <span className="text-[10.5px] font-bold text-brand-2">{exp?.label}</span>
                </span>
              );
            })}
          </div>
        </Card>
      </section>

      <div className="flex flex-col gap-3 px-4 pt-4">
        {matches.length === 0 ? (
          <EmptyState
            emoji="🤷"
            title="Жодна страва їх не бере"
            note="У рецептах немає цих продуктів. Пошукай страву вручну або додай свій рецепт — наступного разу він тут з'явиться."
            action={
              <Link href="/explore">
                <Button variant="secondary">До пошуку</Button>
              </Link>
            }
          />
        ) : (
          matches.map((match, i) => <RescueCard key={match.recipe.id} match={match} index={i} />)
        )}
      </div>

      {expired.length > 0 && <ExpiredNote items={expired} />}
    </div>
  );
}

/**
 * Прострочене показуємо окремо й без рецептів.
 *
 * Це не прискіпливість: підказати страву з простроченого кефіру означає
 * порадити людині отруїтись, і жоден відсоток збігу цього не виправдає.
 */
function ExpiredNote({ items }: { items: PantryItem[] }) {
  return (
    <section className="px-4 pt-6">
      <Card className="flex items-start gap-3 border-berry/40 bg-berry/5 p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-berry/15 text-berry">
          <TriangleAlert size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold">
            {items.length} {plural(items.length, "продукт", "продукти", "продуктів")} уже
            прострочено
          </p>
          <p className="mt-1 text-[12px] leading-snug text-muted">
            Їх ми не рятуємо — це вже не про вечерю. Прибери їх з комори, щоб підбір страв не
            розраховував на те, чого немає.
          </p>
          <Link href="/pantry">
            <Button size="sm" variant="secondary" className="mt-2.5">
              <Trash2 size={15} />
              Розібрати комору
            </Button>
          </Link>
        </div>
      </Card>
    </section>
  );
}

function RescueCard({ match, index }: { match: RescueMatch; index: number }) {
  const { recipe, saves, missing } = match;
  // Найтерміновіший продукт задає тон картці: саме через нього вона тут.
  const soonest = Math.min(...saves.map((s) => s.days));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
    >
      <Card className="overflow-hidden p-0">
        <Link href={`/recipe/${recipe.id}`} className="flex gap-3 p-3">
          <RecipeMedia
            recipe={recipe}
            className="h-[72px] w-[72px] shrink-0"
            rounded="rounded-2xl"
            emojiSize="text-3xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 font-display text-[15px] font-bold leading-tight">
                {recipe.title}
              </h3>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                  soonest === 0 ? "bg-berry/15 text-berry" : "bg-brand-2/15 text-brand-2"
                }`}
              >
                {soonest === 0 ? "сьогодні" : soonest === 1 ? "завтра" : `${soonest} дні`}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] text-muted">
              {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
            </p>

            <p className="mt-2 mb-1 text-[11px] font-bold text-mint">
              Врятує {saves.length}:
            </p>
            <div className="flex flex-wrap gap-1">
              {saves.map((s) => (
                <span
                  key={s.key}
                  className="inline-flex items-center gap-1 rounded-full bg-mint/15 px-2 py-0.5 text-[11px] font-semibold text-mint"
                >
                  {ing(s.key).emoji} {ing(s.key).label}
                </span>
              ))}
            </div>

            {missing.length > 0 && (
              <p className="mt-2 flex items-center gap-1 text-[11px] text-muted">
                <ShoppingBasket size={11} />
                Бракує: {missing.slice(0, 3).map((k) => ing(k).label).join(", ")}
                {missing.length > 3 && ` +${missing.length - 3}`}
              </p>
            )}
          </div>
        </Link>
      </Card>
    </motion.div>
  );
}
