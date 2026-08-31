import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSortierung } from "@/lib/sortierung";
import { Input } from "@/components/ui/input";
import { datum } from "@/lib/format";
import { type InvoiceStatus } from "@contracts/invoicing";
import { statusBadge } from "./Invoices";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { CsvButton } from "@/components/CsvButton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus , Search, FileUp } from "lucide-react";

export default function DeliveryNotes() {
  const [neuDialog, setNeuDialog] = useState(false);
  const [kundenId, setKundenId] = useState<string>("");
  const navigate = useNavigate();

  const liste = trpc.deliveryNotes.list.useQuery();
  const kunden = trpc.customers.list.useQuery();
  const erstellen = trpc.deliveryNotes.createDraft.useMutation({
    onSuccess: (res) => navigate(`/lieferscheine/${res.id}`),
  });

  // ── NEM-Word-Import ──
  const [importOffen, setImportOffen] = useState(false);
  const [importDatei, setImportDatei] = useState<string>("");
  const vorschau = trpc.deliveryNotes.wordVorschau.useMutation();
  const anlegen = trpc.deliveryNotes.wordAnlegen.useMutation({
    onSuccess: (res) => {
      setImportOffen(false);
      vorschau.reset();
      setImportDatei("");
      navigate(`/lieferscheine/${res.id}`);
    },
  });
  const [importKunde, setImportKunde] = useState<string>("");

  const wordDateiLesen = (datei: File) => {
    const leser = new FileReader();
    leser.onload = () => {
      const roh = leser.result as string;
      const b64 = roh.slice(roh.indexOf(",") + 1);
      setImportDatei(datei.name);
      vorschau.mutate(
        { dateiBase64: b64 },
        { onSuccess: (d) => setImportKunde(d.kundeVorschlag ? String(d.kundeVorschlag.id) : "") },
      );
    };
    leser.readAsDataURL(datei);
  };

  const [q, setQ] = useState("");
  const sort = useSortierung<NonNullable<typeof liste.data>[number]>("datum");
  const gefiltert = (liste.data ?? []).filter(
    (l) => !q.trim() || (l.nummer ?? "").toLowerCase().includes(q.toLowerCase()) || l.kundeName.toLowerCase().includes(q.toLowerCase()) || (l.invoice?.nummer ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  const zeilen = sort.sortiere(gefiltert, (l, key) =>
    key === "nummer" ? l.nummer : key === "kunde" ? l.kundeName : key === "rechnung" ? l.invoice?.nummer
    : key === "datum" ? l.datum : key === "status" ? l.status : null,
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Lieferscheine</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/e-rechnungen?tab=lieferscheine">Eingangslieferscheine →</Link>
          </Button>
          <CsvButton
            dateiname="lieferscheine.csv"
            zeilen={[
              ["Nummer", "Kunde", "Zur Rechnung", "Datum", "Status"],
              ...(liste.data ?? []).map((l) => [
                l.nummer ?? `Entwurf #${l.id}`, l.kundeName,
                l.invoice?.nummer ?? "", l.datum, l.status,
              ]),
            ]}
          />
          <Button variant="outline" onClick={() => setImportOffen(true)}>
            <FileUp className="mr-1.5 h-4 w-4" /> NEM-Word-Import
          </Button>
          <Button onClick={() => setNeuDialog(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Neuer Lieferschein
          </Button>
        </div>
      </div>

            <div className="relative mb-3 max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen …" className="pl-8" />
      </div>
<div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
                <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("nummer")}>Nummer<sort.KopfIcon k="nummer" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("kunde")}>Kunde<sort.KopfIcon k="kunde" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("rechnung")}>Zur Rechnung<sort.KopfIcon k="rechnung" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("datum")}>Datum<sort.KopfIcon k="datum" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("status")}>Status<sort.KopfIcon k="status" /></th>
            </tr>
          </thead>
          <tbody>
            {(liste.data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                  Keine Lieferscheine vorhanden — direkt hier anlegen oder aus einer
                  Rechnung heraus erzeugen.
                </td>
              </tr>
            )}
            {zeilen.map((l) => (
              <tr key={l.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <Link
                    to={`/lieferscheine/${l.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {l.nummer ?? `Entwurf #${l.id}`}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-neutral-600">{l.kundeName}</td>
                <td className="px-4 py-2.5">
                  {l.invoice ? (
                    <Link
                      to={`/rechnungen/${l.invoiceId}`}
                      className="text-neutral-600 hover:underline"
                    >
                      {l.invoice.nummer ?? `#${l.invoiceId}`}
                    </Link>
                  ) : (
                    <span className="text-neutral-400">–</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-neutral-600">{datum(l.datum)}</td>
                <td className="px-4 py-2.5">{statusBadge(l.status as InvoiceStatus)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={neuDialog} onOpenChange={setNeuDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Neuer Lieferschein</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-500">
            Kunde auswählen — der Lieferschein wird als Entwurf angelegt.
          </p>
          <Select value={kundenId} onValueChange={setKundenId}>
            <SelectTrigger>
              <SelectValue placeholder="Kunde auswählen …" />
            </SelectTrigger>
            <SelectContent>
              {(kunden.data ?? []).map((k) => (
                <SelectItem key={k.id} value={String(k.id)}>
                  {k.name} — {k.plz} {k.ort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {erstellen.error && (
            <p className="text-sm text-red-600">{erstellen.error.message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNeuDialog(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={!kundenId || erstellen.isPending}
              onClick={() => erstellen.mutate({ customerId: Number(kundenId) })}
            >
              Entwurf anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NEM-Word-Import */}
      <Dialog open={importOffen} onOpenChange={setImportOffen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>NEM-Liste aus Word importieren</DialogTitle>
          </DialogHeader>
          {!vorschau.data && (
            <div>
              <p className="mb-3 text-sm text-neutral-500">
                Word-Datei (.docx) wählen — einheitliche Vorlage (Tabelle) oder alte
                Freitext-Liste. Erzeugt einen Lieferschein-Entwurf; Artikel werden
                automatisch dem Produktstamm zugeordnet.
              </p>
              <Input
                type="file"
                accept=".docx"
                onChange={(e) => e.target.files?.[0] && wordDateiLesen(e.target.files[0])}
              />
              {vorschau.isPending && <p className="mt-2 text-sm text-neutral-500">Analysiere …</p>}
              {vorschau.error && (
                <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{vorschau.error.message}</p>
              )}
            </div>
          )}
          {vorschau.data && (
            <div className="space-y-3">
              <p className="text-sm text-neutral-600">
                <strong>{importDatei}</strong> — {vorschau.data.positionen.length} Positionen
                {vorschau.data.phase ? ` · ${vorschau.data.phase}` : ""}
                {vorschau.data.datum ? ` · ${vorschau.data.datum}` : ""}
                {vorschau.data.format === "freitext" ? " · altes Freitext-Format erkannt" : ""}
              </p>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">Kunde</label>
                <Select value={importKunde} onValueChange={setImportKunde}>
                  <SelectTrigger>
                    <SelectValue placeholder="Kunde auswählen …" />
                  </SelectTrigger>
                  <SelectContent>
                    {(kunden.data ?? []).map((k) => (
                      <SelectItem key={k.id} value={String(k.id)}>
                        {k.name}
                        {vorschau.data.kundeVorschlag?.id === k.id ? " (erkannt)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-neutral-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                      <th className="px-3 py-2 font-medium">Position</th>
                      <th className="px-3 py-2 text-right font-medium">Menge</th>
                      <th className="px-3 py-2 text-right font-medium">Einzelpreis</th>
                      <th className="px-3 py-2 font-medium">Produktstamm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vorschau.data.positionen.map((p, i) => (
                      <tr key={i} className="border-b border-neutral-100 last:border-0">
                        <td className="px-3 py-1.5">{p.bezeichnung}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{p.menge}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {p.einzelpreis !== null ? p.einzelpreis.toFixed(2) + " €" : "–"}
                        </td>
                        <td className="px-3 py-1.5">
                          {p.produktId ? (
                            <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-800">
                              {p.produktName}
                            </span>
                          ) : (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">frei</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {anlegen.error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{anlegen.error.message}</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => { vorschau.reset(); setImportDatei(""); }}>
                  Andere Datei
                </Button>
                <Button
                  disabled={!importKunde || anlegen.isPending}
                  onClick={() => {
                    const d = vorschau.data!;
                    anlegen.mutate({
                      customerId: Number(importKunde),
                      datum: new Date().toISOString().slice(0, 10),
                      phase: d.phase ?? undefined,
                      dokName: d.name ?? undefined,
                      dateiname: importDatei,
                      items: d.positionen.map((p) => ({
                        bezeichnung: p.bezeichnung,
                        menge: String(p.menge),
                        einheit: "Packung",
                      })),
                    });
                  }}
                >
                  {anlegen.isPending ? "Lege an …" : "Lieferschein-Entwurf anlegen"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
