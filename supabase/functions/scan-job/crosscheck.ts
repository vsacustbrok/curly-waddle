// Deterministic cross-checks over fields Claude extracted from a job's documents.
// No model calls here: every pass/fail decision is made in code so it is
// repeatable and auditable.

export type Party = { name?: string | null; address?: string | null; contact?: string | null };

export type Extracted = {
  doc_type_detected?: string | null;
  document_number?: string | null;
  document_date?: string | null;
  bl_awb_number?: string | null;
  booking_number?: string | null;
  invoice_number?: string | null;
  shipper?: Party | null;
  consignee?: Party | null;
  notify_party?: Party | null;
  vessel?: string | null;
  voyage?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  container_numbers?: string[] | null;
  seal_numbers?: string[] | null;
  gross_weight?: number | null;
  net_weight?: number | null;
  weight_unit?: string | null;
  package_count?: number | null;
  package_type?: string | null;
  volume_cbm?: number | null;
  goods_description?: string | null;
  hs_codes?: string[] | null;
  currency?: string | null;
  incoterm?: string | null;
  invoice_total?: number | null;
  /** ISO dates (YYYY-MM-DD), null when not printed or not readable with certainty. */
  issue_date?: string | null;
  shipped_on_board_date?: string | null;
  sps_must_ship_out_date?: string | null;
  sps_valid_until?: string | null;
  sps_permitted_weight?: number | null;
  sps_permitted_weight_unit?: string | null;
  country_of_origin?: string | null;
  /** Estimated arrival at the port of discharge, ISO date. */
  eta_date?: string | null;
  carrier_name?: string | null;
  un_number?: string | null;
  hazard_class?: string | null;
  packing_group?: string | null;
  dg_emergency_contact?: string | null;
  /** "yes", "no" or "unclear". */
  signed?: string | null;
  stamped?: string | null;
  line_items?: Array<{
    description?: string | null;
    quantity?: number | null;
    unit_price?: number | null;
    amount?: number | null;
  }> | null;
};

export type DocInput = {
  id: string;
  file_name: string;
  doc_type: string;
  extracted: Extracted | null;
};

export type JobInput = {
  bl_awb_no: string | null;
  containers: string[] | null;
  vessel: string | null;
  voyage: string | null;
  port_of_discharge: string | null;
  client_name: string | null;
};

export type Severity = "error" | "warning";

export type Issue = {
  severity: Severity;
  check: string;
  message: string;
  values: Array<{ source: string; value: unknown }>;
};

export type Match = {
  check: string;
  value: unknown;
  sources: string[];
};

export type CrossCheckResult = { issues: Issue[]; matches: Match[] };

// ---------- normalisers ----------

const CORP_SUFFIXES = new Set([
  "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED",
  "LLC", "LLP", "PLC", "GMBH", "AG", "SA", "SAS", "SRL", "BV", "NV", "PTE", "PTY",
  "PVT", "PRIVATE", "OPC", "THE", "AND", "OF", "INTL", "INTERNATIONAL", "TRADING",
  "ENTERPRISES", "ENTERPRISE", "HOLDINGS", "GROUP", "PHILS", "PHILIPPINES",
]);

export function nameTokens(name: string | null | undefined): Set<string> {
  if (!name) return new Set();
  const cleaned = name
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ");
  return new Set(
    cleaned.split(/\s+/).filter((t) => t.length > 1 && !CORP_SUFFIXES.has(t)),
  );
}

/** Similarity of two company names, 0..1 (overlap coefficient on significant tokens). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

export function normRef(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Strip a 4-letter carrier SCAC prefix so "MAEU123456789" matches "123456789". */
function refCore(v: string): string {
  const m = v.match(/^[A-Z]{4}(\d{6,})$/);
  return m ? m[1] : v;
}

export function sameRef(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normRef(a);
  const nb = normRef(b);
  if (!na || !nb) return false;
  return na === nb || refCore(na) === refCore(nb);
}

export function normContainer(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** ISO 6346 check digit validation for container numbers like MSCU1234565. */
export function isValidContainer(raw: string): boolean {
  const c = normContainer(raw);
  if (!/^[A-Z]{3}[UJZR]\d{7}$/.test(c)) return false;
  const letterValue = (ch: string) => {
    // A=10, skipping multiples of 11 (11, 22, 33).
    let v = 10;
    for (let code = 65; code < ch.charCodeAt(0); code++) {
      v++;
      if (v % 11 === 0) v++;
    }
    return v;
  };
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = c[i];
    const val = i < 4 ? letterValue(ch) : Number(ch);
    sum += val * 2 ** i;
  }
  const check = (sum % 11) % 10;
  return check === Number(c[10]);
}

