import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileSpreadsheet, Loader2, Package, ChevronDown } from "lucide-react";
import { textHerunterladen } from "@/lib/downloads";
import { KontierungsUebersicht } from "./KontierungsUebersicht";

/** DATEV-Buchungsstapel für einen Zeitraum erzeugen und herunterladen. */
export function DatevExport() {
  const utils = trpc.useUtils();
  const jahr = new Date().getFullYear();
  const [von, setVon] = useState(`${jahr}-01-01`);
  const [bis, setBis] = useState(`${jahr}-01-31`);
  const [laedt, setLaedt] = useState(false);
  const [ergebnis, setErgebnis] = useState<{ anzahl: number; belege: number; hinweise: string[] } | null>(null);
  const [nurFreigegebene, setNurFreigegebene] = useState(false);
  const [fehler, setFehler] = useState("");
  const [zipLaedt, setZipLaedt] = useState(false);
  const [kontierungenOffen, setKontierungenOffen] = useState(false);

  /** v1.21.12: komplettes Kanzlei-Paket als eine ZIP (Stapel + Belege + Berichte). */
  const paketHerunterladen = async () => {
    setZipLaedt(true);
    setFehler("");
    try {
      const r = await utils.client.export.stbPaketZip.query({ von, bis });
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      a.download = r.dateiname;
      a.click();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Paket-Export fehlgeschlagen.");
    } finally {
      setZipLaedt(false);
    }
  };

  const klick = async () => {
    setLaedt(true);
    setFehler("");
    setErgebnis(null);
    try {
      const antwort = await utils.client.export.datevBuchungsstapel.query({ von, bis, nurFreigegebene });
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
        <label className="flex cursor-pointer items-center gap-1.5 pb-1 text-xs text-neutral-600" title="Nur Eingangsrechnungen mit Freigabe-Status „freigegeben“ exportieren">
          <input type="checkbox" checked={nurFreigegebene} onChange={(e) => setNurFreigegebene(e.target.checked)} />
          nur freigegebene Belege
        </label>
        <Button variant="outline" onClick={klick} disabled={laedt || !von || !bis}>
          {laedt ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
          )}
          Buchungsstapel exportieren
        </Button>
        <Button onClick={paketHerunterladen} disabled={zipLaedt || !von || !bis} title="Komplettes Kanzlei-Paket: DATEV-Stapel + Belegbilder + EÜR/OP-Listen als eine ZIP">
          {zipLaedt ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Package className="mr-1.5 h-4 w-4" />}
          Kanzlei-Paket als ZIP
        </Button>
        <Button variant="ghost" onClick={() => setKontierungenOffen(!kontierungenOffen)} title="Verwendete SKR-Konten mit Summen im Zeitraum">
          <ChevronDown className={`mr-1 h-4 w-4 transition-transform ${kontierungenOffen ? "" : "-rotate-90"}`} />
          Kontierungsübersicht
        </Button>
      </div>
      {kontierungenOffen && (
        <div className="mt-3 rounded-md border border-neutral-200 bg-white p-3">
          <KontierungsUebersicht von={von} bis={bis} />
        </div>
      )}
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
