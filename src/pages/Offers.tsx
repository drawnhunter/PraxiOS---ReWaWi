import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSortierung } from "@/lib/sortierung";
import { datum, geld } from "@/lib/format";
import { OFFER_ANZEIGE_LABELS, offerAnzeigeStatus, type OfferStatus } from "@contracts/invoicing";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CsvButton } from "@/components/CsvButton";
import { deZahl } from "@/lib/downloads";
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
import { Plus , Search } from "lucide-react";

export function offerStatusBadge(a: { status: OfferStatus; gueltigBis?: string | null }) {
  const anzeige = offerAnzeigeStatus(a);
  const variant =
    anzeige === "bestaetigt" || anzeige === "umgewandelt"
      ? "default"
      : anzeige === "abgelehnt" || anzeige === "storniert"
        ? "destructive"
        : anzeige === "verstrichen"
          ? "outline"
          : "secondary";
  const cls = anzeige === "bestaetigt" ? "bg-green-600 hover:bg-green-600" : undefined;
  return (
    <Badge variant={variant} className={cls}>
      {OFFER_ANZEIGE_LABELS[anzeige]}
    </Badge>
  );
}

export default function Offers() {
  const [neuDialog, setNeuDialog] = useState(false);
  const [kundenId, setKundenId] = useState<string>("");
  const navigate = useNavigate();

  const liste = trpc.offers.list.useQuery();
  const kunden = trpc.customers.list.useQuery();
  const erstellen = trpc.offers.createDraft.useMutation({
    onSuccess: (res) => navigate(`/angebote/${res.id}`),
  });

  const [q, setQ] = useState("");
  const sort = useSortierung<NonNullable<typeof liste.data>[number]>("datum");
  const gefiltert = (liste.data ?? []).filter(
    (a) => !q.trim() || (a.nummer ?? "").toLowerCase().includes(q.toLowerCase()) || a.kundeName.toLowerCase().includes(q.toLowerCase()),
  );
  const zeilen = sort.sortiere(gefiltert, (a, key) =>
    key === "nummer" ? a.nummer : key === "kunde" ? a.kundeName : key === "datum" ? a.datum
    : key === "gueltigBis" ? a.gueltigBis : key === "status" ? a.status
    : key === "brutto" ? Number(a.brutto) : null,
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Angebote</h1>
        <div className="flex items-center gap-2">
          <CsvButton
            dateiname="angebote.csv"
            zeilen={[
              ["Nummer", "Kunde", "Datum", "Gültig bis", "Status", "Netto", "USt", "Brutto"],
              ...(liste.data ?? []).map((a) => [
                a.nummer ?? `Entwurf #${a.id}`, a.kundeName, a.datum, a.gueltigBis ?? "",
                a.status, deZahl(a.netto), deZahl(a.ust), deZahl(a.brutto),
              ]),
            ]}
          />
          <Button onClick={() => setNeuDialog(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Neues Angebot
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
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("datum")}>Datum<sort.KopfIcon k="datum" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("gueltigBis")}>Gültig bis<sort.KopfIcon k="gueltigBis" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("status")}>Status<sort.KopfIcon k="status" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 text-right font-medium" onClick={() => sort.umschalten("brutto")}>Brutto<sort.KopfIcon k="brutto" /></th>
            </tr>
          </thead>
          <tbody>
            {(liste.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  Noch keine Angebote vorhanden.
                </td>
              </tr>
            )}
            {zeilen.map((a) => (
              <tr key={a.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <Link
                    to={`/angebote/${a.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {a.nummer ?? `Entwurf #${a.id}`}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-neutral-600">{a.kundeName}</td>
                <td className="px-4 py-2.5 text-neutral-600">{datum(a.datum)}</td>
                <td className="px-4 py-2.5 text-neutral-600">
                  {a.gueltigBis ? datum(a.gueltigBis) : "–"}
                </td>
                <td className="px-4 py-2.5">{offerStatusBadge(a)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <div>{geld(a.brutto)}</div>
                  <div className="text-xs text-neutral-400">netto {geld(a.netto)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={neuDialog} onOpenChange={setNeuDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Neues Angebot</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-500">
            Kunde auswählen — das Angebot wird als Entwurf angelegt.
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
    </div>
  );
}
