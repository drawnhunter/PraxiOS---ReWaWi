import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { MailVerfassen, type VerfassenStart } from "./MailVerfassen";
import { MailDetail } from "./Mail";

/**
 * Gelöstes Mail-Fenster (v1.21.5): echtes Browser-Popup, eigenständig ohne Layout.
 * Der Tab aus dem Hauptfenster wandert hierher; beim Schließen signalisiert das
 * Fenster per localStorage („rewawi-mailfenster"), ob der Tab zurückkehren soll.
 */
export default function MailFenster() {
  const { user, isLoading } = useAuth({ redirectOnUnauthenticated: true });
  const [params] = useSearchParams();
  const typ = params.get("typ") === "mail" ? "mail" : "verfassen";
  const id = Number(params.get("id") ?? 0);
  const [antwort, setAntwort] = useState<VerfassenStart | null>(null); // Antworten aus der Leseansicht
  const unsavedRef = useRef(false);
  const sauberGeschlossen = useRef(false);

  const entwurf = trpc.postfach.entwurfEinzel.useQuery(
    { id },
    { enabled: typ === "verfassen" && id > 0 && !!user },
  );

  const signal = (aktion: "zurueck" | "geschlossen") => {
    try {
      localStorage.setItem(
        "rewawi-mailfenster",
        JSON.stringify({ typ, id, aktion, ts: Date.now() }),
      );
    } catch { /* Hauptfenster merkt sich den Tab notfalls selbst */ }
  };

  const schliessen = (aktion: "zurueck" | "geschlossen") => {
    sauberGeschlossen.current = true;
    signal(aktion);
    window.close();
  };

  // Ungespeicherte Änderungen schützen + Rückkehr-Signal beim Verlassen
  useEffect(() => {
    const beiUnload = (e: BeforeUnloadEvent) => {
      if (!sauberGeschlossen.current && unsavedRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const beiHide = () => {
      if (!sauberGeschlossen.current) signal("zurueck");
    };
    window.addEventListener("beforeunload", beiUnload);
    window.addEventListener("pagehide", beiHide);
    return () => {
      window.removeEventListener("beforeunload", beiUnload);
      window.removeEventListener("pagehide", beiHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typ, id]);

  useEffect(() => {
    document.title = typ === "mail" ? "ReWaWi Mail — Lesen" : "ReWaWi Mail — Verfassen";
  }, [typ]);

  const verfassenStart: VerfassenStart | null = antwort ?? (entwurf.data ? {
    empfaenger: entwurf.data.empfaenger ?? "",
    cc: entwurf.data.cc ?? "",
    bcc: entwurf.data.bcc ?? "",
    betreff: entwurf.data.betreff ?? "",
    html: entwurf.data.text ?? "<p><br></p>",
    kontoId: entwurf.data.kontoId ?? null,
    entwurfId: entwurf.data.id,
    anhaenge: (() => {
      try { return entwurf.data.anhaenge ? JSON.parse(entwurf.data.anhaenge) : []; } catch { return []; }
    })(),
  } : null);

  if (isLoading || !user) {
    return <div className="p-6 text-sm text-neutral-400">Anmeldung wird geprüft …</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-100 p-2">
      <div className="mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5">
        <span className="text-xs font-medium text-teal-800">ReWaWi — gelöstes Fenster</span>
        <span className="flex-1" />
        <button
          className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 hover:border-teal-300 hover:text-teal-700"
          title="Fenster schließen und Tab im Hauptfenster wieder öffnen"
          onClick={() => schliessen("zurueck")}
        >
          ↩ Zurück ins Hauptfenster
        </button>
      </div>
      {typ === "mail" && !antwort && (
        <MailDetail
          id={id}
          kompakt={false}
          onAntworten={(start) => setAntwort(start)}
          onTabOeffnen={(neuId) => { window.location.href = `/mail-fenster?typ=mail&id=${neuId}`; }}
        />
      )}
      {(typ === "verfassen" || antwort) && (
        verfassenStart ? (
          <MailVerfassen
            key={antwort ? "antwort" : `entwurf-${id}`}
            start={verfassenStart}
            abschlussAktion={null}
            onZustand={(z) => { unsavedRef.current = z.unsaved; }}
            onAktionErledigt={() => schliessen("geschlossen")}
          />
        ) : entwurf.isLoading ? (
          <div className="flex-1 rounded-lg border border-neutral-200 bg-white p-5 text-sm text-neutral-400">Entwurf wird geladen …</div>
        ) : (
          <div className="flex-1 rounded-lg border border-neutral-200 bg-white p-5 text-sm text-red-600">
            Entwurf nicht gefunden — wurde er im Hauptfenster gelöscht?
          </div>
        )
      )}
    </div>
  );
}
