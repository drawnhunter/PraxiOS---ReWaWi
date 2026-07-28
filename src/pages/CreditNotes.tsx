import { trpc } from "@/providers/trpc";
import { geld, datum } from "@/lib/format";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { CsvButton } from "@/components/CsvButton";
import { deZahl } from "@/lib/downloads";

export default function CreditNotes() {
  const liste = trpc.creditNotes.list.useQuery();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Gutschriften</h1>
        <div className="flex items-center gap-2">
          <CsvButton
            dateiname="gutschriften.csv"
            zeilen={[
              ["Nummer", "Zur Rechnung", "Kunde", "Datum", "Status", "Brutto"],
              ...(liste.data ?? []).map((g) => [
                g.nummer ?? `Entwurf #${g.id}`, g.invoice.nummer ?? `#${g.invoiceId}`,
                g.kundeName, g.datum, g.status, deZahl(g.brutto),
              ]),
            ]}
          />
          <p className="max-w-md text-right text-xs text-neutral-500">
            Gutschriften entstehen über „Stornieren“ in einer finalisierten Rechnung.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
                <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="px-4 py-2.5 font-medium">Nummer</th>
              <th className="px-4 py-2.5 font-medium">Zur Rechnung</th>
              <th className="px-4 py-2.5 font-medium">Kunde</th>
              <th className="px-4 py-2.5 font-medium">Datum</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {(liste.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  Keine Gutschriften vorhanden.
                </td>
              </tr>
            )}
            {(liste.data ?? []).map((g) => (
              <tr key={g.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <Link
                    to={`/gutschriften/${g.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {g.nummer ?? `Entwurf #${g.id}`}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    to={`/rechnungen/${g.invoiceId}`}
                    className="text-neutral-600 hover:underline"
                  >
                    {g.invoice.nummer ?? `#${g.invoiceId}`}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-neutral-600">{g.kundeName}</td>
                <td className="px-4 py-2.5 text-neutral-600">{datum(g.datum)}</td>
                <td className="px-4 py-2.5">
                  <Badge variant={g.status === "finalisiert" ? "default" : "secondary"}>
                    {g.status === "finalisiert" ? "Finalisiert" : "Entwurf"}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{geld(g.brutto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
