"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, Field, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name"));
    const { data, error } = await api.PATCH("/api/v1/users/me", { body: { name } });
    if (data) {
      setUser(data);
      setMsg({ ok: true, text: "Profile updated." });
    } else {
      setMsg({ ok: false, text: errorMessage(error) });
    }
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      <Card>
        <form onSubmit={onSubmit} className="grid max-w-sm gap-4">
          {msg && <Alert variant={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
          <Field label="Email" htmlFor="email">
            <Input id="email" value={user?.email ?? ""} disabled readOnly />
          </Field>
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" defaultValue={user?.name} required maxLength={100} />
          </Field>
          <Button type="submit" className="w-fit">Save</Button>
        </form>
      </Card>
    </div>
  );
}
