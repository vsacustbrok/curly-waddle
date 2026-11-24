// Help: the staff guide. Each person sees the guides for their role first; everything is searchable
// and printable. Content lives in lib/guide.ts.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { guidesFor, type Guide } from "../lib/guide";

function GuideCard({ g, open }: { g: Guide; open: boolean }) {
  return (
    <details className="card guide" id={g.id} open={open}>
      <summary><h2>{g.title}</h2></summary>
      <dl className="guide-meta">
        <div><dt>Who</dt><dd>{g.who}</dd></div>
        <div><dt>When</dt><dd>{g.when}</dd></div>
      </dl>
      <ol className="guide-steps">{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {g.whatIf.length > 0 && (
        <>
          <h3>If something is off</h3>
          <table className="small guide-if">
            <tbody>{g.whatIf.map(([c, d], i) => <tr key={i}><th scope="row">{c}</th><td>{d}</td></tr>)}</tbody>
          </table>
        </>
      )}
      {g.link && <p className="no-print"><Link to={g.link.to}>{g.link.label} →</Link></p>}
    </details>
  );
}

export default function Help() {
  const { profile } = useAuth();
  const [q, setQ] = useState("");
  const [printAll, setPrintAll] = useState(false);
  const { mine, others } = guidesFor(profile!.role, q);
  const searching = q.trim().length > 0;

  function print() {
    setPrintAll(true);
    setTimeout(() => { window.print(); setPrintAll(false); }, 50);
  }

  return (
    <div className="help">
      <div className="row spread wrap">
        <h1>Help: how to do it</h1>
        <button type="button" className="ghost no-print" onClick={print}>Print these guides</button>
      </div>
      <p className="muted no-print">Step-by-step guides for everyday work. Click a title to open it.</p>
      <input type="search" className="no-print" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. receipt, lodged, 2307, photo" aria-label="Search the guides" />
      {mine.length + others.length === 0 && <p className="muted">No guide mentions that. Try another word, or ask the owner.</p>}
      {mine.length > 0 && (
        <>
          {others.length > 0 && <h2 className="guide-group">For your work</h2>}
          {mine.map((g) => <GuideCard key={g.id} g={g} open={searching || printAll || (mine.length === 1 && others.length === 0)} />)}
        </>
      )}
      {others.length > 0 && (
        <>
          <h2 className="guide-group">Other tasks in the office</h2>
          {others.map((g) => <GuideCard key={g.id} g={g} open={searching || printAll} />)}
        </>
      )}
    </div>
  );
}
