// Daily lodge summary as a CSV file: a blank template, an export of the app's shipments in the
// office sheet's columns, and an import that turns each sheet row into a shipment.
import { useState, type ChangeEvent } from "react";
import { fetchAll, supabase } from "../lib/supabase";
import { LODGE_HEADERS, lodgeSheet, pnFor, readLodgeSheet, toCsv, type SheetRow } from "../lib/lodgeCsv";
import { STATUSES, type Job, type JobStatus } from "../lib/types";
import { useAuth } from "../lib/auth";
import { today } from "./JobFields";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Existing = { id: string; job_no: string; status: JobStatus; containers: string[] | null; entry_filed_date: string | null };
type Planned = { row: SheetRow; pn: string; existing: Existing | null; clientId: string | null; newClient: string | null };
type Plan = { items: Planned[]; newClients: string[]; fileName: string };
type Result = { created: number; updated: number; clients: number; failed: { line: number; pn: string; message: string }[] };

const rank = (s: JobStatus) => STATUSES.indexOf(s);

/** Edits needed to turn one name into the other, counting a swapped pair of letters as one. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** The same name with a typo or different spacing: AM-PHIL / AMPHIL, KITCHENOMICS / KITCHENOMISC. */
function sameName(a: string, b: string): boolean {
  const x = compact(a), y = compact(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const len = Math.min(x.length, y.length);
  const d = Math.abs(x.length - y.length) > 2 ? 9 : distance(x, y);
  return (len >= 6 && d <= 1) || (len >= 9 && d <= 2);
}
const extends_ = (long: string, short: string) => long.toUpperCase().startsWith(short.toUpperCase() + " ");

/**
 * The client each row belongs to. The letters at the front of a PRO are the client's code
 * (HCC, HNC, KMT...), so names under one code that are a typo or a longer form of each other
 * are one client: HEXAGON under HCC is HEXAGON CHEMICAL, KITCHENOMISC is KITCHENOMICS. The
 * name is then matched with the clients already saved, so HEXAGON NUTRIFOOD finds
 * HEXAGON NUTRIFOOD CORPORATION.
 */
function assignClients(rows: SheetRow[], clients: { id: string; name: string }[]) {
  const groups = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const code = r.pro.match(/^[A-Z]+/)?.[0] ?? "";
    const g = groups.get(code) ?? new Map<string, number>();
    g.set(r.clientName, (g.get(r.clientName) ?? 0) + 1);
    groups.set(code, g);
  }
  const planned: string[] = []; // new clients, by name
  type Target = { id: string | null; create: string | null };
  const done = new Map<string, Target>(); // names already placed, written without spaces or punctuation (D'METER = D METER)
  const resolve = (name: string): Target => {
    const key = compact(name);
    if (key && done.has(key)) return done.get(key)!;
    const t = place(name);
    if (key) done.set(key, t);
    return t;
  };
  const place = (name: string): Target => {
    if (!name) {
      const un = clients.find((c) => /^unassigned/i.test(c.name));
      if (un) return { id: un.id, create: null };
      if (!planned.includes("UNASSIGNED (TO BE CONFIRMED)")) planned.push("UNASSIGNED (TO BE CONFIRMED)");
      return { id: null, create: "UNASSIGNED (TO BE CONFIRMED)" };
    }
    const hit = clients.find((c) => compact(c.name) === compact(name)) ?? clients.find((c) => sameName(c.name, name));
    if (hit) return { id: hit.id, create: null };
    const longer = [...clients.filter((c) => extends_(c.name, name)).map((c) => c.name), ...planned.filter((p) => extends_(p, name))];
    if (longer.length === 1) {
      const c = clients.find((x) => x.name === longer[0]);
      return c ? { id: c.id, create: null } : { id: null, create: longer[0] };
    }
    const again = planned.find((p) => sameName(p, name));
    if (again) return { id: null, create: again };
    planned.push(name);
    return { id: null, create: name };
  };
  const nameFor = new Map<string, { id: string | null; create: string | null }>(); // "code|name" → client
  // Codes with the most rows first, so the common spelling becomes the client's name.
  const order = [...groups.entries()].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0));
  for (const [code, counts] of order) {
    const names = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const clusters: [string, number][][] = [];
    for (const n of names) {
      // A longer form written once is usually the item spilling into the name ("KITCHENOMICS PORK BACK FAT RIND ON");
      // one written more often is a client of its own (HEXAGON CHEMICAL).
      const home = clusters.find((cl) => cl.some(([m]) => sameName(m, n[0]) || (code && n[1] === 1 && extends_(n[0], m))));
      if (home) home.push(n); else clusters.push([n]);
    }
    for (const cl of clusters) {
      const target = resolve(cl[0][0]); // the most used spelling
      for (const [m] of cl) nameFor.set(`${code}|${m}`, target);
    }
  }
  return { clientFor: (r: SheetRow) => nameFor.get(`${r.pro.match(/^[A-Z]+/)?.[0] ?? ""}|${r.clientName}`)!, newClients: planned };
}

