import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const firmaLeer = {
  name: "", strasse: "", plz: "", ort: "", land: "Deutschland",
  email: "", telefon: "", webseite: "", steuernummer: "", ustIdNr: "", handelsregister: "",
};
const bankLeer = { bezeichnung: "", bankName: "", kontoinhaber: "", iban: "", bic: "" };

export default function Login() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const status = trpc.auth.setupStatus.useQuery(undefined, { retry: false });
  const ich = trpc.auth.me.useQuery(undefined, { retry: false });
  const needsSetup = status.data?.needsSetup ?? false;

  const [schritt, setSchritt] = useState<1 | 2>(1);
  // Sobald der Wizard läuft, bleibt er aktiv - auch wenn needsSetup nach der
  // Konto-Erstellung serverseitig auf false kippt (Refetch).
  const [wizardAktiv, setWizardAktiv] = useState(false);
  const einrichtung = needsSetup || wizardAktiv;
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [firma, setFirma] = useState(firmaLeer);
  const [bank, setBank] = useState(bankLeer);
  const [mitBank, setMitBank] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  // Bereits angemeldet und Ersteinrichtung abgeschlossen? Dann direkt weiter.
  useEffect(() => {
    if (ich.data && !einrichtung && status.data) navigate("/", { replace: true });
  }, [ich.data, einrichtung, status.data, navigate]);

  const fertig = async () => {
    await utils.invalidate();
    navigate("/", { replace: true });
  };

  const login = trpc.auth.login.useMutation({
    onSuccess: fertig,
    onError: (e) => setFehler(e.message),
  });
  const register = trpc.auth.register.useMutation({
    onSuccess: () => {
      setFehler(null);
      setWizardAktiv(true);
      setSchritt(2);
    },
    onError: (e) => setFehler(e.message),
  });
  const firmaSpeichern = trpc.settings.update.useMutation({
    onError: (e) => setFehler(e.message),
  });
  const bankAnlegen = trpc.bank.create.useMutation();
  const bankStandard = trpc.bank.setStandard.useMutation();

  const laeuft =
    login.isPending || register.isPending || firmaSpeichern.isPending ||
    bankAnlegen.isPending || bankStandard.isPending;

  const absendenLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setFehler(null);
    if (password !== password2 && einrichtung) {
      setFehler("Die Passwörter stimmen nicht überein.");
      return;
    }
    if (einrichtung) {
      register.mutate({ username, password, name: name.trim() || undefined });
    } else {
      login.mutate({ username, password });
    }
  };

  const absendenFirma = async (e: React.FormEvent) => {
    e.preventDefault();
    setFehler(null);
    if (mitBank && bank.iban && (!bank.bezeichnung || !bank.bankName || !bank.kontoinhaber)) {
      setFehler("Bitte die Bankfelder vollständig ausfüllen oder die Bankverbindung weglassen.");
      return;
    }
    try {
      await firmaSpeichern.mutateAsync({
        name: firma.name,
        strasse: firma.strasse,
        plz: firma.plz,
        ort: firma.ort,
        land: firma.land || "Deutschland",
        email: firma.email || null,
        telefon: firma.telefon || null,
        webseite: firma.webseite || null,
        steuernummer: firma.steuernummer || null,
        ustIdNr: firma.ustIdNr || null,
        handelsregister: firma.handelsregister || null,
        standardZahlungsziel: 14,
        fussText: null,
        datevKontenrahmen: "SKR03",
        erloeskonto19: "8400",
        erloeskonto7: "8300",
        erloeskonto0: "8120",
        debitorStartnummer: 10000,
      });
      if (mitBank && bank.iban) {
        const angelegt = await bankAnlegen.mutateAsync({
          bezeichnung: bank.bezeichnung,
          bankName: bank.bankName,
          kontoinhaber: bank.kontoinhaber,
          iban: bank.iban.replaceAll(" ", ""),
          bic: bank.bic || null,
        });
        await bankStandard.mutateAsync({ id: angelegt.id });
      }
      await fertig();
    } catch {
      // Fehlermeldung kommt aus den Mutationen
    }
  };

  const setF = (k: keyof typeof firmaLeer) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFirma({ ...firma, [k]: e.target.value });
  const setB = (k: keyof typeof bankLeer) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setBank({ ...bank, [k]: e.target.value });

  const firmaOk = firma.name && firma.strasse && firma.plz && firma.ort;

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-8">
      <Card className={`w-full ${einrichtung && schritt === 2 ? "max-w-2xl" : "max-w-sm"}`}>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">ReWaWi</CardTitle>
          <p className="pt-1 text-sm text-neutral-500">
            {einrichtung
              ? schritt === 1
                ? "Ersteinrichtung (Schritt 1 von 2): Admin-Konto"
                : "Ersteinrichtung (Schritt 2 von 2): Firmendaten"
              : "Bitte anmelden"}
          </p>
          {einrichtung && (
            <div className="mx-auto mt-2 flex w-40 gap-1.5">
              <div className={`h-1 flex-1 rounded ${schritt >= 1 ? "bg-neutral-800" : "bg-neutral-200"}`} />
              <div className={`h-1 flex-1 rounded ${schritt >= 2 ? "bg-neutral-800" : "bg-neutral-200"}`} />
            </div>
          )}
        </CardHeader>
        <CardContent>
          {/* ── Schritt 1: Konto / Anmeldung ── */}
          {(!einrichtung || schritt === 1) && (
            <form onSubmit={absendenLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">Benutzername</Label>
                <Input
                  id="username" value={username} autoFocus required
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username" minLength={einrichtung ? 3 : 1}
                />
              </div>
              {einrichtung && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name (optional)</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="password">Passwort</Label>
                <Input
                  id="password" type="password" value={password} required
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={einrichtung ? "new-password" : "current-password"}
                  minLength={einrichtung ? 8 : 1}
                />
                {einrichtung && <p className="text-xs text-neutral-400">Mindestens 8 Zeichen.</p>}
              </div>
              {einrichtung && (
                <div className="space-y-1.5">
                  <Label htmlFor="password2">Passwort wiederholen</Label>
                  <Input
                    id="password2" type="password" value={password2} required
                    onChange={(e) => setPassword2(e.target.value)}
                    autoComplete="new-password" minLength={8}
                  />
                </div>
              )}
              {fehler && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</p>
              )}
              <Button type="submit" className="w-full" size="lg" disabled={laeuft || !username || !password}>
                {laeuft ? "Bitte warten …" : einrichtung ? "Konto anlegen & weiter" : "Anmelden"}
              </Button>
              {einrichtung && (
                <p className="text-center text-xs leading-relaxed text-neutral-400">
                  Das erste Konto erhält Admin-Rechte. Weitere Benutzer legst du
                  später in den Einstellungen an.
                </p>
              )}
            </form>
          )}

          {/* ── Schritt 2: Firmendaten + Bank ── */}
          {einrichtung && schritt === 2 && (
            <form onSubmit={absendenFirma} className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="col-span-2">
                  <Label>Firmenname *</Label>
                  <Input value={firma.name} onChange={setF("name")} autoFocus placeholder="z. B. Muster GmbH" />
                </div>
                <div className="col-span-2">
                  <Label>Straße *</Label>
                  <Input value={firma.strasse} onChange={setF("strasse")} placeholder="z. B. Musterstraße 1" />
                </div>
                <div>
                  <Label>PLZ *</Label>
                  <Input value={firma.plz} onChange={setF("plz")} />
                </div>
                <div>
                  <Label>Ort *</Label>
                  <Input value={firma.ort} onChange={setF("ort")} />
                </div>
                <div>
                  <Label>Land</Label>
                  <Input value={firma.land} onChange={setF("land")} />
                </div>
                <div>
                  <Label>E-Mail</Label>
                  <Input value={firma.email} onChange={setF("email")} placeholder="für XRechnung nötig" />
                </div>
                <div>
                  <Label>Telefon</Label>
                  <Input value={firma.telefon} onChange={setF("telefon")} />
                </div>
                <div>
                  <Label>Webseite</Label>
                  <Input value={firma.webseite} onChange={setF("webseite")} />
                </div>
                <div>
                  <Label>Steuernummer</Label>
                  <Input value={firma.steuernummer} onChange={setF("steuernummer")} placeholder="Pflicht auf Rechnungen" />
                </div>
                <div>
                  <Label>USt-IdNr.</Label>
                  <Input value={firma.ustIdNr} onChange={setF("ustIdNr")} />
                </div>
                <div className="col-span-2">
                  <Label>Handelsregister</Label>
                  <Input value={firma.handelsregister} onChange={setF("handelsregister")} placeholder="z. B. HRB 12345 A" />
                </div>
              </div>

              <div className="rounded-md border border-neutral-200 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={mitBank}
                    onChange={(e) => setMitBank(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="font-medium">Bankverbindung jetzt eintragen</span>
                  <span className="text-xs text-neutral-400">(kann auch später nachgetragen werden)</span>
                </label>
                {mitBank && (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Bezeichnung</Label>
                      <Input value={bank.bezeichnung} onChange={setB("bezeichnung")} placeholder="z. B. Geschäftskonto" />
                    </div>
                    <div>
                      <Label>Bank</Label>
                      <Input value={bank.bankName} onChange={setB("bankName")} placeholder="z. B. Musterbank" />
                    </div>
                    <div className="col-span-2">
                      <Label>Kontoinhaber</Label>
                      <Input value={bank.kontoinhaber} onChange={setB("kontoinhaber")} />
                    </div>
                    <div>
                      <Label>IBAN</Label>
                      <Input value={bank.iban} onChange={setB("iban")} placeholder="DE…" />
                    </div>
                    <div>
                      <Label>BIC</Label>
                      <Input value={bank.bic} onChange={setB("bic")} />
                    </div>
                  </div>
                )}
              </div>

              {fehler && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</p>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={fertig}>
                  Überspringen
                </Button>
                <Button type="submit" className="flex-1" disabled={laeuft || !firmaOk}>
                  {laeuft ? "Speichern …" : "Fertigstellen"}
                </Button>
              </div>
              <p className="text-center text-xs text-neutral-400">
                Alles lässt sich später unter „Einstellungen" ändern.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
