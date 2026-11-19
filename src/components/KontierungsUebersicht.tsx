import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";

/** Kontierungsübersicht (v1.21.12): tatsächlich verwendete SKR-Konten mit Summen
 *  im Zeitraum — die Kanzlei sieht auf einen Blick, was wie gebucht wurde. */
export function KontierungsUebersicht({ von, bis }: { von: string; bis: string }) {
  const daten = trpc.berichte.kontierungen.useQuery({ von, bis });
  const zeilen = daten.data?.zeilen ?? [];
  const rahmen = daten.data?.kontenrahmen ?? "SKR03";

  const summe = (typ: "einnahme" | "ausgabe", feld: "netto" | "ust" | "brutto") =>
    zeilen.filter((z) => z.typ === typ).reduce((a, z) => a + z[feld], 0);
  const geld = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

  const csvHerunterladen = () => {
    const kopf = ["Konto", "Typ", "Anzahl Belege", "Netto", "USt", "Brutto"];
    const body = zeilen.map((z) =>
      [z.konto, z.typ, String(z.anzahl), z.netto.toFixed(2), z.ust.toFixed(2), z.brutto.toFixed(2)]
        .map((x) => `"${x.replaceAll(".", ",")}"`).join(";"),
    );
    const csv = [kopf.join(";"), ...body].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `Kontierungen_${von}_${bis}.csv`;
    a.click();
  };

  if (daten.isLoading) return <p className="text-sm text-neutral-400">Kontierungen werden geladen …</p>;
  if (daten.error) return <p className="text-sm text-red-600">Fehler: {daten.error.message}</p>;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          Verwendete Konten im Zeitraum {von} – {bis} · Kontenrahmen {rahmen}
        </p>
        <Button size="sm" variant="outline" disabled={zeilen.length === 0} onClick={csvHerunterladen}>
          <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Als CSV
        </Button>
      </div>
      {zeilen.length === 0 ? (
        <p className="py-4 text-center text-sm text-neutral-400">Keine Buchungen in diesem Zeitraum.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="py-1.5 pr-3 font-medium">Konto</th>
              <th className="py-1.5 pr-3 font-medium">Typ</th>
              <th className="py-1.5 pr-3 text-right font-medium">Belege</th>
              <th className="py-1.5 pr-3 text-right font-medium">Netto</th>
              <th className="py-1.5 pr-3 text-right font-medium">USt</th>
              <th className="py-1.5 text-right font-medium">Brutto</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z, i) => (
              <tr key={i} className="border-b border-neutral-100 last:border-0">
                <td className="py-1.5 pr-3 font-medium">{z.konto}</td>
                <td className="py-1.5 pr-3 text-neutral-600">{z.typ === "einnahme" ? "Einnahme" : "Ausgabe"}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{z.anzahl}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{geld(z.netto)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{geld(z.ust)}</td>
                <td className="py-1.5 text-right tabular-nums">{geld(z.brutto)}</td>
              </tr>
            ))}
            <tr className="bg-neutral-50 font-medium">
              <td className="py-1.5 pr-3" colSpan={3}>Summen Einnahmen / Ausgaben</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{geld(summe("einnahme", "netto"))} / {geld(summe("ausgabe", "netto"))}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{geld(summe("einnahme", "ust"))} / {geld(summe("ausgabe", "ust"))}</td>
              <td className="py-1.5 text-right tabular-nums">{geld(summe("einnahme", "brutto"))} / {geld(summe("ausgabe", "brutto"))}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
