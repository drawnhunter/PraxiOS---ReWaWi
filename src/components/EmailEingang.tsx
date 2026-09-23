import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2, MailPlus, Pencil, PlugZap, Plus, Settings2, Trash2, XCircle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface KontoForm {
  id?: number;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  benutzer: string;
  passwort: string;
  ordner: string;
  route: "rechnung" | "sonstiges";
  intervallMinuten: number;
  aktiv: boolean;
  smtpHost: string;
  smtpPort: number | null;
  smtpBenutzer: string;
  smtpPasswort: string;
  smtpAbsender: string;
}

const LEER: KontoForm = {
  name: "",
  host: "",
  port: 993,
  tls: true,
  benutzer: "",
  passwort: "",
  ordner: "INBOX",
  route: "rechnung",
  intervallMinuten: 10,
  aktiv: true,
  smtpHost: "",
  smtpPort: null,
  smtpBenutzer: "",
  smtpPasswort: "",
  smtpAbsender: "",
};

export function EmailEingang() {
  const [optionenOffen, setOptionenOffen] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const konten = trpc.emailKonten.liste.useQuery();
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<KontoForm>(LEER);
  const [test, setTest] = useState<Record<number, { ok: boolean; fehler?: string } | "laeuft">>({});

  const invalidieren = () => utils.emailKonten.liste.invalidate();
  const anlegen = trpc.emailKonten.anlegen.useMutation({ onSuccess: () => { invalidieren(); setDialog(false); } });
  const aktualisieren = trpc.emailKonten.aktualisieren.useMutation({ onSuccess: () => { invalidieren(); setDialog(false); } });
  const loeschen = trpc.emailKonten.loeschen.useMutation({ onSuccess: invalidieren });
  const testen = trpc.emailKonten.testen.useMutation();

  const speichern = () => {
    const { id, passwort, smtpPasswort, ...rest } = form;
    const payload = {
      ...rest,
      smtpPort: rest.smtpPort || null,
      smtpHost: rest.smtpHost || null,
      smtpBenutzer: rest.smtpBenutzer || null,
      smtpAbsender: rest.smtpAbsender || null,
      ...(passwort ? { passwort } : {}),
      ...(smtpPasswort ? { smtpPasswort } : {}),
    };
    if (id) {
      aktualisieren.mutate({ id, ...payload });
    } else {
      anlegen.mutate(payload);
    }
  };

  const testStarten = (id: number) => {
    setTest((alt) => ({ ...alt, [id]: "laeuft" }));
    testen.mutate(
      { id },
      {
        onSuccess: (d) => setTest((alt) => ({ ...alt, [id]: d })),
        onError: (e) => setTest((alt) => ({ ...alt, [id]: { ok: false, fehler: e.message } })),
      },
    );
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-700">E-Mail-Eingang (IMAP-Postfächer)</h2>
        <Button size="sm" variant="outline" onClick={() => { setForm(LEER); setDialog(true); }}>
          <MailPlus className="mr-2 h-4 w-4" />Postfach hinzufügen
        </Button>
      </div>
      <p className="mb-4 text-xs text-neutral-400">
        ReWaWi ruft diese Postfächer im Intervall ab und legt PDF-/Bild-Anhänge automatisch im Post
        Manager ab — z. B. rechnung@, post@ oder befunde@deine-domain.de.
      </p>

      <div className="space-y-2">
        {(konten.data ?? []).map((k) => (
          <div key={k.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                {k.name}
                <Badge variant={k.aktiv ? "default" : "outline"}>{k.aktiv ? "aktiv" : "pausiert"}</Badge>
                <Badge variant="secondary">→ {k.route === "rechnung" ? "Rechnungen" : "Sonstiges"}</Badge>
              </div>
              <div className="text-xs text-neutral-500">
                {k.benutzer}@{k.host}:{k.port} · Ordner {k.ordner} · alle {k.intervallMinuten} Min
                {k.letzterAbruf ? ` · zuletzt ${new Date(k.letzterAbruf).toLocaleString("de-DE")}` : ""}
              </div>
              {k.letzterFehler && <div className="text-xs text-red-600">Fehler: {k.letzterFehler}</div>}
              {(() => {
                const t = test[k.id];
                if (!t || t === "laeuft") return null;
                return (
                  <div className={`flex items-center gap-1 text-xs ${t.ok ? "text-teal-700" : "text-red-600"}`}>
                    {t.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {t.ok ? "Verbindung erfolgreich" : t.fehler}
                  </div>
                );
              })()}
            </div>
            <Button
              size="sm" variant="ghost"
              title="Signatur & Abwesenheitsnotiz"
              onClick={() => setOptionenOffen(optionenOffen === k.id ? null : k.id)}
            >
              <Settings2 className={`h-4 w-4 ${optionenOffen === k.id ? "text-teal-600" : ""}`} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => testStarten(k.id)} disabled={test[k.id] === "laeuft"}>
              {test[k.id] === "laeuft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setForm({
                  id: k.id,
                  name: k.name,
                  host: k.host,
                  port: k.port,
                  tls: k.tls,
                  benutzer: k.benutzer,
                  passwort: "",
                  ordner: k.ordner,
                  route: k.route,
                  intervallMinuten: k.intervallMinuten,
                  aktiv: k.aktiv,
                  smtpHost: k.smtpHost ?? "",
                  smtpPort: k.smtpPort ?? null,
                  smtpBenutzer: k.smtpBenutzer ?? "",
                  smtpPasswort: "",
                  smtpAbsender: k.smtpAbsender ?? "",
                });
                setDialog(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              onClick={() => {
                if (confirm(`Postfach „${k.name}" wirklich löschen?`)) loeschen.mutate({ id: k.id });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {konten.data?.length === 0 && (
          <p className="py-4 text-center text-sm text-neutral-400">Noch keine Postfächer eingerichtet.</p>
        )}
      </div>

      {/* Optionen-Panel je Konto (Signatur + Abwesenheitsnotiz) */}
      {(konten.data ?? []).map((k) => optionenOffen === k.id && (
        <KontoOptionen key={`opt-${k.id}`} konto={k} onZu={() => setOptionenOffen(null)} />
      ))}

      <BausteineVerwaltung />

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Postfach bearbeiten" : "Postfach hinzufügen"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Rechnungen" />
            </div>
            <div>
              <Label>Ziel</Label>
              <Select value={form.route} onValueChange={(v) => setForm({ ...form, route: v as KontoForm["route"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rechnung">Post Manager: Rechnung</SelectItem>
                  <SelectItem value="sonstiges">Post Manager: Sonstiges</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>IMAP-Host</Label>
              <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="imap.provider.de" />
            </div>
            <div>
              <Label>Port</Label>
              <Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 993 })} />
            </div>
            <div>
              <Label>Benutzer</Label>
              <Input value={form.benutzer} onChange={(e) => setForm({ ...form, benutzer: e.target.value })} placeholder="rechnung@domain.de" />
            </div>
            <div>
              <Label>Passwort{form.id ? " (leer = behalten)" : ""}</Label>
              <Input type="password" value={form.passwort} onChange={(e) => setForm({ ...form, passwort: e.target.value })} />
            </div>
            <div>
              <Label>Ordner</Label>
              <Input value={form.ordner} onChange={(e) => setForm({ ...form, ordner: e.target.value })} />
            </div>
            <div>
              <Label>Intervall (Minuten)</Label>
              <Input type="number" value={form.intervallMinuten} onChange={(e) => setForm({ ...form, intervallMinuten: Number(e.target.value) || 10 })} />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="tls"
                type="checkbox"
                checked={form.tls}
                onChange={(e) => setForm({ ...form, tls: e.target.checked })}
                className="h-4 w-4"
              />
              <Label htmlFor="tls">TLS/SSL verwenden</Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="aktiv"
                type="checkbox"
                checked={form.aktiv}
                onChange={(e) => setForm({ ...form, aktiv: e.target.checked })}
                className="h-4 w-4"
              />
              <Label htmlFor="aktiv">Abruf aktiv</Label>
            </div>
          </div>
          <div className="mt-3 border-t border-neutral-200 pt-3">
            <p className="mb-2 text-xs font-medium text-neutral-500">Versand aus diesem Konto (optional — sonst Firmen-SMTP)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>SMTP-Host</Label>
                <Input value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} placeholder="smtp.provider.de" />
              </div>
              <div>
                <Label>Port</Label>
                <Input value={form.smtpPort ?? ""} onChange={(e) => setForm({ ...form, smtpPort: e.target.value ? Number(e.target.value) : null })} placeholder="587" />
              </div>
              <div>
                <Label>Benutzer</Label>
                <Input value={form.smtpBenutzer} onChange={(e) => setForm({ ...form, smtpBenutzer: e.target.value })} placeholder="rechnung@imtz.de" />
              </div>
              <div>
                <Label>Passwort</Label>
                <Input type="password" value={form.smtpPasswort} onChange={(e) => setForm({ ...form, smtpPasswort: e.target.value })} placeholder={form.id ? "(bleibt gespeichert)" : ""} />
              </div>
              <div className="col-span-2">
                <Label>Absender-Name</Label>
                <Input value={form.smtpAbsender} onChange={(e) => setForm({ ...form, smtpAbsender: e.target.value })} placeholder="IMTZ GmbH <rechnung@imtz.de>" />
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(false)}>Abbrechen</Button>
            <Button onClick={speichern} disabled={anlegen.isPending || aktualisieren.isPending || !form.name || !form.host || !form.benutzer || (!form.id && !form.passwort)}>
              {(anlegen.isPending || aktualisieren.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Speichern
            </Button>
          </div>
          {(anlegen.isError || aktualisieren.isError) && (
            <p className="text-xs text-red-600">{(anlegen.error ?? aktualisieren.error)?.message}</p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ═══ Pro-Konto-Optionen: Signaturen (neu/Antwort) + Abwesenheitsnotiz ═══ */
function KontoOptionen({ konto, onZu }: { konto: KontoOptionenDaten; onZu: () => void }) {
  const utils = trpc.useUtils();
  const [sigNeu, setSigNeu] = useState(konto.signaturNeu ?? "");
  const [sigAntwort, setSigAntwort] = useState(konto.signaturAntwort ?? "");
  const [abwAktiv, setAbwAktiv] = useState(konto.abwesenheitAktiv ?? false);
  const [abwVon, setAbwVon] = useState(konto.abwesenheitVon ?? "");
  const [abwBis, setAbwBis] = useState(konto.abwesenheitBis ?? "");
  const [abwText, setAbwText] = useState(konto.abwesenheitText ?? "");
  const [nurKontakte, setNurKontakte] = useState(konto.abwesenheitNurKontakte ?? false);
  const [ok, setOk] = useState(false);
  const speichern = trpc.postfach.kontoOptionen.useMutation({
    onSuccess: () => { setOk(true); setTimeout(() => setOk(false), 2000); utils.postfach.postfaecher.invalidate(); utils.emailKonten.liste.invalidate(); },
  });

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-teal-200 bg-teal-50/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-teal-900">Optionen: {konto.name}</h3>
        <Button size="sm" variant="ghost" onClick={onZu}><XCircle className="h-4 w-4" /></Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Signatur — neue Mails</Label>
          <Textarea rows={3} value={sigNeu} onChange={(e) => setSigNeu(e.target.value)} placeholder={"Mit freundlichen Grüßen\n…"} />
        </div>
        <div>
          <Label>Signatur — Antworten/Weiterleitungen</Label>
          <Textarea rows={3} value={sigAntwort} onChange={(e) => setSigAntwort(e.target.value)} placeholder="(leer = wie neue Mails / global)" />
        </div>
      </div>
      <div className="rounded-md border border-neutral-200 bg-white p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={abwAktiv} onChange={(e) => setAbwAktiv(e.target.checked)} />
          Abwesenheitsnotiz aktiv (serverseitig — läuft auch bei ausgeschaltetem Rechner)
        </label>
        {abwAktiv && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              <div className="flex-1"><Label>von</Label><Input type="date" value={abwVon} onChange={(e) => setAbwVon(e.target.value)} /></div>
              <div className="flex-1"><Label>bis</Label><Input type="date" value={abwBis} onChange={(e) => setAbwBis(e.target.value)} /></div>
            </div>
            <Textarea rows={3} value={abwText} onChange={(e) => setAbwText(e.target.value)} placeholder="Vielen Dank für Ihre Nachricht. Ich bin bis … abwesend …" />
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input type="checkbox" checked={nurKontakte} onChange={(e) => setNurKontakte(e.target.checked)} />
              nur an bekannte Kontakte (Kartei) senden
            </label>
            <p className="text-[11px] text-neutral-400">Fest eingebaut: max. 1× je Absender in 4 Tagen; Newsletter/noreply/Listen werden nie beantwortet.</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={speichern.isPending}
          onClick={() =>
            speichern.mutate({
              kontoId: konto.id,
              signaturNeu: sigNeu,
              signaturAntwort: sigAntwort,
              abwesenheitAktiv: abwAktiv,
              abwesenheitVon: abwVon || null,
              abwesenheitBis: abwBis || null,
              abwesenheitText: abwText,
              abwesenheitNurKontakte: nurKontakte,
            })
          }
        >
          Speichern
        </Button>
        {ok && <span className="text-xs text-green-600">✓ gespeichert</span>}
      </div>
    </div>
  );
}

type KontoOptionenDaten = {
  id: number; name: string;
  signaturNeu?: string | null; signaturAntwort?: string | null;
  abwesenheitAktiv?: boolean; abwesenheitVon?: string | null; abwesenheitBis?: string | null;
  abwesenheitText?: string | null; abwesenheitNurKontakte?: boolean;
};

/* ═══ Textbausteine (Kürzel + TAB im Editor) ═══ */
function BausteineVerwaltung() {
  const liste = trpc.postfach.bausteine.useQuery();
  const anlegen = trpc.postfach.bausteinAnlegen.useMutation({ onSuccess: () => { liste.refetch(); setForm({ kuerzel: "", titel: "", inhalt: "" }); } });
  const loeschen = trpc.postfach.bausteinLoeschen.useMutation({ onSuccess: () => liste.refetch() });
  const [form, setForm] = useState({ kuerzel: "", titel: "", inhalt: "" });
  const [offen, setOffen] = useState(false);

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOffen(!offen)}>
        <h3 className="text-sm font-medium text-neutral-700">Textbausteine (Schnellantworten)</h3>
        <span className="text-xs text-neutral-400">{offen ? "einklappen" : "ausklappen"}</span>
      </button>
      {offen && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-neutral-400">
            Im Editor: Kürzel tippen + <b>TAB</b> → Baustein wird eingefügt. HTML erlaubt.
          </p>
          {(liste.data ?? []).map((b) => (
            <div key={b.id} className="flex items-center gap-2 rounded-md border border-neutral-100 px-2 py-1.5 text-sm">
              <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">{b.kuerzel}</code>
              <span className="min-w-0 flex-1 truncate">{b.titel}</span>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => loeschen.mutate({ id: b.id })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {(liste.data ?? []).length === 0 && <p className="text-xs text-neutral-400">Noch keine Bausteine.</p>}
          <div className="grid gap-2 border-t border-neutral-100 pt-2 sm:grid-cols-[140px_1fr]">
            <Input placeholder="Kürzel (z. B. mfg)" value={form.kuerzel} onChange={(e) => setForm({ ...form, kuerzel: e.target.value })} />
            <Input placeholder="Titel" value={form.titel} onChange={(e) => setForm({ ...form, titel: e.target.value })} />
            <div className="sm:col-span-2">
              <Textarea rows={2} placeholder="Inhalt (HTML erlaubt)" value={form.inhalt} onChange={(e) => setForm({ ...form, inhalt: e.target.value })} />
            </div>
          </div>
          <Button
            size="sm" variant="outline"
            disabled={!form.kuerzel.trim() || !form.titel.trim() || !form.inhalt.trim() || anlegen.isPending}
            onClick={() => anlegen.mutate(form)}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Baustein anlegen
          </Button>
          {anlegen.error && <p className="text-xs text-red-600">{anlegen.error.message}</p>}
        </div>
      )}
    </div>
  );
}
