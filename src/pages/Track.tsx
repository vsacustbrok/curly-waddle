// The client page: a private link (/track/<secret>) that shows one client their open shipments,
// with no login. Only tracking details come back from the database: no amounts, no documents.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { dayLabel } from "../lib/types";

type Step = { step: string; at: string };
type Shipment = {
  pn: string; ref: string | null; bl: string | null; containers: string[] | null; vessel: string | null; voyage: string | null;
  eta: string | null; item: string | null; step: string; vessel_note: string | null; vessel_checked_at: string | null; steps: Step[];
};
type Portal = { client: string; shipments: Shipment[] };

const TRACK_STEPS = ["pre_arrival", "lodged", "assessed", "paid", "gatepass", "tabs", "delivered"];
const WORDS: Record<string, string> = {
  pre_arrival: "Pre-arrival", lodged: "Lodged", assessed: "Assessed", paid: "Paid", gatepass: "Gatepass",
  tabs: "TABS", released: "Delivered", delivered: "Delivered", billed: "Completed",
};
const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Track({ token }: { token: string }) {
  const [data, setData] = useState<Portal | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");

  useEffect(() => {
    document.title = "Shipment tracking · VSA Customs Brokerage";
    if (!UUID.test(token)) { setState("missing"); return; }
    supabase.rpc("client_portal", { token }).then(({ data, error }) => {
      if (error) { setState("error"); return; }
      if (!data) { setState("missing"); return; }
      setData(data as Portal); setState("ok");
    });
  }, [token]);

  return (
    <div className="track">
      <header className="track-head">
        <img src="/logo.webp" alt="VSA Customs Brokerage" />
        <div>
          <strong>VSA Customs Brokerage</strong>
          <div className="small">Shipment tracking{data ? ` for ${data.client}` : ""}</div>
        </div>
      </header>
      <main className="track-main">
        {state === "loading" && <p className="muted">Loading your shipments…</p>}
        {state === "missing" && (
          <div className="card"><h1>Link not found</h1><p>This tracking link is not valid or has been switched off. Please ask VSA Customs Brokerage for a new link.</p></div>
        )}
        {state === "error" && <div className="card"><p className="error">Could not load your shipments right now. Please try again in a few minutes.</p></div>}
        {state === "ok" && data && (data.shipments.length === 0
          ? <div className="card"><p>No open shipments at the moment.</p></div>
          : data.shipments.map((s) => <ShipmentCard key={s.pn} s={s} />))}
        {state === "ok" && <p className="muted small">Updated as our team works on your shipments. Refresh the page to see the latest.</p>}
      </main>
    </div>
  );
}

function ShipmentCard({ s }: { s: Shipment }) {
  const current = s.step === "billed" ? TRACK_STEPS.length - 1 : TRACK_STEPS.indexOf(s.step === "released" ? "delivered" : s.step);
  const reached = (st: string) => s.steps.filter((h) => (h.step === "released" ? "delivered" : h.step) === st).at(-1)?.at;
  const facts: [string, string | null][] = [
    ["Your reference", s.ref], ["BL / AWB", s.bl], ["Vessel / voyage", [s.vessel, s.voyage].filter(Boolean).join(" / ") || null],
    ["ETA", s.eta ? dayLabel(s.eta) : null], ["Containers", (s.containers ?? []).join(", ") || null], ["Goods", s.item],
  ];
  return (
    <section className="card track-card">
      <div className="row spread">
        <h2>{s.ref || s.bl || s.pn}</h2>
        <span className={"badge status-" + s.step}>{WORDS[s.step] ?? s.step}</span>
      </div>
      <ol className="track-steps" aria-label="Progress">
        {TRACK_STEPS.map((st, i) => {
          const at = reached(st);
          return (
            <li key={st} className={i < current ? "done" : i === current ? "now" : ""} aria-current={i === current ? "step" : undefined}>
              <span className="dot" aria-hidden="true" />
              <span className="lbl">{WORDS[st]}</span>
              {at && i <= current && <span className="at">{new Date(at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</span>}
            </li>
          );
        })}
      </ol>
      {s.vessel_note && (
        <p className="track-note">⚓ <strong>Latest vessel position:</strong> {s.vessel_note}
          {s.vessel_checked_at && <span className="muted small"> (checked {when(s.vessel_checked_at)})</span>}</p>
      )}
      <dl className="track-facts">
        {facts.filter((f): f is [string, string] => !!f[1]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <p className="muted small">Our PN: {s.pn}</p>
    </section>
  );
}
