"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth/auth-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, status, logout, retry } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>We could not reach Synqonix. Your session is still saved.</p>
        <Button variant="outline" size="sm" onClick={retry}>Try again</Button>
      </div>
    );
  }
  if (status !== "authenticated" || !user) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/dashboard" className="font-semibold tracking-tight">Synqonix</Link>
          <Link href="/settings/profile" className="text-muted-foreground hover:text-foreground">Profile</Link>
          <Link href="/settings/security" className="text-muted-foreground hover:text-foreground">Security</Link>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{user.email}</span>
          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={() => void logout().then(() => router.replace("/login"))}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
