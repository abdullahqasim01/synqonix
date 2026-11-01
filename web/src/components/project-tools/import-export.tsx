"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, Select } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type Project = Schemas["ProjectDetailDto"];
type Result = Schemas["ImportResultDto"];

const SOURCES = [
  { value: "csv", label: "Spreadsheet (CSV)" },
  { value: "jira", label: "Jira CSV export" },
  { value: "github", label: "GitHub issues CSV" },
  { value: "synqonix", label: "Synqonix export (CSV or JSON)" },
] as const;

/** Download the project's tasks, or import them from a file with a preview and a row-by-row report. */
export function ImportExport({ project, onImported }: { project: Project; onImported: () => void }) {
  const path = { workspaceId: project.workspaceId, projectId: project.id };
  const { workspace } = useWorkspace();
  const canImport = workspace.role !== "VIEWER";
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<(typeof SOURCES)[number]["value"]>("csv");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function download(format: "csv" | "json") {
    const { data, error } = await api.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/export", { params: { path, query: { format } }, parseAs: "blob" });
    if (!data) return setError(errorMessage(error, "Export failed"));
    const url = URL.createObjectURL(data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.key.toLowerCase()}-tasks.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function upload(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    form.append("source", source);
    form.append("dryRun", String(dryRun));
    const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/import", {
      params: { path }, body: form as unknown as { file: string }, bodySerializer: (b: unknown) => b as FormData,
    });
    setBusy(false);
    if (!data) { setResult(null); return setError(errorMessage(error, "Import failed")); }
    setError(null);
    setResult(data);
    if (!dryRun && data.created > 0) onImported();
  }

  return (
    <Card aria-label="Import and export">
      <h2 className="mb-1 font-medium">Import and export</h2>
      <p className="mb-4 text-sm text-muted-foreground">Move tasks in or out as CSV or JSON. Importing the same file again does not create duplicates.</p>
      {error && <Alert>{error}</Alert>}
      <div className="mb-5 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void download("csv")}>Export CSV</Button>
        <Button size="sm" variant="outline" onClick={() => void download("json")}>Export JSON</Button>
      </div>
      {canImport && (
        <div className="grid gap-3 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Import tasks</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Import source" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            <input ref={input} type="file" accept=".csv,.json,text/csv,application/json" aria-label="File to import" className="text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!file || busy} onClick={() => void upload(true)}>Check file</Button>
            <Button size="sm" disabled={!file || busy || (result?.dryRun === true && result.created === 0)} onClick={() => void upload(false)}>{busy ? "Working…" : "Import"}</Button>
          </div>
        </div>
      )}
      {result && (
        <div className="mt-4 grid gap-3" role="region" aria-label="Import result">
          <p className="text-sm font-medium" data-testid="import-summary">
            {result.dryRun ? "Check only — nothing was imported. " : ""}
            {result.created} {result.dryRun ? "would be created" : "created"} · {result.skipped} already imported · {result.failed} failed · {result.warnings} warnings (of {result.total} rows)
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Columns used</summary>
            <ul className="mt-1 grid gap-0.5">{result.columns.map((c, i) => <li key={i}>{c.column} → <span className="font-mono">{c.field}</span></li>)}</ul>
          </details>
          {result.rows.length > 0 && (
            <table className="w-full text-xs" aria-label="Rows needing attention">
              <thead className="text-left text-muted-foreground"><tr><th className="py-1">Row</th><th>Result</th><th>Details</th></tr></thead>
              <tbody className="divide-y divide-border align-top">
                {result.rows.map((r) => (
                  <tr key={r.row}>
                    <td className="py-1 tabular-nums">{r.row}</td>
                    <td className={cn(r.status === "error" && "text-red-600")}>{r.status}{r.key ? ` ${r.key}` : ""}</td>
                    <td>{r.messages.map((m, i) => <div key={i} className={cn(m.level === "error" ? "text-red-600" : "text-muted-foreground")}>{m.text}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.truncated && <p className="text-xs text-muted-foreground">Only the first 500 rows with messages are shown.</p>}
        </div>
      )}
    </Card>
  );
}
