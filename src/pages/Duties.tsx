// Duties and taxes computation (formal and informal entry), as the office calculator, for one or many
// items. Opened on its own (/duties) it is a blank calculator; opened for a shipment (/duties/:jobId)
// it starts from the shipment's invoice lines and lodgment details and can be saved on the shipment.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { canEditJobs, type Job } from "../lib/types";
import {
  DEFAULT_SETTINGS, blankItem, compute, defaultInput, ipcFee, normAhtn, showAhtn, tsadLines,
  type Container, type DutyInput, type DutySettings, type Item, type Quota,
} from "../lib/duties";
import { CURRENCIES } from "../lib/audit";

export type TariffRate = { ahtn_code: string; description: string | null; mfn_rate: number; fta_rates: Record<string, number>; note: string | null };
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const QUOTAS: [Quota, string][] = [["none", "—"], ["pork_in", "MAV pork, in-quota"], ["pork_out", "MAV pork, out-of-quota"], ["beef_in", "Beef, in-quota"], ["beef_out", "Beef, out-of-quota"]];

/** The owner's settings over the built-in office figures. */
export async function loadDutySettings(): Promise<DutySettings> {
  const { data } = await supabase.from("duty_settings").select("settings").maybeSingle();
  return { ...DEFAULT_SETTINGS, ...((data?.settings as Partial<DutySettings>) ?? {}) };
}

type Saved = { input: DutyInput; result: { total: number; dvPhp: number; duty: number; vat: number }; saved_at: string; saved_by: string };

