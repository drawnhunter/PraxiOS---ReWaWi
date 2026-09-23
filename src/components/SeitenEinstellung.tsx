import { Link } from "react-router";
import { Settings2 } from "lucide-react";

/**
 * Kontext-Einstellungsbutton für Seitenköpfe: springt direkt zur passenden
 * Sektion in den Einstellungen (/einstellungen#bereich).
 */
export function SeitenEinstellung({ bereich, titel }: { bereich: string; titel: string }) {
  return (
    <Link
      to={`/einstellungen#${bereich}`}
      title={`Einstellungen: ${titel}`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-400 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
    >
      <Settings2 className="h-4 w-4" />
    </Link>
  );
}
