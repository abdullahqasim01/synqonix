import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({
  className, ref, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label, htmlFor, children, hint,
}: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Alert({
  variant = "error", children,
}: { variant?: "error" | "success" | "info"; children: React.ReactNode }) {
  const styles = {
    error: "border-danger/40 bg-danger-soft text-danger-text",
    success: "border-success/40 bg-success-soft text-success-text",
    info: "border-border bg-muted text-foreground",
  }[variant];
  return (
    <div role={variant === "error" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm", styles)}>
      {children}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-border bg-background p-6 shadow-card", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "flex h-9 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export function Textarea({
  className, ref, ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: React.Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
