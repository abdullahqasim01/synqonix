import { BadRequestException } from '@nestjs/common';
import type { CustomFieldType } from '../generated/prisma/enums.js';

export interface FieldDef {
  id: string;
  name: string;
  type: CustomFieldType;
  options: unknown;
}

const selectOptions = (f: FieldDef): string[] =>
  Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === 'string') : [];

/**
 * Validates a custom-field value against its field definition and returns the value to store.
 * `null` means "clear the value".
 */
export function normalizeCustomValue(field: FieldDef, value: unknown): string | number | boolean | null {
  if (value === null) return null;
  const bad = (msg: string) => new BadRequestException(`Custom field "${field.name}": ${msg}`);
  switch (field.type) {
    case 'TEXT':
      if (typeof value !== 'string' || value.length > 1000) throw bad('must be text up to 1000 characters');
      return value;
    case 'NUMBER':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw bad('must be a number');
      return value;
    case 'CHECKBOX':
      if (typeof value !== 'boolean') throw bad('must be true or false');
      return value;
    case 'DATE': {
      const d = typeof value === 'string' ? new Date(value) : null;
      if (!d || Number.isNaN(d.getTime())) throw bad('must be a date');
      return d.toISOString();
    }
    case 'SELECT':
      if (typeof value !== 'string' || !selectOptions(field).includes(value)) {
        throw bad(`must be one of: ${selectOptions(field).join(', ')}`);
      }
      return value;
  }
}
