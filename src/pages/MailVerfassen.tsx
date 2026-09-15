import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MailEditor, htmlZuText } from "@/components/MailEditor";
import { Paperclip, Send, Save, Trash2, X } from "lucide-react";

export interface VerfassenStart {
  empfaenger?: string;
  cc?: string;
  bcc?: string;
  betreff?: string;
  html?: string;
  inReplyTo?: string | null;
  references?: string | null;
  kontoId?: number | null;
  entwurfId?: number | null;
}

interface Anhang { dateiname: string; base64: string; mime: string }

/** Der „Mail verfassen"-Tab: volles Paket (RTE, Von/An/CC/BCC, Anhänge, Entwurf). */
export function MailVerfassen({ start, abschlussAktion, onAktionErledigt }: {
  start: VerfassenStart;
  abschlussAktion: "loeschen" | "entwurf" | "senden" | null;
  onAktionErledigt: () => void;
}) {
  // Aktion aus dem Schliessen-Dialog ausfuehren (Loeschen / Entwurf / Senden)
  useEffect(() => {
    if (abschlussAktion === "loeschen") onAktionErledigt();
    else if (abschlussAktion === "entwurf") entwurfSichern();
    else if (abschlussAktion === "senden") senden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abschlussAktion]);
  const [kontoId, setKontoId] = useState<number | null>(start.kontoId ?? null);
  const [empfaenger, setEmpfaenger] = useState(start.empfaenger ?? "");
  const [cc, setCc] = useState(start.cc ?? "");
  const [bcc, setBcc] = useState(start.bcc ?? "");
  const [betreff, setBetreff] = useState(start.betreff ?? "");
  const [html, setHtml] = useState(start.html ?? "<p><br></p>");
  const [anhaenge, setAnhaenge] = useState<Anhang[]>([]);
  const [entwurfId, setEntwurfId] = useState<number | null>(start.entwurfId ?? null);
  const [vorschlaege, setVorschlaege] = useState<{ name: string; email: string; quelle: string }[]>([]);
  const [fehler, setFehler] = useState("");

  const postfaecher = trpc.postfach.postfaecher.useQuery();
  const versenden = trpc.postfach.versenden.useMutation();
  const entwurfSpeichern = trpc.postfach.entwurfSpeichern.useMutation();
  const utils = trpc.useUtils();

  const sucheKontakte = async (q: string) => {
    if (q.trim().length < 2) { setVorschlaege([]); return; }
    const r = await utils.postfach.kontakte.fetch({ q });
    setVorschlaege(r);
  };

  const dateiHinzufuegen = (dateien: FileList | null) => {
    if (!dateien) return;
    for (const d of Array.from(dateien).slice(0, 10)) {
      const leser = new FileReader();
      leser.onload = () => {
        const roh = leser.result as string;
        setAnhaenge((a) => [...a, { dateiname: d.name, base64: roh.slice(roh.indexOf(",") + 1), mime: d.type || "application/octet-stream" }]);
      };
      leser.readAsDataURL(d);
    }
  };

  const entwurfSichern = () => {
    entwurfSpeichern.mutate(
      { id: entwurfId ?? undefined, empfaenger, cc, bcc, kontoId: kontoId ?? undefined, betreff, text: html },
      {
        onSuccess: (r) => {
          setEntwurfId(r.id);
          onAktionErledigt();
        },
        onError: (e) => setFehler(e.message),
      },
    );
  };

  const senden = () => {
    setFehler("");
    versenden.mutate(
      {
        kontoId: kontoId ?? undefined,
        empfaenger: empfaenger.split(",").map((x) => x.trim()).filter(Boolean),
        cc: cc.split(",").map((x) => x.trim()).filter(Boolean),
        bcc: bcc.split(",").map((x) => x.trim()).filter(Boolean),
        betreff,
        text: htmlZuText(html),
        html,
        anhaenge,
        inReplyTo: start.inReplyTo ?? null,
        references: start.references ?? null,
        mitSignatur: true,
      },
      {
        onSuccess: () => onAktionErledigt(),
        onError: (e) => setFehler(e.message),
      },
    );
  };

  const feldLabel = "mb-1 block text-xs text-neutral-500";

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-neutral-200 bg-white">
      {/* Werkzeugblock: Editor-Toolbar direkt ueber dem Feld (liegt im MailEditor) */}
      <div className="border-b border-neutral-200 p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className={feldLabel}>Von (Konto)</label>
            <Select
              value={kontoId === null ? "firma" : String(kontoId)}
              onValueChange={(v) => setKontoId(v === "firma" ? null : Number(v))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="firma">Firmen-SMTP (Standard)</SelectItem>
                {(postfaecher.data ?? []).map((k) => (
                  <SelectItem key={k.id} value={String(k.id)}>{k.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <label className={feldLabel}>An *</label>
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
            <label className={feldLabel}>CC</label>
            <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional" />
          </div>
          <div>
            <label className={feldLabel}>BCC</label>
            <Input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="optional" />
          </div>
          <div className="sm:col-span-2">
            <label className={feldLabel}>Betreff *</label>
            <Input value={betreff} onChange={(e) => setBetreff(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={feldLabel}>Anhänge</label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:border-teal-400 hover:text-teal-700">
                <Paperclip className="h-3.5 w-3.5" /> Datei wählen
                <input type="file" multiple className="hidden" onChange={(e) => dateiHinzufuegen(e.target.files)} />
              </label>
              {anhaenge.map((a, i) => (
                <span key={i} className="flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-xs">
                  {a.dateiname}
                  <button onClick={() => setAnhaenge(anhaenge.filter((_, x) => x !== i))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Großer Schreibbereich */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <MailEditor value={html} onChange={setHtml} />
      </div>

      {fehler && <p className="mx-3 mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</p>}
      {versenden.isSuccess && <p className="mx-3 mb-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Gesendet — Tab schließt sich.</p>}

      {/* Untere Buttons nebeneinander */}
      <div className="flex items-center justify-between border-t border-neutral-200 p-3">
        <Button variant="ghost" size="sm" className="text-red-600" onClick={onAktionErledigt}>
          <Trash2 className="mr-1.5 h-4 w-4" /> Löschen
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={entwurfSichern} disabled={entwurfSpeichern.isPending}>
            <Save className="mr-1.5 h-4 w-4" /> {entwurfId ? "Entwurf aktualisieren" : "Als Entwurf speichern"}
          </Button>
          <Button
            size="sm"
            disabled={!empfaenger.trim() || !betreff.trim() || versenden.isPending}
            onClick={senden}
          >
            <Send className="mr-1.5 h-4 w-4" /> {versenden.isPending ? "Sende …" : "Senden"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Bestätigungs-Dialog beim Schließen eines Verfassen-Tabs. */
export function VerfassenSchliessenDialog({ onWahl, onAbbrechen }: {
  onWahl: (aktion: "loeschen" | "entwurf" | "senden") => void;
  onAbbrechen: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onAbbrechen()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Entwurf schließen — was soll passieren?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-neutral-600">Du hast ungesendete Inhalte in diesem Entwurf.</p>
        <DialogFooter className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" className="text-red-600" onClick={() => onWahl("loeschen")}>
            <Trash2 className="mr-1.5 h-4 w-4" /> Löschen
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onWahl("entwurf")}>
              <Save className="mr-1.5 h-4 w-4" /> Als Entwurf speichern
            </Button>
            <Button onClick={() => onWahl("senden")}>
              <Send className="mr-1.5 h-4 w-4" /> Senden
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
