import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { pdfHerunterladen } from "@/lib/downloads";

/**
 * PDF-Button: Lädt das PDF über die tRPC-API (Base64) und speichert es als Datei.
 * Funktioniert auch in Umgebungen, in denen direkte Datei-URLs blockiert werden.
 */
export function PdfButton({
  art,
  id,
}: {
  art: "invoice" | "credit" | "delivery" | "order" | "offer" | "reminder";
  id: number;
}) {
  const utils = trpc.useUtils();
  const [laedt, setLaedt] = useState(false);

  const klick = async () => {
    setLaedt(true);
    try {
      const antwort =
        art === "reminder"
          ? await utils.client.reminders.pdf.query({ id })
          : await utils.client.pdf[art].query({ id });
      pdfHerunterladen(antwort);
    } catch {
      alert("PDF konnte nicht erzeugt werden.");
    } finally {
      setLaedt(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={klick} disabled={laedt}>
      {laedt ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <FileDown className="mr-1.5 h-4 w-4" />
      )}
      PDF
    </Button>
  );
}