export function toKg(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const u = (unit ?? "kg").toLowerCase().replace(/[^a-z]/g, "");
  if (["lb", "lbs", "pound", "pounds"].includes(u)) return value * 0.45359237;
  if (["t", "mt", "ton", "tons", "tonne", "tonnes", "metricton"].includes(u)) return value * 1000;
  return value;
}

const STOPWORDS = new Set([
  "THE", "AND", "OF", "FOR", "WITH", "IN", "ON", "TO", "A", "AN", "PCS", "PC", "SET", "SETS",
  "UNIT", "UNITS", "CTN", "CTNS", "CARTON", "CARTONS", "PKG", "PKGS", "PACKAGES", "PALLET",
  "PALLETS", "SAID", "CONTAIN", "CONTAINS", "STC", "SHIPPER", "LOAD", "COUNT", "SLAC", "NO",
  "QTY", "TOTAL", "NEW", "ITEM", "ITEMS", "GOODS", "AS", "PER", "INVOICE", "HS", "CODE",
]);

export function descTokens(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s.toUpperCase()
      .replace(/[^A-Z ]+/g, " ")
      .split(/\s+/)
      .map((t) => (t.length > 4 && t.endsWith("S") ? t.slice(0, -1) : t))
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

// ---------- the checks ----------

const TRANSPORT_DOCS = new Set(["bill_of_lading", "airway_bill"]);
const NAME_MATCH = 0.6;
const WEIGHT_TOLERANCE = 0.005; // 0.5 %
const MONEY_TOLERANCE = 0.01;

function label(d: DocInput): string {
  return `${d.doc_type}: ${d.file_name}`;
}

export function crossCheck(job: JobInput, docs: DocInput[]): CrossCheckResult {
  const issues: Issue[] = [];
  const matches: Match[] = [];
  // SPS clearances are checked separately (sps.ts); here only the shipping documents are compared.
  const withData = docs.filter((d) => d.extracted && d.doc_type !== "sps_import_clearance");

  const transport = withData.filter((d) => TRANSPORT_DOCS.has(d.doc_type));
  const invoices = withData.filter((d) => d.doc_type === "commercial_invoice");
  const packingLists = withData.filter((d) => d.doc_type === "packing_list");

  if (transport.length === 0) {
    issues.push({
      severity: "warning",
      check: "documents_present",
      message: "No Bill of Lading or Airway Bill has been scanned for this job.",
      values: [],
    });
  }
  if (invoices.length === 0) {
    issues.push({
      severity: "warning",
      check: "documents_present",
      message: "No Commercial Invoice has been scanned for this job.",
      values: [],
    });
  }
  if (packingLists.length === 0) {
    issues.push({
      severity: "warning",
      check: "documents_present",
      message: "No Packing List has been scanned for this job.",
      values: [],
    });
  }

  // --- parties ---
  for (const role of ["shipper", "consignee"] as const) {
    const vals = withData
      .map((d) => ({ source: label(d), value: d.extracted![role]?.name ?? null }))
      .filter((v) => v.value);
    if (vals.length >= 2) {
      const base = vals[0];
      const mismatched = vals.slice(1).filter((v) => nameSimilarity(base.value, v.value) < NAME_MATCH);
      if (mismatched.length) {
        issues.push({
          severity: "error",
          check: `${role}_match`,
          message: `${role === "shipper" ? "Shipper" : "Consignee"} name differs between documents.`,
          values: vals,
        });
      } else {
        matches.push({ check: `${role}_match`, value: base.value, sources: vals.map((v) => v.source) });
      }
    }
  }

  // consignee vs client on file
  if (job.client_name) {
    const consignees = withData
      .map((d) => ({ source: label(d), value: d.extracted!.consignee?.name ?? null }))
      .filter((v) => v.value);
    const off = consignees.filter((v) => nameSimilarity(job.client_name, v.value) < NAME_MATCH);
    if (consignees.length && off.length === consignees.length) {
      issues.push({
        severity: "warning",
        check: "consignee_vs_client",
        message: `Consignee on the documents does not look like the job's client (${job.client_name}).`,
        values: [{ source: "job: client", value: job.client_name }, ...off],
      });
    } else if (consignees.length) {
      matches.push({
        check: "consignee_vs_client",
        value: job.client_name,
        sources: ["job: client", ...consignees.filter((v) => !off.includes(v)).map((v) => v.source)],
      });
    }
  }

  // --- BL / AWB number ---
  {
    const vals: Array<{ source: string; value: string }> = [];
    if (job.bl_awb_no) vals.push({ source: "job: BL/AWB no.", value: job.bl_awb_no });
    for (const d of withData) {
      const v = d.extracted!.bl_awb_number;
      if (v) vals.push({ source: label(d), value: v });
    }
    if (vals.length >= 2) {
      const base = vals[0];
      const bad = vals.slice(1).filter((v) => !sameRef(base.value, v.value));
      if (bad.length) {
        issues.push({
          severity: "error",
          check: "bl_number_match",
          message: "BL/AWB number does not match across the job and its documents.",
          values: vals,
        });
      } else {
        matches.push({ check: "bl_number_match", value: base.value, sources: vals.map((v) => v.source) });
      }
    } else if (transport.length && !transport.some((d) => d.extracted!.bl_awb_number)) {
      issues.push({
        severity: "warning",
        check: "bl_number_match",
        message: "Could not read a BL/AWB number from the transport document.",
        values: [],
      });
    }
  }

  // --- containers ---
  {
    const sets: Array<{ source: string; set: Set<string> }> = [];
    if (job.containers && job.containers.length) {
      sets.push({ source: "job: containers", set: new Set(job.containers.map(normContainer)) });
    }
    for (const d of withData) {
      const list = d.extracted!.container_numbers;
      if (list && list.length) sets.push({ source: label(d), set: new Set(list.map(normContainer)) });
    }
    const all = new Set<string>();
    for (const s of sets) for (const c of s.set) all.add(c);
    const invalid = [...all].filter((c) => !isValidContainer(c));
    if (invalid.length) {
      issues.push({
        severity: "warning",
        check: "container_check_digit",
        message: `Container number(s) fail the ISO 6346 check digit: ${invalid.join(", ")}. Check for a misread or typo.`,
        values: invalid.map((c) => ({ source: "container", value: c })),
      });
    }
    if (sets.length >= 2) {
      const ref = sets[0];
      const diffs = sets.slice(1).filter((s) => {
        if (s.set.size !== ref.set.size) return true;
        for (const c of s.set) if (!ref.set.has(c)) return true;
        return false;
      });
      const values = sets.map((s) => ({ source: s.source, value: [...s.set].sort() }));
      if (diffs.length) {
        issues.push({
          severity: "error",
          check: "containers_match",
          message: "Container numbers differ between documents.",
          values,
        });
      } else {
        matches.push({ check: "containers_match", value: [...ref.set].sort(), sources: sets.map((s) => s.source) });
      }
    }
  }

  // --- gross weight (transport doc vs packing list vs invoice if stated) ---
  {
    const vals = withData
      .map((d) => ({
        source: label(d),
        raw: d.extracted!.gross_weight,
        unit: d.extracted!.weight_unit,
        kg: toKg(d.extracted!.gross_weight, d.extracted!.weight_unit),
      }))
      .filter((v) => v.kg != null && v.kg > 0);
    if (vals.length >= 2) {
      const base = vals[0].kg!;
      const off = vals.slice(1).filter((v) => Math.abs(v.kg! - base) / base > WEIGHT_TOLERANCE);
      const values = vals.map((v) => ({ source: v.source, value: `${v.raw} ${v.unit ?? "kg"} (${v.kg!.toFixed(2)} kg)` }));
      if (off.length) {
        issues.push({
          severity: "error",
          check: "gross_weight_match",
          message: "Gross weight differs by more than 0.5% between documents.",
          values,
        });
      } else {
        matches.push({ check: "gross_weight_match", value: `${base.toFixed(2)} kg`, sources: vals.map((v) => v.source) });
      }
    }
    for (const d of withData) {
      const g = toKg(d.extracted!.gross_weight, d.extracted!.weight_unit);
      const n = toKg(d.extracted!.net_weight, d.extracted!.weight_unit);
      if (g != null && n != null && n > g * (1 + WEIGHT_TOLERANCE)) {
        issues.push({
          severity: "warning",
          check: "net_vs_gross",
          message: `Net weight is greater than gross weight on ${label(d)}.`,
          values: [{ source: label(d), value: { gross: g, net: n } }],
        });
      }
    }
  }

  // --- packages ---
  {
    const vals = withData
      .map((d) => ({ source: label(d), value: d.extracted!.package_count ?? null, type: d.extracted!.package_type }))
      .filter((v) => v.value != null && v.value > 0);
    if (vals.length >= 2) {
      const base = vals[0].value;
      const off = vals.slice(1).filter((v) => v.value !== base);
      const values = vals.map((v) => ({ source: v.source, value: `${v.value}${v.type ? " " + v.type : ""}` }));
      if (off.length) {
        issues.push({ severity: "error", check: "package_count_match", message: "Number of packages differs between documents.", values });
      } else {
        matches.push({ check: "package_count_match", value: base, sources: vals.map((v) => v.source) });
      }
    }
  }

  // --- invoice arithmetic ---
  for (const inv of invoices) {
    const e = inv.extracted!;
    const lines = (e.line_items ?? []).filter((l) => l.amount != null);
    for (const [i, l] of (e.line_items ?? []).entries()) {
      if (l.quantity != null && l.unit_price != null && l.amount != null) {
        const expected = l.quantity * l.unit_price;
        if (Math.abs(expected - l.amount) > Math.max(MONEY_TOLERANCE, Math.abs(expected) * 0.001)) {
          issues.push({
            severity: "warning",
            check: "invoice_line_math",
            message: `Line ${i + 1} on ${inv.file_name}: quantity × unit price (${expected.toFixed(2)}) does not equal the line amount (${l.amount}).`,
            values: [{ source: label(inv), value: l }],
          });
        }
      }
    }
    if (e.invoice_total != null && lines.length) {
      const sum = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
      if (Math.abs(sum - e.invoice_total) > Math.max(MONEY_TOLERANCE, Math.abs(e.invoice_total) * 0.001)) {
        issues.push({
          severity: "error",
          check: "invoice_total",
          message: `Invoice line items add up to ${sum.toFixed(2)} but the stated total is ${e.invoice_total}.`,
          values: [
            { source: `${label(inv)} (sum of lines)`, value: Number(sum.toFixed(2)) },
            { source: `${label(inv)} (stated total)`, value: e.invoice_total },
          ],
        });
      } else {
        matches.push({ check: "invoice_total", value: `${e.currency ?? ""} ${e.invoice_total}`.trim(), sources: [label(inv)] });
      }
    } else if (e.invoice_total == null) {
      issues.push({
        severity: "warning",
        check: "invoice_total",
        message: `Could not read an invoice total from ${inv.file_name}.`,
        values: [],
      });
    }
  }
  if (invoices.length >= 2) {
    const curr = new Set(invoices.map((d) => (d.extracted!.currency ?? "").toUpperCase()).filter(Boolean));
    if (curr.size > 1) {
      issues.push({
        severity: "warning",
        check: "invoice_currency",
        message: `Invoices use different currencies: ${[...curr].join(", ")}.`,
        values: invoices.map((d) => ({ source: label(d), value: d.extracted!.currency })),
      });
    }
  }

  // --- goods description: transport doc vs invoice/packing list ---
  {
    const describe = (d: DocInput) =>
      [d.extracted!.goods_description, ...(d.extracted!.line_items ?? []).map((l) => l.description)]
        .filter(Boolean)
        .join(" ");
    const commercial = [...invoices, ...packingLists];
    for (const t of transport) {
      const tt = descTokens(t.extracted!.goods_description);
      if (tt.size === 0) continue;
      for (const c of commercial) {
        const ct = descTokens(describe(c));
        if (ct.size === 0) continue;
        let inter = 0;
        for (const tok of tt) if (ct.has(tok)) inter++;
        const overlap = inter / Math.min(tt.size, ct.size);
        if (overlap < 0.2) {
          issues.push({
            severity: "warning",
            check: "goods_description_match",
            message: `Goods description on ${t.file_name} shares few words with ${c.file_name}. Confirm they describe the same goods.`,
            values: [
              { source: label(t), value: t.extracted!.goods_description },
              { source: label(c), value: describe(c).slice(0, 300) },
            ],
          });
        } else {
          matches.push({
            check: "goods_description_match",
            value: [...tt].filter((x) => ct.has(x)).slice(0, 8).join(" "),
            sources: [label(t), label(c)],
          });
        }
      }
    }
  }

  // --- vessel / port vs job record (soft) ---
  for (const t of transport) {
    const e = t.extracted!;
    if (job.vessel && e.vessel && nameSimilarity(job.vessel, e.vessel) < NAME_MATCH) {
      issues.push({
        severity: "warning",
        check: "vessel_match",
        message: "Vessel on the transport document differs from the job record.",
        values: [{ source: "job: vessel", value: job.vessel }, { source: label(t), value: e.vessel }],
      });
    }
    if (job.voyage && e.voyage && normRef(job.voyage) !== normRef(e.voyage)) {
      issues.push({
        severity: "warning",
        check: "voyage_match",
        message: "Voyage number on the transport document differs from the job record.",
        values: [{ source: "job: voyage", value: job.voyage }, { source: label(t), value: e.voyage }],
      });
    }
  }

  return { issues, matches };
}
