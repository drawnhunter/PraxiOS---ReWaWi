import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { geld, datum as fmtDatum } from "@/lib/format";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Check, Copy, List, RefreshCw } from "lucide-react";

type Eintrag = {
  art: "rechnung" | "post" | "wiedervorlage";
  id: number;
  titel: string;
  betrag: string | null;
  datum: string;
  ueberfaellig: boolean;
  hinweis: string | null;
};

const ART_LABEL: Record<Eintrag["art"], string> = {
  rechnung: "Eingangsrechnung",
  post: "Post Manager",
  wiedervorlage: "Wiedervorlage",
};

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function monatsRaster(jahr: number, monat: number): (string | null)[][] {
  const erster = new Date(Date.UTC(jahr, monat, 1));
  const tage = new Date(Date.UTC(jahr, monat + 1, 0)).getUTCDate();
  const startWochentag = (erster.getUTCDay() + 6) % 7; // Mo = 0
  const wochen: (string | null)[][] = [];
  let woche: (string | null)[] = Array(startWochentag).fill(null);
  for (let t = 1; t <= tage; t++) {
    woche.push(`${jahr}-${String(monat + 1).padStart(2, "0")}-${String(t).padStart(2, "0")}`);
    if (woche.length === 7) {
      wochen.push(woche);
      woche = [];
    }
  }
  if (woche.length) wochen.push([...woche, ...Array(7 - woche.length).fill(null)]);
  return wochen;
}

