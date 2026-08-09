import { Component, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Bug, X } from "lucide-react";
import { SupportDialog, type SupportVorgabe } from "./SupportDialog";

type FehlerInfo = { nachricht: string; stack?: string };

function baueKontext(f: FehlerInfo): string {
  return JSON.stringify(
    {
      fehler: f.nachricht,
      stack: (f.stack ?? "").slice(0, 1500),
      seite: window.location.pathname,
      zeit: new Date().toISOString(),
      browser: navigator.userAgent,
    },
    null,
    2,
  );
}

// Fehler-Dialog (fatal): ersetzt die App, bietet Meldung + Neuladen
function FatalAnsicht({ fehler }: { fehler: FehlerInfo }) {
  const [dialog, setDialog] = useState(false);
  const vorgabe: SupportVorgabe = {
    typ: "fehler",
    betreff: `App-Fehler: ${fehler.nachricht.slice(0, 120)}`,
    kontext: baueKontext(fehler),
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-amber-500" />
        <h1 className="mb-2 text-lg font-semibold">Da ist etwas schiefgelaufen</h1>
        <p className="mb-1 text-sm text-neutral-500">
          Die Anwendung ist auf einen unerwarteten Fehler gestoßen. Deine Daten
          sind sicher — gespeichert wird serverseitig.
        </p>
        <p className="mb-5 rounded-md bg-neutral-50 p-2 text-xs break-words text-neutral-400">
          {fehler.nachricht.slice(0, 200)}
        </p>
        <div className="flex flex-col gap-2">
          <Button onClick={() => setDialog(true)}>
            <Bug className="mr-1.5 h-4 w-4" /> Fehler an den Support melden
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Ohne Meldung neu laden
          </Button>
        </div>
        <SupportDialog offen={dialog} onSchliessen={() => setDialog(false)} vorgabe={vorgabe} />
      </div>
    </div>
  );
}

// Hinweis-Karte (nicht-fatal): globale Fehler, App laeuft weiter
function HinweisKarte({ fehler, onIgnorieren }: { fehler: FehlerInfo; onIgnorieren: () => void }) {
  const [dialog, setDialog] = useState(false);
  const vorgabe: SupportVorgabe = {
    typ: "fehler",
    betreff: `Fehler im Hintergrund: ${fehler.nachricht.slice(0, 110)}`,
    kontext: baueKontext(fehler),
  };
  return (
    <div className="fixed right-4 bottom-4 z-50 w-80 rounded-xl border border-amber-200 bg-white p-4 shadow-lg">
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Fehler aufgetreten
        </p>
        <button onClick={onIgnorieren} className="text-neutral-400 hover:text-neutral-700" aria-label="Schließen">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs break-words text-neutral-500">{fehler.nachricht.slice(0, 160)}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setDialog(true)}>
          <Bug className="mr-1 h-3.5 w-3.5" /> Melden
        </Button>
        <Button size="sm" variant="outline" onClick={onIgnorieren}>
          Nicht melden
        </Button>
      </div>
      <SupportDialog offen={dialog} onSchliessen={() => setDialog(false)} vorgabe={vorgabe} />
    </div>
  );
}

export class FehlerMelder extends Component<
  { children: ReactNode },
  { fatal: FehlerInfo | null; hinweis: FehlerInfo | null }
> {
  state = { fatal: null as FehlerInfo | null, hinweis: null as FehlerInfo | null };
  private letzterHinweis = "";

  static getDerivedStateFromError(e: Error) {
    return { fatal: { nachricht: e.message, stack: e.stack } };
  }

  componentDidMount() {
    window.addEventListener("error", this.beiGlobalemFehler);
    window.addEventListener("unhandledrejection", this.beiAblehnung);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.beiGlobalemFehler);
    window.removeEventListener("unhandledrejection", this.beiAblehnung);
  }

  private beiGlobalemFehler = (e: ErrorEvent) => {
    // Fehler innerhalb von React-Renderings behandelt die Boundary selbst
    if (this.state.fatal || this.state.hinweis) return;
    const nachricht = e.message || "Unbekannter Skriptfehler";
    if (nachricht === this.letzterHinweis) return;
    this.letzterHinweis = nachricht;
    this.setState({ hinweis: { nachricht, stack: e.error?.stack } });
  };

  private beiAblehnung = (e: PromiseRejectionEvent) => {
    if (this.state.fatal || this.state.hinweis) return;
    const grund = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "Unbekannter Fehler");
    // tRPC/Netzwerk-Fehler werden bereits in den Seiten angezeigt
    if (grund.includes("TRPCClientError") || grund.includes("Failed to fetch")) return;
    if (grund === this.letzterHinweis) return;
    this.letzterHinweis = grund;
    this.setState({
      hinweis: { nachricht: grund, stack: e.reason instanceof Error ? e.reason.stack : undefined },
    });
  };

  render() {
    if (this.state.fatal) return <FatalAnsicht fehler={this.state.fatal} />;
    return (
      <>
        {this.props.children}
        {this.state.hinweis && (
          <HinweisKarte
            fehler={this.state.hinweis}
            onIgnorieren={() => this.setState({ hinweis: null })}
          />
        )}
      </>
    );
  }
}
