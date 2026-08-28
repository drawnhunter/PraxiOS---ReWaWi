import { useRef, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { geld, datum as fmtDatum } from "@/lib/format";
import { pdfHerunterladen } from "@/lib/downloads";
import { useSortierung } from "@/lib/sortierung";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Upload, Landmark, CheckCircle2, FileDown, Link2, Unlink, Ban, Trash2,
  RotateCcw, Search, AlertTriangle, Settings2,
} from "lucide-react";

type Mapping = {
  datum: string; betrag: string; name?: string; zweck?: string; gebuehr?: string; saldo?: string;
};

const MAPPING_FELDER: { key: keyof Mapping; label: string; pflicht?: boolean }[] = [
  { key: "datum", label: "Datum", pflicht: true },
  { key: "betrag", label: "Betrag (vorzeichenbehaftet)", pflicht: true },
  { key: "name", label: "Name/Gegenkonto" },
  { key: "zweck", label: "Verwendungszweck" },
  { key: "gebuehr", label: "Gebühr (SumUp)" },
  { key: "saldo", label: "Saldo/Kontostand" },
];

type Tab = "transaktionen" | "import" | "importe";

export default function Banking() {
  const utils = trpc.useUtils();
  const [kontoId, setKontoId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("transaktionen");

  const uebersicht = trpc.bankTrans.kontenUebersicht.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const konten = uebersicht.data ?? [];
  const gewaehlt = konten.find((k) => k.konto.id === kontoId) ?? konten.find((k) => k.konto.aktiv) ?? null;

  const inval = () => {
    utils.bankTrans.kontenUebersicht.invalidate();
    utils.bankTrans.liste.invalidate();
    utils.bankTrans.offeneZiele.invalidate();
    utils.bankTrans.importe.invalidate();
    utils.invoices.list.invalidate();
    utils.stats.uebersicht.invalidate();
    utils.stats.verlauf.invalidate();
  };

  if (uebersicht.isLoading) {
    return <p className="text-sm text-neutral-500">Lade Bankkonten …</p>;
  }

  if (konten.filter((k) => k.konto.aktiv).length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Banking</h1>
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <Landmark className="h-4 w-4" /> Noch kein aktives Bankkonto
          </p>
          <p className="mt-1">
            Lege zuerst ein Bankkonto an — danach kannst du Kontoauszüge importieren,
            Zahlungen zuordnen und Auszüge als PDF ziehen.
          </p>
          <Button variant="outline" className="mt-3" asChild>
            <Link to="/einstellungen">Zu den Einstellungen</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Banking</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Kontoauszüge importieren, Zahlungen zuordnen, Salden prüfen — für alle Konten.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/einstellungen"><Settings2 className="mr-1.5 h-4 w-4" /> Konten verwalten</Link>
        </Button>
      </div>

      {/* ── Konto-Karten ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {konten.map((k) => {
          const aktiv = gewaehlt?.konto.id === k.konto.id;
          return (
            <button
              key={k.konto.id}
              onClick={() => k.konto.aktiv && setKontoId(k.konto.id)}
              disabled={!k.konto.aktiv}
              className={`rounded-lg border p-4 text-left transition ${
                aktiv
                  ? "border-neutral-900 bg-white ring-1 ring-neutral-900"
                  : k.konto.aktiv
                    ? "border-neutral-200 bg-white hover:border-neutral-400"
                    : "border-neutral-200 bg-neutral-50 opacity-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{k.konto.bezeichnung}</span>
                {k.konto.istStandard ? <Badge>Standard</Badge> : !k.konto.aktiv ? <Badge variant="outline">inaktiv</Badge> : null}
              </div>
              <div className="mt-0.5 truncate text-xs text-neutral-400">
                {k.konto.bankName} · {k.konto.iban}
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-lg font-semibold tabular-nums">
                  {k.saldo !== null ? geld(k.saldo) : "–"}
                  {k.saldoIstBerechnet && k.saldo !== null && (
                    <span className="ml-1 text-xs font-normal text-neutral-400" title="Aus Buchungen berechnet (kein Saldo in den Importdaten)">*</span>
                  )}
                </span>
                {k.offen > 0 ? (
                  <Badge variant="secondary">{k.offen} offen</Badge>
                ) : (
                  <span className="text-xs text-neutral-400">alles zugeordnet</span>
                )}
              </div>
              <div className="mt-1 text-xs text-neutral-400">
                {k.anzahl > 0
                  ? `${k.anzahl} Buchungen · letzte ${fmtDatum(k.letzteBuchung)}`
                  : "Noch keine Buchungen"}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
        {([
          ["transaktionen", "Transaktionen"],
          ["import", "Import"],
          ["importe", "Import-Historie"],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === t ? "bg-white shadow-sm" : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {gewaehlt && tab === "transaktionen" && (
        <TransaktionsTab kontoId={gewaehlt.konto.id} onChanged={inval} />
      )}
      {gewaehlt && tab === "import" && (
        <ImportTab kontoId={gewaehlt.konto.id} konten={konten} onKontoWahl={setKontoId} onChanged={inval} />
      )}
      {gewaehlt && tab === "importe" && (
        <ImporteTab kontoId={gewaehlt.konto.id} onChanged={inval} />
      )}
    </div>
  );
}

/* ═══ Tab 1: Transaktionen ═══ */
function TransaktionsTab({ kontoId, onChanged }: { kontoId: number; onChanged: () => void }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"offen" | "zugeordnet" | "ignoriert" | "alle">("alle");
  const [richtung, setRichtung] = useState<"ein" | "aus" | "alle">("alle");
  const [q, setQ] = useState("");
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [zuordnenTx, setZuordnenTx] = useState<number | null>(null);
  const [aufgeklappt, setAufgeklappt] = useState<Set<number>>(new Set());

  const filter = {
    bankAccountId: kontoId,
    status,
    richtung,
    q: q.trim() || undefined,
    von: von || undefined,
    bis: bis || undefined,
  };
  const liste = trpc.bankTrans.liste.useQuery(filter);

  const loesen = trpc.bankTrans.zuordnungLoesen.useMutation({ onSuccess: onChanged });
  const setStatusM = trpc.bankTrans.setStatus.useMutation({ onSuccess: onChanged });
  const loeschen = trpc.bankTrans.loeschen.useMutation({ onSuccess: onChanged });

  const pdfLaden = async () => {
    const r = await utils.bankTrans.kontoauszugPdf.fetch({
      bankAccountId: kontoId,
      von: von || undefined,
      bis: bis || undefined,
    });
    pdfHerunterladen(r);
  };

  const sort = useSortierung<NonNullable<typeof liste.data>[number]>("datum");
  const zeilen = sort.sortiere(liste.data ?? [], (r, key) =>
    key === "datum" ? r.t.datum
    : key === "name" ? r.t.name || r.t.zweck || ""
    : key === "betrag" ? Number(r.t.betrag)
    : key === "saldo" ? (r.t.saldoNach !== null ? Number(r.t.saldoNach) : null)
    : key === "zuordnung" ? r.rechnungNummer ?? r.eingangNummer ?? ""
    : key === "status" ? r.t.status
    : null,
  );

  const Kopf = ({ k, label, rechts }: { k: string; label: string; rechts?: boolean }) => (
    <th
      className={`cursor-pointer select-none px-2 py-2 font-medium ${rechts ? "text-right" : ""}`}
      onClick={() => sort.umschalten(k)}
    >
      {label}<sort.KopfIcon k={k} />
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name / Zweck suchen …"
            className="w-56 pl-8"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Alle Status</SelectItem>
            <SelectItem value="offen">Offen</SelectItem>
            <SelectItem value="zugeordnet">Zugeordnet</SelectItem>
            <SelectItem value="ignoriert">Ignoriert</SelectItem>
          </SelectContent>
        </Select>
        <Select value={richtung} onValueChange={(v) => setRichtung(v as typeof richtung)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Ein + Aus</SelectItem>
            <SelectItem value="ein">Nur Eingänge</SelectItem>
            <SelectItem value="aus">Nur Ausgänge</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={von} onChange={(e) => setVon(e.target.value)} className="w-36" title="Von" />
        <span className="text-xs text-neutral-400">–</span>
        <Input type="date" value={bis} onChange={(e) => setBis(e.target.value)} className="w-36" title="Bis" />
        <Button variant="outline" onClick={pdfLaden} title="Aktuelle Ansicht als PDF herunterladen">
          <FileDown className="mr-1.5 h-4 w-4" /> PDF
        </Button>
      </div>

      {/* Tabelle */}
      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <Kopf k="datum" label="Datum" />
                <Kopf k="name" label="Name / Zweck" />
                <Kopf k="betrag" label="Betrag" rechts />
                <Kopf k="saldo" label="Saldo" rechts />
                <Kopf k="zuordnung" label="Zuordnung" />
                <Kopf k="status" label="Status" />
                <th className="px-2 py-2 text-right font-medium">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((r) => (
                <tr key={r.t.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-2 py-2 whitespace-nowrap text-neutral-600">{fmtDatum(r.t.datum)}</td>
                  <td className="max-w-[280px] px-2 py-2">
                    <button
                      type="button"
                      className="w-full text-left"
                      title={aufgeklappt.has(r.t.id) ? "Zuklappen" : "Volltext anzeigen"}
                      onClick={() => {
                        const n = new Set(aufgeklappt);
                        n.has(r.t.id) ? n.delete(r.t.id) : n.add(r.t.id);
                        setAufgeklappt(n);
                      }}
                    >
                      <div className={aufgeklappt.has(r.t.id) ? "font-medium" : "truncate font-medium"}>
                        {r.t.name || "—"}
                      </div>
                      <div className={aufgeklappt.has(r.t.id)
                        ? "whitespace-pre-wrap text-xs text-neutral-400"
                        : "truncate text-xs text-neutral-400"}>
                        {r.t.zweck}
                      </div>
                      {aufgeklappt.has(r.t.id) && (
                        <div className="mt-0.5 text-xs text-neutral-400">
                          #{r.t.id}
                          {r.t.gebuehr ? ` · Gebühr ${geld(r.t.gebuehr)}` : ""}
                          {r.t.importId ? ` · Import #${r.t.importId}` : ""}
                        </div>
                      )}
                    </button>
                  </td>
                  <td className={`px-2 py-2 text-right font-medium tabular-nums ${Number(r.t.betrag) >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {geld(r.t.betrag)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-neutral-500">
                    {r.t.saldoNach !== null ? geld(r.t.saldoNach) : "–"}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {r.t.status === "zugeordnet" ? (
                      r.rechnungNummer ? (
                        <Link to={`/rechnungen/${r.t.invoiceId}`} className="text-blue-700 hover:underline">
                          RE {r.rechnungNummer} · {r.rechnungKunde}
                        </Link>
                      ) : r.eingangNummer ? (
                        <span>ER {r.eingangNummer} · {r.eingangLieferant}</span>
                      ) : "zugeordnet"
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {r.t.status === "offen" && <Badge variant="secondary">offen</Badge>}
                    {r.t.status === "zugeordnet" && <Badge>zugeordnet</Badge>}
                    {r.t.status === "ignoriert" && <Badge variant="outline">ignoriert</Badge>}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1">
                      {r.t.status === "offen" && (
                        <>
                          <Button variant="ghost" size="sm" title="Rechnung zuordnen" onClick={() => setZuordnenTx(r.t.id)}>
                            <Link2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Ignorieren (privat/intern)"
                            onClick={() => setStatusM.mutate({ transaktionId: r.t.id, status: "ignoriert" })}>
                            <Ban className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Löschen (Fehl-Import)"
                            onClick={() => confirm("Transaktion wirklich löschen?") && loeschen.mutate({ transaktionId: r.t.id })}>
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </>
                      )}
                      {r.t.status === "zugeordnet" && (
                        <Button variant="ghost" size="sm" title="Zuordnung lösen (Zahlung zurückbuchen)"
                          onClick={() => confirm("Zuordnung lösen? Die Zahlung wird auf dem Beleg zurückgebucht.") && loesen.mutate({ transaktionId: r.t.id })}>
                          <Unlink className="h-4 w-4" />
                        </Button>
                      )}
                      {r.t.status === "ignoriert" && (
                        <>
                          <Button variant="ghost" size="sm" title="Wieder als offen markieren"
                            onClick={() => setStatusM.mutate({ transaktionId: r.t.id, status: "offen" })}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Löschen"
                            onClick={() => confirm("Transaktion wirklich löschen?") && loeschen.mutate({ transaktionId: r.t.id })}>
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {zeilen.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-neutral-400">
                    {liste.isLoading ? "Lade …" : "Keine Buchungen — Filter anpassen oder Kontoauszug importieren."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {zuordnenTx !== null && (
        <ZuordnungsDialog
          transaktionId={zuordnenTx}
          onSchliessen={() => setZuordnenTx(null)}
          onChanged={() => { onChanged(); setZuordnenTx(null); }}
        />
      )}
    </div>
  );
}

/* ═══ Dialog: Beleg zuordnen ═══ */
function ZuordnungsDialog({ transaktionId, onSchliessen, onChanged }: {
  transaktionId: number;
  onSchliessen: () => void;
  onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onSchliessen()}>
      <ZuordnungsInhalt transaktionId={transaktionId} onSchliessen={onSchliessen} onChanged={onChanged} q={q} setQ={setQ} />
    </Dialog>
  );
}

function ZuordnungsInhalt({ transaktionId, onSchliessen, onChanged, q, setQ }: {
  transaktionId: number;
  onSchliessen: () => void;
  onChanged: () => void;
  q: string;
  setQ: (v: string) => void;
}) {
  // Tx-Details (Betrag + Vorzeichen) gezielt per ID laden.
  const txQ = trpc.bankTrans.einzelTx.useQuery({ transaktionId });
  const t = txQ.data;
  const typ = t && Number(t.betrag) < 0 ? ("eingang" as const) : ("ausgang" as const);
  const ziele = trpc.bankTrans.offeneZiele.useQuery({ typ });
  const zuordnen = trpc.bankTrans.zuordnen.useMutation({ onSuccess: onChanged });

  const betrag = t ? Math.abs(Number(t.betrag)) : 0;
  const gefiltert = (ziele.data ?? [])
    .map((z) => ({ ...z, dist: Math.abs(z.offen - betrag) }))
    .filter((z) =>
      !q.trim() ||
      z.nummer.toLowerCase().includes(q.toLowerCase()) ||
      z.bezeichner.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => a.dist - b.dist || (a.datum < b.datum ? 1 : -1));

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          {typ === "ausgang" ? "Ausgangsrechnung zuordnen" : "Eingangsrechnung zuordnen"}
        </DialogTitle>
      </DialogHeader>
      {t && (
        <p className="text-sm text-neutral-600">
          <span className="font-medium">{t.name || "—"}</span> · {fmtDatum(t.datum)} ·{" "}
          <span className={Number(t.betrag) >= 0 ? "text-green-700" : "text-red-700"}>{geld(t.betrag)}</span>
        </p>
      )}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nummer / Name suchen …" className="pl-8" />
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border border-neutral-200">
        {gefiltert.map((z) => (
          <button
            key={z.id}
            disabled={zuordnen.isPending}
            onClick={() => zuordnen.mutate({ transaktionId, typ, zielId: z.id })}
            className="flex w-full items-center justify-between gap-3 border-b border-neutral-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-neutral-50"
          >
            <div className="min-w-0">
              <div className="font-medium">{z.nummer}</div>
              <div className="truncate text-xs text-neutral-400">{z.bezeichner} · {fmtDatum(z.datum)}</div>
            </div>
            <div className="text-right">
              <div className="tabular-nums font-medium">{geld(z.offen)}</div>
              {Math.abs(z.offen - betrag) <= 0.01 ? (
                <Badge>exakt</Badge>
              ) : z.offen > betrag ? (
                <Badge variant="secondary">Teilzahlung</Badge>
              ) : (
                <Badge variant="outline" className="text-amber-700">überzahlt</Badge>
              )}
            </div>
          </button>
        ))}
        {gefiltert.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-neutral-400">
            {ziele.isLoading ? "Lade …" : "Keine offenen Belege gefunden."}
          </p>
        )}
      </div>
      {gefiltert.some((z) => z.offen < betrag - 0.01) && (
        <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Bei „überzahlt" wird nur der offene Restbetrag verbucht — der Rest der
          Transaktion bleibt der Zuordnung zugerechnet (Splitting folgt in einer späteren Version).
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onSchliessen}>Abbrechen</Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ═══ Tab 2: Import ═══ */
function ImportTab({ kontoId, konten, onKontoWahl, onChanged }: {
  kontoId: number;
  konten: { konto: { id: number; bezeichnung: string; aktiv: boolean } }[];
  onKontoWahl: (id: number) => void;
  onChanged: () => void;
}) {
  const dateiRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [dateiname, setDateiname] = useState("");
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<number>>(new Set());

  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const erkennen = trpc.bankTrans.spaltenErkennen.useMutation({
    onSuccess: (d) => setMapping(d.mapping as Mapping),
  });
  const importieren = trpc.bankTrans.importieren.useMutation();
  const importierenPdf = trpc.bankTrans.importierenPdf.useMutation({
    onSuccess: (d) => {
      const start = new Set<number>();
      d.vorschau.forEach((v) => {
        if (v.vorschlag && v.vorschlag.sicherheit === "sicher") start.add(v.transaktionId);
      });
      setAusgewaehlt(start);
    },
  });
  const buchen = trpc.bankTrans.zuordnungenBuchen.useMutation({
    onSuccess: () => {
      onChanged();
      setCsvText(null);
      setPdfBase64(null);
      setDateiname("");
      setMapping(null);
      importieren.reset();
      importierenPdf.reset();
    },
  });

  const dateiLesen = (datei: File) => {
    importieren.reset();
    importierenPdf.reset();
    erkennen.reset();
    setMapping(null);
    setCsvText(null);
    setPdfBase64(null);
    setDateiname(datei.name);
    if (datei.name.toLowerCase().endsWith(".pdf")) {
      // SumUp-Kontoauszug (PDF mit Textebene) — geht serverseitig
      const leser = new FileReader();
      leser.onload = () => {
        const roh = leser.result as string;
        setPdfBase64(roh.slice(roh.indexOf(",") + 1));
      };
      leser.readAsDataURL(datei);
      return;
    }
    const leser = new FileReader();
    leser.onload = () => {
      const text = leser.result as string;
      if (text.includes("")) {
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
      erkennen.mutate({ csvText: text });
    };
  };

  const starten = () => {
    if (!csvText || !mapping) return;
    importieren.mutate(
      { bankAccountId: kontoId, dateiname, csvText, mapping },
      {
        onSuccess: (d) => {
          const start = new Set<number>();
          d.vorschau.forEach((v) => {
            if (v.vorschlag && v.vorschlag.sicherheit === "sicher") start.add(v.transaktionId);
          });
          setAusgewaehlt(start);
        },
      },
    );
  };

  const ergebnis = importieren.data ?? importierenPdf.data ?? null;
  const summeAusgewaehlt = (ergebnis?.vorschau ?? [])
    .filter((v) => ausgewaehlt.has(v.transaktionId))
    .reduce((a, v) => a + Math.abs(v.betrag), 0);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-neutral-700">1. Konto und Datei wählen</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={String(kontoId)} onValueChange={(v) => onKontoWahl(Number(v))}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {konten.filter((k) => k.konto.aktiv).map((k) => (
                <SelectItem key={k.konto.id} value={String(k.konto.id)}>{k.konto.bezeichnung}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => dateiRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" /> CSV- oder PDF-Datei wählen
          </Button>
          <input
            ref={dateiRef} type="file" accept=".csv,.txt,.tsv,.pdf" className="hidden"
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
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erkennen.error.message}</p>
        )}
        <p className="mt-3 text-xs text-neutral-400">
          CSV (Bank-Export, SumUp-Vollexport) oder PDF (SumUp Geschäftskonto → Kontoauszug).
          Der Import speichert alle Buchungen dauerhaft (Duplikate werden erkannt und übersprungen)
          — Ein- und Ausgänge. Die Zuordnung erfolgt danach in Ruhe.
        </p>
      </section>

      {pdfBase64 && !ergebnis && (
        <section className="rounded-lg border border-green-200 bg-green-50 p-5">
          <h2 className="mb-1 text-sm font-medium text-green-900">2. SumUp-Kontoauszug (PDF) — Import starten</h2>
          <p className="text-sm text-green-800">
            Der Auszug wird direkt von der Textebene gelesen (kein OCR) — inkl. stabiler
            Transaktions-IDs und Saldo nach jeder Buchung. Nicht genehmigte Buchungen werden
            übersprungen und beim nächsten Auszug automatisch nachgeholt.
          </p>
          <Button
            className="mt-3"
            disabled={importierenPdf.isPending}
            onClick={() => importierenPdf.mutate({ bankAccountId: kontoId, dateiname, pdfBase64 })}
          >
            <Landmark className="mr-1.5 h-4 w-4" />
            {importierenPdf.isPending ? "Importiere …" : "Kontoauszug importieren und analysieren"}
          </Button>
          {importierenPdf.error && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{importierenPdf.error.message}</p>
          )}
        </section>
      )}

      {erkennen.data && mapping && !ergebnis && (erkennen.data.vorlage.includes("Vollexport")) && (
        <section className="rounded-lg border border-green-200 bg-green-50 p-5">
          <h2 className="mb-1 text-sm font-medium text-green-900">2. SumUp-Vollexport erkannt</h2>
          <p className="text-sm text-green-800">
            Alle Spalten werden automatisch zugeordnet — inkl. Zahlungsreferenz, Gebuehren,
            Saldo und Fremdwaehrungs-Hinweisen. Vorgemerkte Buchungen („In Bearbeitung")
            werden uebersprungen und beim naechsten Export automatisch nachgeholt.
          </p>
          <Button className="mt-3" onClick={starten} disabled={importieren.isPending}>
            <Landmark className="mr-1.5 h-4 w-4" />
            {importieren.isPending ? "Importiere …" : "Importieren und analysieren"}
          </Button>
          {importieren.error && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{importieren.error.message}</p>
          )}
        </section>
      )}
      {erkennen.data && mapping && !ergebnis && !(erkennen.data.vorlage.includes("Vollexport")) && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">2. Spalten zuordnen</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {MAPPING_FELDER.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs text-neutral-500">{f.label}{f.pflicht ? " *" : ""}</label>
                <Select
                  value={mapping[f.key] ?? "—"}
                  onValueChange={(v) => setMapping({ ...mapping, [f.key]: v === "—" ? undefined : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
          <Button className="mt-4" onClick={starten} disabled={importieren.isPending}>
            <Landmark className="mr-1.5 h-4 w-4" />
            {importieren.isPending ? "Importiere …" : "Importieren und analysieren"}
          </Button>
          {importieren.error && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{importieren.error.message}</p>
          )}
        </section>
      )}

      {ergebnis && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-1 text-sm font-medium text-neutral-700">3. Vorschau — Auto-Zuordnung prüfen</h2>
          {importierenPdf.data?.auszugMeta && (
            <p className={`mb-2 rounded-md px-3 py-2 text-xs ${importierenPdf.data.auszugMeta.pruefsummeOk ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
              Kontoauszug-Prüfsumme: {importierenPdf.data.auszugMeta.pruefsummeOk
                ? "stimmt (Anfangsguthaben + Buchungen = Endguthaben ✓)"
                : importierenPdf.data.auszugMeta.pruefsummeOk === false
                  ? "weicht ab — bitte Zeitraum/Vollständigkeit prüfen"
                  : "nicht prüfbar (Kopfzeilen fehlten)"}
              {importierenPdf.data.auszugMeta.endSaldo !== null &&
                ` · Endguthaben laut Auszug: ${geld(importierenPdf.data.auszugMeta.endSaldo)}`}
            </p>
          )}
          <p className="mb-3 text-xs text-neutral-400">
            {ergebnis.importiert} importiert
            {ergebnis.duplikate > 0 ? ` · ${ergebnis.duplikate} Duplikate übersprungen` : ""}
            {(ergebnis.uebersprungen ?? 0) > 0 ? ` · ${ergebnis.uebersprungen} vorgemerkt/ausstehend übersprungen` : ""} ·{" "}
            Eingänge {geld(ergebnis.summeEin)} · Ausgänge {geld(ergebnis.summeAus)} ·{" "}
            {ergebnis.zugeordnet} Vorschläge. Angehakte Zuordnungen werden gebucht —
            alles andere bleibt als offene Transaktion bestehen.
          </p>
          <div className="max-h-96 overflow-y-auto rounded-md border border-neutral-100">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="px-2 py-2 font-medium"></th>
                  <th className="px-2 py-2 font-medium">Datum</th>
                  <th className="px-2 py-2 font-medium">Name / Zweck</th>
                  <th className="px-2 py-2 text-right font-medium">Betrag</th>
                  <th className="px-2 py-2 font-medium">Vorschlag</th>
                </tr>
              </thead>
              <tbody>
                {ergebnis.vorschau.map((v) => (
                  <tr key={v.transaktionId} className="border-b border-neutral-100 last:border-0">
                    <td className="px-2 py-2">
                      <input
                        type="checkbox" className="h-4 w-4"
                        disabled={!v.vorschlag}
                        checked={ausgewaehlt.has(v.transaktionId)}
                        onChange={(e) => {
                          const neu = new Set(ausgewaehlt);
                          e.target.checked ? neu.add(v.transaktionId) : neu.delete(v.transaktionId);
                          setAusgewaehlt(neu);
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 text-neutral-600 whitespace-nowrap">{fmtDatum(v.datum)}</td>
                    <td className="max-w-[260px] px-2 py-2">
                      <div className="truncate font-medium">{v.name || "—"}</div>
                      <div className="truncate text-xs text-neutral-400">{v.zweck}</div>
                    </td>
                    <td className={`px-2 py-2 text-right tabular-nums font-medium ${v.betrag >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {geld(v.betrag)}
                    </td>
                    <td className="px-2 py-2">
                      {v.vorschlag ? (
                        <Badge variant={v.vorschlag.sicherheit === "sicher" ? "default" : "secondary"}>
                          {v.vorschlag.sicherheit === "sicher" ? "✓" : "?"} {v.vorschlag.nummer}
                          {"teil" in v.vorschlag && v.vorschlag.teil ? " (Teil)" : ""} · {v.vorschlag.bezeichner}
                        </Badge>
                      ) : (
                        <Badge variant="outline">bleibt offen</Badge>
                      )}
                    </td>
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
                  zuordnungen: (ergebnis.vorschau ?? [])
                    .filter((v) => ausgewaehlt.has(v.transaktionId) && v.vorschlag)
                    .map((v) => ({
                      transaktionId: v.transaktionId,
                      typ: v.vorschlag!.typ,
                      zielId: v.vorschlag!.zielId,
                    })),
                })
              }
            >
              {buchen.isPending ? "Buche …" : `${ausgewaehlt.size} Zuordnungen buchen (${geld(summeAusgewaehlt)})`}
            </Button>
            {buchen.error && <span className="text-sm text-red-600">{buchen.error.message}</span>}
            {buchen.data && buchen.data.fehler.length > 0 && (
              <span className="text-sm text-amber-700">{buchen.data.fehler.length} fehlgeschlagen — Details im Log</span>
            )}
          </div>
        </section>
      )}

      {buchen.data && (
        <section className="rounded-lg border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-2 text-green-800">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">{buchen.data.verbucht} Zahlung(en) verbucht.</span>
          </div>
          <p className="mt-1 text-sm text-green-700">
            Nicht zugeordnete Buchungen findest du im Tab „Transaktionen".
          </p>
        </section>
      )}
    </div>
  );
}

/* ═══ Tab 3: Import-Historie ═══ */
function ImporteTab({ kontoId, onChanged }: { kontoId: number; onChanged: () => void }) {
  const importe = trpc.bankTrans.importe.useQuery({ bankAccountId: kontoId });
  const loeschen = trpc.bankTrans.importLoeschen.useMutation({ onSuccess: onChanged });

  const isoAm = (d: unknown) =>
    d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const sort = useSortierung<NonNullable<typeof importe.data>[number]>("createdAt");
  const zeilen = sort.sortiere(importe.data ?? [], (r, key) =>
    key === "createdAt" ? (r.createdAt instanceof Date ? r.createdAt.getTime() : String(r.createdAt))
    : key === "dateiname" ? r.dateiname
    : key === "zeilen" ? r.zeilen
    : key === "summeEin" ? Number(r.summeEin)
    : key === "summeAus" ? Number(r.summeAus)
    : null,
  );

  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="cursor-pointer select-none px-3 py-2.5 font-medium" onClick={() => sort.umschalten("createdAt")}>
                Importiert am<sort.KopfIcon k="createdAt" />
              </th>
              <th className="cursor-pointer select-none px-3 py-2.5 font-medium" onClick={() => sort.umschalten("dateiname")}>
                Datei<sort.KopfIcon k="dateiname" />
              </th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right font-medium" onClick={() => sort.umschalten("zeilen")}>
                Zeilen<sort.KopfIcon k="zeilen" />
              </th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right font-medium" onClick={() => sort.umschalten("summeEin")}>
                Eingänge<sort.KopfIcon k="summeEin" />
              </th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right font-medium" onClick={() => sort.umschalten("summeAus")}>
                Ausgänge<sort.KopfIcon k="summeAus" />
              </th>
              <th className="px-3 py-2.5 text-right font-medium">Duplikate</th>
              <th className="px-3 py-2.5 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-2 text-neutral-600">{fmtDatum(isoAm(r.createdAt))}</td>
                <td className="px-3 py-2 font-medium">{r.dateiname}<span className="ml-2 text-xs text-neutral-400">{r.vorlage}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{r.zeilen}</td>
                <td className="px-3 py-2 text-right tabular-nums text-green-700">{geld(r.summeEin)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-700">{geld(r.summeAus)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{r.duplikate}</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" size="sm" title="Import löschen (nur möglich, wenn nichts davon verbucht ist)"
                    onClick={() => confirm(`Import „${r.dateiname}" mit allen ${r.zeilen} Buchungen löschen?`) && loeschen.mutate({ importId: r.id })}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                  {loeschen.error && <span className="ml-2 text-xs text-red-600">{loeschen.error.message}</span>}
                </td>
              </tr>
            ))}
            {zeilen.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-neutral-400">
                {importe.isLoading ? "Lade …" : "Noch keine Importe für dieses Konto."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
