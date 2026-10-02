"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/form";
import { api, errorMessage, publicApi } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { useQuery } from "@/lib/use-query";

export default function InvitationPage() {
  const { token } = useParams<{ token: string }>();
  const { user, status, logout } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const invite = useQuery(() => publicApi.GET("/api/v1/invitations/{token}", { params: { path: { token } } }), [token]);

  async function accept() {
    const { data, error } = await api.POST("/api/v1/invitations/{token}/accept", { params: { path: { token } } });
    if (!data) return setError(errorMessage(error));
    router.replace(`/w/${data.id}`);
  }

  async function decline() {
    const { error } = await api.POST("/api/v1/invitations/{token}/decline", { params: { path: { token } } });
    if (error) return setError(errorMessage(error));
    router.replace("/dashboard");
  }

  const next = encodeURIComponent(`/invitations/${token}`);
  const i = invite.data;
  const wrongAccount = !!(i && user && user.email.toLowerCase() !== i.email.toLowerCase());

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight">Synqonix</Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 pb-16">
        {invite.loading || status === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading invitation…</p>
        ) : !i ? (
          <Alert>{invite.error ?? "This invitation is not valid."}</Alert>
        ) : (
          <Card className="grid gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Join {i.workspaceName}</h1>
              <p className="text-sm text-muted-foreground">
                {i.inviterName} invited <strong>{i.email}</strong> as {i.role.toLowerCase()}.
              </p>
            </div>
            {error && <Alert>{error}</Alert>}
            {status !== "authenticated" ? (
              <div className="flex gap-3">
                <Button asChild><Link href={`/register?next=${next}&email=${encodeURIComponent(i.email)}`}>Create account</Link></Button>
                <Button asChild variant="outline"><Link href={`/login?next=${next}`}>Sign in</Link></Button>
              </div>
            ) : wrongAccount ? (
              <div className="grid gap-3">
                <Alert>You are signed in as {user?.email}. Sign in with {i.email} to accept.</Alert>
                <Button variant="outline" className="w-fit" onClick={() => void logout().then(() => router.replace(`/login?next=${next}`))}>Switch account</Button>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button onClick={() => void accept()}>Accept invitation</Button>
                <Button variant="outline" onClick={() => void decline()}>Decline</Button>
              </div>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}
