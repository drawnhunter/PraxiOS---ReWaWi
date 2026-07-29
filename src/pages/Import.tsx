import { useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, FileText, FileUp, Loader2, Trash2, Upload, XCircle } from "lucide-react";

type Route = "erechnung" | "post" | "kunden" | "produkte" | "bank" | "unbekannt";

interface DateiZustand {
  name: string;
  base64: string;
  route: Route;
  postTyp: "rechnung" | "sonstiges";
  hinweis: string;
  meta?: { lieferant?: string; nummer?: string; brutto?: string };
}

interface Ergebnis {
  name: string;
  ok: boolean;
  ziel: string;
  fehler?: string;
  weiter?: string;
}

const ROUTE_LABEL: Record<Route, string> = {
  erechnung: "E-Rechnung",
  post: "Post Manager",
  kunden: "Kunden-CSV",
  produkte: "Produkte-CSV",
  bank: "Bank-CSV",
  unbekannt: "unbekannt",
};

function liesDatei(datei: File): Promise<string> {
  return new Promise((ok, fehler) => {
    const r = new FileReader();
    r.onload = () => ok((r.result as string).split(",")[1]);
    r.onerror = fehler;
    r.readAsDataURL(datei);
  });
}

export default function Import() {
  const dateiRef = useRef<HTMLInputElement>(null);
  const [dateien, setDateien] = useState<DateiZustand[]>([]);
  const [ergebnisse, setErgebnisse] = useState<Ergebnis[] | null>(null);
  const [ziehen, setZiehen] = useState(false);

  const analysieren = trpc.magicImport.analysieren.useMutation();
  const ausfuehren = trpc.magicImport.ausfuehren.useMutation({
    onSuccess: (d) => setErgebnisse(d as Ergebnis[]),
  });

  const aufnehmen = async (liste: FileList | File[]) => {
    const neu: { name: string; base64: string }[] = [];
    for (const f of Array.from(liste).slice(0, 10)) {
      neu.push({ name: f.name, base64: await liesDatei(f) });
    }
    if (neu.length === 0) return;
    setErgebnisse(null);
    const analysiert = await analysieren.mutateAsync({ dateien: neu });
    setDateien((alt) => [
      ...alt,
      ...analysiert.map((a) => ({
        name: a.name,
        base64: neu.find((n) => n.name === a.name)!.base64,
        route: a.route as Route,
        postTyp: "rechnung" as const,
        hinweis: a.hinweis,
        meta: a.meta,
      })),
    ]);
  };

  const setze = (idx: number, patch: Partial<DateiZustand>) =>
    setDateien((alt) => alt.map((d, i) => (i === idx ? { ...d, ...patch } : d)));

  const starten = () => {
    ausfuehren.mutate({
      dateien: dateien.map((d) => ({
        name: d.name,
        base64: d.base64,
        route: d.route,
        postTyp: d.postTyp,
      })),
    });
  };

  const zuruecksetzen = () => {
    setDateien([]);
    setErgebnisse(null);
    if (dateiRef.current) dateiRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-800">Import</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Eine Tür für alles: Dateien hochladen — ReWaWi erkennt, was es ist, und leitet weiter.
        </p>
      </div>

      {/* Upload-Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setZiehen(true);
        }}
        onDragLeave={() => setZiehen(false)}
        onDrop={(e) => {
          e.preventDefault();
          setZiehen(false);
          void aufnehmen(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          ziehen ? "border-teal-600 bg-teal-50" : "border-neutral-300 bg-white"
        }`}
      >
        <FileUp className="mx-auto h-8 w-8 text-neutral-400" />
        <p className="mt-2 text-sm text-neutral-600">
          Dateien hierher ziehen oder{" "}
          <button
            type="button"
            className="font-medium text-teal-700 underline"
            onClick={() => dateiRef.current?.click()}
          >
            auswählen
          </button>{" "}
          (max. 10)
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          E-Rechnung (XML/ZUGFeRD-PDF) · Scans (PDF/JPG/PNG) · CSV (Kunden, Produkte, Bank)
        </p>
        <input
          ref={dateiRef}
          type="file"
          multiple
          className="hidden"
          accept=".xml,.pdf,.jpg,.jpeg,.png,.csv"
          onChange={(e) => e.target.files && void aufnehmen(e.target.files)}
        />
      </div>

      {/* Erkannte Dateien */}
      {dateien.length > 0 && !ergebnisse && (
        <div className="space-y-3">
          {dateien.map((d, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3"
            >
              <FileText className="h-5 w-5 shrink-0 text-neutral-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-neutral-800">{d.name}</div>
                <div className="text-xs text-neutral-500">
                  {d.hinweis}
                  {d.meta?.lieferant ? ` — ${d.meta.lieferant}` : ""}
                  {d.meta?.brutto ? ` · ${d.meta.brutto} €` : ""}
                </div>
              </div>
              {d.route === "post" && (
                <Select
                  value={d.postTyp}
                  onValueChange={(v) => setze(i, { postTyp: v as "rechnung" | "sonstiges" })}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rechnung">Rechnung</SelectItem>
                    <SelectItem value="sonstiges">Sonstiges</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Select value={d.route} onValueChange={(v) => setze(i, { route: v as Route })}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROUTE_LABEL) as Route[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROUTE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setDateien((alt) => alt.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4 text-neutral-400" />
              </Button>
            </div>
          ))}

          <div className="flex items-center gap-3">
            <Button onClick={starten} disabled={ausfuehren.isPending}>
              {ausfuehren.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Importieren
            </Button>
            <Button variant="ghost" onClick={zuruecksetzen}>
              Zurücksetzen
            </Button>
          </div>
        </div>
      )}

      {/* Ergebnisse */}
      {ergebnisse && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-neutral-700">Ergebnis</h2>
          {ergebnisse.map((e, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3"
            >
              {e.ok ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-teal-700" />
              ) : (
                <XCircle className="h-5 w-5 shrink-0 text-red-600" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-neutral-800">{e.name}</div>
                <div className="text-xs text-neutral-500">{e.ok ? e.ziel : e.fehler}</div>
              </div>
              {e.weiter && (
                <Badge variant="outline" asChild>
                  <Link to={e.weiter}>Zum Bereich →</Link>
                </Badge>
              )}
            </div>
          ))}
          <div className="flex gap-3">
            <Button variant="outline" onClick={zuruecksetzen}>
              Weitere Dateien importieren
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/posteingang">Zum Post Manager →</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
