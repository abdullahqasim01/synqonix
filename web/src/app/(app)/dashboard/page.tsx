"use client";

import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { useAuth } from "@/lib/auth/auth-context";

export default function DashboardPage() {
  const { user } = useAuth();
  return (
    <div className="grid gap-6">
      <VerifyEmailBanner />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hi, {user?.name}</h1>
        <p className="text-muted-foreground">Workspaces and projects arrive in the next phase.</p>
      </div>
    </div>
  );
}
