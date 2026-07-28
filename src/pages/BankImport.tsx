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
import { Upload, Landmark, CheckCircle2 } from "lucide-react";

type Mapping = { datum: string; betrag: string; name?: string; zweck?: string; gebuehr?: string };
type Vorschlag = {
  datum: string; betrag: number; name: string; zweck: string; gebuehr: number | null;
  status: "sicher" | "wahrscheinlich" | "kein";
  invoiceId?: number; nummer?: string; kundeName?: string; offenBetrag?: number; teil?: boolean;
};

const MAPPING_FELDER: { key: keyof Mapping; label: string; pflicht?: boolean }[] = [
  { key: "datum", label: "Datum", pflicht: true },
  { key: "betrag", label: "Betrag (Eingang)", pflicht: true },
  { key: "name", label: "Name/Gegenkonto" },
  { key: "zweck", label: "Verwendungszweck" },
  { key: "gebuehr", label: "Gebühr (SumUp)" },
];

export default function BankImport() {
  const utils = trpc.useUtils();
  const dateiRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [dateiname, setDateiname] = useState("");
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<number>>(new Set());
  const [gebucht, setGebucht] = useState<number | null>(null);

  const erkennen = trpc.bankImport.spaltenErkennen.useMutation({
    onSuccess: (d) => setMapping(d.mapping as Mapping),
  });
  const vorschlagen = trpc.bankImport.vorschlagen.useMutation();
  const buchen = trpc.bankImport.buchen.useMutation({
    onSuccess: (d) => {
      setGebucht(d.verbucht);
      utils.invoices.list.invalidate();
      utils.stats.uebersicht.invalidate();
      utils.stats.verlauf.invalidate();
    },
  });

  const dateiLesen = (datei: File) => {
    const leser = new FileReader();
    leser.onload = () => {
      const text = leser.result as string;
      if (text.includes("�")) {
        // Vermutlich Windows-Kodierung (deutsche Banken)
        const neu = new FileReader();
        neu.onload = () => fertig(neu.result as string);
        neu.readAsText(datei, "windows-1252");
      } else {
        fertig(text);
      }
    };
    leser.readAsText(datei, "utf-8");
    const fertig = (text: string) => {
      setCsvText(text);
      setDateiname(datei.name);
      setGebucht(null);
      erkennen.mutate({ csvText: text });
    };
  };

  const analysieren = () => {
    if (!csvText || !mapping) return;
    vorschlagen.mutate(
      { csvText, mapping },
      {
        onSuccess: (d) => {
          const start = new Set<number>();
          d.vorschlaege.forEach((v, i) => {
            if (v.status === "sicher" || v.status === "wahrscheinlich") start.add(i);
          });
          setAusgewaehlt(start);
        },
      },
    );
  };

  const ergebnis = vorschlagen.data;
  const waehlbar = ergebnis?.vorschlaege ?? [];
  const ausgewaehlteSumme = waehlbar
    .filter((_, i) => ausgewaehlt.has(i))
    .reduce((a, v) => a + v.betrag, 0);

  const statusBadge = (v: Vorschlag) => {
    if (v.status === "sicher") return <Badge>✓ {v.nummer}</Badge>;
    if (v.status === "wahrscheinlich")
      return <Badge variant="secondary">? {v.nummer}{v.teil ? " (Teil)" : ""}</Badge>;
    return <Badge variant="outline">kein Match</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Kontoauszug importieren</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Bank-CSV oder SumUp-Transaktionen einlesen — Zahlungseingänge werden
          offenen Rechnungen vorgeschlagen und nach deiner Bestätigung verbucht.
        </p>
      </div>

      {/* ── Schritt 1: Datei ── */}
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
          <p className="mt-2 text-xs text-neutral-500">
            Erkannt: <strong>{erkennen.data.vorlage}</strong> · {erkennen.data.zeilenGesamt} Zeilen
          </p>
        )}
        {erkennen.error && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {erkennen.error.message}
          </p>
        )}
      </section>

      {/* ── Schritt 2: Mapping ── */}
      {erkennen.data && mapping && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">2. Spalten zuordnen</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {MAPPING_FELDER.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs text-neutral-500">
                  {f.label}{f.pflicht ? " *" : ""}
                </label>
                <Select
                  value={mapping[f.key] ?? "—"}
                  onValueChange={(v) =>
                    setMapping({ ...mapping, [f.key]: v === "—" ? undefined : v })
                  }
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
          <Button className="mt-4" onClick={analysieren} disabled={vorschlagen.isPending}>
            <Landmark className="mr-1.5 h-4 w-4" />
            {vorschlagen.isPending ? "Analysiere …" : "Zahlungen zuordnen"}
          </Button>
          {vorschlagen.error && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {vorschlagen.error.message}
            </p>
          )}
        </section>
      )}

      {/* ── Schritt 3: Prüfen & buchen ── */}
      {ergebnis && !gebucht && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-medium text-neutral-700">3. Prüfen und buchen</h2>
          <p className="mb-3 text-xs text-neutral-400">
            {ergebnis.zugeordnet} von {ergebnis.gesamt} Eingängen zugeordnet ·
            Summe {geld(ergebnis.summe)}
            {ergebnis.gebuehrSumme ? ` · SumUp-Gebühren: ${geld(ergebnis.gebuehrSumme)}` : ""}.
            Häkchen kontrollieren — nur angehakte Zeilen werden gebucht.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="px-2 py-2 font-medium"></th>
                  <th className="px-2 py-2 font-medium">Datum</th>
                  <th className="px-2 py-2 font-medium">Name / Zweck</th>
                  <th className="px-2 py-2 text-right font-medium">Betrag</th>
                  {ergebnis.gebuehrSumme && <th className="px-2 py-2 text-right font-medium">Gebühr</th>}
                  <th className="px-2 py-2 font-medium">Zuordnung</th>
                </tr>
              </thead>
              <tbody>
                {waehlbar.map((v, i) => (
                  <tr key={i} className="border-b border-neutral-100 last:border-0">
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        disabled={v.status === "kein"}
                        checked={ausgewaehlt.has(i)}
                        onChange={(e) => {
                          const neu = new Set(ausgewaehlt);
                          e.target.checked ? neu.add(i) : neu.delete(i);
                          setAusgewaehlt(neu);
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 text-neutral-600">{fmtDatum(v.datum)}</td>
                    <td className="max-w-[260px] px-2 py-2">
                      <div className="truncate font-medium">{v.name || "—"}</div>
                      <div className="truncate text-xs text-neutral-400">{v.zweck}</div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{geld(v.betrag)}</td>
                    {ergebnis.gebuehrSumme && (
                      <td className="px-2 py-2 text-right tabular-nums text-neutral-500">
                        {v.gebuehr ? geld(v.gebuehr) : "–"}
                      </td>
                    )}
                    <td className="px-2 py-2">{statusBadge(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={ausgewaehlt.size === 0 || buchen.isPending}
              onClick={() =>
                buchen.mutate({
                  zuordnungen: waehlbar.flatMap((v, i) =>
                    ausgewaehlt.has(i) && "invoiceId" in v
                      ? [{ invoiceId: v.invoiceId, betrag: v.betrag, datum: v.datum }]
                      : [],
                  ),
                })
              }
            >
              {buchen.isPending
                ? "Buche …"
                : `${ausgewaehlt.size} Zahlungen buchen (${geld(ausgewaehlteSumme)})`}
            </Button>
            {buchen.error && (
              <span className="text-sm text-red-600">{buchen.error.message}</span>
            )}
          </div>
        </section>
      )}

      {/* ── Erfolg ── */}
      {gebucht !== null && (
        <section className="rounded-lg border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-2 text-green-800">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">
              {gebucht} Zahlung(en) verbucht — die Rechnungen sind aktualisiert.
            </span>
          </div>
          <Button variant="outline" className="mt-3" asChild>
            <Link to="/rechnungen">Zu den Rechnungen</Link>
          </Button>
        </section>
      )}
    </div>
  );
}
