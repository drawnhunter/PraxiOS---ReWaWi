import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSortierung } from "@/lib/sortierung";
import { Button } from "@/components/ui/button";
import { CsvButton } from "@/components/CsvButton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Plus, Search } from "lucide-react";
import { KonditionenSection } from "@/components/KonditionenSection";

interface FormState {
  id?: number;
  name: string;
  zusatz: string;
  strasse: string;
  plz: string;
  ort: string;
  land: string;
  email: string;
  telefon: string;
  ustIdNr: string;
  notizen: string;
  kategorieId: number | null;
}

const leeresFormular: FormState = {
  name: "",
  zusatz: "",
  strasse: "",
  plz: "",
  ort: "",
  land: "Deutschland",
  email: "",
  telefon: "",
  ustIdNr: "",
  notizen: "",
  kategorieId: null,
};

export default function Suppliers() {
  const [suche, setSuche] = useState("");
  const [dialogOffen, setDialogOffen] = useState(false);
  const [form, setForm] = useState<FormState>(leeresFormular);

  const utils = trpc.useUtils();
  const liste = trpc.suppliers.list.useQuery({ suche: suche || undefined });
  const sort = useSortierung<NonNullable<typeof liste.data>[number]>("name");
  const zeilen = sort.sortiere(liste.data ?? [], (l, key) =>
    key === "name" ? l.name : key === "ort" ? l.ort : null,
  );
  const kategorienListe = trpc.kontierung.kategorien.useQuery();
  const speichern = trpc.suppliers.create.useMutation({
    onSuccess: () => {
      utils.suppliers.list.invalidate();
      setDialogOffen(false);
    },
  });
  const aktualisieren = trpc.suppliers.update.useMutation({
    onSuccess: () => {
      utils.suppliers.list.invalidate();
      setDialogOffen(false);
    },
  });
  const archivieren = trpc.suppliers.setArchiviert.useMutation({
    onSuccess: () => utils.suppliers.list.invalidate(),
  });

  const oeffneBearbeiten = (l: NonNullable<typeof liste.data>[number]) => {
    setForm({
      id: l.id,
      name: l.name,
      zusatz: l.zusatz ?? "",
      strasse: l.strasse,
      plz: l.plz,
      ort: l.ort,
      land: l.land,
      email: l.email ?? "",
      telefon: l.telefon ?? "",
      ustIdNr: l.ustIdNr ?? "",
      notizen: l.notizen ?? "",
      kategorieId: l.kategorieId ?? null,
    });
    setDialogOffen(true);
  };

  const absenden = () => {
    const daten = {
      name: form.name,
      zusatz: form.zusatz || null,
      strasse: form.strasse,
      plz: form.plz,
      ort: form.ort,
      land: form.land || "Deutschland",
      email: form.email || null,
      telefon: form.telefon || null,
      ustIdNr: form.ustIdNr || null,
      notizen: form.notizen || null,
      kategorieId: form.kategorieId ?? null,
    };
    if (form.id) {
      aktualisieren.mutate({ id: form.id, data: daten });
    } else {
      speichern.mutate(daten);
    }
  };

  const fehler = speichern.error ?? aktualisieren.error;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Lieferanten</h1>
        <div className="flex items-center gap-2">
          <CsvButton
            dateiname="lieferanten.csv"
            zeilen={[
              ["Name", "Zusatz", "Straße", "PLZ", "Ort", "Land", "E-Mail", "Telefon", "USt-IdNr.", "Notizen", "Archiviert"],
              ...(liste.data ?? []).map((l) => [
                l.name, l.zusatz, l.strasse, l.plz, l.ort, l.land, l.email, l.telefon,
                l.ustIdNr, l.notizen, l.archiviert ? "ja" : "nein",
              ]),
            ]}
          />
          <Button
            onClick={() => {
              setForm(leeresFormular);
              setDialogOffen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Neuer Lieferant
          </Button>
        </div>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
        <Input
          className="pl-9"
          placeholder="Suchen (Name, Ort, E-Mail) …"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
                <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
              <th className="cursor-pointer select-none px-4 py-2.5 font-medium" onClick={() => sort.umschalten("name")}>Name<sort.KopfIcon k="name" /></th>
              <th className="px-4 py-2.5 font-medium">Adresse</th>
              <th className="px-4 py-2.5 font-medium">Kontakt</th>
              <th className="px-4 py-2.5 text-right font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                  Keine Lieferanten vorhanden.
                </td>
              </tr>
            )}
            {zeilen.map((l) => (
              <tr key={l.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-neutral-900">
                    {l.name} {l.archiviert && <Badge variant="secondary">archiviert</Badge>}
                  </div>
                  {l.zusatz && <div className="text-xs text-neutral-500">{l.zusatz}</div>}
                </td>
                <td className="px-4 py-2.5 text-neutral-600">
                  {l.strasse}, {l.plz} {l.ort}
                </td>
                <td className="px-4 py-2.5 text-neutral-600">
                  <div className="text-xs">{l.email}</div>
                  <div className="text-xs">{l.telefon}</div>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button variant="ghost" size="sm" onClick={() => oeffneBearbeiten(l)}>
                    Bearbeiten
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      archivieren.mutate({ id: l.id, archiviert: !l.archiviert })
                    }
                  >
                    {l.archiviert ? "Reaktivieren" : "Archivieren"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={dialogOffen} onOpenChange={setDialogOffen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Lieferant bearbeiten" : "Neuer Lieferant"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="col-span-2">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>Adresszusatz</Label>
              <Input
                value={form.zusatz}
                onChange={(e) => setForm({ ...form, zusatz: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>Straße *</Label>
              <Input
                value={form.strasse}
                onChange={(e) => setForm({ ...form, strasse: e.target.value })}
              />
            </div>
            <div>
              <Label>PLZ *</Label>
              <Input
                value={form.plz}
                onChange={(e) => setForm({ ...form, plz: e.target.value })}
              />
            </div>
            <div>
              <Label>Ort *</Label>
              <Input
                value={form.ort}
                onChange={(e) => setForm({ ...form, ort: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>Land</Label>
              <Input
                value={form.land}
                onChange={(e) => setForm({ ...form, land: e.target.value })}
              />
            </div>
            <div>
              <Label>E-Mail</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <Label>Telefon</Label>
              <Input
                value={form.telefon}
                onChange={(e) => setForm({ ...form, telefon: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>USt-IdNr.</Label>
              <Input
                value={form.ustIdNr}
                onChange={(e) => setForm({ ...form, ustIdNr: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>Standard-Kategorie (Regelwerk Post Manager)</Label>
              <Select
                value={form.kategorieId ? String(form.kategorieId) : "0"}
                onValueChange={(v) => setForm({ ...form, kategorieId: v === "0" ? null : Number(v) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">— keine —</SelectItem>
                  {(kategorienListe.data ?? []).map((k) => (
                    <SelectItem key={k.id} value={String(k.id)}>
                      {k.name}{k.konto ? ` (${k.konto})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-neutral-400">
                Eingescannte Belege dieses Lieferanten schlagen Kategorie, Konto und
                USt-Satz automatisch vor.
              </p>
            </div>
            <div className="col-span-2">
              <Label>Notizen (intern)</Label>
              <Textarea
                value={form.notizen}
                onChange={(e) => setForm({ ...form, notizen: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          {fehler && <p className="text-sm text-red-600">{fehler.message}</p>}
          {form.id && (
            <KonditionenSection typ="lieferant" partnerId={form.id} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOffen(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={absenden}
              disabled={!form.name || !form.strasse || !form.plz || !form.ort}
            >
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
