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
import { Paperclip, Send, Save, Trash2, X, UploadCloud } from "lucide-react";

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
  anhaenge?: Anhang[];
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
    else if (abschlussAktion === "entwurf") entwurfSichern(true);
    else if (abschlussAktion === "senden") senden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abschlussAktion]);
  const [kontoId, setKontoId] = useState<number | null>(start.kontoId ?? null);
  const [empfaenger, setEmpfaenger] = useState(start.empfaenger ?? "");
  const [cc, setCc] = useState(start.cc ?? "");
  const [bcc, setBcc] = useState(start.bcc ?? "");
  const [betreff, setBetreff] = useState(start.betreff ?? "");
  const [html, setHtml] = useState(start.html ?? "<p><br></p>");
  const [anhaenge, setAnhaenge] = useState<Anhang[]>(start.anhaenge ?? []);
  const [drag, setDrag] = useState(false);
  const [entwurfId, setEntwurfId] = useState<number | null>(start.entwurfId ?? null);
  const [editorKey, setEditorKey] = useState(0); // Remount für „Zurücksetzen"
  const [gespeichert, setGespeichert] = useState<string | null>(null);
  const [vorschlaege, setVorschlaege] = useState<{ name: string; email: string; quelle: string }[]>([]);
  const [fehler, setFehler] = useState("");

  const postfaecher = trpc.postfach.postfaecher.useQuery();
  const versenden = trpc.postfach.versenden.useMutation();
  const entwurfSpeichern = trpc.postfach.entwurfSpeichern.useMutation();
  const entwurfLoeschen = trpc.postfach.entwurfLoeschen.useMutation();
  const utils = trpc.useUtils();

  const sucheKontakte = async (q: string) => {
    if (q.trim().length < 2) { setVorschlaege([]); return; }
    const r = await utils.postfach.kontakte.fetch({ q });
    setVorschlaege(r);
  };

  const dateiHinzufuegen = (dateien: FileList | null) => {
    if (!dateien) return;
    for (const d of Array.from(dateien).slice(0, 15)) {
      const leser = new FileReader();
      leser.onload = () => {
        const roh = leser.result as string;
        setAnhaenge((a) => [...a, { dateiname: d.name, base64: roh.slice(roh.indexOf(",") + 1), mime: d.type || "application/octet-stream" }]);
      };
      leser.readAsDataURL(d);
    }
  };

  /** Entwurf speichern — bleibt offen; schliesst nur, wenn der Schliessen-Dialog es ausgelöst hat. */
  const entwurfSichern = (schliessenDanach = false) => {
    entwurfSpeichern.mutate(
      { id: entwurfId ?? undefined, empfaenger, cc, bcc, kontoId: kontoId ?? undefined, betreff, text: html, anhaenge: anhaenge.length ? anhaenge : undefined },
      {
        onSuccess: (r) => {
          setEntwurfId(r.id);
          utils.postfach.entwuerfe.invalidate(); // Seitenleiste sofort aktuell
          if (schliessenDanach) onAktionErledigt();
          else setGespeichert(new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
        },
        onError: (e) => setFehler(e.message),
      },
    );
  };

  /** Editor auf den zuletzt gespeicherten/geladenen Stand zurücksetzen. */
  const zuruecksetzen = () => {
    setHtml(start.html ?? "<p><br></p>");
    setEditorKey((k) => k + 1); // MailEditor remounten → Inhalt wird neu gesetzt
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
        onSuccess: () => {
          // Entwurf nach dem Senden verwerfen + Listen aktualisieren
          if (entwurfId) entwurfLoeschen.mutate({ id: entwurfId });
          utils.postfach.entwuerfe.invalidate();
          utils.postfach.liste.invalidate();
          onAktionErledigt();
        },
        onError: (e) => setFehler(e.message),
      },
    );
  };

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col rounded-lg border bg-white transition-colors ${drag ? "border-teal-400 ring-2 ring-teal-300" : "border-neutral-200"}`}
      onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) setDrag(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); dateiHinzufuegen(e.dataTransfer.files); }}
    >
      {/* Kompakter Kopfblock: 5 Zeilen, Pille links, Feld rechts */}
      <div className="space-y-1 border-b border-neutral-200 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-center text-[11px] text-neutral-500">Von</span>
          <Select
            value={kontoId === null ? "firma" : String(kontoId)}
            onValueChange={(v) => setKontoId(v === "firma" ? null : Number(v))}
          >
            <SelectTrigger className="h-7 text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="firma">Firmen-SMTP (Standard)</SelectItem>
              {(postfaecher.data ?? []).map((k) => (
                <SelectItem key={k.id} value={String(k.id)}>{k.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex items-center gap-2">
          <span className="w-20 shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-center text-[11px] font-medium text-teal-700">Empfänger *</span>
          <Input
            className="h-7 text-[13px]"
            value={empfaenger}
            onChange={(e) => { setEmpfaenger(e.target.value); sucheKontakte(e.target.value.split(",").pop() ?? ""); }}
            placeholder="empfaenger@beispiel.de, zweite@adresse.de"
          />
          {vorschlaege.length > 0 && (
            <div className="absolute left-[5.5rem] right-0 top-full z-20 mt-0.5 rounded-md border border-neutral-200 bg-white shadow-lg">
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
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-center text-[11px] text-neutral-500">CC</span>
          <Input className="h-7 text-[13px]" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional" />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-center text-[11px] text-neutral-500">BCC</span>
          <Input className="h-7 text-[13px]" value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="optional" />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-center text-[11px] text-neutral-500">Betreff *</span>
          <Input className="h-7 text-[13px]" value={betreff} onChange={(e) => setBetreff(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:border-teal-400 hover:text-teal-700">
            {drag ? <UploadCloud className="h-3.5 w-3.5 text-teal-600" /> : <Paperclip className="h-3.5 w-3.5" />}
            {drag ? "Loslassen zum Anhängen" : "Datei wählen (oder überall im Fenster ablegen)"}
            <input type="file" multiple className="hidden" onChange={(e) => dateiHinzufuegen(e.target.files)} />
          </label>
          {anhaenge.map((a, i) => (
            <span key={i} className="flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-xs">
              {a.dateiname}
              <button onClick={() => setAnhaenge(anhaenge.filter((_, x) => x !== i))}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      </div>

      {/* Großer Schreibbereich — Editor füllt den Platz komplett */}
      <div className="flex min-h-0 flex-1 flex-col p-2">
        <MailEditor key={editorKey} value={html} onChange={setHtml} minHeight={260} />
      </div>

      {fehler && <p className="mx-3 mb-1.5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</p>}
      {gespeichert && !fehler && <p className="mx-3 mb-1.5 rounded-md bg-green-50 px-3 py-1.5 text-xs text-green-800">Entwurf gespeichert ({gespeichert}) — sichtbar in der Seitenleiste.</p>}
      {versenden.isSuccess && <p className="mx-3 mb-1.5 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Gesendet — landet im Ordner „Gesendet", Tab schließt sich.</p>}

      {/* Untere Buttons: Löschen | Zurücksetzen | Entwurf speichern | Senden */}
      <div className="flex items-center justify-between border-t border-neutral-200 px-3 py-2">
        <Button variant="ghost" size="sm" className="text-red-600" onClick={onAktionErledigt}>
          <Trash2 className="mr-1.5 h-4 w-4" /> Löschen
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={zuruecksetzen} title="Inhalt auf den gespeicherten Stand zurücksetzen">
            Zurücksetzen
          </Button>
          <Button variant="outline" size="sm" onClick={() => entwurfSichern(false)} disabled={entwurfSpeichern.isPending}>
            <Save className="mr-1.5 h-4 w-4" /> {entwurfId ? "Entwurf speichern" : "Als Entwurf speichern"}
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
