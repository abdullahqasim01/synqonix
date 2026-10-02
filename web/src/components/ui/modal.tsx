"use client";

import { useEffect } from "react";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-24" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className={`grid max-h-[80vh] w-full gap-4 overflow-y-auto rounded-lg border border-border bg-background p-5 shadow-xl ${wide ? "max-w-lg" : "max-w-md"}`}>
        <h2 className="font-medium">{title}</h2>
        {children}
      </div>
    </div>
  );
}
