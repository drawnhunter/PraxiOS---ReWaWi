import { useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { PackageSearch } from "lucide-react";
import { fuzzyScore } from "@contracts/fuzzy";

export interface ProduktKurz {
  id: number;
  name: string;
  preisNetto: string | number | null;
  einheit?: string | null;
  ustSatz?: number | null;
  artikelnummer?: string | null;
  barcode?: string | null;
  beschreibung?: string | null;
}

export function sucheProdukte<T extends ProduktKurz>(produkte: T[], query: string, max = 12): T[] {
  if (!query.trim()) return produkte.slice(0, max);
  return produkte
    .map((p) => ({
      p,
      s: Math.max(
        fuzzyScore(p.name, query) ?? -1,
        p.artikelnummer ? fuzzyScore(p.artikelnummer, query) ?? -1 : -1,
        p.barcode && p.barcode.includes(query.trim()) ? 95 : -1,
      ),
    }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.p);
}

function geldKurz(v: string | number | null): string {
  if (v === null) return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) + " €" : "";
}

/** Toolbar-Button mit Such-Popover: „Aus Produktstamm hinzufügen …" */
export function ProduktPicker({
  produkte,
  onPick,
  label = "Aus Produktstamm hinzufügen …",
}: {
  produkte: ProduktKurz[];
  onPick: (p: ProduktKurz) => void;
  label?: string;
}) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const treffer = useMemo(() => sucheProdukte(produkte, suche), [produkte, suche]);

  return (
    <Popover open={offen} onOpenChange={setOffen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" type="button">
          <PackageSearch className="mr-1.5 h-4 w-4" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <Input
          autoFocus
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Suchen — auch Tippfehler ok …"
          className="mb-2"
        />
        <div className="max-h-64 overflow-y-auto">
          {treffer.length === 0 && (
            <p className="px-2 py-3 text-sm text-neutral-400">Kein Produkt gefunden.</p>
          )}
          {treffer.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
              onClick={() => {
                onPick(p);
                setOffen(false);
                setSuche("");
              }}
            >
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-neutral-500">{geldKurz(p.preisNetto)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Bezeichnungs-Input mit Live-Vorschlägen aus dem Produktstamm. */
export function ProduktComboInput({
  produkte,
  value,
  onChange,
  onUebernehmen,
  placeholder,
}: {
  produkte: ProduktKurz[];
  value: string;
  onChange: (v: string) => void;
  onUebernehmen: (p: ProduktKurz) => void;
  placeholder?: string;
}) {
  const [fokus, setFokus] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const treffer = useMemo(
    () => (fokus && value.trim().length >= 2 ? sucheProdukte(produkte, value, 8) : []),
    [fokus, produkte, value],
  );

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFokus(true)}
        onBlur={() => setTimeout(() => setFokus(false), 150)}
        placeholder={placeholder}
      />
      {treffer.length > 0 && (
        <div className="absolute z-30 mt-1 w-full min-w-64 rounded-md border border-neutral-200 bg-white shadow-lg">
          {treffer.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm first:rounded-t-md last:rounded-b-md hover:bg-neutral-100"
              onMouseDown={(e) => {
                e.preventDefault();
                onUebernehmen(p);
              }}
            >
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-neutral-500">{geldKurz(p.preisNetto)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
