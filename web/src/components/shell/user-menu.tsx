"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Shield, User as UserIcon, Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth/auth-context";

export function UserMenu({ placement = "below" }: { placement?: "below" | "right" }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!user) return null;
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted";
  return (
    <div ref={box} className="relative">
      <button aria-label="Account menu" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} className="rounded-full ring-offset-2 ring-offset-rail focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar name={user.name} size={34} rounded="full" />
      </button>
      {open && (
        <div role="menu" className={placement === "right" ? "absolute bottom-0 left-full z-50 ml-3 w-64 rounded-xl border border-border bg-background p-1.5 text-foreground shadow-xl" : "absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-background p-1.5 shadow-xl"}>
          <div className="flex items-center gap-3 px-2.5 py-2">
            <Avatar name={user.name} size={36} rounded="full" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="my-1 border-t border-border" />
          <Link role="menuitem" href="/settings/profile" className={item} onClick={() => setOpen(false)}><UserIcon className="h-4 w-4" /> Profile</Link>
          <Link role="menuitem" href="/settings/security" className={item} onClick={() => setOpen(false)}><Shield className="h-4 w-4" /> Security &amp; API tokens</Link>
          <Link role="menuitem" href="/settings/notifications" className={item} onClick={() => setOpen(false)}><Bell className="h-4 w-4" /> Notification settings</Link>
          <div className="my-1 border-t border-border" />
          <button role="menuitem" className={item} onClick={() => void logout().then(() => router.replace("/login"))}><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
      )}
    </div>
  );
}
