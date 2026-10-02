import { isIP } from 'node:net';

/** Whether an IP address is somewhere a public webhook must never reach (loopback, private, link-local, metadata, ...). */
export function isPrivateAddress(address: string): boolean {
  const v6mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = v6mapped ? v6mapped[1] : address;
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (kind === 6) {
    const l = ip.toLowerCase();
    return l === '::' || l === '::1' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff');
  }
  return true; // not an address at all: refuse
}

export interface UrlCheck { ok: boolean; reason?: string }

/** Cheap checks done when a webhook is saved. DNS is checked again when delivering. */
export function checkWebhookUrl(raw: string, allowPrivate: boolean): UrlCheck {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'That is not a valid URL' }; }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) return { ok: false, reason: 'Webhook URLs must use https' };
  if (url.username || url.password) return { ok: false, reason: 'Put credentials in a header or the signature, not the URL' };
  if (raw.length > 2000) return { ok: false, reason: 'The URL is too long' };
  if (allowPrivate) return { ok: true };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && isIP(host) === 0) {
    return { ok: false, reason: 'That address is not reachable from the internet' };
  }
  if (isIP(host) !== 0 && isPrivateAddress(host)) return { ok: false, reason: 'That address is not reachable from the internet' };
  return { ok: true };
}
