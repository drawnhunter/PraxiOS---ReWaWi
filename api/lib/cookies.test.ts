import { describe, it, expect } from "vitest";
import { getSessionCookieOptions } from "./cookies";

const H = (host: string, proto?: string) => {
  const h = new Headers({ host });
  if (proto) h.set("x-forwarded-proto", proto);
  return h;
};

describe("getSessionCookieOptions (Login-Falle WireGuard/Direkt-IP)", () => {
  it("hinter Caddy (https) → secure + SameSite None (Produktion wie bisher)", () => {
    const o = getSessionCookieOptions(H("rewawi.praxios.dynv6.net", "https"));
    expect(o.secure).toBe(true);
    expect(o.sameSite).toBe("None");
  });
  it("direkt per LAN-IP über http → secure=false, SameSite Lax", () => {
    const o = getSessionCookieOptions(H("192.168.178.62:3100"));
    expect(o.secure).toBe(false);
    expect(o.sameSite).toBe("Lax");
  });
  it("localhost http → secure=false", () => {
    const o = getSessionCookieOptions(H("localhost:3000"));
    expect(o.secure).toBe(false);
  });
  it("explizit http hinter Proxy → secure=false", () => {
    const o = getSessionCookieOptions(H("rewawi.praxios.dynv6.net", "http"));
    expect(o.secure).toBe(false);
    expect(o.sameSite).toBe("Lax");
  });
  it("SameSite=None kommt nie ohne Secure (Browser-Regel)", () => {
    for (const o of [
      getSessionCookieOptions(H("a", "https")),
      getSessionCookieOptions(H("a")),
      getSessionCookieOptions(H("localhost:3000")),
    ]) {
      if (o.sameSite === "None") expect(o.secure).toBe(true);
    }
  });
});

