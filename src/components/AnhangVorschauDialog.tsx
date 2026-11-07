import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, X, Download, ExternalLink } from "lucide-react";

/**
 * Einheitliche Anhang-Vorschau (v1.21.5) — Verfassen, Empfangen und Gesendet.
 * PDF/Bilder/Text direkt, Office (docx/xlsx/xls/csv) per JS-Viewer (lazy geladen,
 * bleibt komplett im Browser — keine Serverlast, keine Datenweitergabe).
 */
export function AnhangVorschauDialog({ dateiname, mime, base64, onSchliessen }: {
  dateiname: string;
  mime: string;
  base64: string;
  onSchliessen: () => void;
}) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const endung = dateiname.split(".").pop()?.toLowerCase() ?? "";
  const istPdf = mime === "application/pdf" || endung === "pdf";
  const istBild = mime.startsWith("image/");
  const istDocx = endung === "docx";
  const istTabelle = ["xlsx", "xls", "csv"].includes(endung);
  const istText = !istPdf && !istBild && !istDocx && !istTabelle &&
    (mime.startsWith("text/") || ["txt", "md", "json", "xml", "log", "eml", "ics"].includes(endung));

  const [ladefehler, setLadefehler] = useState("");
  const docziel = useRef<HTMLDivElement>(null);
  const [tabellenHtml, setTabellenHtml] = useState<string | null>(null);
  const [textInhalt, setTextInhalt] = useState<string | null>(null);

  const herunterladen = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = dateiname;
    a.click();
  };

  useEffect(() => {
    let beendet = false;
    if (istDocx && docziel.current) {
      // docx-preview erst bei Bedarf laden (hält das Hauptbundle schlank)
      import("docx-preview")
        .then((m) => m.renderAsync(bytes.buffer as ArrayBuffer, docziel.current as HTMLElement, undefined, { inWrapper: true }))
        .catch(() => { if (!beendet) setLadefehler("DOCX-Vorschau nicht möglich — bitte herunterladen."); });
    }
    if (istTabelle) {
      import("xlsx")
        .then((XLSX) => {
          const wb = XLSX.read(bytes, { type: "array" });
          const blatt = wb.Sheets[wb.SheetNames[0]];
          if (!beendet) setTabellenHtml(XLSX.utils.sheet_to_html(blatt, { header: `<h3>${wb.SheetNames[0]}</h3>` }));
        })
        .catch(() => { if (!beendet) setLadefehler("Tabellen-Vorschau nicht möglich — bitte herunterladen."); });
    }
    if (istText) {
      setTextInhalt(new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, 400000));
    }
    return () => { beendet = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aufräumen: Blob-URL sperren, Overlay per Escape schließen
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onSchliessen(); };
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onSchliessen}>
      <div className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5">
          <Paperclip className="h-4 w-4 text-neutral-500" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={dateiname}>{dateiname}</span>
          <Button size="sm" variant="outline" onClick={herunterladen}><Download className="mr-1 h-3.5 w-3.5" /> Herunterladen</Button>
          <Button size="sm" variant="ghost" title="In Standard-App öffnen (Download + Öffnen)" onClick={() => { herunterladen(); window.open(url, "_blank"); }}>
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onSchliessen}><X className="h-4 w-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-neutral-50">
          {istPdf && <iframe src={url} title={dateiname} className="h-full w-full" />}
          {istBild && (
            <div className="flex h-full items-center justify-center p-4">
              <img src={url} alt={dateiname} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {istDocx && !ladefehler && <div ref={docziel} className="docx-huelle mx-auto my-4 max-w-3xl bg-white p-4 shadow-sm" />}
          {istTabelle && !ladefehler && (
            tabellenHtml
              ? <div className="anhang-tabelle m-4 overflow-auto rounded-md border border-neutral-200 bg-white p-2 text-xs" dangerouslySetInnerHTML={{ __html: tabellenHtml }} />
              : <p className="p-6 text-sm text-neutral-400">Tabelle wird geladen …</p>
          )}
          {istText && <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs text-neutral-800">{textInhalt}</pre>}
          {ladefehler && <p className="p-6 text-sm text-amber-700">{ladefehler}</p>}
          {!istPdf && !istBild && !istDocx && !istTabelle && !istText && !ladefehler && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <Paperclip className="h-10 w-10 text-neutral-300" />
              <p className="text-sm text-neutral-500">Für diesen Dateityp ({mime || "unbekannt"}) gibt es keine Direkt-Vorschau.</p>
              <Button variant="outline" onClick={herunterladen}><Download className="mr-1.5 h-4 w-4" /> Herunterladen und mit Standard-App öffnen</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
