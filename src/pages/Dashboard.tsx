// Owner's dashboard: what still needs setting up, this month at a glance, where the shipments are,
// and 12 months of money billed against money collected.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAll, supabase } from "../lib/supabase";
import { STATUSES, STATUS_LABEL, today } from "../lib/types";
import { dueDate, peso, totals, type Charge, type Payment } from "../lib/billing";
import { loadAlerts } from "../lib/alerts";
import { billedCollected, countBySteps, lastMonths, monthLabel, niceMax, shortPeso, type MonthMoney } from "../lib/dashboard";

type DJob = { id: string; status: string; billed_on: string | null; entry_filed_date: string | null; clients: { payment_terms_days: number | null } | null };
type Pay = Payment & { paid_on: string };
type Check = { label: string; done: boolean | null; detail: string; to?: string };

export default function Dashboard() {
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<DJob[] | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [releasedThisMonth, setReleased] = useState<number | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [riderCost, setRiderCost] = useState<number | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const now = today();
  const month = now.slice(0, 7);

  useEffect(() => {
    const fail = (e: Error) => setError(e.message);
    Promise.all([
      fetchAll<DJob>((a, b) => supabase.from("jobs").select("id, status, billed_on, entry_filed_date, clients(payment_terms_days)").order("id").range(a, b) as never),
      fetchAll<Charge>((a, b) => supabase.from("charges").select("job_id, amount, vatable, advance").order("id").range(a, b) as never),
      fetchAll<Pay>((a, b) => supabase.from("payments").select("job_id, amount, ewt_amount, paid_on").order("id").range(a, b) as never),
    ]).then(([j, c, p]) => { setJobs(j); setCharges(c); setPays(p); }, fail);
    supabase.from("job_status_history").select("job_id").in("to_status", ["delivered", "released"]).gte("changed_at", `${month}-01`)
      .then(({ data }) => setReleased(new Set((data ?? []).map((r) => r.job_id)).size));
    loadAlerts(true).then((rows) => {
      const seen = new Map<string, number>();
      for (const r of rows) if (r.money) seen.set(r.job.id, r.money.now);
      setRunning([...seen.values()].reduce((a, v) => a + v, 0));
    }, () => setRunning(null));
    supabase.from("rider_logs").select("gas, food, other_amount").gte("log_date", `${month}-01`)
      .then(({ data }) => setRiderCost((data ?? []).reduce((s, l) => s + Number(l.gas) + Number(l.food) + Number(l.other_amount), 0)));
    loadChecks().then(setChecks, fail);
  }, [month]);

  // Money per shipment, then by month.
  const perJob = useMemo(() => {
    if (!jobs) return [];
    const ch = new Map<string, Charge[]>(), py = new Map<string, Pay[]>();
    for (const c of charges) ch.set(c.job_id, [...(ch.get(c.job_id) ?? []), c]);
    for (const p of pays) py.set(p.job_id, [...(py.get(p.job_id) ?? []), p]);
    return jobs.filter((j) => ch.has(j.id)).map((j) => ({ job: j, t: totals(ch.get(j.id)!, py.get(j.id) ?? []), due: dueDate(j.billed_on, j.clients?.payment_terms_days) }));
  }, [jobs, charges, pays]);
  const months = useMemo(() => lastMonths(now), [now]);
  const trend = useMemo(() => billedCollected(perJob.map((x) => ({ billed_on: x.job.billed_on, total: x.t.total })), pays, months), [perJob, pays, months]);
  const thisMonth = trend[trend.length - 1];
  const overdue = perJob.filter((x) => x.t.balance > 0 && x.due && x.due < now).reduce((s, x) => s + x.t.balance, 0);
  const yearStart = `${now.slice(0, 4)}-01-01`;
  const steps = useMemo(() => countBySteps((jobs ?? []).filter((j) => !j.entry_filed_date || j.entry_filed_date >= yearStart).map((j) => j.status), STATUSES), [jobs, yearStart]);
  const lodged = (jobs ?? []).filter((j) => j.entry_filed_date?.startsWith(month)).length;

  return (
    <div className="dash">
      <h1>Dashboard</h1>
      {error && <p className="error">{error}</p>}
      {checks && checks.some((c) => c.done === false) && <SetupList checks={checks} />}

      <section className="card">
        <h2>{monthLabel(month, true)} so far</h2>
        <div className="tiles">
          <Tile label="Entries lodged" value={jobs ? String(lodged) : "…"} />
          <Tile label="Released / delivered" value={releasedThisMonth == null ? "…" : String(releasedThisMonth)} />
          <Tile label="Billed" value={jobs ? peso(thisMonth?.billed ?? 0) : "…"} main />
          <Tile label="Collected (incl. 2307)" value={jobs ? peso(thisMonth?.collected ?? 0) : "…"} main />
          <Tile label="Overdue balances" value={jobs ? peso(overdue) : "…"} to="/collections" warn={overdue > 0} />
          <Tile label="Storage and demurrage running" value={running == null ? "…" : peso(running)} to="/alerts" warn={(running ?? 0) > 0} />
          <Tile label="Rider expenses" value={riderCost == null ? "…" : peso(riderCost)} to="/riders" />
        </div>
      </section>

      <div className="dash-grid">
        <section className="card viz-root">
          <h2>Shipments by step <span className="muted small">this year's work</span></h2>
          {jobs ? <StepBars data={steps} /> : <p className="muted">Loading…</p>}
        </section>
        <section className="card viz-root">
          <h2>Billed and collected, last 12 months</h2>
          {jobs ? <Trend data={trend} /> : <p className="muted">Loading…</p>}
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, main, warn, to }: { label: string; value: string; main?: boolean; warn?: boolean; to?: string }) {
  const body = <><span>{label}</span><strong className={warn ? "warn-num" : ""}>{value}</strong></>;
  return to ? <Link to={to} className={"tile tile-link" + (main ? " main" : "")}>{body}</Link> : <div className={"tile" + (main ? " main" : "")}>{body}</div>;
}

