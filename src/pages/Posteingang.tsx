import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
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
  Loader2,
  ScanSearch,
  Trash2,
  Upload,
} from "lucide-react";

type Status = "neu" | "gebucht" | "abgelegt";
type Typ = "rechnung" | "sonstiges";
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

  const anlegen = trpc.posteingang.anlegen.useMutation({
    onSuccess: (d) => {
      invalidieren();
      setOffen(d.id);
    },
  });
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
    },
  });

  const dateiHochladen = (datei: File) => {
    const r = new FileReader();
    r.onload = () => {
      anlegen.mutate({
        originalname: datei.name,
        mime: datei.type || undefined,
        base64: (r.result as string).split(",")[1],
        typ: "rechnung",
      });
    };
    r.readAsDataURL(datei);
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

  const speichernJetzt = () => {
    if (!offen) return;
    speichern.mutate({
      id: offen,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">Post Manager</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Eingescannte Post erfassen, prüfen, buchen — mit Zahlungsziel und Wiedervorlage.
          </p>
        </div>
        <Button onClick={() => dateiRef.current?.click()} disabled={anlegen.isPending}>
          {anlegen.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          Beleg hochladen
        </Button>
        <input
          ref={dateiRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={(e) => e.target.files?.[0] && dateiHochladen(e.target.files[0])}
        />
      </div>

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
        {(["alle", "rechnung", "sonstiges"] as const).map((t) => (
          <Button key={t} size="sm" variant={typFilter === t ? "default" : "outline"} onClick={() => setTypFilter(t)}>
            {t === "alle" ? "Alle Typen" : t === "rechnung" ? "Rechnungen" : "Sonstiges"}
          </Button>
        ))}
      </div>

      {/* Liste */}
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Dokument</th>
              <th className="px-3 py-2 font-medium">Absender</th>
              <th className="px-3 py-2 font-medium text-right">Betrag</th>
              <th className="px-3 py-2 font-medium">Fällig / WV</th>
              <th className="px-3 py-2 font-medium">Quelle</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Eingang</th>
            </tr>
          </thead>
          <tbody>
            {(liste.data ?? []).map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                onClick={() => setOffen(r.id)}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                    <div>
                      <div className="font-medium text-neutral-800">{r.stichwort ?? r.originalname}</div>
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
                <td className="px-3 py-2 text-xs text-neutral-500">{fmtDatum(r.createdAt.toString().slice(0, 10))}</td>
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
              {d?.originalname ?? "Dokument"}
              {d && <Badge variant={STATUS_VARIANT[d.status]}>{STATUS_LABEL[d.status]}</Badge>}
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
                      onValueChange={(v) => setForm({ ...form, absenderLieferantId: v === "0" ? null : Number(v) })}
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
                        <Button size="sm" variant="outline" onClick={() => buchen.mutate({ id: d.id })} disabled={buchen.isPending}>
                          {buchen.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookCheck className="mr-2 h-4 w-4" />}
                          Buchen
                        </Button>
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
