import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, KeyRound, Trash2 } from "lucide-react";

export function Benutzerverwaltung() {
  const utils = trpc.useUtils();
  const ich = trpc.auth.me.useQuery();
  const istAdmin = ich.data?.role === "admin";

  const benutzer = trpc.auth.benutzer.useQuery(undefined, {
    enabled: istAdmin,
    retry: false,
  });

  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [passwortZiel, setPasswortZiel] = useState<{ id: number; name: string } | null>(null);
  const [form, setForm] = useState({ username: "", name: "", password: "", role: "user" as "user" | "admin" });
  const [neuesPasswort, setNeuesPasswort] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);

  const invalid = () => utils.auth.benutzer.invalidate();

  const anlegen = trpc.auth.benutzerAnlegen.useMutation({
    onSuccess: () => {
      invalid();
      setAnlegenOffen(false);
      setForm({ username: "", name: "", password: "", role: "user" });
      setFehler(null);
    },
    onError: (e) => setFehler(e.message),
  });

  const passwort = trpc.auth.benutzerPasswort.useMutation({
    onSuccess: () => {
      setPasswortZiel(null);
      setNeuesPasswort("");
      setFehler(null);
    },
    onError: (e) => setFehler(e.message),
  });

  const loeschen = trpc.auth.benutzerLoeschen.useMutation({
    onSuccess: invalid,
    onError: (e) => alert(e.message),
  });

  if (!istAdmin) return null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-700">Benutzer</h2>
        <Button variant="outline" size="sm" onClick={() => { setFehler(null); setAnlegenOffen(true); }}>
          <Plus className="mr-1.5 h-4 w-4" /> Benutzer anlegen
        </Button>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        Wer sich anmelden darf. Admins können zusätzlich Benutzer verwalten und
        alle Einstellungen ändern.
      </p>

            <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="px-2 py-2 font-medium">Benutzername</th>
            <th className="px-2 py-2 font-medium">Name</th>
            <th className="px-2 py-2 font-medium">Rolle</th>
            <th className="px-2 py-2 font-medium">Letzte Anmeldung</th>
            <th className="px-2 py-2 text-right font-medium">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {(benutzer.data ?? []).map((b) => (
            <tr key={b.id} className="border-b border-neutral-100 last:border-0">
              <td className="px-2 py-2.5 font-medium">
                {b.username ?? <span className="text-neutral-400">–</span>}
                {b.id === ich.data?.id && (
                  <span className="ml-2 text-xs text-neutral-400">(du)</span>
                )}
              </td>
              <td className="px-2 py-2.5 text-neutral-600">{b.name ?? "–"}</td>
              <td className="px-2 py-2.5">
                <Badge variant={b.role === "admin" ? "default" : "secondary"}>
                  {b.role === "admin" ? "Admin" : "Benutzer"}
                </Badge>
                {!b.hatPasswort && (
                  <Badge variant="outline" className="ml-1.5 text-neutral-400">
                    kein Login
                  </Badge>
                )}
              </td>
              <td className="px-2 py-2.5 text-neutral-600">
                {b.lastSignInAt
                  ? new Date(b.lastSignInAt).toLocaleDateString("de-DE")
                  : "–"}
              </td>
              <td className="px-2 py-2.5 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Neues Passwort setzen"
                    onClick={() => {
                      setFehler(null);
                      setNeuesPasswort("");
                      setPasswortZiel({ id: b.id, name: b.name ?? b.username ?? `#${b.id}` });
                    }}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  {b.id !== ich.data?.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Benutzer löschen"
                      onClick={() => {
                        if (confirm(`Benutzer „${b.name ?? b.username}" wirklich löschen?`))
                          loeschen.mutate({ id: b.id });
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* Anlegen-Dialog */}
      <Dialog open={anlegenOffen} onOpenChange={setAnlegenOffen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Benutzer anlegen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Benutzername *</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="z. B. mmueller"
              />
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="z. B. Maria Müller"
              />
            </div>
            <div>
              <Label>Passwort * (mindestens 8 Zeichen)</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="new-password"
              />
            </div>
            <div>
              <Label>Rolle</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: v as "user" | "admin" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Benutzer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {fehler && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnlegenOffen(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={!form.username || form.password.length < 8 || anlegen.isPending}
              onClick={() =>
                anlegen.mutate({
                  username: form.username,
                  password: form.password,
                  name: form.name.trim() || undefined,
                  role: form.role,
                })
              }
            >
              Anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Passwort-Dialog */}
      <Dialog open={!!passwortZiel} onOpenChange={(o) => !o && setPasswortZiel(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Neues Passwort für {passwortZiel?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Neues Passwort (mindestens 8 Zeichen)</Label>
              <Input
                type="password"
                value={neuesPasswort}
                onChange={(e) => setNeuesPasswort(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {fehler && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswortZiel(null)}>
              Abbrechen
            </Button>
            <Button
              disabled={neuesPasswort.length < 8 || passwort.isPending}
              onClick={() =>
                passwortZiel &&
                passwort.mutate({ id: passwortZiel.id, password: neuesPasswort })
              }
            >
              Passwort setzen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
