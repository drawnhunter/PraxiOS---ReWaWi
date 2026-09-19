import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { textHerunterladen } from "@/lib/downloads";

/** DATEV-Buchungsstapel für einen Zeitraum erzeugen und herunterladen. */
export function DatevExport() {
  const utils = trpc.useUtils();
  const jahr = new Date().getFullYear();
  const [von, setVon] = useState(`${jahr}-01-01`);
  const [bis, setBis] = useState(`${jahr}-01-31`);
  const [laedt, setLaedt] = useState(false);
  const [ergebnis, setErgebnis] = useState<{ anzahl: number; belege: number; hinweise: string[] } | null>(null);
  const [fehler, setFehler] = useState("");

  const klick = async () => {
    setLaedt(true);
    setFehler("");
    setErgebnis(null);
    try {
      const antwort = await utils.client.export.datevBuchungsstapel.query({ von, bis });
      textHerunterladen(antwort.dateiname, "﻿" + antwort.csv, "text/csv");
      // Belegbilder-ZIP direkt mit ausliefern (falls Belege vorhanden)
      if (antwort.belegeZipBase64 && antwort.belegeDateiname) {
        const bytes = Uint8Array.from(atob(antwort.belegeZipBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/zip" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = antwort.belegeDateiname;
        a.click();
      }
      setErgebnis({ anzahl: antwort.anzahlBuchungen, belege: antwort.anzahlBelege ?? 0, hinweise: antwort.hinweise });
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Export fehlgeschlagen.");
    } finally {
      setLaedt(false);
    }
  };

  return (
    <div className="rounded-md border border-neutral-100 bg-neutral-50 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Zeitraum von</Label>
          <Input type="date" value={von} onChange={(e) => setVon(e.target.value)} />
        </div>
        <div>
          <Label>bis</Label>
          <Input type="date" value={bis} onChange={(e) => setBis(e.target.value)} />
        </div>
        <Button variant="outline" onClick={klick} disabled={laedt || !von || !bis}>
          {laedt ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
          )}
          Buchungsstapel exportieren
        </Button>
      </div>
      {fehler && <p className="mt-2 text-sm text-red-600">{fehler}</p>}
      {ergebnis && (
        <div className="mt-2 text-sm text-neutral-600">
          <p>
            {ergebnis.anzahl} Buchungssätze exportiert
            {ergebnis.belege > 0 ? ` · ${ergebnis.belege} Belegdateien im ZIP` : ""}.
          </p>
          {ergebnis.hinweise.map((h, i) => (
            <p key={i} className="text-xs text-amber-700">{h}</p>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-neutral-400">
        Exportiert werden finalisierte Rechnungen (Soll Debitor an Erlöskonto, BU-Schlüssel),
        Gutschriften, Eingangsrechnungen und kategorisierte Bankbuchungen des Zeitraums.
        Belege liegen als ZIP bei (Referenz: Belegfeld 1) — bereit für die Kanzlei/DATEV-Belegbilder.
      </p>
    </div>
  );
}
