import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil, Link2 } from "lucide-react";

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const FARBEN = ["#0f766e", "#b45309", "#6d28d9", "#b91c1c", "#1d4ed8", "#57534e"];

interface TerminForm {
  id?: number;
  datum: string;
  startZeit: string;
  endZeit: string;
  titel: string;
  beschreibung: string;
  farbe: string;
}

function monatLabel(monat: string): string {
  const [j, m] = monat.split("-").map(Number);
  return new Date(j, m - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

export default function Kalender() {
  const [monat, setMonat] = useState(new Date().toISOString().slice(0, 7));
  const [dialog, setDialog] = useState<TerminForm | null>(null);
  const [tagOffen, setTagOffen] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const daten = trpc.kalender.monat.useQuery({ monat });
  const einstellungen = trpc.settings.get.useQuery();
  const anlegen = trpc.kalender.anlegen.useMutation({ onSuccess: () => { utils.kalender.monat.invalidate({ monat }); setDialog(null); } });
  const aktualisieren = trpc.kalender.aktualisieren.useMutation({ onSuccess: () => { utils.kalender.monat.invalidate({ monat }); setDialog(null); } });
  const loeschen = trpc.kalender.loeschen.useMutation({ onSuccess: () => utils.kalender.monat.invalidate({ monat }) });

  const monatShift = (delta: number) => {
    const [j, m] = monat.split("-").map(Number);
    const d = new Date(j, m - 1 + delta, 1);
    setMonat(d.toISOString().slice(0, 7));
  };

  // Kalender-Gitter (Mo-So)
  const [jahr, monatNr] = monat.split("-").map(Number);
  const erster = new Date(jahr, monatNr - 1, 1);
  const startWochentag = (erster.getDay() + 6) % 7; // Mo=0
  const tageImMonat = new Date(jahr, monatNr, 0).getDate();
  const heute = new Date().toISOString().slice(0, 10);
  const zellen: (number | null)[] = [
    ...Array(startWochentag).fill(null),
    ...Array.from({ length: tageImMonat }, (_, i) => i + 1),
  ];
  const termineJeTag = new Map<string, NonNullable<typeof daten.data>["termine"]>();
  for (const t of daten.data?.termine ?? []) {
    const arr = termineJeTag.get(t.datum) ?? [];
    arr.push(t);
    termineJeTag.set(t.datum, arr);
  }
  const quellenJeTag = new Map<string, NonNullable<typeof daten.data>["quellen"]>();
  for (const q of daten.data?.quellen ?? []) {
    const arr = quellenJeTag.get(q.datum) ?? [];
    arr.push(q);
    quellenJeTag.set(q.datum, arr);
  }

  const speichern = () => {
    if (!dialog) return;
    const { id, ...rest } = dialog;
    const daten_ = {
      datum: rest.datum,
      startZeit: rest.startZeit || null,
      endZeit: rest.endZeit || null,
      titel: rest.titel,
      beschreibung: rest.beschreibung || null,
      farbe: rest.farbe || null,
    };
    if (id) aktualisieren.mutate({ id, ...daten_ });
    else anlegen.mutate(daten_);
  };

  const icsToken = einstellungen.data?.icsToken;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Kalender</h1>
          <Button variant="outline" size="sm" onClick={() => monatShift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-40 text-center font-medium">{monatLabel(monat)}</span>
          <Button variant="outline" size="sm" onClick={() => monatShift(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setMonat(new Date().toISOString().slice(0, 7))}>Heute</Button>
        </div>
        <div className="flex items-center gap-2">
          {icsToken && (
            <Button
              variant="outline" size="sm"
              title="ICS-Link für Google Kalender: URL unter 'Kalender hinzufügen → Von URL' eintragen"
              onClick={() => {
                // Öffentliche Basis-URL gewinnt (dynv6/LAN-IP-Falle); sonst aktueller Origin
                const basis = (einstellungen.data?.oeffentlicheUrl ?? "").replace(/\/$/, "") || window.location.origin;
                const url = `${basis}/ics/kalender.ics?token=${icsToken}`;
                window.prompt("ICS-Link (Strg+C kopieren) — in Google Kalender unter „Kalender hinzufügen → Von URL“ einfügen:", url);
              }}
            >
              <Link2 className="mr-1.5 h-4 w-4" /> Google-Abo (ICS)
            </Button>
          )}
          <Button onClick={() => setDialog({ datum: heute, startZeit: "", endZeit: "", titel: "", beschreibung: "", farbe: FARBEN[0] })}>
            <Plus className="mr-1.5 h-4 w-4" /> Termin
          </Button>
        </div>
      </div>

    <div className="flex gap-3">
      <div className="min-w-0 flex-1">
      {/* Wochentag-Köpfe */}
      <div className="grid grid-cols-7 gap-px rounded-t-lg bg-neutral-200 text-center text-xs font-medium text-neutral-600">
        {WOCHENTAGE.map((t) => (
          <div key={t} className="bg-neutral-50 py-2">{t}</div>
        ))}
      </div>
      {/* Tages-Zellen */}
      <div className="grid grid-cols-7 gap-px rounded-b-lg bg-neutral-200">
        {zellen.map((tag, i) => {
          const datum = tag ? `${monat}-${String(tag).padStart(2, "0")}` : null;
          const termineHeute = datum ? termineJeTag.get(datum) ?? [] : [];
          return (
            <div
              key={i}
              className={`min-h-24 bg-white p-1.5 ${tag && datum === heute ? "ring-2 ring-teal-500 ring-inset" : ""} ${tag ? "cursor-pointer hover:bg-neutral-50" : "bg-neutral-50"} ${tagOffen === datum ? "bg-teal-50 ring-2 ring-teal-400 ring-inset" : ""}`}
              onClick={() => tag && setTagOffen(tagOffen === datum ? null : datum)}
            >
              {tag && (
                <>
                  <div className={`mb-1 text-right text-xs ${datum === heute ? "font-bold text-teal-700" : "text-neutral-400"}`}>{tag}</div>
                  <div className="space-y-1">
                    {(quellenJeTag.get(datum!) ?? []).slice(0, 2).map((q, qi) => (
                      <div
                        key={`q${qi}`}
                        className={`truncate rounded border-l-2 px-1.5 py-0.5 text-[11px] font-medium ${q.ueberfaellig ? "border-l-red-500 bg-red-50 text-red-800" : "border-l-amber-500 bg-amber-50 text-amber-800"}`}
                        title={q.titel}
                      >
                        {q.art === "mahnung" ? "⚠ " : q.art === "ausgang_offen" ? "◉ " : q.art === "eingang" ? "↓ " : "↻ "}{q.titel.slice(0, 24)}
                      </div>
                    ))}
                    {termineHeute.slice(0, 3).map((t) => (
                      <button
                        key={t.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDialog({
                            id: t.id, datum: t.datum, startZeit: t.startZeit ?? "", endZeit: t.endZeit ?? "",
                            titel: t.titel, beschreibung: t.beschreibung ?? "", farbe: t.farbe ?? FARBEN[0],
                          });
                        }}
                        className="w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white"
                        style={{ background: t.farbe ?? "#0f766e" }}
                        title={t.beschreibung ?? t.titel}
                      >
                        {t.startZeit ? `${t.startZeit} ` : ""}{t.titel}
                      </button>
                    ))}
                    {termineHeute.length > 3 && (
                      <div className="text-[10px] text-neutral-400">+{termineHeute.length - 3} weitere</div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      </div>

      {/* Tages-Detail (groß/klein per Klick auf Tag) */}
      {tagOffen && (
        <div className="w-96 shrink-0 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {new Date(tagOffen + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}
            </h2>
            <button onClick={() => setTagOffen(null)} className="text-xs text-neutral-400 hover:text-neutral-600">klein →</button>
          </div>

          {/* Quell-Eintraege (Mahnungen/Zahlungsziele/Post) */}
          {(quellenJeTag.get(tagOffen) ?? []).length > 0 && (
            <div className="mb-4 space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Mahnungen & Zahlungsziele</div>
              {(quellenJeTag.get(tagOffen) ?? []).map((q, qi) => (
                <a
                  key={qi}
                  href={q.link}
                  className={`block rounded-md border-l-4 px-2.5 py-1.5 text-xs ${q.ueberfaellig ? "border-l-red-500 bg-red-50" : "border-l-amber-500 bg-amber-50"}`}
                >
                  <div className="font-medium">{q.titel}</div>
                  {q.betrag && <div className="text-neutral-600">{q.betrag} €{q.ueberfaellig ? " · überfällig" : ""}</div>}
                </a>
              ))}
            </div>
          )}

          {/* Termine des Tages */}
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Termine</div>
            <Button
              variant="outline" size="sm"
              onClick={() => setDialog({ datum: tagOffen, startZeit: "", endZeit: "", titel: "", beschreibung: "", farbe: FARBEN[0] })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Neu
            </Button>
          </div>
          {(termineJeTag.get(tagOffen) ?? []).length === 0 && (
            <p className="py-3 text-center text-xs text-neutral-400">Keine Termine an diesem Tag.</p>
          )}
          <div className="space-y-1.5">
            {(termineJeTag.get(tagOffen) ?? []).map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-md border border-neutral-200 px-2.5 py-1.5">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.farbe ?? "#0f766e" }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.startZeit ? `${t.startZeit} ` : ""}{t.titel}</div>
                  {t.beschreibung && <div className="truncate text-xs text-neutral-500">{t.beschreibung}</div>}
                </div>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setDialog({
                    id: t.id, datum: t.datum, startZeit: t.startZeit ?? "", endZeit: t.endZeit ?? "",
                    titel: t.titel, beschreibung: t.beschreibung ?? "", farbe: t.farbe ?? FARBEN[0],
                  })}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="sm" className="text-red-600"
                  onClick={() => confirm(`Termin „${t.titel}" löschen?`) && loeschen.mutate({ id: t.id })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>

      {/* Dialog: Termin anlegen/bearbeiten */}
      {dialog && (
        <Dialog open onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{dialog.id ? "Termin bearbeiten" : "Neuer Termin"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Datum *</Label>
                  <Input type="date" value={dialog.datum} onChange={(e) => setDialog({ ...dialog, datum: e.target.value })} />
                </div>
                <div>
                  <Label>Von</Label>
                  <Input type="time" value={dialog.startZeit} onChange={(e) => setDialog({ ...dialog, startZeit: e.target.value })} />
                </div>
                <div>
                  <Label>Bis</Label>
                  <Input type="time" value={dialog.endZeit} onChange={(e) => setDialog({ ...dialog, endZeit: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Titel *</Label>
                <Input value={dialog.titel} onChange={(e) => setDialog({ ...dialog, titel: e.target.value })} />
              </div>
              <div>
                <Label>Beschreibung</Label>
                <Textarea value={dialog.beschreibung} onChange={(e) => setDialog({ ...dialog, beschreibung: e.target.value })} rows={3} />
              </div>
              <div>
                <Label>Farbe</Label>
                <div className="flex gap-1.5">
                  {FARBEN.map((f) => (
                    <button
                      key={f}
                      onClick={() => setDialog({ ...dialog, farbe: f })}
                      className={`h-7 w-7 rounded-full ${dialog.farbe === f ? "ring-2 ring-offset-2 ring-neutral-700" : ""}`}
                      style={{ background: f }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter className="flex justify-between">
              <div>
                {dialog.id && (
                  <Button
                    variant="ghost" className="text-red-600"
                    onClick={() => { loeschen.mutate({ id: dialog.id! }); setDialog(null); }}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" /> Löschen
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setDialog(null)}>Abbrechen</Button>
                <Button onClick={speichern} disabled={!dialog.titel.trim() || !dialog.datum}>
                  Speichern
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
