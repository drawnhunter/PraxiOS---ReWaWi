import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Eraser, Undo2, Redo2, List, ListOrdered, Link2, Link2Off, IndentIncrease, IndentDecrease,
  Highlighter, Type, Minus, Quote, Baseline, CircleHelp,
} from "lucide-react";

/**
 * Rich-Text-Editor für Mails (contentEditable + execCommand, mail-sicheres HTML).
 * Schlank-Philosophie (Recherche v1.20): feste Toolbar + Bubble + Markdown-Input-Rules
 * (`**fett**`, `1. `, `- `, `> `, `---`, Backticks) + Textbausteine per Kürzel+TAB +
 * typografische Autokorrektur (abschaltbar) + Emoji per `:` + Smart Paste.
 */
export function MailEditor({
  value,
  onChange,
  minHeight = 260,
  typoKorrektur = true,
  bausteine = [],
}: {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
  typoKorrektur?: boolean;
  bausteine?: { kuerzel: string; titel: string; inhalt: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initialRef = useRef(false);
  const [aktiv, setAktiv] = useState<Record<string, boolean>>({});
  const [groesse, setGroesse] = useState<number | null>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const [hilfe, setHilfe] = useState(false);
  const [emoji, setEmoji] = useState<{ x: number; y: number; filter: string } | null>(null);

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

  // ── v1.20: Eingabe-Intelligenz (Markdown-Rules, Bausteine, Typo, Emoji) ────

  /** Text vor dem Caret im aktuellen Textknoten lesen. */
  const wortVorCaret = (): { knoten: Text; offset: number; text: string } | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const knoten = sel.anchorNode;
    if (!(knoten instanceof Text) || !ref.current?.contains(knoten)) return null;
    return { knoten, offset: sel.anchorOffset, text: knoten.data.slice(0, sel.anchorOffset) };
  };

  /** Ersetze die letzten n Zeichen vor dem Caret durch HTML. */
  const ersetzeVorCaret = (n: number, html: string) => {
    const sel = window.getSelection();
    const info = wortVorCaret();
    if (!sel || !info) return;
    const range = document.createRange();
    range.setStart(info.knoten, info.offset - n);
    range.setEnd(info.knoten, info.offset);
    range.deleteContents();
    const frag = range.createContextualFragment(html);
    const letzter = frag.lastChild;
    range.insertNode(frag);
    if (letzter) {
      const r = document.createRange();
      r.setStartAfter(letzter);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };

  const TYPO_MAP: [RegExp, string][] = [
    [/\.\.\.$/, "…"],
    [/--$/, "—"],
    [/\(c\)$/i, "©"],
    [/\(r\)$/i, "®"],
    [/->>$/, "»"],
    [/<<$/, "«"],
    [/->$/, "→"],
  ];

  /** Wird bei jeder Eingabe aufgerufen: Typo-Korrektur + Markdown-Inline beim Leerzeichen. */
  const beiEingabe = () => {
    melden();
    const info = wortVorCaret();
    if (!info) return;
    // Typografische Autokorrektur (abschaltbar)
    if (typoKorrektur) {
      for (const [muster, ersatz] of TYPO_MAP) {
        const m = info.text.match(muster);
        if (m) {
          ersetzeVorCaret(m[0].length, ersatz);
          melden();
          return;
        }
      }
    }
    // Emoji-Trigger: „:xx" filtert
    const emojiM = info.text.match(/:([\w+-]{2,})$/);
    if (emojiM) {
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      setEmoji({ x: rect.left, y: rect.bottom + 6, filter: emojiM[1].toLowerCase() });
      return;
    }
    setEmoji(null);
  };

  /** Markdown-Inline beim Leerzeichen: **fett**, *kursiv*, `code`, ~~durch~~ */
  const beiLeerzeichen = (): boolean => {
    const info = wortVorCaret();
    if (!info) return false;
    const regeln: [RegExp, string][] = [
      [/\*\*([^*]+)\*\*$/, "<b>$1</b>&nbsp;"],
      [/\*([^*\n]+)\*$/, "<i>$1</i>&nbsp;"],
      [/~~([^~]+)~~$/, "<s>$1</s>&nbsp;"],
      [/`([^`]+)`$/, "<code style=\"font-family:monospace;background:#f4f4f5;padding:0 4px;border-radius:3px\">$1</code>&nbsp;"],
    ];
    for (const [muster, html] of regeln) {
      const m = info.text.match(muster);
      if (m) {
        ersetzeVorCaret(m[0].length, html);
        melden();
        return true;
      }
    }
    return false;
  };

  /** Zeilen-Trigger beim Leerzeichen: „- " Liste, „1. " nummeriert, „> " Zitat. */
  const beiZeilenTrigger = (): boolean => {
    const info = wortVorCaret();
    if (!info) return false;
    if (info.text === "-") { ersetzeVorCaret(1, ""); befehl("insertUnorderedList"); return true; }
    if (info.text === "1.") { ersetzeVorCaret(2, ""); befehl("insertOrderedList"); return true; }
    if (info.text === ">") { ersetzeVorCaret(1, ""); befehl("formatBlock", "blockquote"); return true; }
    return false;
  };

  /** Baustein per Kürzel + TAB. */
  const beiTab = (e: React.KeyboardEvent): boolean => {
    const info = wortVorCaret();
    if (!info) return false;
    const wort = info.text.match(/[\w-]+$/)?.[0];
    if (!wort) return false;
    const b = bausteine.find((x) => x.kuerzel.toLowerCase() === wort.toLowerCase());
    if (!b) return false;
    e.preventDefault();
    ersetzeVorCaret(wort.length, b.inhalt);
    melden();
    return true;
  };

  /** --- + Enter → horizontale Linie. */
  const beiEnter = (e: React.KeyboardEvent): boolean => {
    const info = wortVorCaret();
    if (!info) return false;
    if (info.text.endsWith("---") && info.text.trim() === "---") {
      e.preventDefault();
      ersetzeVorCaret(3, "");
      befehl("insertHorizontalRule");
      document.execCommand("insertHTML", false, "<p><br></p>");
      melden();
      return true;
    }
    return false;
  };

  /** Smart Paste: auf sicheres Subset normalisieren (Word-CSS/Skripte raus). */
  const beiPaste = (e: React.ClipboardEvent) => {
    const htmlRoh = e.clipboardData.getData("text/html");
    if (!htmlRoh) return; // Plaintext: Browser-Default
    e.preventDefault();
    const div = document.createElement("div");
    div.innerHTML = htmlRoh;
    div.querySelectorAll("script, style, meta, link, title").forEach((n) => n.remove());
    div.querySelectorAll("*").forEach((el) => {
      // Alle Attribute raus außer href bei Links + src bei Bildern
      for (const attr of Array.from(el.attributes)) {
        const erlaubt = (el.tagName === "A" && attr.name === "href") || (el.tagName === "IMG" && (attr.name === "src" || attr.name === "alt"));
        if (!erlaubt) el.removeAttribute(attr.name);
      }
    });
    document.execCommand("insertHTML", false, div.innerHTML);
    melden();
  };

  const EMOJIS = ["😀","😊","😉","👍","🙏","🎉","❤️","💪","🤝","✅","⭐","🔥","💡","📌","📅","📎","✉️","📞","🏥","💊","🧾","📊","⚠️","🚀","😅","🙌","👏","🍀","☀️","🌙"];
  const emojiEinfuegen = (zeichen: string) => {
    const info = wortVorCaret();
    if (info) {
      const m = info.text.match(/:([\w+-]{2,})$/);
      if (m) ersetzeVorCaret(m[0].length, zeichen);
    }
    setEmoji(null);
    melden();
  };
  const emojiGefiltert = emoji ? EMOJIS.filter((e) => e.includes(emoji.filter)) : EMOJIS;

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
        <span className="mx-1 h-5 w-px bg-neutral-300" />
        <Werkzeug onClick={() => setHilfe((h) => !h)} title="Editor-Kürzel & Bausteine (Hilfe)"><CircleHelp className="h-4 w-4" /></Werkzeug>
      </div>

      {/* ── Editierbereich (scrollbar, Rechtschreibprüfung de) ── */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        lang="de"
        onInput={beiEingabe}
        onMouseUp={beiMouseUp}
        onKeyDown={(e) => {
          if (e.key === " " && (beiZeilenTrigger() || beiLeerzeichen())) { e.preventDefault(); return; }
          if (e.key === "Tab" && beiTab(e)) return;
          if (e.key === "Enter" && beiEnter(e)) return;
          if (e.key === "Escape") { setEmoji(null); setHilfe(false); }
        }}
        onKeyUp={(e) => { zustandLesen(); if (e.key === "Escape") setBubble(null); }}
        onPaste={beiPaste}
        onBlur={() => { setBubble(null); setEmoji(null); }}
        className="min-h-0 w-full flex-1 overflow-y-auto px-3 py-2 text-sm outline-none"
        style={{ minHeight }}
      />

      {/* ── Emoji-Popup („:" + Suche) ── */}
      {emoji && (
        <div
          className="fixed z-50 grid max-w-56 grid-cols-8 gap-0.5 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-xl"
          style={{ left: emoji.x, top: emoji.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {emojiGefiltert.slice(0, 24).map((e) => (
            <button key={e} type="button" className="rounded p-1 text-lg hover:bg-neutral-100" onMouseDown={(ev) => { ev.preventDefault(); emojiEinfuegen(e); }}>
              {e}
            </button>
          ))}
          {emojiGefiltert.length === 0 && <span className="col-span-8 px-2 py-1 text-xs text-neutral-400">kein Treffer</span>}
        </div>
      )}

      {/* ── Shortcut-Hilfe (Shift+?-Vorbild) ── */}
      {hilfe && (
        <div className="absolute bottom-3 right-3 z-40 w-72 rounded-lg border border-neutral-200 bg-white p-3 text-xs shadow-xl">
          <div className="mb-1.5 flex items-center justify-between">
            <b>Editor-Kürzel</b>
            <button onClick={() => setHilfe(false)} className="text-neutral-400 hover:text-neutral-700"><Eraser className="h-3.5 w-3.5 rotate-45" /></button>
          </div>
          <ul className="space-y-1 text-neutral-600">
            <li><code>**fett**</code> Leertaste · <code>*kursiv*</code> · <code>~~durch~~</code> · <code>`code`</code></li>
            <li><code>- </code> Liste · <code>1. </code> nummeriert · <code>&gt; </code> Zitat · <code>---</code>+Enter Linie</li>
            <li><code>:lächel</code> Emoji · <code>kürzel</code>+Tab Textbaustein</li>
            <li><code>Strg+Z/Y</code> rückgängig/wiederholen · <code>Strg+B/I/U</code> Format</li>
            <li>Einfügen aus Word/Web wird automatisch gesäubert</li>
          </ul>
        </div>
      )}

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

/** HTML → Plain-Text (für die Text-Alternative der Mail) — absatz-sicher:
 *  <p>/<div> werden zu Zeilen, <br> zu Umbrüchen, Tabs zu 4 Leerzeichen. */
export function htmlZuText(html: string): string {
  const vorbereitet = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<\/(table|ul|ol)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/\t/g, "    ");
  const div = document.createElement("div");
  div.innerHTML = vorbereitet;
  return (div.textContent ?? "")
    .replace(/ /g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
