// ── Post Manager: Posteingang (gescannte Belege & Dokumente) ───────────────
import { z } from "zod";
import { and, desc, eq, isNotNull, isNull, like, or } from "drizzle-orm";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { incomingInvoices, kategorien, postEingang, suppliers } from "@db/schema";
import { erzeugePostEingang, mimeAusName } from "./lib/posteingang";
import { duplikatEingangsrechnung } from "./lib/einrechnung";
import { extrahiereFelder, ocrBeleg } from "./ocr";

const datumSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const bearbeitenInput = z.object({
  id: z.number().int(),
  typ: z.enum(["rechnung", "lieferschein", "gutschrift", "sonstiges"]),
  absenderLieferantId: z.number().int().nullish(),
  absenderFreitext: z.string().max(255).nullish(),
  stichwort: z.string().max(255).nullish(),
  rechnungsnummer: z.string().max(100).nullish(),
  betrag: z.number().nullish(),
  ustSatz: z.number().int().min(0).max(100).nullish(),
  rechnungsdatum: datumSchema.nullish(),
  faelligAm: datumSchema.nullish(),
  wiedervorlageAm: datumSchema.nullish(),
  konto: z.string().max(10).nullish(),
  gegenkonto: z.string().max(10).nullish(),
  kategorieId: z.number().int().nullish(),
  notizen: z.string().max(4000).nullish(),
});

async function lieferantName(lieferantId: number | null | undefined, freitext: string | null | undefined) {
  if (lieferantId) {
    const l = await getDb().query.suppliers.findFirst({ where: eq(suppliers.id, lieferantId) });
    if (l) return l.name;
  }
  return freitext?.trim() || "Unbekannt";
}

