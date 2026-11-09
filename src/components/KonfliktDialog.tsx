import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** v1.21.8: Optimistic-Locking-Konflikt sichtbar machen — der Nutzer entscheidet,
 *  statt dass ein Hintergrund-Update seine Bearbeitung still überschreibt. */
export function KonfliktDialog({ fehler, onNeuLaden, onErzwingen, onAbbrechen }: {
  fehler: string | null;
  onNeuLaden: () => void;
  onErzwingen: () => void;
  onAbbrechen: () => void;
}) {
  return (
    <AlertDialog open={fehler !== null} onOpenChange={(o) => !o && onAbbrechen()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Datensatz wurde zwischenzeitlich geändert</AlertDialogTitle>
          <AlertDialogDescription>
            {fehler?.replace(/^KONFLIKT: /, "")}
            <br /><br />
            Deine Formular-Eingaben sind noch da. Wähle:
            <br />• <b>Server-Stand laden</b> — deine bisherigen Eingaben werden verworfen, du siehst den aktuellen Stand.
            <br />• <b>Mit meinem Stand überschreiben</b> — deine Eingaben gewinnen, die fremde Änderung geht verloren.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen (weiterbearbeiten)</AlertDialogCancel>
          <AlertDialogAction className="bg-neutral-600 hover:bg-neutral-700" onClick={onNeuLaden}>
            Server-Stand laden
          </AlertDialogAction>
          <AlertDialogAction onClick={onErzwingen}>
            Mit meinem Stand überschreiben
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
