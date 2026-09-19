import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MessageCircleQuestion, Send, CheckCircle2 } from "lucide-react";

/** Klärungsfälle: Rückfragen der Kanzlei ↔ Antworten des Mandanten (Kanzlei-Arbeitsplatz). */
export default function Klaerungen() {
  const { user } = useAuth();
  const istKanzlei = user?.role === "kanzlei";
  const [status, setStatus] = useState<"aktiv" | "geklaert" | "offen" | "beantwortet">("aktiv");
  const [antwortAuf, setAntwortAuf] = useState<number | null>(null);
  const [antwortText, setAntwortText] = useState("");

  const liste = trpc.klaerungen.liste.useQuery({ status });
  const utils = trpc.useUtils();
  const invalidieren = () => utils.klaerungen.liste.invalidate();
  const antworten = trpc.klaerungen.antworten.useMutation({ onSuccess: () => { setAntwortAuf(null); setAntwortText(""); invalidieren(); } });
  const klaeren = trpc.klaerungen.klaeren.useMutation({ onSuccess: invalidieren });

  const offen = (liste.data ?? []).filter((k) => k.status === "offen").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircleQuestion className="h-5 w-5 text-teal-700" />
        <h1 className="text-lg font-semibold">Klärungsfälle</h1>
        <span className="text-xs text-neutral-400">
          Rückfragen der Kanzlei an Belegen — hier beantworten statt per E-Mail.
        </span>
        {offen > 0 && <Badge variant="default">{offen} offen</Badge>}
        <div className="ml-auto">
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="aktiv">Aktive</SelectItem>
              <SelectItem value="offen">Nur offene</SelectItem>
              <SelectItem value="beantwortet">Beantwortete</SelectItem>
              <SelectItem value="geklaert">Geklärte</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {liste.isLoading && <p className="text-sm text-neutral-400">Lade …</p>}
      {!liste.isLoading && (liste.data ?? []).length === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-400">
          Keine Klärungsfälle in dieser Ansicht. {istKanzlei ? "Rückfragen stellen Sie direkt am Beleg (Eingangsrechnungen)." : ""}
        </p>
      )}

      <div className="space-y-2">
        {(liste.data ?? []).map((k) => (
          <div key={k.id} className="rounded-lg border border-neutral-200 bg-white p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={k.status === "offen" ? "default" : k.status === "beantwortet" ? "outline" : "secondary"}>
                {k.status === "offen" ? "offen" : k.status === "beantwortet" ? "beantwortet" : "geklärt"}
              </Badge>
              {k.beleg && (
                <span className="text-sm font-medium">
                  {k.beleg.lieferant} — {k.beleg.nummer} ({Number(k.beleg.brutto).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €, {k.beleg.datum})
                </span>
              )}
              <a href={`/e-rechnungen`} className="text-xs text-teal-700 hover:underline">Beleg #{k.incomingInvoiceId}</a>
              <span className="ml-auto text-xs text-neutral-400">{new Date(k.aktualisiert).toLocaleString("de-DE")}</span>
            </div>
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm">
              <span className="font-medium text-amber-800">Frage ({k.frageVon}):</span>{" "}
              <span className="text-neutral-800">{k.frage}</span>
            </p>
            {k.antwort && (
              <p className="mt-1.5 rounded-md bg-teal-50 px-3 py-2 text-sm">
                <span className="font-medium text-teal-800">Antwort ({k.antwortVon}):</span>{" "}
                <span className="text-neutral-800">{k.antwort}</span>
              </p>
            )}

            {/* Mandant: offene Fragen beantworten */}
            {!istKanzlei && k.status === "offen" && (
              <div className="mt-2.5">
                {antwortAuf === k.id ? (
                  <div className="space-y-1.5">
                    <Textarea
                      value={antwortText}
                      onChange={(e) => setAntwortText(e.target.value)}
                      placeholder="Antwort an die Kanzlei …"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!antwortText.trim() || antworten.isPending}
                        onClick={() => antworten.mutate({ incomingInvoiceId: k.incomingInvoiceId, antwort: antwortText.trim() })}
                      >
                        <Send className="mr-1.5 h-4 w-4" /> Antworten
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setAntwortAuf(null); setAntwortText(""); }}>
                        Abbrechen
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setAntwortAuf(k.id)}>
                    Beantworten
                  </Button>
                )}
              </div>
            )}

            {/* Beide: als geklärt schließen (kanzlei typisch, Mandant darf auch) */}
            {k.status !== "geklaert" && (k.status === "beantwortet" || istKanzlei) && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 text-teal-700"
                disabled={klaeren.isPending}
                onClick={() => klaeren.mutate({ incomingInvoiceId: k.incomingInvoiceId })}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Als geklärt schließen
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
