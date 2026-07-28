const nfGeld = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});
const nfZahl = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Decimal-String aus der DB → formatierter EUR-Betrag */
export function geld(decimal: string | number | null | undefined): string {
  if (decimal == null) return "–";
  return nfGeld.format(Number(decimal));
}

export function zahl(decimal: string | number | null | undefined): string {
  if (decimal == null) return "–";
  return nfZahl.format(Number(decimal));
}

export function datum(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [j, m, t] = iso.split("-");
  return `${t}.${m}.${j}`;
}

export function mengeFmt(m: string | number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(Number(m));
}

/** Nutzereingabe "1.234,56" → "1234.56" (API-Format) */
export function parseGeldInput(input: string): string {
  const cleaned = input.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  if (Number.isNaN(n)) return "0";
  return n.toFixed(2);
}

/** Nutzereingabe Menge "1,5" → "1.5" */
export function parseMengeInput(input: string): string {
  const cleaned = input.trim().replace(",", ".");
  const n = Number(cleaned);
  if (Number.isNaN(n)) return "0";
  return String(n);
}
