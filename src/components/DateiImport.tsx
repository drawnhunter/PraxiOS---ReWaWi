import { useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { datum as fmtDatum } from "@/lib/format";
import { CheckCircle2, FileText, FileUp, Loader2, Trash2, Upload, XCircle } from "lucide-react";

interface DateiZustand {
  name: string;
  base64: string;
  status: "analysiert" | "fehler";
  existiert?: boolean;
  fehler?: string;
  gruppe?: {
    nummer: string;
    datum: string | null;
    kunde: string;
    positionen: number;
    brutto: string;
    bezahlt: boolean;
    quelle: "SumUp-PDF" | "XRechnung";
  };
}

interface Ergebnis {
  importiert: number;
  uebersprungen: number;
  kundenNeu: number;
  fehler: string[];
  dateiFehler: { name: string; fehler: string }[];
}

function liesDatei(datei: File): Promise<string> {
  return new Promise((ok, fehler) => {
    const r = new FileReader();
    r.onload = () => ok((r.result as string).split(",")[1]);
    r.onerror = fehler;
    r.readAsDataURL(datei);
  });
}

export function DateiImport() {
  const utils = trpc.useUtils();
  const dateiRef = useRef<HTMLInputElement>(null);
  const [dateien, setDateien] = useState<DateiZustand[]>([]);
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null);
  const [ziehen, setZiehen] = useState(false);

  const analysieren = trpc.invoiceImport.analysierenDateien.useMutation();
  const importieren = trpc.invoiceImport.importierenDateien.useMutation({
    onSuccess: (d) => {
      setErgebnis(d as Ergebnis);
      utils.invoices.list.invalidate();
      utils.customers.list.invalidate();
    },
  });

  const aufnehmen = async (liste: FileList | File[]) => {
    const neu: { name: string; base64: string }[] = [];
    for (const f of Array.from(liste).slice(0, 50)) {
      neu.push({ name: f.name, base64: await liesDatei(f) });
    }
    if (neu.length === 0) return;
    setErgebnis(null);
    const analyse = await analysieren.mutateAsync({ dateien: neu });
    setDateien((alt) => [
      ...alt,
      ...analyse.dateien.map((a) => ({
        name: a.name,
        base64: neu.find((n) => n.name === a.name)!.base64,
        status: a.ok ? ("analysiert" as const) : ("fehler" as const),
        existiert: a.existiert,
        fehler: a.fehler,
        gruppe: a.gruppe,
      })),
    ]);
  };

  const importierbar = dateien.filter((d) => d.status === "analysiert" && !d.existiert).length;
  const duplikate = dateien.filter((d) => d.existiert).length;

  const starten = () => {
    importieren.mutate({ dateien: dateien.map((d) => ({ name: d.name, base64: d.base64 })) });
  };

  const zuruecksetzen = () => {
    setDateien([]);
    setErgebnis(null);
    if (dateiRef.current) dateiRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      {/* Upload-Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setZiehen(true);
        }}
        onDragLeave={() => setZiehen(false)}
        onDrop={(e) => {
          e.preventDefault();
          setZiehen(false);
          void aufnehmen(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          ziehen ? "border-teal-600 bg-teal-50" : "border-neutral-300 bg-white"
        }`}
      >
        <FileUp className="mx-auto h-7 w-7 text-neutral-400" />
        <p className="mt-2 text-sm text-neutral-600">
          Rechnungs-PDFs (SumUp) oder XRechnungen hierher ziehen oder{" "}
          <button type="button" className="font-medium text-teal-700 underline" onClick={() => dateiRef.current?.click()}>
            auswählen
          </button>{" "}
          (bis zu 50)
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          Komplette Belege inkl. Kundenadresse und Positionen — Original-Nummern, laufender Nummernkreis bleibt unberührt
        </p>
        <input
          ref={dateiRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.xml"
          onChange={(e) => e.target.files && void aufnehmen(e.target.files)}
        />
      </div>

      {/* Analyse-Liste */}
      {dateien.length > 0 && !ergebnis && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600">
            <span>
              <strong className="text-teal-700">{importierbar}</strong> importierbar
            </span>
            {duplikate > 0 && (
              <span>
                · <strong className="text-amber-600">{duplikate}</strong> bereits vorhanden
              </span>
            )}
            {dateien.some((d) => d.status === "fehler") && (
              <span>
                · <strong className="text-red-600">{dateien.filter((d) => d.status === "fehler").length}</strong> nicht
                lesbar
              </span>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Datei</th>
                  <th className="px-3 py-2 font-medium">Nummer</th>
                  <th className="px-3 py-2 font-medium">Datum</th>
                  <th className="px-3 py-2 font-medium">Kunde</th>
                  <th className="px-3 py-2 font-medium text-right">Positionen</th>
                  <th className="px-3 py-2 font-medium text-right">Brutto</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {dateien.map((d, i) => (
                  <tr key={i} className="border-b border-neutral-100 last:border-0">
                    <td className="max-w-48 truncate px-3 py-2 text-neutral-500" title={d.name}>
                      <span className="flex items-center gap-1.5">
                        <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                        {d.name}
                      </span>
                    </td>
                    {d.status === "analysiert" && d.gruppe ? (
                      <>
                        <td className="px-3 py-2 font-medium text-neutral-800">{d.gruppe.nummer}</td>
                        <td className="px-3 py-2 text-neutral-600">{d.gruppe.datum ? fmtDatum(d.gruppe.datum) : "–"}</td>
                        <td className="px-3 py-2 text-neutral-600">{d.gruppe.kunde}</td>
                        <td className="px-3 py-2 text-right text-neutral-600">{d.gruppe.positionen}</td>
                        <td className="px-3 py-2 text-right font-medium text-neutral-800">{d.gruppe.brutto} €</td>
                        <td className="px-3 py-2">
                          {d.existiert ? (
                            <Badge variant="outline" className="text-amber-600">
                              Duplikat
                            </Badge>
                          ) : (
                            <Badge variant={d.gruppe.bezahlt ? "secondary" : "outline"}>
                              {d.gruppe.bezahlt ? "bezahlt" : "offen"}
                            </Badge>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} className="px-3 py-2 text-sm text-red-600">
                        {d.fehler}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDateien((alt) => alt.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4 text-neutral-400" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={starten} disabled={importierbar === 0 || importieren.isPending}>
              {importieren.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {importierbar} Rechnungen importieren
            </Button>
            <Button variant="ghost" onClick={zuruecksetzen}>
              Zurücksetzen
            </Button>
          </div>
        </div>
      )}

      {/* Ergebnis */}
      {ergebnis && (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
          <div className="flex items-center gap-2 text-teal-700">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">
              {ergebnis.importiert} Rechnungen importiert
              {ergebnis.kundenNeu > 0 ? ` · ${ergebnis.kundenNeu} Kunden neu angelegt` : ""}
            </span>
          </div>
          {ergebnis.uebersprungen > 0 && (
            <p className="text-sm text-neutral-500">{ergebnis.uebersprungen} übersprungen (Duplikate/unvollständig)</p>
          )}
          {ergebnis.fehler.length > 0 && (
            <ul className="text-sm text-amber-700">
              {ergebnis.fehler.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          {ergebnis.dateiFehler.length > 0 && (
            <ul className="text-sm text-red-600">
              {ergebnis.dateiFehler.map((f, i) => (
                <li key={i}>
                  <XCircle className="mr-1 inline h-3.5 w-3.5" />
                  {f.name}: {f.fehler}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={zuruecksetzen}>
              Weitere Dateien importieren
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/rechnungen">Zu den Rechnungen →</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
