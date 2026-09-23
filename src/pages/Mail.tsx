import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw, Search, Paperclip, Brain, Settings2, X, Pencil, FileCheck2, Printer, Star, Pin, PinOff,
  Reply, ExternalLink, Plus, Trash2, ToggleLeft, ToggleRight, MailPlus, UserPlus, Copy,
} from "lucide-react";
import { Link } from "react-router";
import { MailVerfassen, VerfassenSchliessenDialog, type VerfassenStart } from "./MailVerfassen";
import { SeitenEinstellung } from "@/components/SeitenEinstellung";

function datumFmt(d: string | Date | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  const heute = new Date().toDateString();
  if (dt.toDateString() === heute) return dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return dt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

type FilterWahl = "alle" | "ungelesen" | "gelesen" | "markiert" | "gesendet" | "empfangen";
type SortWahl = "datum_desc" | "datum_asc" | "absender_asc" | "absender_desc" | "groesse_desc" | "groesse_asc";

type Tab =
  | { typ: "mail"; id: number; betreff: string; geloest?: { x: number; y: number } }
  | { typ: "verfassen"; schluessel: number; start: VerfassenStart; geloest?: { x: number; y: number } };

function ladeBreite(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function nutzeBreite(key: string, fallback: number, min: number, max: number) {
  const [breite, setBreite] = useState(() => Math.min(max, Math.max(min, ladeBreite(key, fallback))));
  const set = (v: number) => {
    const n = Math.min(max, Math.max(min, v));
    setBreite(n);
    localStorage.setItem(key, String(n));
  };
  return [breite, set] as const;
}

function Resizer({ onDrag }: { onDrag: (dx: number) => void }) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const bewegen = (ev: MouseEvent) => onDrag(ev.clientX - startX);
    const ende = () => {
      window.removeEventListener("mousemove", bewegen);
      window.removeEventListener("mouseup", ende);
    };
    window.addEventListener("mousemove", bewegen);
    window.addEventListener("mouseup", ende);
  };
  return (
    <div
      onMouseDown={start}
      className="w-1.5 shrink-0 cursor-col-resize rounded bg-neutral-200 hover:bg-teal-400 transition-colors"
      title="Breite ziehen"
    />
  );
}

