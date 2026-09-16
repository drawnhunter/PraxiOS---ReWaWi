import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Eraser, Undo2, Redo2, List, ListOrdered, Link2, Link2Off, IndentIncrease, IndentDecrease,
  Highlighter, Type, Minus, Quote, Baseline,
} from "lucide-react";

/**
 * Rich-Text-Editor für Mails (contentEditable + execCommand, mail-sicheres HTML).
 * - Toolbar bleibt fest (scrollt nicht mit)
 * - Schriftgröße in 1px-Schritten (8–32)
 * - Aktiv-Zustände der Buttons folgen der Markierung
 * - Bubble-Menü bei Maus-Markierung
 * - Undo/Redo, Rechtschreibprüfung (Browser, de)
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
  const [aktiv, setAktiv] = useState<Record<string, boolean>>({});
  const [groesse, setGroesse] = useState<number | null>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (ref.current && !initialRef.current) {
      ref.current.innerHTML = value;
      initialRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current]);

  const melden = useCallback(() => onChange(ref.current?.innerHTML ?? ""), [onChange]);

  /** Aktiv-Zustände + aktuelle Schriftgröße aus der Markierung lesen. */
  const zustandLesen = useCallback(() => {
    if (!ref.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !ref.current.contains(sel.anchorNode)) {
      setAktiv({}); setGroesse(null); return;
    }
    const st: Record<string, boolean> = {};
    for (const [key, cmd] of Object.entries({
      bold: "bold", italic: "italic", underline: "underline", strike: "strikeThrough",
      ul: "insertUnorderedList", ol: "insertOrderedList",
      left: "justifyLeft", center: "justifyCenter", right: "justifyRight", full: "justifyFull",
    })) {
      try { st[key] = document.queryCommandState(cmd); } catch { st[key] = false; }
    }
    setAktiv(st);
    // Schriftgröße: computed style am Anker
    let knoten: Node | null = sel.anchorNode;
    if (knoten && knoten.nodeType === Node.TEXT_NODE) knoten = knoten.parentNode;
    if (knoten instanceof Element) {
      const px = parseFloat(window.getComputedStyle(knoten).fontSize);
      setGroesse(Number.isFinite(px) ? Math.round(px) : null);
    }
  }, []);

  useEffect(() => {
    const handler = () => zustandLesen();
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [zustandLesen]);

  const befehl = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    melden();
    zustandLesen();
  };

  /** Schriftgröße px-genau: Auswahl in <span style="font-size"> wickeln. */
  const setzeSchriftGroesse = (px: number) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed || !ref.current?.contains(range.commonAncestorContainer)) return;
    const span = document.createElement("span");
    span.style.fontSize = `${px}px`;
    const inhalt = range.extractContents();
    // Verschachtelte font-size-Spans aus dem Inhalt entfernen (sonst stapeln sie)
    inhalt.querySelectorAll?.("span").forEach((s) => {
      if (s.style.fontSize) s.style.fontSize = "";
      if (!s.getAttribute("style")) s.replaceWith(...Array.from(s.childNodes));
    });
    span.appendChild(inhalt);
    range.insertNode(span);
    sel.removeAllRanges();
    melden();
    zustandLesen();
  };

  const setzeLink = () => {
    const url = window.prompt("Link-Adresse (https://…):", "https://");
    if (url && url !== "https://") befehl("createLink", url);
  };

  // Bubble-Menü bei Maus-Markierung
  const beiMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !ref.current?.contains(sel.anchorNode)) {
      setBubble(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setBubble({ x: Math.min(rect.right, window.innerWidth - 320), y: rect.bottom + 8 });
  };

  const Werkzeug = ({
    onClick, title, children, an = false, deaktiviert = false,
  }: { onClick: () => void; title: string; children: React.ReactNode; an?: boolean; deaktiviert?: boolean }) => (
    <Button
      type="button" variant="ghost" size="sm" disabled={deaktiviert}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`h-8 w-8 p-0 ${an ? "bg-teal-100 text-teal-800 hover:bg-teal-100" : ""}`}
    >
      {children}
    </Button>
  );

  const Trennstrich = () => <span className="mx-1 h-5 w-px bg-neutral-300" />;
  const groessen = Array.from({ length: 25 }, (_, i) => i + 8); // 8–32 px

  const BubbleWerkzeug = ({ cmd, title, children, aktivKey }: {
    cmd?: string; title: string; children: React.ReactNode; aktivKey?: string;
  }) => (
    <button
      type="button" title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        if (cmd) befehl(cmd);
        zustandLesen();
      }}
      className={`rounded p-1.5 hover:bg-neutral-100 ${aktivKey && aktiv[aktivKey] ? "bg-teal-100 text-teal-800" : "text-neutral-700"}`}
    >
      {children}
    </button>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col rounded-md border border-neutral-200">
      {/* ── Feste Werkzeugleiste (scrollt nie mit) ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 rounded-t-md border-b border-neutral-200 bg-neutral-50 px-2 py-1">
        <Werkzeug onClick={() => befehl("undo")} title="Rückgängig (Strg+Z)"><Undo2 className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("redo")} title="Wiederholen (Strg+Y)"><Redo2 className="h-4 w-4" /></Werkzeug>
        <Trennstrich />
        <Werkzeug onClick={() => befehl("bold")} title="Fett (Strg+B)" an={aktiv.bold}><Bold className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("italic")} title="Kursiv (Strg+I)" an={aktiv.italic}><Italic className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("underline")} title="Unterstrichen (Strg+U)" an={aktiv.underline}><Underline className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("strikeThrough")} title="Durchgestrichen" an={aktiv.strike}><Strikethrough className="h-4 w-4" /></Werkzeug>
        <Trennstrich />
        {/* Schriftgröße: native Select (px, 1er-Schritte) */}
        <div className="flex items-center gap-1" title="Schriftgröße in px (1er-Schritte)">
          <Type className="h-4 w-4 text-neutral-500" />
          <select
            className="h-8 rounded-md border border-neutral-200 bg-white px-1 text-xs"
            value={groesse ?? ""}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setzeSchriftGroesse(Number(e.target.value))}
          >
            <option value="" disabled>{groesse ?? "Größe"}</option>
            {groessen.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        {/* Textfarbe: nativer Color-Picker (volle Freiheit wie in Word) */}
        <label className="flex h-8 cursor-pointer items-center gap-1 rounded-md px-1 hover:bg-neutral-100" title="Textfarbe">
          <Baseline className="h-4 w-4 text-neutral-700" />
          <input
            type="color" className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
            defaultValue="#171412"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => befehl("foreColor", e.target.value)}
          />
        </label>
        <label className="flex h-8 cursor-pointer items-center gap-1 rounded-md px-1 hover:bg-neutral-100" title="Markierfarbe (Hintergrund)">
          <Highlighter className="h-4 w-4 text-neutral-700" />
          <input
            type="color" className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
            defaultValue="#fef08a"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => befehl("hiliteColor", e.target.value)}
          />
        </label>
        <Trennstrich />
        <Werkzeug onClick={() => befehl("justifyLeft")} title="Linksbündig" an={aktiv.left}><AlignLeft className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("justifyCenter")} title="Zentriert" an={aktiv.center}><AlignCenter className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("justifyRight")} title="Rechtsbündig" an={aktiv.right}><AlignRight className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("justifyFull")} title="Blocksatz" an={aktiv.full}><AlignJustify className="h-4 w-4" /></Werkzeug>
        <Trennstrich />
        <Werkzeug onClick={() => befehl("insertUnorderedList")} title="Aufzählung" an={aktiv.ul}><List className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("insertOrderedList")} title="Nummerierte Liste" an={aktiv.ol}><ListOrdered className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("outdent")} title="Einzug verkleinern"><IndentDecrease className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("indent")} title="Einzug vergrößern"><IndentIncrease className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("formatBlock", "blockquote")} title="Zitatblock"><Quote className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("insertHorizontalRule")} title="Horizontale Linie"><Minus className="h-4 w-4" /></Werkzeug>
        <Trennstrich />
        <Werkzeug onClick={setzeLink} title="Link einfügen"><Link2 className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("unlink")} title="Link entfernen"><Link2Off className="h-4 w-4" /></Werkzeug>
        <Werkzeug onClick={() => befehl("removeFormat")} title="Formatierung entfernen"><Eraser className="h-4 w-4" /></Werkzeug>
      </div>

      {/* ── Editierbereich (scrollbar, Rechtschreibprüfung de) ── */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        lang="de"
        onInput={melden}
        onMouseUp={beiMouseUp}
        onKeyUp={(e) => { zustandLesen(); if (e.key === "Escape") setBubble(null); }}
        onBlur={() => setBubble(null)}
        className="min-h-0 w-full flex-1 overflow-y-auto px-3 py-2 text-sm outline-none"
        style={{ minHeight }}
      />

      {/* ── Bubble-Menü bei Maus-Markierung ── */}
      {bubble && (
        <div
          className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white px-1.5 py-1 shadow-xl"
          style={{ left: bubble.x, top: bubble.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <BubbleWerkzeug cmd="bold" title="Fett" aktivKey="bold"><Bold className="h-4 w-4" /></BubbleWerkzeug>
          <BubbleWerkzeug cmd="italic" title="Kursiv" aktivKey="italic"><Italic className="h-4 w-4" /></BubbleWerkzeug>
          <BubbleWerkzeug cmd="underline" title="Unterstrichen" aktivKey="underline"><Underline className="h-4 w-4" /></BubbleWerkzeug>
          <BubbleWerkzeug cmd="strikeThrough" title="Durchgestrichen" aktivKey="strike"><Strikethrough className="h-4 w-4" /></BubbleWerkzeug>
          <span className="mx-0.5 h-5 w-px bg-neutral-200" />
          <select
            className="h-7 rounded border border-neutral-200 text-xs"
            value={groesse ?? ""}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => { setzeSchriftGroesse(Number(e.target.value)); setBubble(null); }}
            title="Schriftgröße"
          >
            <option value="" disabled>{groesse ?? "px"}</option>
            {groessen.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <label className="cursor-pointer rounded p-1 hover:bg-neutral-100" title="Textfarbe">
            <Baseline className="h-4 w-4" />
            <input
              type="color" className="hidden"
              onChange={(e) => { befehl("foreColor", e.target.value); }}
            />
          </label>
          <BubbleWerkzeug cmd="removeFormat" title="Formatierung entfernen"><Eraser className="h-4 w-4" /></BubbleWerkzeug>
        </div>
      )}
    </div>
  );
}

/** HTML → Plain-Text (für die Text-Alternative der Mail). */
export function htmlZuText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}
