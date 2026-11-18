// The office's duty rate table (AHTN code, MFN rate, FTA rates) and the fee settings used by the duties
// and taxes computation. Everyone in the office can look; only the owner changes them.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { DEFAULT_SETTINGS, normAhtn, showAhtn, type DutySettings } from "../lib/duties";
import { loadDutySettings, type TariffRate } from "./Duties";

const FTA_FORMS = ["Form E (ACFTA)", "ATIGA Form D", "AJCEP", "AKFTA", "RCEP", "PJEPA"];
const blank = { ahtn: "", description: "", mfn: "", fta: "", note: "" };
/** "Form E (ACFTA)=0; ATIGA Form D=0" <-> {"Form E (ACFTA)": 0, ...} */
const ftaText = (o: Record<string, number>) => Object.entries(o ?? {}).map(([k, v]) => `${k}=${v}`).join("; ");
function ftaParse(t: string): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const part of t.split(/[;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\s*[=:]\s*([\d.]+)\s*%?$/);
    if (!m) return null;
    out[m[1].trim()] = Number(m[2]);
  }
  return out;
}

export default function DutyRates() {
  const { profile } = useAuth();
  const owner = profile?.role === "owner";
  const [rows, setRows] = useState<TariffRate[]>([]);
  const [form, setForm] = useState(blank);
  const [q, setQ] = useState("");
  const [settings, setSettings] = useState<DutySettings>(DEFAULT_SETTINGS);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("tariff_rates").select("*").order("ahtn_code");
    setError(error?.message ?? "");
    setRows((data as TariffRate[]) ?? []);
    setSettings(await loadDutySettings());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveRate(e: FormEvent) {
    e.preventDefault();
    setError(""); setMsg("");
    const code = normAhtn(form.ahtn);
    if (!code) { setError("The AHTN code must be 8 digits, e.g. 0207.14.91"); return; }
    const mfn = Number(form.mfn.replace(/%/g, ""));
    if (!(mfn >= 0 && mfn <= 100)) { setError("Enter the MFN rate as a number from 0 to 100."); return; }
    const fta = ftaParse(form.fta);
    if (!fta) { setError('Write FTA rates like "Form E (ACFTA)=0; ATIGA Form D=5".'); return; }
    const { error } = await supabase.from("tariff_rates").upsert({ ahtn_code: code, description: form.description.trim() || null, mfn_rate: mfn, fta_rates: fta, note: form.note.trim() || null });
    if (error) { setError(error.message); return; }
    setForm(blank); setMsg(`Saved ${showAhtn(code)}.`); load();
  }
  async function remove(r: TariffRate) {
    if (!confirm(`Remove ${showAhtn(r.ahtn_code)} from the rate table?`)) return;
    const { error } = await supabase.from("tariff_rates").delete().eq("ahtn_code", r.ahtn_code);
    if (error) setError(error.message); else load();
  }
  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("duty_settings").update({ settings }).eq("id", true);
    setMsg(error ? "" : "Fees saved."); if (error) setError(error.message);
  }
  async function download() {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    const head = ["AHTN code", "Description", "MFN rate %", "FTA rates", "Note"].map((v) => ({ value: v, fontWeight: "bold" as const }));
    const t = (v: string | null) => (v ? { value: v, type: String } : null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (writeExcelFile as any)([head, ...rows.map((r) => [t(showAhtn(r.ahtn_code)), t(r.description), { value: Number(r.mfn_rate), type: Number }, t(ftaText(r.fta_rates)), t(r.note)])],
      { columns: [{ width: 14 }, { width: 50 }, { width: 12 }, { width: 40 }, { width: 30 }], sheet: "Duty rates" }).toFile("VSA duty rates.xlsx");
  }
  async function upload(file: File) {
    setError(""); setMsg("");
    try {
      const { default: readXlsx } = await import("read-excel-file");
      const sheet = await readXlsx(file);
      const out: { ahtn_code: string; description: string | null; mfn_rate: number; fta_rates: Record<string, number>; note: string | null }[] = [];
      const bad: number[] = [];
      sheet.slice(1).forEach((row, i) => {
        const code = normAhtn(String(row[0] ?? ""));
        const mfn = Number(row[2]);
        const fta = ftaParse(String(row[3] ?? ""));
        if (!code || !(mfn >= 0 && mfn <= 100) || !fta) { if (row.some((c) => c != null && c !== "")) bad.push(i + 2); return; }
        out.push({ ahtn_code: code, description: row[1] ? String(row[1]) : null, mfn_rate: mfn, fta_rates: fta, note: row[4] ? String(row[4]) : null });
      });
      if (out.length) {
        const { error } = await supabase.from("tariff_rates").upsert(out);
        if (error) { setError(error.message); return; }
      }
      setMsg(`${out.length} rate${out.length === 1 ? "" : "s"} imported.${bad.length ? ` Rows skipped (check them): ${bad.join(", ")}.` : ""}`);
      load();
    } catch (e) { setError(`Could not read the file: ${(e as Error).message}`); }
  }

  const needle = q.trim().toLowerCase().replace(/\./g, "");
  const shown = rows.filter((r) => !needle || r.ahtn_code.includes(needle) || (r.description ?? "").toLowerCase().includes(needle));
  const num = (v: string) => Number(v.replace(/,/g, "")) || 0;
  const setPort = (c: "40ft" | "20ft" | "lcl", k: "arr" | "whf", v: string) => setSettings({ ...settings, port: { ...settings.port, [c]: { ...settings.port[c], [k]: num(v) } } });

  return (
    <>
      <h1>Duty rates and fees</h1>
      <p className="muted">The rates and fees the duties and taxes computation uses. {owner ? "Keep them up to date with the Tariff Commission (finder.tariffcommission.gov.ph) and the latest CAOs." : "Only the owner can change them."}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {msg && <p className="ok-text" role="status">{msg}</p>}

      <section className="card">
        <div className="row spread wrap">
          <h2>AHTN rate table <span className="count">{rows.length}</span></h2>
          <div className="row wrap">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or description" aria-label="Search rates" />
            <button type="button" className="ghost" onClick={download} disabled={!rows.length}>Download Excel</button>
            {owner && <label className="filepick ghost-like">Import Excel<input type="file" accept=".xlsx" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} /></label>}
          </div>
        </div>
        {owner && <p className="muted small">Excel import: columns AHTN code, Description, MFN rate %, FTA rates (e.g. "Form E (ACFTA)=0; ATIGA Form D=0"), Note. Download the table first to get the layout.</p>}
        {owner && (
          <form className="grid" onSubmit={saveRate}>
            <label>AHTN code<input value={form.ahtn} onChange={(e) => setForm({ ...form, ahtn: e.target.value })} placeholder="0207.14.91" required /></label>
            <label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Frozen chicken cuts" /></label>
            <label>MFN rate %<input inputMode="decimal" value={form.mfn} onChange={(e) => setForm({ ...form, mfn: e.target.value })} required /></label>
            <label>FTA rates<input list="fta-forms" value={form.fta} onChange={(e) => setForm({ ...form, fta: e.target.value })} placeholder="Form E (ACFTA)=0; ATIGA Form D=0" /></label>
            <datalist id="fta-forms">{FTA_FORMS.map((f) => <option key={f} value={`${f}=`} />)}</datalist>
            <label>Note<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. EO no., excise applies" /></label>
            <div className="row" style={{ alignSelf: "end" }}><button>Save rate</button>{form.ahtn && <button type="button" className="ghost" onClick={() => setForm(blank)}>Clear</button>}</div>
          </form>
        )}
        {shown.length === 0 ? <p className="muted">{rows.length ? "No match." : "No rates yet."}</p> : (
          <div className="table-scroll">
            <table className="small">
              <thead><tr><th>AHTN code</th><th>Description</th><th className="num">MFN</th><th>FTA rates</th><th>Note</th><th></th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.ahtn_code}>
                    <td className="nowrap">{showAhtn(r.ahtn_code)}</td><td>{r.description}</td><td className="num">{Number(r.mfn_rate)}%</td>
                    <td>{ftaText(r.fta_rates)}</td><td>{r.note}</td>
                    <td className="nowrap">{owner && <>
                      <button type="button" className="link" onClick={() => setForm({ ahtn: showAhtn(r.ahtn_code), description: r.description ?? "", mfn: String(r.mfn_rate), fta: ftaText(r.fta_rates), note: r.note ?? "" })}>Edit</button>{" "}
                      <button type="button" className="link danger-text" onClick={() => remove(r)}>Remove</button>
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form className="card" onSubmit={saveSettings}>
        <h2>Fees and special rates</h2>
        <fieldset disabled={!owner}>
          <div className="grid">
            <label>CDS ₱<input inputMode="decimal" value={settings.cds} onChange={(e) => setSettings({ ...settings, cds: num(e.target.value) })} /></label>
            <label>IPF / IPC ₱ (formal)<input inputMode="decimal" value={settings.ipf} onChange={(e) => setSettings({ ...settings, ipf: num(e.target.value) })} /></label>
            <label>IRS ₱<input inputMode="decimal" value={settings.irs} onChange={(e) => setSettings({ ...settings, irs: num(e.target.value) })} /></label>
            <label>VAT %<input inputMode="decimal" value={Math.round(settings.vatRate * 10000) / 100} onChange={(e) => setSettings({ ...settings, vatRate: num(e.target.value) / 100 })} /></label>
            <label>Chicken safeguard trigger price (USD/kg)<input inputMode="decimal" value={settings.chickenTriggerPrice} onChange={(e) => setSettings({ ...settings, chickenTriggerPrice: num(e.target.value) })} /></label>
            <label>MAV pork in-quota %<input inputMode="decimal" value={settings.porkInRate} onChange={(e) => setSettings({ ...settings, porkInRate: num(e.target.value) })} /></label>
            <label>MAV pork out-of-quota %<input inputMode="decimal" value={settings.porkOutRate} onChange={(e) => setSettings({ ...settings, porkOutRate: num(e.target.value) })} /></label>
            <label>Beef in-quota %<input inputMode="decimal" value={settings.beefInRate ?? ""} onChange={(e) => setSettings({ ...settings, beefInRate: e.target.value.trim() ? num(e.target.value) : null })} placeholder="rate in force" /></label>
            <label>Beef out-of-quota %<input inputMode="decimal" value={settings.beefOutRate ?? ""} onChange={(e) => setSettings({ ...settings, beefOutRate: e.target.value.trim() ? num(e.target.value) : null })} placeholder="rate in force" /></label>
          </div>
          <h3>Standard arrastre and wharfage per container (₱)</h3>
          <div className="grid">
            {(["40ft", "20ft", "lcl"] as const).map((c) => (
              <div key={c} className="row">
                <label>{c === "lcl" ? "LCL" : c === "40ft" ? "40-foot" : "20-foot"} arrastre<input inputMode="decimal" value={settings.port[c].arr} onChange={(e) => setPort(c, "arr", e.target.value)} /></label>
                <label>wharfage<input inputMode="decimal" value={settings.port[c].whf} onChange={(e) => setPort(c, "whf", e.target.value)} /></label>
              </div>
            ))}
          </div>
        </fieldset>
        <p className="muted small">Brokerage fee follows CAO 1-2001: {settings.brokerage.map((b) => `up to ${b.upto.toLocaleString()}: ${b.fee.toLocaleString()}`).join("; ")}; over 200,000: 5,300 + {settings.brokerageOverRate} × excess.</p>
        {owner && <div className="row"><button>Save fees</button><button type="button" className="ghost" onClick={() => setSettings(DEFAULT_SETTINGS)}>Back to the office figures</button></div>}
      </form>
    </>
  );
}
