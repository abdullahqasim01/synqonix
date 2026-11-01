import type { PrismaService } from '../prisma/prisma.service.js';

/** Minutes logged per task: finished entries plus any running timer up to `now`. */
export async function timeSpentByTask(prisma: PrismaService, taskIds: string[], now = new Date()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (taskIds.length === 0) return out;
  const [done, running] = await Promise.all([
    prisma.timeEntry.groupBy({ by: ['taskId'], where: { taskId: { in: taskIds }, endedAt: { not: null } }, _sum: { minutes: true } }),
    prisma.timeEntry.findMany({ where: { taskId: { in: taskIds }, endedAt: null }, select: { taskId: true, startedAt: true } }),
  ]);
  for (const d of done) out.set(d.taskId, d._sum.minutes ?? 0);
  for (const r of running) out.set(r.taskId, (out.get(r.taskId) ?? 0) + Math.max(0, Math.floor((now.getTime() - r.startedAt.getTime()) / 60_000)));
  return out;
}
