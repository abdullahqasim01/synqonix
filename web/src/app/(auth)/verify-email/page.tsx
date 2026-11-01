"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/form";
import { errorMessage, publicApi } from "@/lib/api/client";

function Verify() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<{ kind: "working" } | { kind: "ok" } | { kind: "error"; message: string }>(
    token ? { kind: "working" } : { kind: "error", message: "This verification link is missing its token." },
  );
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return; // tokens are single-use; avoid double submit in dev
    started.current = true;
    void publicApi.POST("/api/v1/auth/verify-email", { body: { token } }).then(({ error }) => {
      setState(error ? { kind: "error", message: errorMessage(error) } : { kind: "ok" });
    });
  }, [token]);

  if (state.kind === "working") return <Alert variant="info">Verifying your email…</Alert>;
  if (state.kind === "error") return <Alert>{state.message}</Alert>;
  return (
    <Alert variant="success">
      Email verified. <Link href="/dashboard" className="underline">Continue to Synqonix</Link>
    </Alert>
  );
}

export default function VerifyEmailPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Email verification</h1>
      <Suspense>
        <Verify />
      </Suspense>
    </>
  );
}
