import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Mail, Phone, Building2, Trash2, Pencil, Sparkles, Check } from "lucide-react";

interface KontaktForm {
  id?: number;
  name: string;
  email: string;
  telefon: string;
  firma: string;
  notiz: string;
}
const LEER: KontaktForm = { name: "", email: "", telefon: "", firma: "", notiz: "" };

export default function Kontakte() {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<KontaktForm | null>(null);
  const [extraktionOffen, setExtraktionOffen] = useState(false);
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());

  const liste = trpc.kontakte.liste.useQuery({ q: q || undefined });
  const vorschau = trpc.kontakte.extraktionVorschau.useQuery({}, { enabled: extraktionOffen });
  const anlegen = trpc.kontakte.anlegen.useMutation({ onSuccess: () => { utils.kontakte.liste.invalidate(); setDialog(null); } });
  const aktualisieren = trpc.kontakte.aktualisieren.useMutation({ onSuccess: () => { utils.kontakte.liste.invalidate(); setDialog(null); } });
  const loeschen = trpc.kontakte.loeschen.useMutation({ onSuccess: () => utils.kontakte.liste.invalidate() });
  const uebernehmen = trpc.kontakte.extraktionUebernehmen.useMutation({
    onSuccess: () => {
      utils.kontakte.liste.invalidate();
      vorschau.refetch();
      setAuswahl(new Set());
    },
  });

  const speichern = () => {
    if (!dialog) return;
    const { id, ...rest } = dialog;
    const daten = {
      name: rest.name,
      email: rest.email,
      telefon: rest.telefon || null,
      firma: rest.firma || null,
      notiz: rest.notiz || null,
    };
    if (id) aktualisieren.mutate({ id, ...daten });
    else anlegen.mutate(daten);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Kontakte-Kartei</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, E-Mail, Firma …" className="w-64 pl-8" />
          </div>
          <Button variant="outline" onClick={() => { setExtraktionOffen(true); setAuswahl(new Set()); }}>
            <Sparkles className="mr-1.5 h-4 w-4" /> Aus Mails extrahieren
          </Button>
          <Button onClick={() => setDialog(LEER)}>
            <Plus className="mr-1.5 h-4 w-4" /> Neuer Kontakt
          </Button>
        </div>
      </div>

      {/* Karten */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {(liste.data ?? []).map((k) => (
          <div key={k.id} className="group relative rounded-lg border border-neutral-200 bg-white p-4 hover:shadow-sm">
            <div className="mb-2 flex items-start justify-between gap-2">
              <h3 className="min-w-0 flex-1 truncate font-semibold">{k.name}</h3>
              <Badge variant={k.quelle === "mail" ? "default" : "secondary"} className="shrink-0 text-[10px]">
                {k.quelle}
              </Badge>
            </div>
            <div className="space-y-1 text-sm text-neutral-600">
              <div className="flex items-center gap-1.5 truncate">
                <Mail className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                <a href={`mailto:${k.email}`} className="truncate text-teal-700 hover:underline">{k.email}</a>
              </div>
              {k.telefon && (
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  <span>{k.telefon}</span>
                </div>
              )}
              {k.firma && (
                <div className="flex items-center gap-1.5 truncate">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  <span className="truncate">{k.firma}</span>
                </div>
              )}
              {k.notiz && <p className="mt-1 line-clamp-2 text-xs text-neutral-400">{k.notiz}</p>}
            </div>
            <div className="mt-3 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                variant="ghost" size="sm"
                onClick={() => setDialog({ id: k.id, name: k.name, email: k.email, telefon: k.telefon ?? "", firma: k.firma ?? "", notiz: k.notiz ?? "" })}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost" size="sm" className="text-red-600"
                onClick={() => confirm(`Kontakt „${k.name}" löschen?`) && loeschen.mutate({ id: k.id })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {(liste.data ?? []).length === 0 && !liste.isLoading && (
        <p className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-400">
          Noch keine Kontakte — manuell anlegen oder <button className="underline" onClick={() => setExtraktionOffen(true)}>aus Mails extrahieren</button>.
        </p>
      )}

      {/* Dialog: Kontakt anlegen/bearbeiten */}
      {dialog && (
        <Dialog open onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{dialog.id ? "Kontakt bearbeiten" : "Neuer Kontakt"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name *</Label>
                <Input value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />
              </div>
              <div>
                <Label>E-Mail *</Label>
                <Input type="email" value={dialog.email} onChange={(e) => setDialog({ ...dialog, email: e.target.value })} />
              </div>
              <div>
                <Label>Telefon</Label>
                <Input value={dialog.telefon} onChange={(e) => setDialog({ ...dialog, telefon: e.target.value })} />
              </div>
              <div>
                <Label>Firma</Label>
                <Input value={dialog.firma} onChange={(e) => setDialog({ ...dialog, firma: e.target.value })} />
              </div>
              <div>
                <Label>Notiz</Label>
                <Textarea value={dialog.notiz} onChange={(e) => setDialog({ ...dialog, notiz: e.target.value })} rows={3} />
              </div>
            </div>
            {(anlegen.error ?? aktualisieren.error) && (
              <p className="text-sm text-red-600">{(anlegen.error ?? aktualisieren.error)?.message}</p>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialog(null)}>Abbrechen</Button>
              <Button onClick={speichern} disabled={!dialog.name.trim() || !dialog.email.trim()}>
                Speichern
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog: Extraktion (Vorschau + Auswahl) */}
      {extraktionOffen && (
        <Dialog open onOpenChange={(o) => !o && setExtraktionOffen(false)}>
          <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-2xl flex-col overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Kontakte aus Mail-Absendern extrahieren</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-neutral-500">
              Serverseitige Extraktion aus Absender-Metadaten (keine Mail-Inhalte — DSGVO-datenminimiert).
              Wähle aus, was übernommen werden soll:
            </p>
            {vorschau.isLoading && <p className="text-sm text-neutral-400">Analysiere …</p>}
            {vorschau.data && (
              <>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span>
                    {vorschau.data.anzahl} Absender gefunden · <strong>{vorschau.data.neu} neu</strong>
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => setAuswahl(new Set(vorschau.data!.kandidaten.filter((k) => !k.bereitsVorhanden).map((k) => k.email)))}
                    >
                      Alle neuen
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setAuswahl(new Set())}>Keine</Button>
                  </div>
                </div>
                <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2">
                  {vorschau.data.kandidaten.map((k) => (
                    <label key={k.email} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${k.bereitsVorhanden ? "opacity-40" : "hover:bg-neutral-50 cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        disabled={k.bereitsVorhanden}
                        checked={auswahl.has(k.email)}
                        onChange={(e) => {
                          const neu = new Set(auswahl);
                          if (e.target.checked) neu.add(k.email); else neu.delete(k.email);
                          setAuswahl(neu);
                        }}
                      />
                      <span className="w-52 truncate font-medium">{k.name}</span>
                      <span className="min-w-0 flex-1 truncate text-neutral-500">{k.email}</span>
                      <span className="text-xs text-neutral-400">{k.mailAnzahl}×</span>
                      {k.bereitsVorhanden && <Badge variant="outline" className="text-[10px]">vorhanden</Badge>}
                    </label>
                  ))}
                </div>
              </>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setExtraktionOffen(false)}>Schließen</Button>
              <Button
                disabled={auswahl.size === 0 || uebernehmen.isPending}
                onClick={() => {
                  const kandidaten = (vorschau.data?.kandidaten ?? [])
                    .filter((k) => auswahl.has(k.email))
                    .map((k) => ({ email: k.email, name: k.name }));
                  uebernehmen.mutate({ kandidaten });
                }}
              >
                <Check className="mr-1.5 h-4 w-4" /> {auswahl.size} übernehmen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
