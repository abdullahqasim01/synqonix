"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Option { id: string; label: string }

/** Dropdown with checkboxes. Calls `onChange` with the new selection when an option is toggled. */
export function MultiSelect({
  options, value, onChange, placeholder, disabled, className,
}: {
  options: Option[];
  value: string[];
  onChange(ids: string[]): void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Show the user's choice immediately; it is dropped as soon as the `value` prop changes.
  const valueKey = value.join(",");
  const [pending, setPending] = useState<{ base: string; ids: string[] } | null>(null);
  const shown = pending && pending.base === valueKey ? pending.ids : value;
  const choose = (ids: string[]) => {
    setPending({ base: valueKey, ids });
    onChange(ids);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const selected = options.filter((o) => shown.includes(o.id));
  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-left text-sm disabled:opacity-60"
      >
        <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
          {selected.length ? selected.map((s) => s.label).join(", ") : placeholder}
        </span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <ul role="listbox" aria-multiselectable className="absolute z-20 mt-1 max-h-60 w-full min-w-48 overflow-auto rounded-md border border-border bg-background p-1 shadow-lg">
          {options.length === 0 && <li className="px-2 py-1 text-sm text-muted-foreground">Nothing to choose</li>}
          {options.map((o) => {
            const checked = shown.includes(o.id);
            return (
              <li key={o.id} role="option" aria-selected={checked}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => choose(checked ? shown.filter((v) => v !== o.id) : [...shown, o.id])}
                  />
                  {o.label}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
