import type { CookieOptions } from "hono/utils/cookie";

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

/**
 * Cookie-Optionen je nach dem Weg der Anfrage:
 * - Über Caddy (TLS): x-forwarded-proto=https → secure-Cookie (Produktion)
 * - Direkt per IP/localhost (z. B. WireGuard/Diagnose, http://192.168.x.x):
 *   kein x-forwarded-proto → secure=false, sonst verwirft der Browser das
 *   Session-Cookie über HTTP und der Login läuft im Kreis ohne Fehlermeldung.
 * (SameSite=None erfordert zwingend Secure — deshalb gekoppelt.)
 */
export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalhost(headers);
  const proto = headers.get("x-forwarded-proto") || "";
  const https = proto === "https";

  return {
    httpOnly: true,
    path: "/",
    sameSite: https || localhost ? (https ? "None" : "Lax") : "Lax",
    secure: https,
  };
}

