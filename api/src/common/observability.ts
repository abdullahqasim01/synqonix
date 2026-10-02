import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Prometheus-style counters kept in memory; one process, reset on restart. */
export class Metrics {
  private readonly requests = new Map<string, number>();
  private durationSum = 0;
  private durationCount = 0;
  private readonly started = Date.now();

  record(method: string, status: number, ms: number) {
    const key = `${method}|${Math.floor(status / 100)}xx`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    this.durationSum += ms / 1000;
    this.durationCount += 1;
  }

  render(): string {
    const mem = process.memoryUsage();
    const lines = [
      '# HELP synqonix_http_requests_total HTTP requests by method and status class.',
      '# TYPE synqonix_http_requests_total counter',
      ...[...this.requests].sort().map(([k, v]) => {
        const [method, status] = k.split('|');
        return `synqonix_http_requests_total{method="${method}",status="${status}"} ${v}`;
      }),
      '# HELP synqonix_http_request_duration_seconds Total time spent serving requests.',
      '# TYPE synqonix_http_request_duration_seconds summary',
      `synqonix_http_request_duration_seconds_sum ${this.durationSum.toFixed(6)}`,
      `synqonix_http_request_duration_seconds_count ${this.durationCount}`,
      '# TYPE synqonix_process_resident_memory_bytes gauge',
      `synqonix_process_resident_memory_bytes ${mem.rss}`,
      '# TYPE synqonix_process_uptime_seconds gauge',
      `synqonix_process_uptime_seconds ${Math.round((Date.now() - this.started) / 1000)}`,
    ];
    return `${lines.join('\n')}\n`;
  }
}

export const metrics = new Metrics();

export type LogLine = Record<string, unknown>;

/** One JSON object per line (or a readable line in development). Never logs query strings, headers or bodies. */
export function writeLog(format: 'json' | 'pretty', line: LogLine, out: (s: string) => void = (s) => process.stdout.write(s)) {
  if (format === 'json') return out(`${JSON.stringify({ time: new Date().toISOString(), ...line })}\n`);
  const { level, msg, ...rest } = line;
  out(`${String(level ?? 'info').toUpperCase()} ${String(msg ?? '')} ${Object.keys(rest).length ? JSON.stringify(rest) : ''}\n`);
}

/** Gives every request an id (honouring a sane incoming `X-Request-Id`), logs it when done and counts it. */
export function requestObserver(format: 'json' | 'pretty', quiet = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    (req as Request & { id: string }).id = id;
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const path = req.originalUrl.split('?')[0];
      if (!path.endsWith('/metrics')) metrics.record(req.method, res.statusCode, ms);
      if (quiet || path.startsWith('/api/v1/health')) return;
      const user = (req as Request & { user?: { id: string } }).user?.id;
      writeLog(format, {
        level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        msg: 'request', requestId: id, method: req.method, path, status: res.statusCode, ms: Math.round(ms), ...(user ? { userId: user } : {}),
      });
    });
    next();
  };
}