export default function MailPostfach() {
  const postfaecher = trpc.postfach.postfaecher.useQuery();
  const [linksBreite, setLinksBreite] = nutzeBreite("mail-spalte-links", 240, 160, 380);
  const [listeBreite, setListeBreite] = nutzeBreite("mail-spalte-liste", 400, 280, 640);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [aktiv, setAktiv] = useState<Tab | null>(null);
  const [abschlussAktion, setAbschlussAktion] = useState<"loeschen" | "entwurf" | "senden" | null>(null);
  const [aktionZiel, setAktionZiel] = useState<number | null>(null); // schluessel des Verfassen-Tabs
  const [schliessenDialog, setSchliessenDialog] = useState<number | null>(null);
  const [vorschau, setVorschau] = useState<number | null>(null);
  const [kontoId, setKontoId] = useState<number | null>(null);
  const [ordner, setOrdner] = useState<string | null>(null);
  // Toolbar-State (fester Block oben, unabhaengig von Spaltenbreite)
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterWahl>("alle");
  const [sortWahl, setSortWahl] = useState<SortWahl>("datum_desc");
  const [seite, setSeite] = useState(1);

  const oeffneTab = (id: number, betreff: string) => {
    // Schon (gelöst) offen? → wieder andocken statt Doppelansicht
    const vorhanden = tabs.find((x) => x.typ === "mail" && x.id === id);
    if (vorhanden) {
      if (vorhanden.geloest) {
        const angedockt = { ...vorhanden, geloest: undefined };
        setTabs((t) => t.map((x) => (x === vorhanden ? angedockt : x)));
        setAktiv(angedockt);
      } else {
        setAktiv(vorhanden);
      }
      return;
    }
    const tab: Tab = { typ: "mail", id, betreff };
    setTabs((t) => [...t, tab]);
    setAktiv(tab);
  };
  const oeffneVerfassen = (start: VerfassenStart) => {
    const tab: Tab = { typ: "verfassen", schluessel: Date.now(), start };
    setTabs((t) => [...t, tab]);
    setAktiv(tab);
  };
  const schliesseTab = (tab: Tab) => {
    if (tab.typ === "verfassen") {
      // Bei Verfassen-Tabs immer erst fragen (Löschen / Entwurf / Senden)
      setSchliessenDialog(tab.schluessel);
      return;
    }
    setTabs((t) => t.filter((x) => x !== tab));
    if (aktiv === tab) setAktiv(null);
  };

  // Konsistenz-Wache: aktiv darf nie auf einen nicht mehr existierenden Tab zeigen
  useEffect(() => {
    if (!aktiv) return;
    const existiert = tabs.some((t) =>
      aktiv.typ === "mail" ? t.typ === "mail" && t.id === aktiv.id : t.typ === "verfassen" && t.schluessel === aktiv.schluessel,
    );
    if (!existiert) setAktiv(null);
  }, [tabs, aktiv]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-3">
      {/* ── Spalte 1: Konten + Ordner + Regeln (Office-Stil) ── */}
      <div style={{ width: linksBreite }} className="shrink-0">
        <Seitenleiste
          kontoId={kontoId} setKontoId={(v) => { setKontoId(v); setOrdner(null); }}
          ordner={ordner} setOrdner={setOrdner}
          onEntwurfOeffnen={(e) => oeffneVerfassen({
            empfaenger: e.empfaenger ?? "", cc: e.cc ?? "", bcc: e.bcc ?? "",
            betreff: e.betreff ?? "", html: e.text ?? "<p><br></p>",
            kontoId: e.kontoId ?? kontoId, entwurfId: e.id,
            anhaenge: e.anhaengeParsed,
          })}
        />
      </div>
      <Resizer onDrag={(dx) => setLinksBreite(linksBreite + dx)} />

      {/* ── Mitte + Rechts: Tabs ODER Liste+Vorschau ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-2 flex items-center gap-1 overflow-x-auto">
          <button
            onClick={() => setAktiv(null)}
            className={`shrink-0 rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${aktiv === null ? "border-neutral-300 bg-white font-medium" : "border-transparent bg-neutral-100 text-neutral-500 hover:bg-neutral-200"}`}
          >
            Postfach
          </button>
          {tabs.map((t) => {
            const istAktiv = aktiv === t;
            const label = t.typ === "mail" ? (t.betreff || "(kein Betreff)") : "✉ Verfassen";
            const key = t.typ === "mail" ? `m${t.id}` : `v${t.schluessel}`;
            return (
              <div
                key={key}
                className={`flex shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${istAktiv && !t.geloest ? "border-neutral-300 bg-white font-medium" : "border-transparent bg-neutral-100 text-neutral-500 hover:bg-neutral-200"}`}
              >
                <button onClick={() => { if (!t.geloest) setAktiv(t); }} className="max-w-40 truncate" title={t.geloest ? "Als Fenster gelöst" : label}>{label}</button>
                <button
                  onClick={() => {
                    if (t.geloest) {
                      // Wieder anbinden
                      setTabs((alle) => alle.map((x) => (x === t ? { ...x, geloest: undefined } : x)));
                      setAktiv({ ...t, geloest: undefined });
                    } else {
                      // Als eigenes Fenster lösen
                      const pos = { x: 140 + tabs.indexOf(t) * 36, y: 110 + tabs.indexOf(t) * 28 };
                      setTabs((alle) => alle.map((x) => (x === t ? { ...x, geloest: pos } : x)));
                      if (aktiv === t) setAktiv(null);
                    }
                  }}
                  className="rounded p-0.5 hover:bg-neutral-300"
                  title={t.geloest ? "Wieder anbinden" : "Als eigenes Fenster lösen"}
                >
                  {t.geloest ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                </button>
                <button onClick={() => schliesseTab(t)} className="rounded p-0.5 hover:bg-neutral-300"><X className="h-3 w-3" /></button>
              </div>
            );
          })}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <SeitenEinstellung bereich="mailkonten" titel="Mail-Konten" />
            <Button size="sm" onClick={() => oeffneVerfassen({ kontoId })}>
              <Pencil className="mr-1.5 h-4 w-4" /> Verfassen
            </Button>
          </div>
        </div>

        {aktiv === null && (
          <div className="mb-2 flex items-center gap-1.5 overflow-x-auto rounded-lg border border-neutral-200 bg-white p-2">
            <Select value={kontoId === null ? "alle" : String(kontoId)} onValueChange={(v) => { setKontoId(v === "alle" ? null : Number(v)); setSeite(1); }}>
              <SelectTrigger className="h-8 w-28 shrink-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle Postfächer</SelectItem>
                {(postfaecher.data ?? []).map((k) => (
                  <SelectItem key={k.id} value={String(k.id)}>{k.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filter} onValueChange={(v) => { setFilter(v as FilterWahl); setSeite(1); }}>
              <SelectTrigger className="h-8 w-32 shrink-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle Mails</SelectItem>
                <SelectItem value="ungelesen">Ungelesen</SelectItem>
                <SelectItem value="gelesen">Gelesen</SelectItem>
                <SelectItem value="markiert">Markierte</SelectItem>
                <SelectItem value="empfangen">Empfangene</SelectItem>
                <SelectItem value="gesendet">Gesendete</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortWahl} onValueChange={(v) => setSortWahl(v as SortWahl)}>
              <SelectTrigger className="h-8 w-36 shrink-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="datum_desc">Datum ↓</SelectItem>
                <SelectItem value="datum_asc">Datum ↑</SelectItem>
                <SelectItem value="absender_asc">Absender A–Z</SelectItem>
                <SelectItem value="absender_desc">Absender Z–A</SelectItem>
                <SelectItem value="groesse_desc">Größe ↓</SelectItem>
                <SelectItem value="groesse_asc">Größe ↑</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative min-w-[140px] flex-1">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-neutral-400" />
              <Input
                value={q}
                onChange={(e) => { setQ(e.target.value); setSeite(1); }}
                placeholder="Betreff, Absender, Inhalt suchen …"
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
        )}

        {/* Liste + Vorschau (bleibt gemountet, nur versteckt) */}
        <div className={`min-h-0 flex-1 gap-3 ${aktiv === null ? "flex" : "hidden"}`}>
          {/* Spalte 2: Liste (mittig, Outlook) */}
          <div style={{ width: listeBreite }} className="shrink-0">
            <MailListe
              key={`${kontoId ?? "alle"}|${ordner ?? "alle"}`}
              kontoId={kontoId} ordner={ordner}
              vorschau={vorschau} onVorschau={setVorschau}
              q={q} filter={filter} sortWahl={sortWahl}
              seite={seite} setSeite={setSeite}
            />
          </div>
          <Resizer onDrag={(dx) => setListeBreite(listeBreite + dx)} />
          {/* Spalte 3: Vorschau (rechts, Outlook-Lesefenster) */}
          {vorschau !== null && (
            <MailDetail
              key={vorschau}
              id={vorschau}
              kompakt
              onAntworten={oeffneVerfassen}
              onTabOeffnen={oeffneTab}
              onAusklappen={() => {
                const m = vorschau;
                oeffneTab(m, "");
                setVorschau(null);
              }}
              onSchliessen={() => setVorschau(null)}
            />
          )}
        </div>

        {/* Angedockte Tabs: KEEP-ALIVE — alle bleiben gemountet (State/Scroll/Text bleibt),
            nur der aktive ist sichtbar. Gelöste Tabs rendern als Schwebefenster. */}
        {tabs.filter((t) => !t.geloest).map((t) => {
          const istAktiv = aktiv !== null && !t.geloest && (
            (aktiv.typ === "mail" && t.typ === "mail" && aktiv.id === t.id) ||
            (aktiv.typ === "verfassen" && t.typ === "verfassen" && aktiv.schluessel === t.schluessel)
          );
          const schluessel = t.typ === "mail" ? `m${t.id}` : `v${t.schluessel}`;
          return (
            <div key={schluessel} className={istAktiv ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
              {t.typ === "mail" ? (
                <MailDetail id={t.id} kompakt={false} onAntworten={oeffneVerfassen} onTabOeffnen={oeffneTab} onZurueck={() => setAktiv(null)} />
              ) : (
                <MailVerfassen
                  start={t.start}
                  abschlussAktion={aktionZiel === t.schluessel ? abschlussAktion : null}
                  onAktionErledigt={() => {
                    setTabs((alle) => alle.filter((x) => x !== t));
                    if (istAktiv) setAktiv(null);
                    setAbschlussAktion(null);
                    setAktionZiel(null);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Gelöste Tabs als schwebende Fenster ── */}
      {tabs.filter((t) => t.geloest).map((t) => {
        const key = t.typ === "mail" ? `m${t.id}` : `v${t.schluessel}`;
        const titel = t.typ === "mail" ? (t.betreff || "(kein Betreff)") : "✉ Verfassen";
        return (
          <Schwebefenster
            key={key}
            titel={titel}
            start={t.geloest!}
            onAnbinden={() => {
              setTabs((alle) => alle.map((x) => (x === t ? { ...x, geloest: undefined } : x)));
              setAktiv({ ...t, geloest: undefined });
            }}
            onSchliessen={() => schliesseTab(t)}
          >
            {t.typ === "mail" ? (
              <MailDetail key={`f${t.id}`} id={t.id} kompakt={false} onAntworten={oeffneVerfassen} onTabOeffnen={oeffneTab} />
            ) : (
              <MailVerfassen
                key={`f${t.schluessel}`}
                start={t.start}
                abschlussAktion={aktionZiel === t.schluessel ? abschlussAktion : null}
                onAktionErledigt={() => {
                  setTabs((alle) => alle.filter((x) => x !== t));
                  setAbschlussAktion(null);
                  setAktionZiel(null);
                }}
              />
            )}
          </Schwebefenster>
        );
      })}

      {schliessenDialog !== null && (() => {
        const dlg = tabs.find((t) => t.typ === "verfassen" && t.schluessel === schliessenDialog);
        return dlg ? (
          <VerfassenSchliessenDialog
            onWahl={(aktion) => { setAbschlussAktion(aktion); setAktionZiel(schliessenDialog); setSchliessenDialog(null); }}
            onAbbrechen={() => setSchliessenDialog(null)}
          />
        ) : null;
      })()}
    </div>
  );
}

/* ═══ Schwebendes Fenster für gelöste Tabs (verschiebbar, anbindbar) ═══ */
function Schwebefenster({ titel, start, onAnbinden, onSchliessen, children }: {
  titel: string;
  start: { x: number; y: number };
  onAnbinden: () => void;
  onSchliessen: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState(start);
  const ziehen = (e: React.MouseEvent) => {
    e.preventDefault();
    const dx = e.clientX - pos.x;
    const dy = e.clientY - pos.y;
    const bewegen = (ev: MouseEvent) => {
      setPos({ x: Math.max(0, ev.clientX - dx), y: Math.max(0, ev.clientY - dy) });
    };
    const ende = () => {
      window.removeEventListener("mousemove", bewegen);
      window.removeEventListener("mouseup", ende);
    };
    window.addEventListener("mousemove", bewegen);
    window.addEventListener("mouseup", ende);
  };
  return (
    <div
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: "min(820px, 90vw)", height: "min(74vh, 900px)" }}
    >
      <div
        onMouseDown={ziehen}
        className="flex shrink-0 cursor-move items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 select-none"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{titel}</span>
        <button onClick={onAnbinden} className="rounded p-1 text-neutral-500 hover:bg-neutral-200" title="Wieder anbinden">
          <Pin className="h-4 w-4" />
        </button>
        <button onClick={onSchliessen} className="rounded p-1 text-neutral-500 hover:bg-neutral-200" title="Schließen">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-2">{children}</div>
    </div>
  );
}

/* ═══ Spalte 1
}

/* ═══ Spalte 1: Konten + Ordner + Regeln ═══ */
/* ── Postfach-Reihenfolge + Ordner-Favoriten (pro Gerät, localStorage) ── */
type OrdnerFavorit = { kontoId: number; kontoName: string; ordner: string };

function ladeJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function Seitenleiste({ kontoId, setKontoId, ordner, setOrdner, onEntwurfOeffnen }: {
  kontoId: number | null; setKontoId: (v: number | null) => void;
  ordner: string | null; setOrdner: (v: string | null) => void;
  onEntwurfOeffnen: (e: EntwurfEintrag) => void;
}) {
  const postfaecher = trpc.postfach.postfaecher.useQuery();
  const sync = trpc.postfach.syncJetzt.useMutation({ onSuccess: () => postfaecher.refetch() });
  const ordnerErstellen = trpc.postfach.ordnerErstellen.useMutation({ onSettled: () => postfaecher.refetch() });
  const ordnerUmbenennen = trpc.postfach.ordnerUmbenennen.useMutation({ onSettled: () => postfaecher.refetch() });
  const ordnerLoeschen = trpc.postfach.ordnerLoeschen.useMutation({ onSettled: () => postfaecher.refetch() });
  const [reihenfolge, setReihenfolge] = useState<number[]>(() => ladeJson("mail-konto-reihenfolge", []));
  const [favoriten, setFavoriten] = useState<OrdnerFavorit[]>(() => ladeJson("mail-ordner-favoriten", []));
  const [kontext, setKontext] = useState<{ x: number; y: number; fav: OrdnerFavorit } | null>(null);
  const [kontoKontext, setKontoKontext] = useState<{ x: number; y: number; kontoId: number; kontoName: string } | null>(null);
  const [dragKonto, setDragKonto] = useState<number | null>(null);

  // Konten in gespeicherter Reihenfolge (unbekannte hinten anhängen)
  const kontenSortiert = [...(postfaecher.data ?? [])].sort((a, b) => {
    const ia = reihenfolge.indexOf(a.id);
    const ib = reihenfolge.indexOf(b.id);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const speichereReihenfolge = (ids: number[]) => {
    setReihenfolge(ids);
    localStorage.setItem("mail-konto-reihenfolge", JSON.stringify(ids));
  };
  const verschiebeKonto = (vonId: number, aufId: number) => {
    const ids = kontenSortiert.map((k) => k.id).filter((id) => id !== vonId);
    ids.splice(ids.indexOf(aufId), 0, vonId);
    speichereReihenfolge(ids);
  };
  const speichereFavoriten = (liste: OrdnerFavorit[]) => {
    setFavoriten(liste);
    localStorage.setItem("mail-ordner-favoriten", JSON.stringify(liste));
  };
  const istFavorit = (kId: number, o: string) => favoriten.some((f) => f.kontoId === kId && f.ordner === o);
  const umschalteFavorit = (fav: OrdnerFavorit) => {
    speichereFavoriten(
      istFavorit(fav.kontoId, fav.ordner)
        ? favoriten.filter((f) => !(f.kontoId === fav.kontoId && f.ordner === fav.ordner))
        : [...favoriten, fav],
    );
  };

  return (
    <div className="h-full space-y-1 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3" onClick={() => { setKontext(null); setKontoKontext(null); }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Postfächer</span>
        <Link to="/einstellungen" title="Konten verwalten">
          <Settings2 className="h-3.5 w-3.5 text-neutral-400 hover:text-neutral-600" />
        </Link>
      </div>

      {/* ── Favoriten-Fächer (per Rechtsklick auf einen Ordner) ── */}
      {favoriten.length > 0 && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50/60 p-1.5">
          <span className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-amber-700">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Favoriten
          </span>
          {favoriten.map((f) => (
            <button
              key={`${f.kontoId}|${f.ordner}`}
              onClick={() => { setKontoId(f.kontoId); setOrdner(f.ordner); }}
              onContextMenu={(e) => { e.preventDefault(); setKontext({ x: e.clientX, y: e.clientY, fav: f }); }}
              className={`flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left text-xs ${kontoId === f.kontoId && ordner === f.ordner ? "bg-amber-100 font-medium" : "hover:bg-amber-100/70"}`}
              title={`${f.kontoName} → ${f.ordner} (Rechtsklick: entfernen)`}
            >
              <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
              <span className="truncate">{f.ordner}</span>
              <span className="truncate text-amber-600/70">· {f.kontoName}</span>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => setKontoId(null)}
        className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${kontoId === null ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"}`}
      >
        Alle Konten
      </button>
      {kontenSortiert.map((k) => (
        <div
          key={k.id}
          draggable
          onDragStart={() => setDragKonto(k.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (dragKonto !== null && dragKonto !== k.id) verschiebeKonto(dragKonto, k.id); setDragKonto(null); }}
          onDragEnd={() => setDragKonto(null)}
          className={dragKonto === k.id ? "opacity-40" : ""}
          title="Ziehen zum Umsortieren"
        >
          <div className="flex items-center gap-1">
            <button
              onClick={() => setKontoId(k.id)}
              onContextMenu={(e) => { e.preventDefault(); setKontext(null); setKontoKontext({ x: e.clientX, y: e.clientY, kontoId: k.id, kontoName: k.name }); }}
              className={`flex-1 cursor-grab truncate rounded-md px-2 py-1.5 text-left text-sm active:cursor-grabbing ${kontoId === k.id && !ordner ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"}`}
              title={`${k.benutzer} (Rechtsklick: Neuer Ordner)`}
            >
              {k.name}
            </button>
            <button
              title="Jetzt abrufen (alle Fächer)"
              disabled={sync.isPending}
              onClick={() => sync.mutate({ kontoId: k.id })}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
            </button>
          </div>
          {kontoId === k.id && k.ordner.map((o) => (
            <button
              key={o.name}
              onClick={() => setOrdner(ordner === o.name ? null : o.name)}
              onContextMenu={(e) => { e.preventDefault(); setKontext({ x: e.clientX, y: e.clientY, fav: { kontoId: k.id, kontoName: k.name, ordner: o.name } }); }}
              className={`ml-3 flex w-[calc(100%-12px)] items-center justify-between rounded-md px-2 py-1 text-left text-xs ${ordner === o.name ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50 text-neutral-600"}`}
              title={`${o.name} (Rechtsklick: Favorit)`}
            >
              <span className="flex min-w-0 items-center gap-1 truncate">
                {istFavorit(k.id, o.name) && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
                <span className="truncate">{o.name}</span>
              </span>
              <span className="text-neutral-400">
                {o.ungelesen > 0 ? <Badge variant="default" className="text-[10px]">{o.ungelesen}</Badge> : o.anzahl > 0 ? o.anzahl : ""}
              </span>
            </button>
          ))}
          {k.letzterFehler && <p className="ml-3 mt-0.5 text-[10px] text-red-500" title={k.letzterFehler}>Abruffehler</p>}
        </div>
      ))}
      {(postfaecher.data ?? []).length === 0 && !postfaecher.isLoading && (
        <p className="px-2 py-4 text-xs text-neutral-400">
          Noch keine Konten — in den <Link to="/einstellungen" className="underline">Einstellungen</Link> anlegen.
        </p>
      )}
      <EntwuerfeSektion onOeffnen={onEntwurfOeffnen} />
      <AusgangSektion />
      <RegelnSektion />

      {/* ── Rechtsklick-Menü (Favoriten + Ordner-Aktionen) ── */}
      {kontext && (
        <div
          className="fixed z-50 rounded-md border border-neutral-200 bg-white py-1 shadow-xl"
          style={{ left: kontext.x, top: kontext.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100"
            onClick={() => { umschalteFavorit(kontext.fav); setKontext(null); }}
          >
            <Star className={`h-3.5 w-3.5 ${istFavorit(kontext.fav.kontoId, kontext.fav.ordner) ? "fill-amber-400 text-amber-400" : "text-neutral-400"}`} />
            {istFavorit(kontext.fav.kontoId, kontext.fav.ordner) ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100"
            onClick={() => {
              const neu = window.prompt(`Ordner „${kontext.fav.ordner}" umbenennen in:`, kontext.fav.ordner);
              if (neu?.trim() && neu.trim() !== kontext.fav.ordner) {
                ordnerUmbenennen.mutate({ kontoId: kontext.fav.kontoId, alt: kontext.fav.ordner, neu: neu.trim() });
              }
              setKontext(null);
            }}
          >
            <Pencil className="h-3.5 w-3.5 text-neutral-400" /> Ordner umbenennen
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              if (window.confirm(`Ordner „${kontext.fav.ordner}" wirklich löschen? (Mails darin werden serverseitig mitgelöscht!)`)) {
                ordnerLoeschen.mutate({ kontoId: kontext.fav.kontoId, name: kontext.fav.ordner });
              }
              setKontext(null);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Ordner löschen
          </button>
        </div>
      )}

      {/* ── Rechtsklick-Menü (Konto: Neuer Ordner) ── */}
      {kontoKontext && (
        <div
          className="fixed z-50 rounded-md border border-neutral-200 bg-white py-1 shadow-xl"
          style={{ left: kontoKontext.x, top: kontoKontext.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100"
            onClick={() => {
              const name = window.prompt(`Neuer Ordner in „${kontoKontext.kontoName}" (Unterordner mit /, z. B. INBOX/Buchhaltung):`, "");
              if (name?.trim()) ordnerErstellen.mutate({ kontoId: kontoKontext.kontoId, name: name.trim() });
              setKontoKontext(null);
            }}
          >
            <Plus className="h-3.5 w-3.5 text-neutral-400" /> Neuer Ordner …
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══ Adress-Interaktion: Klick auf Absender/Empfänger ═══ */
function AdressChip({ name, adresse, onKlick }: {
  name: string | null; adresse: string; onKlick: (v: { name: string | null; adresse: string }) => void;
}) {
  return (
    <button
      onClick={() => onKlick({ name, adresse })}
      className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 hover:bg-teal-100 hover:text-teal-800"
      title={`${adresse} — Aktionen anzeigen`}
    >
      {name ? `${name} ‹${adresse}›` : adresse}
    </button>
  );
}

function AdressDialog({ name, adresse, kontoId, onMail, onSchliessen }: {
  name: string | null; adresse: string; kontoId: number | null;
  onMail: (s: VerfassenStart) => void; onSchliessen: () => void;
}) {
  const utils = trpc.useUtils();
  const anlegen = trpc.kontakte.anlegen.useMutation();
  const [kontakt, setKontakt] = useState<{ id: number; name: string; firma: string | null; telefon: string | null } | "laden" | null>("laden");
  const [kopiert, setKopiert] = useState(false);
  const [erstellt, setErstellt] = useState<number | null>(null);

  useEffect(() => {
    let aktiv = true;
    utils.kontakte.liste.fetch({ q: adresse })
      .then((r) => { if (aktiv) setKontakt(r.find((k) => k.email.toLowerCase() === adresse.toLowerCase()) ?? null); })
      .catch(() => aktiv && setKontakt(null));
    return () => { aktiv = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adresse]);

  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(adresse);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 1500);
    } catch {
      window.prompt("Adresse kopieren (Strg+C):", adresse); // HTTP-Fallback
    }
  };

  const kontaktErstellen = () => {
    anlegen.mutate(
      { name: name ?? adresse.split("@")[0], email: adresse },
      { onSuccess: (r) => { setErstellt(r.id); utils.kontakte.liste.invalidate(); } },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onSchliessen}>
      <div className="w-80 rounded-xl border border-neutral-200 bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-semibold">{name ?? adresse.split("@")[0]}</span>
          <button onClick={onSchliessen} className="rounded p-1 text-neutral-400 hover:bg-neutral-100"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 break-all text-xs text-neutral-500">{adresse}</p>

        {kontakt === "laden" ? (
          <p className="mb-3 text-xs text-neutral-400">Kartei wird geprüft …</p>
        ) : kontakt ? (
          <div className="mb-3 rounded-md bg-teal-50 p-2 text-xs">
            <p className="font-medium text-teal-800">Kontakt in der Kartei #{kontakt.id}</p>
            <p className="text-teal-700">{kontakt.name}{kontakt.firma ? ` · ${kontakt.firma}` : ""}{kontakt.telefon ? ` · ${kontakt.telefon}` : ""}</p>
            <Link to="/kontakte" className="mt-1 inline-block text-teal-700 underline">In Kartei öffnen</Link>
          </div>
        ) : erstellt ? (
          <p className="mb-3 rounded-md bg-green-50 p-2 text-xs text-green-800">Kontakt erstellt (#{erstellt}) — sichtbar in der Kartei.</p>
        ) : (
          <p className="mb-3 text-xs text-neutral-400">Noch kein Kontakt in der Kartei.</p>
        )}

        <div className="flex flex-col gap-1.5">
          <Button size="sm" onClick={() => { onMail({ kontoId, empfaenger: adresse, betreff: "", html: "<p><br></p>" }); onSchliessen(); }}>
            <MailPlus className="mr-1.5 h-4 w-4" /> Mail an {adresse.split("@")[0]}
          </Button>
          {!kontakt && !erstellt && kontakt !== "laden" && (
            <Button size="sm" variant="outline" onClick={kontaktErstellen} disabled={anlegen.isPending}>
              <UserPlus className="mr-1.5 h-4 w-4" /> Kontakt erstellen
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={kopieren}>
            <Copy className="mr-1.5 h-4 w-4" /> {kopiert ? "Kopiert ✓" : "Adresse kopieren"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══ Entwürfe (inkl. KI-vorbereitete, Quelle „agent") ═══ */
interface EntwurfEintrag {
  id: number; empfaenger: string | null; cc: string | null; bcc: string | null;
  kontoId: number | null; betreff: string | null; text: string | null;
  anhaenge: string | null; quelle: string; updatedAt: string | Date;
  anhaengeParsed?: { dateiname: string; base64: string; mime: string }[];
}

function EntwuerfeSektion({ onOeffnen }: { onOeffnen: (e: EntwurfEintrag) => void }) {
  const entwuerfe = trpc.postfach.entwuerfe.useQuery(undefined, { refetchInterval: 30000 });
  const liste = ((entwuerfe.data ?? []) as (EntwurfEintrag & { status?: string })[]).filter(
    (e) => (e.status ?? "entwurf") === "entwurf",
  );
  if (liste.length === 0) return null;
  return (
    <div className="mt-3 border-t border-neutral-100 pt-2">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Entwürfe ({liste.length})</span>
      <div className="mt-1 space-y-0.5">
        {liste.map((e) => {
          let anhaengeParsed: EntwurfEintrag["anhaengeParsed"] = [];
          try { anhaengeParsed = e.anhaenge ? JSON.parse(e.anhaenge) : []; } catch { /* egal */ }
          return (
            <button
              key={e.id}
              onClick={() => onOeffnen({ ...e, anhaengeParsed })}
              className="w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-teal-50"
              title={e.empfaenger ?? ""}
            >
              <span className="flex items-center gap-1.5">
                {e.quelle === "agent" && <Brain className="h-3 w-3 shrink-0 text-teal-600" />}
                <span className="truncate font-medium">{e.betreff || "(kein Betreff)"}</span>
                {(anhaengeParsed?.length ?? 0) > 0 && <span className="text-neutral-400">📎{anhaengeParsed!.length}</span>}
              </span>
              <span className="block truncate text-neutral-400">an {e.empfaenger || "—"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══ Ausgang (Zwischenpforte: Versand läuft / fehlgeschlagen) ═══ */
function AusgangSektion() {
  const utils = trpc.useUtils();
  const entwuerfe = trpc.postfach.entwuerfe.useQuery(undefined, { refetchInterval: 10000 });
  const entwurfSenden = trpc.postfach.entwurfSenden.useMutation({ onSettled: () => entwuerfe.refetch() });
  const ausgangZurueck = trpc.postfach.ausgangZurueck.useMutation({ onSettled: () => entwuerfe.refetch() });
  void utils;
  const liste = ((entwuerfe.data ?? []) as { id: number; betreff: string | null; empfaenger: string | null; status?: string; versandFehler?: string | null; geplantesSendenAm?: string | Date | null }[])
    .filter((e) => e.status === "ausgang");
  if (liste.length === 0) return null;
  return (
    <div className="mt-3 border-t border-neutral-100 pt-2">
      <span className="text-xs font-medium uppercase tracking-wide text-amber-600">Ausgang ({liste.length})</span>
      <div className="mt-1 space-y-0.5">
        {liste.map((e) => (
          <div key={e.id} className="rounded-md bg-amber-50/70 px-2 py-1.5 text-xs">
            <span className="block truncate font-medium">{e.betreff || "(kein Betreff)"}</span>
            <span className="block truncate text-neutral-500">an {e.empfaenger || "—"}</span>
            {e.versandFehler ? (
              <>
                <span className="mt-0.5 block text-red-600" title={e.versandFehler}>Fehler: {e.versandFehler.slice(0, 80)}</span>
                <span className="mt-1 flex gap-2">
                  <button
                    className="text-teal-700 hover:underline"
                    disabled={entwurfSenden.isPending}
                    onClick={() => entwurfSenden.mutate({ id: e.id })}
                  >
                    Erneut senden
                  </button>
                  <button
                    className="text-neutral-500 hover:underline"
                    onClick={() => ausgangZurueck.mutate({ id: e.id })}
                  >
                    → Entwürfe
                  </button>
                </span>
              </>
            ) : e.geplantesSendenAm ? (
              <>
                <span className="mt-0.5 block text-amber-700">
                  geplant: {new Date(e.geplantesSendenAm).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <button
                  className="mt-0.5 text-teal-700 hover:underline"
                  onClick={() => ausgangZurueck.mutate({ id: e.id })}
                >
                  Rückgängig (zurück zu Entwürfen)
                </button>
              </>
            ) : (
              <span className="mt-0.5 flex items-center gap-1.5 text-amber-700">
                <RefreshCw className="h-3 w-3 animate-spin" /> wird versendet …
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ Auto-Routing-Regeln (Seitenleiste) ═══ */
function RegelnSektion() {
  const regeln = trpc.postfach.regeln.useQuery();
  const kategorien = trpc.kontierung.kategorien.useQuery();
  const anlegen = trpc.postfach.regelAnlegen.useMutation({ onSuccess: () => regeln.refetch() });
  const loeschen = trpc.postfach.regelLoeschen.useMutation({ onSuccess: () => regeln.refetch() });
  const umschalten = trpc.postfach.regelUmschalten.useMutation({ onSuccess: () => regeln.refetch() });

  const [offen, setOffen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [feld, setFeld] = useState<"absender" | "betreff">("absender");
  const [postTyp, setPostTyp] = useState<"rechnung" | "sonstiges">("rechnung");
  const [kategorieId, setKategorieId] = useState<string>("");

  return (
    <div className="mt-4 border-t border-neutral-200 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Auto-Regeln</span>
        <button
          onClick={() => setOffen(!offen)}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          title="Neue Regel"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {(regeln.data ?? []).map((r) => (
        <div key={r.id} className="mb-1 flex items-center gap-1 rounded-md bg-neutral-50 px-2 py-1 text-xs">
          <button onClick={() => umschalten.mutate({ id: r.id, aktiv: !r.aktiv })} title={r.aktiv ? "Deaktivieren" : "Aktivieren"}>
            {r.aktiv ? <ToggleRight className="h-3.5 w-3.5 text-teal-600" /> : <ToggleLeft className="h-3.5 w-3.5 text-neutral-400" />}
          </button>
          <span className="min-w-0 flex-1 truncate" title={`${r.feld}: ${r.pattern}`}>
            {r.pattern} → {r.postTyp}
          </span>
          <button onClick={() => loeschen.mutate({ id: r.id })} className="text-neutral-400 hover:text-red-600">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      {(regeln.data ?? []).length === 0 && (
        <p className="px-1 py-1 text-[11px] text-neutral-400">Keine Regeln — Mails landen im Konto-Standard.</p>
      )}
      {offen && (
        <div className="mt-2 space-y-1.5 rounded-md border border-neutral-200 p-2">
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Muster (z. B. Stadtwerke|Strom)"
            className="h-8 text-xs"
          />
          <div className="flex gap-1">
            <Select value={feld} onValueChange={(v) => setFeld(v as typeof feld)}>
              <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="absender">Absender</SelectItem>
                <SelectItem value="betreff">Betreff</SelectItem>
              </SelectContent>
            </Select>
            <Select value={postTyp} onValueChange={(v) => setPostTyp(v as typeof postTyp)}>
              <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rechnung">Rechnung</SelectItem>
                <SelectItem value="sonstiges">Sonstiges</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Select value={kategorieId} onValueChange={setKategorieId}>
            <SelectTrigger className="h-8 w-full text-xs"><SelectValue placeholder="Kategorie (optional)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">— keine —</SelectItem>
              {(kategorien.data ?? []).map((k: { id: number; name: string }) => (
                <SelectItem key={k.id} value={String(k.id)}>{k.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="w-full"
            disabled={!pattern.trim() || anlegen.isPending}
            onClick={() =>
              anlegen.mutate(
                { pattern: pattern.trim(), feld, postTyp, kategorieId: kategorieId ? Number(kategorieId) : null },
                { onSuccess: () => { setPattern(""); setKategorieId(""); setOffen(false); } },
              )
            }
          >
            Regel anlegen
          </Button>
        </div>
      )}
    </div>
  );
}

/* ═══ Spalte 2: Mail-Liste ═══ */
function MailListe({ kontoId, ordner, vorschau, onVorschau, q, filter, sortWahl, seite, setSeite }: {
  kontoId: number | null; ordner: string | null;
  vorschau: number | null; onVorschau: (v: number | null) => void;
  q: string;
  filter: FilterWahl;
  sortWahl: SortWahl;
  seite: number;
  setSeite: (v: number) => void;
}) {

  const [sortBy, sortDir] = sortWahl.split("_") as ["datum" | "absender" | "groesse", "asc" | "desc"];
  const liste = trpc.postfach.liste.useQuery({
    kontoId: kontoId ?? undefined,
    ordner: ordner ?? undefined,
    q: q || undefined,
    filter: filter === "alle" ? undefined : filter,
    sortBy,
    sortDir,
    seite,
  });
  const gesamtSeiten = liste.data ? Math.max(1, Math.ceil(liste.data.gesamt / liste.data.proSeite)) : 1;
  const markieren = trpc.postfach.markieren.useMutation();

  return (
    <div className="flex h-full flex-col rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {liste.error && <p className="p-4 text-sm text-red-600">Fehler beim Laden: {liste.error.message}</p>}
        {liste.isLoading && <p className="p-4 text-sm text-neutral-400">Lade …</p>}
        {liste.data?.mails.length === 0 && (
          <p className="p-4 text-sm text-neutral-400">Keine Mails — Sync-Button am Konto drücken oder Intervall abwarten.</p>
        )}
        {(liste.data?.mails ?? []).map((m) => (
          <button
            key={m.id}
            onClick={() => onVorschau(vorschau === m.id ? null : m.id)}
            className={`flex w-full flex-col border-b border-neutral-100 px-3 py-2 text-left hover:bg-neutral-50 ${vorschau === m.id ? "bg-teal-50 border-l-2 border-l-teal-600" : ""} ${!m.gelesen ? "bg-teal-50/30" : ""}`}
          >
            <div className="flex w-full items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${!m.gelesen ? "bg-teal-600" : "bg-transparent"}`} />
              <span className={`min-w-0 flex-1 truncate text-sm ${!m.gelesen ? "font-semibold" : "font-medium"}`}>
                {m.absenderName || m.absenderAdresse || "—"}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">{datumFmt(m.datum)}</span>
            </div>
            <div className="mt-0.5 flex w-full items-center gap-2 pl-4">
              <span className={`min-w-0 flex-1 truncate text-xs ${!m.gelesen ? "text-neutral-700" : "text-neutral-500"}`}>
                {m.betreff || "(kein Betreff)"}
              </span>
              <Brain
                className={`h-3.5 w-3.5 shrink-0 ${m.markiert ? "text-teal-600 fill-teal-600/20" : "text-neutral-300 hover:text-neutral-500"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  markieren.mutate({ id: m.id, markiert: !m.markiert }, { onSuccess: () => liste.refetch() });
                }}
              />
              {m.anzahlAnhaenge > 0 && <Paperclip className="h-3 w-3 shrink-0 text-neutral-400" />}
            </div>
          </button>
        ))}
      </div>
      {liste.data && liste.data.gesamt > liste.data.proSeite && (
        <div className="flex items-center justify-between border-t border-neutral-200 px-2.5 py-1.5 text-sm">
          <Button variant="ghost" size="sm" disabled={seite <= 1} onClick={() => setSeite(seite - 1)}>←</Button>
          <span className="text-[11px] text-neutral-500">{seite}/{gesamtSeiten}</span>
          <Button variant="ghost" size="sm" disabled={seite >= gesamtSeiten} onClick={() => setSeite(seite + 1)}>→</Button>
        </div>
      )}
    </div>
  );
}

/* Zitat-Block für Antworten/Weiterleiten (mail-sicheres HTML) */
function zitatBlock(m: { betreff?: string | null; absenderName?: string | null; absenderAdresse?: string | null; datum?: Date | string | null; textPlain?: string | null; textHtml?: string | null }): string {
  const kopf = `--- Originalnachricht --- Von: ${m.absenderName ?? m.absenderAdresse ?? "?"} · ${m.betreff ?? ""}`;
  const inhalt = m.textHtml ?? (m.textPlain ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  return `<blockquote style="border-left:2px solid #d6d3d1;padding-left:8px;color:#57534e"><p style="font-size:12px;color:#78716c">${kopf.replace(/</g, "&lt;")}</p>${inhalt}</blockquote>`;
}

/* ═══ Spalte 3: Detail / Vorschau ═══ */
function MailDetail({ id, kompakt, onAntworten, onTabOeffnen, onAusklappen, onSchliessen, onZurueck }: {
  id: number;
  kompakt: boolean;
  onAntworten: (m: VerfassenStart) => void;
  onTabOeffnen: (id: number, betreff: string) => void;
  onAusklappen?: () => void;
  onSchliessen?: () => void;
  onZurueck?: () => void;
}) {
  const mail = trpc.postfach.einzel.useQuery({ id });
  const utils = trpc.useUtils();
  const alsBeleg = trpc.postfach.alsBeleg.useMutation();
  const markieren = trpc.postfach.markieren.useMutation();
  const [belegOk, setBelegOk] = useState<string | null>(null);
  const [adressDialog, setAdressDialog] = useState<{ name: string | null; adresse: string } | null>(null);

  const anhangLaden = async (index: number) => {
    // Gesendet-Anhänge tragen den Inhalt direkt im Meta (kein Server-Fetch nötig)
    const meta = mail.data?.anhaengeMeta?.[index] as { inhalt?: string; name?: string; mime?: string } | undefined;
    const r = meta?.inhalt
      ? { base64: meta.inhalt, dateiname: meta.name ?? "anhang", mime: meta.mime ?? "application/octet-stream" }
      : await utils.postfach.anhang.fetch({ mailId: id, index });
    const blob = new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], { type: r.mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = r.dateiname;
    a.click();
  };

  if (mail.isLoading) return <div className="flex-1 rounded-lg border border-neutral-200 bg-white p-5 text-sm text-neutral-400">Lade …</div>;
  if (!mail.data) return <div className="flex-1 rounded-lg border border-neutral-200 bg-white p-5 text-sm text-red-600">Mail nicht gefunden.</div>;
  const m = mail.data;

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 p-3.5">
        <div className="mb-1.5 flex items-center gap-1.5">
          {onZurueck && (
            <button onClick={onZurueck} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100" title="Zurück zur Liste">
              <Reply className="h-3.5 w-3.5 -scale-x-100" /> Liste
            </button>
          )}
          {kompakt && onSchliessen && (
            <button onClick={onSchliessen} className="rounded p-1 text-neutral-400 hover:bg-neutral-100" title="Vorschau schließen">
              <X className="h-4 w-4" />
            </button>
          )}
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{m.betreff || "(kein Betreff)"}</h2>
          <span title={m.markiert ? "Markierung entfernen" : "Markieren"}>
            <Brain
              className={`h-4 w-4 shrink-0 cursor-pointer ${m.markiert ? "text-teal-600 fill-teal-600/20" : "text-neutral-300 hover:text-neutral-500"}`}
              onClick={() => markieren.mutate({ id, markiert: !m.markiert }, { onSuccess: () => mail.refetch() })}
            />
          </span>
          {kompakt && onAusklappen && (
            <button onClick={onAusklappen} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="In Tab ausklappen">
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="text-xs text-neutral-600">
          <div className="flex flex-wrap items-center gap-1">
            <strong>Von:</strong>
            {m.absenderAdresse
              ? <AdressChip name={m.absenderName} adresse={m.absenderAdresse} onKlick={setAdressDialog} />
              : <span className="text-neutral-400">—</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <strong>An:</strong>
            {(m.empfaenger ?? "").split(",").map((x) => x.trim()).filter((x) => x.includes("@")).length > 0
              ? (m.empfaenger ?? "").split(",").map((x) => x.trim()).filter((x) => x.includes("@")).map((x) => {
                  const match = x.match(/^"?([^"<]+)"?\s*<([^>]+)>$/);
                  return <AdressChip key={x} name={match ? match[1].trim() : null} adresse={match ? match[2].trim() : x} onKlick={setAdressDialog} />;
                })
              : <span className="text-neutral-400">{m.empfaenger || "—"}</span>}
          </div>
          <div className="mt-0.5">{m.datum ? new Date(m.datum).toLocaleString("de-DE") : "—"} · {m.ordner}</div>
        </div>
        {adressDialog && (
          <AdressDialog
            name={adressDialog.name}
            adresse={adressDialog.adresse}
            kontoId={m.kontoId}
            onMail={onAntworten}
            onSchliessen={() => setAdressDialog(null)}
          />
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline" size="sm"
            onClick={() => {
              const zitatHtml = zitatBlock(m);
              onAntworten({
                kontoId: m.kontoId,
                empfaenger: m.absenderAdresse ?? "",
                betreff: m.betreff?.startsWith("Re:") ? m.betreff : `Re: ${m.betreff ?? ""}`,
                html: `<p><br></p>${zitatHtml}`,
                inReplyTo: m.messageId ?? null,
                references: m.messageId ?? null,
              });
            }}
          >
            <Reply className="mr-1.5 h-4 w-4" /> Antworten
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => {
              const zitatHtml = zitatBlock(m);
              const andere = (m.empfaenger ?? "")
                .split(",")
                .map((x: string) => x.trim())
                .filter((x: string) => x && !x.includes("@"));
              onAntworten({
                kontoId: m.kontoId,
                empfaenger: m.absenderAdresse ?? "",
                cc: andere.join(", "),
                betreff: m.betreff?.startsWith("Re:") ? m.betreff : `Re: ${m.betreff ?? ""}`,
                html: `<p><br></p>${zitatHtml}`,
                inReplyTo: m.messageId ?? null,
                references: m.messageId ?? null,
              });
            }}
            title="An Absender + alle Empfänger"
          >
            Allen Antworten
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => {
              const zitatHtml = zitatBlock(m);
              onAntworten({
                kontoId: m.kontoId,
                betreff: m.betreff?.startsWith("Fwd:") ? m.betreff : `Fwd: ${m.betreff ?? ""}`,
                html: `<p><br></p>${zitatHtml}`,
              });
            }}
            title="Mail weiterleiten"
          >
            Weiterleiten
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => onTabOeffnen(id, m.betreff ?? "")}
            title="Diese Mail in einem extra Tab öffnen"
          >
            <ExternalLink className="mr-1.5 h-4 w-4" /> Tab öffnen
          </Button>
          <Button
            size="sm" variant="outline"
            disabled={alsBeleg.isPending}
            onClick={() => alsBeleg.mutate({ mailId: id }, { onSuccess: (r) => setBelegOk(`Beleg #${r.belegId} angelegt`) })}
          >
            <FileCheck2 className="mr-1.5 h-4 w-4" /> Als Beleg
          </Button>
          <Button
            size="sm" variant="outline"
            title="Drucken bzw. als PDF speichern (im Druckdialog „Als PDF speichern“ wählen)"
            onClick={() => {
              const w = window.open("", "_blank", "width=820,height=1000");
              if (!w) return;
              const inhalt = m.textHtml ?? `<pre style="white-space:pre-wrap;font-family:sans-serif">${(m.textPlain ?? "").replace(/</g, "&lt;")}</pre>`;
              w.document.write(`<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${(m.betreff ?? "Mail").replace(/</g, "&lt;")}</title>
<style>
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #171412; margin: 32px; }
  .kopf { border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { font-size: 19px; margin: 0 0 8px; }
  .meta { font-size: 12.5px; color: #5b564f; line-height: 1.6; }
  .meta b { color: #171412; }
  @media print { body { margin: 12mm; } }
</style></head><body>
<div class="kopf"><h1>${(m.betreff ?? "(kein Betreff)").replace(/</g, "&lt;")}</h1>
<div class="meta"><b>Von:</b> ${(m.absenderName ? `${m.absenderName} &lt;${m.absenderAdresse}&gt;` : m.absenderAdresse ?? "—")}<br>
<b>An:</b> ${(m.empfaenger ?? "—").replace(/</g, "&lt;")}<br>
<b>Datum:</b> ${m.datum ? new Date(m.datum).toLocaleString("de-DE") : "—"}</div></div>
${inhalt}
<script>window.onload = () => setTimeout(() => window.print(), 250);</script>
</body></html>`);
              w.document.close();
            }}
          >
            <Printer className="mr-1.5 h-4 w-4" /> Drucken / PDF
          </Button>
        </div>
        {belegOk && <p className="mt-2 rounded-md bg-green-50 px-3 py-1.5 text-xs text-green-800">{belegOk} — Betrag in Eingangsbelege nachtragen.</p>}
        {alsBeleg.error && <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">{alsBeleg.error.message}</p>}
        {m.anhaengeMeta.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {m.anhaengeMeta.map((a, i) => {
              const hatInhalt = Boolean(a.postEingangId) || Boolean((a as { inhalt?: string }).inhalt);
              return (
                <div key={i} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${hatInhalt ? "cursor-pointer border-neutral-200 hover:border-teal-300 hover:bg-teal-50" : "border-neutral-200"}`}
                  onClick={() => hatInhalt && anhangLaden(i)}
                  title={hatInhalt ? "Anhang öffnen/herunterladen" : "Anhang (nur Metadaten)"}
                >
                  <Paperclip className="h-3 w-3 text-neutral-500" />
                  <span className="max-w-32 truncate">{a.name}</span>
                  <span className="text-neutral-400">({Math.round(a.groesse / 1024)} KB)</span>
                  {a.postEingangId && (
                    <button
                      className="text-teal-700 hover:underline"
                      disabled={alsBeleg.isPending}
                      onClick={(e) => { e.stopPropagation(); alsBeleg.mutate({ mailId: id, anhangIndex: i }, { onSuccess: (r) => setBelegOk(`Beleg #${r.belegId} angelegt`) }); }}
                    >
                      → Beleg
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {m.textHtml ? (
          <iframe sandbox="" title="Mail-Inhalt" srcDoc={m.textHtml} className="h-full min-h-[380px] w-full rounded-md border border-neutral-100" />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-800">{(m.textPlain ?? "").replace(/\t/g, "    ") || "(kein Text)"}</pre>
        )}
      </div>
    </div>

  );
}
