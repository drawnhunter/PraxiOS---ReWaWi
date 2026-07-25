import { useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSortierung } from "@/lib/sortierung";
import { geld, datum as fmtDatum } from "@/lib/format";
import { textHerunterladen } from "@/lib/downloads";
import { Button } from "@/components/ui/button";
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
import { Upload, CheckCircle2, AlertTriangle, XCircle, FileDown, Eye } from "lucide-react";

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
  const zeilen = sort.sortiere(liste.data ?? [], (r, k) =>
    k === "lieferant" ? r.lieferantName :
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">E-Rechnungen (Eingang)</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Empfangene E-Rechnungen (XML oder ZUGFeRD-PDF) hochladen, prüfen und als
            Eingangsrechnung buchen. Das Original-XML wird GoBD-konform archiviert.
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

      {/* ── Liste ── */}
      <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("lieferant")}>Lieferant<sort.KopfIcon k="lieferant" /></th>
              <th className="px-4 py-2.5 font-medium">Nummer</th>
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
