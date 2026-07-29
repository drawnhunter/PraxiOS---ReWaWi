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
import { CheckCircle2, Loader2, MailPlus, Pencil, PlugZap, Trash2, XCircle } from "lucide-react";

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
};

export function EmailEingang() {
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
    const { id, passwort, ...rest } = form;
    if (id) {
      aktualisieren.mutate({ id, ...rest, ...(passwort ? { passwort } : {}) });
    } else {
      anlegen.mutate({ ...rest, ...(passwort ? { passwort } : {}) });
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
