/**
 * Globaler Drop-Schutz (v1.21.8, Bus #193): Der Browser öffnet fallengelassene
 * Dateien sonst im selben Tab — ein Reload, der ungespeicherte Entwürfe frisst.
 * Erlaubt sind nur markierte Drop-Zonen (data-drop-erlaubt); überall sonst wird
 * die Browser-Navigation unterbunden, ohne die Zonen selbst zu beeinträchtigen.
 */
export function installDropGuard(): void {
  const istDatei = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const inZone = (e: DragEvent) =>
    e.target instanceof Element && e.target.closest("[data-drop-erlaubt]") !== null;

  window.addEventListener("dragover", (e) => {
    if (istDatei(e) && !inZone(e)) e.preventDefault();
  }, true);
  window.addEventListener("drop", (e) => {
    if (istDatei(e) && !inZone(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}
