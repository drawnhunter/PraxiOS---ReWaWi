// Verschluesselung fuer Geheimnisse in der Datenbank (z. B. SMTP-Passwort).
// Schluessel: SHA-256(APP_SECRET) — rotiert mit dem Secret.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function schluessel(): Buffer {
  return createHash("sha256").update(process.env.APP_SECRET ?? "").digest();
}

export function verschluesseln(klartext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", schluessel(), iv);
  const enc = Buffer.concat([cipher.update(klartext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function entschluesseln(wert: string | null): string | null {
  if (!wert) return null;
  const teile = wert.split(":");
  if (teile.length !== 4 || teile[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      schluessel(),
      Buffer.from(teile[1], "hex"),
    );
    decipher.setAuthTag(Buffer.from(teile[2], "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(teile[3], "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
