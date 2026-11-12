// Speak instead of typing. Tap the microphone, talk, and the words go into the text box
// that was last clicked (a note, an address, a reference number...). Uses the browser's own
// speech recognition: Chrome, Edge and Safari support it; Firefox does not.
import { useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type Field = HTMLInputElement | HTMLTextAreaElement;

const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

const TEXT_TYPES = new Set(["text", "search", "email", "tel", "url", ""]);
const isTextField = (el: Element | null): el is Field =>
  !!el && ((el instanceof HTMLTextAreaElement) || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type))) && !(el as Field).readOnly && !(el as Field).disabled;

/** Puts text into a React-controlled box the same way typing would. */
function insert(el: Field, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const spacer = before && !/\s$/.test(before) ? " " : "";
  setter?.call(el, before + spacer + text + el.value.slice(end));
  const caret = (before + spacer + text).length;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.setSelectionRange?.(caret, caret);
}

export default function Dictation() {
  const target = useRef<Field | null>(null);
  const rec = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState("");
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem("dictation-lang") || "en-PH"; } catch { return "en-PH"; }
  });

  // Remember the last text box the person clicked into.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => { if (isTextField(e.target as Element)) target.current = e.target as Field; };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  function toggle() {
    if (!SpeechRecognition) { setHint("Speech typing works in Chrome, Edge or Safari."); return; }
    if (listening) { rec.current?.stop(); return; }
    const el = target.current;
    if (!el || !document.body.contains(el)) { setHint("Click the box you want to fill first, then tap the microphone."); return; }
    const r = new SpeechRecognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal && target.current) insert(target.current, res[0].transcript.trim());
      }
    };
    r.onerror = (e) => setHint(e.error === "not-allowed" ? "Allow the microphone in your browser to use speech typing." : `Speech typing stopped (${e.error}).`);
    r.onend = () => setListening(false);
    rec.current = r;
    el.focus();
    r.start();
    setHint("Listening… speak now. Tap again to stop.");
    setListening(true);
  }

  function changeLang(v: string) {
    setLang(v);
    try { localStorage.setItem("dictation-lang", v); } catch { /* not saved; fine */ }
  }

  return (
    <div className="dictation" onMouseDown={(e) => e.preventDefault()}>
      {hint && <span className="dictation-hint">{hint}</span>}
      <select value={lang} onChange={(e) => changeLang(e.target.value)} aria-label="Speech language" onMouseDown={(e) => e.stopPropagation()}>
        <option value="en-PH">English</option>
        <option value="fil-PH">Filipino</option>
      </select>
      <button type="button" className={listening ? "mic on" : "mic"} onClick={toggle}
        aria-label={listening ? "Stop speech typing" : "Speak to type"} title="Speak to type into the last box you clicked">
        {listening ? "■ Stop" : "🎤 Speak"}
      </button>
    </div>
  );
}
