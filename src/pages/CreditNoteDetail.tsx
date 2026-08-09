import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { geld, datum, parseGeldInput, parseMengeInput, mengeFmt } from "@/lib/format";
import { computeTotals, EINHEITEN, UST_SAETZE } from "@contracts/invoicing";
import { Badge } from "@/components/ui/badge";
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
import { MailDialog } from "@/components/MailDialog";

interface EditItem {
  bezeichnung: string;
  beschreibung: string;
  menge: string;
  einheit: string;
  einzelpreis: string;
  ustSatz: number;
}

export default function CreditNoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const gutschrift = trpc.creditNotes.get.useQuery({ id: Number(id) });

  const [datumFeld, setDatumFeld] = useState("");
  const [grund, setGrund] = useState("");
  const [items, setItems] = useState<EditItem[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState("");

  const g = gutschrift.data;
  const istEntwurf = g?.status === "entwurf";

  useEffect(() => {
    if (!g || geladen) return;
    setDatumFeld(g.datum);
    setGrund(g.grund ?? "");
    setItems(
      g.items.map((it) => ({
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
  }, [g, geladen]);

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
    utils.creditNotes.get.invalidate({ id: Number(id) });
    utils.creditNotes.list.invalidate();
    utils.invoices.list.invalidate();
    utils.dashboard.stats.invalidate();
  };

  const speichern = trpc.creditNotes.updateDraft.useMutation({ onSuccess: inval });
  const finalisieren = trpc.creditNotes.finalize.useMutation({ onSuccess: inval });
  const loeschen = trpc.creditNotes.delete.useMutation({
    onSuccess: () => navigate("/gutschriften"),
  });

  if (gutschrift.isLoading || !geladen) {
    return <p className="text-sm text-neutral-500">Lade …</p>;
  }
  if (!g) return <p className="text-sm text-red-600">Gutschrift nicht gefunden.</p>;

  const bauePayload = () => ({
    id: g.id,
    kopf: {
      datum: datumFeld,
      grund: grund || null,
      kundeName: g.kundeName,
      kundeZusatz: g.kundeZusatz || null,
      kundeStrasse: g.kundeStrasse,
      kundePlz: g.kundePlz,
      kundeOrt: g.kundeOrt,
      kundeLand: g.kundeLand,
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

  const speichernUndFinalisieren = async () => {
    setFehler("");
    try {
      await speichern.mutateAsync(bauePayload());
      await finalisieren.mutateAsync({ id: g.id });
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Fehler beim Finalisieren");
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/gutschriften")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            {g.nummer ?? `Gutschriftsentwurf #${g.id}`}
          </h1>
          <Badge variant={g.status === "finalisiert" ? "default" : "secondary"}>
            {g.status === "finalisiert" ? "Finalisiert" : "Entwurf"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <PdfButton art="credit" id={g.id} />
          <PdfVorschau art="credit" id={g.id} titel={`Gutschrift ${g.nummer ?? ''}`} />
          <MailDialog art="credit" id={g.id} />
          {istEntwurf && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Gutschriftsentwurf löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Nur Entwürfe können gelöscht werden — die zugehörige Rechnung
                    bleibt davon unberührt.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={() => loeschen.mutate({ id: g.id })}>
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
            <div className="mt-1 font-medium">{g.kundeName}</div>
            <div className="text-neutral-600">
              {g.kundeStrasse}, {g.kundePlz} {g.kundeOrt}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Bezieht sich auf</div>
            <div className="mt-1">
              <Link to={`/rechnungen/${g.invoiceId}`} className="font-medium underline">
                Rechnung {g.invoice.nummer ?? `#${g.invoiceId}`}
              </Link>{" "}
              <span className="text-neutral-600">
                vom {datum(g.invoice.rechnungsdatum)}
              </span>
            </div>
          </div>
          <div>
            <Label>Gutschriftsdatum</Label>
            {istEntwurf ? (
              <Input
                type="date"
                value={datumFeld}
                onChange={(e) => setDatumFeld(e.target.value)}
              />
            ) : (
              <div className="mt-1">{datum(g.datum)}</div>
            )}
          </div>
        </div>
        <div className="mt-4">
          <Label>Grund / Anmerkung (optional)</Label>
          {istEntwurf ? (
            <Textarea value={grund} onChange={(e) => setGrund(e.target.value)} rows={2} />
          ) : (
            <div className="mt-1 text-sm">{g.grund || "–"}</div>
          )}
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-neutral-700">Positionen</h2>
          {istEntwurf && (
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
              <Plus className="mr-1 h-4 w-4" /> Position
            </Button>
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
              <span>Gutschriftbetrag</span>
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
                Finalisieren &amp; ST-Nummer vergeben
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Gutschrift finalisieren?</AlertDialogTitle>
                <AlertDialogDescription>
                  Die Gutschrift erhält die nächste ST-Nummer und wird eingefroren.
                  Deckt sie den vollen Rechnungsbetrag ab, wird die zugehörige
                  Rechnung als storniert markiert.
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
