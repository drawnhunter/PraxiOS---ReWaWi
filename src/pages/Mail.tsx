import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw, Search, Paperclip, Brain, Settings2, X, Pencil, FileCheck2,
  Reply, ExternalLink, Plus, Trash2, ToggleLeft, ToggleRight,
} from "lucide-react";
import { Link } from "react-router";
import { MailVerfassen, VerfassenSchliessenDialog, type VerfassenStart } from "./MailVerfassen";

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
  | { typ: "mail"; id: number; betreff: string }
  | { typ: "verfassen"; schluessel: number; start: VerfassenStart };

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
    const tab: Tab = { typ: "mail", id, betreff };
    setTabs((t) => (t.some((x) => x.typ === "mail" && x.id === id) ? t : [...t, tab]));
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

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-3">
      {/* ── Spalte 1: Konten + Ordner + Regeln (Office-Stil) ── */}
      <div style={{ width: linksBreite }} className="shrink-0">
        <Seitenleiste
          kontoId={kontoId} setKontoId={(v) => { setKontoId(v); setOrdner(null); }}
          ordner={ordner} setOrdner={setOrdner}
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
                className={`flex shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${istAktiv ? "border-neutral-300 bg-white font-medium" : "border-transparent bg-neutral-100 text-neutral-500 hover:bg-neutral-200"}`}
              >
                <button onClick={() => setAktiv(t)} className="max-w-40 truncate">{label}</button>
                <button onClick={() => schliesseTab(t)} className="rounded p-0.5 hover:bg-neutral-300"><X className="h-3 w-3" /></button>
              </div>
            );
          })}
          <div className="ml-auto shrink-0">
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

        {aktiv?.typ === "mail" ? (
          <MailDetail key={aktiv.id} id={aktiv.id} kompakt={false} onAntworten={oeffneVerfassen} onTabOeffnen={oeffneTab} />
        ) : aktiv?.typ === "verfassen" ? (
          <MailVerfassen
            key={aktiv.schluessel}
            start={aktiv.start}
            abschlussAktion={abschlussAktion}
            onAktionErledigt={() => {
              setTabs((t) => t.filter((x) => x !== aktiv));
              setAktiv(null);
              setAbschlussAktion(null);
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 gap-3">
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
        )}
      </div>

      {schliessenDialog !== null && aktiv?.typ === "verfassen" && aktiv.schluessel === schliessenDialog && (
        <VerfassenSchliessenDialog
          onWahl={(aktion) => { setAbschlussAktion(aktion); setSchliessenDialog(null); }}
          onAbbrechen={() => setSchliessenDialog(null)}
        />
      )}
    </div>
  );
}

/* ═══ Spalte 1
}

/* ═══ Spalte 1: Konten + Ordner + Regeln ═══ */
function Seitenleiste({ kontoId, setKontoId, ordner, setOrdner }: {
  kontoId: number | null; setKontoId: (v: number | null) => void;
  ordner: string | null; setOrdner: (v: string | null) => void;
}) {
  const postfaecher = trpc.postfach.postfaecher.useQuery();
  const sync = trpc.postfach.syncJetzt.useMutation({ onSuccess: () => postfaecher.refetch() });

  return (
    <div className="h-full space-y-1 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Postfächer</span>
        <Link to="/einstellungen" title="Konten verwalten">
          <Settings2 className="h-3.5 w-3.5 text-neutral-400 hover:text-neutral-600" />
        </Link>
      </div>
      <button
        onClick={() => setKontoId(null)}
        className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${kontoId === null ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"}`}
      >
        Alle Konten
      </button>
      {(postfaecher.data ?? []).map((k) => (
        <div key={k.id}>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setKontoId(k.id)}
              className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${kontoId === k.id && !ordner ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"}`}
              title={k.benutzer}
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
              className={`ml-3 flex w-[calc(100%-12px)] items-center justify-between rounded-md px-2 py-1 text-left text-xs ${ordner === o.name ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50 text-neutral-600"}`}
            >
              <span className="truncate">{o.name}</span>
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
      <RegelnSektion />
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
function MailDetail({ id, kompakt, onAntworten, onTabOeffnen, onAusklappen, onSchliessen }: {
  id: number;
  kompakt: boolean;
  onAntworten: (m: VerfassenStart) => void;
  onTabOeffnen: (id: number, betreff: string) => void;
  onAusklappen?: () => void;
  onSchliessen?: () => void;
}) {
  const mail = trpc.postfach.einzel.useQuery({ id });
  const utils = trpc.useUtils();
  const alsBeleg = trpc.postfach.alsBeleg.useMutation();
  const markieren = trpc.postfach.markieren.useMutation();
  const [belegOk, setBelegOk] = useState<string | null>(null);

  const anhangLaden = async (index: number) => {
    const r = await utils.postfach.anhang.fetch({ mailId: id, index });
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
          <div className="truncate"><strong>Von:</strong> {m.absenderName ? `${m.absenderName} <${m.absenderAdresse}>` : m.absenderAdresse}</div>
          <div className="truncate"><strong>An:</strong> {m.empfaenger || "—"}</div>
          <div>{m.datum ? new Date(m.datum).toLocaleString("de-DE") : "—"} · {m.ordner}</div>
        </div>
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
        </div>
        {belegOk && <p className="mt-2 rounded-md bg-green-50 px-3 py-1.5 text-xs text-green-800">{belegOk} — Betrag in Eingangsbelege nachtragen.</p>}
        {alsBeleg.error && <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">{alsBeleg.error.message}</p>}
        {m.anhaengeMeta.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {m.anhaengeMeta.map((a, i) => (
              <div key={i} className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs">
                <Paperclip className="h-3 w-3 text-neutral-500" />
                <span className="max-w-32 truncate">{a.name}</span>
                <span className="text-neutral-400">({Math.round(a.groesse / 1024)} KB)</span>
                {a.postEingangId && (
                  <>
                    <button className="text-teal-700 hover:underline" onClick={() => anhangLaden(i)}>Download</button>
                    <button
                      className="text-teal-700 hover:underline"
                      disabled={alsBeleg.isPending}
                      onClick={() => alsBeleg.mutate({ mailId: id, anhangIndex: i }, { onSuccess: (r) => setBelegOk(`Beleg #${r.belegId} angelegt`) })}
                    >
                      → Beleg
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {m.textHtml ? (
          <iframe sandbox="" title="Mail-Inhalt" srcDoc={m.textHtml} className="h-full min-h-[380px] w-full rounded-md border border-neutral-100" />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-800">{m.textPlain || "(kein Text)"}</pre>
        )}
      </div>
    </div>

  );
}
