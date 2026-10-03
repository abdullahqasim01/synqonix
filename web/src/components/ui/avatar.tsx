import { cn } from "@/lib/utils";

/** A stable colour per name, so a person or workspace always looks the same. */
export function hueOf(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Initials on a coloured tile; `rounded="full"` for people, the default rounded square for workspaces and projects. */
export function Avatar({ name, size = 32, rounded = "lg", className }: { name: string; size?: number; rounded?: "lg" | "full"; className?: string }) {
  const hue = hueOf(name);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center font-semibold text-white", rounded === "full" ? "rounded-full" : "rounded-lg", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 70% 42%))` }}
    >
      {initials(name)}
    </span>
  );
}
