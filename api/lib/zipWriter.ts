// ── Minimaler ZIP-Schreiber (STORE, ohne Kompression — PDFs/JPGs sind bereits
// komprimiert, und GoBD-Archive brauchen keine Deflate-Spielerei) ────────────
const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(puffer: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < puffer.length; i++) c = CRC_TABELLE[(c ^ puffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipDatei { name: string; inhalt: Buffer }

/** Baut ein ZIP-Archiv (STORE) aus Dateien. Namen in UTF-8 (Flag 0x800). */
export function baueZip(dateien: ZipDatei[]): Buffer {
  const teile: Buffer[] = [];
  const zentral: Buffer[] = [];
  let offset = 0;

  for (const d of dateien) {
    const name = Buffer.from(d.name, "utf8");
    const crc = crc32(d.inhalt);
    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034b50, 0);
    lokal.writeUInt16LE(20, 4); // Version
    lokal.writeUInt16LE(0x0800, 6); // UTF-8-Flag
    lokal.writeUInt16LE(0, 8); // STORE
    lokal.writeUInt16LE(0, 10); // Zeit
    lokal.writeUInt16LE(0, 12); // Datum
    lokal.writeUInt32LE(crc, 14);
    lokal.writeUInt32LE(d.inhalt.length, 18);
    lokal.writeUInt32LE(d.inhalt.length, 22);
    lokal.writeUInt16LE(name.length, 26);
    lokal.writeUInt16LE(0, 28);
    teile.push(lokal, name, d.inhalt);

    const eintrag = Buffer.alloc(46);
    eintrag.writeUInt32LE(0x02014b50, 0);
    eintrag.writeUInt16LE(20, 4);
    eintrag.writeUInt16LE(20, 6);
    eintrag.writeUInt16LE(0x0800, 8);
    eintrag.writeUInt16LE(0, 10);
    eintrag.writeUInt16LE(0, 12);
    eintrag.writeUInt16LE(0, 14);
    eintrag.writeUInt32LE(crc, 16);
    eintrag.writeUInt32LE(d.inhalt.length, 20);
    eintrag.writeUInt32LE(d.inhalt.length, 24);
    eintrag.writeUInt16LE(name.length, 28);
    eintrag.writeUInt16LE(0, 30);
    eintrag.writeUInt16LE(0, 32);
    eintrag.writeUInt16LE(0, 34);
    eintrag.writeUInt16LE(0, 36);
    eintrag.writeUInt32LE(0, 38);
    eintrag.writeUInt32LE(offset, 42);
    zentral.push(eintrag, name);
    offset += 30 + name.length + d.inhalt.length;
  }

  const zentralStart = offset;
  const zentralPuffer = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(0, 4);
  ende.writeUInt16LE(0, 6);
  ende.writeUInt16LE(dateien.length, 8);
  ende.writeUInt16LE(dateien.length, 10);
  ende.writeUInt32LE(zentralPuffer.length, 12);
  ende.writeUInt32LE(zentralStart, 16);
  ende.writeUInt16LE(0, 20);

  return Buffer.concat([...teile, zentralPuffer, ende]);
}
