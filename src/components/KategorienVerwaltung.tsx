import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

/** Kategorien (Schnellauswahl im Post Manager) mit Konto-Mapping verwalten. */
export function KategorienVerwaltung() {
  const utils = trpc.useUtils();
  const kategorien = trpc.kontierung.kategorien.useQuery();
  const [name, setName] = useState("");
  const [konto, setKonto] = useState("");
  const [ustSatz, setUstSatz] = useState("19");

  const invalidieren = () => utils.kontierung.kategorien.invalidate();
  const anlegen = trpc.kontierung.kategorieAnlegen.useMutation({
    onSuccess: () => {
      invalidieren();
      setName("");
      setKonto("");
    },
  });
  const loeschen = trpc.kontierung.kategorieLoeschen.useMutation({ onSuccess: invalidieren });

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-medium text-neutral-700">Kategorien (Kontierung)</h2>
      <p className="mb-4 text-xs text-neutral-400">
        Schnellauswahl im Post Manager: Eine Kategorie füllt Konto und USt-Satz automatisch. Das
        Konto bezieht sich auf den in den DATEV-Einstellungen gewählten Kontenrahmen.
      </p>

      <div className="space-y-2">
        {(kategorien.data ?? []).map((k) => (
          <div key={k.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2 text-sm">
            <span className="flex-1 font-medium text-neutral-800">{k.name}</span>
            <span className="w-24 text-neutral-500">{k.konto ?? "—"}</span>
            <span className="w-14 text-neutral-500">{k.ustSatz} %</span>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              onClick={() => {
                if (confirm(`Kategorie „${k.name}" löschen?`)) loeschen.mutate({ id: k.id });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input className="w-48" placeholder="Neue Kategorie" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="w-28" placeholder="Konto" value={konto} onChange={(e) => setKonto(e.target.value)} />
        <Select value={ustSatz} onValueChange={setUstSatz}>
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="19">19 %</SelectItem>
            <SelectItem value="7">7 %</SelectItem>
            <SelectItem value="0">0 %</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!name.trim() || anlegen.isPending}
          onClick={() =>
            anlegen.mutate({ name: name.trim(), konto: konto.trim() || undefined, ustSatz: Number(ustSatz) })
          }
        >
          <Plus className="mr-2 h-4 w-4" />Hinzufügen
        </Button>
      </div>
    </section>
  );
}
