"use client";

import { useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { mentionMarkdown } from "@/lib/tasks";

interface Props {
  value: string;
  onChange(value: string): void;
  /** People that can be @mentioned. */
  people?: { userId: string; name: string }[];
  placeholder?: string;
  rows?: number;
  /** Called on Ctrl/Cmd+Enter. */
  onSubmit?(): void;
  id?: string;
}

/** Markdown textarea with a preview tab, a code-block shortcut and an @mention picker. */
export function MarkdownEditor({ value, onChange, people = [], placeholder, rows = 6, onSubmit, id }: Props) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const ref = useRef<HTMLTextAreaElement>(null);

  function insert(text: string, selectInside = false) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      const caret = selectInside ? start + 4 : start + text.length;
      el?.setSelectionRange(caret, caret);
    });
  }

  const tabClass = (t: string) =>
    cn("px-3 py-1 text-xs", tab === t ? "border-b-2 border-primary font-medium" : "text-muted-foreground hover:text-foreground");

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-1">
        <div className="flex">
          <button type="button" className={tabClass("write")} onClick={() => setTab("write")}>Write</button>
          <button type="button" className={tabClass("preview")} onClick={() => setTab("preview")}>Preview</button>
        </div>
        {tab === "write" && (
          <div className="flex items-center gap-1 pr-1">
            <button type="button" className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => insert("```\n\n```", true)} title="Insert code block">{"</>"}</button>
            <button type="button" className="rounded px-2 py-0.5 text-xs font-bold text-muted-foreground hover:bg-muted" onClick={() => insert("****", true)} title="Bold">B</button>
            {people.length > 0 && (
              <Select
                aria-label="Mention a teammate"
                className="h-6 w-28 text-xs"
                value=""
                onChange={(e) => {
                  const p = people.find((x) => x.userId === e.target.value);
                  if (p) insert(`${mentionMarkdown(p.name, p.userId)} `);
                }}
              >
                <option value="">@ Mention…</option>
                {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
              </Select>
            )}
          </div>
        )}
      </div>
      {tab === "write" ? (
        <Textarea
          id={id}
          ref={ref}
          value={value}
          rows={rows}
          placeholder={placeholder ?? "Markdown supported"}
          className="rounded-none border-0 focus-visible:ring-0"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      ) : (
        <div className="min-h-20 p-3">{value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-muted-foreground">Nothing to preview</p>}</div>
      )}
    </div>
  );
}
