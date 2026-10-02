/** Builds the Content-Security-Policy for one response; `nonce` is fresh per request. */
export function buildCsp(opts: { nonce: string; apiUrl: string; dev?: boolean }): string {
  const api = new URL(opts.apiUrl);
  const ws = `${api.protocol === "https:" ? "wss:" : "ws:"}//${api.host}`;
  const directives = [
    "default-src 'self'",
    // `strict-dynamic` lets nonce'd framework scripts load their chunks; React needs eval only in development.
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${opts.nonce}'${opts.dev ? " 'unsafe-inline'" : ""}`,
    // Inline style="" attributes (chart bars, colour chips) cannot carry a nonce; scripts stay locked down.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data: ${api.origin}`,
    "font-src 'self' data:",
    `connect-src 'self' ${api.origin} ${ws}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.dev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}
