import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { geld, datum, parseGeldInput, parseMengeInput, mengeFmt } from "@/lib/format";
import { computeTotals, EINHEITEN, UST_SAETZE } from "@contracts/invoicing";
import { offerStatusBadge } from "./Offers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ProduktPicker } from "@/components/ProduktSuche";
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
import { ArrowLeft, Plus, Trash2, FileCheck2 } from "lucide-react";
import { PdfButton } from "@/components/PdfButton";
import { PdfVorschau } from "@/components/PdfVorschau";
import { MailDialog } from "@/components/MailDialog";

interface EditItem {
  bezeichnung: string;
  beschreibung: string;
  menge: string;
  einheit: string;
  einzelpreis: string;
  ustSatz: number;
}

interface EditKopf {
  datum: string;
  gueltigBis: string;
  kundeName: string;
  kundeZusatz: string;
  kundeStrasse: string;
  kundePlz: string;
  kundeOrt: string;
  kundeLand: string;
  pdfNotiz: string;
  bemerkung: string;
}

export default function OfferDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const angebot = trpc.offers.get.useQuery({ id: Number(id) });
  const produkte = trpc.products.list.useQuery();
  const kunden = trpc.customers.list.useQuery();

  const [kopf, setKopf] = useState<EditKopf | null>(null);
  const [items, setItems] = useState<EditItem[]>([]);
  const [fehler, setFehler] = useState<string>("");

  const a = angebot.data;
  const istEntwurf = a?.status === "entwurf";

  useEffect(() => {
    if (!a || kopf) return;
    setKopf({
      datum: a.datum,
      gueltigBis: a.gueltigBis ?? "",
      kundeName: a.kundeName,
      kundeZusatz: a.kundeZusatz ?? "",
      kundeStrasse: a.kundeStrasse,
      kundePlz: a.kundePlz,
      kundeOrt: a.kundeOrt,
      kundeLand: a.kundeLand,
      pdfNotiz: a.pdfNotiz ?? "",
      bemerkung: a.bemerkung ?? "",
    });
    setItems(
      a.items.map((it) => ({
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
      })),
    );
  }, [a, kopf]);

  const totals = useMemo(
    () =>
      computeTotals(
        items.map((it) => ({
          menge: parseMengeInput(it.menge || "0"),
          einzelpreis: parseGeldInput(it.einzelpreis || "0"),
          ustSatz: it.ustSatz,
        })),
      ),
    [items],
  );

  const inval = () => {
    utils.offers.get.invalidate({ id: Number(id) });
    utils.offers.list.invalidate();
  };

  const speichern = trpc.offers.updateDraft.useMutation({ onSuccess: inval });
  const finalisieren = trpc.offers.finalize.useMutation({ onSuccess: inval });
  const loeschen = trpc.offers.delete.useMutation({
    onSuccess: () => navigate("/angebote"),
  });
  const storno = trpc.offers.stornieren.useMutation({ onSuccess: inval });
  const setStatus = trpc.offers.setStatus.useMutation({ onSuccess: inval });
  const [finDialog, setFinDialog] = useState(false);
  const [fensterWahl, setFensterWahl] = useState<string>("14");
  const [fensterCustom, setFensterCustom] = useState<string>("");
  const umwandeln = trpc.offers.umwandeln.useMutation({
    onSuccess: (res) => navigate(`/rechnungen/${res.invoiceId}`),
  });

  if (angebot.isLoading || !kopf) {
    return <p className="text-sm text-neutral-500">Lade …</p>;
  }
  if (!a) return <p className="text-sm text-red-600">Angebot nicht gefunden.</p>;

  const bauePayload = () => ({
    id: a.id,
    kopf: {
      customerId: a.customerId,
      datum: kopf.datum,
      gueltigBis: kopf.gueltigBis || null,
      kundeName: kopf.kundeName,
      kundeZusatz: kopf.kundeZusatz || null,
      kundeStrasse: kopf.kundeStrasse,
      kundePlz: kopf.kundePlz,
      kundeOrt: kopf.kundeOrt,
      kundeLand: kopf.kundeLand || "Deutschland",
      pdfNotiz: kopf.pdfNotiz || null,
      bemerkung: kopf.bemerkung || null,
    },
    items: items
      .filter((it) => it.bezeichnung.trim())
      .map((it) => ({
        bezeichnung: it.bezeichnung,
        beschreibung: it.beschreibung || null,
        menge: parseMengeInput(it.menge || "0"),
        einheit: it.einheit,
        einzelpreis: parseGeldInput(it.einzelpreis || "0"),
        ustSatz: it.ustSatz,
      })),
  });

  const speichernKlick = () => {
    setFehler("");
    speichern.mutate(bauePayload(), { onError: (e) => setFehler(e.message) });
  };

  const speichernUndFinalisieren = async () => {
    setFehler("");
    const tage = fensterWahl === "custom" ? Number(fensterCustom) : Number(fensterWahl);
    try {
      await speichern.mutateAsync(bauePayload());
      await finalisieren.mutateAsync({
        id: a.id,
        gueltigTage: Number.isFinite(tage) && tage > 0 ? tage : undefined,
      });
      setFinDialog(false);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Fehler beim Finalisieren");
    }
  };

  const produktUebernehmen = async (produktId: string) => {
    const p = (produkte.data ?? []).find((x) => x.id === Number(produktId));
    if (!p) return;
    let __PREIS__ = p.preisNetto;
    const __PARTNER__ = a?.customerId;
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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/angebote")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            {a.nummer ?? `Angebotsentwurf #${a.id}`}
          </h1>
          {offerStatusBadge(a)}
        </div>
        <div className="flex items-center gap-2">
          <PdfButton art="offer" id={a.id} />
          <PdfVorschau art="offer" id={a.id} titel={`Angebot ${a.nummer ?? 'Entwurf'}`} />
          <MailDialog art="offer" id={a.id} />
          {(a.status === "offen" || a.status === "bestaetigt" || a.status === "abgelehnt") && (
            <>
              {a.status !== "bestaetigt" && (
                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => setStatus.mutate({ id: a.id, status: "bestaetigt" })}>
                  Kunde bestätigt
                </Button>
              )}
              {a.status !== "abgelehnt" && (
                <Button variant="outline" size="sm" onClick={() => setStatus.mutate({ id: a.id, status: "abgelehnt" })}>
                  Abgelehnt
                </Button>
              )}
              {a.status !== "offen" && (
                <Button variant="ghost" size="sm" onClick={() => setStatus.mutate({ id: a.id, status: "offen" })}>
                  Zurück auf offen
                </Button>
              )}
            </>
          )}
          {(a.status === "offen" || a.status === "bestaetigt") && !a.convertedInvoiceId && (
            <>
              <Button size="sm" onClick={() => umwandeln.mutate({ id: a.id })} disabled={umwandeln.isPending}>
                <FileCheck2 className="mr-1.5 h-4 w-4" /> In Rechnung umwandeln
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm">Stornieren</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Angebot stornieren?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Das Angebot bleibt mit Nummer {a.nummer} als „storniert“ gespeichert.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction onClick={() => storno.mutate({ id: a.id })}>
                      Stornieren
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {a.convertedInvoiceId && (
            <Link to={`/rechnungen/${a.convertedInvoiceId}`}>
              <Button variant="outline" size="sm">Zur erstellten Rechnung</Button>
            </Link>
          )}
          {istEntwurf && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Trash2 className="mr-1.5 h-4 w-4" /> Löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Entwurf löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Der Entwurf wird endgültig gelöscht.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={() => loeschen.mutate({ id: a.id })}>
                    Löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {a.status === "umgewandelt" && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Dieses Angebot wurde in eine Rechnung umgewandelt.{" "}
          <Link to={`/rechnungen/${a.convertedInvoiceId}`} className="underline">
            Rechnung öffnen
          </Link>
        </div>
      )}
      {a.status === "storniert" && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Dieses Angebot wurde storniert.
        </div>
      )}

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
              <Label>Name / Firma *</Label>
              {istEntwurf ? (
                <Input
                  value={kopf.kundeName}
                  onChange={(e) => setKopf({ ...kopf, kundeName: e.target.value })}
                />
              ) : (
                <div className="mt-1 text-sm font-medium">{a.kundeName}</div>
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
                <div className="mt-1 text-sm">{a.kundeZusatz || "–"}</div>
              )}
            </div>
            <div>
              <Label>Straße *</Label>
              {istEntwurf ? (
                <Input
                  value={kopf.kundeStrasse}
                  onChange={(e) => setKopf({ ...kopf, kundeStrasse: e.target.value })}
                />
              ) : (
                <div className="mt-1 text-sm">{a.kundeStrasse}</div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <Label>PLZ *</Label>
                {istEntwurf ? (
                  <Input
                    value={kopf.kundePlz}
                    onChange={(e) => setKopf({ ...kopf, kundePlz: e.target.value })}
                  />
                ) : (
                  <div className="mt-1 text-sm">{a.kundePlz}</div>
                )}
              </div>
              <div className="col-span-2">
                <Label>Ort *</Label>
                {istEntwurf ? (
                  <Input
                    value={kopf.kundeOrt}
                    onChange={(e) => setKopf({ ...kopf, kundeOrt: e.target.value })}
                  />
                ) : (
                  <div className="mt-1 text-sm">{a.kundeOrt}</div>
                )}
              </div>
            </div>
            <div>
              <Label>Land</Label>
              {istEntwurf ? (
                <Input
                  value={kopf.kundeLand}
                  onChange={(e) => setKopf({ ...kopf, kundeLand: e.target.value })}
                />
              ) : (
                <div className="mt-1 text-sm">{a.kundeLand}</div>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <Label>Angebotsdatum</Label>
              {istEntwurf ? (
                <Input
                  type="date"
                  value={kopf.datum}
                  onChange={(e) => setKopf({ ...kopf, datum: e.target.value })}
                />
              ) : (
                <div className="mt-1 text-sm">{datum(a.datum)}</div>
              )}
            </div>
            <div>
              <Label>Gültig bis (optional)</Label>
              {istEntwurf ? (
                <Input
                  type="date"
                  value={kopf.gueltigBis}
                  onChange={(e) => setKopf({ ...kopf, gueltigBis: e.target.value })}
                />
              ) : (
                <div className="mt-1 text-sm">
                  {a.gueltigBis ? datum(a.gueltigBis) : "–"}
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
                />
              ) : (
                <div className="mt-1 whitespace-pre-wrap text-sm">{a.pdfNotiz || "–"}</div>
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
                <div className="mt-1 text-sm">{a.bemerkung || "–"}</div>
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
              <ProduktPicker produkte={produkte.data ?? []} onPick={(p) => produktUebernehmen(String(p.id))} />
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
                        <Input
                          value={it.bezeichnung}
                          onChange={(e) =>
                            setItems(
                              items.map((x, xi) =>
                                xi === i ? { ...x, bezeichnung: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="Bezeichnung"
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
                          placeholder="Beschreibungstext (optional)"
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
                  <td className="px-2 py-2 text-right">
                    <span className="tabular-nums">{geld(zeilenNetto / 100)}</span>
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

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between text-neutral-600">
              <span>Zwischensumme</span>
              <span className="tabular-nums">{geld(totals.nettoCent / 100)}</span>
            </div>
            {totals.ustProSatz.map((u) => (
              <div key={u.satz} className="flex justify-between text-neutral-600">
                <span>USt. {u.satz} %</span>
                <span className="tabular-nums">{geld(u.betragCent / 100)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold">
              <span>Angebotssumme</span>
              <span className="tabular-nums">{geld(totals.bruttoCent / 100)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Aktionen unten ── */}
      {istEntwurf && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-red-600">{fehler}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={speichernKlick} disabled={speichern.isPending}>
              Entwurf speichern
            </Button>
            <Button onClick={() => setFinDialog(true)} disabled={speichern.isPending}>
              Finalisieren &amp; versenden
            </Button>
          </div>
        </div>
      )}
      {/* Finalisieren: Angebotszeitfenster wählen */}
      <Dialog open={finDialog} onOpenChange={setFinDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Angebot finalisieren &amp; versenden</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-500">
            Status wird „Offen“ (= an den Kunden versendet). Gültigkeitsfenster wählen:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { w: "7", l: "Klein (7 Tage)" },
              { w: "14", l: "Mittel (14 Tage)" },
              { w: "30", l: "Groß (30 Tage)" },
            ].map((o) => (
              <Button
                key={o.w}
                type="button"
                variant={fensterWahl === o.w ? "default" : "outline"}
                size="sm"
                onClick={() => setFensterWahl(o.w)}
              >
                {o.l}
              </Button>
            ))}
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant={fensterWahl === "custom" ? "default" : "outline"}
                size="sm"
                onClick={() => setFensterWahl("custom")}
              >
                Eigene:
              </Button>
              <Input
                className="w-20"
                value={fensterCustom}
                onChange={(e) => { setFensterCustom(e.target.value); setFensterWahl("custom"); }}
                placeholder="Tage"
                inputMode="numeric"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinDialog(false)}>Abbrechen</Button>
            <Button
              onClick={speichernUndFinalisieren}
              disabled={speichern.isPending || (fensterWahl === "custom" && (!Number(fensterCustom) || Number(fensterCustom) < 1))}
            >
              Finalisieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
