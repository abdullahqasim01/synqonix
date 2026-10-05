import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/**
 * Short-lived tamper-proof tokens: `base64url(json).base64url(hmac)`. Used for upload confirmations
 * (what the client was allowed to upload) and for the local driver's links.
 */
@Injectable()
export class SignedTokens {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.key = createHmac('sha256', config.get('JWT_ACCESS_SECRET')).update('synqonix-storage-tokens-v1').digest();
  }

  private mac(body: string) {
    return createHmac('sha256', this.key).update(body).digest();
  }

  sign(claims: Record<string, unknown>, ttlSeconds: number): string {
    const body = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
    return `${body}.${this.mac(body).toString('base64url')}`;
  }

  verify<T extends Record<string, unknown>>(token: string | undefined): T {
    const [body, sig] = (token ?? '').split('.');
    if (!body || !sig) throw new UnauthorizedException('Invalid or expired link');
    const given = Buffer.from(sig, 'base64url');
    const want = this.mac(body);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new UnauthorizedException('Invalid or expired link');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
    if (typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) throw new UnauthorizedException('Invalid or expired link');
    return claims;
  }
}
