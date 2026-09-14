import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { RefreshCw, Search, Paperclip, ArrowLeft, Star, Settings2, X, Pencil, FileCheck2, Send, Save } from "lucide-react";
import { Link } from "react-router";

function datumFmt(d: string | Date | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  const heute = new Date().toDateString();
  if (dt.toDateString() === heute) return dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return dt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

interface MailTab { id: number; betreff: string }

export default function MailPostfach() {
  const [tabs, setTabs] = useState<MailTab[]>([]);
  const [aktiv, setAktiv] = useState<number | null>(null); // null = Liste
  const [kontoId, setKontoId] = useState<number | null>(null);
  const [ordner, setOrdner] = useState<string | null>(null);
  const [verfassenOffen, setVerfassenOffen] = useState<null | { empfaenger?: string; betreff?: string; text?: string; inReplyTo?: string | null; references?: string | null }>(null);

  const postfaecher = trpc.postfach.postfaecher.useQuery();
  const sync = trpc.postfach.syncJetzt.useMutation({ onSuccess: () => postfaecher.refetch() });

  const oeffneTab = (id: number, betreff: string) => {
    setTabs((t) => (t.some((x) => x.id === id) ? t : [...t, { id, betreff }]));
    setAktiv(id);
  };
  const schliesseTab = (id: number) => {
    setTabs((t) => t.filter((x) => x.id !== id));
    if (aktiv === id) setAktiv(null);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Linke Spalte: Konten + Ordner */}
      <div className="w-56 shrink-0 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Postfächer</span>
          <Link to="/einstellungen" title="Konten verwalten">
            <Settings2 className="h-3.5 w-3.5 text-neutral-400 hover:text-neutral-600" />
          </Link>
        </div>
        <button
          onClick={() => { setKontoId(null); setOrdner(null); setAktiv(null); }}
          className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${kontoId === null ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"}`}
        >
          Alle Konten
        </button>
        {(postfaecher.data ?? []).map((k) => (
          <div key={k.id}>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setKontoId(k.id); setOrdner(null); }}
                className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${kontoId === k.id && !ordner ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"}`}
                title={k.benutzer}
              >
                {k.name}
              </button>
              <button
                title="Jetzt abrufen"
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
                onClick={() => { setOrdner(ordner === o.name ? null : o.name); setAktiv(null); }}
                className={`ml-3 flex w-[calc(100%-12px)] items-center justify-between rounded-md px-2 py-1 text-left text-xs ${ordner === o.name ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50 text-neutral-600"}`}
              >
                <span className="truncate">{o.name}</span>
                <span className="text-neutral-400">
                  {o.ungelesen > 0 ? <Badge variant="default" className="text-[10px]">{o.ungelesen}</Badge> : o.anzahl}
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
      </div>

      {/* Hauptbereich: Tabs + Inhalt */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Tab-Leiste */}
        <div className="mb-2 flex items-center gap-1 overflow-x-auto">
          <button
            onClick={() => setAktiv(null)}
            className={`shrink-0 rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${aktiv === null ? "border-neutral-300 bg-white font-medium" : "border-transparent bg-neutral-100 text-neutral-500 hover:bg-neutral-200"}`}
          >
            Liste
          </button>
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`flex shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${aktiv === t.id ? "border-neutral-300 bg-white font-medium" : "border-transparent bg-neutral-100 text-neutral-500 hover:bg-neutral-200"}`}
            >
              <button onClick={() => setAktiv(t.id)} className="max-w-40 truncate">{t.betreff || "(kein Betreff)"}</button>
              <button onClick={() => schliesseTab(t.id)} className="rounded p-0.5 hover:bg-neutral-300"><X className="h-3 w-3" /></button>
            </div>
          ))}
          <div className="ml-auto shrink-0">
            <Button size="sm" onClick={() => setVerfassenOffen({})}>
              <Pencil className="mr-1.5 h-4 w-4" /> Verfassen
            </Button>
          </div>
        </div>

        {/* Inhalt je aktivem Tab */}
        {aktiv === null ? (
          <MailListe kontoId={kontoId} ordner={ordner} onOeffnen={oeffneTab} />
        ) : (
          <MailDetail
            key={aktiv}
            id={aktiv}
            onOeffnenAntwort={(m) => setVerfassenOffen(m)}
          />
        )}
      </div>

      {verfassenOffen !== null && (
        <VerfassenDialog
          start={verfassenOffen}
          onSchliessen={() => setVerfassenOffen(null)}
        />
      )}
    </div>
  );
}

