import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { datum as fmtDatum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Repeat, Trash2, Play, Pause } from "lucide-react";

export function SerienDialog({
  offen,
  onSchliessen,
}: {
  offen: boolean;
  onSchliessen: () => void;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const liste = trpc.series.list.useQuery(undefined, { enabled: offen });

  const erzeugen = trpc.series.erzeugen.useMutation({
    onSuccess: (d) => {
      utils.series.list.invalidate();
      utils.invoices.list.invalidate();
      navigate(`/rechnungen/${d.invoiceId}`);
    },
  });
  const setAktiv = trpc.series.setAktiv.useMutation({
    onSuccess: () => utils.series.list.invalidate(),
  });
  const loeschen = trpc.series.loeschen.useMutation({
    onSuccess: () => utils.series.list.invalidate(),
  });

  return (
    <Dialog open={offen} onOpenChange={(o) => !o && onSchliessen()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5" /> Serien-Rechnungen
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-neutral-400">
          Wiederkehrende Belege: Sobald eine Serie fällig ist, erzeugst du per
          Klick einen Entwurf (Nummer wird erst beim Finalisieren vergeben).
          Serien speicherst du aus einer Rechnung heraus („Als Serie speichern").
        </p>
        <div className="max-h-[55vh] overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {(liste.data ?? []).length === 0 && (
                <tr>
                  <td className="py-4 text-center text-neutral-400">
                    Noch keine Serien — öffne eine Rechnung und wähle „Als Serie speichern".
                  </td>
                </tr>
              )}
              {(liste.data ?? []).map((s) => (
                <tr key={s.id} className="border-b border-neutral-100 last:border-0">
                  <td className="py-2.5">
                    <div className="font-medium">{s.titel}</div>
                    <div className="text-xs text-neutral-400">
                      {s.kundeName} · alle {s.intervallTage} Tage · nächste: {fmtDatum(s.naechsteFaellig)}
                    </div>
                  </td>
                  <td className="py-2.5">
                    {!s.aktiv ? (
                      <Badge variant="secondary">pausiert</Badge>
                    ) : s.faellig ? (
                      <Badge variant="destructive">fällig</Badge>
                    ) : (
                      <Badge variant="outline">läuft</Badge>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {s.aktiv && (
                        <Button
                          size="sm"
                          variant={s.faellig ? "default" : "outline"}
                          disabled={erzeugen.isPending}
                          onClick={() => erzeugen.mutate({ id: s.id })}
                        >
                          Entwurf erzeugen
                        </Button>
                      )}
                      <Button
                        size="sm" variant="ghost"
                        title={s.aktiv ? "Pausieren" : "Fortsetzen"}
                        onClick={() => setAktiv.mutate({ id: s.id, aktiv: !s.aktiv })}
                      >
                        {s.aktiv ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm" variant="ghost" title="Löschen"
                        onClick={() => {
                          if (confirm(`Serie „${s.titel}" löschen?`)) loeschen.mutate({ id: s.id });
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onSchliessen}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SerieSpeichernDialog({
  invoiceId,
  vorschlagTitel,
  offen,
  onSchliessen,
}: {
  invoiceId: number;
  vorschlagTitel: string;
  offen: boolean;
  onSchliessen: () => void;
}) {
  const [titel, setTitel] = useState(vorschlagTitel);
  const [intervall, setIntervall] = useState(30);
  const [naechste, setNaechste] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });

  const speichern = trpc.series.ausRechnung.useMutation({
    onSuccess: () => {
      alert("Serie gespeichert — unter Rechnungen → Serien verwaltest du sie.");
      onSchliessen();
    },
  });

  return (
    <Dialog open={offen} onOpenChange={(o) => !o && onSchliessen()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Als Serie speichern</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Titel der Serie</Label>
            <Input value={titel} onChange={(e) => setTitel(e.target.value)} />
          </div>
          <div>
            <Label>Wiederholung alle … Tage</Label>
            <Input
              type="number" min={1} max={365} value={intervall}
              onChange={(e) => setIntervall(Math.max(1, Number(e.target.value) || 30))}
            />
          </div>
          <div>
            <Label>Nächste Rechnung am</Label>
            <Input type="date" value={naechste} onChange={(e) => setNaechste(e.target.value)} />
          </div>
          <p className="text-xs text-neutral-400">
            Die Positionen dieser Rechnung werden als Vorlage übernommen.
          </p>
          {speichern.error && <p className="text-sm text-red-600">{speichern.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onSchliessen}>Abbrechen</Button>
          <Button
            disabled={!titel || speichern.isPending}
            onClick={() =>
              speichern.mutate({ invoiceId, titel, intervallTage: intervall, naechsteFaellig: naechste })
            }
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
