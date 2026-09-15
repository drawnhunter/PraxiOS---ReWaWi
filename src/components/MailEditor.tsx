import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Eraser } from "lucide-react";

/**
 * Schlanker Rich-Text-Editor für Mails (contentEditable + execCommand).
 * Erzeugt mail-sicheres HTML (<b>, <font>, Block-Ausrichtung) — keine
 * externe RTE-Abhängigkeit nötig.
 */
export function MailEditor({
  value,
  onChange,
  minHeight = 260,
}: {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initialRef = useRef(false);

  useEffect(() => {
    if (ref.current && !initialRef.current) {
      ref.current.innerHTML = value;
      initialRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current]);

  const befehl = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange(ref.current?.innerHTML ?? "");
  };

  const Werkzeug = ({
    onClick, title, children,
  }: { onClick: () => void; title: string; children: React.ReactNode }) => (
    <Button type="button" variant="ghost" size="sm" onMouseDown={(e) => { e.preventDefault(); onClick(); }} title={title} className="h-8 w-8 p-0">
      {children}
    </Button>
  );

  return (
    <div className="rounded-md border border-neutral-200">
      {/* Werkzeugleiste */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-neutral-50 px-2 py-1">
        <Werkzeug onClick={() => befehl("bold")} title="Fett"><Bold className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("italic")} title="Kursiv"><Italic className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("underline")} title="Unterstrichen"><Underline className="h-4 w-4" /></Werkzeug>
        <span className="mx-1 h-5 w-px bg-neutral-300" />
        <Select onValueChange={(v) => befehl("fontSize", v)}>
          <SelectTrigger className="h-8 w-24 text-xs"><SelectValue placeholder="Größe" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="2">Klein</SelectItem>
            <SelectItem value="3">Normal</SelectItem>
            <SelectItem value="4">Groß</SelectItem>
            <SelectItem value="5">Sehr groß</SelectItem>
          </SelectContent>
        </Select>
        <Select onValueChange={(v) => befehl("foreColor", v)}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Farbe" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="#171412">Schwarz</SelectItem>
            <SelectItem value="#5b564f">Grau</SelectItem>
            <SelectItem value="#0f766e">Teal</SelectItem>
            <SelectItem value="#b45309">Amber</SelectItem>
            <SelectItem value="#b91c1c">Rot</SelectItem>
            <SelectItem value="#1d4ed8">Blau</SelectItem>
          </SelectContent>
        </Select>
        <span className="mx-1 h-5 w-px bg-neutral-300" />
        <Werkzeug onClick={() => befehl("justifyLeft")} title="Linksbündig"><AlignLeft className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("justifyCenter")} title="Zentriert"><AlignCenter className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("justifyRight")} title="Rechtsbündig"><AlignRight className="h-4 w-4" /></Werkzeug>
        <span className="mx-1 h-5 w-px bg-neutral-300" />
        <Werkzeug onClick={() => befehl("removeFormat")} title="Formatierung entfernen"><Eraser className="h-4 w-4" /></Werkzeug>
      </div>
      {/* Editierbereich */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(ref.current?.innerHTML ?? "")}
        className="w-full overflow-y-auto px-3 py-2 text-sm outline-none"
        style={{ minHeight }}
      />
    </div>
  );
}

/** HTML → Plain-Text (für die Text-Alternative der Mail). */
export function htmlZuText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}
