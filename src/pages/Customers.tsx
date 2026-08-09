import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSortierung } from "@/lib/sortierung";
import { Button } from "@/components/ui/button";
import { CsvButton } from "@/components/CsvButton";
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
import { Plus, Search } from "lucide-react";
import ImportDialog from "@/components/ImportDialog";
import { KonditionenSection } from "@/components/KonditionenSection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ZAHLUNGSZIELE_TAGE } from "@contracts/invoicing";

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
  zahlungszielTage: string;
  notizen: string;
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
  zahlungszielTage: "",
  notizen: "",
};

export default function Customers() {
  const [suche, setSuche] = useState("");
  const [dialogOffen, setDialogOffen] = useState(false);
  const [form, setForm] = useState<FormState>(leeresFormular);

  const utils = trpc.useUtils();
  const liste = trpc.customers.list.useQuery({ suche: suche || undefined });
  const sort = useSortierung<NonNullable<typeof liste.data>[number]>("name");
  const zeilen = sort.sortiere(liste.data ?? [], (k, key) =>
    key === "name" ? k.name : key === "ort" ? k.ort : key === "plz" ? k.plz : null,
  );
  const speichern = trpc.customers.create.useMutation({
    onSuccess: () => {
      utils.customers.list.invalidate();
      setDialogOffen(false);
    },
  });
  const aktualisieren = trpc.customers.update.useMutation({
    onSuccess: () => {
      utils.customers.list.invalidate();
      setDialogOffen(false);
    },
  });
  const archivieren = trpc.customers.setArchiviert.useMutation({
    onSuccess: () => utils.customers.list.invalidate(),
  });

  const oeffneBearbeiten = (k: NonNullable<typeof liste.data>[number]) => {
    setForm({
      id: k.id,
      name: k.name,
      zusatz: k.zusatz ?? "",
      strasse: k.strasse,
      plz: k.plz,
      ort: k.ort,
      land: k.land,
      email: k.email ?? "",
      telefon: k.telefon ?? "",
      ustIdNr: k.ustIdNr ?? "",
      zahlungszielTage: k.zahlungszielTage != null ? String(k.zahlungszielTage) : "",
      notizen: k.notizen ?? "",
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
      zahlungszielTage:
        form.zahlungszielTage === "" ? null : Number(form.zahlungszielTage),
      notizen: form.notizen || null,
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
        <h1 className="text-xl font-semibold tracking-tight">Kunden</h1>
        <div className="flex items-center gap-2">
          <CsvButton
            dateiname="kunden.csv"
            zeilen={[
              ["Name", "Zusatz", "Straße", "PLZ", "Ort", "Land", "E-Mail", "Telefon", "USt-IdNr.", "Zahlungsziel (Tage)", "Archiviert"],
              ...(liste.data ?? []).map((k) => [
                k.name, k.zusatz, k.strasse, k.plz, k.ort, k.land, k.email, k.telefon,
                k.ustIdNr, k.zahlungszielTage, k.archiviert ? "ja" : "nein",
              ]),
            ]}
          />
          <ImportDialog typ="kunden" onFertig={() => utils.customers.list.invalidate()} />
          <Button
            onClick={() => {
              setForm(leeresFormular);
              setDialogOffen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Neuer Kunde
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
                  Keine Kunden gefunden.
                </td>
              </tr>
            )}
            {zeilen.map((k) => (
              <tr key={k.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-neutral-900">
                    {k.name} {k.archiviert && <Badge variant="secondary">archiviert</Badge>}
                  </div>
                  {k.zusatz && <div className="text-xs text-neutral-500">{k.zusatz}</div>}
                </td>
                <td className="px-4 py-2.5 text-neutral-600">
                  {k.strasse}, {k.plz} {k.ort}
                </td>
                <td className="px-4 py-2.5 text-neutral-600">
                  <div className="text-xs">{k.email}</div>
                  <div className="text-xs">{k.telefon}</div>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button variant="ghost" size="sm" onClick={() => oeffneBearbeiten(k)}>
                    Bearbeiten
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => archivieren.mutate({ id: k.id, archiviert: !k.archiviert })}
                  >
                    {k.archiviert ? "Reaktivieren" : "Archivieren"}
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
            <DialogTitle>{form.id ? "Kunde bearbeiten" : "Neuer Kunde"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="col-span-2">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Dr. med. Max Mustermann / Praxis GmbH"
              />
            </div>
            <div className="col-span-2">
              <Label>Adresszusatz</Label>
              <Input
                value={form.zusatz}
                onChange={(e) => setForm({ ...form, zusatz: e.target.value })}
                placeholder="z. Hd. …, c/o …"
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
            <div>
              <Label>USt-IdNr. (bei Firmenkunden)</Label>
              <Input
                value={form.ustIdNr}
                onChange={(e) => setForm({ ...form, ustIdNr: e.target.value })}
                placeholder="DE123456789"
              />
            </div>
            <div>
              <Label>Zahlungsziel (abweichend)</Label>
              <Select
                value={form.zahlungszielTage || "standard"}
                onValueChange={(v) =>
                  setForm({ ...form, zahlungszielTage: v === "standard" ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  {ZAHLUNGSZIELE_TAGE.map((t) => (
                    <SelectItem key={t} value={String(t)}>
                      {t === 0 ? "sofort" : `${t} Tage`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <KonditionenSection typ="kunde" partnerId={form.id} />
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
