import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useSortierung } from "@/lib/sortierung";
import { geld } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Clock, Play, Square, Plus, Pencil, Trash2, Lock, FilePlus2, Search, Users,
} from "lucide-react";

type Tab = "stempeln" | "eintraege" | "auswertung" | "mitarbeiter";

const fmtD = (d: unknown): string => {
  if (!d) return "–";
  const dt = d instanceof Date ? d : new Date(String(d));
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
};
const fmtZ = (d: unknown): string => {
  if (!d) return "–";
  const dt = d instanceof Date ? d : new Date(String(d));
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
};
const fmtStd = (h: string | number): string => {
  const n = Number(h);
  const st = Math.floor(n);
  const min = Math.round((n - st) * 60);
  return min === 60 ? `${st + 1}:00` : `${st}:${String(min).padStart(2, "0")}`;
};

export default function Zeit() {
  const [tab, setTab] = useState<Tab>("stempeln");
  const utils = trpc.useUtils();
  const inval = () => {
    utils.zeit.laufend.invalidate();
    utils.zeit.eintraege.invalidate();
    utils.zeit.mitarbeiterListe.invalidate();
    utils.zeit.auswertung.invalidate();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Clock className="h-5 w-5" /> Zeiterfassung
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Stempeln, erfassen, auswerten — und Stunden per Klick zur Rechnung.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
        {([
          ["stempeln", "Stempeln"],
          ["eintraege", "Einträge"],
          ["auswertung", "Auswertung"],
          ["mitarbeiter", "Mitarbeiter"],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === t ? "bg-white shadow-sm" : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "stempeln" && <StempelnTab onChanged={inval} />}
      {tab === "eintraege" && <EintraegeTab onChanged={inval} />}
      {tab === "auswertung" && <AuswertungTab />}
      {tab === "mitarbeiter" && <MitarbeiterTab onChanged={inval} />}
    </div>
  );
}

/* ═══ Tab: Stempeln ═══ */
function StempelnTab({ onChanged }: { onChanged: () => void }) {
  const mitarbeiter = trpc.zeit.mitarbeiterListe.useQuery();
  const laufend = trpc.zeit.laufend.useQuery(undefined, { refetchInterval: 15000 });
  const kunden = trpc.customers.list.useQuery();
  const [maId, setMaId] = useState("");
  const [kundeId, setKundeId] = useState("0");
  const [notiz, setNotiz] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const start = trpc.zeit.stempelStart.useMutation({ onSuccess: onChanged });
  const stop = trpc.zeit.stempelStop.useMutation({ onSuccess: onChanged });

  const laufendeMaIds = new Set((laufend.data ?? []).map((r) => r.z.mitarbeiterId));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-neutral-700">Stempel starten</h2>
        <div className="space-y-3">
          <div>
            <Label>Mitarbeiter</Label>
            <Select value={maId} onValueChange={setMaId}>
              <SelectTrigger><SelectValue placeholder="Wählen …" /></SelectTrigger>
              <SelectContent>
                {(mitarbeiter.data ?? []).filter((m) => m.aktiv).map((m) => (
                  <SelectItem key={m.id} value={String(m.id)} disabled={laufendeMaIds.has(m.id)}>
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: m.farbe }} />
                    {m.name}{laufendeMaIds.has(m.id) ? " (stempelt)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Kunde (optional)</Label>
            <Select value={kundeId} onValueChange={setKundeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">— ohne Kunde —</SelectItem>
                {(kunden.data ?? []).map((k) => (
                  <SelectItem key={k.id} value={String(k.id)}>{k.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notiz (Tätigkeit)</Label>
            <Input value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. Wartung vor Ort, Beratung …" />
          </div>
          <Button
            className="w-full"
            disabled={!maId || start.isPending || laufendeMaIds.has(Number(maId))}
            onClick={() =>
              start.mutate({
                mitarbeiterId: Number(maId),
                customerId: kundeId === "0" ? null : Number(kundeId),
                notiz: notiz.trim() || null,
              })
            }
          >
            <Play className="mr-1.5 h-4 w-4" /> Stempel starten
          </Button>
          {start.error && <p className="text-sm text-red-600">{start.error.message}</p>}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium text-neutral-700">
          Laufend ({(laufend.data ?? []).length})
        </h2>
        <div className="space-y-2">
          {(laufend.data ?? []).map((r) => {
            const seit = r.z.von instanceof Date ? r.z.von : new Date(String(r.z.von));
            const diff = Math.max(0, (Date.now() - seit.getTime()) / 1000);
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const sek = Math.floor(diff % 60);
            return (
              <div key={r.z.id} className="flex items-center justify-between gap-3 rounded-md border border-neutral-100 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.farbe ?? "#0f766e" }} />
                    {r.mitarbeiterName}
                    {r.kundeName && <span className="text-xs font-normal text-neutral-400">· {r.kundeName}</span>}
                  </div>
                  <div className="truncate text-xs text-neutral-400">
                    seit {fmtZ(seit)} Uhr{r.z.notiz ? ` · ${r.z.notiz}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-lg font-semibold text-teal-700">
                    {h}:{String(m).padStart(2, "0")}:{String(sek).padStart(2, "0")}
                  </span>
                  <Button
                    variant="destructive" size="sm"
                    disabled={stop.isPending}
                    onClick={() => stop.mutate({ mitarbeiterId: r.z.mitarbeiterId })}
                  >
                    <Square className="mr-1 h-3.5 w-3.5" /> Stop
                  </Button>
                </div>
              </div>
            );
          })}
          {(laufend.data ?? []).length === 0 && (
            <p className="text-sm text-neutral-400">Niemand stempelt gerade.</p>
          )}
          {stop.error && <p className="text-sm text-red-600">{stop.error.message}</p>}
        </div>
      </section>
    </div>
  );
}

/* ═══ Tab: Einträge ═══ */
function EintraegeTab({ onChanged }: { onChanged: () => void }) {
  const mitarbeiter = trpc.zeit.mitarbeiterListe.useQuery();
  const kunden = trpc.customers.list.useQuery();
  const produkte = trpc.products.list.useQuery();
  const [fMa, setFMa] = useState("0");
  const [fKu, setFKu] = useState("0");
  const [nurOffen, setNurOffen] = useState(false);
  const [q, setQ] = useState("");
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<number>>(new Set());
  const [manuellOffen, setManuellOffen] = useState(false);
  const [zuRechnungOffen, setZuRechnungOffen] = useState(false);

  const filter = {
    mitarbeiterId: fMa === "0" ? undefined : Number(fMa),
    customerId: fKu === "0" ? undefined : Number(fKu),
    nurOffen,
    q: q.trim() || undefined,
  };
  const eintraege = trpc.zeit.eintraege.useQuery(filter);

  const freigeben = trpc.zeit.freigeben.useMutation({ onSuccess: () => { onChanged(); setAusgewaehlt(new Set()); } });
  const loeschen = trpc.zeit.eintragLoeschen.useMutation({ onSuccess: onChanged });

  const sort = useSortierung<NonNullable<typeof eintraege.data>[number]>("von");
  const zeilen = sort.sortiere(eintraege.data ?? [], (r, k) =>
    k === "von" ? (r.z.von instanceof Date ? r.z.von.getTime() : 0)
    : k === "mitarbeiter" ? r.mitarbeiterName
    : k === "kunde" ? r.kundeName ?? ""
    : k === "notiz" ? r.z.notiz ?? ""
    : k === "stunden" ? Number(r.stunden)
    : k === "status" ? (r.z.invoiceId ? "2" : r.z.gesperrt ? "1" : "0")
    : null,
  );

  const auswahlOffen = zeilen.filter((r) => ausgewaehlt.has(r.z.id) && !r.z.gesperrt && !r.z.invoiceId && r.z.bis);
  const auswahlKunden = useMemo(() => {
    const set = new Set(auswahlOffen.map((r) => r.z.customerId));
    return set.size === 1 ? [...set][0] : null;
  }, [auswahlOffen]);

  const Kopf = ({ k, label, rechts }: { k: string; label: string; rechts?: boolean }) => (
    <th className={`cursor-pointer select-none px-3 py-2 font-medium ${rechts ? "text-right" : ""}`} onClick={() => sort.umschalten(k)}>
      {label}<sort.KopfIcon k={k} />
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Notiz suchen …" className="w-52 pl-8" />
        </div>
        <Select value={fMa} onValueChange={setFMa}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Alle Mitarbeiter</SelectItem>
            {(mitarbeiter.data ?? []).map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fKu} onValueChange={setFKu}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Alle Kunden</SelectItem>
            {(kunden.data ?? []).map((k) => <SelectItem key={k.id} value={String(k.id)}>{k.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600">
          <input type="checkbox" className="h-4 w-4" checked={nurOffen} onChange={(e) => setNurOffen(e.target.checked)} />
          nur offene
        </label>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setManuellOffen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Manuell anlegen
        </Button>
        <Button variant="outline" size="sm" disabled={auswahlOffen.length === 0 || freigeben.isPending}
          onClick={() => freigeben.mutate({ ids: auswahlOffen.map((r) => r.z.id) })}>
          <Lock className="mr-1.5 h-4 w-4" /> Freigeben ({auswahlOffen.length})
        </Button>
        <Button size="sm" disabled={auswahlKunden === null} onClick={() => setZuRechnungOffen(true)}>
          <FilePlus2 className="mr-1.5 h-4 w-4" /> Zu Rechnung ({auswahlOffen.length})
        </Button>
      </div>
      {freigeben.error && <p className="text-sm text-red-600">{freigeben.error.message}</p>}

      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="px-2 py-2"></th>
                <Kopf k="von" label="Datum" />
                <Kopf k="mitarbeiter" label="Mitarbeiter" />
                <Kopf k="kunde" label="Kunde" />
                <Kopf k="notiz" label="Tätigkeit" />
                <Kopf k="stunden" label="Zeit" rechts />
                <Kopf k="stunden" label="Std." rechts />
                <Kopf k="status" label="Status" />
                <th className="px-2 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((r) => {
                const sperrbar = !r.z.gesperrt && !r.z.invoiceId && r.z.bis;
                return (
                  <tr key={r.z.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-2 py-2">
                      <input type="checkbox" className="h-4 w-4" disabled={!sperrbar}
                        checked={ausgewaehlt.has(r.z.id)}
                        onChange={(e) => {
                          const n = new Set(ausgewaehlt);
                          e.target.checked ? n.add(r.z.id) : n.delete(r.z.id);
                          setAusgewaehlt(n);
                        }} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-neutral-600">
                      {fmtD(r.z.von)} <span className="text-xs text-neutral-400">{fmtZ(r.z.von)}–{r.z.bis ? fmtZ(r.z.bis) : "…"}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.farbe ?? "#0f766e" }} />
                      {r.mitarbeiterName}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{r.kundeName ?? "–"}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-neutral-600">{r.z.notiz ?? "–"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtStd(r.stunden)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{r.stunden}</td>
                    <td className="px-3 py-2">
                      {r.z.invoiceId ? (
                        <Link to={`/rechnungen/${r.z.invoiceId}`} className="text-blue-700 hover:underline">
                          <Badge>abgerechnet</Badge>
                        </Link>
                      ) : r.z.gesperrt ? (
                        <Badge variant="secondary"><Lock className="mr-1 h-3 w-3" />gesperrt</Badge>
                      ) : !r.z.bis ? (
                        <Badge variant="outline" className="text-teal-700">laufend</Badge>
                      ) : (
                        <Badge variant="outline">offen</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!r.z.gesperrt && !r.z.invoiceId && (
                        <Button variant="ghost" size="sm"
                          onClick={() => confirm("Eintrag wirklich löschen?") && loeschen.mutate({ id: r.z.id })}>
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {zeilen.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-neutral-400">
                  {eintraege.isLoading ? "Lade …" : "Keine Einträge — erst stempeln oder manuell anlegen."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {manuellOffen && <ManuellDialog onSchliessen={() => setManuellOffen(false)} onChanged={onChanged} />}
      {zuRechnungOffen && auswahlKunden !== null && (
        <ZuRechnungDialog
          customerId={auswahlKunden}
          eintraege={auswahlOffen}
          produkte={produkte.data ?? []}
          onSchliessen={() => setZuRechnungOffen(false)}
          onErledigt={(rechnungId) => { onChanged(); setAusgewaehlt(new Set()); setZuRechnungOffen(false); window.location.href = `/rechnungen/${rechnungId}`; }}
        />
      )}
    </div>
  );
}

/* ═══ Dialog: Manuell anlegen ═══ */
function ManuellDialog({ onSchliessen, onChanged }: { onSchliessen: () => void; onChanged: () => void }) {
  const mitarbeiter = trpc.zeit.mitarbeiterListe.useQuery();
  const kunden = trpc.customers.list.useQuery();
  const [maId, setMaId] = useState("");
  const [kuId, setKuId] = useState("0");
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  const [vonZ, setVonZ] = useState("08:00");
  const [bisZ, setBisZ] = useState("09:00");
  const [notiz, setNotiz] = useState("");
  const anlegen = trpc.zeit.eintragManuell.useMutation({ onSuccess: () => { onChanged(); onSchliessen(); } });

  return (
    <Dialog open onOpenChange={(o) => !o && onSchliessen()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Zeiteintrag manuell anlegen</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Mitarbeiter *</Label>
            <Select value={maId} onValueChange={setMaId}>
              <SelectTrigger><SelectValue placeholder="Wählen …" /></SelectTrigger>
              <SelectContent>
                {(mitarbeiter.data ?? []).filter((m) => m.aktiv).map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Kunde</Label>
            <Select value={kuId} onValueChange={setKuId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">— ohne —</SelectItem>
                {(kunden.data ?? []).map((k) => <SelectItem key={k.id} value={String(k.id)}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Datum</Label><Input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
            <div><Label>Von</Label><Input type="time" value={vonZ} onChange={(e) => setVonZ(e.target.value)} /></div>
            <div><Label>Bis</Label><Input type="time" value={bisZ} onChange={(e) => setBisZ(e.target.value)} /></div>
          </div>
          <div>
            <Label>Tätigkeit</Label>
            <Textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={2} placeholder="Was wurde gemacht?" />
          </div>
        </div>
        {anlegen.error && <p className="text-sm text-red-600">{anlegen.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onSchliessen}>Abbrechen</Button>
          <Button
            disabled={!maId || anlegen.isPending}
            onClick={() => anlegen.mutate({
              mitarbeiterId: Number(maId),
              customerId: kuId === "0" ? null : Number(kuId),
              von: `${datum} ${vonZ}`,
              bis: `${datum} ${bisZ}`,
              notiz: notiz.trim() || null,
            })}
          >
            {anlegen.isPending ? "Lege an …" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══ Dialog: Zu Rechnung ═══ */
function ZuRechnungDialog({ customerId, eintraege, produkte, onSchliessen, onErledigt }: {
  customerId: number;
  eintraege: { z: { id: number; notiz: string | null; mitarbeiterId: number }; mitarbeiterName: string | null; stunden: string }[];
  produkte: { id: number; name: string; preisNetto: string | null }[];
  onSchliessen: () => void;
  onErledigt: (rechnungId: number) => void;
}) {
  const kunden = trpc.customers.list.useQuery();
  const [produktId, setProduktId] = useState("0");
  const kunde = (kunden.data ?? []).find((k) => k.id === customerId);
  const summe = eintraege.reduce((a, r) => a + Number(r.stunden), 0);
  const zuRechnung = trpc.zeit.zuRechnung.useMutation({ onSuccess: (d) => onErledigt(d.rechnungId) });

  return (
    <Dialog open onOpenChange={(o) => !o && onSchliessen()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Stunden zur Rechnung — {kunde?.name ?? "…"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="max-h-56 overflow-y-auto rounded-md border border-neutral-200">
            {eintraege.map((r) => (
              <div key={r.z.id} className="flex justify-between gap-3 border-b border-neutral-100 px-3 py-1.5 last:border-0">
                <span className="truncate">{r.z.notiz ?? "Arbeitszeit"} <span className="text-neutral-400">({r.mitarbeiterName})</span></span>
                <span className="tabular-nums text-neutral-600">{fmtStd(r.stunden)}</span>
              </div>
            ))}
          </div>
          <p className="text-neutral-600">Summe: <strong>{fmtStd(summe)} Stunden</strong> aus {eintraege.length} Einträgen.</p>
          <div>
            <Label>Stundensatz-Produkt (optional — sonst Mitarbeiter-Satz)</Label>
            <Select value={produktId} onValueChange={setProduktId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">— Mitarbeiter-Stundensatz —</SelectItem>
                {produkte.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}{p.preisNetto ? ` (${geld(p.preisNetto)})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {zuRechnung.error && <p className="text-sm text-red-600">{zuRechnung.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onSchliessen}>Abbrechen</Button>
          <Button
            disabled={zuRechnung.isPending}
            onClick={() =>
              zuRechnung.mutate({
                customerId,
                ids: eintraege.map((r) => r.z.id),
                produktId: produktId === "0" ? null : Number(produktId),
              })
            }
          >
            {zuRechnung.isPending ? "Erzeuge …" : "Rechnungsentwurf erzeugen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══ Tab: Auswertung ═══ */
function AuswertungTab() {
  const heute = new Date();
  const [jahr, setJahr] = useState(heute.getFullYear());
  const [monat, setMonat] = useState(heute.getMonth() + 1);
  const auswertung = trpc.zeit.auswertung.useQuery({ jahr, monat });
  const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => { const d = new Date(jahr, monat - 2, 1); setJahr(d.getFullYear()); setMonat(d.getMonth() + 1); }}>←</Button>
        <span className="min-w-40 text-center font-medium">{MONATE[monat - 1]} {jahr}</span>
        <Button variant="outline" size="sm" onClick={() => { const d = new Date(jahr, monat, 1); setJahr(d.getFullYear()); setMonat(d.getMonth() + 1); }}>→</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(auswertung.data ?? []).map((m) => (
          <div key={m.name} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{m.name}</span>
              <span className="tabular-nums text-lg font-semibold text-teal-700">{fmtStd(m.gesamt)} h</span>
            </div>
            <div className="mt-2 space-y-1">
              {m.kunden.map((k) => (
                <div key={k.kunde} className="flex justify-between text-xs text-neutral-500">
                  <span className="truncate">{k.kunde}</span>
                  <span className="tabular-nums">{fmtStd(k.stunden)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {(auswertung.data ?? []).length === 0 && (
          <p className="text-sm text-neutral-400">
            {auswertung.isLoading ? "Lade …" : "Keine abgeschlossenen Einträge in diesem Monat."}
          </p>
        )}
      </div>
    </div>
  );
}

/* ═══ Tab: Mitarbeiter ═══ */
function MitarbeiterTab({ onChanged }: { onChanged: () => void }) {
  const liste = trpc.zeit.mitarbeiterListe.useQuery();
  const [dialog, setDialog] = useState<{ id?: number; name: string; farbe: string; stundensatz: string; aktiv: boolean } | null>(null);
  const anlegen = trpc.zeit.mitarbeiterAnlegen.useMutation({ onSuccess: () => { onChanged(); setDialog(null); } });
  const aktualisieren = trpc.zeit.mitarbeiterAktualisieren.useMutation({ onSuccess: () => { onChanged(); setDialog(null); } });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialog({ name: "", farbe: "#0f766e", stundensatz: "", aktiv: true })}>
          <Users className="mr-1.5 h-4 w-4" /> Mitarbeiter hinzufügen
        </Button>
      </div>
      <section className="rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <tbody>
            {(liste.data ?? []).map((m) => (
              <tr key={m.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ background: m.farbe }} />
                  <span className="font-medium">{m.name}</span>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-neutral-600">{m.stundensatz ? geld(m.stundensatz) + "/h" : "—"}</td>
                <td className="px-4 py-2.5">{m.aktiv ? <Badge>aktiv</Badge> : <Badge variant="outline">inaktiv</Badge>}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button variant="ghost" size="sm"
                    onClick={() => setDialog({ id: m.id, name: m.name, farbe: m.farbe, stundensatz: m.stundensatz ?? "", aktiv: m.aktiv })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {(liste.data ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-neutral-400">
                {liste.isLoading ? "Lade …" : "Noch keine Mitarbeiter — den ersten anlegen."}
              </td></tr>
            )}
          </tbody>
        </table>
      </section>

      {dialog && (
        <Dialog open onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{dialog.id ? "Mitarbeiter bearbeiten" : "Mitarbeiter hinzufügen"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Farbe</Label>
                  <Input type="color" value={dialog.farbe} onChange={(e) => setDialog({ ...dialog, farbe: e.target.value })} className="h-9 p-1" />
                </div>
                <div>
                  <Label>Stundensatz (€)</Label>
                  <Input value={dialog.stundensatz} onChange={(e) => setDialog({ ...dialog, stundensatz: e.target.value.replace(",", ".") })} placeholder="z. B. 68.00" />
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={dialog.aktiv} onChange={(e) => setDialog({ ...dialog, aktiv: e.target.checked })} />
                aktiv
              </label>
            </div>
            {(anlegen.error ?? aktualisieren.error) && <p className="text-sm text-red-600">{(anlegen.error ?? aktualisieren.error)?.message}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>Abbrechen</Button>
              <Button
                disabled={!dialog.name.trim() || anlegen.isPending || aktualisieren.isPending}
                onClick={() => {
                  const data = { name: dialog.name.trim(), farbe: dialog.farbe, stundensatz: dialog.stundensatz.trim() || null, aktiv: dialog.aktiv };
                  dialog.id ? aktualisieren.mutate({ id: dialog.id, data }) : anlegen.mutate(data);
                }}
              >
                Speichern
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
