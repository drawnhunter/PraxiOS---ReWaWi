import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Mail, Loader2, CheckCircle2 } from "lucide-react";

export function MailDialog({
  art,
  id,
}: {
  art: "invoice" | "offer" | "credit" | "reminder";
  id: number;
}) {
  const utils = trpc.useUtils();
  const [offen, setOffen] = useState(false);
  const [empfaenger, setEmpfaenger] = useState("");
  const [betreff, setBetreff] = useState("");
  const [text, setText] = useState("");
  const [mitXrechnung, setMitXrechnung] = useState(false);
  const [gesendet, setGesendet] = useState(false);

  const vorlage = trpc.mail.vorlage.useQuery(
    { art, id },
    { enabled: offen, retry: false },
  );
  const protokoll = trpc.mail.protokoll.useQuery(
    { art, id },
    { enabled: offen, retry: false },
  );

  useEffect(() => {
    if (vorlage.data) {
      setEmpfaenger(vorlage.data.empfaenger);
      setBetreff(vorlage.data.betreff);
      setText(vorlage.data.text);
    }
  }, [vorlage.data]);

  const senden = trpc.mail.senden.useMutation({
    onSuccess: () => {
      setGesendet(true);
      utils.mail.protokoll.invalidate({ art, id });
    },
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setOffen(true); setGesendet(false); }}>
        <Mail className="mr-1.5 h-4 w-4" /> E-Mail
      </Button>
      <Dialog open={offen} onOpenChange={setOffen}>
        <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-2xl flex-col overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Beleg per E-Mail versenden</DialogTitle>
          </DialogHeader>

          {gesendet ? (
            <div className="flex items-center gap-2 rounded-md bg-green-50 p-4 text-green-800">
              <CheckCircle2 className="h-5 w-5" />
              <span>E-Mail wurde an {empfaenger} versendet.</span>
            </div>
          ) : vorlage.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Vorlage wird geladen …
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Empfänger *</Label>
                <Input
                  type="email"
                  value={empfaenger}
                  onChange={(e) => setEmpfaenger(e.target.value)}
                  placeholder="kunde@beispiel.de"
                />
              </div>
              <div>
                <Label>Betreff *</Label>
                <Input value={betreff} onChange={(e) => setBetreff(e.target.value)} />
              </div>
              <div>
                <Label>Text *</Label>
                <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              <div className="rounded-md bg-neutral-50 p-3 text-xs text-neutral-500">
                Anhang: PDF des Belegs
                {vorlage.data?.xrechnungMoeglich && (
                  <label className="mt-1 flex items-center gap-2 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={mitXrechnung}
                      onChange={(e) => setMitXrechnung(e.target.checked)}
                    />
                    XRechnung (XML) zusätzlich anhängen
                  </label>
                )}
              </div>
              {senden.error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {senden.error.message}
                </p>
              )}
            </div>
          )}

          {(protokoll.data ?? []).length > 0 && (
            <div className="mt-2 border-t border-neutral-100 pt-2">
              <div className="mb-1 text-xs font-medium text-neutral-500">Bisherige Sendungen</div>
              <ul className="space-y-0.5 text-xs text-neutral-400">
                {(protokoll.data ?? []).map((p) => (
                  <li key={p.id}>
                    {new Date(p.gesendetAm).toLocaleString("de-DE")} → {p.empfaenger}{" "}
                    {p.erfolg ? "✓" : `✗ ${p.fehler?.slice(0, 60)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOffen(false)}>
              Schließen
            </Button>
            {!gesendet && (
              <Button
                disabled={
                  !empfaenger || !betreff || !text || senden.isPending || vorlage.isLoading
                }
                onClick={() =>
                  senden.mutate({ art, id, empfaenger, betreff, text, mitXrechnung })
                }
              >
                {senden.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-1.5 h-4 w-4" />
                )}
                Senden
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
