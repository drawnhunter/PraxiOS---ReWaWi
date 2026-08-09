import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { geld, datum as fmtDatum } from "@/lib/format";
import { pdfHerunterladen } from "@/lib/downloads";
import { PdfVorschau } from "@/components/PdfVorschau";
// statusBadge lokal (kein Import aus pages/Invoices — vermeidet Modul-Zyklus)
import { STATUS_LABELS, type InvoiceStatus } from "@contracts/invoicing";
function statusBadge(status: InvoiceStatus) {
  const variant =
    status === "finalisiert" ? "default" : status === "storniert" ? "destructive" : "secondary";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  ExternalLink, FileDown, Copy, Archive, ArchiveRestore, Trash2,
  CreditCard, CheckCircle2, Mail, FileCheck2, FilePlus2, Loader2,
} from "lucide-react";

/** v1.6: Seitenpanel — Schnellblick, Timeline und Aktionen zu einer Rechnung. */

const fmtDt = (d: unknown): string => {
  if (!d) return "–";
  const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  return fmtDatum(iso);
};

export default function RechnungsPanel({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const rechnung = trpc.invoices.get.useQuery({ id });
  const akt = trpc.invoices.aktivitaeten.useQuery({ id });

  const duplicate = trpc.invoices.duplicate.useMutation({
    onSuccess: (d) => { onChanged(); onClose(); navigate(`/rechnungen/${d.id}`); },
  });
  const setArch = trpc.invoices.setArchiviert.useMutation({
    onSuccess: () => { onChanged(); onClose(); },
  });
  const loeschen = trpc.invoices.delete.useMutation({
    onSuccess: () => { onChanged(); onClose(); },
  });
  const gutschrift = trpc.invoices.createCreditNote.useMutation({
    onSuccess: (d) => { onChanged(); onClose(); navigate(`/gutschriften/${d.id}`); },
  });

  const pdfLaden = async () => {
    const res = await utils.client.pdf.invoice.query({ id });
    pdfHerunterladen(res);
  };

  const r = rechnung.data;
  const a = akt.data;
  const offen = r && r.status === "finalisiert" ? Number(r.brutto) - Number(r.bezahltBetrag) : 0;
  const ueberfaellig = offen > 0.004 && r && r.faelligkeitsdatum < new Date().toISOString().slice(0, 10);

  // Timeline aufbauen (chronologisch)
  const schritte: { zeit: string; label: string; detail?: string; icon: "entwurf" | "final" | "mail" | "zahlung" | "gs" }[] = [];
  if (a) {
    schritte.push({ zeit: fmtDt(a.erstelltAm), label: "Entwurf erstellt", icon: "entwurf" });
    if (a.finalizedAm) schritte.push({ zeit: fmtDt(a.finalizedAm), label: "Finalisiert & nummeriert", icon: "final" });
    for (const m of a.mails) {
      schritte.push({
        zeit: fmtDt(m.gesendetAm),
        label: m.erfolg ? "Per E-Mail versendet" : "E-Mail fehlgeschlagen",
        detail: m.empfaenger,
        icon: "mail",
      });
    }
    for (const b of a.bankZuordnungen) {
      schritte.push({ zeit: fmtDt(b.datum), label: "Zahlung zugeordnet (Bank)", detail: geld(b.betrag ?? 0), icon: "zahlung" });
    }
    if (a.bezahltAm && a.bankZuordnungen.length === 0) {
      schritte.push({ zeit: fmtDt(a.bezahltAm), label: "Als bezahlt markiert", detail: geld(a.bezahltBetrag), icon: "zahlung" });
    }
    for (const g of a.gutschriften) {
      schritte.push({ zeit: fmtDt(g.datum), label: `Gutschrift ${g.nummer ?? ""}`, detail: geld(g.brutto), icon: "gs" });
    }
    schritte.sort((x, y) => (x.zeit < y.zeit ? -1 : x.zeit > y.zeit ? 1 : 0));
  }

  const iconFuer = (t: string) =>
    t === "entwurf" ? <FilePlus2 className="h-4 w-4 text-neutral-400" />
    : t === "final" ? <FileCheck2 className="h-4 w-4 text-blue-600" />
    : t === "mail" ? <Mail className="h-4 w-4 text-violet-600" />
    : t === "zahlung" ? <CheckCircle2 className="h-4 w-4 text-green-600" />
    : <CreditCard className="h-4 w-4 text-amber-600" />;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {r ? (r.nummer ?? `Entwurf #${r.id}`) : "Lade …"}
            {r && statusBadge(r.status)}
            {r?.archiviert && <Badge variant="outline">archiviert</Badge>}
            {ueberfaellig && <Badge variant="destructive">Überfällig</Badge>}
          </SheetTitle>
        </SheetHeader>

        {r && (
          <div className="mt-4 space-y-5">
            {/* Kopfdaten */}
            <div className="rounded-lg border border-neutral-200 p-4 text-sm">
              <div className="font-medium">{r.kundeName}</div>
              <div className="mt-0.5 text-xs text-neutral-400">
                {r.kundeStrasse}, {r.kundePlz} {r.kundeOrt}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-neutral-400">Brutto</div>
                  <div className="tabular-nums font-medium">{geld(r.brutto)}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-400">Offen</div>
                  <div className={`tabular-nums font-medium ${offen > 0.004 ? "text-red-600" : "text-green-700"}`}>
                    {r.status === "finalisiert" ? geld(offen) : "–"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-400">Datum</div>
                  <div>{fmtDatum(r.rechnungsdatum)}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-400">Fällig</div>
                  <div className={ueberfaellig ? "font-medium text-red-600" : ""}>{fmtDatum(r.faelligkeitsdatum)}</div>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">Verlauf</h3>
              {akt.isLoading ? (
                <p className="text-sm text-neutral-400">Lade …</p>
              ) : (
                <ul className="space-y-2">
                  {schritte.map((s, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-0.5">{iconFuer(s.icon)}</span>
                      <div>
                        <span className="text-neutral-500">{s.zeit}</span> — {s.label}
                        {s.detail && <span className="text-neutral-400"> · {s.detail}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Aktionen */}
            <div className="space-y-2 border-t border-neutral-100 pt-4">
              <div className="grid grid-cols-2 gap-2">
                <Button asChild>
                  <Link to={`/rechnungen/${r.id}`}>
                    <ExternalLink className="mr-1.5 h-4 w-4" /> Öffnen
                  </Link>
                </Button>
                <Button variant="outline" onClick={pdfLaden}>
                  <FileDown className="mr-1.5 h-4 w-4" /> PDF
                </Button>
                <div className="col-span-2">
                  <PdfVorschau art="invoice" id={r.id} titel={`Rechnung ${r.nummer ?? "Entwurf"}`} />
                </div>
                <Button variant="outline" onClick={() => duplicate.mutate({ id: r.id })} disabled={duplicate.isPending}>
                  {duplicate.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Copy className="mr-1.5 h-4 w-4" />}
                  Duplizieren
                </Button>
                {r.status === "finalisiert" && (
                  <Button variant="outline" onClick={() => gutschrift.mutate({ invoiceId: r.id })} disabled={gutschrift.isPending}>
                    <CreditCard className="mr-1.5 h-4 w-4" /> Gutschrift
                  </Button>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setArch.mutate({ id: r.id, archiviert: !r.archiviert })}
                >
                  {r.archiviert ? (
                    <><ArchiveRestore className="mr-1.5 h-4 w-4" /> Entarchivieren</>
                  ) : (
                    <><Archive className="mr-1.5 h-4 w-4" /> Archivieren</>
                  )}
                </Button>
                {r.status === "entwurf" && (
                  <Button
                    variant="ghost" size="sm" className="text-red-600"
                    onClick={() => confirm("Entwurf wirklich löschen?") && loeschen.mutate({ id: r.id })}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" /> Löschen
                  </Button>
                )}
              </div>
              {(duplicate.error ?? setArch.error ?? loeschen.error ?? gutschrift.error) && (
                <p className="text-xs text-red-600">
                  {(duplicate.error ?? setArch.error ?? loeschen.error ?? gutschrift.error)?.message}
                </p>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
