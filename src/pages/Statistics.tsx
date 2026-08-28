import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { geld } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, ImageDown, Info, PiggyBank } from "lucide-react";

/** Kleines „?" mit Erklärblase (Hover/Tap). */
function Erklaer({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex align-middle" tabIndex={0}>
      <Info className="h-3.5 w-3.5 text-neutral-400 group-hover:text-neutral-600" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-64 -translate-x-1/2 rounded-md border border-neutral-200 bg-white p-2.5 text-xs font-normal leading-snug text-neutral-600 shadow-lg group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

function Karte({
  label, wert, unter, info,
}: { label: string; wert: string; unter?: string; info?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs text-neutral-500">
        {label}
        {info && <Erklaer text={info} />}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight">{wert}</div>
      {unter && <div className="mt-0.5 text-xs text-neutral-400">{unter}</div>}
    </div>
  );
}

export default function Statistics() {
  const kpi = trpc.stats.uebersicht.useQuery();
  const verlauf = trpc.stats.verlauf.useQuery();
  const top = trpc.stats.top.useQuery();

  const monate = verlauf.data ?? [];
  const maxWert = Math.max(1, ...monate.map((m) => Math.max(m.umsatz, m.zahlungen)));
  const [gewaehlterMonat, setGewaehlterMonat] = useState<string | null>(null);
  const detail = monate.find((m) => m.monat === gewaehlterMonat);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Statistik</h1>

      {/* ── Kennzahlen ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Karte
          label="Umsatz (Jahr)"
          wert={kpi.data ? geld(kpi.data.umsatzJahrNetto) : "…"}
          unter={kpi.data ? `brutto ${geld(kpi.data.umsatzJahrBrutto)} · ${kpi.data.anzahlJahr} Rng.` : undefined}
          info="Umsatz = Summe finalisierter Rechnungen nach Rechnungsdatum. Groß/netto = ohne Umsatzsteuer, brutto = inkl. USt. Entwürfe und Stornos zählen nicht."
        />
        <Karte
          label="Umsatz (Monat)"
          wert={kpi.data ? geld(kpi.data.umsatzMonatNetto) : "…"}
          unter={kpi.data ? `brutto ${geld(kpi.data.umsatzMonatBrutto)}` : undefined}
          info="Netto = ohne USt. Die Umsatzsteuer ist nicht dein Geld — sie wird ans Finanzamt weitergereicht. Vergleiche deshalb netto-Werte."
        />
        <Karte
          label="Zahlungseingänge (Jahr)"
          wert={kpi.data ? geld(kpi.data.zahlungseingaengeJahr) : "…"}
          info="Tatsächlich eingegangenes Geld (brutto) nach Zahlungsdatum — egal aus welchem Rechnungsmonat. Kann über dem Umsatz liegen, wenn alte Rechnungen spät bezahlt werden."
        />
        <Karte
          label="Ø Rechnungsbetrag"
          wert={kpi.data ? geld(kpi.data.schnittBetrag) : "…"}
          unter="brutto, dieses Jahr"
        />
        <Karte
          label="Offene Forderungen"
          wert={kpi.data ? geld(kpi.data.offenBetrag) : "…"}
          unter={kpi.data ? `${kpi.data.offenAnzahl} Rechnungen` : undefined}
          info="Finalisierte Rechnungen, die noch nicht (vollständig) bezahlt sind — brutto."
        />
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-xs text-red-600">
            Überfällig
            <Erklaer text="Offen und Fälligkeitsdatum überschritten. Auf der Übersichtsseite findest du die Mahn-Vorschläge dazu." />
          </div>
          <div className="mt-1 text-lg font-semibold tracking-tight text-red-700">
            {kpi.data ? geld(kpi.data.ueberfaelligBetrag) : "…"}
          </div>
          <div className="mt-0.5 text-xs text-red-500">
            {kpi.data ? `${kpi.data.ueberfaelligAnzahl} Rechnungen` : ""}
          </div>
        </div>
      </div>

      {/* ── 12-Monats-Verlauf (anklickbar) ── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-medium text-neutral-700">Umsatz der letzten 12 Monate</h2>
        <p className="mb-4 text-xs text-neutral-400">
          Netto nach Rechnungsdatum, Zahlungseingänge (brutto) nach Zahlungsdatum.
          Balken anklicken für Details.
        </p>
        {monate.every((m) => m.umsatz === 0 && m.zahlungen === 0) ? (
          <p className="text-sm text-neutral-400">
            Noch keine finalisierten Rechnungen — sobald Rechnungen finalisiert
            und Zahlungen erfasst werden, entsteht hier der Verlauf.
          </p>
        ) : (
          <>
            <div className="flex h-44 items-end gap-1.5">
              {monate.map((m) => (
                <button
                  key={m.monat}
                  type="button"
                  onClick={() => setGewaehlterMonat(gewaehlterMonat === m.monat ? null : m.monat)}
                  className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-t px-0.5 pt-1 transition-colors ${gewaehlterMonat === m.monat ? "bg-neutral-100" : "hover:bg-neutral-50"}`}
                >
                  <div className="flex h-32 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-2/5 rounded-t bg-neutral-800"
                      style={{ height: `${Math.max(m.umsatz > 0 ? 2 : 0, (m.umsatz / maxWert) * 100)}%` }}
                    />
                    <div
                      className="w-2/5 rounded-t bg-neutral-300"
                      style={{ height: `${Math.max(m.zahlungen > 0 ? 2 : 0, (m.zahlungen / maxWert) * 100)}%` }}
                    />
                  </div>
                  <div className="w-full truncate text-center text-[10px] text-neutral-400">
                    {m.label}
                  </div>
                </button>
              ))}
            </div>
            {detail && (
              <div className="mt-3 flex flex-wrap gap-5 rounded-md bg-neutral-50 px-4 py-2.5 text-sm">
                <span className="font-medium">{detail.label}</span>
                <span>Umsatz netto: <strong>{geld(detail.umsatz)}</strong></span>
                <span>Zahlungseingänge: <strong>{geld(detail.zahlungen)}</strong></span>
                <span>Rechnungen: <strong>{detail.anzahl}</strong></span>
                {detail.zahlungen > detail.umsatz && (
                  <span className="text-xs text-neutral-500">
                    Eingänge über Umsatz = Zahlungen für ältere Rechnungen
                  </span>
                )}
              </div>
            )}
            <div className="mt-3 flex gap-4 text-xs text-neutral-500">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-neutral-800" /> Umsatz (netto)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-neutral-300" /> Zahlungseingänge (brutto)
              </span>
            </div>
          </>
        )}
      </section>

      {/* ── Liquiditätsplanung ── */}
      <Liquiditaet />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Top-Kunden ── */}
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">Top-Kunden (netto)</h2>
          <table className="w-full text-sm">
            <tbody>
              {(top.data?.kunden ?? []).map((k, i) => (
                <tr key={k.name} className="border-b border-neutral-100 last:border-0">
                  <td className="py-2 pr-2 text-neutral-400">{i + 1}.</td>
                  <td className="py-2 pr-2 font-medium">{k.name}</td>
                  <td className="py-2 pr-2 text-right text-neutral-500">{k.anzahl} Rng.</td>
                  <td className="py-2 text-right font-medium">{geld(k.umsatz)}</td>
                </tr>
              ))}
              {(!top.data || top.data.kunden.length === 0) && (
                <tr><td className="py-2 text-neutral-400">Noch keine Daten.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── Top-Produkte ── */}
        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">Top-Produkte/Leistungen (netto)</h2>
          <table className="w-full text-sm">
            <tbody>
              {(top.data?.produkte ?? []).map((p, i) => (
                <tr key={p.name} className="border-b border-neutral-100 last:border-0">
                  <td className="py-2 pr-2 text-neutral-400">{i + 1}.</td>
                  <td className="py-2 pr-2 font-medium">{p.name}</td>
                  <td className="py-2 pr-2 text-right text-neutral-500">{p.menge}×</td>
                  <td className="py-2 text-right font-medium">{geld(p.umsatz)}</td>
                </tr>
              ))}
              {(!top.data || top.data.produkte.length === 0) && (
                <tr><td className="py-2 text-neutral-400">Noch keine Daten.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      {/* ── UStVA-Hilfsblatt ── */}
      <UstvaKarte />

      {/* ── USt-Aufschlüsselung ── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-neutral-700">Umsatzsteuer nach Steuersatz</h2>
        <table className="w-full max-w-xl text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="py-2 font-medium">Steuersatz</th>
              <th className="py-2 text-right font-medium">Bemessungsgrundlage</th>
              <th className="py-2 text-right font-medium">USt.-Betrag</th>
            </tr>
          </thead>
          <tbody>
            {(top.data?.ust ?? []).map((u) => (
              <tr key={u.satz} className="border-b border-neutral-100 last:border-0">
                <td className="py-2">
                  {u.satz === -1 ? "Gemischte Rechnungen" : `${u.satz} %${u.satz === 0 ? " (steuerfrei)" : ""}`}
                </td>
                <td className="py-2 text-right">{geld(u.basis)}</td>
                <td className="py-2 text-right">{geld(u.betrag)}</td>
              </tr>
            ))}
            {(!top.data || top.data.ust.length === 0) && (
              <tr><td className="py-2 text-neutral-400">Noch keine Daten.</td></tr>
            )}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-neutral-400">
          Aus finalisierten Rechnungen. Rechnungen mit gemischten Steuersätzen
          werden separat ausgewiesen — die genaue Aufteilung steht je Beleg.
        </p>
      </section>
    </div>
  );
}

/** Liquiditätsplanung: Jahr wählbar, Budget, Ampel, klickbare Monatsbalken, Export. */
function Liquiditaet() {
  const jetzt = new Date();
  const [jahr, setJahr] = useState(jetzt.getFullYear());
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [budgetOffen, setBudgetOffen] = useState(false);
  const [budgetWert, setBudgetWert] = useState("");
  const utils = trpc.useUtils();

  const liq = trpc.stats.liquiditaet.useQuery({ jahr });
  const budgetSetzen = trpc.stats.budgetSetzen.useMutation({
    onSuccess: () => {
      utils.stats.liquiditaet.invalidate({ jahr });
      setBudgetOffen(false);
    },
  });

  const d = liq.data;
  const maxWert = Math.max(1, ...(d?.monate ?? []).map((m) => Math.max(m.einnahmen, m.ausgaben, m.umsatzNetto)));
  const detail = d?.monate.find((m) => m.monat === gewaehlt);

  const ampelStil =
    d?.ampel === "gut"
      ? "border-green-200 bg-green-50 text-green-900"
      : d?.ampel === "mittel"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-red-200 bg-red-50 text-red-900";
  const ampelPunkt = d?.ampel === "gut" ? "bg-green-500" : d?.ampel === "mittel" ? "bg-amber-500" : "bg-red-500";

  const exportCsv = () => {
    if (!d) return;
    const kopf = "Monat;Umsatz netto;Umsatz brutto;Einnahmen;Ausgaben;Rechnungen;davon offen";
    const zeilen = d.monate.map((m) =>
      [m.monat, m.umsatzNetto.toFixed(2), m.umsatzBrutto.toFixed(2), m.einnahmen.toFixed(2), m.ausgaben.toFixed(2), m.rechnungen, m.rechnungenOffen].join(";"),
    );
    const blob = new Blob(["﻿" + [kopf, ...zeilen].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `liquiditaet-${d.jahr}.csv`;
    a.click();
  };

  const exportSvg = () => {
    if (!d) return;
    const W = 960, H = 320, balkenW = W / d.monate.length;
    const teile: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica,Arial,sans-serif">`,
      `<rect width="${W}" height="${H}" fill="white"/>`,
      `<text x="16" y="30" font-size="16" font-weight="bold" fill="#171412">Liquidität ${d.jahr} — Einnahmen / Ausgaben / Umsatz</text>`,
    ];
    d.monate.forEach((m, i) => {
      const x = i * balkenW + 14;
      const hEin = (m.einnahmen / maxWert) * 200;
      const hAus = (m.ausgaben / maxWert) * 200;
      const hUm = (m.umsatzNetto / maxWert) * 200;
      const basis = 260;
      teile.push(`<rect x="${x}" y="${basis - hUm}" width="16" height="${hUm}" fill="#262626"/>`);
      teile.push(`<rect x="${x + 18}" y="${basis - hEin}" width="16" height="${hEin}" fill="#0f766e"/>`);
      teile.push(`<rect x="${x + 36}" y="${basis - hAus}" width="16" height="${hAus}" fill="#dc2626"/>`);
      teile.push(`<text x="${x + 16}" y="${basis + 16}" font-size="10" fill="#78716c">${m.label}</text>`);
    });
    teile.push(`<line x1="10" y1="260" x2="${W - 10}" y2="260" stroke="#e7e5e4"/>`);
    teile.push(`<rect x="16" y="285" width="10" height="10" fill="#262626"/><text x="30" y="294" font-size="11" fill="#44403c">Umsatz (netto)</text>`);
    teile.push(`<rect x="140" y="285" width="10" height="10" fill="#0f766e"/><text x="154" y="294" font-size="11" fill="#44403c">Einnahmen</text>`);
    teile.push(`<rect x="240" y="285" width="10" height="10" fill="#dc2626"/><text x="254" y="294" font-size="11" fill="#44403c">Ausgaben</text>`);
    teile.push(`<text x="${W - 16}" y="30" text-anchor="end" font-size="11" fill="#78716c">Einnahmen ${d.einnahmenJahr.toFixed(2)} € · Ausgaben ${d.ausgabenJahr.toFixed(2)} €</text>`);
    teile.push("</svg>");
    const blob = new Blob([teile.join("\n")], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `liquiditaet-${d.jahr}.svg`;
    a.click();
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-700">
          Liquiditätsplanung
          <Erklaer text="Einnahmen = bezahlte Rechnungen nach Zahlungsdatum. Ausgaben = Eingangsrechnungen (bezahlt: Zahlungsdatum, sonst Rechnungsdatum). Umsatz = finalisierte Rechnungen netto nach Rechnungsdatum. Klick auf einen Monat zeigt die Zusammensetzung." />
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setJahr(jahr - 1)}>← {jahr - 1}</Button>
          <span className="text-sm font-medium">{jahr}</span>
          <Button variant="outline" size="sm" onClick={() => setJahr(jahr + 1)} disabled={jahr >= jetzt.getFullYear()}>{jahr + 1} →</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!d}>
            <Download className="mr-1 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportSvg} disabled={!d}>
            <ImageDown className="mr-1 h-4 w-4" /> Grafik
          </Button>
        </div>
      </div>

      {/* Kennzahlenzeile: absolut + prozentual */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md bg-neutral-50 p-3">
          <div className="text-xs text-neutral-500">Einnahmen {jahr}</div>
          <div className="text-base font-semibold text-teal-800">{d ? geld(d.einnahmenJahr) : "…"}</div>
        </div>
        <div className="rounded-md bg-neutral-50 p-3">
          <div className="text-xs text-neutral-500">Ausgaben {jahr}</div>
          <div className="text-base font-semibold text-red-700">{d ? geld(d.ausgabenJahr) : "…"}</div>
        </div>
        <div className="rounded-md bg-neutral-50 p-3">
          <div className="text-xs text-neutral-500">Differenz</div>
          <div className={`text-base font-semibold ${d && d.differenzJahr >= 0 ? "text-teal-800" : "text-red-700"}`}>
            {d ? geld(d.differenzJahr) : "…"}
          </div>
        </div>
        <div className="rounded-md bg-neutral-50 p-3">
          <div className="text-xs text-neutral-500">
            Budget
            <Erklaer text="Dein Monats-Soll für Einnahmen. Die Erreichung rechnet fair: Budget × bereits vergangene Monate des Jahres." />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-semibold">
              {d?.budgetMonat ? geld(d.budgetMonat) : "—"}
              {d?.budgetErreichung != null && (
                <span className="ml-1.5 text-xs font-normal text-neutral-500">
                  {Math.round(d.budgetErreichung * 100)} % erreicht ({d.budgetSoll ? geld(d.budgetSoll) : ""} Soll)
                </span>
              )}
            </span>
            <Button
              variant="ghost" size="sm"
              onClick={() => { setBudgetWert(d?.budgetMonat ? String(d.budgetMonat).replace(".", ",") : ""); setBudgetOffen(!budgetOffen); }}
            >
              <PiggyBank className="h-4 w-4" />
            </Button>
          </div>
          {budgetOffen && (
            <div className="mt-2 flex items-center gap-1.5">
              <Input
                value={budgetWert}
                onChange={(e) => setBudgetWert(e.target.value)}
                placeholder="z. B. 5000"
                inputMode="decimal"
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                disabled={budgetSetzen.isPending}
                onClick={() => {
                  const n = Number(budgetWert.replace(",", "."));
                  budgetSetzen.mutate({ monatsBudget: Number.isFinite(n) && n > 0 ? n : null });
                }}
              >
                OK
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Ampel */}
      {d && (
        <div className={`mb-4 flex items-center gap-3 rounded-md border px-4 py-3 text-sm ${ampelStil}`}>
          <span className={`h-3 w-3 shrink-0 rounded-full ${ampelPunkt}`} />
          <span>{d.ampelText}</span>
        </div>
      )}

      {/* Monatsbalken: Umsatz netto / Einnahmen / Ausgaben */}
      <div className="flex h-48 items-end gap-1">
        {(d?.monate ?? []).map((m) => (
          <button
            key={m.monat}
            type="button"
            onClick={() => setGewaehlt(gewaehlt === m.monat ? null : m.monat)}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-t px-0.5 pt-1 transition-colors ${gewaehlt === m.monat ? "bg-neutral-100" : "hover:bg-neutral-50"}`}
          >
            <div className="flex h-36 w-full items-end justify-center gap-px">
              <div className="w-[30%] rounded-t bg-neutral-800" style={{ height: `${Math.max(m.umsatzNetto > 0 ? 2 : 0, (m.umsatzNetto / maxWert) * 100)}%` }} />
              <div className="w-[30%] rounded-t bg-teal-700" style={{ height: `${Math.max(m.einnahmen > 0 ? 2 : 0, (m.einnahmen / maxWert) * 100)}%` }} />
              <div className="w-[30%] rounded-t bg-red-300" style={{ height: `${Math.max(m.ausgaben > 0 ? 2 : 0, (m.ausgaben / maxWert) * 100)}%` }} />
            </div>
            <div className="w-full truncate text-center text-[10px] text-neutral-400">{m.label}</div>
          </button>
        ))}
      </div>
      {detail && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-neutral-50 px-4 py-2.5 text-sm">
          <span className="font-medium">{detail.label} {d?.jahr}</span>
          <span>Umsatz: <strong>{geld(detail.umsatzNetto)}</strong> netto / {geld(detail.umsatzBrutto)} brutto</span>
          <span>Einnahmen: <strong className="text-teal-800">{geld(detail.einnahmen)}</strong></span>
          <span>Ausgaben: <strong className="text-red-700">{geld(detail.ausgaben)}</strong></span>
          <span>Rechnungen: <strong>{detail.rechnungen}</strong> ({detail.rechnungenOffen} offen)</span>
          {detail.eingangsOffen > 0 && <span>{detail.eingangsOffen} Eingangsrechnung(en) unbezahlt</span>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-neutral-800" /> Umsatz (netto)</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-teal-700" /> Einnahmen</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-300" /> Ausgaben</span>
        {d && (d.offenKunden > 0 || d.offenLieferanten > 0) && (
          <span className="ml-auto">
            Aktuell offen: Kunden schulden dir <strong>{geld(d.offenKunden)}</strong> · du musst noch <strong>{geld(d.offenLieferanten)}</strong> zahlen
          </span>
        )}
      </div>
    </section>
  );
}

function UstvaKarte() {
  const [monat, setMonat] = useState(new Date().toISOString().slice(0, 7));
  const u = trpc.stats.ustva.useQuery({ monat });

  const Block = ({ titel, zeilen }: { titel: string; zeilen: { satz: number; basis: number; ust: number }[] }) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
          <th className="py-2 font-medium">{titel}</th>
          <th className="py-2 text-right font-medium">Bemessungsgrundlage</th>
          <th className="py-2 text-right font-medium">Steuerbetrag</th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z) => (
          <tr key={z.satz} className="border-b border-neutral-100 last:border-0">
            <td className="py-2">{z.satz === -1 ? "Gemischte Belege" : `${z.satz} %${z.satz === 0 ? " (steuerfrei)" : ""}`}</td>
            <td className="py-2 text-right">{geld(z.basis)}</td>
            <td className="py-2 text-right">{geld(z.ust)}</td>
          </tr>
        ))}
        {zeilen.length === 0 && (
          <tr><td colSpan={3} className="py-2 text-neutral-400">Keine Belege in diesem Monat.</td></tr>
        )}
      </tbody>
    </table>
  );

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-700">UStVA-Hilfsblatt</h2>
        <input
          type="month"
          value={monat}
          onChange={(e) => setMonat(e.target.value)}
          className="rounded-md border border-neutral-200 px-2 py-1 text-sm"
        />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Block titel="Umsatzsteuer (Ausgangsrechnungen)" zeilen={u.data?.ausgangsrechnungen ?? []} />
        <Block titel="Vorsteuer (Eingangsrechnungen)" zeilen={u.data?.eingangsrechnungen ?? []} />
      </div>
      <div className="mt-4 flex flex-wrap gap-6 rounded-md bg-neutral-50 p-3 text-sm">
        <div>Umsatzsteuer: <strong>{u.data ? geld(u.data.umsatzsteuer) : "…"}</strong></div>
        <div>− Vorsteuer: <strong>{u.data ? geld(u.data.vorsteuer) : "…"}</strong></div>
        <div className="font-semibold">
          = Zahllast{u.data && u.data.zahllast < 0 ? " (Erstattung)" : ""}: {u.data ? geld(Math.abs(u.data.zahllast)) : "…"}
        </div>
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        Aus finalisierten Rechnungen (Rechnungsdatum) und gebuchten E-Rechnungen.
        Werte als Orientierung für Mein ELSTER — die verbindliche Prüfung bleibt
        beim Steuerberater.
      </p>
    </section>
  );
}
