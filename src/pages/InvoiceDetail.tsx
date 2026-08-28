import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import BankZuordnung from "@/components/BankZuordnung";
import { geld, datum, parseGeldInput, parseMengeInput, mengeFmt } from "@/lib/format";
import {
  computeTotals,
  ZAHLUNGSZIELE_TAGE,
  EINHEITEN,
  UST_SAETZE,
} from "@contracts/invoicing";
import { statusBadge } from "./Invoices";
import { ProduktPicker, ProduktComboInput } from "@/components/ProduktSuche";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Plus, Trash2, Truck } from "lucide-react";
import { PdfButton } from "@/components/PdfButton";
import { PdfVorschau } from "@/components/PdfVorschau";
import { MailDialog } from "@/components/MailDialog";
import { SerieSpeichernDialog } from "@/components/SerienDialog";
import { Repeat } from "lucide-react";
import { XrechnungButton } from "@/components/XrechnungButton";
import { Mahnwesen } from "@/components/Mahnwesen";

interface EditItem {
  bezeichnung: string;
  beschreibung: string;
  menge: string;
  einheit: string;
  einzelpreis: string;
  ustSatz: number;
  rabattArt: "prozent" | "festwert" | "";
  rabattWert: string;
}

interface EditKopf {
  rechnungsdatum: string;
  faelligkeitsdatum: string;
  leistungsdatum: string;
  bankAccountId: string;
  kundeName: string;
  kundeZusatz: string;
  kundeStrasse: string;
  kundePlz: string;
  kundeOrt: string;
  kundeLand: string;
  pdfNotiz: string;
  bereitsBezahlt: boolean;
  bemerkung: string;
  hauptrabattArt: "prozent" | "festwert" | "";
  hauptrabattWert: string;
  rabattAddieren: boolean;
}

