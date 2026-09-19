import { describe, expect, it } from "vitest";
import { baueZip } from "./zipWriter";
import { crc32 as zlibCrc32 } from "node:zlib";

describe("baueZip", () => {
  const dateien = [
    { name: "RE-2026-001.pdf", inhalt: Buffer.from("Hallo Welt") },
    { name: "ER-Notar.pdf", inhalt: Buffer.from([0x25, 0x50, 0x44, 0x46, 1, 2, 3]) },
  ];
  const zip = baueZip(dateien);

  it("hat korrekte Signaturen (lokal, zentral, EOCD)", () => {
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))).toBeGreaterThan(0);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });

  it("enthält alle Dateinamen und stimmt in der Anzahl überein", () => {
    expect(zip.includes(Buffer.from("RE-2026-001.pdf"))).toBe(true);
    expect(zip.includes(Buffer.from("ER-Notar.pdf"))).toBe(true);
    expect(zip.readUInt16LE(zip.length - 14)).toBe(2); // EOCD Einträge
  });

  it("schreibt korrekte CRC32-Prüfsummen in die Header", () => {
    const erwartet = zlibCrc32 ? zlibCrc32(Buffer.from("Hallo Welt")) : null;
    if (erwartet !== null) {
      // CRC des ersten Eintrags steht im lokalen Header (Offset 14)
      expect(zip.readUInt32LE(14)).toBe(erwartet >>> 0);
    }
    // Inhalt liegt unverändert hinter dem ersten Header (30 + Namenslänge)
    const nameLen = zip.readUInt16LE(26);
    const inhaltStart = 30 + nameLen;
    expect(zip.subarray(inhaltStart, inhaltStart + 10).toString()).toBe("Hallo Welt");
  });
});
