import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { datum, geld } from "@/lib/format";
import { OFFER_STATUS_LABELS, type OfferStatus } from "@contracts/invoicing";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
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
import { Plus } from "lucide-react";

export function offerStatusBadge(status: OfferStatus) {
  const variant =
    status === "finalisiert"
      ? "default"
      : status === "storniert"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{OFFER_STATUS_LABELS[status]}</Badge>;
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

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
                <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="px-4 py-2.5 font-medium">Nummer</th>
              <th className="px-4 py-2.5 font-medium">Kunde</th>
              <th className="px-4 py-2.5 font-medium">Datum</th>
              <th className="px-4 py-2.5 font-medium">Gültig bis</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Brutto</th>
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
            {(liste.data ?? []).map((a) => (
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
                <td className="px-4 py-2.5">{offerStatusBadge(a.status)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{geld(a.brutto)}</td>
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
