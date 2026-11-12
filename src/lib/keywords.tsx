// Colours the words the office watches for in notes and remarks:
// ASSESSED green, GATEPASS orange, TABS blue, DELIVERED yellow.
import type { ReactNode } from "react";

const WORDS = /\b(ASSESSED|GATE[\s-]?PASS|TABS|DELIVERED)\b/gi;
const kind = (w: string) => w.toUpperCase().replace(/[\s-]/g, "") as "ASSESSED" | "GATEPASS" | "TABS" | "DELIVERED";

export function markWords(text: string | null | undefined): ReactNode {
  if (!text) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(WORDS)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<span key={m.index} className={"kw kw-" + kind(m[0]).toLowerCase()}>{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  if (!out.length) return text;
  out.push(text.slice(last));
  return out;
}
