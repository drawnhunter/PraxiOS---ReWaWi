import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

/** Split-Button (v1.22.1): Hauptaktion links, Dropdown mit Varianten rechts. */
export function SplitButton({ label, icon, onKlick, eintraege, titel }: {
  label: string;
  icon: React.ReactNode;
  onKlick: () => void;
  eintraege: { label: string; onKlick: () => void; icon?: React.ReactNode }[];
  titel?: string;
}) {
  const [offen, setOffen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!offen) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOffen(false);
    };
    document.addEventListener("mousedown", h);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOffen(false); };
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", esc);
    };
  }, [offen]);

  return (
    <div className="relative" ref={ref}>
      <div className="flex">
        <Button variant="outline" size="sm" className="rounded-r-none" title={titel} onClick={onKlick}>
          {icon}
          {label}
        </Button>
        <Button
          variant="outline" size="sm"
          className="rounded-l-none border-l-0 px-1.5"
          title="Weitere Optionen"
          onClick={() => setOffen(!offen)}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>
      {offen && (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-44 rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
          {eintraege.map((e, i) => (
            <button
              key={i}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100"
              onClick={() => { setOffen(false); e.onKlick(); }}
            >
              {e.icon}
              {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