function addTage(iso: string, tage: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + tage);
  return d.toISOString().slice(0, 10);
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [serieOffen, setSerieOffen] = useState(false);

  const rechnung = trpc.invoices.get.useQuery({ id: Number(id) });
  const produkte = trpc.products.list.useQuery();
  const banken = trpc.bank.list.useQuery();
  const kunden = trpc.customers.list.useQuery();
  const einstellungen = trpc.settings.get.useQuery();

  const [kopf, setKopf] = useState<EditKopf | null>(null);
  const [items, setItems] = useState<EditItem[]>([]);
  const [zahldialog, setZahldialog] = useState(false);
  const [zahlbetrag, setZahlbetrag] = useState("");
  const [fehler, setFehler] = useState<string>("");
  const [adressDialog, setAdressDialog] = useState<null | "speichern" | "finalisieren">(null);

  const r = rechnung.data;
  const istEntwurf = r?.status === "entwurf";
  const waehrung = einstellungen.data?.waehrung ?? "€";
  const kunde = trpc.customers.get.useQuery(
    { id: r?.customerId ?? 0 },
    { enabled: !!r },
  );
  const kundenUpdate = trpc.customers.update.useMutation();
  const lieferscheinErstellen = trpc.deliveryNotes.createFromInvoice.useMutation({
    onSuccess: (res) => navigate(`/lieferscheine/${res.id}`),
  });

  // Edit-State aus geladenen Daten befüllen (einmalig je Beleg)
  useEffect(() => {
    if (!r || kopf) return;
    setKopf({
      rechnungsdatum: r.rechnungsdatum,
      faelligkeitsdatum: r.faelligkeitsdatum,
      leistungsdatum: r.leistungsdatum ?? "",
      bankAccountId: r.bankAccountId ? String(r.bankAccountId) : "",
      kundeName: r.kundeName,
      kundeZusatz: r.kundeZusatz ?? "",
      kundeStrasse: r.kundeStrasse,
      kundePlz: r.kundePlz,
      kundeOrt: r.kundeOrt,
      kundeLand: r.kundeLand,
      pdfNotiz: r.pdfNotiz ?? "",
      bereitsBezahlt: r.bereitsBezahlt,
      bemerkung: r.bemerkung ?? "",
      hauptrabattArt: (r.hauptrabattArt as "prozent" | "festwert" | "") ?? "",
      hauptrabattWert: r.hauptrabattWert
        ? new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2 }).format(Number(r.hauptrabattWert))
        : "",
      rabattAddieren: r.rabattAddieren ?? false,
    });
    setItems(
      r.items.map((it) => ({
        bezeichnung: it.bezeichnung,
        beschreibung: it.beschreibung ?? "",
        menge: new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(
          Number(it.menge),
        ),
        einheit: it.einheit,
        einzelpreis: new Intl.NumberFormat("de-DE", {
          minimumFractionDigits: 2,
        }).format(Number(it.einzelpreis)),
        ustSatz: it.ustSatz,
        rabattArt: (it.rabattArt as "prozent" | "festwert" | "") ?? "",
        rabattWert: it.rabattWert
          ? new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2 }).format(Number(it.rabattWert))
          : "",
      })),
    );
  }, [r, kopf]);

  const totals = useMemo(
    () =>
      computeTotals(
        items.map((it) => ({
          menge: parseMengeInput(it.menge || "0"),
          einzelpreis: parseGeldInput(it.einzelpreis || "0"),
          ustSatz: it.ustSatz,
          rabattArt: it.rabattArt || null,
          rabattWert: it.rabattWert ? parseGeldInput(it.rabattWert) : null,
        })),
        kopf?.hauptrabattArt && kopf.hauptrabattWert
          ? { art: kopf.hauptrabattArt, wert: Number(parseGeldInput(kopf.hauptrabattWert)) }
          : null,
        kopf?.rabattAddieren ?? false,
      ),
    [items, kopf?.hauptrabattArt, kopf?.hauptrabattWert, kopf?.rabattAddieren],
  );

  const inval = () => {
    utils.invoices.get.invalidate({ id: Number(id) });
    utils.invoices.list.invalidate();
    utils.dashboard.stats.invalidate();
  };

  const speichern = trpc.invoices.updateDraft.useMutation({ onSuccess: inval });
  const finalisieren = trpc.invoices.finalize.useMutation({ onSuccess: inval });
  const loeschen = trpc.invoices.delete.useMutation({
    onSuccess: () => navigate("/rechnungen"),
  });
  const bezahlt = trpc.invoices.markPaid.useMutation({
    onSuccess: () => {
      inval();
      setZahldialog(false);
    },
  });
  const zahlungZurueck = trpc.invoices.unmarkPaid.useMutation({ onSuccess: inval });
  const storno = trpc.invoices.createCreditNote.useMutation({
    onSuccess: (res) => navigate(`/gutschriften/${res.id}`),
  });

  if (rechnung.isLoading || !kopf) {
    return <p className="text-sm text-neutral-500">Lade …</p>;
  }
  if (!r) return <p className="text-sm text-red-600">Rechnung nicht gefunden.</p>;

  const bauePayload = () => ({
    id: r.id,
    kopf: {
      customerId: r.customerId,
      rechnungsdatum: kopf.rechnungsdatum,
      faelligkeitsdatum: kopf.faelligkeitsdatum,
      leistungsdatum: kopf.leistungsdatum || null,
      bankAccountId: kopf.bankAccountId ? Number(kopf.bankAccountId) : null,
      kundeName: kopf.kundeName,
      kundeZusatz: kopf.kundeZusatz || null,
      kundeStrasse: kopf.kundeStrasse,
      kundePlz: kopf.kundePlz,
      kundeOrt: kopf.kundeOrt,
      kundeLand: kopf.kundeLand || "Deutschland",
      pdfNotiz: kopf.pdfNotiz || null,
      bereitsBezahlt: kopf.bereitsBezahlt,
      bemerkung: kopf.bemerkung || null,
      hauptrabattArt: kopf.hauptrabattArt || null,
      hauptrabattWert: kopf.hauptrabattWert ? parseGeldInput(kopf.hauptrabattWert) : null,
      rabattAddieren: kopf.rabattAddieren,
    },
    items: items
      .filter((it) => it.bezeichnung.trim())
      .map((it) => ({
        bezeichnung: it.bezeichnung,
        beschreibung: it.beschreibung || null,
        menge: parseMengeInput(it.menge || "0"),
        einheit: it.einheit,
        einzelpreis: parseGeldInput(it.einzelpreis || "0"),
        rabattArt: it.rabattArt || null,
        rabattWert: it.rabattWert ? parseGeldInput(it.rabattWert) : null,
        ustSatz: it.ustSatz,
      })),
  });

  const speichernKlick = () => {
    setFehler("");
    if (adresseAbweichend()) {
      setAdressDialog("speichern");
      return;
    }
    speichern.mutate(bauePayload(), { onError: (e) => setFehler(e.message) });
  };

  const speichernUndFinalisieren = async () => {
    setFehler("");
    if (adresseAbweichend()) {
      setAdressDialog("finalisieren");
      return;
    }
    try {
      await speichern.mutateAsync(bauePayload());
      await finalisieren.mutateAsync({ id: r.id });
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Fehler beim Finalisieren");
    }
  };

  /** Adresse im Beleg weicht vom Kundenstamm ab? */
  const adresseAbweichend = (): boolean => {
    const k = kunde.data;
    if (!k || !istEntwurf) return false;
    return (
      kopf.kundeName !== k.name ||
      (kopf.kundeZusatz || "") !== (k.zusatz ?? "") ||
      kopf.kundeStrasse !== k.strasse ||
      kopf.kundePlz !== k.plz ||
      kopf.kundeOrt !== k.ort ||
      (kopf.kundeLand || "Deutschland") !== k.land
    );
  }

  const adressUebernahme = async (insProfil: boolean) => {
    const modus = adressDialog;
    setAdressDialog(null);
    setFehler("");
    try {
      if (insProfil && kunde.data) {
        await kundenUpdate.mutateAsync({
          id: kunde.data.id,
          data: {
            name: kopf.kundeName,
            zusatz: kopf.kundeZusatz || null,
            strasse: kopf.kundeStrasse,
            plz: kopf.kundePlz,
            ort: kopf.kundeOrt,
            land: kopf.kundeLand || "Deutschland",
            email: kunde.data.email ?? null,
            telefon: kunde.data.telefon ?? null,
            ustIdNr: kunde.data.ustIdNr ?? null,
            zahlungszielTage: kunde.data.zahlungszielTage ?? null,
            notizen: kunde.data.notizen ?? null,
          },
        });
        utils.customers.list.invalidate();
        utils.customers.get.invalidate({ id: kunde.data.id });
      }
      await speichern.mutateAsync(bauePayload());
      if (modus === "finalisieren") {
        await finalisieren.mutateAsync({ id: r.id });
      }
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Fehler beim Speichern");
    }
  };

  const produktUebernehmen = async (produktId: string) => {
    const p = (produkte.data ?? []).find((x) => x.id === Number(produktId));
    if (!p) return;
    let __PREIS__ = p.preisNetto;
    const __PARTNER__ = r?.customerId;
    if (__PARTNER__) {
      try {
        const r = await utils.client.products.preisFuer.query({
          typ: "kunde",
          partnerId: __PARTNER__,
          productId: p.id,
        });
        __PREIS__ = r.preisNetto;
      } catch {
        // Standardpreis als Fallback
      }
    }
    setItems([
      ...items,
      {
        bezeichnung: p.name,
        beschreibung: p.beschreibung ?? "",
        menge: "1",
        einheit: p.einheit,
        einzelpreis: new Intl.NumberFormat("de-DE", {
          minimumFractionDigits: 2,
        }).format(Number(__PREIS__)),
        ustSatz: p.ustSatz,
        rabattArt: "",
        rabattWert: "",
      },
    ]);
  };

  const kundenAdresseUebernehmen = (kundenIdStr: string) => {
    const k = (kunden.data ?? []).find((x) => x.id === Number(kundenIdStr));
    if (!k) return;
    setKopf({
      ...kopf,
      kundeName: k.name,
      kundeZusatz: k.zusatz ?? "",
      kundeStrasse: k.strasse,
      kundePlz: k.plz,
      kundeOrt: k.ort,
      kundeLand: k.land,
    });
  };

  const offenCent = Math.round((Number(r.brutto) - Number(r.bezahltBetrag)) * 100);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/rechnungen")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            {r.nummer ?? `Rechnungsentwurf #${r.id}`}
          </h1>
          {statusBadge(r.status)}
        </div>
        <div className="flex items-center gap-2">
          <PdfButton art="invoice" id={r.id} />
          <PdfVorschau art="invoice" id={r.id} titel={`Rechnung ${r.nummer ?? 'Entwurf'}`} />
          <MailDialog art="invoice" id={r.id} />
          <Button variant="outline" size="sm" onClick={() => setSerieOffen(true)}>
            <Repeat className="mr-1.5 h-4 w-4" /> Als Serie speichern
          </Button>
          {r.status !== "entwurf" && <XrechnungButton id={r.id} />}
          {r.status === "finalisiert" && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={lieferscheinErstellen.isPending}
                onClick={() => lieferscheinErstellen.mutate({ invoiceId: r.id })}
              >
                <Truck className="mr-1.5 h-4 w-4" /> Lieferschein
              </Button>
              {offenCent > 0 ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setZahlbetrag(
                      new Intl.NumberFormat("de-DE", {
                        minimumFractionDigits: 2,
                      }).format(offenCent / 100),
                    );
                    setZahldialog(true);
                  }}
                >
                  Zahlung verbuchen
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => zahlungZurueck.mutate({ id: r.id })}>
                  Zahlung zurücksetzen
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    Stornieren
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Rechnung stornieren?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Es wird eine Gutschrift (Entwurf) mit allen Positionen dieser
                      Rechnung erzeugt. Nach deren Finalisierung gilt die Rechnung als
                      storniert — die ursprüngliche Rechnung bleibt GoBD-konform
                      unverändert erhalten.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction onClick={() => storno.mutate({ invoiceId: r.id })}>
                      Gutschrift erzeugen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {istEntwurf && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Entwurf löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Nur möglich, solange die Rechnung nicht finalisiert ist. Es wurde
                    noch keine Belegnummer vergeben — der Nummernkreis bleibt lückenlos.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={() => loeschen.mutate({ id: r.id })}>
                    Löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {r.status === "storniert" && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Diese Rechnung wurde per Gutschrift storniert.
          {r.creditNotes.map((g) => (
            <span key={g.id}>
              {" "}
              <Link to={`/gutschriften/${g.id}`} className="underline">
                {g.nummer ?? `Entwurf #${g.id}`}
              </Link>
            </span>
          ))}
        </div>
      )}
      {r.creditNotes.length > 0 && r.status === "finalisiert" && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Zu dieser Rechnung existieren Gutschriften:{" "}
          {r.creditNotes.map((g, i) => (
            <span key={g.id}>
              {i > 0 && ", "}
              <Link to={`/gutschriften/${g.id}`} className="underline">
                {g.nummer ?? `Entwurf #${g.id}`}
              </Link>
            </span>
          ))}
        </div>
      )}

      {r.status === "finalisiert" && offenCent > 0 && <Mahnwesen rechnungId={r.id} />}

      {/* ── Kopfdaten ── */}
      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-neutral-700">Empfänger &amp; Belegdaten</h2>
          {istEntwurf && (
            <Select onValueChange={kundenAdresseUebernehmen}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Adresse aus Kundenstamm …" />
              </SelectTrigger>
              <SelectContent>
                {(kunden.data ?? []).map((k) => (
                  <SelectItem key={k.id} value={String(k.id)}>
                    {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              {istEntwurf ? (
                <Input
                  value={kopf.kundeName}
                  onChange={(e) => setKopf({ ...kopf, kundeName: e.target.value })}
                />
              ) : (
                <div className="mt-1 text-sm">{r.kundeName}</div>
              )}
            </div>
            <div>
              <Label>Adresszusatz</Label>
              {istEntwurf ? (
                <Input
                  value={kopf.kundeZusatz}
                  onChange={(e) => setKopf({ ...kopf, kundeZusatz: e.target.value })}
                />
              ) : (
                <div className="mt-1 text-sm">{r.kundeZusatz || "–"}</div>
              )}
            </div>
            <div>
              <Label>Straße</Label>
              {istEntwurf ? (
                <Input
                  value={kopf.kundeStrasse}
                  onChange={(e) => setKopf({ ...kopf, kundeStrasse: e.target.value })}
                />
              ) : (
                <div className="mt-1 text-sm">{r.kundeStrasse}</div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>PLZ</Label>
                {istEntwurf ? (
                  <Input
                    value={kopf.kundePlz}
                    onChange={(e) => setKopf({ ...kopf, kundePlz: e.target.value })}
                  />
                ) : (
                  <div className="mt-1 text-sm">{r.kundePlz}</div>
                )}
              </div>
              <div>
                <Label>Ort</Label>
                {istEntwurf ? (
                  <Input
                    value={kopf.kundeOrt}
                    onChange={(e) => setKopf({ ...kopf, kundeOrt: e.target.value })}
                  />
                ) : (
                  <div className="mt-1 text-sm">{r.kundeOrt}</div>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Rechnungsdatum</Label>
                {istEntwurf ? (
                  <Input
                    type="date"
                    value={kopf.rechnungsdatum}
                    onChange={(e) => {
                      const neu = e.target.value;
                      const diff =
                        (new Date(kopf.faelligkeitsdatum).getTime() -
                          new Date(kopf.rechnungsdatum).getTime()) /
                        86400000;
                      setKopf({
                        ...kopf,
                        rechnungsdatum: neu,
                        faelligkeitsdatum: addTage(neu, Math.max(0, diff)),
                      });
                    }}
                  />
                ) : (
                  <div className="mt-1 text-sm">{datum(r.rechnungsdatum)}</div>
                )}
              </div>
              <div>
                <Label>Zahlungsziel</Label>
                {istEntwurf ? (
                  <Select
                    value={
                      kopf.bereitsBezahlt
                        ? "bezahlt"
                        : String(
                            Math.round(
                              (new Date(kopf.faelligkeitsdatum).getTime() -
                                new Date(kopf.rechnungsdatum).getTime()) /
                                86400000,
                            ),
                          )
                    }
                    onValueChange={(v) => {
                      if (v === "bezahlt") {
                        setKopf({
                          ...kopf,
                          bereitsBezahlt: true,
                          faelligkeitsdatum: kopf.rechnungsdatum,
                        });
                      } else {
                        setKopf({
                          ...kopf,
                          bereitsBezahlt: false,
                          faelligkeitsdatum: addTage(kopf.rechnungsdatum, Number(v)),
                        });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ZAHLUNGSZIELE_TAGE.map((t) => (
                        <SelectItem key={t} value={String(t)}>
                          {t === 0 ? "sofort" : `${t} Tage`}
                        </SelectItem>
                      ))}
                      <SelectItem value="bezahlt">bereits bezahlt</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="mt-1 text-sm">
                    {r.bereitsBezahlt
                      ? "bereits bezahlt"
                      : `fällig ${datum(r.faelligkeitsdatum)}`}
                  </div>
                )}
              </div>
            </div>
            <div>
              <Label>Leistungsdatum / Zeitraum (optional)</Label>
              {istEntwurf ? (
                <Input
                  value={kopf.leistungsdatum}
                  onChange={(e) => setKopf({ ...kopf, leistungsdatum: e.target.value })}
                  placeholder="z. B. Juni 2026 oder 04.–07.06.2026"
                />
              ) : (
                <div className="mt-1 text-sm">{r.leistungsdatum || "–"}</div>
              )}
            </div>
            <div>
              <Label>Bankkonto für die Zahlung</Label>
              {istEntwurf ? (
                <Select
                  value={kopf.bankAccountId}
                  onValueChange={(v) => setKopf({ ...kopf, bankAccountId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Konto auswählen …" />
                  </SelectTrigger>
                  <SelectContent>
                    {(banken.data ?? [])
                      .filter((b) => b.aktiv)
                      .map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.bezeichnung} — {b.bankName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="mt-1 text-sm">
                  {r.bankAccount
                    ? `${r.bankAccount.bezeichnung} — ${r.bankAccount.bankName}`
                    : "–"}
                </div>
              )}
            </div>
            <div>
              <Label>Bemerkung auf dem Beleg (erscheint auf dem PDF)</Label>
              {istEntwurf ? (
                <Textarea
                  value={kopf.pdfNotiz}
                  onChange={(e) => setKopf({ ...kopf, pdfNotiz: e.target.value })}
                  rows={2}
                  placeholder="z. B. Hinweis auf Expressversand, individuelle Informationen …"
                />
              ) : (
                <div className="mt-1 whitespace-pre-wrap text-sm">{r.pdfNotiz || "–"}</div>
              )}
            </div>
            <div>
              <Label>Interne Bemerkung (nicht auf dem PDF)</Label>
              {istEntwurf ? (
                <Textarea
                  value={kopf.bemerkung}
                  onChange={(e) => setKopf({ ...kopf, bemerkung: e.target.value })}
                  rows={2}
                />
              ) : (
                <div className="mt-1 text-sm">{r.bemerkung || "–"}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Positionen ── */}
      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-neutral-700">Positionen</h2>
          {istEntwurf && (
            <div className="flex items-center gap-2">
              <ProduktPicker
                produkte={produkte.data ?? []}
                onPick={(p) => produktUebernehmen(String(p.id))}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setItems([
                    ...items,
                    {
                      bezeichnung: "",
                      beschreibung: "",
                      menge: "1",
                      einheit: "Stück",
                      einzelpreis: "",
                      ustSatz: 19,
                      rabattArt: "",
                      rabattWert: "",
                    },
                  ])
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Leere Position
              </Button>
            </div>
          )}
        </div>

                <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="w-8 px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Beschreibung</th>
              <th className="w-24 px-2 py-2 text-right font-medium">Menge</th>
              <th className="w-28 px-2 py-2 font-medium">Einheit</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Preis netto</th>
              <th className="w-36 px-2 py-2 text-right font-medium">Rabatt</th>
              <th className="w-20 px-2 py-2 text-right font-medium">USt</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Betrag</th>
              {istEntwurf && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center text-neutral-400">
                  Noch keine Positionen.
                </td>
              </tr>
            )}
            {items.map((it, i) => {
              const zeilenNetto = totals.zeilenNettoCent[i] ?? 0;
              return (
                <tr key={i} className="border-b border-neutral-100 align-top last:border-0">
                  <td className="px-2 py-2 text-neutral-400">{i + 1}</td>
                  <td className="px-2 py-2">
                    {istEntwurf ? (
                      <div className="space-y-1.5">
                        <ProduktComboInput
                          produkte={produkte.data ?? []}
                          value={it.bezeichnung}
                          onChange={(v) =>
                            setItems(
                              items.map((x, xi) =>
                                xi === i ? { ...x, bezeichnung: v } : x,
                              ),
                            )
                          }
                          onUebernehmen={async (p) => {
                            let preis: string | number | null = p.preisNetto;
                            if (r?.customerId) {
                              try {
                                const k = await utils.client.products.preisFuer.query({
                                  typ: "kunde",
                                  partnerId: r.customerId,
                                  productId: p.id,
                                });
                                preis = k.preisNetto;
                              } catch {
                                // Standardpreis als Fallback
                              }
                            }
                            setItems(
                              items.map((x, xi) =>
                                xi === i
                                  ? {
                                      ...x,
                                      bezeichnung: p.name,
                                      beschreibung: x.beschreibung || (p.beschreibung ?? ""),
                                      einheit: p.einheit ?? x.einheit,
                                      einzelpreis: new Intl.NumberFormat("de-DE", {
                                        minimumFractionDigits: 2,
                                      }).format(Number(preis ?? 0)),
                                      ustSatz: p.ustSatz ?? x.ustSatz,
                                    }
                                  : x,
                              ),
                            );
                          }}
                          placeholder="Bezeichnung — tippen sucht im Produktstamm"
                        />
                        <Textarea
                          value={it.beschreibung}
                          onChange={(e) =>
                            setItems(
                              items.map((x, xi) =>
                                xi === i ? { ...x, beschreibung: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="Beschreibungstext (optional, erscheint klein darunter)"
                          rows={2}
                          className="text-xs"
                        />
                      </div>
                    ) : (
                      <div>
                        <div className="font-medium">{it.bezeichnung}</div>
                        {it.beschreibung && (
                          <div className="mt-0.5 whitespace-pre-wrap text-xs text-neutral-500">
                            {it.beschreibung}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {istEntwurf ? (
                      <Input
                        className="text-right"
                        value={it.menge}
                        onChange={(e) =>
                          setItems(
                            items.map((x, xi) =>
                              xi === i ? { ...x, menge: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    ) : (
                      <span className="tabular-nums">{mengeFmt(it.menge)}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {istEntwurf ? (
                      <Select
                        value={it.einheit}
                        onValueChange={(v) =>
                          setItems(
                            items.map((x, xi) => (xi === i ? { ...x, einheit: v } : x)),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EINHEITEN.map((e) => (
                            <SelectItem key={e} value={e}>
                              {e}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      it.einheit
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {istEntwurf ? (
                      <Input
                        className="text-right"
                        value={it.einzelpreis}
                        onChange={(e) =>
                          setItems(
                            items.map((x, xi) =>
                              xi === i ? { ...x, einzelpreis: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder="0,00"
                      />
                    ) : (
                      <span className="tabular-nums">{geld(it.einzelpreis)}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {istEntwurf ? (
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          className="w-20 text-right"
                          value={it.rabattWert}
                          onChange={(e) =>
                            setItems(
                              items.map((x, xi) =>
                                xi === i ? { ...x, rabattWert: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="0"
                          disabled={!it.rabattArt}
                        />
                        <Select
                          value={it.rabattArt || "keiner"}
                          onValueChange={(v) =>
                            setItems(
                              items.map((x, xi) =>
                                xi === i
                                  ? { ...x, rabattArt: v === "keiner" ? "" : (v as "prozent" | "festwert") }
                                  : x,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="w-16"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="keiner">—</SelectItem>
                            <SelectItem value="prozent">%</SelectItem>
                            <SelectItem value="festwert">{waehrung}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      it.rabattArt && it.rabattWert ? (
                        <span className="tabular-nums text-neutral-500">
                          − {it.rabattWert} {it.rabattArt === "prozent" ? "%" : waehrung}
                        </span>
                      ) : (
                        "–"
                      )
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {istEntwurf ? (
                      <Select
                        value={String(it.ustSatz)}
                        onValueChange={(v) =>
                          setItems(
                            items.map((x, xi) =>
                              xi === i ? { ...x, ustSatz: Number(v) } : x,
                            ),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UST_SAETZE.map((s) => (
                            <SelectItem key={s} value={String(s)}>
                              {s} %
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      `${it.ustSatz} %`
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {geld(zeilenNetto / 100)}
                  </td>
                  {istEntwurf && (
                    <td className="px-2 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setItems(items.filter((_, xi) => xi !== i))}
                      >
                        <Trash2 className="h-4 w-4 text-neutral-400" />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        {/* ── Summen ── */}
        <div className="mt-5 flex justify-end">
          <div className="w-72 space-y-1.5 text-sm">
            {(totals.rabattPositionenCent > 0 || totals.hauptrabattCent > 0 || istEntwurf) && (
              <div className="flex justify-between text-neutral-500">
                <span>Zwischensumme (vor Rabatten)</span>
                <span className="tabular-nums">{geld(totals.zwischensummeCent / 100)}</span>
              </div>
            )}
            {totals.rabattPositionenCent > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Positionsrabatte</span>
                <span className="tabular-nums">− {geld(totals.rabattPositionenCent / 100)}</span>
              </div>
            )}
            {istEntwurf && (
              <div className="rounded-md border border-neutral-200 p-2">
                <div className="mb-1 text-xs text-neutral-500">Hauptrabatt (gesamte Rechnung)</div>
                <div className="flex items-center gap-1.5">
                  <Input
                    className="w-24 text-right"
                    value={kopf.hauptrabattWert}
                    onChange={(e) => setKopf({ ...kopf, hauptrabattWert: e.target.value })}
                    placeholder="0"
                    disabled={!kopf.hauptrabattArt}
                  />
                  <Select
                    value={kopf.hauptrabattArt || "keiner"}
                    onValueChange={(v) =>
                      setKopf({ ...kopf, hauptrabattArt: v === "keiner" ? "" : (v as "prozent" | "festwert") })
                    }
                  >
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keiner">—</SelectItem>
                      <SelectItem value="prozent">%</SelectItem>
                      <SelectItem value="festwert">{waehrung}</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="ml-1 flex items-center gap-1 text-xs text-neutral-500" title="An: Rabatte der Positionen und Hauptrabatt werden auf dieselbe Zwischensumme gerechnet (addiert). Aus: Hauptrabatt auf die bereits rabattierte Summe.">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={kopf.rabattAddieren}
                      onChange={(e) => setKopf({ ...kopf, rabattAddieren: e.target.checked })}
                    />
                    addieren
                  </label>
                </div>
              </div>
            )}
            {totals.hauptrabattCent > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Hauptrabatt{kopf.rabattAddieren ? " (additiv)" : ""}</span>
                <span className="tabular-nums">− {geld(totals.hauptrabattCent / 100)}</span>
              </div>
            )}
            <div className="flex justify-between text-neutral-600">
              <span>Netto{totals.rabattPositionenCent + totals.hauptrabattCent > 0 ? " nach Rabatten" : ""}</span>
              <span className="tabular-nums">{geld(totals.nettoCent / 100)}</span>
            </div>
            {totals.ustProSatz.map((u) => (
              <div key={u.satz} className="flex justify-between text-neutral-600">
                <span>
                  USt. {u.satz} % von {geld(u.basisCent / 100)}
                </span>
                <span className="tabular-nums">{geld(u.betragCent / 100)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-semibold">
              <span>Gesamt</span>
              <span className="tabular-nums">{geld(totals.bruttoCent / 100)}</span>
            </div>
            {r.status !== "entwurf" && (
              <>
                <div className="flex justify-between text-neutral-600">
                  <span>Bezahlt{ r.bezahltAm ? ` am ${datum(r.bezahltAm)}` : ""}</span>
                  <span className="tabular-nums">{geld(r.bezahltBetrag)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Offen</span>
                  <span className="tabular-nums">
                    {geld((totals.bruttoCent - Math.round(Number(r.bezahltBetrag) * 100)) / 100)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Bank-Zuordnung (v1.3) ── */}
      {r.status !== "entwurf" && <div className="mb-6"><BankZuordnung invoiceId={r.id} /></div>}

      {fehler && <p className="mb-4 text-sm text-red-600">{fehler}</p>}

      {istEntwurf && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={speichernKlick} disabled={speichern.isPending}>
            {speichern.isPending ? "Speichere …" : "Entwurf speichern"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={items.filter((i) => i.bezeichnung.trim()).length === 0}>
                Finalisieren &amp; Nummer vergeben
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rechnung finalisieren?</AlertDialogTitle>
                <AlertDialogDescription>
                  Der Entwurf wird gespeichert, die nächste Rechnungsnummer vergeben und
                  der Beleg eingefroren. Danach ist er GoBD-konform nicht mehr
                  veränderbar — Korrekturen nur noch per Gutschrift/Storno.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={speichernUndFinalisieren}>
                  Jetzt finalisieren
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* ── Zahlungsdialog ── */}
      <Dialog open={zahldialog} onOpenChange={setZahldialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Zahlung verbuchen</DialogTitle>
          </DialogHeader>
          <Label>Betrag (EUR)</Label>
          <Input value={zahlbetrag} onChange={(e) => setZahlbetrag(e.target.value)} />
          {bezahlt.error && <p className="text-sm text-red-600">{bezahlt.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setZahldialog(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={() =>
                bezahlt.mutate({ id: r.id, betrag: parseGeldInput(zahlbetrag || "0") })
              }
            >
              Verbuchen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── Adress-Übernahme-Dialog ── */}
      <Dialog open={adressDialog !== null} onOpenChange={() => setAdressDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adresse ins Kundenprofil übernehmen?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600">
            Die Empfängeradresse dieser Rechnung weicht vom Kundenstamm für{" "}
            <strong>{kunde.data?.name}</strong> ab. Soll die geänderte Adresse auch im
            Kundenprofil gespeichert werden oder nur für diese Rechnung gelten?
          </p>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button onClick={() => adressUebernahme(true)} disabled={kundenUpdate.isPending}>
              Ins Kundenprofil übernehmen
            </Button>
            <Button variant="outline" onClick={() => adressUebernahme(false)}>
              Nur für diese Rechnung
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    
      <SerieSpeichernDialog
        invoiceId={r.id}
        vorschlagTitel={`Serie ${r.kundeName}`}
        offen={serieOffen}
        onSchliessen={() => setSerieOffen(false)}
      />
    </div>
  );
}
