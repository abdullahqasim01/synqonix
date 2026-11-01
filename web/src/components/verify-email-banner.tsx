"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";

export function VerifyEmailBanner() {
  const { user } = useAuth();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!user || user.emailVerified) return null;

  async function resend() {
    const { error } = await api.POST("/api/v1/auth/resend-verification");
    setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: "Verification email sent." });
  }

  return (
    <Alert variant="info">
      <div className="flex items-center justify-between gap-4">
        <span>Please verify your email address ({user.email}).</span>
        <Button size="sm" variant="outline" onClick={() => void resend()}>Resend email</Button>
      </div>
      {msg && <p className={msg.ok ? "mt-2 text-green-600" : "mt-2 text-red-600"}>{msg.text}</p>}
    </Alert>
  );
}
