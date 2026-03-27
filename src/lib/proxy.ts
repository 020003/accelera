/**
 * Rewrite an absolute GPU-exporter URL to go through the nginx reverse proxy.
 *
 * Converts: http://10.2.63.234:5000/nvidia-smi.json
 *       To: /api-proxy/10.2.63.234:5000/nvidia-smi.json
 *
 * This keeps backend IPs out of browser CORS preflight and lets the
 * frontend work behind firewalls that only expose port 8080.
 *
 * When running on the Vite dev server the proxy is not available, so
 * the original URL is returned unchanged.
 */

const IS_PRODUCTION = import.meta.env.PROD;

export function proxyUrl(url: string): string {
  if (!IS_PRODUCTION) return url; // dev server — pass through

  try {
    const parsed = new URL(url);
    // Only proxy http(s) URLs that point to a different host:port
    if (
      parsed.origin === window.location.origin ||
      (!parsed.protocol.startsWith("http"))
    ) {
      return url;
    }
    // Strip scheme, keep host:port + path + query
    const hostPort = parsed.host; // e.g. "10.2.63.234:5000"
    const rest = parsed.pathname + parsed.search + parsed.hash;
    // Remove leading slash from rest so the nginx regex matches cleanly
    const trimmed = rest.startsWith("/") ? rest.slice(1) : rest;
    return `/api-proxy/${hostPort}/${trimmed}`;
  } catch {
    return url; // not a valid URL — return as-is
  }
}
