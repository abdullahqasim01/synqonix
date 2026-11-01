"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { commandEntries, moveSelection, resultEntries, type PaletteEntry } from "@/lib/command-palette";

/**
 * ⌘K / Ctrl+K: jump anywhere in the workspace or search it. Search understands filters such as
 * `assignee:me status:open label:bug`. Results come from the same permission-aware API as everything else.
 */
export function CommandPalette({ workspaceId, onCreateTask }: { workspaceId: string; onCreateTask(): void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaletteEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const close = () => { setOpen(false); setQuery(""); setResults([]); setSelected(0); };

  // Debounced search; answers that arrive out of order are dropped.
  useEffect(() => {
    const q = query.trim();
    const id = ++latest.current;
    if (!open || q.length === 0) return;
    const timer = setTimeout(() => {
      setSearching(true);
      void api.GET("/api/v1/workspaces/{workspaceId}/search", { params: { path: { workspaceId }, query: { q, limit: 5 } } }).then(({ data }) => {
        if (id !== latest.current) return;
        setSearching(false);
        setResults(data ? resultEntries(workspaceId, data) : []);
        setSelected(0);
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [query, open, workspaceId]);

  const entries = useMemo(() => [...commandEntries(workspaceId, query), ...(query.trim() ? results : [])], [workspaceId, query, results]);

  function run(entry: PaletteEntry | undefined) {
    if (!entry) return;
    close();
    if (entry.action === "create-task") onCreateTask();
    else if (entry.href) router.push(entry.href);
  }

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-24" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={entries[selected] ? `palette-${entries[selected].id}` : undefined}
          aria-label="Search or run a command"
          placeholder="Search tasks, chat and people, or type a command…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => moveSelection(s, e.key === "ArrowDown" ? 1 : -1, entries.length)); }
            else if (e.key === "Enter") { e.preventDefault(); run(entries[selected]); }
            else if (e.key === "Escape") close();
          }}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
        />
        <ul id="palette-list" role="listbox" className="max-h-96 overflow-y-auto py-1">
          {entries.map((e, i) => {
            const header = e.group !== lastGroup;
            lastGroup = e.group;
            return (
              <li key={e.id} role="presentation">
                {header && <div className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{e.group}</div>}
                <div
                  id={`palette-${e.id}`}
                  role="option"
                  aria-selected={i === selected}
                  className={`flex cursor-pointer items-baseline justify-between gap-3 px-4 py-1.5 text-sm ${i === selected ? "bg-muted" : ""}`}
                  onMouseEnter={() => setSelected(i)}
                  onMouseDown={(ev) => { ev.preventDefault(); run(e); }}
                >
                  <span className="truncate">{e.label}</span>
                  {e.hint && <span className="shrink-0 truncate text-xs text-muted-foreground">{e.hint}</span>}
                </div>
              </li>
            );
          })}
          {entries.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">{searching ? "Searching…" : "Nothing found."}</li>}
        </ul>
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          ↑↓ to move · Enter to open · Esc to close · filters: <code>assignee:me</code> <code>status:open</code> <code>label:bug</code> <code>is:overdue</code>
        </div>
      </div>
    </div>
  );
}
