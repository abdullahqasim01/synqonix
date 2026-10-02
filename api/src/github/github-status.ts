import type { LinkedRepository } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** The statuses a repository's automations move tasks to: the configured ones, else sensible defaults. */
export async function effectiveStatuses(prisma: PrismaService, link: Pick<LinkedRepository, 'projectId' | 'prOpenedStatusId' | 'prMergedStatusId'>) {
  const statuses = await prisma.projectStatus.findMany({ where: { projectId: link.projectId }, orderBy: { position: 'asc' } });
  const byId = (id: string | null) => statuses.find((s) => s.id === id) ?? null;
  const opened = byId(link.prOpenedStatusId) ?? statuses.find((s) => s.category !== 'DONE' && /review/i.test(s.name)) ?? null;
  const merged = byId(link.prMergedStatusId) ?? statuses.find((s) => s.category === 'DONE') ?? null;
  const reopened = statuses.find((s) => s.category === 'TODO') ?? null;
  return { opened, merged, reopened, statuses };
}
