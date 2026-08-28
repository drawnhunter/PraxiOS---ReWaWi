import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { geld, datum, parseGeldInput, parseMengeInput, mengeFmt } from "@/lib/format";
import { computeTotals, EINHEITEN, UST_SAETZE } from "@contracts/invoicing";
import { poStatusBadge } from "./PurchaseOrders";
import { Button } from "@/components/ui/button";
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
import { ArrowLeft, Plus, Trash2, Send, PackageCheck, Package } from "lucide-react";
import { PdfButton } from "@/components/PdfButton";
import { PdfVorschau } from "@/components/PdfVorschau";

interface EditItem {
  bezeichnung: string;
  beschreibung: string;
  menge: string;
  einheit: string;
  einzelpreis: string;
  ustSatz: number;
}

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const bestellung = trpc.purchaseOrders.get.useQuery({ id: Number(id) });
  const produkte = trpc.products.list.useQuery();

  const [bestelldatum, setBestelldatum] = useState("");
  const [lieferdatum, setLieferdatum] = useState("");
  const [pdfNotiz, setPdfNotiz] = useState("");
  const [bemerkung, setBemerkung] = useState("");
  const [items, setItems] = useState<EditItem[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState("");

  const b = bestellung.data;
  const istEntwurf = b?.status === "entwurf";

  useEffect(() => {
    if (!b || geladen) return;
    setBestelldatum(b.bestelldatum);
    setLieferdatum(b.lieferdatum ?? "");
    setPdfNotiz(b.pdfNotiz ?? "");
    setBemerkung(b.bemerkung ?? "");
    setItems(
      b.items.map((it) => ({
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
    setGeladen(true);
  }, [b, geladen]);

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
    utils.purchaseOrders.get.invalidate({ id: Number(id) });
    utils.purchaseOrders.list.invalidate();
  };

  const speichern = trpc.purchaseOrders.updateDraft.useMutation({ onSuccess: inval });
  const abschicken = trpc.purchaseOrders.bestellen.useMutation({ onSuccess: inval });
  const lieferstatus = trpc.purchaseOrders.setLieferstatus.useMutation({ onSuccess: inval });
  const stornieren = trpc.purchaseOrders.stornieren.useMutation({ onSuccess: inval });
  const loeschen = trpc.purchaseOrders.delete.useMutation({
    onSuccess: () => navigate("/bestellungen"),
  });

  if (bestellung.isLoading || !geladen) {
    return <p className="text-sm text-neutral-500">Lade …</p>;
  }
  if (!b) return <p className="text-sm text-red-600">Bestellung nicht gefunden.</p>;

  const bauePayload = () => ({
    id: b.id,
    kopf: {
      supplierId: b.supplierId,
      bestelldatum,
      lieferdatum: lieferdatum || null,
      lieferantName: b.lieferantName,
      lieferantZusatz: b.lieferantZusatz || null,
      lieferantStrasse: b.lieferantStrasse,
      lieferantPlz: b.lieferantPlz,
      lieferantOrt: b.lieferantOrt,
      lieferantLand: b.lieferantLand,
      pdfNotiz: pdfNotiz || null,
      bemerkung: bemerkung || null,
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

  const speichernUndAbschicken = async () => {
    setFehler("");
    try {
      await speichern.mutateAsync(bauePayload());
      await abschicken.mutateAsync({ id: b.id });
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Fehler beim Abschicken");
    }
  };

  const produktUebernehmen = async (produktId: string) => {
    const p = (produkte.data ?? []).find((x) => x.id === Number(produktId));
    if (!p) return;
    let __PREIS__ = p.preisNetto;
    const __PARTNER__ = b?.supplierId;
    if (__PARTNER__) {
      try {
        const r = await utils.client.products.preisFuer.query({
          typ: "lieferant",
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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/bestellungen")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            {b.nummer ?? `Bestellentwurf #${b.id}`}
          </h1>
          {poStatusBadge(b.status)}
        </div>
        <div className="flex items-center gap-2">
          <PdfButton art="order" id={b.id} />
          <PdfVorschau art="order" id={b.id} titel={`Bestellung ${b.nummer ?? 'Entwurf'}`} />
          {(b.status === "bestellt" || b.status === "teilgeliefert") && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => lieferstatus.mutate({ id: b.id, status: "teilgeliefert" })}
              >
                <Package className="mr-1.5 h-4 w-4" /> Teillieferung
              </Button>
              <Button
                size="sm"
                onClick={() => lieferstatus.mutate({ id: b.id, status: "geliefert" })}
              >
                <PackageCheck className="mr-1.5 h-4 w-4" /> Komplett geliefert
              </Button>
            </>
          )}
          {(b.status === "bestellt" || b.status === "teilgeliefert" || istEntwurf) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  {istEntwurf ? <Trash2 className="h-4 w-4" /> : "Stornieren"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {istEntwurf ? "Entwurf löschen?" : "Bestellung stornieren?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {istEntwurf
                      ? "Der Entwurf wird gelöscht. Es wurde noch keine Bestellnummer vergeben."
                      : "Die Bestellung wird als storniert markiert und bleibt dokumentiert."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      istEntwurf
                        ? loeschen.mutate({ id: b.id })
                        : stornieren.mutate({ id: b.id })
                    }
                  >
                    {istEntwurf ? "Löschen" : "Stornieren"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-700">Lieferant &amp; Belegdaten</h2>
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-neutral-500">Lieferant</div>
            <div className="mt-1 font-medium">{b.lieferantName}</div>
            {b.lieferantZusatz && <div className="text-neutral-600">{b.lieferantZusatz}</div>}
            <div className="text-neutral-600">
              {b.lieferantStrasse}, {b.lieferantPlz} {b.lieferantOrt}
            </div>
          </div>
          <div>
            <Label>Bestelldatum</Label>
            {istEntwurf ? (
              <Input
                type="date"
                value={bestelldatum}
                onChange={(e) => setBestelldatum(e.target.value)}
              />
            ) : (
              <div className="mt-1">{datum(b.bestelldatum)}</div>
            )}
          </div>
          <div>
            <Label>Gewünschtes Lieferdatum</Label>
            {istEntwurf ? (
              <Input
                type="date"
                value={lieferdatum}
                onChange={(e) => setLieferdatum(e.target.value)}
              />
            ) : (
              <div className="mt-1">{datum(b.lieferdatum)}</div>
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Bemerkung auf der Bestellung (erscheint auf dem PDF)</Label>
            {istEntwurf ? (
              <Textarea
                value={pdfNotiz}
                onChange={(e) => setPdfNotiz(e.target.value)}
                rows={2}
                placeholder="z. B. Expressversand erwünscht, Lieferhinweise …"
              />
            ) : (
              <div className="mt-1 whitespace-pre-wrap text-sm">{b.pdfNotiz || "–"}</div>
            )}
          </div>
          <div>
            <Label>Interne Bemerkung (nicht auf dem PDF)</Label>
            {istEntwurf ? (
              <Textarea
                value={bemerkung}
                onChange={(e) => setBemerkung(e.target.value)}
                rows={2}
              />
            ) : (
              <div className="mt-1 text-sm">{b.bemerkung || "–"}</div>
            )}
          </div>
        </div>
        {b.geliefertAm && (
          <div className="mt-3 text-sm text-green-700">
            Geliefert am {datum(b.geliefertAm)}
          </div>
        )}
      </div>

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

        <div className="mt-5 flex justify-end">
          <div className="w-72 space-y-1.5 text-sm">
            <div className="flex justify-between text-neutral-600">
              <span>Zwischensumme ohne USt.</span>
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
              <span>Bestellsumme</span>
              <span className="tabular-nums">{geld(totals.bruttoCent / 100)}</span>
            </div>
          </div>
        </div>
      </div>

      {fehler && <p className="mb-4 text-sm text-red-600">{fehler}</p>}

      {istEntwurf && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() =>
              speichern.mutate(bauePayload(), { onError: (e) => setFehler(e.message) })
            }
            disabled={speichern.isPending}
          >
            Entwurf speichern
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={items.filter((i) => i.bezeichnung.trim()).length === 0}>
                <Send className="mr-1.5 h-4 w-4" /> Abschicken &amp; Nummer vergeben
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Bestellung abschicken?</AlertDialogTitle>
                <AlertDialogDescription>
                  Der Entwurf wird gespeichert, die nächste Bestellnummer vergeben und
                  die Bestellung eingefroren. Das PDF kann danach an den Lieferanten
                  versendet werden.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={speichernUndAbschicken}>
                  Jetzt abschicken
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
