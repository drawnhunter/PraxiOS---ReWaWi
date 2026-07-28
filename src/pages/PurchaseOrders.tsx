import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { geld, datum } from "@/lib/format";
import { PO_STATUS_LABELS, type PurchaseOrderStatus } from "@contracts/invoicing";
import { Link, useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { CsvButton } from "@/components/CsvButton";
import { deZahl } from "@/lib/downloads";
import { Button } from "@/components/ui/button";
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

export function poStatusBadge(status: PurchaseOrderStatus) {
  const variant =
    status === "geliefert"
      ? "default"
      : status === "storniert"
        ? "destructive"
        : status === "bestellt" || status === "teilgeliefert"
          ? "outline"
          : "secondary";
  return <Badge variant={variant}>{PO_STATUS_LABELS[status]}</Badge>;
}

export default function PurchaseOrders() {
  const [statusFilter, setStatusFilter] = useState<string>("alle");
  const [neuDialog, setNeuDialog] = useState(false);
  const [lieferantId, setLieferantId] = useState<string>("");
  const navigate = useNavigate();

  const liste = trpc.purchaseOrders.list.useQuery(
    statusFilter === "alle"
      ? undefined
      : { status: statusFilter as PurchaseOrderStatus },
  );
  const lieferanten = trpc.suppliers.list.useQuery();
  const erstellen = trpc.purchaseOrders.createDraft.useMutation({
    onSuccess: (res) => navigate(`/bestellungen/${res.id}`),
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Bestellungen</h1>
        <div className="flex items-center gap-2">
          <CsvButton
            dateiname="bestellungen.csv"
            zeilen={[
              ["Nummer", "Lieferant", "Bestelldatum", "Lieferdatum", "Status", "Netto", "USt", "Brutto"],
              ...(liste.data ?? []).map((b) => [
                b.nummer ?? `Entwurf #${b.id}`, b.lieferantName, b.bestelldatum,
                b.lieferdatum, b.status, deZahl(b.netto), deZahl(b.ust), deZahl(b.brutto),
              ]),
            ]}
          />
          <Button onClick={() => setNeuDialog(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Neue Bestellung
          </Button>
        </div>
      </div>

      <div className="mb-4 max-w-xs">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Alle Status</SelectItem>
            <SelectItem value="entwurf">Entwurf</SelectItem>
            <SelectItem value="bestellt">Bestellt</SelectItem>
            <SelectItem value="teilgeliefert">Teilgeliefert</SelectItem>
            <SelectItem value="geliefert">Geliefert</SelectItem>
            <SelectItem value="storniert">Storniert</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
                <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="px-4 py-2.5 font-medium">Nummer</th>
              <th className="px-4 py-2.5 font-medium">Lieferant</th>
              <th className="px-4 py-2.5 font-medium">Bestelldatum</th>
              <th className="px-4 py-2.5 font-medium">Lieferdatum</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Brutto</th>
            </tr>
          </thead>
          <tbody>
            {(liste.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  Keine Bestellungen vorhanden.
                </td>
              </tr>
            )}
            {(liste.data ?? []).map((b) => (
              <tr key={b.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <Link
                    to={`/bestellungen/${b.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {b.nummer ?? `Entwurf #${b.id}`}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-neutral-600">{b.lieferantName}</td>
                <td className="px-4 py-2.5 text-neutral-600">{datum(b.bestelldatum)}</td>
                <td className="px-4 py-2.5 text-neutral-600">
                  {datum(b.geliefertAm ?? b.lieferdatum)}
                </td>
                <td className="px-4 py-2.5">{poStatusBadge(b.status)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{geld(b.brutto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={neuDialog} onOpenChange={setNeuDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Neue Bestellung</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-500">
            Lieferant auswählen — die Bestellung wird als Entwurf angelegt.
          </p>
          <Select value={lieferantId} onValueChange={setLieferantId}>
            <SelectTrigger>
              <SelectValue placeholder="Lieferant auswählen …" />
            </SelectTrigger>
            <SelectContent>
              {(lieferanten.data ?? []).map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name} — {l.plz} {l.ort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(lieferanten.data ?? []).length === 0 && (
            <p className="text-sm text-amber-600">
              Noch keine Lieferanten vorhanden — bitte zuerst unter „Lieferanten“ anlegen.
            </p>
          )}
          {erstellen.error && (
            <p className="text-sm text-red-600">{erstellen.error.message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNeuDialog(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={!lieferantId || erstellen.isPending}
              onClick={() => erstellen.mutate({ supplierId: Number(lieferantId) })}
            >
              Entwurf anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
