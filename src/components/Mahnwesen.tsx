import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { BellRing, Trash2 } from "lucide-react";
import { PdfButton } from "@/components/PdfButton";
import { PdfVorschau } from "@/components/PdfVorschau";
import { MailDialog } from "@/components/MailDialog";
import { geld, datum } from "@/lib/format";

const STUFEN_LABEL: Record<number, string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "2. Mahnung",
};

/** Mahnwesen-Sektion an einer finalisierten, offenen Rechnung. */
export function Mahnwesen({ rechnungId }: { rechnungId: number }) {
  const utils = trpc.useUtils();
  const liste = trpc.reminders.listByInvoice.useQuery({ invoiceId: rechnungId });
  const vorschlag = trpc.reminders.vorschlag.useQuery({ invoiceId: rechnungId });
  const [dialog, setDialog] = useState(false);
  const [stufe, setStufe] = useState("1");
  const [frist, setFrist] = useState("");

  const inval = () => {
    utils.reminders.listByInvoice.invalidate({ invoiceId: rechnungId });
    utils.reminders.vorschlag.invalidate({ invoiceId: rechnungId });
  };
  const erstellen = trpc.reminders.create.useMutation({
    onSuccess: () => {
      inval();
      setDialog(false);
    },
  });
  const loeschen = trpc.reminders.delete.useMutation({ onSuccess: inval });

  const dialogOeffnen = () => {
    setStufe(String(vorschlag.data?.stufe ?? 1));
    const d = new Date();
    d.setDate(d.getDate() + 10);
    setFrist(d.toISOString().slice(0, 10));
    setDialog(true);
  };

  return (
    <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <BellRing className="h-4 w-4 text-neutral-400" /> Mahnwesen
          {vorschlag.data?.ueberfaellig && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
              überfällig
            </span>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={dialogOeffnen}>
          Erinnerung/Mahnung erstellen
        </Button>
      </div>

      {(liste.data ?? []).length === 0 ? (
        <p className="text-sm text-neutral-500">
          Noch keine Erinnerungen oder Mahnungen erstellt.
        </p>
      ) : (
                <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
              <th className="py-1.5 font-medium">Art</th>
              <th className="py-1.5 font-medium">Datum</th>
              <th className="py-1.5 font-medium">Zahlungsfrist</th>
              <th className="py-1.5 text-right font-medium">Offener Betrag</th>
              <th className="py-1.5 text-right font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {(liste.data ?? []).map((m) => (
              <tr key={m.id} className="border-b border-neutral-50">
                <td className="py-2">{STUFEN_LABEL[m.stufe] ?? `Stufe ${m.stufe}`}</td>
                <td className="py-2 text-neutral-600">{datum(m.datum)}</td>
                <td className="py-2 text-neutral-600">{datum(m.zahlungsfrist)}</td>
                <td className="py-2 text-right tabular-nums">{geld(m.offenBetrag)}</td>
                <td className="py-2">
                  <div className="flex items-center justify-end gap-1">
                    <PdfButton art="reminder" id={m.id} />
                    <PdfVorschau art="reminder" id={m.id} titel="Mahnung" />
                    <MailDialog art="reminder" id={m.id} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm("Diese Mahnung löschen?")) loeschen.mutate({ id: m.id });
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-neutral-400" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zahlungserinnerung / Mahnung erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Art</Label>
              <Select value={stufe} onValueChange={setStufe}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Zahlungserinnerung</SelectItem>
                  <SelectItem value="2">1. Mahnung</SelectItem>
                  <SelectItem value="3">2. Mahnung</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Neue Zahlungsfrist</Label>
              <Input type="date" value={frist} onChange={(e) => setFrist(e.target.value)} />
            </div>
            <p className="text-xs text-neutral-500">
              Offener Betrag: <strong>{geld(vorschlag.data?.offenBetrag ?? "0")}</strong> — wird
              auf dem Schreiben ausgewiesen.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={erstellen.isPending || !frist}
              onClick={() =>
                erstellen.mutate({
                  invoiceId: rechnungId,
                  stufe: Number(stufe),
                  zahlungsfrist: frist,
                })
              }
            >
              Erstellen
            </Button>
          </DialogFooter>
          {erstellen.error && (
            <p className="text-sm text-red-600">{erstellen.error.message}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