/** Works out, without saving anything, which rows become new shipments and which update existing ones. */
async function makePlan(rows: SheetRow[], year: number, addYear: boolean, fileName: string): Promise<Plan> {
  const [clients, jobs] = await Promise.all([
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from("clients").select("id, name").order("name").range(a, b)),
    fetchAll<Existing>((a, b) => supabase.from("jobs").select("id, job_no, status, containers, entry_filed_date").order("job_no").range(a, b)),
  ]);
  const byNo = new Map(jobs.map((j) => [j.job_no.toUpperCase(), j]));
  const { clientFor, newClients } = assignClients(rows, clients);
  const seen = new Map<string, number>();
  const items = rows.map((row): Planned => {
    let pn = addYear ? pnFor(row.pro, row.lodgeDate, year) : row.pro;
    if (pn) {
      // The same PRO twice in one file: each row stays its own shipment, numbered -2, -3...
      const n = (seen.get(pn) ?? 0) + 1;
      seen.set(pn, n);
      if (n > 1) pn = `${pn}-${n}`;
    }
    const c = clientFor(row);
    return { row, pn, existing: pn ? byNo.get(pn) ?? null : null, clientId: c.id, newClient: c.create };
  });
  return { items, newClients: [...newClients].sort(), fileName };
}

async function runPlan(plan: Plan, onProgress: (done: number) => void): Promise<Result> {
  const result: Result = { created: 0, updated: 0, clients: 0, failed: [] };
  const clientIds = new Map<string, string>();
  for (let i = 0; i < plan.newClients.length; i += 200) {
    const { data, error } = await supabase.from("clients").insert(plan.newClients.slice(i, i + 200).map((name) => ({ name }))).select("id, name");
    if (error) throw new Error(`Could not add the new clients: ${error.message}`);
    for (const c of data ?? []) clientIds.set(c.name, c.id);
    result.clients += data?.length ?? 0;
  }

  const inserts: { item: Planned; values: Record<string, unknown> }[] = [];
  let done = 0;
  for (const item of plan.items) {
    const { row, existing } = item;
    const hasEntry = !!row.fields.entry_no;
    const target: JobStatus = hasEntry ? row.stage ?? "lodged" : "pre_arrival";
    // The day the row sits under on the sheet is the day it was lodged.
    const filed = row.lodgeDate || null;
    if (existing) {
      // Only cells with something in them are copied over; a blank cell never wipes saved details.
      const values: Record<string, unknown> = { ...row.fields };
      const merged = [...new Set([...(existing.containers ?? []), ...row.containers])];
      if (merged.length !== (existing.containers ?? []).length) values.containers = merged;
      if (!existing.entry_filed_date && filed) values.entry_filed_date = filed;
      if (rank(target) > rank(existing.status) && (hasEntry || existing.status !== "pre_arrival")) values.status = target;
      const { error } = await supabase.from("jobs").update(values).eq("id", existing.id);
      if (error) result.failed.push({ line: row.line, pn: item.pn, message: error.message }); else result.updated++;
      onProgress(++done);
    } else {
      inserts.push({ item, values: {
        ...(item.pn ? { job_no: item.pn } : {}),
        client_id: item.clientId ?? clientIds.get(item.newClient!),
        ...row.fields, containers: row.containers, entry_filed_date: filed, status: target,
      } });
    }
  }
  for (let i = 0; i < inserts.length; i += 200) {
    const batch = inserts.slice(i, i + 200);
    const { error } = await supabase.from("jobs").insert(batch.map((b) => b.values));
    if (!error) { result.created += batch.length; done += batch.length; onProgress(done); continue; }
    // One bad row should not hold back the other 199: try them one at a time to find it.
    for (const b of batch) {
      const { error: e } = await supabase.from("jobs").insert(b.values);
      if (e) result.failed.push({ line: b.item.row.line, pn: b.item.pn || "(new PN)", message: e.message }); else result.created++;
      onProgress(++done);
    }
  }
  return result;
}

