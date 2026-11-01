"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, Field, Input, Select } from "@/components/ui/form";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { TYPE_INFO, type NotificationType } from "@/lib/notifications";
import { useQuery } from "@/lib/use-query";

type Prefs = Schemas["PreferencesDto"];

const MODES = [
  { value: "INSTANT", label: "Instantly", hint: "One email as things happen" },
  { value: "DIGEST", label: "Hourly digest", hint: "At most one summary email an hour" },
  { value: "OFF", label: "Never", hint: "Only show notifications in the app" },
] as const;

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

export default function NotificationSettingsPage() {
  const loaded = useQuery(() => api.GET("/api/v1/notifications/preferences"), []);
  const projects = useQuery(async () => {
    const ws = await api.GET("/api/v1/workspaces");
    if (!ws.data) return { error: ws.error };
    const lists = await Promise.all(ws.data.map(async (w) => ({
      workspace: w.name, projects: (await api.GET("/api/v1/workspaces/{workspaceId}/projects", { params: { path: { workspaceId: w.id } } })).data ?? [],
    })));
    return { data: lists };
  }, []);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- copy the loaded settings into an editable draft
    if (loaded.data) setPrefs(loaded.data);
  }, [loaded.data]);

  if (loaded.loading || !prefs) return <p className="text-sm text-muted-foreground">{loaded.error ?? "Loading…"}</p>;

  const setType = (type: string, key: "inApp" | "email", value: boolean) =>
    setPrefs({ ...prefs, types: prefs.types.map((t) => (t.type === type ? { ...t, [key]: value } : t)) });
  const toggleMute = (id: string, muted: boolean) =>
    setPrefs({ ...prefs, mutedProjectIds: muted ? [...prefs.mutedProjectIds, id] : prefs.mutedProjectIds.filter((p) => p !== id) });

  async function save() {
    const { data, error } = await api.PUT("/api/v1/notifications/preferences", { body: prefs! });
    if (!data) return setMsg({ ok: false, text: errorMessage(error) });
    setPrefs(data);
    setMsg({ ok: true, text: "Saved." });
  }

  const q = prefs.quietHours;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Notification settings</h1>
      {msg && <Alert variant={msg.ok ? "success" : "error"}>{msg.text}</Alert>}

      <Card>
        <h2 className="mb-1 font-medium">Email</h2>
        <p className="mb-3 text-sm text-muted-foreground">How often to email you about the things ticked in the table below.</p>
        <div role="radiogroup" aria-label="Email frequency" className="grid gap-2">
          {MODES.map((m) => (
            <label key={m.value} className="flex items-start gap-2 text-sm">
              <input type="radio" name="emailMode" checked={prefs.emailMode === m.value} onChange={() => setPrefs({ ...prefs, emailMode: m.value })} className="mt-1" />
              <span><span className="font-medium">{m.label}</span> <span className="text-muted-foreground">— {m.hint}</span></span>
            </label>
          ))}
        </div>
        <div className="mt-5 grid gap-3 border-t border-border pt-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={q.enabled} onChange={(e) => setPrefs({ ...prefs, quietHours: { ...q, enabled: e.target.checked } })} />
            Quiet hours
          </label>
          <p className="-mt-2 text-xs text-muted-foreground">Emails wait until quiet hours end. The in-app inbox is not affected.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="From" htmlFor="q-start"><Input id="q-start" type="time" value={q.start} disabled={!q.enabled} onChange={(e) => setPrefs({ ...prefs, quietHours: { ...q, start: e.target.value } })} /></Field>
            <Field label="Until" htmlFor="q-end"><Input id="q-end" type="time" value={q.end} disabled={!q.enabled} onChange={(e) => setPrefs({ ...prefs, quietHours: { ...q, end: e.target.value } })} /></Field>
            <Field label="Time zone" htmlFor="q-tz">
              <Select id="q-tz" value={q.timezone} disabled={!q.enabled} onChange={(e) => setPrefs({ ...prefs, quietHours: { ...q, timezone: e.target.value } })}>
                {[...new Set([q.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, ...zones()])].map((z) => <option key={z} value={z}>{z}</option>)}
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-medium">What to tell me about</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground"><th className="pb-2 font-normal">Event</th><th className="w-20 pb-2 font-normal">In app</th><th className="w-20 pb-2 font-normal">Email</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {prefs.types.map((t) => {
              const info = TYPE_INFO[t.type as NotificationType];
              return (
                <tr key={t.type}>
                  <td className="py-2"><span className="font-medium">{info.label}</span><span className="block text-xs text-muted-foreground">{info.hint}</span></td>
                  <td><input type="checkbox" aria-label={`${info.label}: in app`} checked={t.inApp} onChange={(e) => setType(t.type, "inApp", e.target.checked)} /></td>
                  <td><input type="checkbox" aria-label={`${info.label}: email`} checked={t.email} disabled={prefs.emailMode === "OFF"} onChange={(e) => setType(t.type, "email", e.target.checked)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="mb-1 font-medium">Muted projects</h2>
        <p className="mb-3 text-sm text-muted-foreground">You will not be notified about anything in these projects.</p>
        <div className="grid gap-3">
          {projects.data?.map((g) => g.projects.length > 0 && (
            <div key={g.workspace}>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.workspace}</h3>
              <ul className="grid gap-1">
                {g.projects.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={prefs.mutedProjectIds.includes(p.id)} onChange={(e) => toggleMute(p.id, e.target.checked)} />
                      {p.name} <span className="text-xs text-muted-foreground">{p.key}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <div><Button onClick={() => void save()}>Save settings</Button></div>
    </div>
  );
}
