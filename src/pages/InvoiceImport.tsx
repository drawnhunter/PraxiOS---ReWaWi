import { useRef, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { geld, datum as fmtDatum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, CheckCircle2, FileDown } from "lucide-react";
import { DateiImport } from "@/components/DateiImport";

type Mapping = Record<string, string | undefined>;
const FELDER: { key: string; label: string; pflicht?: boolean }[] = [
  { key: "nummer", label: "Rechnungsnummer *", pflicht: true },
  { key: "datum", label: "Rechnungsdatum *", pflicht: true },
  { key: "kunde", label: "Kundenname *", pflicht: true },
  { key: "beschreibung", label: "Position: Beschreibung" },
  { key: "menge", label: "Position: Menge" },
  { key: "einzelpreis", label: "Position: Einzelpreis (netto)" },
  { key: "einheit", label: "Position: Einheit" },
  { key: "ustSatz", label: "USt-Satz" },
  { key: "brutto", label: "Bruttosumme (Kopfebene)" },
  { key: "status", label: "Zahlungsstatus" },
  { key: "faellig", label: "Fälligkeitsdatum" },
  { key: "kundeStrasse", label: "Kunde: Straße" },
  { key: "kundePlz", label: "Kunde: PLZ" },
  { key: "kundeOrt", label: "Kunde: Ort" },
  { key: "kundeEmail", label: "Kunde: E-Mail" },
];

export default function InvoiceImport() {
  const utils = trpc.useUtils();
  const dateiRef = useRef<HTMLInputElement>(null);
  const [modus, setModus] = useState<"datei" | "csv">("datei");
  const [csvText, setCsvText] = useState<string | null>(null);
  const [dateiname, setDateiname] = useState("");
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [fertig, setFertig] = useState<{ importiert: number; uebersprungen: number; kundenNeu: number; fehler: string[] } | null>(null);

  const erkennen = trpc.invoiceImport.spaltenErkennen.useMutation({
    onSuccess: (d) => setMapping(d.mapping as Mapping),
  });
  const vorschau = trpc.invoiceImport.vorschau.useMutation();
  const importieren = trpc.invoiceImport.importieren.useMutation({
    onSuccess: (d) => {
      setFertig(d);
      utils.invoices.list.invalidate();
      utils.customers.list.invalidate();
      utils.stats.uebersicht.invalidate();
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
      erkennen.mutate({ csvText: text });
    };
  };

  const analysieren = () => {
    if (!csvText || !mapping) return;
    vorschau.mutate({ csvText, mapping: mapping as never });
  };

  const gruppen = vorschau.data?.gruppen ?? [];
  const importierbar = vorschau.data?.importierbar ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Rechnungen importieren</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Altbestand übernehmen — am vollständigsten aus den <strong>Rechnungs-PDFs</strong> (SumUp)
          oder XRechnungen; alternativ aus einer Rechnungs-CSV. Die Belege behalten ihre{" "}
          <strong>Original-Nummern</strong> und werden als finalisiert importiert — dein laufender
          Nummernkreis bleibt unberührt.
        </p>
      </div>

      {/* Modus-Wahl */}
      <div className="flex gap-2">
        <Button size="sm" variant={modus === "datei" ? "default" : "outline"} onClick={() => setModus("datei")}>
          PDF & XRechnung (vollständig)
        </Button>
        <Button size="sm" variant={modus === "csv" ? "default" : "outline"} onClick={() => setModus("csv")}>
          CSV-Export
        </Button>
      </div>

      {modus === "datei" && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <DateiImport />
        </section>
      )}

      {modus === "csv" && (
        <>
      {/* ── Schritt 1 ── */}
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
        {erkennen.data && (
          <p className="mt-2 text-xs text-neutral-500">{erkennen.data.zeilenGesamt} Zeilen erkannt.</p>
        )}
        {erkennen.error && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erkennen.error.message}</p>
        )}
      </section>

      {/* ── Schritt 2 ── */}
      {erkennen.data && mapping && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">2. Spalten zuordnen</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {FELDER.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs text-neutral-500">{f.label}</label>
                <Select
                  value={mapping[f.key] ?? "—"}
                  onValueChange={(v) => setMapping({ ...mapping, [f.key]: v === "—" ? undefined : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!f.pflicht && <SelectItem value="—">— nicht vorhanden —</SelectItem>}
                    {erkennen.data.spalten.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-neutral-400">
            Mit Positions-Spalten werden echte Belegpositionen gebaut; ohne sie
            entsteht je Rechnung eine Sammelposition aus der Bruttosumme.
            Ohne Status-Spalte gelten Alt-Rechnungen als bezahlt.
          </p>
          <Button className="mt-3" onClick={analysieren} disabled={vorschau.isPending}>
            <FileDown className="mr-1.5 h-4 w-4" />
            {vorschau.isPending ? "Analysiere …" : "Vorschau berechnen"}
          </Button>
          {vorschau.error && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{vorschau.error.message}</p>
          )}
        </section>
      )}

      {/* ── Schritt 3 ── */}
      {vorschau.data && !fertig && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-medium text-neutral-700">3. Vorschau & Import</h2>
          <p className="mb-3 text-xs text-neutral-400">
            {importierbar} von {vorschau.data.gesamt} Rechnungen importierbar
            {vorschau.data.duplikate > 0 && ` · ${vorschau.data.duplikate} Duplikate (übersprungen)`}
            {vorschau.data.fehlerhaft > 0 && ` · ${vorschau.data.fehlerhaft} fehlerhaft (übersprungen)`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="px-2 py-2 font-medium">Nummer</th>
                  <th className="px-2 py-2 font-medium">Datum</th>
                  <th className="px-2 py-2 font-medium">Kunde</th>
                  <th className="px-2 py-2 text-right font-medium">Positionen</th>
                  <th className="px-2 py-2 text-right font-medium">Brutto</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {gruppen.map((g) => (
                  <tr key={g.nummer} className="border-b border-neutral-100 last:border-0">
                    <td className="px-2 py-2 font-medium">{g.nummer}</td>
                    <td className="px-2 py-2 text-neutral-600">{g.datum ? fmtDatum(g.datum) : "–"}</td>
                    <td className="px-2 py-2">{g.kunde || "–"}</td>
                    <td className="px-2 py-2 text-right text-neutral-600">{g.items.length}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{geld(g.bruttoCent / 100)}</td>
                    <td className="px-2 py-2">
                      {g.existiert ? (
                        <Badge variant="destructive">existiert</Badge>
                      ) : g.warnung ? (
                        <Badge variant="outline" title={g.warnung}>Fehler</Badge>
                      ) : g.bezahlt ? (
                        <Badge variant="secondary">bezahlt</Badge>
                      ) : (
                        <Badge variant="outline">offen</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={importierbar === 0 || importieren.isPending}
              onClick={() => csvText && mapping && importieren.mutate({ csvText, mapping: mapping as never })}
            >
              {importieren.isPending ? "Importiere …" : `${importierbar} Rechnungen importieren`}
            </Button>
            {importieren.error && <span className="text-sm text-red-600">{importieren.error.message}</span>}
          </div>
        </section>
      )}

      {/* ── Erfolg ── */}
      {fertig && (
        <section className="rounded-lg border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-2 text-green-800">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">
              {fertig.importiert} Rechnungen importiert
              {fertig.kundenNeu > 0 && `, ${fertig.kundenNeu} Kunden neu angelegt`}
              {fertig.uebersprungen > 0 && `, ${fertig.uebersprungen} übersprungen`}.
            </span>
          </div>
          {fertig.fehler.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-green-700">
              {fertig.fehler.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
          <Button variant="outline" className="mt-3" asChild>
            <Link to="/rechnungen">Zu den Rechnungen</Link>
          </Button>
        </section>
      )}
        </>
      )}
    </div>
  );
}
