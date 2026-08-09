import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useSortierung } from "@/lib/sortierung";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { geld, datum } from "@/lib/format";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { CsvButton } from "@/components/CsvButton";
import { deZahl } from "@/lib/downloads";

export default function CreditNotes() {
  const liste = trpc.creditNotes.list.useQuery();

  const [q, setQ] = useState("");
  const sort = useSortierung<NonNullable<typeof liste.data>[number]>("datum");
  const gefiltert = (liste.data ?? []).filter(
    (g) => !q.trim() || (g.nummer ?? "").toLowerCase().includes(q.toLowerCase()) || g.kundeName.toLowerCase().includes(q.toLowerCase()) || (g.invoice?.nummer ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  const zeilen = sort.sortiere(gefiltert, (g, key) =>
    key === "nummer" ? g.nummer : key === "rechnung" ? g.invoice?.nummer : key === "kunde" ? g.kundeName
    : key === "datum" ? g.datum : key === "status" ? g.status : key === "betrag" ? Number(g.brutto) : null,
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Gutschriften</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/e-rechnungen?tab=gutschriften">Lieferanten-Gutschriften →</Link>
          </Button>
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
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("rechnung")}>Zur Rechnung<sort.KopfIcon k="rechnung" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("kunde")}>Kunde<sort.KopfIcon k="kunde" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("datum")}>Datum<sort.KopfIcon k="datum" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("status")}>Status<sort.KopfIcon k="status" /></th>
              <th className="cursor-pointer select-none px-4 py-2.5 text-right font-medium" onClick={() => sort.umschalten("betrag")}>Betrag<sort.KopfIcon k="betrag" /></th>
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
            {zeilen.map((g) => (
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
