import { useRef, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { geld } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle2, FileDown, AlertTriangle } from "lucide-react";

export default function NachweisImport() {
  const utils = trpc.useUtils();
  const dateiRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [dateiname, setDateiname] = useState("");
  const [fertig, setFertig] = useState<{ erstellt: { id: number; zeitraum: string; arzt: string }[]; uebersprungen: string[] } | null>(null);

  const vorschau = trpc.nachweis.vorschau.useMutation();
  const importieren = trpc.nachweis.importieren.useMutation({
    onSuccess: (d) => {
      setFertig(d);
      utils.invoices.list.invalidate();
    },
  });

  const dateiLesen = (datei: File) => {
    const lesen = (enc: string, cb: (t: string) => void) => {
      const r = new FileReader();
      r.onload = () => cb(r.result as string);
      r.readAsText(datei, enc);
    };
    lesen("utf-8", (text) => {
      if (text.includes("�")) lesen("windows-1252", speichern);
      else speichern(text);
    });
    const speichern = (text: string) => {
      setCsvText(text);
      setDateiname(datei.name);
      setFertig(null);
      vorschau.mutate({ csvText: text });
    };
  };

  const importierbar = (vorschau.data?.gruppen ?? []).filter((g) => g.customerId).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Nutzungsnachweis importieren</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Aggregierte Verbrauchsdaten der Ärzte (Räume, Maschinen, Therapien,
          Material, Personal) einlesen — pro Zeitraum und Arzt entsteht ein
          <strong> Rechnungsentwurf</strong> mit den Preisen aus dem Katalog
          (inkl. Konditionen). Format: Spezifikation v1.0 (Semikolon-CSV).
        </p>
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-neutral-700">1. Datei wählen</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => dateiRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" /> CSV-Datei wählen
          </Button>
          <input
            ref={dateiRef}
            type="file"
            accept=".csv,.txt,.tsv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && dateiLesen(e.target.files[0])}
          />
          {dateiname && <span className="text-sm text-neutral-600">{dateiname}</span>}
        </div>
        {vorschau.error && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{vorschau.error.message}</p>
        )}
      </section>

      {vorschau.data && !fertig && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">2. Vorschau & Erstellen</h2>
          <div className="space-y-4">
            {vorschau.data.gruppen.map((g, gi) => (
              <div key={gi} className="rounded-md border border-neutral-200 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {g.zeitraum} · {g.arzt}
                    {g.customerId ? (
                      <Badge variant="secondary" className="ml-2">{g.kundeName}</Badge>
                    ) : (
                      <Badge variant="destructive" className="ml-2">nicht im Kundenstamm</Badge>
                    )}
                  </div>
                  <div className="text-sm font-semibold">{geld(g.bruttoCent / 100)}</div>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {g.positionen.map((p, i) => (
                      <tr key={i} className="border-b border-neutral-100 last:border-0">
                        <td className="py-1.5 pr-2">
                          {p.bezeichnung}
                          {!p.gematcht && (
                            <span title="nicht im Katalog"><AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-500" /></span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-neutral-500">{p.menge} {p.einheit}</td>
                        <td className="py-1.5 pr-2 text-right text-neutral-500">
                          {geld(p.einzelpreis)}
                          {p.quelle === "kondition" && <span className="ml-1 text-xs text-neutral-400">(Kondition)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {g.warnungen.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-xs text-amber-700">
                    {g.warnungen.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={importierbar === 0 || importieren.isPending}
              onClick={() => csvText && importieren.mutate({ csvText })}
            >
              <FileDown className="mr-1.5 h-4 w-4" />
              {importieren.isPending ? "Erstelle …" : `${importierbar} Rechnungsentwurf/Entwürfe erstellen`}
            </Button>
            {importieren.error && <span className="text-sm text-red-600">{importieren.error.message}</span>}
          </div>
        </section>
      )}

      {fertig && (
        <section className="rounded-lg border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-2 text-green-800">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">
              {fertig.erstellt.length} Entwurf/Entwürfe erstellt
              {fertig.uebersprungen.length > 0 && ` — übersprungen: ${fertig.uebersprungen.join(", ")}`}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {fertig.erstellt.map((e) => (
              <Button key={e.id} variant="outline" size="sm" asChild>
                <Link to={`/rechnungen/${e.id}`}>{e.zeitraum} · {e.arzt} öffnen</Link>
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
