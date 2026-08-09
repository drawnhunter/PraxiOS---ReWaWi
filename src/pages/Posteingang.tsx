import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useSortierung } from "@/lib/sortierung";
import { geld, datum as fmtDatum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Archive,
  ArchiveRestore,
  BookCheck,
  FileText,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ScanSearch,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

type Status = "neu" | "gebucht" | "abgelegt";
type Typ = "rechnung" | "lieferschein" | "gutschrift" | "sonstiges";
const TYP_LABEL: Record<Typ, string> = {
  rechnung: "Rechnung",
  lieferschein: "Lieferschein",
  gutschrift: "Gutschrift",
  sonstiges: "Sonstiges",
};
type Konfidenz = "hoch" | "mittel" | "niedrig";

interface FormZustand {
  typ: Typ;
  absenderLieferantId: number | null;
  absenderFreitext: string;
  stichwort: string;
  rechnungsnummer: string;
  betrag: string;
  ustSatz: number;
  rechnungsdatum: string;
  faelligAm: string;
  wiedervorlageAm: string;
  konto: string;
  gegenkonto: string;
  kategorieId: number | null;
  notizen: string;
}

const LEER: FormZustand = {
  typ: "rechnung",
  absenderLieferantId: null,
  absenderFreitext: "",
  stichwort: "",
  rechnungsnummer: "",
  betrag: "",
  ustSatz: 19,
  rechnungsdatum: "",
  faelligAm: "",
  wiedervorlageAm: "",
  konto: "",
  gegenkonto: "",
  kategorieId: null,
  notizen: "",
};

const STATUS_LABEL: Record<Status, string> = { neu: "Neu", gebucht: "Gebucht", abgelegt: "Abgelegt" };
const STATUS_VARIANT: Record<Status, "default" | "secondary" | "outline"> = {
  neu: "default",
  gebucht: "secondary",
  abgelegt: "outline",
};

export default function Posteingang() {
  const utils = trpc.useUtils();
  const dateiRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState<Status | "alle">("alle");
  const [typFilter, setTypFilter] = useState<Typ | "alle">("alle");
  const [offen, setOffen] = useState<number | null>(null);
  const [loeschenId, setLoeschenId] = useState<number | null>(null);
  const [form, setForm] = useState<FormZustand>(LEER);
  const [konfidenz, setKonfidenz] = useState<Record<string, Konfidenz>>({});

  // Deeplink: /posteingang?beleg=ID oeffnet das Dokument direkt (v1.5)
  const [params] = useSearchParams();
  useEffect(() => {
    const b = Number(params.get("beleg"));
    if (Number.isFinite(b) && b > 0) setOffen(b);
  }, [params]);

  const liste = trpc.posteingang.liste.useQuery({
    status: statusFilter === "alle" ? undefined : statusFilter,
    typ: typFilter === "alle" ? undefined : typFilter,
  });
  const detail = trpc.posteingang.get.useQuery(
    { id: offen ?? 0 },
    { enabled: offen !== null },
  );
  const lieferanten = trpc.suppliers.list.useQuery();
  const kategorien = trpc.kontierung.kategorien.useQuery();

  useEffect(() => {
    if (detail.data) {
      const d = detail.data;
      setForm({
        typ: d.typ,
        absenderLieferantId: d.absenderLieferantId ?? null,
        absenderFreitext: d.absenderFreitext ?? "",
        stichwort: d.stichwort ?? "",
        rechnungsnummer: d.rechnungsnummer ?? "",
        betrag: d.betrag ?? "",
        ustSatz: d.ustSatz ?? 19,
        rechnungsdatum: d.rechnungsdatum ?? "",
        faelligAm: d.faelligAm ?? "",
        wiedervorlageAm: d.wiedervorlageAm ?? "",
        konto: d.konto ?? "",
        gegenkonto: d.gegenkonto ?? "",
        kategorieId: d.kategorieId ?? null,
        notizen: d.notizen ?? "",
      });
      setKonfidenz({});
    }
  }, [detail.data]);

  const invalidieren = () => {
    utils.posteingang.liste.invalidate();
    utils.posteingang.get.invalidate();
    utils.posteingang.zahlungsziele.invalidate();
    utils.einrechnung.list.invalidate();
  };

  const anlegenBatch = trpc.posteingang.anlegenBatch.useMutation();
  const [uploadTyp, setUploadTyp] = useState<Typ>("rechnung");
  const [batchFortschritt, setBatchFortschritt] = useState<{ fertig: number; gesamt: number } | null>(null);
  const [uploadFehler, setUploadFehler] = useState<string[]>([]);
  const speichern = trpc.posteingang.aktualisieren.useMutation({ onSuccess: invalidieren });
  const buchen = trpc.posteingang.buchen.useMutation({ onSuccess: invalidieren });
  const setStatus = trpc.posteingang.setStatus.useMutation({ onSuccess: invalidieren });
  const loeschen = trpc.posteingang.loeschen.useMutation({
    onSuccess: () => {
      invalidieren();
      setLoeschenId(null);
      setOffen(null);
    },
  });
  const ocr = trpc.posteingang.ocrAnalysieren.useMutation({
    onSuccess: (d) => {
      const k: Record<string, Konfidenz> = {};
      setForm((alt) => {
        const n = { ...alt };
        if (d.felder.betrag.wert) {
          n.betrag = d.felder.betrag.wert;
          k.betrag = d.felder.betrag.konfidenz;
        }
        if (d.felder.rechnungsnummer.wert) {
          n.rechnungsnummer = d.felder.rechnungsnummer.wert;
          k.rechnungsnummer = d.felder.rechnungsnummer.konfidenz;
        }
        if (d.felder.rechnungsdatum.wert) {
          n.rechnungsdatum = d.felder.rechnungsdatum.wert;
          k.rechnungsdatum = d.felder.rechnungsdatum.konfidenz;
        }
        if (d.felder.faellig.wert) {
          n.faelligAm = d.felder.faellig.wert;
          k.faelligAm = d.felder.faellig.konfidenz;
        }
        if (d.felder.absender.wert && !n.absenderLieferantId) {
          n.absenderFreitext = d.felder.absender.wert;
          k.absenderFreitext = "niedrig";
        }
        if (d.lieferant) n.absenderLieferantId = d.lieferant.id;
        return n;
      });
      setKonfidenz(k);
      // v1.6 Regelwerk: Standard-Kategorie des Lieferanten uebernehmen
      if (d.regelwerk) {
        setForm((alt) => ({
          ...alt,
          kategorieId: d.regelwerk!.kategorieId,
          konto: d.regelwerk!.konto ?? alt.konto,
          ustSatz: d.regelwerk!.ustSatz,
        }));
      }
    },
  });

  /** v1.6: Regelwerk auch bei manueller Lieferantenwahl anwenden (wenn Felder leer). */
  const lieferantGewaehlt = (v: string) => {
    const id = v === "0" ? null : Number(v);
    const lf = (lieferanten.data ?? []).find((l) => l.id === id);
    setForm((alt) => {
      const neu = { ...alt, absenderLieferantId: id };
      if (lf?.kategorieId) {
        const kat = (kategorien.data ?? []).find((k) => k.id === lf.kategorieId);
        if (kat) {
          neu.kategorieId = alt.kategorieId ?? kat.id;
          neu.konto = alt.konto || kat.konto || alt.konto;
          neu.ustSatz = kat.ustSatz ?? alt.ustSatz;
        }
      }
      return neu;
    });
  };

  /** v1.4: Massen-Upload — ganze Scan-Stapel, in 10er-Paketen mit Fortschritt. */
  const dateienHochladen = async (dateien: File[]) => {
    const CHUNK = 10;
    setUploadFehler([]);
    setBatchFortschritt({ fertig: 0, gesamt: dateien.length });
    const fehler: string[] = [];
    let ersteId: number | null = null;
    for (let i = 0; i < dateien.length; i += CHUNK) {
      const teil = dateien.slice(i, i + CHUNK);
      try {
        const payload = await Promise.all(
          teil.map(
            (d) =>
              new Promise<{ originalname: string; mime?: string; base64: string }>((ok, err) => {
                const r = new FileReader();
                r.onload = () =>
                  ok({
                    originalname: d.name,
                    mime: d.type || undefined,
                    base64: (r.result as string).split(",")[1],
                  });
                r.onerror = () => err(new Error(d.name));
                r.readAsDataURL(d);
              }),
          ),
        );
        const res = await anlegenBatch.mutateAsync({ dateien: payload, typ: uploadTyp });
        fehler.push(...res.fehler);
        if (ersteId === null && res.ids.length > 0) ersteId = res.ids[0];
      } catch (e) {
        fehler.push(e instanceof Error ? e.message : String(e));
      }
      setBatchFortschritt({ fertig: Math.min(i + CHUNK, dateien.length), gesamt: dateien.length });
    }
    setBatchFortschritt(null);
    setUploadFehler(fehler);
    invalidieren();
    // Direkt in den Erfassungs-Workflow: ersten neuen Beleg oeffnen
    if (ersteId !== null && fehler.length === 0) setOffen(ersteId);
  };

  const kategorieGewaehlt = (id: string) => {
    const kat = kategorien.data?.find((x) => x.id === Number(id));
    setForm((alt) => ({
      ...alt,
      kategorieId: kat ? kat.id : null,
      konto: kat?.konto ?? alt.konto,
      ustSatz: kat?.ustSatz ?? alt.ustSatz,
    }));
  };

  const formPayload = () => ({
      id: offen!,
      ...form,
      absenderLieferantId: form.absenderLieferantId ?? undefined,
      absenderFreitext: form.absenderFreitext || null,
      stichwort: form.stichwort || null,
      rechnungsnummer: form.rechnungsnummer || null,
      betrag: form.betrag ? Number(form.betrag.replace(",", ".")) : null,
      ustSatz: form.ustSatz,
      rechnungsdatum: form.rechnungsdatum || null,
      faelligAm: form.faelligAm || null,
      wiedervorlageAm: form.wiedervorlageAm || null,
      konto: form.konto || null,
      gegenkonto: form.gegenkonto || null,
      kategorieId: form.kategorieId ?? undefined,
      notizen: form.notizen || null,
  });
  const speichernJetzt = () => {
    if (!offen) return;
    speichern.mutate(formPayload());
  };

  const konfFarbe = (feld: string) =>
    konfidenz[feld] === "hoch"
      ? "border-teal-600"
      : konfidenz[feld] === "mittel"
        ? "border-amber-500"
        : konfidenz[feld]
          ? "border-red-400"
          : "";

  const d = detail.data;
  const istGebuchtet = d?.status === "gebucht";
  const dataUrl = d ? `data:${d.mime};base64,${d.dateiInhalt}` : "";

  const [q, setQ] = useState("");
  const sort = useSortierung<NonNullable<typeof liste.data>[number]>("createdAt");
  const gefiltert = (liste.data ?? []).filter(
    (r) => !q.trim() ||
      r.originalname.toLowerCase().includes(q.toLowerCase()) ||
      (r.lieferantName ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (r.absenderFreitext ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (r.stichwort ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (r.rechnungsnummer ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  const zeilen = sort.sortiere(gefiltert, (r, key) =>
    key === "dokument" ? r.originalname
    : key === "absender" ? r.lieferantName ?? r.absenderFreitext ?? r.stichwort ?? ""
    : key === "betrag" ? (r.betrag !== null ? Number(r.betrag) : null)
    : key === "faellig" ? r.faelligAm ?? r.wiedervorlageAm
    : key === "quelle" ? r.quelle
    : key === "status" ? r.status
    : key === "eingang" ? String(r.createdAt)
    : null,
  );

  // Durchraster-Navigation durch die aktuell gefilterte Liste (v1.4)
  const geordneteIds = zeilen.map((r) => r.id);
  const aktIdx = offen !== null ? geordneteIds.indexOf(offen) : -1;
  const nav = (dir: number) => {
    if (aktIdx < 0) return;
    const n = geordneteIds[aktIdx + dir];
    if (n !== undefined) setOffen(n);
  };
  const naechsterNeuer = (): number | null => {
    const danach = geordneteIds
      .slice(aktIdx + 1)
      .find((id) => zeilen.find((r) => r.id === id)?.status === "neu");
    if (danach !== undefined) return danach;
    return geordneteIds.find((id) => id !== offen && zeilen.find((r) => r.id === id)?.status === "neu") ?? null;
  };
  const buchenUndWeiter = async () => {
    if (!offen || !d) return;
    const ziel = naechsterNeuer();
    try {
      await speichern.mutateAsync(formPayload());
      await buchen.mutateAsync({ id: offen });
      invalidieren();
      setOffen(ziel);
    } catch {
      /* Fehlertext wird ueber speichern/buchen.error angezeigt */
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">Post Manager</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Eingescannte Post erfassen, prüfen, buchen — mit Zahlungsziel und Wiedervorlage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={uploadTyp} onValueChange={(v) => setUploadTyp(v as Typ)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rechnung">Rechnung</SelectItem>
              <SelectItem value="lieferschein">Lieferschein</SelectItem>
              <SelectItem value="gutschrift">Gutschrift</SelectItem>
              <SelectItem value="sonstiges">Sonstiges</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => dateiRef.current?.click()} disabled={batchFortschritt !== null}>
            {batchFortschritt !== null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {batchFortschritt !== null
              ? `Hochladen ${batchFortschritt.fertig}/${batchFortschritt.gesamt}`
              : "Belege hochladen"}
          </Button>
          <input
            ref={dateiRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              if (fs.length > 0) dateienHochladen(fs);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {uploadFehler.length > 0 && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {uploadFehler.length} Datei(en) fehlgeschlagen: {uploadFehler.slice(0, 3).join(" · ")}
          <button type="button" className="ml-2 underline" onClick={() => setUploadFehler([])}>schließen</button>
        </p>
      )}

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {(["alle", "neu", "gebucht", "abgelegt"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
          >
            {s === "alle" ? "Alle" : STATUS_LABEL[s]}
          </Button>
        ))}
        <span className="mx-2 border-l border-neutral-200" />
        {(["alle", "rechnung", "lieferschein", "gutschrift", "sonstiges"] as const).map((t) => (
          <Button key={t} size="sm" variant={typFilter === t ? "default" : "outline"} onClick={() => setTypFilter(t)}>
            {t === "alle" ? "Alle Typen" : TYP_LABEL[t]}
          </Button>
        ))}
      </div>

      <div className="relative mb-3 max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen …" className="pl-8" />
      </div>

      {/* Liste */}
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="cursor-pointer select-none px-3 py-2 font-medium" onClick={() => sort.umschalten("dokument")}>Dokument<sort.KopfIcon k="dokument" /></th>
              <th className="cursor-pointer select-none px-3 py-2 font-medium" onClick={() => sort.umschalten("absender")}>Absender<sort.KopfIcon k="absender" /></th>
              <th className="cursor-pointer select-none px-3 py-2 font-medium text-right" onClick={() => sort.umschalten("betrag")}>Betrag<sort.KopfIcon k="betrag" /></th>
              <th className="cursor-pointer select-none px-3 py-2 font-medium" onClick={() => sort.umschalten("faellig")}>Fällig / WV<sort.KopfIcon k="faellig" /></th>
              <th className="cursor-pointer select-none px-3 py-2 font-medium" onClick={() => sort.umschalten("quelle")}>Quelle<sort.KopfIcon k="quelle" /></th>
              <th className="cursor-pointer select-none px-3 py-2 font-medium" onClick={() => sort.umschalten("status")}>Status<sort.KopfIcon k="status" /></th>
              <th className="cursor-pointer select-none px-3 py-2 font-medium" onClick={() => sort.umschalten("eingang")}>Eingang<sort.KopfIcon k="eingang" /></th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                onClick={() => setOffen(r.id)}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                    <div>
                      <div className="flex items-center gap-2 font-medium text-neutral-800">
                        {r.stichwort ?? r.originalname}
                        {r.typ !== "rechnung" && (
                          <Badge variant="outline" className="text-[10px]">{TYP_LABEL[r.typ as Typ] ?? r.typ}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-neutral-400">{r.originalname}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-neutral-600">{r.lieferantName ?? r.absenderFreitext ?? "–"}</td>
                <td className="px-3 py-2 text-right text-neutral-800">{r.betrag ? geld(r.betrag) : "–"}</td>
                <td className="px-3 py-2 text-neutral-600">
                  {r.faelligAm ? fmtDatum(r.faelligAm) : r.wiedervorlageAm ? `WV ${fmtDatum(r.wiedervorlageAm)}` : "–"}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">{r.quelle}</td>
                <td className="px-3 py-2">
                  <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">{fmtDatum(r.createdAt instanceof Date ? r.createdAt.toISOString().slice(0, 10) : String(r.createdAt).slice(0, 10))}</td>
              </tr>
            ))}
            {liste.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-neutral-400">
                  Keine Dokumente — Beleg hochladen oder über den Import einwerfen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail-Dialog */}
      <Dialog open={offen !== null} onOpenChange={(v) => !v && setOffen(null)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="flex items-center gap-0.5">
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={aktIdx <= 0} onClick={() => nav(-1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs font-normal text-neutral-400">
                  {aktIdx >= 0 ? `${aktIdx + 1}/${geordneteIds.length}` : "–"}
                </span>
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={aktIdx < 0 || aktIdx >= geordneteIds.length - 1} onClick={() => nav(1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </span>
              {d?.originalname ?? "Dokument"}
              {d && <Badge variant={STATUS_VARIANT[d.status]}>{STATUS_LABEL[d.status]}</Badge>}
              {d && d.typ !== "rechnung" && (
                <Badge variant="outline">{TYP_LABEL[d.typ as Typ] ?? d.typ}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {d && (
            <div className="grid gap-4 md:grid-cols-2">
              {/* Vorschau */}
              <div className="min-h-[400px] rounded-lg border border-neutral-200 bg-neutral-50">
                {d.mime === "application/pdf" ? (
                  <iframe title="Beleg" src={dataUrl} className="h-full min-h-[500px] w-full rounded-lg" />
                ) : (
                  <img src={dataUrl} alt="Beleg" className="mx-auto max-h-[600px] rounded-lg object-contain" />
                )}
              </div>

              {/* Formular */}
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {!istGebuchtet && (d.mime === "application/pdf" || d.mime.startsWith("image/")) && (
                    <Button size="sm" variant="outline" onClick={() => ocr.mutate({ id: d.id })} disabled={ocr.isPending}>
                      {ocr.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ScanSearch className="mr-2 h-4 w-4" />
                      )}
                      Erkennen (OCR)
                    </Button>
                  )}
                  {Object.keys(konfidenz).length > 0 && (
                    <span className="text-xs text-neutral-500">
                      Farben: <span className="text-teal-700">sicher</span> ·{" "}
                      <span className="text-amber-600">prüfen</span> · <span className="text-red-500">unsicher</span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Typ</Label>
                    <Select value={form.typ} onValueChange={(v) => setForm({ ...form, typ: v as Typ })} disabled={istGebuchtet}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rechnung">Rechnung</SelectItem>
                        <SelectItem value="lieferschein">Lieferschein</SelectItem>
                        <SelectItem value="gutschrift">Gutschrift</SelectItem>
                        <SelectItem value="sonstiges">Sonstiges</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Kategorie</Label>
                    <Select value={form.kategorieId?.toString() ?? "0"} onValueChange={kategorieGewaehlt} disabled={istGebuchtet}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">—</SelectItem>
                        {(kategorien.data ?? []).map((k) => (
                          <SelectItem key={k.id} value={k.id.toString()}>
                            {k.name}{k.konto ? ` (${k.konto})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Absender (Lieferant)</Label>
                    <Select
                      value={form.absenderLieferantId?.toString() ?? "0"}
                      onValueChange={lieferantGewaehlt}
                      disabled={istGebuchtet}
                    >
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">—</SelectItem>
                        {(lieferanten.data ?? []).map((l) => (
                          <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Absender (Freitext)</Label>
                    <Input
                      className={konfFarbe("absenderFreitext")}
                      value={form.absenderFreitext}
                      onChange={(e) => setForm({ ...form, absenderFreitext: e.target.value })}
                      disabled={istGebuchtet}
                    />
                  </div>
                </div>

                <div>
                  <Label>Stichwort / Betreff</Label>
                  <Input value={form.stichwort} onChange={(e) => setForm({ ...form, stichwort: e.target.value })} disabled={istGebuchtet} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Rechnungsnummer</Label>
                    <Input
                      className={konfFarbe("rechnungsnummer")}
                      value={form.rechnungsnummer}
                      onChange={(e) => setForm({ ...form, rechnungsnummer: e.target.value })}
                      disabled={istGebuchtet}
                    />
                  </div>
                  <div>
                    <Label>Betrag (brutto, €)</Label>
                    <Input
                      className={konfFarbe("betrag")}
                      value={form.betrag}
                      onChange={(e) => setForm({ ...form, betrag: e.target.value })}
                      disabled={istGebuchtet}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>USt-Satz</Label>
                    <Select
                      value={String(form.ustSatz)}
                      onValueChange={(v) => setForm({ ...form, ustSatz: Number(v) })}
                      disabled={istGebuchtet}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="19">19 %</SelectItem>
                        <SelectItem value="7">7 %</SelectItem>
                        <SelectItem value="0">0 %</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Rechnungsdatum</Label>
                    <Input
                      type="date"
                      className={konfFarbe("rechnungsdatum")}
                      value={form.rechnungsdatum}
                      onChange={(e) => setForm({ ...form, rechnungsdatum: e.target.value })}
                      disabled={istGebuchtet}
                    />
                  </div>
                  <div>
                    <Label>Fällig am</Label>
                    <Input
                      type="date"
                      className={konfFarbe("faelligAm")}
                      value={form.faelligAm}
                      onChange={(e) => setForm({ ...form, faelligAm: e.target.value })}
                      disabled={istGebuchtet}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Wiedervorlage</Label>
                    <Input
                      type="date"
                      value={form.wiedervorlageAm}
                      onChange={(e) => setForm({ ...form, wiedervorlageAm: e.target.value })}
                      disabled={istGebuchtet}
                    />
                  </div>
                  <div>
                    <Label>Konto</Label>
                    <Input value={form.konto} onChange={(e) => setForm({ ...form, konto: e.target.value })} disabled={istGebuchtet} />
                  </div>
                  <div>
                    <Label>Gegenkonto</Label>
                    <Input value={form.gegenkonto} onChange={(e) => setForm({ ...form, gegenkonto: e.target.value })} disabled={istGebuchtet} />
                  </div>
                </div>

                <div>
                  <Label>Notizen</Label>
                  <Textarea value={form.notizen} onChange={(e) => setForm({ ...form, notizen: e.target.value })} disabled={istGebuchtet} rows={2} />
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
                  {!istGebuchtet && (
                    <>
                      <Button size="sm" onClick={speichernJetzt} disabled={speichern.isPending}>
                        {speichern.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Speichern
                      </Button>
                      {form.typ === "rechnung" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => buchen.mutate({ id: d.id })} disabled={buchen.isPending}>
                            {buchen.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookCheck className="mr-2 h-4 w-4" />}
                            Buchen
                          </Button>
                          <Button size="sm" variant="secondary" onClick={buchenUndWeiter} disabled={speichern.isPending || buchen.isPending}>
                            {speichern.isPending || buchen.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookCheck className="mr-2 h-4 w-4" />}
                            Buchen &amp; nächster
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatus.mutate({ id: d.id, status: d.status === "abgelegt" ? "neu" : "abgelegt" })}
                      >
                        {d.status === "abgelegt" ? (
                          <><ArchiveRestore className="mr-2 h-4 w-4" />Wiederherstellen</>
                        ) : (
                          <><Archive className="mr-2 h-4 w-4" />Ablegen</>
                        )}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setLoeschenId(d.id)}>
                        <Trash2 className="mr-2 h-4 w-4" />Löschen
                      </Button>
                    </>
                  )}
                  {istGebuchtet && (
                    <span className="text-xs text-neutral-500">
                      Gebucht als Eingangsrechnung{d.incomingInvoiceId ? ` #${d.incomingInvoiceId}` : ""} — unveränderbar (GoBD).
                    </span>
                  )}
                </div>
                {(speichern.isError || buchen.isError) && (
                  <p className="text-xs text-red-600">
                    {(speichern.error ?? buchen.error)?.message}
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Löschen bestätigen */}
      <AlertDialog open={loeschenId !== null} onOpenChange={(v) => !v && setLoeschenId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dokument löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Nur ungebuchte Dokumente können gelöscht werden. Der Beleg wird unwiderruflich entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => loeschenId && loeschen.mutate({ id: loeschenId })}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
