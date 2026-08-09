import { useEffect, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Building2, Plus, Pencil, Trash2, FileText, ExternalLink } from "lucide-react";

/** Company Control (v1.6): Alle registrierten Kennnummern an einem Ort —
 *  strukturierte Felder + freie Kennwerte mit Beleg-Verknuepfung. */

type KennFeld = { key: string; label: string; hinweis?: string };

const KENNFELDER: KennFeld[] = [
  { key: "handelsregister", label: "Handelsregister" },
  { key: "steuernummer", label: "Steuernummer" },
  { key: "ustIdNr", label: "USt-IdNr." },
  { key: "eori", label: "EORI-Nummer", hinweis: "Einfuhr aus Nicht-EU-Staaten" },
  { key: "betriebsnummer", label: "Betriebsnummer", hinweis: "Agentur für Arbeit" },
  { key: "bgMitgliedsnummer", label: "BG-Mitgliedsnummer", hinweis: "Berufsgenossenschaft" },
  { key: "ihk", label: "IHK / HWK" },
  { key: "glaeubigerId", label: "Gläubiger-ID", hinweis: "SEPA-Lastschrift" },
];

type Freier = { id?: number; name: string; wert: string; postEingangId: number | null; sortierung: number };

export default function Unternehmen() {
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  const kennwerte = trpc.unternehmen.kennwerte.useQuery();
  const belege = trpc.unternehmen.belegAuswahl.useQuery();

  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [dialog, setDialog] = useState<Freier | null>(null);

  useEffect(() => {
    if (settings.data && !form) {
      const { smtpPasswortGesetzt: _pw, ...rest } = settings.data as Record<string, unknown>;
      void _pw;
      setForm(rest);
    }
  }, [settings.data, form]);

  const speichern = trpc.settings.update.useMutation({
    onSuccess: () => utils.settings.get.invalidate(),
  });
  const anlegen = trpc.unternehmen.kennwertAnlegen.useMutation({
    onSuccess: () => { kennwerte.refetch(); setDialog(null); },
  });
  const aktualisieren = trpc.unternehmen.kennwertAktualisieren.useMutation({
    onSuccess: () => { kennwerte.refetch(); setDialog(null); },
  });
  const loeschen = trpc.unternehmen.kennwertLoeschen.useMutation({
    onSuccess: () => kennwerte.refetch(),
  });

  const speichernKlick = () => {
    if (!form) return;
    speichern.mutate(form as never);
  };

  const fehlende = KENNFELDER.filter((f) => !(form?.[f.key] as string | undefined)?.trim());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Building2 className="h-5 w-5" /> Unternehmen
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Company Control — alle registrierten Nummern an einem Ort, mit Belegen verknüpft.
        </p>
      </div>

      {fehlende.length > 0 && form && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Noch nicht hinterlegt: {fehlende.map((f) => f.label).join(" · ")}
        </p>
      )}

      {/* ── Strukturierte Kennnummern ── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-700">Registrierte Kennnummern</h2>
          <Button size="sm" onClick={speichernKlick} disabled={!form || speichern.isPending}>
            {speichern.isPending ? "Speichere …" : "Speichern"}
          </Button>
        </div>
        {!form ? (
          <p className="text-sm text-neutral-400">Lade …</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {KENNFELDER.map((f) => (
              <div key={f.key}>
                <Label className="text-xs text-neutral-500">
                  {f.label}{f.hinweis ? <span className="ml-1 text-neutral-400">({f.hinweis})</span> : null}
                </Label>
                <Input
                  value={(form[f.key] as string) ?? ""}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value || null })}
                  placeholder="—"
                />
              </div>
            ))}
          </div>
        )}
        {speichern.isSuccess && <p className="mt-2 text-xs text-green-700">Gespeichert.</p>}
        {speichern.error && <p className="mt-2 text-xs text-red-600">{speichern.error.message}</p>}
      </section>

      {/* ── Freie Kennwerte ── */}
      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
          <h2 className="text-sm font-medium text-neutral-700">Weitere Kennwerte</h2>
          <Button size="sm" variant="outline" onClick={() => setDialog({ name: "", wert: "", postEingangId: null, sortierung: 0 })}>
            <Plus className="mr-1.5 h-4 w-4" /> Hinzufügen
          </Button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {(kennwerte.data ?? []).map((k) => (
              <tr key={k.k.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-5 py-2.5 font-medium text-neutral-800">{k.k.name}</td>
                <td className="px-5 py-2.5 tabular-nums">{k.k.wert}</td>
                <td className="px-5 py-2.5">
                  {k.k.postEingangId ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/posteingang?beleg=${k.k.postEingangId}`}>
                        <FileText className="mr-1.5 h-4 w-4" />
                        {k.belegName ?? "Beleg"}
                        <ExternalLink className="ml-1 h-3 w-3 text-neutral-400" />
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ ...k.k })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => confirm(`„${k.k.name}" wirklich löschen?`) && loeschen.mutate({ id: k.k.id })}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </td>
              </tr>
            ))}
            {(kennwerte.data ?? []).length === 0 && (
              <tr>
                <td className="px-5 py-6 text-center text-sm text-neutral-400" colSpan={4}>
                  Noch keine freien Kennwerte — z. B. EORI, Kundennummern bei Versorgern,
                  Vereinsregister, Genehmigungen …
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ── Dialog: freier Kennwert ── */}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{dialog.id ? "Kennwert bearbeiten" : "Kennwert hinzufügen"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Bezeichnung</Label>
                <Input
                  value={dialog.name}
                  onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
                  placeholder="z. B. EORI-Nummer, Kundennummer Stadtwerke …"
                />
              </div>
              <div>
                <Label>Wert</Label>
                <Input
                  value={dialog.wert}
                  onChange={(e) => setDialog({ ...dialog, wert: e.target.value })}
                  placeholder="Nummer / Kennung"
                />
              </div>
              <div>
                <Label>Beleg verknüpfen (optional)</Label>
                <Select
                  value={dialog.postEingangId ? String(dialog.postEingangId) : "0"}
                  onValueChange={(v) => setDialog({ ...dialog, postEingangId: v === "0" ? null : Number(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">— kein Beleg —</SelectItem>
                    {(belege.data ?? []).map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        #{b.id} {b.stichwort ?? b.originalname}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-neutral-400">
                  Der verknüpfte Bescheid/Nachweis liegt im Post Manager und ist hier direkt erreichbar.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>Abbrechen</Button>
              <Button
                disabled={!dialog.name.trim() || !dialog.wert.trim() || anlegen.isPending || aktualisieren.isPending}
                onClick={() =>
                  dialog.id
                    ? aktualisieren.mutate({ id: dialog.id, data: { name: dialog.name, wert: dialog.wert, postEingangId: dialog.postEingangId, sortierung: dialog.sortierung } })
                    : anlegen.mutate({ name: dialog.name, wert: dialog.wert, postEingangId: dialog.postEingangId, sortierung: 0 })
                }
              >
                Speichern
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <p className="text-xs text-neutral-400">
        <Badge variant="outline" className="mr-1.5">Tipp</Badge>
        Handelsregister, Steuernummer und USt-IdNr. erscheinen auch auf deinen Belegen
        (Einstellungen → Firma) — Änderungen hier gelten sofort für neue PDFs.
      </p>
    </div>
  );
}