export default function Zahlungsziele() {
  const utils = trpc.useUtils();
  const [ansicht, setAnsicht] = useState<"liste" | "kalender">("liste");
  const heute = new Date();
  const [jahrMonat, setJahrMonat] = useState({ jahr: heute.getFullYear(), monat: heute.getMonth() });
  const [kopiert, setKopiert] = useState(false);

  const eintraege = trpc.posteingang.zahlungsziele.useQuery();
  const ics = trpc.settings.icsStatus.useQuery();
  const icsNeu = trpc.settings.icsNeu.useMutation({ onSuccess: () => utils.settings.icsStatus.invalidate() });
  const markPaid = trpc.einrechnung.markPaid.useMutation({
    onSuccess: () => {
      utils.posteingang.zahlungsziele.invalidate();
      utils.einrechnung.list.invalidate();
    },
  });

  const icsUrl = ics.data?.token
    ? `${window.location.origin}/ics/zahlungsziele.ics?token=${ics.data.token}`
    : "";

  const nachDatum = useMemo(() => {
    const map = new Map<string, Eintrag[]>();
    for (const e of (eintraege.data ?? []) as Eintrag[]) {
      const arr = map.get(e.datum) ?? [];
      arr.push(e);
      map.set(e.datum, arr);
    }
    return map;
  }, [eintraege.data]);

  const raster = monatsRaster(jahrMonat.jahr, jahrMonat.monat);
  const heuteIso = heute.toISOString().slice(0, 10);
  const monatName = new Date(Date.UTC(jahrMonat.jahr, jahrMonat.monat, 1)).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  const monatWechseln = (richtung: number) => {
    setJahrMonat((alt) => {
      const m = alt.monat + richtung;
      return m < 0 ? { jahr: alt.jahr - 1, monat: 11 } : m > 11 ? { jahr: alt.jahr + 1, monat: 0 } : { ...alt, monat: m };
    });
  };

  const kopieren = async () => {
    await navigator.clipboard.writeText(icsUrl);
    setKopiert(true);
    setTimeout(() => setKopiert(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">Zahlungsziele</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Was wann zu bezahlen ist — offene Eingangsrechnungen, Post-Fristen und Wiedervorlagen.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={ansicht === "liste" ? "default" : "outline"} onClick={() => setAnsicht("liste")}>
            <List className="mr-2 h-4 w-4" />Liste
          </Button>
          <Button size="sm" variant={ansicht === "kalender" ? "default" : "outline"} onClick={() => setAnsicht("kalender")}>
            <CalendarDays className="mr-2 h-4 w-4" />Kalender
          </Button>
        </div>
      </div>

      {ansicht === "liste" && (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Datum</th>
                <th className="px-3 py-2 font-medium">Eintrag</th>
                <th className="px-3 py-2 font-medium">Art</th>
                <th className="px-3 py-2 font-medium text-right">Betrag</th>
                <th className="px-3 py-2 font-medium text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {((eintraege.data ?? []) as Eintrag[]).map((e, i) => (
                <tr key={`${e.art}-${e.id}-${i}`} className="border-b border-neutral-100 last:border-0">
                  <td className={`px-3 py-2 font-medium ${e.ueberfaellig ? "text-red-600" : "text-neutral-800"}`}>
                    {fmtDatum(e.datum)}
                    {e.ueberfaellig && <span className="ml-1 text-xs">(überfällig)</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-800">
                    {e.titel}
                    {e.hinweis && <span className="ml-2 text-xs text-amber-600">{e.hinweis}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={e.art === "rechnung" ? "default" : e.art === "post" ? "secondary" : "outline"}>
                      {ART_LABEL[e.art]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-800">{e.betrag ? geld(e.betrag) : "–"}</td>
                  <td className="px-3 py-2 text-right">
                    {e.art === "rechnung" && (
                      <Button size="sm" variant="outline" onClick={() => markPaid.mutate({ id: e.id })}>
                        Bezahlt
                      </Button>
                    )}
                    {e.art !== "rechnung" && (
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/posteingang">Öffnen →</Link>
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {eintraege.data?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-neutral-400">
                    Alles erledigt — keine offenen Zahlungsziele.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {ansicht === "kalender" && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={() => monatWechseln(-1)}>←</Button>
            <div className="font-medium capitalize text-neutral-800">{monatName}</div>
            <Button size="sm" variant="ghost" onClick={() => monatWechseln(1)}>→</Button>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200">
            {WOCHENTAGE.map((t) => (
              <div key={t} className="bg-neutral-50 px-2 py-1 text-center text-xs font-medium text-neutral-500">
                {t}
              </div>
            ))}
            {raster.flat().map((tag, i) => {
              const eintraegeTag = tag ? (nachDatum.get(tag) ?? []) : [];
              return (
                <div
                  key={i}
                  className={`min-h-20 bg-white p-1 ${tag === heuteIso ? "outline-2 outline-teal-600 -outline-offset-2" : ""}`}
                >
                  {tag && (
                    <>
                      <div className={`text-xs ${tag === heuteIso ? "font-bold text-teal-700" : "text-neutral-400"}`}>
                        {Number(tag.slice(8))}
                      </div>
                      <div className="mt-0.5 space-y-0.5">
                        {eintraegeTag.map((e, j) => (
                          <div
                            key={j}
                            className={`truncate rounded px-1 py-0.5 text-xs ${
                              e.ueberfaellig
                                ? "bg-red-100 text-red-800"
                                : e.art === "rechnung"
                                  ? "bg-teal-100 text-teal-900"
                                  : "bg-neutral-100 text-neutral-700"
                            }`}
                            title={e.titel}
                          >
                            {e.betrag ? geld(e.betrag) : "WV"} · {e.titel}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ICS-Abo */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-medium text-neutral-700">Kalender-Abo (ICS)</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Diese URL in Google Kalender, Outlook oder Apple Kalender als Kalender-Abo eintragen —
          die Zahlungsziele erscheinen dort automatisch.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full flex-1 truncate rounded bg-neutral-100 px-3 py-2 text-xs text-neutral-700">
            {icsUrl || "…"}
          </code>
          <Button size="sm" variant="outline" onClick={kopieren} disabled={!icsUrl}>
            {kopiert ? <Check className="mr-2 h-4 w-4 text-teal-700" /> : <Copy className="mr-2 h-4 w-4" />}
            {kopiert ? "Kopiert" : "Kopieren"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm("Neue URL erzeugen? Die alte URL wird sofort ungültig.")) icsNeu.mutate();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />Neue URL
          </Button>
        </div>
      </section>
    </div>
  );
}
