import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { geld } from "@/lib/format";

function Karte({ label, wert, unter }: { label: string; wert: string; unter?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs text-neutral-500">{label}</div>
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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Statistik</h1>

      {/* ── Kennzahlen ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Karte
          label="Umsatz (Jahr, netto)"
          wert={kpi.data ? geld(kpi.data.umsatzJahrNetto) : "…"}
          unter={kpi.data ? `${kpi.data.anzahlJahr} Rechnungen` : undefined}
        />
        <Karte
          label="Umsatz (Monat, netto)"
          wert={kpi.data ? geld(kpi.data.umsatzMonatNetto) : "…"}
        />
        <Karte
          label="Zahlungseingänge (Jahr)"
          wert={kpi.data ? geld(kpi.data.zahlungseingaengeJahr) : "…"}
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
        />
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-xs text-red-600">Überfällig</div>
          <div className="mt-1 text-lg font-semibold tracking-tight text-red-700">
            {kpi.data ? geld(kpi.data.ueberfaelligBetrag) : "…"}
          </div>
          <div className="mt-0.5 text-xs text-red-500">
            {kpi.data ? `${kpi.data.ueberfaelligAnzahl} Rechnungen` : ""}
          </div>
        </div>
      </div>

      {/* ── 12-Monats-Verlauf ── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-medium text-neutral-700">Umsatz der letzten 12 Monate</h2>
        <p className="mb-4 text-xs text-neutral-400">
          Netto nach Rechnungsdatum, Zahlungseingänge nach Zahlungsdatum.
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
                <div key={m.monat} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="flex h-32 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-2/5 rounded-t bg-neutral-800"
                      style={{ height: `${Math.max(m.umsatz > 0 ? 2 : 0, (m.umsatz / maxWert) * 100)}%` }}
                      title={`Umsatz ${m.label}: ${geld(m.umsatz)}`}
                    />
                    <div
                      className="w-2/5 rounded-t bg-neutral-300"
                      style={{ height: `${Math.max(m.zahlungen > 0 ? 2 : 0, (m.zahlungen / maxWert) * 100)}%` }}
                      title={`Zahlungen ${m.label}: ${geld(m.zahlungen)}`}
                    />
                  </div>
                  <div className="w-full truncate text-center text-[10px] text-neutral-400">
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-neutral-500">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-neutral-800" /> Umsatz (netto)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-neutral-300" /> Zahlungseingänge
              </span>
            </div>
          </>
        )}
      </section>

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
