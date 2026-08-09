import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CsvButton } from "@/components/CsvButton";
import { deZahl } from "@/lib/downloads";
import { trpc } from "@/providers/trpc";
import { useSortierung } from "@/lib/sortierung";
import { geld, datum as fmtDatum } from "@/lib/format";
import { textHerunterladen } from "@/lib/downloads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Upload, CheckCircle2, AlertTriangle, XCircle, FileDown, Eye, FileText, ArchiveRestore, Search } from "lucide-react";

type Analyse = {
  ok: boolean;
  fehler: string[];
  warnungen: string[];
  daten?: {
    nummer: string; datum: string | null; faellig: string | null;
    lieferant: string; lieferantKennung: string | null;
    positionen: { bezeichnung: string; menge: number; einheit: string; einzelpreis: number; ustSatz: number; netto: number }[];
    netto: number; ust: number; brutto: number; waehrung: string; guideline: string | null;
  };
  duplikat?: { id: number } | null;
};

export default function IncomingInvoices() {
  const utils = trpc.useUtils();
  const dateiRef = useRef<HTMLInputElement>(null);
  const [xml, setXml] = useState<string | null>(null);
  const [dateiname, setDateiname] = useState("");
  const [analyse, setAnalyse] = useState<Analyse | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const [bezahlen, setBezahlen] = useState<number | null>(null);

  const liste = trpc.einrechnung.list.useQuery();
  const sort = useSortierung<NonNullable<typeof liste.data>[number]>("datum");
  const [q, setQ] = useState("");
  const gefiltert = (liste.data ?? []).filter(
    (r) => !q.trim() ||
      r.lieferantName.toLowerCase().includes(q.toLowerCase()) ||
      r.nummer.toLowerCase().includes(q.toLowerCase()),
  );
  const zeilen = sort.sortiere(gefiltert, (r, k) =>
    k === "lieferant" ? r.lieferantName :
    k === "nummer" ? r.nummer :
    k === "datum" ? r.rechnungsdatum :
    k === "brutto" ? Number(r.brutto) :
    k === "status" ? (r.bezahltAm ? "1" : "0") : null,
  );
  const detailDaten = trpc.einrechnung.get.useQuery(
    { id: detail ?? 0 },
    { enabled: detail !== null },
  );

  const analysieren = trpc.einrechnung.analysieren.useMutation({
    onSuccess: (d) => setAnalyse(d as Analyse),
    onError: (e) => setAnalyse({ ok: false, fehler: [e.message], warnungen: [] }),
  });
  const analysierenPdf = trpc.einrechnung.analysierenPdf.useMutation({
    onSuccess: (d) => {
      setAnalyse(d as Analyse);
      if (d.xml) setXml(d.xml);
    },
    onError: (e) => setAnalyse({ ok: false, fehler: [e.message], warnungen: [] }),
  });
  const buchen = trpc.einrechnung.buchen.useMutation({
    onSuccess: () => {
      utils.einrechnung.list.invalidate();
      setAnalyse(null);
      setXml(null);
      setDateiname("");
    },
  });
  const markPaid = trpc.einrechnung.markPaid.useMutation({
    onSuccess: () => {
      utils.einrechnung.list.invalidate();
      setBezahlen(null);
    },
  });
  const unmarkPaid = trpc.einrechnung.unmarkPaid.useMutation({
    onSuccess: () => utils.einrechnung.list.invalidate(),
  });

  const dateiLesen = (datei: File) => {
    const r = new FileReader();
    if (datei.name.toLowerCase().endsWith(".pdf")) {
      r.onload = () => {
        const b64 = (r.result as string).split(",")[1];
        setDateiname(datei.name);
        analysierenPdf.mutate({ pdfBase64: b64 });
      };
      r.readAsDataURL(datei);
    } else {
      r.onload = () => {
        const text = r.result as string;
        setXml(text);
        setDateiname(datei.name);
        analysieren.mutate({ xml: text });
      };
      r.readAsText(datei, "utf-8");
    }
  };

  const xmlLaden = async (id: number) => {
    const r = await utils.client.einrechnung.xml.query({ id });
    textHerunterladen(r.dateiname, r.xml, "application/xml");
  };

  const d = analyse?.daten;

  // ── v1.5: Eingangsbelege — Tabs (Deeplink via ?tab=) + Summen ──
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "rechnungen") as "rechnungen" | "lieferscheine" | "gutschriften" | "archiv";
  const setTab = (t: string) =>
    setParams((alt) => {
      const n = new URLSearchParams(alt);
      n.set("tab", t);
      return n;
    }, { replace: true });
  const heute = new Date().toISOString().slice(0, 10);
  const offeneListe = (liste.data ?? []).filter((r) => !r.bezahltAm);
  const summeOffen = offeneListe.reduce((a, r) => a + Number(r.brutto), 0);
  const ueberfaelligListe = offeneListe.filter((r) => r.faelligkeitsdatum && r.faelligkeitsdatum < heute);
  const summeUeberfaellig = ueberfaelligListe.reduce((a, r) => a + Number(r.brutto), 0);
  const summeBezahlt = (liste.data ?? []).filter((r) => r.bezahltAm).reduce((a, r) => a + Number(r.brutto), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Eingangsbelege</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Alle eingehenden Belege: gebuchte Eingangsrechnungen, Lieferscheine,
            Gutschriften und das Scan-Archiv — an einem Ort.
          </p>
        </div>
        <Button variant="outline" onClick={() => dateiRef.current?.click()}>
          <Upload className="mr-1.5 h-4 w-4" /> XRechnung importieren
        </Button>
        <input
          ref={dateiRef}
          type="file"
          accept=".xml,.pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && dateiLesen(e.target.files[0])}
        />
      </div>

      {/* ── Tabs (v1.5) ── */}
      <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
        {([
          ["rechnungen", "Rechnungen"],
          ["lieferscheine", "Lieferscheine"],
          ["gutschriften", "Gutschriften"],
          ["archiv", "Archiv"],
        ] as const).map(([t, label]) => (
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

      {tab !== "rechnungen" ? (
        <AblageListe typ={tab === "archiv" ? undefined : tab === "lieferscheine" ? "lieferschein" : "gutschrift"} />
      ) : (
      <>
      {/* ── Analyse-Dialog ── */}
      {analyse && (
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">
            Prüfung: {dateiname}
          </h2>

          {!analyse.ok ? (
            <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {analyse.fehler.map((f, i) => <div key={i}>{f}</div>)}
              </div>
            </div>
          ) : d && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div><span className="text-neutral-400">Lieferant</span><div className="font-medium">{d.lieferant}</div></div>
                <div><span className="text-neutral-400">Rechnungsnr.</span><div className="font-medium">{d.nummer}</div></div>
                <div><span className="text-neutral-400">Datum</span><div className="font-medium">{d.datum ? fmtDatum(d.datum) : "–"}</div></div>
                <div><span className="text-neutral-400">Brutto</span><div className="font-medium">{geld(d.brutto)} {d.waehrung}</div></div>
              </div>

              {d.positionen.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[500px] text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                        <th className="px-2 py-1.5 font-medium">Position</th>
                        <th className="px-2 py-1.5 text-right font-medium">Menge</th>
                        <th className="px-2 py-1.5 text-right font-medium">Einzelpreis</th>
                        <th className="px-2 py-1.5 text-right font-medium">USt</th>
                        <th className="px-2 py-1.5 text-right font-medium">Netto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.positionen.map((p, i) => (
                        <tr key={i} className="border-b border-neutral-100 last:border-0">
                          <td className="px-2 py-1.5">{p.bezeichnung}</td>
                          <td className="px-2 py-1.5 text-right">{p.menge} {p.einheit}</td>
                          <td className="px-2 py-1.5 text-right">{geld(p.einzelpreis)}</td>
                          <td className="px-2 py-1.5 text-right">{p.ustSatz} %</td>
                          <td className="px-2 py-1.5 text-right">{geld(p.netto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-green-700">
                  <CheckCircle2 className="h-4 w-4" /> Pflichtfelder vollständig
                </span>
                {analyse.warnungen.length === 0 ? (
                  <span className="flex items-center gap-1.5 text-green-700">
                    <CheckCircle2 className="h-4 w-4" /> Summen konsistent
                  </span>
                ) : (
                  analyse.warnungen.map((w, i) => (
                    <span key={i} className="flex items-center gap-1.5 text-amber-700">
                      <AlertTriangle className="h-4 w-4" /> {w}
                    </span>
                  ))
                )}
              </div>

              {analyse.duplikat && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Diese Rechnung wurde bereits importiert — Buchung wird verhindert.
                </p>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setAnalyse(null); setXml(null); }}>
                  Verwerfen
                </Button>
                <Button
                  disabled={!!analyse.duplikat || buchen.isPending}
                  onClick={() => xml && buchen.mutate({ xml })}
                >
                  {buchen.isPending ? "Buche …" : "Als Eingangsrechnung buchen"}
                </Button>
              </div>
              {buchen.error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{buchen.error.message}</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Summen (Auswertung) ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Offen: {geld(summeOffen)} ({offeneListe.length})</Badge>
        {summeUeberfaellig > 0 && (
          <Badge variant="destructive">Überfällig: {geld(summeUeberfaellig)} ({ueberfaelligListe.length})</Badge>
        )}
        <Badge variant="outline">Bezahlt gesamt: {geld(summeBezahlt)}</Badge>
        <span className="ml-auto">
          <CsvButton
            dateiname="eingangsrechnungen.csv"
            zeilen={[
              ["Lieferant", "Nummer", "Datum", "Fällig", "Netto", "USt", "Brutto", "Konto", "Gegenkonto", "Bezahlt am"],
              ...zeilen.map((r) => [
                r.lieferantName, r.nummer, r.rechnungsdatum, r.faelligkeitsdatum ?? "",
                deZahl(r.netto), deZahl(r.ust), deZahl(r.brutto),
                r.konto ?? "", r.gegenkonto ?? "", r.bezahltAm ?? "",
              ]),
            ]}
          />
        </span>
      </div>

      <div className="relative mb-3 max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lieferant / Nummer suchen …" className="pl-8" />
      </div>

      {/* ── Liste ── */}
      <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("lieferant")}>Lieferant<sort.KopfIcon k="lieferant" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("nummer")}>Nummer<sort.KopfIcon k="nummer" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("datum")}>Datum<sort.KopfIcon k="datum" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 text-right font-medium" onClick={() => sort.umschalten("brutto")}>Brutto<sort.KopfIcon k="brutto" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("status")}>Status<sort.KopfIcon k="status" /></th>
              <th className="px-4 py-2.5 text-right font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  Noch keine Eingangsrechnungen — oben „XRechnung importieren".
                </td>
              </tr>
            )}
            {zeilen.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5 font-medium">{r.lieferantName}</td>
                <td className="px-4 py-2.5 text-neutral-600">{r.nummer}</td>
                <td className="px-4 py-2.5 text-neutral-600">{fmtDatum(r.rechnungsdatum)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{geld(r.brutto)}</td>
                <td className="px-4 py-2.5">
                  {r.bezahltAm ? (
                    <Badge>bezahlt {fmtDatum(r.bezahltAm)}</Badge>
                  ) : (
                    <Badge variant="outline">offen</Badge>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDetail(r.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => xmlLaden(r.id)} title="Original-XML">
                      <FileDown className="h-4 w-4" />
                    </Button>
                    {!r.bezahltAm ? (
                      <Button variant="outline" size="sm" onClick={() => setBezahlen(r.id)}>
                        Bezahlen
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => unmarkPaid.mutate({ id: r.id })}>
                        ↩
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      </>
      )}

      {/* ── Detail-Dialog ── */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detailDaten.data ? `${detailDaten.data.lieferantName} — ${detailDaten.data.nummer}` : "Lade …"}
            </DialogTitle>
          </DialogHeader>
          {detailDaten.data && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <div><span className="text-neutral-400">Datum</span><div>{fmtDatum(detailDaten.data.rechnungsdatum)}</div></div>
                <div><span className="text-neutral-400">Fällig</span><div>{detailDaten.data.faelligkeitsdatum ? fmtDatum(detailDaten.data.faelligkeitsdatum) : "–"}</div></div>
                <div><span className="text-neutral-400">Kennung</span><div>{detailDaten.data.lieferantKennung ?? "–"}</div></div>
                <div><span className="text-neutral-400">Netto</span><div>{geld(detailDaten.data.netto)}</div></div>
                <div><span className="text-neutral-400">USt.</span><div>{geld(detailDaten.data.ust)}</div></div>
                <div><span className="text-neutral-400">Brutto</span><div className="font-semibold">{geld(detailDaten.data.brutto)}</div></div>
              </div>
              {detailDaten.data.positionenJson && (
                <table className="w-full text-sm">
                  <tbody>
                    {(JSON.parse(detailDaten.data.positionenJson) as { bezeichnung: string; menge: number; einheit: string; netto: number }[]).map((p, i) => (
                      <tr key={i} className="border-b border-neutral-100 last:border-0">
                        <td className="py-1.5">{p.bezeichnung}</td>
                        <td className="py-1.5 text-right text-neutral-500">{p.menge} {p.einheit}</td>
                        <td className="py-1.5 text-right">{geld(p.netto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Bezahlen-Bestätigung ── */}
      <AlertDialog open={bezahlen !== null} onOpenChange={(o) => !o && setBezahlen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Als bezahlt markieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Eingangsrechnung wird mit heutigem Datum als bezahlt gebucht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => bezahlen && markPaid.mutate({ id: bezahlen })}>
              Bezahlt buchen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


/* ═══ v1.5: Ablage-Tabs — Lieferscheine/Gutschriften/Archiv aus dem Post Manager ═══ */
const ABL_TYP_LABEL: Record<string, string> = {
  rechnung: "Rechnung",
  lieferschein: "Lieferschein",
  gutschrift: "Gutschrift",
  sonstiges: "Sonstiges",
};
const ABL_STATUS_LABEL: Record<string, string> = { neu: "Neu", gebucht: "Gebucht", abgelegt: "Abgelegt" };

function AblageListe({ typ }: { typ?: "lieferschein" | "gutschrift" }) {
  const [viewer, setViewer] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const liste = trpc.posteingang.liste.useQuery({ typ });
  const dok = trpc.posteingang.get.useQuery({ id: viewer ?? 0 }, { enabled: viewer !== null });

  const isoAm = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
  const sort = useSortierung<NonNullable<typeof liste.data>[number]>("eingang");
  const gefiltert = (liste.data ?? []).filter(
    (r) => !q.trim() ||
      (r.stichwort ?? r.originalname).toLowerCase().includes(q.toLowerCase()) ||
      (r.lieferantName ?? r.absenderFreitext ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (r.rechnungsnummer ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  const zeilen = sort.sortiere(gefiltert, (r, k) =>
    k === "dokument" ? r.stichwort ?? r.originalname
    : k === "absender" ? r.lieferantName ?? r.absenderFreitext ?? ""
    : k === "betrag" ? (r.betrag !== null ? Number(r.betrag) : null)
    : k === "faellig" ? r.faelligAm ?? r.wiedervorlageAm
    : k === "status" ? r.status
    : k === "eingang" ? (r.createdAt instanceof Date ? r.createdAt.getTime() : String(r.createdAt))
    : null,
  );

  const d = dok.data;
  const dataUrl = d ? `data:${d.mime};base64,${d.dateiInhalt}` : "";

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dokument / Absender suchen …" className="pl-8" />
      </div>

      <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("dokument")}>Dokument<sort.KopfIcon k="dokument" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("absender")}>Absender<sort.KopfIcon k="absender" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 text-right font-medium" onClick={() => sort.umschalten("betrag")}>Betrag<sort.KopfIcon k="betrag" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("faellig")}>Fällig / WV<sort.KopfIcon k="faellig" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("status")}>Status<sort.KopfIcon k="status" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("eingang")}>Eingang<sort.KopfIcon k="eingang" /></th>
            </tr>
          </thead>
          <tbody>
            {zeilen.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  {liste.isLoading ? "Lade …" : "Nichts im Archiv — Belege über den Post Manager einscannen."}
                </td>
              </tr>
            )}
            {zeilen.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                onClick={() => setViewer(r.id)}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                    <div>
                      <div className="flex items-center gap-2 font-medium text-neutral-800">
                        {r.stichwort ?? r.originalname}
                        {r.typ !== "rechnung" && (
                          <Badge variant="outline" className="text-[10px]">{ABL_TYP_LABEL[r.typ] ?? r.typ}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-neutral-400">{r.originalname}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-neutral-600">{r.lieferantName ?? r.absenderFreitext ?? "–"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.betrag ? geld(r.betrag) : "–"}</td>
                <td className="px-4 py-2.5 text-neutral-600">
                  {r.faelligAm ? fmtDatum(r.faelligAm) : r.wiedervorlageAm ? `WV ${fmtDatum(r.wiedervorlageAm)}` : "–"}
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant={r.status === "neu" ? "default" : r.status === "gebucht" ? "secondary" : "outline"}>
                    {ABL_STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-xs text-neutral-500">{fmtDatum(isoAm(r.createdAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Viewer-Dialog (nur ansehen; Bearbeiten im Post Manager) ── */}
      <Dialog open={viewer !== null} onOpenChange={(o) => !o && setViewer(null)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {d?.originalname ?? "Lade …"}
              {d && <Badge variant="outline">{ABL_TYP_LABEL[d.typ] ?? d.typ}</Badge>}
              {d && <Badge variant="secondary">{ABL_STATUS_LABEL[d.status] ?? d.status}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {d && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-600">
                {(d.lieferantName || d.absenderFreitext) && (
                  <span>Absender: <strong>{d.lieferantName ?? d.absenderFreitext}</strong></span>
                )}
                {d.rechnungsnummer && <span>Nummer: <strong>{d.rechnungsnummer}</strong></span>}
                {d.betrag && <span>Betrag: <strong>{geld(d.betrag)}</strong></span>}
                {d.faelligAm && <span>Fällig: <strong>{fmtDatum(d.faelligAm)}</strong></span>}
                {d.wiedervorlageAm && <span>WV: <strong>{fmtDatum(d.wiedervorlageAm)}</strong></span>}
              </div>
              <div className="min-h-[400px] rounded-lg border border-neutral-200 bg-neutral-50">
                {d.mime === "application/pdf" ? (
                  <iframe title="Beleg" src={dataUrl} className="h-full min-h-[560px] w-full rounded-lg" />
                ) : (
                  <img src={dataUrl} alt="Beleg" className="mx-auto max-h-[70vh] rounded-lg object-contain" />
                )}
              </div>
              <div className="flex justify-between">
                <Button variant="outline" asChild>
                  <Link to={`/posteingang?beleg=${d.id}`}>
                    <ArchiveRestore className="mr-1.5 h-4 w-4" /> Im Post Manager öffnen
                  </Link>
                </Button>
                <Button variant="ghost" onClick={() => setViewer(null)}>Schließen</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
