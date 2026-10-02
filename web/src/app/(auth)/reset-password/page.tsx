"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { errorMessage, publicApi } from "@/lib/api/client";

function ResetForm() {
  const token = useSearchParams().get("token");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setBusy(true);
    setError(null);
    const { error } = await publicApi.POST("/api/v1/auth/reset-password", { body: { token: token ?? "", password } });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else setDone(true);
  }

  if (!token) return <Alert>This reset link is missing its token.</Alert>;
  if (done) {
    return (
      <Alert variant="success">
        Password updated. <Link href="/login" className="underline">Sign in</Link> with your new password.
      </Alert>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {error && <Alert>{error}</Alert>}
      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
      </Field>
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Set new password"}</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </>
  );
}
