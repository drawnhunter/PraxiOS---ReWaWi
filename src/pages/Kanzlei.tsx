import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Landmark, FileBarChart2 } from "lucide-react";
import { Stammdaten } from "@/components/Stammdaten";
import { KontierungsUebersicht } from "@/components/KontierungsUebersicht";
import { DatevExport } from "@/components/DatevExport";
import { heuteLokal } from "@/lib/format";

/**
 * Kanzlei-Cockpit (v1.21.12): die Steuerberater-Sicht auf den Mandanten —
 * Stammdaten, Kontierungsübersicht und DATEV-Export an einem Ort.
 * Für die Rolle kanzlei read-only; für Inhaber/Admins ebenso nutzbar.
 */
export default function Kanzlei() {
  const settings = trpc.settings.get.useQuery();
  const jetzt = new Date();
  const [monat, setMonat] = useState(`${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, "0")}`);
  const von = `${monat}-01`;
  const bis = heuteLokal();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Landmark className="h-5 w-5" /> Kanzlei-Cockpit
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Alles für die Steuerberatung: Stammdaten, Kontierungen und DATEV-Export — ohne Suchen.
        </p>
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-neutral-700">Mandanten-Stammdaten</h2>
        {settings.isLoading && <p className="text-sm text-neutral-400">Lade …</p>}
        {settings.error && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">Stammdaten konnten nicht geladen werden: {settings.error.message}</p>}
        {settings.data && <Stammdaten daten={settings.data as unknown as Record<string, unknown>} />}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-neutral-700">Kontierungsübersicht</h2>
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            Monat:
            <input type="month" value={monat} onChange={(e) => setMonat(e.target.value)} className="rounded-md border border-neutral-200 px-2 py-1 text-sm" />
          </label>
        </div>
        <KontierungsUebersicht von={von} bis={bis} />
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-neutral-700">DATEV-Export</h2>
        <DatevExport />
      </section>

      <p className="text-xs text-neutral-400">
        Weitere Auswertungen (EÜR, Offene Posten, UStVA, Konto-Verlauf) gibt es unter{" "}
        <Link to="/berichte" className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline">
          <FileBarChart2 className="h-3.5 w-3.5" /> Berichte
        </Link>. Rückfragen zu einzelnen Belegen laufen über die Klärungsfälle.
      </p>
    </div>
  );
}
