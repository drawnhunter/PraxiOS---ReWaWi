import { useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Upload, FileUp } from "lucide-react";

interface ImportDialogProps {
  typ: "kunden" | "produkte";
  onFertig: () => void;
}

interface Vorschau {
  gesamt: number;
  gueltig: number;
  mitWarnung: number;
  vorschau: Record<string, unknown>[];
}

interface Ergebnis {
  importiert: number;
  uebersprungen: number;
  fehler: string[];
}

const SPALTEN: Record<string, { key: string; label: string }[]> = {
  kunden: [
    { key: "name", label: "Name" },
    { key: "strasse", label: "Straße" },
    { key: "plz", label: "PLZ" },
    { key: "ort", label: "Ort" },
    { key: "email", label: "E-Mail" },
    { key: "warnung", label: "Hinweis" },
  ],
  produkte: [
    { key: "name", label: "Name" },
    { key: "einheit", label: "Einheit" },
    { key: "preisNetto", label: "Verkaufspreis (VK) netto" },
    { key: "ustSatz", label: "USt" },
    { key: "warnung", label: "Hinweis" },
  ],
};

export default function ImportDialog({ typ, onFertig }: ImportDialogProps) {
  const [offen, setOffen] = useState(false);
  const [csvText, setCsvText] = useState<string>("");
  const [dateiname, setDateiname] = useState("");
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null);
  const dateiInput = useRef<HTMLInputElement>(null);

  const previewKunden = trpc.import.previewKunden.useQuery(
    { csvText },
    { enabled: typ === "kunden" && csvText.length > 0 },
  );
  const previewProdukte = trpc.import.previewProdukte.useQuery(
    { csvText },
    { enabled: typ === "produkte" && csvText.length > 0 },
  );
  const importKunden = trpc.import.importKunden.useMutation({
    onSuccess: (res) => {
      setErgebnis(res);
      onFertig();
    },
  });
  const importProdukte = trpc.import.importProdukte.useMutation({
    onSuccess: (res) => {
      setErgebnis(res);
      onFertig();
    },
  });

  const vorschau: Vorschau | undefined = (
    typ === "kunden" ? previewKunden.data : previewProdukte.data
  ) as Vorschau | undefined;
  const laedt =
    typ === "kunden" ? previewKunden.isLoading : previewProdukte.isLoading;
  const importiert =
    typ === "kunden" ? importKunden.isPending : importProdukte.isPending;
  const importFehler =
    typ === "kunden" ? importKunden.error : importProdukte.error;

  const dateiWaehlen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const datei = e.target.files?.[0];
    if (!datei) return;
    setDateiname(datei.name);
    setErgebnis(null);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(datei, "utf-8");
  };

  const importieren = () => {
    if (typ === "kunden") importKunden.mutate({ csvText });
    else importProdukte.mutate({ csvText });
  };

  const zuruecksetzen = () => {
    setCsvText("");
    setDateiname("");
    setErgebnis(null);
    if (dateiInput.current) dateiInput.current.value = "";
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOffen(true)}>
        <Upload className="mr-1.5 h-4 w-4" /> CSV-Import
      </Button>
      <Dialog
        open={offen}
        onOpenChange={(o) => {
          setOffen(o);
          if (!o) zuruecksetzen();
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {typ === "kunden" ? "Kunden aus CSV importieren" : "Produkte aus CSV importieren"}
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-neutral-500">
            {typ === "kunden"
              ? "Erwartet wird ein SumUp-Kundenexport (Name, Adresse, Telefon, E-Mail, Ländercode, USt.-IdNr., Zahlungsbedingungen …). Die Adresse wird automatisch in Straße, PLZ und Ort zerlegt."
              : "Erwartet wird ein SumUp-Artikelexport (Item name, Price, Tax rate, Unit, Description …). Einheiten und Steuersätze werden automatisch übernommen."}
          </p>

          <div className="flex items-center gap-3">
            <input
              ref={dateiInput}
              type="file"
              accept=".csv,text/csv"
              onChange={dateiWaehlen}
              className="text-sm"
            />
            {dateiname && <Badge variant="secondary">{dateiname}</Badge>}
          </div>

          {laedt && <p className="text-sm text-neutral-500">Analysiere Datei …</p>}

          {vorschau && !ergebnis && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Badge>{vorschau.gesamt} Zeilen erkannt</Badge>
                {vorschau.mitWarnung > 0 && (
                  <Badge variant="secondary">{vorschau.mitWarnung} mit Hinweis</Badge>
                )}
              </div>
              <div className="max-h-64 overflow-auto rounded-md border border-neutral-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-neutral-50 text-left text-neutral-500">
                      {SPALTEN[typ].map((s) => (
                        <th key={s.key} className="px-3 py-2 font-medium">
                          {s.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vorschau.vorschau.map((z, i) => (
                      <tr key={i} className="border-b border-neutral-100 last:border-0">
                        {SPALTEN[typ].map((s) => (
                          <td
                            key={s.key}
                            className={`max-w-48 truncate px-3 py-1.5 ${
                              s.key === "warnung" && z[s.key]
                                ? "text-amber-600"
                                : "text-neutral-700"
                            }`}
                          >
                            {z[s.key] != null ? String(z[s.key]) : ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {vorschau.gesamt > 8 && (
                <p className="text-xs text-neutral-400">
                  Vorschau: erste 8 von {vorschau.gesamt} Zeilen.
                </p>
              )}
            </>
          )}

          {ergebnis && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm">
              <div className="font-medium text-green-800">
                {ergebnis.importiert} Datensätze importiert,{" "}
                {ergebnis.uebersprungen} übersprungen.
              </div>
              {ergebnis.fehler.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-neutral-600">
                  {ergebnis.fehler.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {importFehler && (
            <p className="text-sm text-red-600">{importFehler.message}</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOffen(false)}>
              Schließen
            </Button>
            {!ergebnis && (
              <Button
                onClick={importieren}
                disabled={!vorschau || vorschau.gueltig === 0 || importiert}
              >
                <FileUp className="mr-1.5 h-4 w-4" />
                {importiert
                  ? "Importiere …"
                  : `${vorschau?.gueltig ?? 0} Datensätze importieren`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
