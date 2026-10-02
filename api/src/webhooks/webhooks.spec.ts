import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, newSecret, signPayload, verifySignature } from './crypto.js';
import { checkWebhookUrl, isPrivateAddress } from './url-guard.js';

describe('private addresses', () => {
  it('flags everything a webhook must not reach', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', 'not-an-ip']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe('webhook URL check', () => {
  it('accepts public https URLs', () => {
    expect(checkWebhookUrl('https://hooks.example.com/path?x=1', false).ok).toBe(true);
    expect(checkWebhookUrl('https://8.8.8.8/hook', false).ok).toBe(true);
  });
  it('rejects the rest', () => {
    for (const bad of ['http://hooks.example.com', 'ftp://x.example.com', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/latest', 'https://intranet/x', 'https://svc.internal/x', 'https://printer.local/x', 'https://user:pw@example.com/x', 'nonsense', `https://example.com/${'a'.repeat(2100)}`]) {
      expect(checkWebhookUrl(bad, false).ok, bad).toBe(false);
    }
  });
  it('lets local development target anything, including http', () => {
    expect(checkWebhookUrl('http://localhost:9000/hook', true).ok).toBe(true);
    expect(checkWebhookUrl('http://user:pw@localhost/x', true).ok).toBe(false);
  });
});

describe('secrets and signatures', () => {
  it('round-trips encrypted secrets and never repeats a ciphertext', () => {
    const secret = newSecret();
    expect(secret).toMatch(/^whsec_/);
    const a = encryptSecret(secret, 'app-key');
    expect(a).not.toContain(secret);
    expect(decryptSecret(a, 'app-key')).toBe(secret);
    expect(encryptSecret(secret, 'app-key')).not.toBe(a);
    expect(() => decryptSecret(a, 'other-key')).toThrow();
    expect(() => decryptSecret(`${a.slice(0, -2)}xx`, 'app-key')).toThrow();
  });
  it('signs the timestamp and body together', () => {
    const sig = signPayload('s3cret', 1700000000, '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature('s3cret', 1700000000, '{"a":1}', sig)).toBe(true);
    expect(verifySignature('s3cret', 1700000001, '{"a":1}', sig)).toBe(false);
    expect(verifySignature('s3cret', 1700000000, '{"a":2}', sig)).toBe(false);
    expect(verifySignature('other', 1700000000, '{"a":1}', sig)).toBe(false);
    expect(verifySignature('s3cret', 1700000000, '{"a":1}', 'short')).toBe(false);
  });
});
