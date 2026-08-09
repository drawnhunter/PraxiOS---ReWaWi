import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { geld, datum as fmtDatum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Landmark, Link2, Unlink, Search } from "lucide-react";

/** Bank-Zuordnung auf der Rechnungsseite: zugeordnete Transaktionen anzeigen,
 *  offene Bankbuchungen der Rechnung zuordnen, Zuordnung loesen (v1.3). */
export default function BankZuordnung({ invoiceId }: { invoiceId: number }) {
  const utils = trpc.useUtils();
  const [dialog, setDialog] = useState(false);
  const [q, setQ] = useState("");

  const zugeordnet = trpc.bankTrans.fuerRechnung.useQuery({ invoiceId });
  const offene = trpc.bankTrans.offeneFuerRechnung.useQuery(
    { invoiceId },
    { enabled: dialog },
  );

  const inval = () => {
    zugeordnet.refetch();
    offene.refetch();
    utils.invoices.get.invalidate({ id: invoiceId });
    utils.bankTrans.liste.invalidate();
    utils.bankTrans.kontenUebersicht.invalidate();
    utils.stats.uebersicht.invalidate();
  };

  const zuordnen = trpc.bankTrans.zuordnen.useMutation({
    onSuccess: () => { inval(); setDialog(false); },
  });
  const loesen = trpc.bankTrans.zuordnungLoesen.useMutation({ onSuccess: inval });

  const liste = zugeordnet.data ?? [];
  const vorschlaege = (offene.data ?? []).filter((x) =>
    !q.trim() ||
    x.t.name.toLowerCase().includes(q.toLowerCase()) ||
    (x.t.zweck ?? "").toLowerCase().includes(q.toLowerCase()) ||
    (x.kontoBezeichnung ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <Landmark className="h-4 w-4" /> Bank-Zuordnung
        </h2>
        <Button variant="outline" size="sm" onClick={() => setDialog(true)}>
          <Link2 className="mr-1.5 h-4 w-4" /> Transaktion zuordnen
        </Button>
      </div>

      {liste.length === 0 ? (
        <p className="text-sm text-neutral-400">
          Keine Banktransaktion zugeordnet. Zahlungseingänge kannst du hier direkt
          vom Konto zuordnen — oder im Banking-Bereich vom Kontoauszug aus.
        </p>
      ) : (
        <div className="space-y-1.5">
          {liste.map((x) => (
            <div key={x.t.id} className="flex items-center justify-between gap-3 rounded-md border border-neutral-100 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{geld(x.t.zugeordneterBetrag ?? x.t.betrag)}</span>
                <span className="ml-2 text-neutral-500">
                  {fmtDatum(x.t.datum)} · {x.t.name || "—"}
                </span>
                <span className="ml-2 text-xs text-neutral-400">{x.kontoBezeichnung}</span>
              </div>
              <Button
                variant="ghost" size="sm" title="Zuordnung lösen (Zahlung wird zurückgebucht)"
                onClick={() =>
                  confirm("Zuordnung lösen? Der bezahlte Betrag wird auf der Rechnung reduziert.") &&
                  loesen.mutate({ transaktionId: x.t.id })
                }
              >
                <Unlink className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {zuordnen.error && <p className="mt-2 text-sm text-red-600">{zuordnen.error.message}</p>}
      {loesen.error && <p className="mt-2 text-sm text-red-600">{loesen.error.message}</p>}

      {/* ── Dialog: offene Transaktion wählen ── */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" /> Banktransaktion zuordnen
            </DialogTitle>
          </DialogHeader>
          {offene.data?.[0] && (
            <p className="text-sm text-neutral-600">
              Offen auf dieser Rechnung: <strong>{geld(offene.data[0].offenRechnung)}</strong>
              {" "}— passendste Transaktionen stehen oben.
            </p>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name / Zweck / Konto suchen …" className="pl-8" />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border border-neutral-200">
            {vorschlaege.map((x) => {
              const exakt = offene.data && Math.abs(Number(x.t.betrag) - offene.data[0].offenRechnung) <= 0.01;
              return (
                <button
                  key={x.t.id}
                  disabled={zuordnen.isPending}
                  onClick={() => zuordnen.mutate({ transaktionId: x.t.id, typ: "ausgang", zielId: invoiceId })}
                  className="flex w-full items-center justify-between gap-3 border-b border-neutral-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{x.t.name || "—"}</div>
                    <div className="truncate text-xs text-neutral-400">
                      {fmtDatum(x.t.datum)} · {x.kontoBezeichnung} · {x.t.zweck}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular-nums font-medium text-green-700">{geld(x.t.betrag)}</div>
                    {exakt && <Badge>exakt</Badge>}
                  </div>
                </button>
              );
            })}
            {vorschlaege.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-neutral-400">
                {offene.isLoading ? "Lade …" : "Keine offenen Geldeingänge gefunden — erst Kontoauszug importieren."}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
