// Design-Presets (Einstellungen → Design)
export interface Akzentfarbe {
  id: string;
  label: string;
  hsl: string; // fuer die UI (CSS-Variablen, shadcn-Theme)
  hex: string; // fuer Swatches / Vorschau
}

export const AKZENTFARBEN: Akzentfarbe[] = [
  { id: "neutral", label: "Graphit", hsl: "240 5.9% 10%", hex: "#171717" },
  { id: "blau", label: "Blau", hsl: "221 83% 41%", hex: "#1d4ed8" },
  { id: "gruen", label: "Grün", hsl: "152 60% 32%", hex: "#15803d" },
  { id: "bernstein", label: "Bernstein", hsl: "32 90% 40%", hex: "#b45309" },
  { id: "violett", label: "Violett", hsl: "262 60% 45%", hex: "#7c3aed" },
  { id: "rot", label: "Rot", hsl: "0 65% 45%", hex: "#b91c1c" },
];

export const PDF_LAYOUTS = [
  {
    id: "klassisch",
    label: "Klassisch",
    beschreibung: "Schlichtes Schwarz-Weiß wie bisher — ruhig und sachlich.",
  },
  {
    id: "modern",
    label: "Modern",
    beschreibung: "Farbbalken im Kopf, Tabellenköpfe und Summen in der Akzentfarbe.",
  },
  {
    id: "kompakt",
    label: "Kompakt",
    beschreibung: "Enger gesetzt — mehr Positionen pro Seite.",
  },
] as const;

export function akzentById(id: string): Akzentfarbe {
  return AKZENTFARBEN.find((a) => a.id === id) ?? AKZENTFARBEN[0];
}

// Setzt die Akzentfarbe auf dem gesamten UI (shadcn-Theme-Variablen)
export function akzentAnwenden(id: string) {
  const f = akzentById(id);
  const root = document.documentElement;
  root.style.setProperty("--primary", f.hsl);
  root.style.setProperty("--sidebar-primary", f.hsl);
  root.style.setProperty("--ring", f.hsl);
}
