import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Search, Paperclip, ArrowLeft, Star, Settings2 } from "lucide-react";
import { Link } from "react-router";

function datumFmt(d: string | Date | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  const heute = new Date().toDateString();
  if (dt.toDateString() === heute) return dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return dt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function MailPostfach() {
  const [kontoId, setKontoId] = useState<number | null>(null);
  const [ordner, setOrdner] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [nurUngelesene, setNurUngelesene] = useState(false);
  const [seite, setSeite] = useState(1);
  const [mailId, setMailId] = useState<number | null>(null);

  const postfaecher = trpc.postfach.postfaecher.useQuery();
  const liste = trpc.postfach.liste.useQuery({
    kontoId: kontoId ?? undefined,
    ordner: ordner ?? undefined,
    q: q || undefined,
    nurUngelesene: nurUngelesene || undefined,
    seite,
  });
  const sync = trpc.postfach.syncJetzt.useMutation({
    onSuccess: () => {
      postfaecher.refetch();
      liste.refetch();
    },
  });

  const gesamtSeiten = liste.data ? Math.max(1, Math.ceil(liste.data.gesamt / liste.data.proSeite)) : 1;

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
          onClick={() => { setKontoId(null); setOrdner(null); setSeite(1); }}
          className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${kontoId === null ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"}`}
        >
          Alle Konten
        </button>
        {(postfaecher.data ?? []).map((k) => (
          <div key={k.id}>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setKontoId(k.id); setOrdner(null); setSeite(1); }}
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
                onClick={() => { setOrdner(ordner === o.name ? null : o.name); setSeite(1); }}
                className={`ml-3 flex w-[calc(100%-12px)] items-center justify-between rounded-md px-2 py-1 text-left text-xs ${ordner === o.name ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50 text-neutral-600"}`}
              >
                <span className="truncate">{o.name}</span>
                <span className="text-neutral-400">
                  {o.ungelesen > 0 ? <Badge variant="default" className="text-[10px]">{o.ungelesen}</Badge> : o.anzahl}
                </span>
              </button>
            ))}
            {k.letzterFehler && (
              <p className="ml-3 mt-0.5 text-[10px] text-red-500" title={k.letzterFehler}>Abruffehler</p>
            )}
          </div>
        ))}
        {(postfaecher.data ?? []).length === 0 && !postfaecher.isLoading && (
          <p className="px-2 py-4 text-xs text-neutral-400">
            Noch keine Konten — in den <Link to="/einstellungen" className="underline">Einstellungen</Link> anlegen.
          </p>
        )}
      </div>

      {/* Mail-Liste oder Detail */}
      {mailId === null ? (
        <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-neutral-200 bg-white">
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
            <Button
              variant={nurUngelesene ? "default" : "outline"}
              size="sm"
              onClick={() => { setNurUngelesene(!nurUngelesene); setSeite(1); }}
            >
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
                onClick={() => setMailId(m.id)}
                className={`flex w-full items-center gap-3 border-b border-neutral-100 px-3 py-2.5 text-left hover:bg-neutral-50 ${!m.gelesen ? "bg-teal-50/40" : ""}`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${!m.gelesen ? "bg-teal-600" : "bg-transparent"}`} />
                <span className="w-48 shrink-0 truncate text-sm">
                  {m.absenderName || m.absenderAdresse || "—"}
                </span>
                <span className={`min-w-0 flex-1 truncate text-sm ${!m.gelesen ? "font-medium" : "text-neutral-600"}`}>
                  {m.betreff || "(kein Betreff)"}
                </span>
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
      ) : (
        <MailDetail id={mailId} onZurueck={() => setMailId(null)} />
      )}
    </div>
  );
}

function MailDetail({ id, onZurueck }: { id: number; onZurueck: () => void }) {
  const mail = trpc.postfach.einzel.useQuery({ id });
  const utils = trpc.useUtils();

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
      <div className="border-b border-neutral-200 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onZurueck}><ArrowLeft className="h-4 w-4" /></Button>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{m.betreff || "(kein Betreff)"}</h2>
          {m.markiert && <Star className="h-4 w-4 text-amber-500" />}
        </div>
        <div className="text-sm text-neutral-600">
          <div><strong>Von:</strong> {m.absenderName ? `${m.absenderName} <${m.absenderAdresse}>` : m.absenderAdresse}</div>
          <div><strong>An:</strong> {m.empfaenger || "—"}</div>
          <div><strong>Datum:</strong> {m.datum ? new Date(m.datum).toLocaleString("de-DE") : "—"} · <strong>Ordner:</strong> {m.ordner}</div>
        </div>
        {m.anhaengeMeta.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.anhaengeMeta.map((a, i) => (
              <button
                key={i}
                onClick={() => a.postEingangId && anhangLaden(i)}
                disabled={!a.postEingangId}
                title={a.postEingangId ? "Herunterladen (aus dem Post Manager)" : "Nur Metadaten (Typ wird nicht gespeichert)"}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${a.postEingangId ? "border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100" : "border-neutral-200 text-neutral-400"}`}
              >
                <Paperclip className="h-3.5 w-3.5" />
                <span className="max-w-40 truncate">{a.name}</span>
                <span className="text-neutral-400">({Math.round(a.groesse / 1024)} KB)</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {m.textHtml ? (
          <iframe
            sandbox=""
            title="Mail-Inhalt"
            srcDoc={m.textHtml}
            className="h-full min-h-[400px] w-full rounded-md border border-neutral-100"
          />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-800">{m.textPlain || "(kein Text)"}</pre>
        )}
      </div>
    </div>
  );
}