// ---------- Setup checklist ----------

async function loadChecks(): Promise<Check[]> {
  const [bir, rules, rates, clients, notes, copies] = await Promise.all([
    supabase.from("bir_settings").select("registered_name, tin, address, permit_no, invoice_from, receipt_from, payment_instructions").maybeSingle(),
    supabase.from("free_time_rules").select("kind, rate_20, rate_40"),
    supabase.from("tariff_rates").select("ahtn_code", { count: "exact", head: true }),
    supabase.from("clients").select("id", { count: "exact", head: true }).or("portal_enabled.eq.true,notify_email.not.is.null"),
    supabase.from("client_notifications").select("status").limit(500),
    supabase.from("offsite_copies").select("made_at").order("id", { ascending: false }).limit(1),
  ]);
  const b = bir.data as Record<string, unknown> | null;
  const birDone = !!b && ["registered_name", "tin", "address", "permit_no", "invoice_from", "receipt_from"].every((k) => b[k] != null && String(b[k]).trim() !== "");
  const r = (rules.data ?? []) as { kind: string; rate_20: number | null; rate_40: number | null }[];
  const ratesDone = ["demurrage", "storage"].every((k) => r.some((x) => x.kind === k && (x.rate_20 != null || x.rate_40 != null)));
  const statuses = ((notes.data ?? []) as { status: string }[]).map((n) => n.status);
  const lastCopy = (copies.data?.[0] as { made_at: string } | undefined)?.made_at;
  const copyAge = lastCopy ? Math.floor((Date.now() - Date.parse(lastCopy)) / 86400000) : null;
  return [
    { label: "BIR details for invoices and receipts", done: birDone, detail: "Registered name, TIN, address, permit no. and number series.", to: "/bir-books" },
    { label: "Payment instructions for reminders", done: !!(b?.payment_instructions as string | null)?.trim(), detail: "Bank account or check payee, added to every overdue reminder. Set it from Collections → Draft reminder.", to: "/collections" },
    { label: "Storage and demurrage rates", done: ratesDone, detail: "Daily rates for the port and the shipping lines, so the pesos running can be shown.", to: "/alerts#free-time" },
    { label: "Duty rate table", done: (rates.count ?? 0) >= 5, detail: `${rates.count ?? 0} tariff code(s) so far. Save codes from the duty lines as you work.`, to: "/duty-rates" },
    { label: "Client status updates", done: (clients.count ?? 0) > 0, detail: "Turn on emails or the client page for the clients who want them.", to: "/clients" },
    { label: "Email service key", done: statuses.includes("sent") ? true : statuses.length ? false : null, detail: "Add RESEND_API_KEY in Supabase → Edge Functions → Secrets; confirmed here once the first email is sent." },
    { label: "Weekly off-site copy", done: copyAge != null && copyAge < 7, detail: copyAge == null ? "None saved yet." : `Last one ${copyAge} day(s) ago.`, to: "/security" },
    { label: "Leaked-password protection", done: null, detail: "Switch on in Supabase → Authentication → Passwords. The app cannot check this one." },
  ];
}

