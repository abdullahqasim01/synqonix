"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/form";
import { useAuth } from "@/lib/auth/auth-context";
import { useRedirectIfAuthenticated } from "@/lib/auth/use-redirect-if-authenticated";

export default function RegisterPage() {
  useRedirectIfAuthenticated();
  const { register } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await register({
        name: String(form.get("name")),
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">Start managing projects like a developer.</p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required maxLength={100} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
        </Field>
        <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Already have an account? <Link href="/login" className="text-foreground underline">Sign in</Link>
      </p>
    </>
  );
}
