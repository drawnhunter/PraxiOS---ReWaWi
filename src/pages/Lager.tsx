import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { geld, datum as fmtDatum } from "@/lib/format";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScanDialog } from "@/components/ScanDialog";
import { ScanLine, Plus, Minus, ClipboardList, AlertTriangle, Scale, Tag, Download } from "lucide-react";
import { useSortierung } from "@/lib/sortierung";
import { pdfHerunterladen } from "@/lib/downloads";

type Zeile = {
  id: number; name: string; artikelnummer: string | null; barcode: string | null;
  kategorie: string | null; einheit: string; ekPreisNetto: string | null;
  mindestbestand: number | null; bestand: number; niedrig: boolean;
};

function BuchungsDialog({
  zeile, typ, onClose, onFertig,
}: { zeile: Zeile; typ: "zugang" | "abgang" | "korrektur" | "inventur"; onClose: () => void; onFertig: () => void }) {
  const [menge, setMenge] = useState("");
  const [bemerkung, setBemerkung] = useState("");
  const buchen = trpc.lager.buchen.useMutation({ onSuccess: onFertig });
  const titel = { zugang: "Zugang", abgang: "Abgang", korrektur: "Korrektur", inventur: "Inventur" }[typ];
  const absolut = typ === "korrektur" || typ === "inventur";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{titel}: {zeile.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">
            Aktueller Bestand: <strong>{zeile.bestand} {zeile.einheit}</strong>
          </p>
          <div>
            <Label>{absolut ? "Neuer Bestand (absolut)" : `Menge (${typ === "zugang" ? "+" : "−"})`}</Label>
            <Input
              type="number" step="0.01" min="0" autoFocus value={menge}
              onChange={(e) => setMenge(e.target.value)}
            />
          </div>
          <div>
            <Label>Bemerkung (optional)</Label>
            <Input value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} placeholder={typ === "zugang" ? "z. B. Lieferung Drewitz" : ""} />
          </div>
          {buchen.error && <p className="text-sm text-red-600">{buchen.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button
            disabled={!menge || Number(menge) <= 0 || buchen.isPending}
            onClick={() =>
              buchen.mutate({
                productId: zeile.id, typ, menge: Number(menge),
                datum: new Date().toISOString().slice(0, 10),
                bemerkung: bemerkung || undefined,
              })
            }
          >
            Buchen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerlaufDialog({ zeile, onClose }: { zeile: Zeile; onClose: () => void }) {
  const bewegungen = trpc.lager.bewegungen.useQuery({ productId: zeile.id });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bewegungen: {zeile.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {(bewegungen.data ?? []).map((b) => (
                <tr key={b.id} className="border-b border-neutral-100 last:border-0">
                  <td className="py-1.5 text-neutral-500">{fmtDatum(b.datum)}</td>
                  <td className="py-1.5">
                    <Badge variant={b.typ === "zugang" ? "default" : b.typ === "abgang" ? "destructive" : "secondary"}>
                      {b.typ}
                    </Badge>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {Number(b.menge) > 0 ? "+" : ""}{Number(b.menge)} {zeile.einheit}
                  </td>
                  <td className="max-w-[180px] truncate py-1.5 text-neutral-400">{b.bemerkung}</td>
                </tr>
              ))}
              {(bewegungen.data ?? []).length === 0 && (
                <tr><td className="py-3 text-neutral-400">Noch keine Bewegungen.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Lager() {
  const utils = trpc.useUtils();
  const bestand = trpc.lager.bestand.useQuery();
  const vergleich = trpc.lager.vergleich.useQuery();

  const [tab, setTab] = useState<"bestand" | "vergleich">("bestand");
  const [suche, setSuche] = useState("");
  const [kategorie, setKategorie] = useState("alle");
  const [buchung, setBuchung] = useState<{ zeile: Zeile; typ: "zugang" | "abgang" | "korrektur" | "inventur" } | null>(null);
  const [verlauf, setVerlauf] = useState<Zeile | null>(null);
  const [scanOffen, setScanOffen] = useState(false);
  const [scanTreffer, setScanTreffer] = useState<{ code: string } | null>(null);
  const [auswahl, setAuswahl] = useState<Set<number>>(new Set());
  const [etikettenOffen, setEtikettenOffen] = useState(false);
  const [groesse, setGroesse] = useState<"50x30" | "60x40" | "70x50">("50x30");
  const [exemplare, setExemplare] = useState(1);
  const [etikettenLaden, setEtikettenLaden] = useState(false);
  const sort = useSortierung<Zeile>("name");
  const scanSuche = trpc.lager.scanSuche.useQuery(scanTreffer ?? { code: "—" }, { enabled: !!scanTreffer });

  const kategorien = useMemo(
    () => [...new Set((bestand.data ?? []).map((z) => z.kategorie).filter(Boolean))] as string[],
    [bestand.data],
  );

  const zeilen = sort.sortiere(
    (bestand.data ?? []).filter((z) => {
      if (kategorie !== "alle" && z.kategorie !== kategorie) return false;
      if (suche && !z.name.toLowerCase().includes(suche.toLowerCase())) return false;
      return true;
    }),
    (z, k) =>
      k === "name" ? z.name :
      k === "kategorie" ? z.kategorie :
      k === "ek" ? (z.ekPreisNetto ? Number(z.ekPreisNetto) : null) :
      k === "bestand" ? z.bestand : null,
  );

  const niedrigCount = (bestand.data ?? []).filter((z) => z.niedrig).length;

  const fertig = () => {
    setBuchung(null);
    setScanTreffer(null);
    utils.lager.bestand.invalidate();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Lager</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Bestand führen (Zugang/Abgang/Inventur), Handy-Scan, Preisvergleich.
            {niedrigCount > 0 && (
              <span className="ml-2 text-amber-600">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                {niedrigCount} Artikel unter Mindestbestand
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === "bestand" ? "default" : "outline"} size="sm" onClick={() => setTab("bestand")}>
            Bestand
          </Button>
          <Button variant={tab === "vergleich" ? "default" : "outline"} size="sm" onClick={() => setTab("vergleich")}>
            <Scale className="mr-1.5 h-4 w-4" /> Preisvergleich
            {(vergleich.data ?? []).length > 0 && (
              <Badge variant="secondary" className="ml-1.5">{vergleich.data!.length}</Badge>
            )}
          </Button>
          {auswahl.size > 0 && (
            <Button variant="outline" onClick={() => setEtikettenOffen(true)}>
              <Tag className="mr-1.5 h-4 w-4" /> Etiketten ({auswahl.size})
            </Button>
          )}
          <Button onClick={() => setScanOffen(true)}>
            <ScanLine className="mr-1.5 h-4 w-4" /> Scannen
          </Button>
        </div>
      </div>

      {tab === "bestand" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs"
              placeholder="Suchen …"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
            />
            <Select value={kategorie} onValueChange={setKategorie}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle Kategorien</SelectItem>
                {kategorien.map((k) => (
                  <SelectItem key={k} value={k}>{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                  <th className="w-8 px-2 py-2.5"></th>
                  <th className="cursor-pointer px-4 py-2.5 font-medium select-none" onClick={() => sort.umschalten("name")}>
                    Artikel<sort.KopfIcon k="name" />
                  </th>
                  <th className="cursor-pointer px-4 py-2.5 font-medium select-none" onClick={() => sort.umschalten("kategorie")}>
                    Kategorie<sort.KopfIcon k="kategorie" />
                  </th>
                  <th className="cursor-pointer px-4 py-2.5 text-right font-medium select-none" onClick={() => sort.umschalten("ek")}>
                    EK<sort.KopfIcon k="ek" />
                  </th>
                  <th className="cursor-pointer px-4 py-2.5 text-right font-medium select-none" onClick={() => sort.umschalten("bestand")}>
                    Bestand<sort.KopfIcon k="bestand" />
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                      Keine lagerführenden Artikel — bei Produkten „Im Lager führen" aktivieren
                      (oder die Produktliste importieren).
                    </td>
                  </tr>
                )}
                {zeilen.map((z) => (
                  <tr key={z.id} className={`border-b border-neutral-100 last:border-0 ${z.niedrig ? "bg-amber-50" : ""}`}>
                    <td className="px-2 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={auswahl.has(z.id)}
                        onChange={(e) => {
                          const n = new Set(auswahl);
                          e.target.checked ? n.add(z.id) : n.delete(z.id);
                          setAuswahl(n);
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{z.name}</div>
                      <div className="text-xs text-neutral-400">
                        {z.artikelnummer ?? ""}
                        {z.barcode && z.barcode !== z.artikelnummer ? ` · ${z.barcode}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600">{z.kategorie ?? "–"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600">
                      {z.ekPreisNetto ? geld(z.ekPreisNetto) : "–"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={z.niedrig ? "font-semibold text-amber-700" : "font-medium"}>
                        {z.bestand} {z.einheit}
                      </span>
                      {z.mindestbestand !== null && (
                        <span className="ml-1 text-xs text-neutral-400">(min. {z.mindestbestand})</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" title="Zugang" onClick={() => setBuchung({ zeile: z, typ: "zugang" })}>
                          <Plus className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button variant="ghost" size="sm" title="Abgang" onClick={() => setBuchung({ zeile: z, typ: "abgang" })}>
                          <Minus className="h-4 w-4 text-red-500" />
                        </Button>
                        <Button variant="ghost" size="sm" title="Inventur" onClick={() => setBuchung({ zeile: z, typ: "inventur" })}>
                          <ClipboardList className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setVerlauf(z)}>
                          Verlauf
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "vergleich" && (
        <div className="space-y-4">
          {(vergleich.data ?? []).length === 0 && (
            <p className="text-sm text-neutral-400">
              Keine Dubletten gefunden — jedes Produkt existiert nur einmal (Name/Code).
            </p>
          )}
          {(vergleich.data ?? []).map((g) => (
            <section key={g.schluessel} className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {g.eintraege[0]?.name}
                  <span className="ml-2 text-xs font-normal text-neutral-400">{g.schluessel.replace("nr:", "Code: ").replace("nm:", "Name: ")}</span>
                </div>
                <div className="text-xs text-neutral-500">
                  Preisspanne: {g.minPreis !== null ? geld(g.minPreis) : "–"} – {g.maxPreis !== null ? geld(g.maxPreis) : "–"}
                  {g.spanne > 0 && (
                    <Badge variant={g.spanne > 15 ? "destructive" : "secondary"} className="ml-2">
                      {g.spanne} % Unterschied
                    </Badge>
                  )}
                </div>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {g.eintraege.map((e) => (
                    <tr key={e.id} className="border-b border-neutral-100 last:border-0">
                      <td className="py-1.5">
                        {e.name}
                        {e.guenstigster && (
                          <Badge variant="default" className="ml-2 bg-green-600">günstigster</Badge>
                        )}
                      </td>
                      <td className="py-1.5 text-neutral-500">{e.artikelnummer ?? "–"}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {e.ekPreisNetto ? geld(e.ekPreisNetto) : "–"}
                        {e.lieferanten.map((l, i) => (
                          <div key={i} className="text-xs text-neutral-400">
                            {l.lieferant}: {geld(l.preis)}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {/* Etiketten-Dialog */}
      {etikettenOffen && (
        <Dialog open onOpenChange={(o) => !o && setEtikettenOffen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Etiketten drucken ({auswahl.size} Artikel)</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Etikettengröße</Label>
                <Select value={groesse} onValueChange={(v) => setGroesse(v as typeof groesse)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50x30">50 × 30 mm</SelectItem>
                    <SelectItem value="60x40">60 × 40 mm</SelectItem>
                    <SelectItem value="70x50">70 × 50 mm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Exemplare pro Artikel</Label>
                <Input
                  type="number" min={1} max={10} value={exemplare}
                  onChange={(e) => setExemplare(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                />
              </div>
              <p className="text-xs text-neutral-400">
                Code128-Barcode aus Artikelnummer (bzw. Barcode/ID), Name,
                Kategorie und EK. Als PDF zum Drucken auf dem mobilen
                Etikettendrucker.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEtikettenOffen(false)}>Abbrechen</Button>
              <Button
                disabled={etikettenLaden}
                onClick={async () => {
                  setEtikettenLaden(true);
                  try {
                    const r = await utils.client.label.etiketten.query({
                      ids: [...auswahl], groesse, exemplare,
                    });
                    pdfHerunterladen(r);
                    setEtikettenOffen(false);
                  } catch {
                    alert("Etiketten konnten nicht erzeugt werden.");
                  } finally {
                    setEtikettenLaden(false);
                  }
                }}
              >
                <Download className="mr-1.5 h-4 w-4" />
                {etikettenLaden ? "Erzeuge …" : "PDF erzeugen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialoge */}
      {buchung && <BuchungsDialog zeile={buchung.zeile} typ={buchung.typ} onClose={() => setBuchung(null)} onFertig={fertig} />}
      {verlauf && <VerlaufDialog zeile={verlauf} onClose={() => setVerlauf(null)} />}

      <ScanDialog
        offen={scanOffen}
        onSchliessen={() => setScanOffen(false)}
        onGefunden={(code) => {
          setScanOffen(false);
          setScanTreffer({ code });
        }}
      />

      {/* Scan-Ergebnis */}
      {scanTreffer && scanSuche.data && (
        <Dialog open onOpenChange={(o) => !o && setScanTreffer(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Scan: {scanTreffer.code}</DialogTitle>
            </DialogHeader>
            {scanSuche.data.treffer.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Kein Artikel gefunden. Lege den Artikel zuerst unter Produkte an
                (mit diesem Code als Artikelnummer/Barcode).
              </p>
            ) : (
              <div className="space-y-2">
                {scanSuche.data.treffer.map((p) => {
                  const z = (bestand.data ?? []).find((x) => x.id === p.id);
                  return (
                    <div key={p.id} className="flex items-center justify-between rounded-md border border-neutral-200 p-3">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-neutral-400">
                          {z ? `Bestand: ${z.bestand} ${z.einheit}` : "nicht lagerführend"}
                        </div>
                      </div>
                      {z && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => setBuchung({ zeile: z, typ: "zugang" })}>
                            <Plus className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setBuchung({ zeile: z, typ: "abgang" })}>
                            <Minus className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