export default function Duties() {
  const { jobId } = useParams();
  const { profile } = useAuth();
  const [settings, setSettings] = useState<DutySettings>(DEFAULT_SETTINGS);
  const [rates, setRates] = useState<Map<string, TariffRate>>(new Map());
  const [job, setJob] = useState<Job | null>(null);
  const [inp, setInp] = useState<DutyInput>(defaultInput());
  const [saved, setSaved] = useState<Saved | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canSave = !!job && canEditJobs(profile!.role);
  const canBill = !!job && (profile?.role === "owner" || profile?.role === "billing");
  const isOwner = profile?.role === "owner";

  /** Owner: keep a code and rate typed on this shipment, so later shipments fill it in by themselves. */
  async function saveRate(k: number) {
    const it = inp.items[k];
    const code = normAhtn(it.ahtn);
    if (!code || it.rate == null) return;
    if (!confirm(`Save AHTN ${showAhtn(code)} at ${it.rate}% (MFN) in the duty rate table? Later shipments with this code will use it.`)) return;
    const row = { ahtn_code: code, description: it.description.trim() || null, mfn_rate: it.rate, fta_rates: {}, note: job ? `From ${job.job_no}` : null };
    const { error } = await supabase.from("tariff_rates").upsert(row);
    if (error) { setError(error.message); return; }
    setRates((m) => new Map(m).set(code, row as TariffRate));
    setMsg(`AHTN ${showAhtn(code)} saved in the duty rate table.`);
  }

  // Prefill from the shipment: invoice lines (one item each), lodgment details and recorded port charges.
  const fromShipment = useCallback(async (j: Job, s: DutySettings, rateMap: Map<string, TariffRate>): Promise<DutyInput> => {
    const [lines, charges] = await Promise.all([
      supabase.from("audit_line_items").select("description, hs_code, amount").eq("job_id", j.id).order("file_name").order("line_no"),
      supabase.from("charges").select("kind, amount").eq("job_id", j.id).in("kind", ["arrastre", "wharfage"]),
    ]);
    const items: Item[] = (lines.data ?? []).filter((l) => Number(l.amount) > 0).map((l) => {
      const code = normAhtn(l.hs_code as string | null) ?? "";
      return { ...blankItem(), description: (l.description as string) ?? "", ahtn: code, fob: Number(l.amount), rate: rateMap.get(code)?.mfn_rate ?? null };
    });
    const sum = (k: string) => (charges.data ?? []).filter((c) => c.kind === k).reduce((a, c) => a + Number(c.amount), 0);
    const size = (j.container_size ?? "").toLowerCase();
    return {
      ...defaultInput(s),
      currency: j.charges_currency || "USD",
      exchangeRate: Number(j.exchange_rate) || 0,
      freight: Number(j.freight_amount) || 0,
      insurancePct: j.insurance_amount != null ? null : 0,
      insuranceAmount: Number(j.insurance_amount) || 0,
      otherCharges: Number(j.other_charges) || 0,
      container: size.includes("20") ? "20ft" : size.includes("lcl") ? "lcl" : "40ft",
      containers: Math.max(1, j.containers?.length ?? 1),
      arrastre: sum("arrastre") || null,
      wharfage: sum("wharfage") || null,
      items: items.length ? items : [{ ...blankItem(), description: j.item_description ?? "" }],
    };
  }, []);

  useEffect(() => {
    (async () => {
      const [s, r] = await Promise.all([loadDutySettings(), supabase.from("tariff_rates").select("*")]);
      const rateMap = new Map(((r.data as TariffRate[]) ?? []).map((x) => [x.ahtn_code, x]));
      setSettings(s); setRates(rateMap);
      if (!jobId) { setInp(defaultInput(s)); return; }
      const { data, error } = await supabase.from("jobs").select("*, clients(name)").eq("id", jobId).maybeSingle();
      if (error || !data) { setError(error?.message ?? "Shipment not found."); return; }
      const j = data as Job & { duty_computation?: Saved | null };
      setJob(j);
      if (j.duty_computation?.input) { setInp(j.duty_computation.input); setSaved(j.duty_computation); }
      else setInp(await fromShipment(j, s, rateMap));
    })();
  }, [jobId, fromShipment]);

  const r = useMemo(() => compute(inp, settings), [inp, settings]);
  const t = useMemo(() => tsadLines(r, inp.exempt === "both" || inp.exempt === "vat", settings), [r, inp.exempt, settings]);
  const set = (patch: Partial<DutyInput>) => { setInp((x) => ({ ...x, ...patch })); setMsg(""); };
  const setItem = (k: number, patch: Partial<Item>) => set({ items: inp.items.map((it, i) => (i === k ? { ...it, ...patch } : it)) });
  const numIn = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/,/g, "")) || 0);
  const optNum = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")) || 0);

  /** Fill an item's rate from the rate table when its AHTN code is typed. */
  function lookup(k: number, code: string) {
    const c = normAhtn(code);
    const row = c ? rates.get(c) : undefined;
    setItem(k, { ahtn: c ?? code, ...(row && inp.items[k].rate == null ? { rate: Number(row.mfn_rate), description: inp.items[k].description || row.description || "" } : {}) });
  }

  async function save() {
    if (!job) return;
    setBusy(true); setError("");
    const snapshot: Saved = { input: inp, result: { total: r.total, dvPhp: r.dvPhp, duty: r.duty, vat: r.vat }, saved_at: new Date().toISOString(), saved_by: profile!.full_name || profile!.email || "" };
    const { error } = await supabase.from("jobs").update({ duty_computation: snapshot }).eq("id", job.id);
    setBusy(false);
    if (error) setError(error.message); else { setSaved(snapshot); setMsg("Saved on the shipment."); }
  }
  async function addToBilling() {
    if (!job || !confirm(`Add duties and taxes of ₱${money(r.total)} to ${job.job_no}'s billing as an advance for the client?`)) return;
    setBusy(true);
    const { error } = await supabase.from("charges").insert({ job_id: job.id, kind: "duties_taxes", description: `Duties and taxes (${inp.mode} entry estimate)`, amount: Math.round(r.total * 100) / 100, vatable: false, advance: true });
    setBusy(false);
    setMsg(error ? "" : "Added to the shipment's billing.");
    if (error) setError(error.message);
  }
  async function reload() {
    if (!job || !confirm("Start again from the shipment's invoice lines and lodgment details? Unsaved changes are lost.")) return;
    setInp(await fromShipment(job, settings, rates)); setMsg("");
  }
  const printTsad = () => {
    document.body.classList.add("print-tsad");
    const done = () => { document.body.classList.remove("print-tsad"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  };

  const formal = inp.mode === "formal";
  const port = settings.port[inp.container];
  const insSel = inp.insurancePct == null ? "c" : String(inp.insurancePct);

  return (
    <div className="duties">
      <div className="row spread wrap no-print">
        <div>
          <h1>Duties and taxes{job ? ` · ${job.job_no}` : ""}</h1>
          <p className="muted">{job ? <>{job.clients?.name} · <Link to={`/jobs/${job.id}`}>Open shipment</Link> · <Link to={`/pre-lodgment-audit/${job.id}`}>Pre-lodgment audit</Link></> : "Calculator. Open it from a shipment to start from its documents and save the result."}</p>
        </div>
        <div className="row wrap">
          <Link className="ghost-link" to="/duty-rates">Duty rates and fees</Link>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p className="muted small no-print">Last saved {new Date(saved.saved_at).toLocaleString()} by {saved.saved_by}.</p>}

      <section className="card no-print">
        <div className="row wrap">
          <label>Computation basis
            <select value={inp.mode} onChange={(e) => set({ mode: e.target.value as DutyInput["mode"] })}>
              <option value="formal">Formal entry</option>
              <option value="informal">Informal entry (express shipment, FOB above ₱10,000 and below ₱50,000)</option>
            </select>
          </label>
          <label>Currency<select value={inp.currency} onChange={(e) => set({ currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Exchange rate (₱ per 1)<input inputMode="decimal" value={inp.exchangeRate || ""} onChange={(e) => set({ exchangeRate: numIn(e.target.value) })} placeholder="BSP rate on the date of entry" /></label>
        </div>
      </section>

      <section className="card no-print">
        <div className="row spread wrap">
          <h2>Goods <span className="count">{inp.items.length} item{inp.items.length === 1 ? "" : "s"}</span></h2>
          <div className="row">
            {job && <button type="button" className="ghost" onClick={reload}>Start from the invoice lines</button>}
            <button type="button" onClick={() => set({ items: [...inp.items, blankItem()] })}>+ Add item</button>
          </div>
        </div>
        <p className="muted small">One line per item on the bill of lading or invoice. Freight, insurance and other charges are shared over the items by FOB value; each item pays duty at its own rate.</p>
        <div className="table-scroll">
          <table className="duty-items">
            <thead><tr><th>#</th><th>Description</th><th>AHTN code</th><th className="num">Rate %</th><th className="num">FOB / FCA ({inp.currency})</th>
              {formal && <th>Special condition</th>}{formal && <th className="num">Chicken safeguard: net kg</th>}<th className="num">Excise ₱</th><th></th></tr></thead>
            <tbody>
              {inp.items.map((it, k) => {
                const row = rates.get(normAhtn(it.ahtn) ?? "");
                const fta = row ? Object.entries(row.fta_rates ?? {}) : [];
                return (
                  <tr key={k}>
                    <td>{k + 1}</td>
                    <td><input value={it.description} onChange={(e) => setItem(k, { description: e.target.value })} aria-label={`Item ${k + 1} description`} /></td>
                    <td>
                      <input value={it.ahtn ? showAhtn(it.ahtn) : ""} onChange={(e) => setItem(k, { ahtn: e.target.value })} onBlur={(e) => lookup(k, e.target.value)} placeholder="0207.14.91" aria-label={`Item ${k + 1} AHTN code`} style={{ width: "9em" }} />
                      {row && <div className="small muted">{row.description}</div>}
                      {!row && isOwner && normAhtn(it.ahtn) && it.rate != null && (
                        <button type="button" className="link small" onClick={() => saveRate(k)}>Save to rate table</button>
                      )}
                    </td>
                    <td className="num">
                      <input inputMode="decimal" value={it.rate ?? ""} onChange={(e) => setItem(k, { rate: optNum(e.target.value) })} aria-label={`Item ${k + 1} rate of duty`} style={{ width: "5em" }} className={it.rate == null && it.quota === "none" ? "bad" : ""} />
                      {row && (
                        <select className="small" aria-label="Rate source" value="" onChange={(e) => e.target.value && setItem(k, { rate: Number(e.target.value) })}>
                          <option value="">from table…</option>
                          <option value={row.mfn_rate}>MFN {row.mfn_rate}%</option>
                          {fta.map(([form, v]) => <option key={form} value={v}>{form} {v}%</option>)}
                        </select>
                      )}
                    </td>
                    <td className="num"><input inputMode="decimal" value={it.fob || ""} onChange={(e) => setItem(k, { fob: numIn(e.target.value) })} aria-label={`Item ${k + 1} FOB`} style={{ width: "9em" }} /></td>
                    {formal && <td><select value={it.quota} onChange={(e) => setItem(k, { quota: e.target.value as Quota })} aria-label={`Item ${k + 1} special condition`}>{QUOTAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>}
                    {formal && <td className="num"><input inputMode="decimal" value={it.chickenNetKg ?? ""} onChange={(e) => setItem(k, { chickenNetKg: optNum(e.target.value) })} aria-label={`Item ${k + 1} chicken net weight`} placeholder="—" style={{ width: "7em" }} /></td>}
                    <td className="num"><input inputMode="decimal" value={it.excise || ""} onChange={(e) => setItem(k, { excise: numIn(e.target.value) })} aria-label={`Item ${k + 1} excise`} style={{ width: "7em" }} /></td>
                    <td>{inp.items.length > 1 && <button type="button" className="link danger-text" onClick={() => set({ items: inp.items.filter((_, i) => i !== k) })}>Remove</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {r.missingRates > 0 && <p className="warn-text">{r.missingRates} item{r.missingRates === 1 ? " has" : "s have"} no rate of duty yet. Look it up at finder.tariffcommission.gov.ph, or add the code to the duty rate table.</p>}
      </section>

      <section className="card no-print">
        <h2>Dutiable value and charges</h2>
        <div className="grid">
          <label>Freight ({inp.currency})<input inputMode="decimal" value={inp.freight || ""} onChange={(e) => set({ freight: numIn(e.target.value) })} /></label>
          <label>Insurance
            <select value={insSel} onChange={(e) => set(e.target.value === "c" ? { insurancePct: null } : { insurancePct: Number(e.target.value) })}>
              <option value="0">None (0%)</option><option value="2">2% of FOB (general cargo)</option><option value="4">4% of FOB (dangerous cargo)</option><option value="c">Actual amount</option>
            </select>
          </label>
          {insSel === "c" && <label>Insurance amount ({inp.currency})<input inputMode="decimal" value={inp.insuranceAmount || ""} onChange={(e) => set({ insuranceAmount: numIn(e.target.value) })} /></label>}
          {formal && <label>Other charges ({inp.currency})<input inputMode="decimal" value={inp.otherCharges || ""} onChange={(e) => set({ otherCharges: numIn(e.target.value) })} /></label>}
        </div>
        {formal && (
          <>
            <h3>Port charges and fees (₱)</h3>
            <div className="grid">
              <label>Container type
                <select value={inp.container} onChange={(e) => set({ container: e.target.value as Container })}>
                  <option value="40ft">40-foot FCL</option><option value="20ft">20-foot FCL</option><option value="lcl">LCL</option>
                </select>
              </label>
              {inp.container !== "lcl" && <label>Number of containers<input inputMode="numeric" value={inp.containers} onChange={(e) => set({ containers: Math.max(1, Math.round(numIn(e.target.value)) || 1) })} /></label>}
              <label>Arrastre<input inputMode="decimal" value={inp.arrastre ?? ""} onChange={(e) => set({ arrastre: optNum(e.target.value) })} placeholder={`Auto: ${money(port.arr * (inp.container === "lcl" ? 1 : inp.containers))}`} /></label>
              <label>Wharfage<input inputMode="decimal" value={inp.wharfage ?? ""} onChange={(e) => set({ wharfage: optNum(e.target.value) })} placeholder={`Auto: ${money(port.whf * (inp.container === "lcl" ? 1 : inp.containers))}`} /></label>
              <label>CDS<input inputMode="decimal" value={inp.cds} onChange={(e) => set({ cds: numIn(e.target.value) })} /></label>
              <label>IPF / IPC<input inputMode="decimal" value={inp.ipf} onChange={(e) => set({ ipf: numIn(e.target.value) })} />
                {r.dvPhp > 0 && <span className="muted small">Schedule for this value: {money(ipcFee(r.dvPhp, settings))}</span>}</label>
              <label>IRS<input inputMode="decimal" value={inp.irs} onChange={(e) => set({ irs: numIn(e.target.value) })} /></label>
              <label>Bank charges<input inputMode="decimal" value={inp.bank || ""} onChange={(e) => set({ bank: numIn(e.target.value) })} /></label>
              <label>CSF (container security fee)<input inputMode="decimal" value={inp.csf || ""} onChange={(e) => set({ csf: numIn(e.target.value) })} placeholder="0.00" /></label>
            </div>
          </>
        )}
        <div className="grid">
          <label>Tax exemption (Department of Finance)
            <select value={inp.exempt} onChange={(e) => set({ exempt: e.target.value as DutyInput["exempt"] })}>
              <option value="none">None</option><option value="both">Customs duty and VAT</option><option value="duty">Customs duty only</option><option value="vat">VAT only</option>
            </select>
          </label>
          {inp.exempt !== "none" && <label>Reference no.<input value={inp.exemptRef} onChange={(e) => set({ exemptRef: e.target.value })} /></label>}
        </div>
      </section>

      <section className="card duty-result">
        <div className="print-only"><h2>VSA Customs Brokerage · Duties and taxes estimate{job ? ` · ${job.job_no}` : ""}</h2><p>{job?.clients?.name} · {inp.mode === "formal" ? "Formal entry" : "Informal entry"} · {inp.currency} @ {inp.exchangeRate}</p></div>
        <h2 className="no-print">Computation</h2>
        <div className="table-scroll">
          <table className="small">
            <thead><tr><th>#</th><th>Item</th><th>AHTN</th><th className="num">FOB</th><th className="num">Dutiable value ({inp.currency})</th><th className="num">Dutiable value ₱</th><th className="num">Rate</th><th className="num">Customs duty ₱</th>{r.safeguard > 0 && <th className="num">Safeguard ₱</th>}</tr></thead>
            <tbody>
              {r.items.map((i, k) => (
                <tr key={k}><td>{k + 1}</td><td>{i.description}</td><td className="nowrap">{i.ahtn ? showAhtn(i.ahtn) : ""}</td><td className="num">{money(i.fob)}</td><td className="num">{money(i.dvFx)}</td>
                  <td className="num">{money(i.dvPhp)}</td><td className="num" title={i.rateSource}>{i.rateUsed}%{i.quota !== "none" ? "*" : ""}</td><td className="num">{money(i.dutyFull)}</td>
                  {r.safeguard > 0 && <td className="num" title={i.safeguardBand ?? ""}>{money(i.safeguard)}</td>}</tr>
              ))}
              <tr className="total"><td colSpan={4}>Total</td><td className="num">{money(r.dvFx)}</td><td className="num">{money(r.dvPhp)}</td><td></td><td className="num">{money(r.dutyFull)}</td>{r.safeguard > 0 && <td className="num">{money(r.safeguard)}</td>}</tr>
            </tbody>
          </table>
        </div>

        <div className="duty-columns">
          <table className="small breakdown">
            <tbody>
              <tr><td>Total dutiable value ₱</td><td className="num">{money(r.dvPhp)}</td></tr>
              <tr><td>Customs duty</td><td className="num">{inp.exempt === "both" || inp.exempt === "duty" ? `EXEMPTED (${money(r.dutyFull)})` : money(r.duty)}</td></tr>
              {r.excise > 0 && <tr><td>Excise tax</td><td className="num">{money(r.excise)}</td></tr>}
              <tr><td>Brokerage fee {formal ? "(CAO 1-2001)" : "(courier)"}</td><td className="num">{money(r.brokerage)}</td></tr>
              {formal ? (
                <>
                  <tr><td>Arrastre</td><td className="num">{money(r.arrastre)}</td></tr>
                  <tr><td>Wharfage</td><td className="num">{money(r.wharfage)}</td></tr>
                  <tr><td>CDS</td><td className="num">{money(r.cds)}</td></tr>
                  <tr><td>IPF / IPC</td><td className="num">{money(r.ipf)}</td></tr>
                  <tr><td>Bank charges</td><td className="num">{money(r.bank)}</td></tr>
                </>
              ) : (
                <>
                  <tr><td>Import processing charge</td><td className="num">{money(r.ipf)}</td></tr>
                  <tr><td>Customs documentary stamp</td><td className="num">{money(r.customsDs)}</td></tr>
                  <tr><td>BIR documentary stamp tax</td><td className="num">{money(r.birDst)}</td></tr>
                </>
              )}
              <tr className="total"><td>Total landed cost</td><td className="num">{money(r.landedCost)}</td></tr>
              <tr><td>VAT ({Math.round(settings.vatRate * 100)}% of landed cost)</td><td className="num">{inp.exempt === "both" || inp.exempt === "vat" ? `EXEMPTED (${money(r.vatFull)})` : money(r.vat)}</td></tr>
            </tbody>
          </table>
          <table className="small breakdown summary">
            <tbody>
              <tr><td>Customs duty</td><td className="num">{money(r.duty)}</td></tr>
              <tr><td>VAT</td><td className="num">{money(r.vat)}</td></tr>
              {r.excise > 0 && <tr><td>Excise tax</td><td className="num">{money(r.excise)}</td></tr>}
              <tr><td>{formal ? "IPF / IPC" : "Import processing charge"}</td><td className="num">{money(r.ipf)}</td></tr>
              {!formal && <><tr><td>BIR documentary stamp tax</td><td className="num">{money(r.birDst)}</td></tr><tr><td>Customs documentary stamp</td><td className="num">{money(r.customsDs)}</td></tr></>}
              {formal && <><tr><td>Sub total</td><td className="num">{money(r.subTotal)}</td></tr><tr><td>IRS</td><td className="num">{money(r.irs)}</td></tr>{r.csf > 0 && <tr><td>CSF</td><td className="num">{money(r.csf)}</td></tr>}</>}
              {r.safeguard > 0 && <tr><td>Safeguard duty, chicken</td><td className="num">{money(r.safeguard)}</td></tr>}
              <tr className="total grand"><td>{formal ? "Total global tax ₱" : "Total tax amount ₱"}</td><td className="num">{money(r.total)}</td></tr>
            </tbody>
          </table>
        </div>
        {r.conditions.length > 0 && <p className="small"><strong>Special conditions:</strong> {r.conditions.join("; ")}</p>}
        {formal && r.brokerageTier >= settings.brokerage.length && (
          <p className="muted small">Brokerage fee: ({money(r.dvPhp)} − 200,000.00) × {settings.brokerageOverRate} + 5,300.00 = {money(r.brokerage)}</p>
        )}
        <p className="muted small">Estimate only, not an official Bureau of Customs document; the amount the BOC assesses may differ. Shipping and courier charges are not included.</p>
      </section>

      {formal && (
        <section className="card tsad">
          <p className="tsad-flag">NOT AN OFFICIAL BOC DOCUMENT</p>
          <h2>Temporary Single Administrative Document</h2>
          <p className="muted small">For information only. It shall not be submitted or used for processing at the Bureau of Customs.</p>
          <div className="duty-columns">
            <table className="small breakdown">
              <thead><tr><th colSpan={2}>53 Internal revenue (tax per box 45 and 47)</th></tr></thead>
              <tbody>
                <tr><td>Taxable value PH</td><td className="num">{money(t.dv)}</td></tr>
                <tr><td>Bank charges</td><td className="num">{money(t.bank)}</td></tr>
                <tr><td>Customs duty</td><td className="num">{money(t.duty)}</td></tr>
                <tr><td>Brokerage fee</td><td className="num">{money(t.bf)}</td></tr>
                <tr><td>Wharfage</td><td className="num">{money(t.whf)}</td></tr>
                <tr><td>Arrastre</td><td className="num">{money(t.arr)}</td></tr>
                <tr><td>Customs stamp</td><td className="num">{money(t.stamp)}</td></tr>
                <tr><td>Others (IPF)</td><td className="num">{money(t.oth)}</td></tr>
                {t.excise > 0 && <tr><td>Excise tax</td><td className="num">{money(t.excise)}</td></tr>}
                <tr className="total"><td>Total</td><td className="num">{money(t.tot)}</td></tr>
                <tr><td>VAT</td><td className="num">{money(t.vatFull)}</td></tr>
              </tbody>
            </table>
            <table className="small breakdown">
              <thead><tr><th colSpan={2}>Free disposal</th></tr></thead>
              <tbody>
                <tr><td>CUD</td><td className="num">{money(t.cud)}</td></tr>
                <tr><td>VAT</td><td className="num">{money(t.vat)}</td></tr>
                <tr className="total"><td>Total item tax</td><td className="num">{money(t.item)}</td></tr>
                <tr><td>IPC</td><td className="num">{money(t.ipc)}</td></tr>
                {t.csf > 0 && <tr><td>CSF</td><td className="num">{money(t.csf)}</td></tr>}
                {t.sg > 0 && <tr><td>Safeguard duty</td><td className="num">{money(t.sg)}</td></tr>}
                <tr><td>CDS</td><td className="num">{money(t.cds)}</td></tr>
                <tr><td>IRS</td><td className="num">{money(t.irs)}</td></tr>
                <tr className="total"><td>Total global tax</td><td className="num">{money(t.glob)}</td></tr>
                <tr className="total grand"><td>Grand total</td><td className="num">{money(t.grand)}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="row wrap no-print duty-actions">
        {canSave && <button type="button" onClick={save} disabled={busy}>Save on the shipment</button>}
        {canBill && <button type="button" className="ghost" onClick={addToBilling} disabled={busy || !(r.total > 0)}>Add to billing</button>}
        <button type="button" className="ghost" onClick={() => window.print()}>Print</button>
        {formal && <button type="button" className="ghost" onClick={printTsad}>Print TSAD</button>}
        {job && saved && formal && <Link className="button-like" to={`/jobs/${job.id}/pre-sad`}>Pre-SAD draft →</Link>}
        <button type="button" className="ghost" onClick={() => { if (confirm("Clear every field?")) { setInp(defaultInput(settings)); setMsg(""); } }}>Clear</button>
        {msg && <span className="ok-text">{msg}</span>}
      </div>
    </div>
  );
}
