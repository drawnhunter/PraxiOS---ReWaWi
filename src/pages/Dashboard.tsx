import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { geld, datum } from "@/lib/format";
import { Link } from "react-router";
import { STATUS_LABELS, type InvoiceStatus } from "@contracts/invoicing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SupportDialog } from "@/components/SupportDialog";
import { LifeBuoy } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function statusBadge(status: InvoiceStatus) {
  const variant =
    status === "finalisiert"
      ? "default"
      : status === "storniert"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

export default function Dashboard() {
  const stats = trpc.dashboard.stats.useQuery();
  const [supportOffen, setSupportOffen] = useState(false);

  if (stats.isLoading) return <p className="text-sm text-neutral-500">Lade …</p>;
  if (stats.error)
    return <p className="text-sm text-red-600">Fehler: {stats.error.message}</p>;
  const s = stats.data!;

  const karten = [
    { label: "Offene Rechnungen", wert: geld(s.offenGesamt), sub: `${s.anzahlOffen} Beleg(e)` },
    { label: "Überfällig", wert: String(s.anzahlUeberfaellig), sub: "Zahlungserinnerung prüfen" },
    { label: "Umsatz laufender Monat", wert: geld(s.umsatzMonat), sub: "brutto, finalisiert" },
    { label: "Entwürfe", wert: String(s.anzahlEntwuerfe), sub: "noch nicht finalisiert" },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Übersicht</h1>
        <Button variant="outline" size="sm" onClick={() => setSupportOffen(true)}>
          <LifeBuoy className="mr-1.5 h-4 w-4" /> Support
        </Button>
      </div>
      <SupportDialog offen={supportOffen} onSchliessen={() => setSupportOffen(false)} />
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {karten.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-neutral-500">
                {k.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tracking-tight">{k.wert}</div>
              <div className="mt-1 text-xs text-neutral-500">{k.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 text-sm font-medium text-neutral-700">Letzte Rechnungen</h2>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
                <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="px-4 py-2.5 font-medium">Nummer</th>
              <th className="px-4 py-2.5 font-medium">Kunde</th>
              <th className="px-4 py-2.5 font-medium">Datum</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {s.letzteRechnungen.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                  Noch keine Rechnungen — unter „Rechnungen“ die erste anlegen.
                </td>
              </tr>
            )}
            {s.letzteRechnungen.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <Link
                    to={`/rechnungen/${r.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {r.nummer ?? `Entwurf #${r.id}`}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-neutral-600">{r.kundeName}</td>
                <td className="px-4 py-2.5 text-neutral-600">{datum(r.rechnungsdatum)}</td>
                <td className="px-4 py-2.5">{statusBadge(r.status)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{geld(r.brutto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