/* ═══ Liste ═══ */
function MailListe({ kontoId, ordner, onOeffnen }: { kontoId: number | null; ordner: string | null; onOeffnen: (id: number, betreff: string) => void }) {
  const [q, setQ] = useState("");
  const [nurUngelesene, setNurUngelesene] = useState(false);
  const [seite, setSeite] = useState(1);

  const liste = trpc.postfach.liste.useQuery({
    kontoId: kontoId ?? undefined,
    ordner: ordner ?? undefined,
    q: q || undefined,
    nurUngelesene: nurUngelesene || undefined,
    seite,
  });
  const gesamtSeiten = liste.data ? Math.max(1, Math.ceil(liste.data.gesamt / liste.data.proSeite)) : 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center gap-2 border-b border-neutral-200 p-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setSeite(1); }}
            placeholder="Betreff, Absender, Inhalt suchen …"
            className="pl-8"
          />
        </div>
        <Button variant={nurUngelesene ? "default" : "outline"} size="sm" onClick={() => { setNurUngelesene(!nurUngelesene); setSeite(1); }}>
          Ungelesen
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {liste.isLoading && <p className="p-4 text-sm text-neutral-400">Lade …</p>}
        {liste.data?.mails.length === 0 && (
          <p className="p-4 text-sm text-neutral-400">Keine Mails — Sync-Button am Konto drücken oder warten (Intervall-Abruf läuft).</p>
        )}
        {(liste.data?.mails ?? []).map((m) => (
          <button
            key={m.id}
            onClick={() => onOeffnen(m.id, m.betreff ?? "")}
            className={`flex w-full items-center gap-3 border-b border-neutral-100 px-3 py-2.5 text-left hover:bg-neutral-50 ${!m.gelesen ? "bg-teal-50/40" : ""}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${!m.gelesen ? "bg-teal-600" : "bg-transparent"}`} />
            <span className="w-48 shrink-0 truncate text-sm">{m.absenderName || m.absenderAdresse || "—"}</span>
            <span className={`min-w-0 flex-1 truncate text-sm ${!m.gelesen ? "font-medium" : "text-neutral-600"}`}>{m.betreff || "(kein Betreff)"}</span>
            {m.anzahlAnhaenge > 0 && <Paperclip className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
            <span className="shrink-0 text-xs tabular-nums text-neutral-400">{datumFmt(m.datum)}</span>
          </button>
        ))}
      </div>
      {liste.data && liste.data.gesamt > liste.data.proSeite && (
        <div className="flex items-center justify-between border-t border-neutral-200 px-3 py-2 text-sm">
          <Button variant="outline" size="sm" disabled={seite <= 1} onClick={() => setSeite(seite - 1)}>← Zurück</Button>
          <span className="text-xs text-neutral-500">Seite {seite} / {gesamtSeiten} · {liste.data.gesamt} Mails</span>
          <Button variant="outline" size="sm" disabled={seite >= gesamtSeiten} onClick={() => setSeite(seite + 1)}>Weiter →</Button>
        </div>
      )}
    </div>
  );
}

