// Geteilte Konstanten + Rechenlogik für Frontend & Backend (Rechnungswesen)

export const UST_SAETZE = [19, 7, 0] as const;

export const ZAHLUNGSZIELE_TAGE = [0, 7, 14, 30] as const;

export const EINHEITEN = [
  "Stück",
  "Tag",
  "Pauschale",
  "Stunde",
  "Monat",
  "Set",
  "Behandlung",
] as const;

export type InvoiceStatus = "entwurf" | "finalisiert" | "storniert";

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  entwurf: "Entwurf",
  finalisiert: "Finalisiert",
  storniert: "Storniert",
};

export type PurchaseOrderStatus =
  | "entwurf"
  | "bestellt"
  | "teilgeliefert"
  | "geliefert"
  | "storniert";

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  entwurf: "Entwurf",
  bestellt: "Bestellt",
  teilgeliefert: "Teilgeliefert",
  geliefert: "Geliefert",
  storniert: "Storniert",
};

// ── Geldrechnung in Cent (Integer), keine Float-Fehler ─────────────────────

export interface TotalsInput {
  menge: string | number;
  einzelpreis: string | number;
  ustSatz: number;
  /** Positionsrabatt: Art + Wert (% oder Festwert in EUR). */
  rabattArt?: "prozent" | "festwert" | null;
  rabattWert?: string | number | null;
}

/** Hauptrabatt auf Belegebene: Prozent oder Festwert (EUR). */
export interface HauptrabattInput {
  art: "prozent" | "festwert";
  wert: number;
}

export interface Totals {
  nettoCent: number;
  ustCent: number;
  bruttoCent: number;
  ustProSatz: { satz: number; basisCent: number; betragCent: number }[];
  zeilenNettoCent: number[];
  /** Zwischensumme vor allen Rabatten. */
  zwischensummeCent: number;
  /** Positionsrabatt je Zeile (Cent). */
  zeilenRabattCent: number[];
  /** Summe aller Positionsrabatte. */
  rabattPositionenCent: number;
  /** Hauptrabatt gesamt (Cent). */
  hauptrabattCent: number;
}

/**
 * Belegsummen mit optionalen Rabatten.
 * Positionsrabatt: % oder Festwert je Zeile (Festwert auf die Zeilensumme, gedeckelt).
 * Hauptrabatt: auf die Summe nach Positionsrabatten — ausser rabattAddieren=true,
 * dann wird er auf die urspruengliche Zwischensumme gerechnet (additiv).
 * Verteilung pro-rata mit Largest-Remainder, USt-Gruppen aus den finalen Zeilen.
 */
export function computeTotals(
  items: TotalsInput[],
  hauptrabatt?: HauptrabattInput | null,
  rabattAddieren = false,
): Totals {
  const basis = items.map((it) =>
    Math.round(Number(it.menge) * Math.round(Number(it.einzelpreis) * 100)),
  );
  const zwischensummeCent = basis.reduce((a, b) => a + b, 0);

  // 1) Positionsrabatte
  const zeilenRabattCent = items.map((it, i) => {
    if (!it.rabattArt || it.rabattWert === null || it.rabattWert === undefined) return 0;
    const wert = Number(it.rabattWert);
    if (!Number.isFinite(wert) || wert <= 0) return 0;
    if (it.rabattArt === "prozent") return Math.min(basis[i], Math.round((basis[i] * Math.min(wert, 100)) / 100));
    return Math.min(basis[i], Math.round(wert * 100));
  });
  const rabattPositionenCent = zeilenRabattCent.reduce((a, b) => a + b, 0);
  const nachPositionen = basis.map((b, i) => b - zeilenRabattCent[i]);

  // 2) Hauptrabatt (pro-rata mit Largest-Remainder verteilen)
  let hauptrabattCent = 0;
  const zeilenHaupAnteil = basis.map(() => 0);
  if (hauptrabatt && Number.isFinite(hauptrabatt.wert) && hauptrabatt.wert > 0) {
    const grundlageZeilen = rabattAddieren ? basis : nachPositionen;
    const grundlage = grundlageZeilen.reduce((a, b) => a + b, 0);
    hauptrabattCent =
      hauptrabatt.art === "prozent"
        ? Math.min(grundlage, Math.round((grundlage * Math.min(hauptrabatt.wert, 100)) / 100))
        : Math.min(grundlage, Math.round(hauptrabatt.wert * 100));
    if (grundlage > 0 && hauptrabattCent > 0) {
      // exakte Verteilung: abgerundete Anteile + Rest an groesste Restbeträge
      const roh = grundlageZeilen.map((g) => (g / grundlage) * hauptrabattCent);
      const unten = roh.map(Math.floor);
      let rest = hauptrabattCent - unten.reduce((a, b) => a + b, 0);
      const reihenfolge = roh
        .map((r, i) => ({ i, rest: r - unten[i] }))
        .sort((a, b) => b.rest - a.rest);
      for (const { i } of reihenfolge) {
        if (rest <= 0) break;
        unten[i] += 1;
        rest -= 1;
      }
      for (let i = 0; i < unten.length; i++) zeilenHaupAnteil[i] = unten[i];
    }
  }

  const zeilenNettoCent = nachPositionen.map((n, i) => Math.max(0, n - zeilenHaupAnteil[i]));
  const nettoCent = zeilenNettoCent.reduce((a, b) => a + b, 0);

  const proSatz = new Map<number, number>();
  items.forEach((it, i) => {
    proSatz.set(it.ustSatz, (proSatz.get(it.ustSatz) ?? 0) + zeilenNettoCent[i]);
  });

  const ustProSatz = [...proSatz.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([satz, basisCent]) => ({
      satz,
      basisCent,
      betragCent: Math.round((basisCent * satz) / 100),
    }));

  const ustCent = ustProSatz.reduce((a, b) => a + b.betragCent, 0);
  return {
    nettoCent,
    ustCent,
    bruttoCent: nettoCent + ustCent,
    ustProSatz,
    zeilenNettoCent,
    zwischensummeCent,
    zeilenRabattCent,
    rabattPositionenCent,
    hauptrabattCent,
  };
}

export function centToDecimal(cent: number): string {
  return (cent / 100).toFixed(2);
}

export type OfferStatus =
  | "entwurf"
  | "offen"
  | "bestaetigt"
  | "abgelehnt"
  | "umgewandelt"
  | "storniert";
export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  entwurf: "Entwurf",
  offen: "Offen",
  bestaetigt: "Bestätigt",
  abgelehnt: "Abgelehnt",
  umgewandelt: "Umgewandelt",
  storniert: "Storniert",
};

/** Anzeige-Status: "offen" + gueltigBis in der Vergangenheit → "verstrichen". */
export function offerAnzeigeStatus(a: {
  status: OfferStatus;
  gueltigBis?: string | null;
}): OfferStatus | "verstrichen" {
  if (
    a.status === "offen" &&
    a.gueltigBis &&
    a.gueltigBis < new Date().toISOString().slice(0, 10)
  ) {
    return "verstrichen";
  }
  return a.status;
}

export const OFFER_ANZEIGE_LABELS: Record<OfferStatus | "verstrichen", string> = {
  ...OFFER_STATUS_LABELS,
  verstrichen: "Verstrichen",
};
