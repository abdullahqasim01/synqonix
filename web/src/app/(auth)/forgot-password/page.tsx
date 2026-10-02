"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { errorMessage, publicApi } from "@/lib/api/client";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    setBusy(true);
    setError(null);
    const { error } = await publicApi.POST("/api/v1/auth/forgot-password", { body: { email } });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else setSent(true);
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">We will email you a reset link.</p>
      </div>
      {sent ? (
        <Alert variant="success">If an account exists for that email, a reset link is on its way.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
        </form>
      )}
      <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">Back to sign in</Link>
    </>
  );
}
