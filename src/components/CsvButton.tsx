import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { csvHerunterladen } from "@/lib/downloads";

/** CSV-Export-Button für Listen (Excel-tauglich: Semikolon + UTF-8-BOM). */
export function CsvButton({
  dateiname,
  zeilen,
  disabled,
}: {
  dateiname: string;
  zeilen: (string | number | null | undefined)[][];
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => csvHerunterladen(dateiname, zeilen)}
      disabled={disabled ?? zeilen.length <= 1}
    >
      <Download className="mr-1.5 h-4 w-4" /> CSV
    </Button>
  );
}
