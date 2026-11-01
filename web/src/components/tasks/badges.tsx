import { Badge } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { priorityInfo, typeInfo, type TaskPriority, type TaskType } from "@/lib/tasks";

export function TypeIcon({ type, className }: { type: TaskType; className?: string }) {
  const t = typeInfo(type);
  return <span title={t.label} aria-label={t.label} className={cn("inline-block w-4 text-center", className)}>{t.icon}</span>;
}

export function PriorityLabel({ priority, showNone = false }: { priority: TaskPriority; showNone?: boolean }) {
  if (priority === "NONE" && !showNone) return <span className="text-muted-foreground">—</span>;
  const p = priorityInfo(priority);
  return <span className={cn("text-xs font-medium", p.className)}>{p.label}</span>;
}

export function StatusBadge({ status }: { status: { name: string; color: string } }) {
  return (
    <Badge className="gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: status.color }} />
      {status.name}
    </Badge>
  );
}

export function LabelChip({ label }: { label: { name: string; color: string } }) {
  return (
    <Badge className="gap-1">
      <span className="h-2 w-2 rounded-full" style={{ background: label.color }} />
      {label.name}
    </Badge>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <span title={name} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
