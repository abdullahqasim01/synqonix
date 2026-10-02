const KEY_REF = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$/;

export type TaskRef =
  | { kind: 'id'; id: string }
  | { kind: 'key'; projectKey: string; number: number };

/** A task can be addressed by its uuid or by its human key (`SYN-12`, case-insensitive). */
export function parseTaskRef(ref: string): TaskRef {
  const m = KEY_REF.exec(ref);
  if (m) return { kind: 'key', projectKey: m[1].toUpperCase(), number: Number(m[2]) };
  return { kind: 'id', id: ref };
}

export const taskKey = (projectKey: string, number: number) => `${projectKey}-${number}`;
