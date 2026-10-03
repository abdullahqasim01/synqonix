"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Field, Input } from "@/components/ui/form";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { api, errorMessage } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { useQuery } from "@/lib/use-query";

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const workspaces = useQuery(() => api.GET("/api/v1/workspaces"), []);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name"));
    const { data, error } = await api.POST("/api/v1/workspaces", { body: { name } });
    if (!data) return setError(errorMessage(error));
    router.push(`/w/${data.id}`);
  }

  return (
    <div className="grid gap-6">
      <VerifyEmailBanner />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hi, {user?.name}</h1>
        <p className="text-muted-foreground">Pick a workspace or create a new one.</p>
      </div>

      {workspaces.error && <Alert>{workspaces.error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {workspaces.data?.map((w) => (
          <Link key={w.id} href={`/w/${w.id}`}>
            <Card className="flex items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <Avatar name={w.name} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{w.name}</p>
                <p className="truncate text-xs text-muted-foreground">/{w.slug}</p>
              </div>
              <Badge className="capitalize">{w.role.toLowerCase()}</Badge>
            </Card>
          </Link>
        ))}
      </div>
      {workspaces.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">You are not in any workspace yet. Create one below, or open an invitation link.</p>
      )}

      <Card>
        <h2 className="mb-4 font-medium">Create a workspace</h2>
        <form onSubmit={onCreate} className="grid max-w-sm gap-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" required minLength={2} maxLength={60} placeholder="Acme Inc" />
          </Field>
          <Button type="submit" className="w-fit">Create workspace</Button>
        </form>
      </Card>
    </div>
  );
}
