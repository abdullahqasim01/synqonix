/** Maps `value` from `domain` to `range` linearly (clamping is left to callers). */
export function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** A round number >= `value` for axis maxima (1, 2, 5 × 10^n), never below 1. */
export function niceMax(value: number): number {
  if (value <= 1) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const f = value / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}

/** SVG path for a step line: values hold until the next point (burndown semantics). */
export function stepPath(points: { x: number; y: number }[], endX?: number): string {
  if (points.length === 0) return "";
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) d += ` H${points[i].x} V${points[i].y}`;
  if (endX !== undefined && endX > points[points.length - 1].x) d += ` H${endX}`;
  return d;
}

export function linePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
}

/** Whole-number tick values from 0 to `max` (at most `count` + 1 ticks). */
export function ticks(max: number, count = 4): number[] {
  const step = Math.max(1, Math.ceil(max / count));
  const out: number[] = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  if (out[out.length - 1] !== max && max - out[out.length - 1] > step / 2) out.push(max);
  return out;
}
