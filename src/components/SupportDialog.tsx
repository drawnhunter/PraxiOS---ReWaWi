import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { datum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send, LifeBuoy, CircleCheck, CircleX, ExternalLink } from "lucide-react";

export type SupportVorgabe = {
  typ?: "frage" | "problem" | "idee" | "fehler";
  betreff?: string;
  kontext?: string;
};

const TYP_LABELS: Record<string, string> = {
  frage: "Frage",
  problem: "Problem",
  idee: "Idee/Wunsch",
  fehler: "Fehlermeldung",
};

export function SupportDialog({
  offen,
  onSchliessen,
  vorgabe,
}: {
  offen: boolean;
  onSchliessen: () => void;
  vorgabe?: SupportVorgabe;
}) {
  const status = trpc.support.status.useQuery(undefined, { enabled: offen });
  const liste = trpc.support.liste.useQuery(undefined, { enabled: offen });
  const senden = trpc.support.senden.useMutation();
  const speichern = trpc.support.schluesselSpeichern.useMutation();
  const trennen = trpc.support.schluesselTrennen.useMutation();

  const [typ, setTyp] = useState<string>(vorgabe?.typ ?? "frage");
  const [betreff, setBetreff] = useState(vorgabe?.betreff ?? "");
  const [nachricht, setNachricht] = useState("");
  const [fertig, setFertig] = useState(false);
  const [zeigeVerbindung, setZeigeVerbindung] = useState(false);
  const [schluessel, setSchluessel] = useState("");

  useEffect(() => {
    if (offen) {
      setTyp(vorgabe?.typ ?? "frage");
      setBetreff(vorgabe?.betreff ?? "");
      setNachricht("");
      setFertig(false);
      senden.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen]);

  const s = status.data;
  const kannSenden =
    betreff.trim().length >= 3 && nachricht.trim().length >= 10 && !senden.isPending;

  const mailto = s
    ? `mailto:${s.supportEmail}?subject=${encodeURIComponent(
        `[PraxiOS-Support|${s.produkt}|${s.instanz}|${TYP_LABELS[typ]}] ${betreff}`,
      )}&body=${encodeURIComponent(
        `Produkt: ${s.produkt} v${s.version}\nInstanz: ${s.instanz}\n\n${nachricht}${vorgabe?.kontext ? `\n\n── Technischer Kontext ──\n${vorgabe.kontext}` : ""}`,
      )}`
    : "#";

  async function absenden() {
    try {
      await senden.mutateAsync({
        typ: typ as "frage" | "problem" | "idee" | "fehler",
        betreff: betreff.trim(),
        nachricht: nachricht.trim(),
        kontext: vorgabe?.kontext,
      });
      setFertig(true);
      liste.refetch();
    } catch {
      /* Fehlertext kommt aus senden.error */
    }
  }

  return (
    <Dialog open={offen} onOpenChange={(v) => !v && onSchliessen()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5" /> Support kontaktieren
          </DialogTitle>
        </DialogHeader>

        {fertig ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CircleCheck className="h-10 w-10 text-emerald-600" />
            <p className="font-medium">Meldung gesendet — danke!</p>
            <p className="text-sm text-neutral-500">
              Wir melden uns per E-Mail bei dir. Die Meldung ist auch lokal
              protokolliert (Liste unten).
            </p>
            <Button variant="outline" onClick={onSchliessen}>Schließen</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Anliegen</Label>
                <Select value={typ} onValueChange={setTyp}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="frage">Frage</SelectItem>
                    <SelectItem value="problem">Problem</SelectItem>
                    <SelectItem value="idee">Idee/Wunsch</SelectItem>
                    <SelectItem value="fehler">Fehlermeldung</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Betreff</Label>
                <Input
                  value={betreff}
                  onChange={(e) => setBetreff(e.target.value)}
                  placeholder="Kurzbeschreibung"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Nachricht</Label>
              <Textarea
                rows={5}
                value={nachricht}
                onChange={(e) => setNachricht(e.target.value)}
                placeholder="Beschreibe dein Anliegen möglichst genau …"
              />
            </div>

            {vorgabe?.kontext && (
              <div className="space-y-1.5">
                <Label>Technischer Kontext (wird mitgesendet)</Label>
                <pre className="max-h-32 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] whitespace-pre-wrap">{vorgabe.kontext}</pre>
              </div>
            )}

            {s && !s.smtpBereit && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                E-Mail-Versand (SMTP) ist in dieser Instanz noch nicht
                eingerichtet. Du kannst die Meldung stattdessen über dein
                eigenes Mailprogramm senden:{" "}
                <a href={mailto} className="font-medium underline">
                  Mailprogramm öffnen
                </a>
              </div>
            )}

            {senden.error && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <CircleX className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{senden.error.message}</span>
              </div>
            )}

            <div className="rounded-md bg-neutral-50 p-3 text-xs text-neutral-500">
              <p>
                Gesendet wird an den PraxiOS-Support
                {s ? ` (${s.supportEmail})` : ""} — inklusive Produkt, Version
                {s ? ` (${s.produkt} v${s.version})` : ""} und Instanzname
                {s?.instanz ? ` (${s.instanz})` : ""}. Keine Beleg- oder
                Kundendaten.
              </p>
              {s?.verbunden ? (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">
                    SupportHub verbunden{s.kunde ? `: ${s.kunde}` : ""}
                  </Badge>
                  {s.paket && s.paket !== "keins" && (
                    <Badge>Paket: {s.paket}</Badge>
                  )}
                  {!s.hubErreichbar && (
                    <span className="text-amber-600">(Hub gerade nicht erreichbar — Versand per E-Mail)</span>
                  )}
                </p>
              ) : (
                <p className="mt-1.5">
                  Mit einem{" "}
                  <a
                    href="https://praxios.dynv6.net/#services"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-teal-700 underline"
                  >
                    PraxiOS Support-Paket
                    <ExternalLink className="ml-0.5 inline h-3 w-3" />
                  </a>{" "}
                  antworten wir mit Priorität — Basis schon ab 29&nbsp;€/Monat.{" "}
                  <button
                    type="button"
                    onClick={() => setZeigeVerbindung(!zeigeVerbindung)}
                    className="underline"
                  >
                    Support-Schlüssel vorhanden?
                  </button>
                </p>
              )}
            </div>
          </div>
        )}

        {zeigeVerbindung && !s?.verbunden && !fertig && (
          <div className="space-y-2 rounded-md border border-neutral-200 p-3">
            <Label>Support-Schlüssel</Label>
            <div className="flex gap-2">
              <Input
                value={schluessel}
                onChange={(e) => setSchluessel(e.target.value)}
                placeholder="ps_… (vom PraxiOS-Support erhalten)"
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                disabled={schluessel.trim().length < 10 || speichern.isPending}
                onClick={async () => {
                  await speichern.mutateAsync({ schluessel: schluessel.trim() });
                  setSchluessel("");
                  setZeigeVerbindung(false);
                  status.refetch();
                }}
              >
                {speichern.isPending ? "Prüfe …" : "Verbinden"}
              </Button>
            </div>
            {speichern.error && <p className="text-xs text-red-600">{speichern.error.message}</p>}
            {speichern.data?.ok && (
              <p className="text-xs text-emerald-700">
                Verbunden als {speichern.data.kunde ?? "Kunde"}
                {speichern.data.paket && speichern.data.paket !== "keins" ? ` — Paket: ${speichern.data.paket}` : ""}
              </p>
            )}
            <p className="text-xs text-neutral-400">
              Der Schlüssel wird gegen den SupportHub geprüft, bevor er gespeichert wird. Nur für Admins.
            </p>
          </div>
        )}

        {s?.verbunden && !fertig && (
          <div className="text-right">
            <button
              type="button"
              className="text-xs text-neutral-400 underline hover:text-red-600"
              onClick={async () => {
                if (confirm("Verbindung zum SupportHub wirklich trennen?")) {
                  await trennen.mutateAsync();
                  status.refetch();
                }
              }}
            >
              Verbindung trennen
            </button>
          </div>
        )}

        {!fertig && (
          <DialogFooter>
            <Button variant="outline" onClick={onSchliessen}>Abbrechen</Button>
            {s && !s.smtpBereit ? (
              <Button asChild>
                <a href={mailto}><Send className="mr-1.5 h-4 w-4" /> Per Mailprogramm senden</a>
              </Button>
            ) : (
              <Button onClick={absenden} disabled={!kannSenden}>
                <Send className="mr-1.5 h-4 w-4" />
                {senden.isPending ? "Sende …" : "Meldung senden"}
              </Button>
            )}
          </DialogFooter>
        )}

        {(liste.data?.length ?? 0) > 0 && (
          <div className="mt-2 border-t border-neutral-200 pt-3">
            <p className="mb-2 text-xs font-medium text-neutral-500">Deine letzten Meldungen</p>
            <div className="max-h-36 space-y-1.5 overflow-y-auto">
              {liste.data!.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    <span className="text-neutral-400">{datum(new Date(m.createdAt).toISOString())}</span>{" "}
                    <Badge variant={m.status === "gesendet" ? "secondary" : "destructive"} className="mr-1">
                      {TYP_LABELS[m.typ] ?? m.typ}
                    </Badge>
                    {m.betreff}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
