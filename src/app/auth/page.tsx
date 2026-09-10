"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthScreen } from "@/components/AuthScreen";
import { useApp } from "@/lib/store";

export default function AuthPage() {
  const router = useRouter();
  const account = useApp((s) => s.account);

  // Щойно зʼявилась сесія — вертаємось у застосунок.
  useEffect(() => {
    if (account) router.replace("/me");
  }, [account, router]);

  return <AuthScreen />;
}
