import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileCode2, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { textHerunterladen } from "@/lib/downloads";

/** XRechnung (XML) einer finalisierten Rechnung herunterladen. */
export function XrechnungButton({ id }: { id: number }) {
  const utils = trpc.useUtils();
  const [laedt, setLaedt] = useState(false);

  const klick = async () => {
    setLaedt(true);
    try {
      const antwort = await utils.client.export.xrechnungRechnung.query({ id });
      textHerunterladen(antwort.dateiname, antwort.xml, "application/xml");
    } catch (e) {
      alert(e instanceof Error ? e.message : "XRechnung konnte nicht erzeugt werden.");
    } finally {
      setLaedt(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={klick} disabled={laedt} title="XRechnung (XML, EN 16931) herunterladen">
      {laedt ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <FileCode2 className="mr-1.5 h-4 w-4" />
      )}
      XRechnung
    </Button>
  );
}
