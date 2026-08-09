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
}

export interface Totals {
  nettoCent: number;
  ustCent: number;
  bruttoCent: number;
  ustProSatz: { satz: number; basisCent: number; betragCent: number }[];
  zeilenNettoCent: number[];
}

export function computeTotals(items: TotalsInput[]): Totals {
  const zeilenNettoCent = items.map((it) =>
    Math.round(Number(it.menge) * Math.round(Number(it.einzelpreis) * 100)),
  );
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
  };
}

export function centToDecimal(cent: number): string {
  return (cent / 100).toFixed(2);
}

export type OfferStatus = "entwurf" | "finalisiert" | "umgewandelt" | "storniert";
export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  entwurf: "Entwurf",
  finalisiert: "Finalisiert",
  umgewandelt: "Umgewandelt",
  storniert: "Storniert",
};
