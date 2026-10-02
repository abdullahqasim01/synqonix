import type { WorkspaceRole } from '../generated/prisma/enums.js';

export type Permission =
  | 'workspace.read'
  | 'workspace.update'
  | 'workspace.delete'
  | 'member.read'
  | 'member.manage'
  | 'invitation.manage'
  | 'team.read'
  | 'team.manage'
  | 'project.read'
  | 'project.create'
  | 'project.manage'
  | 'project.delete'
  | 'audit.read';

const ALL_READ: Permission[] = ['workspace.read', 'member.read', 'team.read', 'project.read'];
const ADMIN: Permission[] = [
  ...ALL_READ,
  'workspace.update',
  'member.manage',
  'invitation.manage',
  'team.manage',
  'project.create',
  'project.manage',
  'project.delete',
  'audit.read',
];

/** The single source of truth for what each workspace role may do. */
export const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>([...ADMIN, 'workspace.delete']),
  ADMIN: new Set<Permission>(ADMIN),
  MEMBER: new Set<Permission>([...ALL_READ, 'project.create']),
  VIEWER: new Set<Permission>(ALL_READ),
};

export const can = (role: WorkspaceRole, permission: Permission) =>
  ROLE_PERMISSIONS[role].has(permission);

export const isWorkspaceAdmin = (role: WorkspaceRole) => role === 'OWNER' || role === 'ADMIN';
