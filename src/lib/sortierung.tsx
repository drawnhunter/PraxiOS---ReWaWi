import { useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

// Generische Tabellen-Sortierung: Klick auf Spaltenkopf wechselt
// aufsteigend/absteigend/aus.
export type SortRichtung = 1 | -1;

export function useSortierung<T>(initialKey: string | null = null) {
  const [key, setKey] = useState<string | null>(initialKey);
  const [richtung, setRichtung] = useState<SortRichtung>(1);

  const umschalten = (k: string) => {
    if (key === k) {
      setRichtung((r) => (r === 1 ? -1 : 1));
    } else {
      setKey(k);
      setRichtung(1);
    }
  };

  const sortiere = (rows: T[], getter: (r: T, k: string) => string | number | null | undefined): T[] => {
    if (!key) return rows;
    return [...rows].sort((a, b) => {
      const va = getter(a, key);
      const vb = getter(b, key);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * richtung;
      return String(va).localeCompare(String(vb), "de") * richtung;
    });
  };

  const KopfIcon = ({ k }: { k: string }) =>
    key !== k ? (
      <ChevronsUpDown className="ml-1 inline h-3 w-3 text-neutral-300" />
    ) : richtung === 1 ? (
      <ChevronUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ChevronDown className="ml-1 inline h-3 w-3" />
    );

  return { key, richtung, umschalten, sortiere, KopfIcon };
}
