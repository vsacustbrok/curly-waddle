// Daily summary of documents received, and a summary of shipments per client.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { fetchAll, supabase } from "../lib/supabase";
import { ENTRY_COLORS, ENTRY_STATUSES, STATUSES, STATUS_LABEL, dayLabel, pretty, type Job, type JobStatus } from "../lib/types";
import { today } from "./JobFields";
import { useAuth } from "../lib/auth";
import LodgeCsv from "./LodgeCsv";

type Doc = { id: string; doc_type: string; file_name: string; uploaded_at: string; extract_error: string | null; extracted: unknown;
  jobs: { id: string; job_no: string; clients: { name: string } | null } | null };

/** The start and end of a calendar day in the viewer's time zone, as timestamps. */
function dayRange(d: string) {
  const start = new Date(d + "T00:00:00");
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

function DocumentsReceived() {
  const [day, setDay] = useState(today());
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const [from, to] = dayRange(day);
    supabase.from("job_documents")
      .select("id, doc_type, file_name, uploaded_at, extract_error, extracted, jobs(id, job_no, clients(name))")
      .gte("uploaded_at", from).lt("uploaded_at", to).order("uploaded_at")
      .then(({ data, error }) => {
        setError(error?.message ?? "");
        setDocs((data as unknown as Doc[]) ?? []);
        setLoading(false);
      });
  }, [day]);

  const groups = useMemo(() => {
    const map = new Map<string, { job: Doc["jobs"]; docs: Doc[] }>();
    for (const d of docs) {
      const k = d.jobs?.id ?? "none";
      map.set(k, { job: d.jobs, docs: [...(map.get(k)?.docs ?? []), d] });
    }
    return [...map.values()];
  }, [docs]);
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of docs) m.set(d.doc_type, (m.get(d.doc_type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [docs]);
  const step = (n: number) => { const d = new Date(day + "T00:00:00"); d.setDate(d.getDate() + n); setDay(d.toLocaleDateString("en-CA")); };

  return (
    <section className="card">
      <div className="row spread">
        <h2>Documents received</h2>
        <div className="row">
          <button className="ghost small" onClick={() => step(-1)}>‹ Previous day</button>
          <input type="date" value={day} max={today()} aria-label="Day"
            onChange={(e) => setDay(e.target.value || today())}
            onKeyDown={(e) => { if (e.key !== "Tab") e.preventDefault(); }}
            onClick={(e) => e.currentTarget.showPicker?.()} />
          <button className="ghost small" onClick={() => step(1)} disabled={day >= today()}>Next day ›</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Loading…</p> : docs.length === 0 ? <p className="muted">No documents were received on {dayLabel(day)}.</p> : (
        <>
          <p>
            <strong>{docs.length} document file(s)</strong> received on {dayLabel(day)} for {groups.length} shipment(s):{" "}
            {byType.map(([t, c]) => `${c} ${pretty(t)}`).join(", ")}.
          </p>
          <table>
            <thead><tr><th>Shipment</th><th>Client</th><th>Time</th><th>Document</th><th>File</th><th>Reading</th></tr></thead>
            <tbody>
              {groups.flatMap(({ job, docs }) => docs.map((d, i) => (
                <tr key={d.id}>
                  <td>{i === 0 && (job ? <Link to={`/jobs/${job.id}`}>{job.job_no}</Link> : "—")}</td>
                  <td>{i === 0 && job?.clients?.name}</td>
                  <td className="nowrap muted small">{new Date(d.uploaded_at).toLocaleTimeString(undefined, { timeStyle: "short" })}</td>
                  <td>{pretty(d.doc_type)}</td>
                  <td>{d.file_name}</td>
                  <td>{d.extract_error ? <span className="error">Failed</span> : d.extracted ? <span className="ok">Read</span> : <span className="muted">Not read yet</span>}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

const OPEN: JobStatus[] = STATUSES.filter((s) => s !== "delivered" && s !== "billed");

function PerClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetchAll<Job>((a, b) => supabase.from("jobs").select("id, job_no, client_id, status, eta, bl_awb_no, entry_status, clients(name)")
      .order("eta", { ascending: true, nullsFirst: false }).order("id").range(a, b) as never)
      .then((rows) => { setError(""); setJobs(rows); }, (e: Error) => setError(e.message));
  }, []);

  const clients = useMemo(() => {
    const map = new Map<string, { name: string; jobs: Job[] }>();
    for (const j of jobs) {
      const name = j.clients?.name ?? "—";
      map.set(j.client_id, { name, jobs: [...(map.get(j.client_id)?.jobs ?? []), j] });
    }
    return [...map.entries()].sort((a, b) => b[1].jobs.length - a[1].jobs.length || a[1].name.localeCompare(b[1].name));
  }, [jobs]);

  return (
    <section className="card">
      <h2>Shipments per client</h2>
      {error && <p className="error">{error}</p>}
      {clients.length === 0 ? <p className="muted">No shipments yet.</p> : (
        <table>
          <thead>
            <tr><th>Client</th><th className="num">Total</th><th className="num">Open</th>
              {STATUSES.map((s) => <th key={s} className="num">{STATUS_LABEL[s]}</th>)}<th></th></tr>
          </thead>
          <tbody>
            {clients.map(([id, c]) => {
              const count = (s: JobStatus) => c.jobs.filter((j) => j.status === s).length;
              return [
                <tr key={id}>
                  <td><strong>{c.name}</strong></td>
                  <td className="num">{c.jobs.length}</td>
                  <td className="num">{c.jobs.filter((j) => OPEN.includes(j.status)).length}</td>
                  {STATUSES.map((s) => <td key={s} className="num">{count(s) || ""}</td>)}
                  <td className="right"><button className="link" onClick={() => setOpen(open === id ? null : id)}>{open === id ? "Hide" : "Show"}</button></td>
                </tr>,
                open === id && (
                  <tr key={id + "-list"}><td colSpan={STATUSES.length + 4}>
                    <ul className="plain">
                      {c.jobs.map((j) => (
                        <li key={j.id}>
                          <Link to={`/jobs/${j.id}`}>{j.job_no}</Link> · {STATUS_LABEL[j.status]}
                          {j.eta ? ` · ETA ${dayLabel(j.eta)}` : ""}{j.bl_awb_no ? ` · BL ${j.bl_awb_no}` : ""}
                          {j.entry_status ? ` · entry ${pretty(j.entry_status).toLowerCase()}` : ""}
                        </li>
                      ))}
                    </ul>
                  </td></tr>
                ),
              ];
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

type Report = { id: number; user_id: string; report_date: string; body: string; author_name: string | null; updated_at: string };
type Activity = { notes: { body: string; jobs: { id: string; job_no: string } | null }[]; docs: { file_name: string; doc_type: string; jobs: { id: string; job_no: string } | null }[] };

/** Each person's own report for the day, with what the app already knows they did. The owner also reads everyone's. */
function MyDailyReport() {
  const { profile } = useAuth();
  const me = profile!;
  const [day, setDay] = useState(today());
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<Report | null>(null);
  const [team, setTeam] = useState<Report[]>([]);
  const [activity, setActivity] = useState<Activity>({ notes: [], docs: [] });
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [from, to] = dayRange(day);
    const [mine, all, notes, docs] = await Promise.all([
      supabase.from("user_reports").select("*").eq("user_id", me.id).eq("report_date", day).maybeSingle(),
      me.role === "owner" ? supabase.from("user_reports").select("*").eq("report_date", day).order("author_name") : Promise.resolve({ data: [] }),
      supabase.from("job_notes").select("body, jobs(id, job_no)").eq("author_id", me.id).eq("note_date", day).order("id"),
      supabase.from("job_documents").select("file_name, doc_type, jobs(id, job_no)").eq("uploaded_by", me.id).gte("uploaded_at", from).lt("uploaded_at", to).order("uploaded_at"),
    ]);
    const r = (mine.data as Report | null) ?? null;
    setSaved(r);
    setText(r?.body ?? "");
    setTeam(((all.data as Report[]) ?? []).filter((x) => x.user_id !== me.id));
    setActivity({ notes: (notes.data as unknown as Activity["notes"]) ?? [], docs: (docs.data as unknown as Activity["docs"]) ?? [] });
  }, [day, me.id, me.role]);
  useEffect(() => { setMsg(null); load(); }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (!confirm(saved ? `Update your report for ${dayLabel(day)}?` : `Save your report for ${dayLabel(day)}?`)) return;
    setBusy(true);
    const { error } = await supabase.from("user_reports").upsert({ user_id: me.id, report_date: day, body: text.trim() }, { onConflict: "user_id,report_date" });
    setBusy(false);
    setMsg(error ? { kind: "error", text: error.message } : { kind: "ok", text: "Saved." });
    if (!error) load();
  }

  const changed = text.trim() !== (saved?.body ?? "");
  return (
    <section className="card">
      <div className="row spread">
        <h2>My daily report</h2>
        <input type="date" value={day} max={today()} aria-label="Report day"
          onChange={(e) => setDay(e.target.value || today())}
          onKeyDown={(e) => { if (e.key !== "Tab") e.preventDefault(); }}
          onClick={(e) => e.currentTarget.showPicker?.()} />
      </div>
      <p className="muted small">Only you{me.role === "owner" ? "" : " and the owner"} can read your report. Tap 🎤 Speak to say it instead of typing.</p>
      {(activity.notes.length > 0 || activity.docs.length > 0) && (
        <div className="activity">
          <strong className="small">What you did in the app on {dayLabel(day)}:</strong>
          <ul className="plain small">
            {activity.docs.length > 0 && <li>Uploaded {activity.docs.length} document(s): {activity.docs.map((d) => `${pretty(d.doc_type)} for ${d.jobs?.job_no ?? "?"}`).join(", ")}</li>}
            {activity.notes.map((n, i) => <li key={i}>Status update on {n.jobs?.job_no ?? "?"}: {n.body}</li>)}
          </ul>
          <button type="button" className="ghost small" onClick={() => setText((t) => [t.trim(), ...activity.docs.length ? [`Uploaded ${activity.docs.length} document(s): ${[...new Set(activity.docs.map((d) => d.jobs?.job_no ?? "?"))].join(", ")}.`] : [],
            ...activity.notes.map((n) => `${n.jobs?.job_no ?? "?"}: ${n.body}`)].filter(Boolean).join("\n"))}>Add these to my report</button>
        </div>
      )}
      <form onSubmit={save}>
        <textarea rows={5} className="report-text" value={text} onChange={(e) => setText(e.target.value)} aria-label="My report"
          placeholder="What did you work on today? Shipments handled, entries filed, follow-ups for tomorrow…" />
        <div className="row">
          <button disabled={busy || !text.trim() || !changed}>{busy ? "Saving…" : saved ? "Update report" : "Save report"}</button>
          {saved && <span className="muted small">Last saved {new Date(saved.updated_at).toLocaleString()}</span>}
          {msg && <span className={msg.kind}>{msg.text}</span>}
        </div>
      </form>
      {me.role === "owner" && (
        <>
          <h3 className="sub">Team reports for {dayLabel(day)}</h3>
          {team.length === 0 ? <p className="muted">No one else has saved a report for this day.</p> : (
            <ul className="note-log">
              {team.map((r) => (
                <li key={r.id}>
                  <div className="note-day">{r.author_name ?? "unknown"}</div>
                  <div className="note-body"><span className="pre">{r.body}</span>
                    <span className="muted small"> · saved {new Date(r.updated_at).toLocaleTimeString(undefined, { timeStyle: "short" })}</span></div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Entries lodged in a month: filing date, entry and ticket numbers, status, colour, and SAD / SSDT. */
function EntryLodgement() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  useEffect(() => {
    supabase.from("jobs")
      .select("id, job_no, entry_no, entry_filed_date, ticket_no, entry_status, entry_color, final_sad_sent, final_sad_sent_date, ssdt_sent, ssdt_sent_date, status, clients(name)")
      .gte("entry_filed_date", first).lte("entry_filed_date", last).order("entry_filed_date").order("job_no")
      .then(({ data, error }) => { setError(error?.message ?? ""); setJobs((data as unknown as Job[]) ?? []); });
  }, [first, last]);

  const count = (pred: (j: Job) => boolean) => jobs.filter(pred).length;
  const title = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shift = (n: number) => { const d = new Date(y, m - 1 + n, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };

  async function exportXlsx() {
    setBusy(true);
    try {
      const { default: writeExcelFile } = await import("write-excel-file/browser");
      const t = (v: string | null | undefined) => (v ? { value: v, type: String } : null);
      const d = (v: string | null) => (v ? { value: new Date(v + "T00:00:00Z"), type: Date, format: "yyyy-mm-dd" } : null);
      const cols: [string, number, (j: Job) => unknown][] = [
        ["Filed on", 12, (j) => d(j.entry_filed_date)], ["PN", 16, (j) => t(j.job_no)], ["Client", 30, (j) => t(j.clients?.name)],
        ["Entry no.", 18, (j) => t(j.entry_no)], ["Ticket no.", 16, (j) => t(j.ticket_no)],
        ["Entry status", 12, (j) => t(j.entry_status ? pretty(j.entry_status) : null)], ["Entry color", 11, (j) => t(j.entry_color ? pretty(j.entry_color) : null)],
        ["Final SAD sent", 14, (j) => (j.final_sad_sent ? d(j.final_sad_sent_date) ?? t("Yes") : t("No"))],
        ["SSDT sent", 12, (j) => (j.ssdt_sent ? d(j.ssdt_sent_date) ?? t("Yes") : t("No"))], ["Shipment status", 14, (j) => t(STATUS_LABEL[j.status])],
      ];
      const data = [cols.map(([h]) => ({ value: h, fontWeight: "bold" as const })), ...jobs.map((j) => cols.map(([, , g]) => g(j)))];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await writeExcelFile(data as any, { columns: cols.map(([, w]) => ({ width: w })), stickyRowsCount: 1, sheet: "Entries" }).toFile(`VSA entry lodgement ${month}.xlsx`);
    } catch (e) {
      setError(`Could not create the spreadsheet: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  return (
    <section className="card">
      <div className="row spread">
        <h2>Entry lodgement summary</h2>
        <div className="row">
          <button className="ghost small" onClick={() => shift(-1)}>‹ Prev</button>
          <strong className="cal-title">{title}</strong>
          <button className="ghost small" onClick={() => shift(1)}>Next ›</button>
          <button className="small" disabled={busy || jobs.length === 0} onClick={exportXlsx}>{busy ? "Preparing…" : "Export to Excel"}</button>
        </div>
      </div>
      <p className="muted small">Entries are counted by their entry filing date. Set it in each shipment's project details.</p>
      {error && <p className="error">{error}</p>}
      <div className="row stat-row">
        <span className="stat"><strong>{jobs.length}</strong> lodged</span>
        {ENTRY_STATUSES.map((st) => <span key={st} className="stat"><strong>{count((j) => j.entry_status === st)}</strong> {pretty(st).toLowerCase()}</span>)}
        {ENTRY_COLORS.map((c) => <span key={c} className={"entry-color " + c}>{count((j) => j.entry_color === c)} {pretty(c)}</span>)}
        <span className="stat"><strong>{count((j) => j.final_sad_sent)}</strong> final SAD sent</span>
        <span className="stat"><strong>{count((j) => j.ssdt_sent)}</strong> SSDT sent</span>
      </div>
      {jobs.length === 0 ? <p className="muted">No entries with a filing date in {title}.</p> : (
        <table>
          <thead><tr><th>Filed on</th><th>PN</th><th>Client</th><th>Entry no.</th><th>Ticket no.</th><th>Status</th><th>Color</th><th>Final SAD</th><th>SSDT</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="nowrap">{dayLabel(j.entry_filed_date)}</td>
                <td><Link to={`/jobs/${j.id}`}>{j.job_no}</Link></td>
                <td>{j.clients?.name}</td>
                <td>{j.entry_no}</td>
                <td>{j.ticket_no}</td>
                <td>{j.entry_status ? pretty(j.entry_status) : "—"}</td>
                <td>{j.entry_color ? <span className={"entry-color " + j.entry_color}>{pretty(j.entry_color)}</span> : "—"}</td>
                <td className="nowrap">{j.final_sad_sent ? dayLabel(j.final_sad_sent_date) ?? "Yes" : "—"}</td>
                <td className="nowrap">{j.ssdt_sent ? dayLabel(j.ssdt_sent_date) ?? "Yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function Reports() {
  return (
    <>
      <h1>Reports</h1>
      <MyDailyReport />
      <DocumentsReceived />
      <EntryLodgement />
      <LodgeCsv />
      <PerClient />
    </>
  );
}
