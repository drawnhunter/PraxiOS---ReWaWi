/** Firmen-Stammdaten (read-only, SB-Sicht) — Unternehmen + Kanzlei-Cockpit. */
export function Stammdaten({ daten }: { daten: Record<string, unknown> }) {
  const felder: [string, unknown][] = [
    ["Name", daten.name],
    ["Anschrift", `${daten.strasse ?? ""}, ${daten.plz ?? ""} ${daten.ort ?? ""}`],
    ["E-Mail", daten.email],
    ["Telefon", daten.telefon],
    ["IBAN", daten.iban],
    ["BIC", daten.bic],
    ["Kontenrahmen", daten.datevKontenrahmen],
    ["Erlöskonten (19/7/0 %)", `${daten.erloeskonto19} / ${daten.erloeskonto7} / ${daten.erloeskonto0}`],
    ["Standard-Aufwandskonto", daten.aufwandskontoDefault],
    ["Standard-Zahlungsziel", `${daten.standardZahlungsziel} Tage`],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {felder.map(([label, wert]) => (
        <div key={label} className="flex gap-2">
          <dt className="w-44 shrink-0 text-neutral-500">{label}</dt>
          <dd className="min-w-0 font-medium text-neutral-800">{String(wert ?? "—") || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
