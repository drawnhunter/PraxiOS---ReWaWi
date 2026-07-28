import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScanLine, X, CameraOff } from "lucide-react";

// Barcode-Scanner mit der nativen BarcodeDetector-API des Browsers.
// Unterstuetzt: Code128, EAN-13/8, QR, DataMatrix (PZN auf Apothekenpackungen).
// Keine Dritt-Bibliothek — robust und absturzfrei.
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
    };
  }
}

const FORMATE = [
  "code_128", "code_39", "code_93", "ean_13", "ean_8",
  "upc_a", "upc_e", "itf", "codabar", "qr_code", "data_matrix",
];

export function ScanDialog({
  offen,
  onSchliessen,
  onGefunden,
}: {
  offen: boolean;
  onSchliessen: () => void;
  onGefunden: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gefunden = useRef(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [status, setStatus] = useState("Kamera wird gestartet …");

  useEffect(() => {
    if (!offen) return;
    gefunden.current = false;
    setFehler(null);
    setStatus("Kamera wird gestartet …");

    const starten = async () => {
      if (!window.BarcodeDetector) {
        setFehler(
          "Dieser Browser kann keine Codes scannen (BarcodeDetector fehlt). " +
            "Auf iOS bitte Chrome/Android oder den Desktop nutzen — Safari unterstützt das noch nicht.",
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus("Code vor die Kamera halten …");

        const detector = new window.BarcodeDetector({ formats: FORMATE });
        timerRef.current = setInterval(async () => {
          if (gefunden.current || !videoRef.current) return;
          try {
            const treffer = await detector.detect(videoRef.current);
            if (treffer.length > 0 && !gefunden.current) {
              gefunden.current = true;
              const wert = treffer[0].rawValue;
              stoppen();
              onGefunden(wert);
            }
          } catch {
            /* Einzelner Frame ohne Treffer — einfach weiter */
          }
        }, 350);
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        setFehler(
          name === "NotAllowedError"
            ? "Kamera-Zugriff verweigert — bitte im Browser erlauben und erneut versuchen."
            : `Kamera nicht verfügbar: ${e}`,
        );
      }
    };

    const stoppen = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    const t = setTimeout(starten, 250);
    return () => {
      clearTimeout(t);
      stoppen();
    };
  }, [offen, onGefunden]);

  return (
    <Dialog open={offen} onOpenChange={(o) => !o && onSchliessen()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" /> Code scannen
          </DialogTitle>
        </DialogHeader>
        <div className="relative flex min-h-[280px] w-full items-center justify-center overflow-hidden rounded-md bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 bg-red-500/70" />
        </div>
        <p className="text-center text-sm text-neutral-500">{status}</p>
        {fehler && (
          <p className="flex items-start gap-2 text-sm text-red-600">
            <CameraOff className="mt-0.5 h-4 w-4 shrink-0" />
            {fehler}
          </p>
        )}
        <Button variant="outline" onClick={onSchliessen}>
          <X className="mr-1.5 h-4 w-4" /> Schließen
        </Button>
      </DialogContent>
    </Dialog>
  );
}
