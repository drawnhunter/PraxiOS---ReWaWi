import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { SeitenEinstellung } from "@/components/SeitenEinstellung";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Download, FileText, Loader2, FileBarChart2 } from "lucide-react";
import { DatevExport } from "@/components/DatevExport";
import type { Bericht } from "@/../api/lib/berichte";

type Preset = "monat" | "letzter-monat" | "quartal" | "jahr" | "frei";

function zeitraumPreset(p: Preset): { von: string; bis: string } {
  const jetzt = new Date();
  const j = jetzt.getFullYear();
  const m = jetzt.getMonth();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  switch (p) {
    case "monat":
      return { von: fmt(new Date(j, m, 1)), bis: fmt(jetzt) };
    case "letzter-monat":
      return { von: fmt(new Date(j, m - 1, 1)), bis: fmt(new Date(j, m, 0)) };
    case "quartal": {
      const qStart = Math.floor(m / 3) * 3;
      return { von: fmt(new Date(j, qStart, 1)), bis: fmt(jetzt) };
    }
    case "jahr":
      return { von: `${j}-01-01`, bis: fmt(jetzt) };
    default:
      return { von: `${j}-01-01`, bis: fmt(jetzt) };
  }
}

function euro(v: string | number | null): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(v);
}

export default function Berichte() {
  const [preset, setPreset] = useState<Preset>("jahr");
  const [frei, setFrei] = useState({ von: zeitraumPreset("jahr").von, bis: zeitraumPreset("jahr").bis });
  const [berichtId, setBerichtId] = useState<string | null>(null);
  const [kontoId, setKontoId] = useState<number | null>(null);
  const [satz, setSatz] = useState("30");
  const [bericht, setBericht] = useState<Bericht | null>(null);
  const [laden, setLaden] = useState(false);
  const [pdfLaden, setPdfLaden] = useState(false);
  const [paketLaden, setPaketLaden] = useState(false);
  const [paketOk, setPaketOk] = useState("");
  const [fehler, setFehler] = useState("");

  const katalog = trpc.berichte.katalog.useQuery();
  const konten = trpc.berichte.konten.useQuery();
  const utils = trpc.useUtils();

  const zeitraum = useMemo(() => (preset === "frei" ? frei : zeitraumPreset(preset)), [preset, frei]);
  const gruppen = useMemo(() => {
    const g = new Map<string, typeof katalog.data>();
    for (const b of katalog.data ?? []) {
      if (!g.has(b.gruppe)) g.set(b.gruppe, []);
      g.get(b.gruppe)!.push(b);
    }
    return g;
  }, [katalog.data]);

  const laden_ = async (id: string) => {
    setBerichtId(id);
    setLaden(true);
    setFehler("");
    try {
      const r = await utils.berichte.bericht.fetch({
        id, ...zeitraum,
        kontoId: id === "kontenblatt" ? (kontoId ?? konten.data?.[0]?.id) : undefined,
        satz: id === "steuer-ruecklage" ? Number(satz) : undefined,
      });
      setBericht(r as Bericht);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
      setBericht(null);
    } finally {
      setLaden(false);
    }
  };

  const csvHerunterladen = () => {
    if (!bericht) return;
    const esc = (v: string | number | null) => {
      const s = v === null || v === undefined ? "" : String(v).replaceAll('"', '""');
      return `"${s}"`;
    };
    const zeilen = [
      bericht.spalten.map((s) => esc(s.titel)).join(";"),
      ...bericht.zeilen.map((z) => z.zellen.map((v, i) => esc(typeof v === "number" && bericht.spalten[i]?.rechts ? String(v).replace(".", ",") : v)).join(";")),
      ...(bericht.summenZeile ? [bericht.summenZeile.map((v, i) => esc(typeof v === "number" && bericht.spalten[i]?.rechts ? String(v).replace(".", ",") : v)).join(";")] : []),
    ];
    const blob = new Blob(["﻿" + zeilen.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${bericht.id}_${bericht.zeitraum.von}_${bericht.zeitraum.bis}.csv`;
    a.click();
  };

  const pdfHerunterladen = async () => {
    if (!berichtId) return;
    setPdfLaden(true);
    try {
      const r = await utils.berichte.pdf.fetch({
        id: berichtId, ...zeitraum,
        kontoId: berichtId === "kontenblatt" ? (kontoId ?? konten.data?.[0]?.id) : undefined,
        satz: berichtId === "steuer-ruecklage" ? Number(satz) : undefined,
      });
      const blob = new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = r.dateiname;
      a.click();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfLaden(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FileBarChart2 className="h-5 w-5 text-teal-700" />
        <h1 className="text-lg font-semibold">Berichtszentrale</h1>
        <SeitenEinstellung bereich="datev" titel="DATEV & Steuerberater" />
        <span className="text-xs text-neutral-400">EÜR · Offene Posten · Kontenblatt · Steuer-Rücklage · Liquidität · Analysen — alles aus deinen Daten, lokal gerechnet</span>
      </div>

      {/* Zeitraum-Steuerung */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-3">
        <div>
          <label className="mb-0.5 block text-[11px] text-neutral-500">Zeitraum</label>
          <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="monat">Aktueller Monat</SelectItem>
              <SelectItem value="letzter-monat">Letzter Monat</SelectItem>
              <SelectItem value="quartal">Aktuelles Quartal</SelectItem>
              <SelectItem value="jahr">Aktuelles Jahr</SelectItem>
              <SelectItem value="frei">Frei wählbar</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {preset === "frei" && (
          <>
            <div>
              <label className="mb-0.5 block text-[11px] text-neutral-500">Von</label>
              <Input type="date" className="h-8 text-xs" value={frei.von} onChange={(e) => setFrei({ ...frei, von: e.target.value })} />
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] text-neutral-500">Bis</label>
              <Input type="date" className="h-8 text-xs" value={frei.bis} onChange={(e) => setFrei({ ...frei, bis: e.target.value })} />
            </div>
          </>
        )}
        {berichtId === "kontenblatt" && (
          <div>
            <label className="mb-0.5 block text-[11px] text-neutral-500">Konto</label>
            <Select value={String(kontoId ?? konten.data?.[0]?.id ?? "")} onValueChange={(v) => setKontoId(Number(v))}>
              <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(konten.data ?? []).map((k) => <SelectItem key={k.id} value={String(k.id)}>{k.bezeichnung}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {berichtId === "steuer-ruecklage" && (
          <div>
            <label className="mb-0.5 block text-[11px] text-neutral-500">Ertragsteuer-Satz %</label>
            <Input className="h-8 w-20 text-xs" value={satz} onChange={(e) => setSatz(e.target.value)} />
          </div>
        )}
        {berichtId && (
          <Button size="sm" variant="outline" className="h-8" onClick={() => laden_(berichtId)}>
            Bericht aktualisieren
          </Button>
        )}
      </div>

      {/* Steuerberater-Übergabe: DATEV-Stapel + Belegbilder (aus Einstellungen hierher umgezogen) */}
      <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3">
        <h2 className="mb-1 text-sm font-semibold text-teal-900">Steuerberater-Übergabe (DATEV)</h2>
        <p className="mb-2 text-xs text-teal-700">Buchungsstapel (EXTF v700) + Belegbilder-ZIP mit document.xml (DATEV XML-Schnittstelle) — direkt für die Kanzlei bzw. den kostenlosen DATEV-Belegtransfer. Konfiguration (Berater-/Mandantennummer, Kontenrahmen) bleibt in den Einstellungen.</p>
        <DatevExport />
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-teal-100 pt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={paketLaden}
            onClick={async () => {
              setPaketLaden(true);
              setPaketOk("");
              setFehler("");
              try {
                const einstellungen = await utils.settings.get.fetch();
                const empfaenger = (einstellungen as { steuerberaterEmail?: string | null })?.steuerberaterEmail ?? "";
                const r = await utils.client.export.stbPaket.mutate(zeitraum);
                const betreff = `Buchhaltung ${zeitraum.von} – ${zeitraum.bis} (Stapel + Belege + Berichte)`;
                await utils.client.postfach.entwurfSpeichern.mutate({
                  empfaenger,
                  betreff,
                  text: `<p>Liebe Kanzlei,</p><p>anbei das Monatspaket ${zeitraum.von} – ${zeitraum.bis}: DATEV-Buchungsstapel (CSV), Belegbilder (ZIP mit document.xml für den DATEV-Belegtransfer) sowie EÜR und Offene-Posten-Listen als PDF.</p><p>Herzliche Grüße</p>`,
                  anhaenge: r.anhaenge,
                });
                utils.postfach.entwuerfe.invalidate();
                setPaketOk(`Entwurf mit ${r.anhaenge.length} Anhängen liegt in der Mail-Seitenleiste (Entwürfe) — prüfen & senden.${empfaenger ? "" : " Hinweis: Kanzlei-Adresse in den Einstellungen hinterlegen."}`);
              } catch (e) {
                setFehler(e instanceof Error ? e.message : String(e));
              } finally {
                setPaketLaden(false);
              }
            }}
          >
            {paketLaden ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            Monatspaket als Mail-Entwurf (Kanzlei)
          </Button>
          {paketOk && <p className="text-xs text-green-700">{paketOk}</p>}
        </div>
      </div>

      {/* Katalog */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[...gruppen.entries()].map(([gruppe, berichte]) => (
          <div key={gruppe} className="rounded-lg border border-neutral-200 bg-white p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{gruppe}</h2>
            <div className="space-y-1">
              {(berichte ?? []).map((b) => (
                <button
                  key={b.id}
                  onClick={() => laden_(b.id)}
                  className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${berichtId === b.id ? "bg-teal-50 font-medium text-teal-800" : "hover:bg-neutral-50"}`}
                  title={b.beschreibung}
                >
                  {b.titel}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {fehler && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</p>}
      {laden && <p className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Bericht wird gerechnet …</p>}

      {/* Bericht */}
      {bericht && !laden && (
        <div className="rounded-lg border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 p-3">
            <div>
              <h2 className="text-sm font-semibold">{bericht.titel}</h2>
              <p className="text-xs text-neutral-500">Zeitraum: {bericht.zeitraum.von} – {bericht.zeitraum.bis}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={csvHerunterladen}>
                <Download className="mr-1.5 h-4 w-4" /> CSV
              </Button>
              <Button size="sm" onClick={pdfHerunterladen} disabled={pdfLaden}>
                {pdfLaden ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />} PDF
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-xs text-neutral-500">
                  {bericht.spalten.map((s, i) => (
                    <th key={i} className={`px-3 py-2 font-medium ${s.rechts ? "text-right" : ""}`}>{s.titel}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bericht.zeilen.map((z, i) => (
                  <tr key={i} className={`border-b border-neutral-50 ${z.stark ? "bg-teal-50/60 font-semibold text-teal-900" : i % 2 ? "bg-neutral-50/40" : ""}`}>
                    {z.zellen.map((v, j) => (
                      <td
                        key={j}
                        className={`px-3 py-1.5 ${bericht.spalten[j]?.rechts ? "text-right tabular-nums" : ""} ${z.ebene ? `pl-${3 + z.ebene * 3}` : ""}`}
                        style={z.ebene ? { paddingLeft: `${12 + z.ebene * 14}px` } : undefined}
                      >
                        {euro(v)}
                      </td>
                    ))}
                  </tr>
                ))}
                {bericht.summenZeile && (
                  <tr className="border-t-2 border-teal-600 bg-teal-50 font-bold text-teal-900">
                    {bericht.summenZeile.map((v, j) => (
                      <td key={j} className={`px-3 py-2 ${bericht.spalten[j]?.rechts ? "text-right tabular-nums" : ""}`}>{euro(v)}</td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            {bericht.zeilen.length === 0 && <p className="p-4 text-sm text-neutral-400">Keine Daten im gewählten Zeitraum.</p>}
          </div>
          {bericht.hinweise && bericht.hinweise.length > 0 && (
            <div className="border-t border-neutral-100 px-3 py-2">
              {bericht.hinweise.map((h, i) => <p key={i} className="text-xs text-neutral-400">• {h}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
