import { describe, expect, it } from 'vitest';
import { can, type Permission } from './permissions.js';

const matrix: Record<Permission, [owner: boolean, admin: boolean, member: boolean, viewer: boolean]> = {
  'workspace.read': [true, true, true, true],
  'workspace.update': [true, true, false, false],
  'workspace.delete': [true, false, false, false],
  'member.read': [true, true, true, true],
  'member.manage': [true, true, false, false],
  'invitation.manage': [true, true, false, false],
  'team.read': [true, true, true, true],
  'team.manage': [true, true, false, false],
  'project.read': [true, true, true, true],
  'project.create': [true, true, true, false],
  'project.manage': [true, true, false, false],
  'project.delete': [true, true, false, false],
  'task.read': [true, true, true, true],
  'task.write': [true, true, true, false],
  'audit.read': [true, true, false, false],
};

describe('permission matrix', () => {
  const roles = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
  for (const [permission, expected] of Object.entries(matrix) as [Permission, boolean[]][]) {
    it(permission, () => {
      roles.forEach((role, i) => expect(can(role, permission), `${role} ${permission}`).toBe(expected[i]));
    });
  }
});