function SetupList({ checks }: { checks: Check[] }) {
  const left = checks.filter((c) => c.done === false).length;
  return (
    <section className="card setup">
      <h2>Getting set up <span className="count">{left} to do</span></h2>
      <ul className="setup-list">
        {checks.map((c) => (
          <li key={c.label} className={c.done ? "done" : c.done === false ? "todo" : "manual"}>
            <span className="setup-mark" aria-hidden="true">{c.done ? "✓" : c.done === false ? "○" : "?"}</span>
            <span><strong>{c.label}</strong>{c.done ? " · done" : c.done === null ? " · check yourself" : ""}
              <span className="muted small"> {c.detail}</span>
              {c.to && !c.done && <> <Link to={c.to}>Open</Link></>}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Charts (plain SVG) ----------

/** Rounded data-end (4px), square at the baseline. Horizontal bar from x=0. */
const hbar = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h / 2);
  return w <= 0 ? "" : `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
};
/** Rounded top (4px), square at the baseline. Column standing on y = base. */
const vbar = (x: number, base: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return h <= 0 ? "" : `M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + w - r}Q${x + w},${base - h} ${x + w},${base - h + r}V${base}Z`;
};

function StepBars({ data }: { data: { step: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520, label = 150, row = 30, bar = 16, H = data.length * row + 4;
  const max = Math.max(1, ...data.map((d) => d.count));
  const span = W - label - 56;
  return (
    <div className="viz">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={"Shipments by step: " + data.map((d) => `${STATUS_LABEL[d.step as keyof typeof STATUS_LABEL]} ${d.count}`).join(", ")}>
        <line x1={label} x2={label} y1={0} y2={H} className="viz-axis" />
        {data.map((d, i) => {
          const y = i * row + (row - bar) / 2;
          const w = (d.count / max) * span;
          return (
            <g key={d.step} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? "on" : ""}>
              <rect x={0} y={i * row} width={W} height={row} fill="transparent" />
              <text x={label - 8} y={y + bar / 2} className="viz-label" textAnchor="end" dominantBaseline="middle">{STATUS_LABEL[d.step as keyof typeof STATUS_LABEL]}</text>
              <path d={hbar(label, y, w, bar)} className="viz-s1" />
              <text x={label + w + 6} y={y + bar / 2} className="viz-value" dominantBaseline="middle">{d.count}</text>
            </g>
          );
        })}
      </svg>
      <p className="muted small"><Link to="/">Open the status board</Link> to see the shipments in each step.</p>
    </div>
  );
}

function Trend({ data }: { data: MonthMoney[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 620, H = 260, left = 56, right = 8, top = 12, bottom = 26;
  const top_ = niceMax(Math.max(...data.map((d) => Math.max(d.billed, d.collected))));
  const plotH = H - top - bottom, slot = (W - left - right) / data.length;
  const bw = Math.min(14, (slot - 8) / 2), gap = 2;
  const y = (v: number) => (v / top_) * plotH;
  const base = top + plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top_);
  const h = hover == null ? null : data[hover];
  return (
    <div className="viz">
      <div className="row spread wrap viz-head">
        <div className="viz-legend" aria-hidden="true">
          <span><i className="sw viz-s1" /> Billed</span><span><i className="sw viz-s2" /> Collected</span>
        </div>
        <button type="button" className="link small" onClick={() => setTable(!table)}>{table ? "Show chart" : "Show as table"}</button>
      </div>
      {table ? (
        <div className="table-scroll">
          <table className="small">
            <thead><tr><th>Month</th><th className="num">Billed</th><th className="num">Collected</th></tr></thead>
            <tbody>{[...data].reverse().map((d) => <tr key={d.month}><td>{monthLabel(d.month, true)}</td><td className="num">{peso(d.billed)}</td><td className="num">{peso(d.collected)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="viz-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={"Billed and collected by month: " + data.map((d) => `${monthLabel(d.month, true)} billed ${peso(d.billed)}, collected ${peso(d.collected)}`).join("; ")}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={W - right} y1={base - y(t)} y2={base - y(t)} className={t === 0 ? "viz-axis" : "viz-grid"} />
                <text x={left - 6} y={base - y(t)} className="viz-tick" textAnchor="end" dominantBaseline="middle">{shortPeso(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = left + slot * i + slot / 2;
              return (
                <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={left + slot * i} y={top} width={slot} height={plotH} className={hover === i ? "viz-band on" : "viz-band"} />
                  <path d={vbar(cx - bw - gap / 2, base, bw, y(d.billed))} className="viz-s1" />
                  <path d={vbar(cx + gap / 2, base, bw, y(d.collected))} className="viz-s2" />
                  <text x={cx} y={H - 8} className="viz-tick" textAnchor="middle">{monthLabel(d.month)}</text>
                </g>
              );
            })}
          </svg>
          {h && hover != null && (
            <div className="viz-tip" style={{ left: `${Math.min(86, Math.max(14, ((left + slot * hover + slot / 2) / W) * 100))}%` }} role="status">
              <strong>{monthLabel(h.month, true)}</strong>
              <span><i className="sw viz-s1" /> Billed {peso(h.billed)}</span>
              <span><i className="sw viz-s2" /> Collected {peso(h.collected)}</span>
            </div>
          )}
        </div>
      )}
      <p className="muted small">Billed by billed date (services, VAT and advances); collected by payment date, tax withheld (2307) included.</p>
    </div>
  );
}
