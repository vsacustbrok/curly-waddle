// Pre-SAD: a draft of the E2M Single Administrative Document for one shipment, laid out like the BOC
// form and filled from the shipment, its documents and its saved duties-and-taxes computation, so the
// entry can be checked box by box before it is lodged. Marked as a draft; never an official document.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { canEditJobs, type Job, type JobDocument } from "../lib/types";
import { DEFAULT_SAD, compute, showAhtn, tsadLines, type DutyInput, type DutySettings, type SadDefaults } from "../lib/duties";
import { firstValue, partsOf } from "../lib/audit";
import { loadDutySettings } from "./Duties";

type ItemDraft = { gross: string; net: string; coCode: string; pref: string; quota: string; procedure: string; spec: string };
type Draft = SadDefaults & {
  customsRef: string; regNo: string; refNo: string; crf: string; bankRef: string; transhipment: string; localCarrier: string;
  exporter: string; importer: string; countryExport: string; countryOrigin: string; exportCode: string; delivery: string;
  marks: string; packages: string; packageKind: string; invoiceNo: string; warehouse: string; prepaid: string; items: ItemDraft[];
};
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNTRY: Record<string, string> = {
  BRAZIL: "BR", CHINA: "CN", "UNITED STATES": "US", USA: "US", AUSTRALIA: "AU", "NEW ZEALAND": "NZ", CANADA: "CA", INDIA: "IN",
  THAILAND: "TH", VIETNAM: "VN", "VIET NAM": "VN", INDONESIA: "ID", MALAYSIA: "MY", SINGAPORE: "SG", JAPAN: "JP", KOREA: "KR",
  "SOUTH KOREA": "KR", TAIWAN: "TW", "HONG KONG": "HK", SPAIN: "ES", NETHERLANDS: "NL", GERMANY: "DE", FRANCE: "FR", ITALY: "IT",
  POLAND: "PL", DENMARK: "DK", IRELAND: "IE", BELGIUM: "BE", ARGENTINA: "AR", CHILE: "CL", MEXICO: "MX", RUSSIA: "RU", PHILIPPINES: "PH",
  "UNITED KINGDOM": "GB", UK: "GB", TURKEY: "TR", PAKISTAN: "PK", BANGLADESH: "BD", "SRI LANKA": "LK", MYANMAR: "MM", CAMBODIA: "KH",
};
const iso2 = (c: string | null | undefined) => COUNTRY[(c ?? "").toUpperCase().trim()] ?? "";
const party = (p: { name?: string | null; address?: string | null } | null) => [p?.name, p?.address].filter(Boolean).join("\n");