export default function LodgeCsv() {
  const { profile } = useAuth();
  const canImport = profile!.role === "owner" || profile!.role === "processor";
  const thisYear = new Date().getFullYear();
  const [from, setFrom] = useState(`${thisYear}-01-01`);
  const [to, setTo] = useState(today());
  const [withUnlodged, setWithUnlodged] = useState(true);
  const [year, setYear] = useState(thisYear);
  const [addYear, setAddYear] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  async function doExport() {
    setBusy("export"); setError("");
    try {
      const filed = await fetchAll<Job>((a, b) => supabase.from("jobs").select("*, clients(name)")
        .gte("entry_filed_date", from).lte("entry_filed_date", to).order("entry_filed_date").range(a, b));
      const unlodged = withUnlodged ? await fetchAll<Job>((a, b) => supabase.from("jobs").select("*, clients(name)")
        .is("entry_filed_date", null).order("job_no").range(a, b)) : [];
      download(`VSA daily lodge ${from} to ${to}.csv`, toCsv(lodgeSheet([...filed, ...unlodged])));
    } catch (e) { setError(`Could not export: ${(e as Error).message}`); }
    setBusy("");
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(""); setResult(null); setPlan(null);
    if (/\.xlsx?$/i.test(file.name)) { setError("This is an Excel file. In Excel choose File › Save As › CSV (Comma delimited), then pick the .csv file here."); return; }
    setBusy("read");
    try {
      const { rows, error } = readLodgeSheet(await file.text(), year);
      if (error) { setError(error); setBusy(""); return; }
      setWarnings(rows.flatMap((r) => r.warnings.map((w) => `Row ${r.line}: ${w}`)));
      setPlan(await makePlan(rows, year, addYear, file.name));
    } catch (err) { setError(`Could not read the file: ${(err as Error).message}`); }
    setBusy("");
  }

  async function confirmImport() {
    if (!plan) return;
    setBusy("import"); setProgress(0); setError("");
    try {
      setResult(await runPlan(plan, setProgress));
      setPlan(null);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  const adds = plan?.items.filter((i) => !i.existing).length ?? 0;
  const updates = (plan?.items.length ?? 0) - adds;

  return (
    <section className="card">
      <h2>Daily lodge summary (CSV)</h2>
      <p className="muted small">Same columns as the office sheet: {LODGE_HEADERS.filter(Boolean).join(", ")}. Opens in Excel and Google Sheets.</p>

      <div className="row wrap">
        <button type="button" className="ghost" onClick={() => download("VSA daily lodge template.csv", toCsv([[...LODGE_HEADERS]]))}>Download blank template</button>
      </div>

      <h3>Export</h3>
      <div className="row wrap">
        <label>Lodged from<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>to<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={withUnlodged} onChange={(e) => setWithUnlodged(e.target.checked)} /> Include shipments not lodged yet</label>
        <button type="button" onClick={doExport} disabled={!!busy || !from || !to}>{busy === "export" ? "Preparing…" : "Export CSV"}</button>
      </div>

      {canImport && (
        <>
          <h3>Import</h3>
          <p className="muted small">
            Each row becomes its own shipment. A row whose PRO is already in the app updates that shipment, and blank cells never erase what is saved.
            Day lines such as "01/05 - MONDAY" set the date the entry was lodged. Nothing is saved until you confirm.
          </p>
          <div className="row wrap">
            <label>Year of the sheet<input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(+e.target.value || thisYear)} style={{ width: "6em" }} /></label>
            <label className="check"><input type="checkbox" checked={addYear} onChange={(e) => setAddYear(e.target.checked)} /> Add the year to each PRO (HCC04-225 → HCC04-225-{String(year).slice(-2)})</label>
            <label className="button-like">{busy === "read" ? "Reading…" : "Choose CSV file…"}
              <input type="file" accept=".csv,text/csv,.xlsx,.xls" onChange={pickFile} disabled={!!busy} hidden aria-label="Choose CSV file" />
            </label>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}

      {plan && (
        <div className="import-plan">
          <p><strong>{plan.fileName}</strong>: {plan.items.length} rows. <strong>{adds}</strong> new shipments, <strong>{updates}</strong> updates to shipments already in the app
            {plan.newClients.length > 0 && <>, and <strong>{plan.newClients.length}</strong> new clients</>}.</p>
          {plan.newClients.length > 0 && <p className="small">New clients: {plan.newClients.join(", ")}</p>}
          {warnings.length > 0 && (
            <details><summary>{warnings.length} note(s) about the file</summary><ul className="small">{warnings.slice(0, 200).map((w) => <li key={w}>{w}</li>)}</ul></details>
          )}
          <table className="wide-table small">
            <thead><tr><th>Row</th><th>PN</th><th>Client</th><th>Entry no.</th><th>Lodged</th><th>Action</th></tr></thead>
            <tbody>
              {plan.items.slice(0, 15).map((i) => (
                <tr key={i.row.line}>
                  <td>{i.row.line}</td><td>{i.pn || "(new PN)"}</td><td>{i.row.clientName}</td><td>{i.row.fields.entry_no}</td>
                  <td>{i.row.lodgeDate}</td><td>{i.existing ? "Update" : "New"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.items.length > 15 && <p className="muted small">…and {plan.items.length - 15} more rows.</p>}
          <div className="row">
            <button type="button" onClick={confirmImport} disabled={!!busy}>{busy === "import" ? `Saving… ${progress} of ${plan.items.length}` : `Confirm and import ${plan.items.length} rows`}</button>
            <button type="button" className="ghost" onClick={() => setPlan(null)} disabled={!!busy}>Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div className="import-result" role="status">
          <p className="ok">Import finished: {result.created} new shipments, {result.updated} updated{result.clients ? `, ${result.clients} new clients` : ""}.</p>
          {result.failed.length > 0 && (
            <>
              <p className="error">{result.failed.length} row(s) could not be saved:</p>
              <ul className="small">{result.failed.slice(0, 100).map((f) => <li key={f.line}>Row {f.line} ({f.pn}): {f.message}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
