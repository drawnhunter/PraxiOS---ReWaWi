import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, ChevronRight, Plus, Trash2, Link2 } from "lucide-react";

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
  const termineJeTag = new Map<string, typeof daten.data extends undefined ? never : NonNullable<typeof daten.data>["termine"]>();
  for (const t of daten.data?.termine ?? []) {
    const arr = termineJeTag.get(t.datum) ?? [];
    arr.push(t as never);
    termineJeTag.set(t.datum, arr);
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
                const url = `${window.location.origin}/ics/kalender.ics?token=${icsToken}`;
                navigator.clipboard.writeText(url);
                alert(`ICS-Link kopiert!\n\nIn Google Kalender:\n„Kalender hinzufügen“ → „Von URL“ → einfügen:\n\n${url}`);
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
              className={`min-h-24 bg-white p-1.5 ${tag && datum === heute ? "ring-2 ring-teal-500 ring-inset" : ""} ${tag ? "cursor-pointer hover:bg-neutral-50" : "bg-neutral-50"}`}
              onClick={() => tag && setDialog({ datum: datum!, startZeit: "", endZeit: "", titel: "", beschreibung: "", farbe: FARBEN[0] })}
            >
              {tag && (
                <>
                  <div className={`mb-1 text-right text-xs ${datum === heute ? "font-bold text-teal-700" : "text-neutral-400"}`}>{tag}</div>
                  <div className="space-y-1">
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