export const posteingangRouter = createRouter({
  liste: authedQuery
    .input(
      z.object({
        status: z.enum(["neu", "gebucht", "abgelegt"]).optional(),
        typ: z.enum(["rechnung", "lieferschein", "gutschrift", "sonstiges"]).optional(),
      }),
    )
    .query(async ({ input }) => {
      const bedingungen = [];
      if (input.status) bedingungen.push(eq(postEingang.status, input.status));
      if (input.typ) bedingungen.push(eq(postEingang.typ, input.typ));
      return getDb()
        .select({
          id: postEingang.id,
          typ: postEingang.typ,
          status: postEingang.status,
          originalname: postEingang.originalname,
          groesse: postEingang.groesse,
          stichwort: postEingang.stichwort,
          rechnungsnummer: postEingang.rechnungsnummer,
          betrag: postEingang.betrag,
          faelligAm: postEingang.faelligAm,
          wiedervorlageAm: postEingang.wiedervorlageAm,
          quelle: postEingang.quelle,
          lieferantName: suppliers.name,
          absenderFreitext: postEingang.absenderFreitext,
          kategorieName: kategorien.name,
          createdAt: postEingang.createdAt,
        })
        .from(postEingang)
        .leftJoin(suppliers, eq(postEingang.absenderLieferantId, suppliers.id))
        .leftJoin(kategorien, eq(postEingang.kategorieId, kategorien.id))
        .where(bedingungen.length ? and(...bedingungen) : undefined)
        .orderBy(desc(postEingang.createdAt), desc(postEingang.id))
        .limit(300);
    }),

  get: authedQuery.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const rows = await getDb()
      .select({ r: postEingang, lieferantName: suppliers.name })
      .from(postEingang)
      .leftJoin(suppliers, eq(postEingang.absenderLieferantId, suppliers.id))
      .where(eq(postEingang.id, input.id))
      .limit(1);
    if (!rows[0]) throw new Error("Dokument nicht gefunden.");
    return { ...rows[0].r, lieferantName: rows[0].lieferantName };
  }),

  anlegen: authedQuery
    .input(
      z.object({
        originalname: z.string().min(1).max(255),
        mime: z.string().max(100).optional(),
        base64: z.string().min(20),
        typ: z.enum(["rechnung", "lieferschein", "gutschrift", "sonstiges"]).default("rechnung"),
        quelle: z.string().max(120).default("upload"),
      }),
    )
    .mutation(async ({ input }) => {
      const puffer = Buffer.from(input.base64, "base64");
      if (puffer.length > 12 * 1024 * 1024) throw new Error("Datei zu groß (max. 12 MB).");
      const id = await erzeugePostEingang({
        originalname: input.originalname,
        mime: mimeAusName(input.originalname, input.mime),
        puffer,
        typ: input.typ,
        quelle: input.quelle,
      });
      return { id };
    }),

  /** v1.4: Massen-Upload — ganze Scan-Stapel in einem Rutsch (max. 30 Dateien). */
  anlegenBatch: authedQuery
    .input(
      z.object({
        dateien: z
          .array(
            z.object({
              originalname: z.string().min(1).max(255),
              mime: z.string().max(100).optional(),
              base64: z.string().min(20),
            }),
          )
          .min(1)
          .max(30),
        typ: z.enum(["rechnung", "lieferschein", "gutschrift", "sonstiges"]).default("rechnung"),
        quelle: z.string().max(120).default("scan-upload"),
      }),
    )
    .mutation(async ({ input }) => {
      const ids: number[] = [];
      const fehler: string[] = [];
      for (const d of input.dateien) {
        try {
          const puffer = Buffer.from(d.base64, "base64");
          if (puffer.length > 12 * 1024 * 1024) throw new Error("Datei zu groß (max. 12 MB).");
          const id = await erzeugePostEingang({
            originalname: d.originalname,
            mime: mimeAusName(d.originalname, d.mime),
            puffer,
            typ: input.typ,
            quelle: input.quelle,
          });
          ids.push(id);
        } catch (e) {
          fehler.push(`${d.originalname}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { angelegt: ids.length, ids, fehler };
    }),

  aktualisieren: authedQuery.input(bearbeitenInput).mutation(async ({ input }) => {
    const { id, ...felder } = input;
    const zeile = await getDb().query.postEingang.findFirst({ where: eq(postEingang.id, id) });
    if (!zeile) throw new Error("Dokument nicht gefunden.");
    if (zeile.status === "gebucht") throw new Error("Bereits gebucht — nur noch Lesen möglich (GoBD).");
    const werte: Record<string, unknown> = { typ: felder.typ };
    for (const [k, v] of Object.entries(felder)) {
      if (v !== undefined) werte[k] = v === null ? null : v;
    }
    if (felder.betrag !== undefined) werte.betrag = felder.betrag == null ? null : felder.betrag.toFixed(2);
    await getDb().update(postEingang).set(werte).where(eq(postEingang.id, id));
    return { ok: true };
  }),

  buchen: authedQuery.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const db = getDb();
    const zeile = await db.query.postEingang.findFirst({ where: eq(postEingang.id, input.id) });
    if (!zeile) throw new Error("Dokument nicht gefunden.");
    if (zeile.status === "gebucht") throw new Error("Dieses Dokument wurde bereits gebucht.");
    if (zeile.typ !== "rechnung") throw new Error("Nur Dokumente vom Typ „Rechnung“ können gebucht werden.");
    if (!zeile.betrag || Number(zeile.betrag) <= 0) throw new Error("Betrag fehlt — bitte erst im Formular ergänzen.");
    if (!zeile.rechnungsdatum) throw new Error("Rechnungsdatum fehlt — bitte erst im Formular ergänzen.");

    const lieferant = await lieferantName(zeile.absenderLieferantId, zeile.absenderFreitext);
    const nummer = zeile.rechnungsnummer?.trim() || `POST-${zeile.id}`;
    const dup = await duplikatEingangsrechnung(lieferant, nummer);
    if (dup) throw new Error(`„${nummer}“ von ${lieferant} ist bereits gebucht.`);

    const brutto = Number(zeile.betrag);
    const satz = zeile.ustSatz ?? 19;
    const netto = satz > 0 ? brutto / (1 + satz / 100) : brutto;
    const ust = brutto - netto;

    const [res] = await db
      .insert(incomingInvoices)
      .values({
        lieferantName: lieferant,
        nummer,
        rechnungsdatum: zeile.rechnungsdatum,
        faelligkeitsdatum: zeile.faelligAm,
        netto: netto.toFixed(2),
        ust: ust.toFixed(2),
        brutto: brutto.toFixed(2),
        waehrung: "EUR",
        konto: zeile.konto,
        gegenkonto: zeile.gegenkonto,
        bemerkung: `Posteingang #${zeile.id}${zeile.stichwort ? " — " + zeile.stichwort : ""}`,
      })
      .$returningId();

    await db
      .update(postEingang)
      .set({ status: "gebucht", incomingInvoiceId: res.id, rechnungsnummer: nummer })
      .where(eq(postEingang.id, zeile.id));
    return { ok: true, incomingInvoiceId: res.id };
  }),

  setStatus: authedQuery
    .input(z.object({ id: z.number().int(), status: z.enum(["neu", "abgelegt"]) }))
    .mutation(async ({ input }) => {
      const zeile = await getDb().query.postEingang.findFirst({ where: eq(postEingang.id, input.id) });
      if (!zeile) throw new Error("Dokument nicht gefunden.");
      if (zeile.status === "gebucht") throw new Error("Gebuchte Dokumente bleiben unverändert (GoBD).");
      await getDb().update(postEingang).set({ status: input.status }).where(eq(postEingang.id, input.id));
      return { ok: true };
    }),

  loeschen: authedQuery.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const zeile = await getDb().query.postEingang.findFirst({ where: eq(postEingang.id, input.id) });
    if (!zeile) throw new Error("Dokument nicht gefunden.");
    if (zeile.status === "gebucht") {
      throw new Error("Gebuchte Belege dürfen nicht gelöscht werden (GoBD) — stattdessen ablegen.");
    }
    await getDb().delete(postEingang).where(eq(postEingang.id, input.id));
    return { ok: true };
  }),

  /** OCR-Vorschlag: Beleg lokal erkennen, Felder mit Konfidenz vorschlagen. */
  ocrAnalysieren: authedQuery.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    const zeile = await getDb().query.postEingang.findFirst({ where: eq(postEingang.id, input.id) });
    if (!zeile) throw new Error("Dokument nicht gefunden.");
    const puffer = Buffer.from(zeile.dateiInhalt, "base64");
    const text = await ocrBeleg(zeile.mime, puffer);
    const felder = extrahiereFelder(text);

    // Absender gegen Lieferanten matchen (erste sinnvolle Zeile als Kandidat)
    let lieferant: { id: number; name: string } | null = null;
    const kandidat = felder.absender.wert?.toLowerCase();
    if (kandidat && kandidat.length >= 3) {
      const treffer = await getDb()
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(like(suppliers.name, `%${felder.absender.wert!.slice(0, 60)}%`))
        .limit(1);
      if (treffer[0]) lieferant = treffer[0];
    }

    // v1.6 Regelwerk: Lieferant hat Standard-Kategorie -> Konto/USt vorschlagen
    let regelwerk: { kategorieId: number; kategorieName: string; konto: string | null; ustSatz: number } | null = null;
    if (lieferant) {
      const lf = await getDb().query.suppliers.findFirst({
        where: eq(suppliers.id, lieferant.id),
      });
      if (lf?.kategorieId) {
        const kat = await getDb().query.kategorien.findFirst({
          where: eq(kategorien.id, lf.kategorieId),
        });
        if (kat) {
          regelwerk = { kategorieId: kat.id, kategorieName: kat.name, konto: kat.konto, ustSatz: kat.ustSatz };
        }
      }
    }
    return { felder, lieferant, regelwerk, zeichen: text.length };
  }),

  /** Zahlungsziele: offene Eingangsrechnungen + Wiedervorlagen + ungebuchte Posts. */
  zahlungsziele: authedQuery.query(async () => {
    const db = getDb();
    const heute = new Date().toISOString().slice(0, 10);

    const offeneRechnungen = await db
      .select({
        id: incomingInvoices.id,
        lieferantName: incomingInvoices.lieferantName,
        nummer: incomingInvoices.nummer,
        brutto: incomingInvoices.brutto,
        faelligkeitsdatum: incomingInvoices.faelligkeitsdatum,
      })
      .from(incomingInvoices)
      .where(and(isNull(incomingInvoices.bezahltAm), isNotNull(incomingInvoices.faelligkeitsdatum)));

    const postOffen = await db
      .select({
        id: postEingang.id,
        typ: postEingang.typ,
        status: postEingang.status,
        stichwort: postEingang.stichwort,
        betrag: postEingang.betrag,
        faelligAm: postEingang.faelligAm,
        wiedervorlageAm: postEingang.wiedervorlageAm,
        lieferantName: suppliers.name,
        absenderFreitext: postEingang.absenderFreitext,
      })
      .from(postEingang)
      .leftJoin(suppliers, eq(postEingang.absenderLieferantId, suppliers.id))
      .where(
        and(
          or(isNotNull(postEingang.faelligAm), isNotNull(postEingang.wiedervorlageAm)),
          or(eq(postEingang.status, "neu"), eq(postEingang.status, "abgelegt")),
        ),
      );

    const eintraege: {
      art: "rechnung" | "post" | "wiedervorlage";
      id: number;
      titel: string;
      betrag: string | null;
      datum: string;
      ueberfaellig: boolean;
      hinweis: string | null;
    }[] = [];

    for (const r of offeneRechnungen) {
      eintraege.push({
        art: "rechnung",
        id: r.id,
        titel: `${r.lieferantName} — ${r.nummer}`,
        betrag: r.brutto,
        datum: r.faelligkeitsdatum!,
        ueberfaellig: r.faelligkeitsdatum! < heute,
        hinweis: null,
      });
    }
    for (const p of postOffen) {
      const absender = p.lieferantName ?? p.absenderFreitext ?? "Unbekannt";
      if (p.wiedervorlageAm && p.status !== "abgelegt") {
        eintraege.push({
          art: "wiedervorlage",
          id: p.id,
          titel: `${p.stichwort ?? p.typ} — ${absender}`,
          betrag: null,
          datum: p.wiedervorlageAm,
          ueberfaellig: p.wiedervorlageAm < heute,
          hinweis: null,
        });
      }
      if (p.faelligAm && p.typ === "rechnung" && p.status === "neu") {
        eintraege.push({
          art: "post",
          id: p.id,
          titel: `${p.stichwort ?? "Rechnung"} — ${absender}`,
          betrag: p.betrag,
          datum: p.faelligAm,
          ueberfaellig: p.faelligAm < heute,
          hinweis: "noch nicht gebucht",
        });
      }
    }
    eintraege.sort((a, b) => a.datum.localeCompare(b.datum));
    return eintraege;
  }),
});
