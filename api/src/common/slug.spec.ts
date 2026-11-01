import { expect, it } from 'vitest';
import { slugify } from './slug.js';

it('slugifies names', () => {
  expect(slugify('Acme Inc.')).toBe('acme-inc');
  expect(slugify('  Café  Déjà Vu ')).toBe('cafe-deja-vu');
  expect(slugify('!!!')).toBe('workspace');
});
