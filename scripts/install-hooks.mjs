/**
 * Вмикає git-хуки з .githooks: коміт у main сам пушиться на GitHub,
 * а кожен пуш деплоїть GitHub Actions (.github/workflows/deploy.yml).
 *
 * Запускається сам на npm install (скрипт prepare).
 */
import { execFileSync } from "node:child_process";

// Vercel виконує npm install під час збірки. Хуки там ні до чого, а збірка
// не повинна залежати від того, чи є поруч git.
if (process.env.CI || process.env.VERCEL) process.exit(0);

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  console.log("✓ git-хуки увімкнено: коміт у main сам пушиться й деплоїться");
} catch {
  // Немає git або це не робоча копія — вмикати нічого.
}
