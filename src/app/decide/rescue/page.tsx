"use client";

import { motion } from "framer-motion";
import { ChevronRight, Plus, ShoppingBasket, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { RecipeMedia } from "@/components/RecipeCard";
import { TopBar } from "@/components/TopBar";
import { Button, EmptyState, Panel, PanelHeader } from "@/components/ui";
import { ing } from "@/data/ingredients";
import { rescueMatches, type RescueMatch, suggestable } from "@/lib/matching";
import { pantryDisplayName } from "@/lib/pantry";
import { useApp } from "@/lib/store";
import type { PantryItem } from "@/lib/types";
import { cn, expiryInfo, formatMinutes, plural } from "@/lib/utils";

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
  // Строк переходить на загальніші типи через каталог — і з ним перераховується.
  const customIngredients = useApp((s) => s.customIngredients);
  // Назва пачки — з картки товару, коли вона є: «Кефір Яготинський», а не просто «Кефір».
  const products = useApp((s) => s.products);

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
  }, [hydrated, pantry, myRecipes, customIngredients]);

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
        {expired.length > 0 && (
          <div className="px-4">
            <ExpiredNote items={expired} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pb-8">
      {/* Лічильник — у заголовку панелі нижче: довга назва з ним у шапці не вміщалась. */}
      <TopBar title="Врятувати продукт" />

      <div className="flex flex-col gap-2.5 px-4">
        {/* Що саме горить — щоб було видно, заради чого все це. */}
        <Panel>
          <PanelHeader
            label="Треба з'їсти"
            aside={`${expiring.length} ${plural(expiring.length, "продукт псується", "продукти псуються", "продуктів псуються")}`}
          />
          {expiring.map((item) => {
            const def = ing(item.key);
            const exp = expiryInfo(item.expiresAt);
            return (
              <div
                // Дві пачки одного типу з різними строками — два рядки: ключ типу не унікальний.
                key={item.id}
                className="flex h-12 items-center gap-3 border-t border-line px-3.5"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-brand-2/15 text-[17px]">
                  {def.emoji}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                  {pantryDisplayName(item, products)}
                </span>
                <span className="shrink-0 text-[12.5px] font-bold text-brand-2">{exp?.label}</span>
              </div>
            );
          })}
        </Panel>

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
          <Panel>
            <PanelHeader
              label="Що приготувати"
              tone="brand"
              aside={`${matches.length} ${plural(matches.length, "страва", "страви", "страв")}`}
            />
            {matches.map((match, i) => (
              <RescueCard key={match.recipe.id} match={match} index={i} />
            ))}
          </Panel>
        )}

        {expired.length > 0 && <ExpiredNote items={expired} />}
      </div>
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
    <Panel className="border-berry/35">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-berry/15 text-berry">
          <TriangleAlert size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-bold">
            {items.length} {plural(items.length, "продукт", "продукти", "продуктів")} уже
            прострочено
          </p>
          <p className="mt-0.5 text-[12.5px] font-semibold leading-snug text-muted">
            Їх ми не рятуємо — це вже не про вечерю. Прибери їх з комори, щоб підбір страв не
            розраховував на те, чого немає.
          </p>
        </div>
      </div>
      <Link href="/pantry" className="flex h-12 items-center gap-2.5 border-t border-line px-3.5 active:bg-surface-2">
        <Trash2 size={16} strokeWidth={2.2} className="text-brand" />
        <span className="flex-1 text-[14px] font-bold text-brand">Розібрати комору</span>
        <ChevronRight size={15} strokeWidth={2.2} className="text-faint" />
      </Link>
    </Panel>
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
      <Link
        href={`/recipe/${recipe.id}`}
        className="flex gap-3 border-t border-line px-3.5 py-3 active:bg-surface-2"
      >
        <RecipeMedia
          recipe={recipe}
          className="h-14 w-14 shrink-0"
          rounded="rounded-[8px]"
          emojiSize="text-[28px]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-[15px] font-extrabold leading-tight">{recipe.title}</h3>
            <span
              className={cn(
                "flex h-5 shrink-0 items-center rounded-[5px] px-1.5 text-[11px] font-extrabold",
                soonest === 0 ? "bg-berry/15 text-berry" : "bg-brand-2/15 text-brand-2",
              )}
            >
              {soonest === 0 ? "сьогодні" : soonest === 1 ? "завтра" : `${soonest} дні`}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] font-semibold text-muted">
            {formatMinutes(recipe.timeMin)} · {recipe.cuisine}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[11.5px] font-extrabold text-brand">Врятує {saves.length}:</span>
            {saves.map((s) => (
              <span
                key={s.key}
                className="inline-flex h-[22px] items-center gap-1 rounded-[6px] bg-brand/10 px-[7px] text-[11.5px] font-bold text-brand"
              >
                {ing(s.key).emoji} {ing(s.key).label}
              </span>
            ))}
          </div>

          {missing.length > 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-[11.5px] font-semibold text-faint">
              <ShoppingBasket size={12} className="shrink-0" />
              <span className="truncate">
                Бракує: {missing.slice(0, 3).map((k) => ing(k).label).join(", ")}
                {missing.length > 3 && ` +${missing.length - 3}`}
              </span>
            </p>
          )}
        </div>
      </Link>
    </motion.div>
  );
}
