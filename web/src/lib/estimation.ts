import type { Schemas } from "@/lib/api/client";

export type EstimationUnit = Schemas["ProjectDto"]["estimationUnit"];

/** T-shirt sizes are stored as numbers so burndown and velocity can add them up. */
export const TSHIRT_SIZES: { label: string; value: number }[] = [
  { label: "XS", value: 1 },
  { label: "S", value: 2 },
  { label: "M", value: 3 },
  { label: "L", value: 5 },
  { label: "XL", value: 8 },
  { label: "XXL", value: 13 },
];

export const UNIT_LABEL: Record<EstimationUnit, string> = { POINTS: "Story points", TSHIRT: "Size", HOURS: "Hours" };
export const POINT_SUGGESTIONS = [1, 2, 3, 5, 8, 13, 21];

/** Short display of an estimate in the project's unit: `5`, `M`, `3h`. */
export function formatEstimate(value: number | null | undefined, unit: EstimationUnit): string {
  if (value === null || value === undefined) return "";
  if (unit === "TSHIRT") return TSHIRT_SIZES.find((s) => s.value === value)?.label ?? String(value);
  if (unit === "HOURS") return `${value}h`;
  return String(value);
}

/** Formats a sum of estimates (a sprint's scope, a backlog total) for display. */
export function formatTotal(value: number, unit: EstimationUnit): string {
  const rounded = Math.round(value * 100) / 100;
  return unit === "HOURS" ? `${rounded}h` : `${rounded} pts`;
}
