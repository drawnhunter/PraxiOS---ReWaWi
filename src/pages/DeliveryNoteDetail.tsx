import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { datum, parseMengeInput, mengeFmt } from "@/lib/format";
import { EINHEITEN, type InvoiceStatus } from "@contracts/invoicing";
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
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { PdfButton } from "@/components/PdfButton";
import { PdfVorschau } from "@/components/PdfVorschau";

interface EditItem {
  bezeichnung: string;
  beschreibung: string;
  menge: string;
  einheit: string;
}

export default function DeliveryNoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const lieferschein = trpc.deliveryNotes.get.useQuery({ id: Number(id) });
  const rechnungen = trpc.invoices.list.useQuery({ status: "finalisiert" });
  const produkte = trpc.products.list.useQuery();

  const [datumFeld, setDatumFeld] = useState("");
  const [rechnungId, setRechnungId] = useState<string>("keine");
  const [pdfNotiz, setPdfNotiz] = useState("");
  const [bemerkung, setBemerkung] = useState("");
  const [items, setItems] = useState<EditItem[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState("");

  const l = lieferschein.data;
  const istEntwurf = l?.status === "entwurf";

  useEffect(() => {
    if (!l || geladen) return;
    setDatumFeld(l.datum);
    setRechnungId(l.invoiceId ? String(l.invoiceId) : "keine");
    setPdfNotiz(l.pdfNotiz ?? "");
    setBemerkung(l.bemerkung ?? "");
    setItems(
      l.items.map((it) => ({
        bezeichnung: it.bezeichnung,
        beschreibung: it.beschreibung ?? "",
        menge: new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(
          Number(it.menge),
        ),
        einheit: it.einheit,
      })),
    );
    setGeladen(true);
  }, [l, geladen]);

  const inval = () => {
    utils.deliveryNotes.get.invalidate({ id: Number(id) });
    utils.deliveryNotes.list.invalidate();
  };

  const speichern = trpc.deliveryNotes.updateDraft.useMutation({ onSuccess: inval });
  const finalisieren = trpc.deliveryNotes.finalize.useMutation({ onSuccess: inval });
  const stornieren = trpc.deliveryNotes.stornieren.useMutation({ onSuccess: inval });
  const loeschen = trpc.deliveryNotes.delete.useMutation({
    onSuccess: () => navigate("/lieferscheine"),
  });

  if (lieferschein.isLoading || !geladen) {
    return <p className="text-sm text-neutral-500">Lade …</p>;
  }
  if (!l) return <p className="text-sm text-red-600">Lieferschein nicht gefunden.</p>;

  const bauePayload = () => ({
    id: l.id,
    kopf: {
      datum: datumFeld,
      invoiceId: rechnungId === "keine" ? null : Number(rechnungId),
      kundeName: l.kundeName,
      kundeZusatz: l.kundeZusatz || null,
      kundeStrasse: l.kundeStrasse,
      kundePlz: l.kundePlz,
      kundeOrt: l.kundeOrt,
      kundeLand: l.kundeLand,
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
      })),
  });

  const speichernUndFinalisieren = async () => {
    setFehler("");
    try {
      await speichern.mutateAsync(bauePayload());
      await finalisieren.mutateAsync({ id: l.id });
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Fehler beim Finalisieren");
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/lieferscheine")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            {l.nummer ?? `Lieferscheinentwurf #${l.id}`}
          </h1>
          {statusBadge(l.status as InvoiceStatus)}
        </div>
        <div className="flex items-center gap-2">
          <PdfButton art="delivery" id={l.id} />
          <PdfVorschau art="delivery" id={l.id} titel={`Lieferschein ${l.nummer ?? ''}`} />
          {l.status === "finalisiert" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Stornieren
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Lieferschein stornieren?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Der Lieferschein wird als storniert markiert und bleibt
                    dokumentiert. Eine zugehörige Rechnung ist davon nicht betroffen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={() => stornieren.mutate({ id: l.id })}>
                    Stornieren
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
                    Nur Entwürfe können gelöscht werden — es wurde noch keine Nummer
                    vergeben.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={() => loeschen.mutate({ id: l.id })}>
                    Löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-neutral-500">Empfänger</div>
            <div className="mt-1 font-medium">{l.kundeName}</div>
            <div className="text-neutral-600">
              {l.kundeStrasse}, {l.kundePlz} {l.kundeOrt}
            </div>
          </div>
          <div>
            <Label>Lieferdatum</Label>
            {istEntwurf ? (
              <Input
                type="date"
                value={datumFeld}
                onChange={(e) => setDatumFeld(e.target.value)}
              />
            ) : (
              <div className="mt-1">{datum(l.datum)}</div>
            )}
          </div>
          <div>
            <Label>Bezug zu Rechnung (optional)</Label>
            {istEntwurf ? (
              <Select value={rechnungId} onValueChange={setRechnungId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keine">Kein Bezug</SelectItem>
                  {(rechnungen.data ?? [])
                    .filter((r) => r.customerId === l.customerId)
                    .map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.nummer} vom {datum(r.rechnungsdatum)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="mt-1">
                {l.invoice ? (
                  <Link to={`/rechnungen/${l.invoiceId}`} className="underline">
                    {l.invoice.nummer}
                  </Link>
                ) : (
                  "–"
                )}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Bemerkung auf dem Lieferschein (erscheint auf dem PDF)</Label>
            {istEntwurf ? (
              <Textarea
                value={pdfNotiz}
                onChange={(e) => setPdfNotiz(e.target.value)}
                rows={2}
                placeholder="z. B. Lieferhinweise, Ablageort …"
              />
            ) : (
              <div className="mt-1 whitespace-pre-wrap text-sm">{l.pdfNotiz || "–"}</div>
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
              <div className="mt-1 text-sm">{l.bemerkung || "–"}</div>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-neutral-700">
            Positionen <span className="font-normal text-neutral-400">(ohne Preise)</span>
          </h2>
          {istEntwurf && (
            <div className="flex items-center gap-2">
              <ProduktPicker
                produkte={produkte.data ?? []}
                onPick={(p) =>
                  setItems([
                    ...items,
                    {
                      bezeichnung: p.name,
                      beschreibung: p.beschreibung ?? "",
                      menge: "1",
                      einheit: p.einheit ?? "Stück",
                    },
                  ])
                }
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setItems([
                    ...items,
                    { bezeichnung: "", beschreibung: "", menge: "1", einheit: "Stück" },
                  ])
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Position
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
              {istEntwurf && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-neutral-400">
                  Noch keine Positionen.
                </td>
              </tr>
            )}
            {items.map((it, i) => (
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
                        onUebernehmen={(p) =>
                          setItems(
                            items.map((x, xi) =>
                              xi === i
                                ? {
                                    ...x,
                                    bezeichnung: p.name,
                                    beschreibung: x.beschreibung || (p.beschreibung ?? ""),
                                    einheit: p.einheit ?? x.einheit,
                                  }
                                : x,
                            ),
                          )
                        }
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
            ))}
          </tbody>
        </table>
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
                Finalisieren &amp; Nummer vergeben
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Lieferschein finalisieren?</AlertDialogTitle>
                <AlertDialogDescription>
                  Der Entwurf wird gespeichert, die nächste Lieferscheinnummer vergeben
                  und der Beleg eingefroren. Danach nur noch stornierbar.
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
    </div>
  );
}
