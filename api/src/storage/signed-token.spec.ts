import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignedTokens } from './signed-token.js';

const make = (secret = 'a'.repeat(32)) => new SignedTokens({ get: () => secret } as unknown as ConfigService<never, true>);

describe('SignedTokens', () => {
  afterEach(() => vi.useRealTimers());

  it('round-trips claims', () => {
    const t = make();
    expect(t.verify<{ a: number }>(t.sign({ a: 1 }, 60))).toMatchObject({ a: 1 });
  });

  it('rejects tampered, foreign and expired tokens', () => {
    const t = make();
    const token = t.sign({ a: 1 }, 60);
    expect(() => t.verify(token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toThrow(UnauthorizedException);
    expect(() => make('b'.repeat(32)).verify(token)).toThrow(UnauthorizedException);
    expect(() => t.verify(undefined)).toThrow(UnauthorizedException);
    expect(() => t.verify('nodot')).toThrow(UnauthorizedException);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(() => t.verify(token)).toThrow(UnauthorizedException);
  });

  it('does not accept a payload swapped under an old signature', () => {
    const t = make();
    const [, sig] = t.sign({ a: 1 }, 60).split('.');
    const forged = Buffer.from(JSON.stringify({ a: 2, exp: 9999999999 })).toString('base64url');
    expect(() => t.verify(`${forged}.${sig}`)).toThrow(UnauthorizedException);
  });
});
