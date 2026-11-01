import { cn } from "@/lib/utils";

/** Brand-kit gradients (700 to 600 shades keep white initials readable). */
const GRADIENTS: [string, string][] = [
  ["#4b108f", "#7e28db"], // primary
  ["#11328d", "#305ce3"], // info
  ["#076226", "#118b3b"], // success
  ["#8c5b0e", "#b6781b"], // warning
  ["#8d100f", "#b91a19"], // danger
  ["#273149", "#545a6f"], // neutral
];

/** A stable colour per name, so a person or workspace always looks the same. */
export function gradientOf(seed: string): [string, string] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return GRADIENTS[h % GRADIENTS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Initials on a coloured tile; `rounded="full"` for people, the default rounded square for workspaces and projects. */
export function Avatar({ name, size = 32, rounded = "lg", className }: { name: string; size?: number; rounded?: "lg" | "full"; className?: string }) {
  const [from, to] = gradientOf(name);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center font-semibold text-white", rounded === "full" ? "rounded-full" : "rounded-lg", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {initials(name)}
    </span>
  );
}