/* ═══ Detail (als Tab) ═══ */
function MailDetail({ id, onOeffnenAntwort }: { id: number; onOeffnenAntwort: (m: { empfaenger: string; betreff: string; text: string; inReplyTo: string | null; references: string | null }) => void }) {
  const mail = trpc.postfach.einzel.useQuery({ id });
  const utils = trpc.useUtils();
  const alsBeleg = trpc.postfach.alsBeleg.useMutation();
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
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 p-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{m.betreff || "(kein Betreff)"}</h2>
          {m.markiert && <Star className="h-4 w-4 text-amber-500" />}
          <Button
            variant="outline" size="sm"
            onClick={() => {
              const zitat = (m.textPlain ?? "").split("\n").map((z: string) => `> ${z}`).join("\n");
              onOeffnenAntwort({
                empfaenger: m.absenderAdresse ?? "",
                betreff: m.betreff?.startsWith("Re:") ? m.betreff : `Re: ${m.betreff ?? ""}`,
                text: `\n\n--- Originalnachricht ---\n${zitat}`,
                inReplyTo: m.messageId ?? null,
                references: m.messageId ?? null,
              });
            }}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4 -scale-x-100" /> Antworten
          </Button>
          <Button
            size="sm"
            disabled={alsBeleg.isPending}
            onClick={() => alsBeleg.mutate({ mailId: id }, { onSuccess: (r) => setBelegOk(`Beleg #${r.belegId} angelegt`) })}
          >
            <FileCheck2 className="mr-1.5 h-4 w-4" /> Als Beleg
          </Button>
        </div>
        <div className="text-sm text-neutral-600">
          <div><strong>Von:</strong> {m.absenderName ? `${m.absenderName} <${m.absenderAdresse}>` : m.absenderAdresse}</div>
          <div><strong>An:</strong> {m.empfaenger || "—"}</div>
          <div><strong>Datum:</strong> {m.datum ? new Date(m.datum).toLocaleString("de-DE") : "—"} · <strong>Ordner:</strong> {m.ordner}</div>
        </div>
        {belegOk && <p className="mt-2 rounded-md bg-green-50 px-3 py-1.5 text-xs text-green-800">{belegOk} — Betrag in Eingangsbelege nachtragen.</p>}
        {alsBeleg.error && <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">{alsBeleg.error.message}</p>}
        {m.anhaengeMeta.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.anhaengeMeta.map((a, i) => (
              <div key={i} className="flex items-center gap-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs">
                <Paperclip className="h-3.5 w-3.5 text-neutral-500" />
                <span className="max-w-40 truncate">{a.name}</span>
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
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {m.textHtml ? (
          <iframe sandbox="" title="Mail-Inhalt" srcDoc={m.textHtml} className="h-full min-h-[400px] w-full rounded-md border border-neutral-100" />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-800">{m.textPlain || "(kein Text)"}</pre>
        )}
      </div>
    </div>
  );
}

/* ═══ Verfassen-Dialog ═══ */
function VerfassenDialog({ start, onSchliessen }: {
  start: { empfaenger?: string; betreff?: string; text?: string; inReplyTo?: string | null; references?: string | null };
  onSchliessen: () => void;
}) {
  const [empfaenger, setEmpfaenger] = useState(start.empfaenger ?? "");
  const [cc, setCc] = useState("");
  const [betreff, setBetreff] = useState(start.betreff ?? "");
  const [text, setText] = useState(start.text ?? "");
  const [entwurfId, setEntwurfId] = useState<number | null>(null);
  const [vorschlaege, setVorschlaege] = useState<{ name: string; email: string; quelle: string }[]>([]);

  const einstellungen = trpc.settings.get.useQuery();
  const entwuerfe = trpc.postfach.entwuerfe.useQuery();
  const versenden = trpc.postfach.versenden.useMutation({ onSuccess: onSchliessen });
  const entwurfSpeichern = trpc.postfach.entwurfSpeichern.useMutation();
  const entwurfLoeschen = trpc.postfach.entwurfLoeschen.useMutation({ onSuccess: () => entwuerfe.refetch() });
  const utils = trpc.useUtils();

  const sucheKontakte = async (q: string) => {
    if (q.trim().length < 2) { setVorschlaege([]); return; }
    const r = await utils.postfach.kontakte.fetch({ q });
    setVorschlaege(r);
  };

  const entwurfLaden = (id: number) => {
    const e = (entwuerfe.data ?? []).find((x) => x.id === id);
    if (!e) return;
    setEntwurfId(id);
    setEmpfaenger(e.empfaenger ?? "");
    setCc(e.cc ?? "");
    setBetreff(e.betreff ?? "");
    setText(e.text ?? "");
  };

  const entwurfSichern = () => {
    entwurfSpeichern.mutate(
      { id: entwurfId ?? undefined, empfaenger, cc, betreff, text },
      { onSuccess: (r) => { setEntwurfId(r.id); entwuerfe.refetch(); } },
    );
  };

  const signatur = einstellungen.data?.signatur ?? "";

  return (
    <Dialog open onOpenChange={(o) => !o && onSchliessen()}>
      <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-2xl flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>E-Mail verfassen</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {(entwuerfe.data ?? []).length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-xs text-neutral-500">Entwurf laden:</span>
              {(entwuerfe.data ?? []).slice(0, 5).map((e) => (
                <button
                  key={e.id}
                  onClick={() => entwurfLaden(e.id)}
                  className={`rounded-md border px-2 py-1 text-xs ${entwurfId === e.id ? "border-teal-400 bg-teal-50" : "border-neutral-200 hover:bg-neutral-50"}`}
                >
                  {(e.betreff || "(ohne Betreff)").slice(0, 30)}
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <label className="mb-1 block text-xs text-neutral-500">An *</label>
            <Input
              value={empfaenger}
              onChange={(e) => { setEmpfaenger(e.target.value); sucheKontakte(e.target.value.split(",").pop() ?? ""); }}
              placeholder="empfaenger@beispiel.de, zweite@adresse.de"
            />
            {vorschlaege.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-lg">
                {vorschlaege.map((v) => (
                  <button
                    key={v.email}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-neutral-100"
                    onClick={() => {
                      const teile = empfaenger.split(",").map((x) => x.trim()).filter(Boolean);
                      teile.pop();
                      setEmpfaenger([...teile, v.email].join(", "));
                      setVorschlaege([]);
                    }}
                  >
                    <span>{v.name}</span>
                    <span className="text-xs text-neutral-400">{v.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">CC</label>
            <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Betreff *</label>
            <Input value={betreff} onChange={(e) => setBetreff(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Text *</label>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} />
            {signatur && (
              <details className="mt-1 text-xs text-neutral-400">
                <summary className="cursor-pointer">Signatur (wird angehängt)</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 p-2">{signatur}</pre>
              </details>
            )}
          </div>
          {versenden.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{versenden.error.message}</p>}
        </div>
        <DialogFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={entwurfSichern} disabled={entwurfSpeichern.isPending}>
              <Save className="mr-1.5 h-4 w-4" /> {entwurfId ? "Entwurf aktualisieren" : "Als Entwurf speichern"}
            </Button>
            {entwurfId && (
              <Button variant="ghost" size="sm" onClick={() => { entwurfLoeschen.mutate({ id: entwurfId }); setEntwurfId(null); }}>
                Entwurf löschen
              </Button>
            )}
          </div>
          <Button
            disabled={!empfaenger.trim() || !betreff.trim() || !text.trim() || versenden.isPending}
            onClick={() =>
              versenden.mutate({
                empfaenger: empfaenger.split(",").map((x) => x.trim()).filter(Boolean),
                cc: cc.split(",").map((x) => x.trim()).filter(Boolean),
                betreff,
                text,
                inReplyTo: start.inReplyTo ?? null,
                references: start.references ?? null,
                mitSignatur: true,
              })
            }
          >
            <Send className="mr-1.5 h-4 w-4" /> {versenden.isPending ? "Sende …" : "Senden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
