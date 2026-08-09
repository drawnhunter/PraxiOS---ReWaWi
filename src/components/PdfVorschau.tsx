import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eye, Loader2, FileDown, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { pdfHerunterladen } from "@/lib/downloads";

/**
 * PDF-Vorschau: Erzeugt das PDF über die tRPC-API (Base64) und zeigt es
 * im Dialog an — ohne Datei-Download. Gleiche Datenquelle wie PdfButton.
 */
export function PdfVorschau({
  art,
  id,
  titel,
}: {
  art: "invoice" | "credit" | "delivery" | "order" | "offer" | "reminder";
  id: number;
  titel?: string;
}) {
  const utils = trpc.useUtils();
  const [offen, setOffen] = useState(false);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const antwortRef = useRef<{ dateiname: string; base64: string } | null>(null);

  // Object-URL beim Schließen/Unmount freigeben
  useEffect(() => {
    if (!offen && url) {
      URL.revokeObjectURL(url);
      setUrl(null);
    }
  }, [offen, url]);

  const laden = async () => {
    setOffen(true);
    setFehler(false);
    if (url) return; // schon geladen
    setLaedt(true);
    try {
      const antwort =
        art === "reminder"
          ? await utils.client.reminders.pdf.query({ id })
          : await utils.client.pdf[art].query({ id });
      antwortRef.current = antwort;
      const bin = atob(antwort.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      setUrl(URL.createObjectURL(blob));
    } catch {
      setFehler(true);
    } finally {
      setLaedt(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={laden}>
        <Eye className="mr-1.5 h-4 w-4" /> Vorschau
      </Button>
      <Dialog open={offen} onOpenChange={setOffen}>
        <DialogContent className="flex h-[92vh] w-[95vw] max-w-5xl flex-col p-4">
          <DialogHeader className="flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm font-medium">
              {titel ?? "PDF-Vorschau"}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {url && antwortRef.current && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => antwortRef.current && pdfHerunterladen(antwortRef.current)}
                >
                  <FileDown className="mr-1.5 h-4 w-4" /> Herunterladen
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setOffen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 rounded-md bg-neutral-100">
            {laedt && (
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> PDF wird erzeugt …
              </div>
            )}
            {fehler && (
              <div className="flex h-full items-center justify-center text-sm text-red-600">
                PDF konnte nicht erzeugt werden.
              </div>
            )}
            {url && !laedt && (
              <iframe src={url} className="h-full w-full rounded-md" title="PDF-Vorschau" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
