"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./auth-context";
import { safeNext } from "./next";

/** For login/register pages: send signed-in users to `?next=` (or the dashboard). Needs <Suspense>. */
export function useRedirectIfAuthenticated() {
  const { status } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, router, next]);
  return next;
}
