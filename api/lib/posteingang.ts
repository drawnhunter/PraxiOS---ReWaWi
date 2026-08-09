// Gemeinsamer Helfer: Beleg als Posteingang speichern.
// Upload, Magic Import und der E-Mail-Abruf nutzen denselben Pfad — der Beleg
// liegt als base64 in der Tabelle (mysqldump-Sicherung deckt ihn mit ab).
import { getDb } from "../queries/connection";
import { postEingang } from "@db/schema";

export interface NeuerBeleg {
  originalname: string;
  mime: string;
  puffer: Buffer;
  typ: "rechnung" | "lieferschein" | "gutschrift" | "sonstiges";
  quelle: string;
  absenderFreitext?: string | null;
}

export async function erzeugePostEingang(b: NeuerBeleg): Promise<number> {
  const [r] = await getDb()
    .insert(postEingang)
    .values({
      typ: b.typ,
      originalname: b.originalname.slice(0, 255),
      mime: b.mime,
      groesse: b.puffer.length,
      dateiInhalt: b.puffer.toString("base64"),
      quelle: b.quelle.slice(0, 120),
      absenderFreitext: b.absenderFreitext?.slice(0, 255) ?? null,
      stichwort: b.originalname.slice(0, 255),
    })
    .$returningId();
  return r.id;
}

/** MIME aus Dateiname ableiten (Uploads kommen teils ohne Typ). */
export function mimeAusName(name: string, mime?: string): string {
  if (mime && mime !== "application/octet-stream") return mime;
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".xml")) return "application/xml";
  if (n.endsWith(".csv")) return "text/csv";
  return mime || "application/octet-stream";
}