export default function PreSad() {
  const { id } = useParams();
  const { profile } = useAuth();
  const [job, setJob] = useState<(Job & { duty_computation?: { input: DutyInput } | null; sad_draft?: Partial<Draft> | null }) | null>(null);
  const [docs, setDocs] = useState<JobDocument[]>([]);
  const [settings, setSettings] = useState<DutySettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const editable = canEditJobs(profile!.role);

  useEffect(() => {
    (async () => {
      const [j, d, s] = await Promise.all([
        supabase.from("jobs").select("*, clients(name, tin, address)").eq("id", id!).maybeSingle(),
        supabase.from("job_documents").select("*").eq("job_id", id!).order("uploaded_at"),
        loadDutySettings(),
      ]);
      if (j.error || !j.data) { setError(j.error?.message ?? "Shipment not found."); return; }
      setJob(j.data as typeof job); setDocs((d.data as JobDocument[]) ?? []); setSettings(s);
    })();
  }, [id]);

  const parts = useMemo(() => partsOf(docs), [docs]);
  const result = useMemo(() => (job?.duty_computation?.input && settings ? compute(job.duty_computation.input, settings) : null), [job, settings]);
  const inp = job?.duty_computation?.input;

  // The draft starts from the office defaults, the documents and the shipment; saved values win.
  useEffect(() => {
    if (!job || !settings) return;
    const sad = { ...DEFAULT_SAD, ...(settings.sad ?? {}) };
    const shipper = firstValue<{ name?: string; address?: string }>(parts, "shipper");
    const origin = firstValue<string>(parts, "country_of_origin") ?? "";
    const gross = firstValue<number>(parts, "gross_weight") ?? 0, net = firstValue<number>(parts, "net_weight", ["packing_list", "commercial_invoice", "bill_of_lading"]) ?? 0;
    const items = (result?.items ?? [{ share: 1 }]).map((i) => ({
      gross: gross ? String(Math.round(gross * (i.share ?? 1) * 100) / 100) : "", net: net ? String(Math.round(net * (i.share ?? 1) * 100) / 100) : "",
      coCode: iso2(origin), pref: "None", quota: "NNNNN", procedure: sad.procedure, spec: "000",
    }));
    const base: Draft = {
      ...sad, customsRef: job.entry_no ?? "", regNo: job.registry_no ?? "", refNo: [job.bl_awb_no, job.job_no, job.dp_contract].filter(Boolean).join(" / "),
      crf: "", bankRef: "", transhipment: "", localCarrier: "",
      exporter: party(shipper ?? null), importer: [job.clients?.name, job.clients?.address].filter(Boolean).join("\n"),
      countryExport: origin.toUpperCase(), countryOrigin: origin.toUpperCase(), exportCode: iso2(origin),
      delivery: (firstValue<string>(parts, "incoterm", ["commercial_invoice"]) ?? "").toUpperCase().match(/\b[A-Z]{3}\b/)?.[0] ?? "",
      marks: "AS ADDRESSED", packages: String(firstValue<number>(parts, "package_count") ?? ""), packageKind: (firstValue<string>(parts, "package_type") ?? "").toUpperCase(),
      invoiceNo: firstValue<string>(parts, "invoice_number", ["commercial_invoice"]) ?? "", warehouse: "", prepaid: "", items,
    };
    const saved = job.sad_draft ?? {};
    setDraft({ ...base, ...saved, items: items.map((it, k) => ({ ...it, ...((saved.items ?? [])[k] ?? {}) })) });
  }, [job, settings, parts, result]);

  if (error) return <p className="error">{error}</p>;
  if (!job || !draft || !settings) return <p className="muted">Loading…</p>;

  const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setMsg(""); };
  const setItem = (k: number, patch: Partial<ItemDraft>) => set({ items: draft.items.map((it, i) => (i === k ? { ...it, ...patch } : it)) });
  async function save() {
    const { error } = await supabase.from("jobs").update({ sad_draft: draft }).eq("id", job!.id);
    if (error) setError(error.message); else setMsg("Draft saved on the shipment.");
  }

  if (!result || !inp) {
    return (
      <section className="card">
        <h1>Pre-SAD draft · {job.job_no}</h1>
        <p>Compute and save the duties and taxes first: the draft takes its values, rates and taxes from that computation.</p>
        <Link className="button-like" to={`/duties/${job.id}`}>Compute duties and taxes →</Link>
      </section>
    );
  }

  const t = tsadLines(result, inp.exempt === "both" || inp.exempt === "vat", settings);
  const fx = inp.exchangeRate;
  const exemptVat = inp.exempt === "both" || inp.exempt === "vat";
  const fees = result.landedCost - result.dvPhp - result.duty - result.excise; // brokerage, port charges, stamps, IPF, bank
  const itemTax = result.items.map((i) => {
    const share = result.dvPhp > 0 ? i.dvPhp / result.dvPhp : 0;
    const vatBase = i.dvPhp + i.duty + i.excise + fees * share;
    return { vatBase, vat: exemptVat ? 0 : vatBase * settings.vatRate };
  });
  const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }).replace(/\//g, "-");
  const containersText = (job.containers ?? []).join(" ");
  const totalPages = 1 + Math.max(0, result.items.length - 1) + 1;

  const ItemBlock = ({ k }: { k: number }) => {
    const i = result.items[k], d = draft.items[k] ?? draft.items[0], tax = itemTax[k];
    return (
      <>
        <div className="sad-row sad-goods">
          <div className="sad-cell w-side"><b>31 Packages and Description of Goods</b></div>
          <div className="sad-cell grow">
            <div className="sad-l">Marks &amp; No of Packages: <span className="v">{draft.marks}</span></div>
            <div className="sad-l">Number and Kind: <span className="v">{k === 0 ? `${draft.packages} ${draft.packageKind}` : ""}</span></div>
            <div className="sad-l">Container No(s): <span className="v">{k === 0 ? containersText : ""}</span></div>
            <div className="v pre">{i.description || "—"}</div>
          </div>
          <div className="sad-cell w-sm"><b>32 Item No.</b><div className="v big">{k + 1}</div></div>
          <div className="sad-cell w-lg">
            <div className="sad-split"><span><b>33 HS Code</b><span className="v">{i.ahtn ? showAhtn(i.ahtn) : "—"}</span></span><span><b>Spec Code</b><span className="v">{d.spec}</span></span></div>
            <div className="sad-split"><span><b>34 C.O. Code</b><span className="v">{d.coCode}</span></span><span><b>35 Item Gross Weight (kg)</b><span className="v">{d.gross}</span></span><span><b>36 Pref</b><span className="v">{d.pref}</span></span></div>
            <div className="sad-split"><span><b>37 Procedure</b><span className="v">{d.procedure}</span></span><span><b>38 Item Net Weight (kg)</b><span className="v">{d.net}</span></span><span><b>39 Quota</b><span className="v">{d.quota}</span></span></div>
            <div className="sad-split"><span><b>40a AWB / BL</b><span className="v">{job.bl_awb_no}</span></span><span><b>40b Previous Doc. No.</b></span></div>
            <div className="sad-split"><span><b>41 Suppl. Units</b></span><span><b>42 Item Customs Value (F. Cur)</b><span className="v">{money(i.fob)}</span></span><span><b>43 V.M.</b><span className="v">NV</span></span></div>
          </div>
        </div>
        <div className="sad-row">
          <div className="sad-cell w-side"><b>44 Add Infos / Doc / Product Certif. &amp; Aut</b></div>
          <div className="sad-cell grow">
            <div className="sad-l">Value build-up in PHP (item {k + 1}): FOB {money(i.fob * fx)} + Freight {money(i.freight * fx)} + Insurance {money(i.insurance * fx)}{i.other ? ` + Other ${money(i.other * fx)}` : ""}</div>
            <div className="sad-l">Invoice No.: <span className="v">{draft.invoiceNo}</span></div>
          </div>
          <div className="sad-cell w-lg">
            <div className="sad-split"><span><b>A.I. Code</b></span><span><b>45 Adjustment</b><span className="v">1.00</span></span></div>
            <div className="sad-split"><span><b>MSP</b><span className="v">0.00</span></span><span><b>46 Dutiable Value (PHP)</b><span className="v big">{money(i.dvPhp)}</span></span></div>
          </div>
        </div>
        <div className="sad-row">
          <div className="sad-cell w-side"><b>47 Calculation of Taxes</b></div>
          <div className="sad-cell grow">
            <table className="sad-tax">
              <thead><tr><th>Type</th><th>Tax Base</th><th>Rate</th><th>Amount</th><th>MP</th></tr></thead>
              <tbody>
                <tr><td>CUD</td><td>{money(i.dvPhp)}</td><td>{i.rateUsed} %</td><td>{money(i.duty)}</td><td>{i.duty === 0 && i.dutyFull > 0 ? "EX" : "0"}</td></tr>
                {i.excise > 0 && <tr><td>EXC</td><td>{money(i.excise)}</td><td></td><td>{money(i.excise)}</td><td>0</td></tr>}
                <tr><td>VAT</td><td>{money(tax.vatBase)}</td><td>{Math.round(settings.vatRate * 100)} %</td><td>{money(tax.vat)}</td><td>{exemptVat ? "EX" : "0"}</td></tr>
                <tr className="tot"><td colSpan={3}>Total Item:</td><td>{money(i.duty + i.excise + tax.vat)}</td><td></td></tr>
              </tbody>
            </table>
          </div>
          <div className="sad-cell w-lg">
            <div className="sad-split"><span><b>48 Prepaid Account No.</b><span className="v">{draft.prepaid}</span></span><span><b>49 Identification of Warehouse</b><span className="v">{draft.warehouse}</span></span></div>
            {k === 0 && (
              <div className="sad-acct">
                <b>47b ACCOUNTING DETAILS</b>
                <div>Method of Payment: <span className="v">CASH</span></div>
                <div>Assessment Number: <span className="v"></span></div>
                <div>Total Fees: <span className="v">{money(t.glob)}</span></div>
                <div>Total Assessment: <span className="v">{money(t.grand)}</span></div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  };

  const Head = ({ page }: { page: number }) => (
    <div className="sad-head">
      <div><strong>BOC SINGLE ADMINISTRATIVE DOCUMENT</strong><span className="sad-draft">PRE-SAD DRAFT · NOT FOR LODGMENT</span></div>
      <div className="small">VSA Customs Brokerage · {job.job_no} · Page {page} of {totalPages}</div>
    </div>
  );

  return (
    <div className="presad">
      <div className="no-print">
        <p><Link to={`/jobs/${job.id}`}>← {job.job_no}</Link> · <Link to={`/duties/${job.id}`}>Duties and taxes</Link> · <Link to={`/pre-lodgment-audit/${job.id}`}>Pre-lodgment audit</Link></p>
        <h1>Pre-SAD draft · {job.job_no}</h1>
        <p className="muted">A draft of the import entry, laid out like the E2M SAD, to check before lodgment. Values and taxes come from the saved duties and taxes computation; change those there. The boxes below are the details that are not on the documents.</p>
        {msg && <p className="ok-text">{msg}</p>}
        <details className="card" open>
          <summary><strong>Entry details</strong></summary>
          <fieldset disabled={!editable}>
            <div className="grid">
              <label>Office code<input value={draft.officeCode} onChange={(e) => set({ officeCode: e.target.value })} /></label>
              <label>Office name<input value={draft.officeName} onChange={(e) => set({ officeName: e.target.value })} /></label>
              <label>1 Declaration<input value={draft.declaration} onChange={(e) => set({ declaration: e.target.value })} /></label>
              <label>Customs reference (C no.)<input value={draft.customsRef} onChange={(e) => set({ customsRef: e.target.value })} /></label>
              <label>Registry number<input value={draft.regNo} onChange={(e) => set({ regNo: e.target.value })} /></label>
              <label>7 Reference number<input value={draft.refNo} onChange={(e) => set({ refNo: e.target.value })} /></label>
              <label>9 CRF number<input value={draft.crf} onChange={(e) => set({ crf: e.target.value })} /></label>
              <label>15 Country of export<input value={draft.countryExport} onChange={(e) => set({ countryExport: e.target.value })} /></label>
              <label>15 C.E. code<input value={draft.exportCode} onChange={(e) => set({ exportCode: e.target.value })} /></label>
              <label>16 Country of origin<input value={draft.countryOrigin} onChange={(e) => set({ countryOrigin: e.target.value })} /></label>
              <label>20 Terms of delivery<input value={draft.delivery} onChange={(e) => set({ delivery: e.target.value })} placeholder="CIF" /></label>
              <label>21 Local carrier<input value={draft.localCarrier} onChange={(e) => set({ localCarrier: e.target.value })} /></label>
              <label>27 Transhipment port<input value={draft.transhipment} onChange={(e) => set({ transhipment: e.target.value })} /></label>
              <label>30 Location of goods<input value={draft.locationOfGoods} onChange={(e) => set({ locationOfGoods: e.target.value })} /></label>
              <label>Terms of payment<input value={draft.termsOfPayment} onChange={(e) => set({ termsOfPayment: e.target.value })} /></label>
              <label>Bank code<input value={draft.bankCode} onChange={(e) => set({ bankCode: e.target.value })} /></label>
              <label>Bank name<input value={draft.bankName} onChange={(e) => set({ bankName: e.target.value })} /></label>
              <label>Branch<input value={draft.branch} onChange={(e) => set({ branch: e.target.value })} /></label>
              <label>Bank ref. number<input value={draft.bankRef} onChange={(e) => set({ bankRef: e.target.value })} /></label>
              <label>Marks &amp; numbers<input value={draft.marks} onChange={(e) => set({ marks: e.target.value })} /></label>
              <label>Packages<input value={draft.packages} onChange={(e) => set({ packages: e.target.value })} /></label>
              <label>Kind of packages<input value={draft.packageKind} onChange={(e) => set({ packageKind: e.target.value })} placeholder="CT" /></label>
              <label>Invoice no.<input value={draft.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} /></label>
              <label>48 Prepaid account no.<input value={draft.prepaid} onChange={(e) => set({ prepaid: e.target.value })} /></label>
              <label>49 Warehouse<input value={draft.warehouse} onChange={(e) => set({ warehouse: e.target.value })} /></label>
              <label>Broker<input value={draft.brokerName} onChange={(e) => set({ brokerName: e.target.value })} /></label>
              <label>Broker TIN<input value={draft.brokerTin} onChange={(e) => set({ brokerTin: e.target.value })} /></label>
            </div>
            <div className="grid">
              <label className="wide">2 Exporter / supplier<textarea rows={3} value={draft.exporter} onChange={(e) => set({ exporter: e.target.value })} /></label>
              <label className="wide">8 Importer / consignee<textarea rows={3} value={draft.importer} onChange={(e) => set({ importer: e.target.value })} /></label>
              <label className="wide">14 Broker address<textarea rows={2} value={draft.brokerAddress} onChange={(e) => set({ brokerAddress: e.target.value })} /></label>
            </div>
            <h3>Per item</h3>
            <div className="table-scroll">
              <table className="small">
                <thead><tr><th>#</th><th>Item</th><th>Gross kg</th><th>Net kg</th><th>C.O. code</th><th>Pref</th><th>Procedure</th><th>Quota</th><th>Spec code</th></tr></thead>
                <tbody>
                  {result.items.map((i, k) => (
                    <tr key={k}><td>{k + 1}</td><td>{i.description}</td>
                      {(["gross", "net", "coCode", "pref", "procedure", "quota", "spec"] as const).map((f) => (
                        <td key={f}><input value={draft.items[k]?.[f] ?? ""} onChange={(e) => setItem(k, { [f]: e.target.value })} aria-label={`Item ${k + 1} ${f}`} style={{ width: f === "procedure" ? "7em" : "6em" }} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.items.length > 1 && <p className="muted small">Weights start shared by item value from the document totals; correct them from the packing list.</p>}
          </fieldset>
          <div className="row">
            {editable && <button type="button" onClick={save}>Save draft</button>}
            <button type="button" className="ghost" onClick={() => window.print()}>Print Pre-SAD</button>
          </div>
        </details>
      </div>

      {/* ---------- page 1: front ---------- */}
      <section className="sad-page">
        <Head page={1} />
        <div className="sad-row">
          <div className="sad-cell grow"><b>2 Exporter / Supplier Address</b><div className="v pre">{draft.exporter}</div></div>
          <div className="sad-cell w-md"><b>1 DECLARATION</b><div className="v big">{draft.declaration}</div>
            <div className="sad-kv"><b>3 Page</b><span className="v">1 / {totalPages}</span><b>5 Items</b><span className="v">{result.items.length}</span><b>6 Tot Pack</b><span className="v">{draft.packages}</span></div></div>
          <div className="sad-cell w-lg"><b>Office Code</b> <span className="v">{draft.officeCode} {draft.officeName}</span><div><b>Customs Reference</b> <span className="v">{draft.customsRef}</span></div><div><b>Registry Number</b> <span className="v">{draft.regNo}</span></div><div><b>7 Reference Number</b> <span className="v">{draft.refNo}</span></div></div>
        </div>
        <div className="sad-row">
          <div className="sad-cell grow"><b>8 Importer / Consignee, Address</b> <span className="sad-tin">TIN: {job.clients?.tin ?? ""}</span><div className="v pre">{draft.importer}</div></div>
          <div className="sad-cell w-xl"><b>9 CRF NUMBER</b><div className="v">{draft.crf}</div><div className="sad-split"><span><b>12 Tot. F/I/O (Php)</b><span className="v">{money((result.dvFx - result.fob) * fx)}</span></span></div></div>
        </div>
        <div className="sad-row">
          <div className="sad-cell grow"><b>14 Broker / Attorney-In-Fact, Address</b> <span className="sad-tin">TIN: {draft.brokerTin}</span><div className="v pre">{[draft.brokerName, draft.brokerAddress].filter(Boolean).join("\n")}</div></div>
          <div className="sad-cell w-xl"><div className="sad-split"><span><b>15 Country of Export</b><span className="v">{draft.countryExport}</span></span><span><b>15 C.E. Code</b><span className="v">{draft.exportCode}</span></span><span><b>17</b><span className="v">PH</span></span></div>
            <div className="sad-split"><span><b>16 Country of Origin</b><span className="v">{draft.countryOrigin}</span></span><span><b>17 Country of Destination</b><span className="v">PHILIPPINES</span></span></div></div>
        </div>
        <div className="sad-row">
          <div className="sad-cell grow"><b>18 Vessel / Aircraft</b><div className="v">{[job.vessel, job.voyage].filter(Boolean).join(" ")}</div><div className="sad-split"><span><b>21 Local Carrier</b><span className="v">{draft.localCarrier}</span></span><span><b>25</b><span className="v">{today}</span></span><span><b>27 Transhipment Port</b><span className="v">{draft.transhipment}</span></span></div></div>
          <div className="sad-cell w-xl">
            <div className="sad-split"><span><b>20 Terms of Delivery</b><span className="v">{draft.delivery}</span></span></div>
            <div className="sad-split"><span><b>22 F. Cur.</b><span className="v">{inp.currency}</span></span><span><b>Total Customs Value</b><span className="v">{money(result.fob)}</span></span><span><b>23 Exch Rate</b><span className="v">{fx}</span></span></div>
            <div className="sad-split"><span><b>28 Financial and Banking Data</b> Terms of Payment <span className="v">{draft.termsOfPayment}</span></span><span>Bank Code <span className="v">{draft.bankCode}</span></span></div>
            <div className="sad-split"><span>Bank Name <span className="v">{draft.bankName}</span></span><span>Branch <span className="v">{draft.branch}</span></span><span>Bank Ref <span className="v">{draft.bankRef}</span></span></div>
          </div>
        </div>
        <div className="sad-row">
          <div className="sad-cell grow"><b>29 Port of Destination</b><div className="v">{draft.officeCode} {draft.officeName}</div></div>
          <div className="sad-cell grow"><b>30 Location of Goods</b><div className="v">{draft.locationOfGoods}</div></div>
          <div className="sad-cell w-xl"></div>
        </div>
        <ItemBlock k={0} />
        <div className="sad-row sad-sign">
          <div className="sad-cell grow"><b>50</b> We hereby certify that the information contained in all pages of this Declaration and the documents submitted are to the best of our knowledge and belief true and correct.
            <div className="sad-split"><span><b>51 Broker:</b> <span className="v">{draft.brokerName}</span></span><span><b>Importer / Attorney-in-Fact:</b> <span className="v">{job.clients?.name}</span></span></div></div>
          <div className="sad-cell w-lg sad-center">Subscribed and sworn before me<br /><br />Administering Officer / Notary Public</div>
        </div>
      </section>

      {/* ---------- continuation pages for items 2 and up ---------- */}
      {result.items.slice(1).map((_, n) => (
        <section className="sad-page" key={n}>
          <Head page={n + 2} />
          <div className="sad-row"><div className="sad-cell grow"><b>Continuation (rider), item {n + 2} of {result.items.length}</b> · <span className="v">{draft.refNo}</span> · Importer: <span className="v">{job.clients?.name}</span></div></div>
          <ItemBlock k={n + 1} />
        </section>
      ))}

      {/* ---------- last page: box 53 and free disposal ---------- */}
      <section className="sad-page">
        <Head page={totalPages} />
        <div className="sad-row"><div className="sad-cell grow">
          <b>53 INTERNAL REVENUE (TAX PER BOX #45 &amp; #47)</b>
          <div className="sad-53">
            <span>TAXABLE VALUE PH</span><span className="v">{money(t.dv)}</span><span>WHARFAGE</span><span className="v">{money(t.whf)}</span><span>OTHERS</span><span className="v">{money(t.oth)}</span>
            <span>BANK CHARGES</span><span className="v">{money(t.bank)}</span><span>ARRASTRE CHARGE</span><span className="v">{money(t.arr)}</span><span>TOTAL</span><span className="v">{money(t.tot)}</span>
            <span>CUSTOMS DUTY</span><span className="v">{money(t.duty)}</span><span>DOCUMENTARY STAMP</span><span className="v">{money(t.stamp)}</span><span>LANDED COST PH</span><span className="v">x {Math.round(settings.vatRate * 100)}%</span>
            <span>BROKERAGE FEE</span><span className="v">{money(t.bf)}</span><span>{t.excise > 0 ? "EXCISE TAX" : ""}</span><span className="v">{t.excise > 0 ? money(t.excise) : ""}</span><span>TOTAL VAT PH</span><span className="v">{money(t.vat)}</span>
          </div>
        </div></div>
        <div className="sad-row">
          <div className="sad-cell grow"><b>CONTINUATION FROM BOX # 31</b><div>Container Numbers continuation:</div><div className="v">{(job.containers ?? []).slice(1).join(" ")}</div>
            {result.conditions.length > 0 && <div><b>Special conditions:</b> {result.conditions.join("; ")}</div>}</div>
          <div className="sad-cell w-xl">
            <b>FREE DISPOSAL</b>
            <div className="sad-fd">
              <span>CUD</span><span className="v">{money(t.cud)}</span>
              <span>VAT</span><span className="v">{money(t.vat)}</span>
              {t.excise > 0 && <><span>EXCISE</span><span className="v">{money(t.excise)}</span></>}
              <span className="line">Total Item Tax</span><span className="v line">{money(t.item)}</span>
              <span>IPC</span><span className="v">{money(t.ipc)}</span>
              {t.sg > 0 && <><span>SAFEGUARD</span><span className="v">{money(t.sg)}</span></>}
              {t.csf > 0 && <><span>CSF</span><span className="v">{money(t.csf)}</span></>}
              <span>CDS</span><span className="v">{money(t.cds)}</span>
              <span>IRS</span><span className="v">{money(t.irs)}</span>
              <span className="line">Total Global Tax</span><span className="v line">{money(t.glob)}</span>
              <span className="grand">Total</span><span className="v grand">{money(t.grand)}</span>
            </div>
          </div>
        </div>
        <p className="sad-foot">PRE-SAD DRAFT prepared by VSA Customs Brokerage from the shipment documents, for checking before lodgment. Not an official Bureau of Customs document; the E2M assessment is final.</p>
      </section>
    </div>
  );
}
