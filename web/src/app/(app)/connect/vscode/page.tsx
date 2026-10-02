"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api/client";
import { callbackUrl, parseState, schemeFrom } from "@/lib/vscode-connect";

function Connect() {
  const params = useSearchParams();
  const state = parseState(params.get("state"));
  const scheme = schemeFrom(params.get("scheme"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function approve() {
    if (!state) return;
    setBusy(true);
    setError(null);
    const label = `VS Code (${new Date().toISOString().slice(0, 10)})`;
    const { data, error: err } = await api.POST("/api/v1/api-tokens", { body: { name: label } });
    setBusy(false);
    if (!data) return setError(errorMessage(err));
    const url = callbackUrl(data.token, state, scheme);
    setDone(url);
    window.location.assign(url);
  }

  if (!state) {
    return (
      <Card>
        <h1 className="mb-2 text-lg font-semibold">Connect VS Code</h1>
        <Alert variant="error">This link is not valid. Start again from the Synqonix extension (“Synqonix: Sign in”).</Alert>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-2 text-lg font-semibold">Connect VS Code?</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        This creates a personal API token so the Synqonix extension can read and update your tasks as you. You can revoke it any time under
        Settings → Security.
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      {done ? (
        <p className="text-sm text-muted-foreground">
          Connected. If VS Code did not open, <a className="underline" href={done}>open it manually</a>. You can close this tab.
        </p>
      ) : (
        <Button onClick={() => void approve()} disabled={busy}>{busy ? "Connecting…" : "Connect VS Code"}</Button>
      )}
    </Card>
  );
}

export default function ConnectVsCodePage() {
  return (
    <div className="mx-auto max-w-md">
      <Suspense fallback={null}>
        <Connect />
      </Suspense>
    </div>
  );
}
