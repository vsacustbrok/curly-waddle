// Field extraction with the Claude API (structured outputs).
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import type { Extracted } from "./crosscheck.ts";

/** The top model: re-reads hard scans and does the judgement checks. */
export const MODEL = "claude-opus-5-5";
/** The low-cost model that reads documents first. */
export const FAST_MODEL = "claude-haiku-5-5";

const str = { type: "string" };
// Numbers are asked for as text and turned into numbers in code (numbersOf below): a schema with
// many "number or null" fields compiles too large for the API ("compiled grammar is too large").
const num = str;
const party = {
  type: "object",
  properties: { name: str, address: str, contact: str, tin: str },
  required: ["name", "address", "contact", "tin"],
  additionalProperties: false,
};

// Every field is required so the model must state "not present" explicitly
// rather than silently dropping a key. Absent values are an empty string.
// blankToNull() turns the empty strings back into nulls after parsing.
// The API also caps the size of the compiled schema, and this one is close to
// that cap: adding a field usually means removing another. Prefer plain strings
// to enums, and test a real scan after any change here.
const DOC_SCHEMA = {
  type: "object",
  properties: {
    // A plain string (an enum costs schema size); the allowed names are in the instructions, and
    // anything else becomes "other" in documentType().
    doc_type_detected: str,
    document_number: str,
    bl_awb_number: str,
    booking_number: str,
    invoice_number: str,
    shipper: party,
    consignee: party,
    notify_party: party,
    vessel: str,
    voyage: str,
    port_of_loading: str,
    port_of_discharge: str,
    container_numbers: { type: "array", items: { type: "string" } },
    seal_numbers: { type: "array", items: { type: "string" } },
    gross_weight: num,
    net_weight: num,
    weight_unit: str,
    package_count: num,
    package_type: str,
    volume_cbm: num,
    goods_description: str,
    hs_codes: { type: "array", items: { type: "string" } },
    currency: str,
    incoterm: str,
    invoice_total: num,
    freight_amount: num,
    insurance_amount: num,
    issue_date: str,
    shipped_on_board_date: str,
    sps_must_ship_out_date: str,
    sps_valid_until: str,
    sps_permitted_weight: num,
    sps_permitted_weight_unit: str,
    country_of_origin: str,
    eta_date: str,
    carrier_name: str,
    un_number: str,
    dg_details: str,
    signed: str,
    stamped: str,
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: str,
          hs_code: str,
          quantity: num,
          unit_price: num,
          amount: num,
        },
        required: ["description", "hs_code", "quantity", "unit_price", "amount"],
        additionalProperties: false,
      },
    },
    notes: str,
  },
  required: [
    "doc_type_detected", "document_number", "bl_awb_number", "booking_number",
    "invoice_number", "shipper", "consignee", "notify_party", "vessel", "voyage",
    "port_of_loading", "port_of_discharge", "container_numbers", "seal_numbers", "gross_weight",
    "net_weight", "weight_unit", "package_count", "package_type", "volume_cbm",
    "goods_description", "hs_codes", "currency", "incoterm", "invoice_total", "freight_amount", "insurance_amount", "issue_date",
    "shipped_on_board_date", "sps_must_ship_out_date", "sps_valid_until", "sps_permitted_weight",
    "sps_permitted_weight_unit", "country_of_origin", "eta_date", "carrier_name", "un_number", "dg_details",
    "signed", "stamped", "line_items", "notes",
  ],
  additionalProperties: false,
} as const;

// One uploaded file can hold several documents (a BL, invoice and packing list
// scanned together), so the reply is a list with one entry per document.
export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: { documents: { type: "array", items: DOC_SCHEMA } },
  required: ["documents"],
  additionalProperties: false,
} as const;

const SYSTEM = `You read import shipping documents for a Philippine customs brokerage and transcribe their fields into JSON.

A file may hold one document or several bound together (for example a bill of lading, a commercial invoice, a packing list and certificates in one scan). Return one entry in "documents" for each distinct document, in the order they appear, and set doc_type_detected from what the document itself is, whatever the file is named. Fill each entry only from that document's own pages: never carry a value from the bill of lading into the invoice entry or the other way round. Use "other" for anything that is not on the list below, such as loading records or weighbridge tickets.

Documents may be in any language (Spanish, Chinese, Portuguese, Vietnamese, Thai...). Read them all; never skip or refuse one because of its language. Write goods_description, line item descriptions, package_type and notes in English, translating where needed, and add the original wording in brackets when it helps, e.g. "Frozen pork ears (Orejas de cerdo congeladas)". Keep names, addresses, numbers and codes as printed, in Latin letters (transliterate other scripts). Classify the document by what it is, whatever its language: a "Certificado de Origen" is a certificate_of_origin, a "Certificado Sanitario" or "Certificat sanitaire" a health_certificate.

Transcribe exactly what the document shows. Do not infer, normalise or correct values, and do not copy a value from one field into another. When a field is not on the document, return an empty string; for a missing list return an empty array. Write numbers as plain digits with a decimal point and no thousands separators, currency or units, e.g. 24500.00. The brokerage cross-checks these values between documents, so a guessed value is worse than a null.

Document types: set doc_type_detected to exactly one of these names: bill_of_lading, seaway_bill, telex_release, airway_bill, commercial_invoice, sales_contract, purchase_order, packing_list, container_list, payment_proof, bank_document, insurance_certificate, sps_import_clearance, mav_certificate, fda_permit, peza_permit, agency_permit, health_certificate, phytosanitary_certificate, halal_certificate, fumigation_certificate, certificate_of_origin, importer_accreditation, arrival_notice, permit, entry, assessment, release, delivery_receipt, other.
- bill_of_lading: an original or copy bill of lading (B/L, "Bill of Lading", negotiable).
- seaway_bill: a document titled Sea Waybill, Seaway Bill or Express Bill of Lading, which needs no original for release. A bill of lading stamped "Non-negotiable copy", "Copy" or "Draft" is still a bill_of_lading.
- telex_release: a bill of lading marked "TELEX RELEASE(D)", "SURRENDERED" or "ORIGINAL BL SURRENDERED", or a carrier's telex release message for a bill of lading. Fill its bill of lading fields the same way.
- airway_bill: a master or house Air Waybill (AWB / HAWB).
- commercial_invoice: an invoice for the goods (commercial, proforma or final invoice).
- sales_contract: a sales contract, sales confirmation or proforma contract between seller and buyer.
- purchase_order: a purchase order (PO) issued by the buyer.
- packing_list: a packing list or weight list.
- container_list: a container or seal list (container numbers with seal numbers, sizes and weights).
- payment_proof: proof of payment: bank remittance or telegraphic transfer (TT) advice, deposit slip, official receipt, payment confirmation.
- bank_document: a letter of credit (L/C), documentary collection (D/P or D/A) instruction or bank release of documents.
- insurance_certificate: a marine or cargo insurance certificate or policy.
- mav_certificate: a Minimum Access Volume (MAV) import certificate or allocation.
- fda_permit: a Philippine FDA licence, certificate of product registration or import permit.
- peza_permit: a PEZA import permit or authority.
- agency_permit: any other Philippine import permit or clearance: BPS Import Commodity Clearance (ICC), NTC, DENR-EMB, PDEA, FPA, SRA, BAI or BPI licence or permit.
- health_certificate: a veterinary or health certificate from the exporting country. phytosanitary_certificate: a phytosanitary certificate. halal_certificate: a halal certificate. fumigation_certificate: a fumigation or ISPM-15 treatment certificate.
- certificate_of_origin: a certificate of origin, including preferential forms (Form E, ATIGA Form D, AJCEP, AKFTA, RCEP); put the form name at the start of notes, e.g. "Form E".
- importer_accreditation: the importer's Bureau of Customs accreditation (CPRS / AMO) or similar registration.
For contracts and purchase orders, document_number is the contract or PO number, goods_description is the goods described, and line_items, currency and invoice_total are filled as for an invoice (invoice_total = the contract or order total). For proof of payment, document_number is the transaction or receipt reference, invoice_total is the amount paid and currency its currency.

Field guidance:
- bl_awb_number: the master or house Bill of Lading number, or the Air Waybill number. On an invoice or packing list, fill it only if a BL/AWB reference is printed.
- container_numbers: every container number: exactly 4 letters followed by 7 digits (e.g. EMCU5497406). Container lines are often printed as "container / seal / packages", e.g. "EMCU5497406/EMCUQM4413/2460 PLTS": there the second value is the seal, not another container. Anything that is not 4 letters + 7 digits belongs in seal_numbers, not here. Count containers by the "1 X 40RH" style summary when one is printed.
- gross_weight / net_weight: the shipment totals, as numbers without thousands separators; weight_unit is the unit printed (KG, LBS, MT).
- package_count: the total number of outer packages (cartons, pallets, crates), not the quantity of goods.
- invoice_total: the final total the invoice states is payable for the goods. line_items: each goods line with its quantity, unit price and line amount.
- goods_description: the description of goods as printed (for a BL, the "description of packages and goods" box).
- issue_date, shipped_on_board_date, sps_must_ship_out_date, sps_valid_until, eta_date: write these five as YYYY-MM-DD. Use them only for a full date printed on the document. Work out whether a date like 12/08/2026 is day-first or month-first from the document itself: other dates on it with a day above 12, its language, or the issuing country's custom (Europe, Latin America, Asia and the Philippines write the day first; the USA writes the month first). If a date is masked, partly illegible, or still could be read either way, return an empty string and say so in notes.
- shipped_on_board_date: the "shipped on board" / "laden on board" date of a bill of lading, or the flight date of an air waybill. It is not the date of issue unless the document says the goods were shipped on that date.
- Permits, certificates and accreditations of any kind (SPS, MAV, FDA, PEZA, agency permits, health and other certificates, importer accreditation): document_number is the permit or certificate number, issue_date the date issued, sps_valid_until the expiry or validity date, and sps_permitted_weight with sps_permitted_weight_unit the quantity allowed when stated as a weight (for MAV, the volume allocated). sps_must_ship_out_date is only for an SPS import clearance.
- sps_import_clearance is a Philippine Sanitary and Phytosanitary Import Clearance (SPSIC) from the Bureau of Animal Industry, Bureau of Plant Industry or BFAR. For it: document_number is the clearance number, consignee is the importer, shipper is the exporter or supplier, goods_description is the commodity, issue_date is the date issued, sps_must_ship_out_date is the "must ship out" date (the last day the goods may leave the origin), sps_valid_until is the validity or expiry date if printed separately, and sps_permitted_weight with sps_permitted_weight_unit is the quantity or volume allowed, when stated as a weight. Leave the sps_ fields empty on bills of lading, invoices, packing lists and other commercial papers.
- arrival_notice is the carrier's or agent's notice that the shipment is arriving. eta_date is the estimated date of arrival at the port of discharge (ETA), on an arrival notice or any other document that prints one; it is not the departure (ETD) date. carrier_name is the shipping line or airline carrying the goods, as printed on a bill of lading, air waybill or arrival notice.
- country_of_origin: as printed, on any document that states it.
- shipper, consignee, notify_party: contact is the telephone or mobile number printed with that party, as printed; leave it empty if only an email or nothing is shown.
- hs_codes: every HS / AHTN tariff code printed on the document. In line_items, hs_code is the code printed on that line, if any.
- seal_numbers: every container seal number, as printed.
- tin: the Tax Identification Number printed with that party, as printed.
- freight_amount and insurance_amount: the freight and insurance charges stated on the document (in its currency), when shown separately.
- un_number, dg_details: fill these only when the document declares dangerous goods; leave them empty otherwise. un_number is the UN number. dg_details is the rest as printed, in the form "Class 3; PG II; emergency contact +1 703 527 3887", leaving out any part the document does not show.
- signed: one of the words yes, no, unclear. Use "yes" if the document carries a handwritten or digital signature of its issuer, "no" if the signature space is blank or the document is marked draft / unsigned, "unclear" if you cannot tell. stamped: the same for an official stamp or seal (carrier, shipper, chamber of commerce, government agency).
- notes: anything a broker should notice, such as illegible areas, handwritten corrections, or several documents in one file. Otherwise an empty string.`;

/** Which model reads: "mixed" tries the low-cost model and re-reads with the top model when the reading is weak. */
export type ModelChoice = "mixed" | "top" | "fast";
export type ExtractOptions = { effort: "low" | "medium"; fast: boolean; split?: boolean; models?: ModelChoice; model?: string };

export type ExtractOutcome =
  | { ok: true; parts: Extracted[]; model: string; usage: unknown; ms: number; speed: string; segments: number; rereadWithTop?: boolean }
  | { ok: false; error: string };

type FileSource =
  | { type: "document"; source: { type: "url"; url: string } }
  | { type: "image"; source: { type: "url"; url: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg"; data: string } }
  | { type: "document"; source: { type: "text"; media_type: "text/plain"; data: string } };

/** One Claude call that must answer in the given JSON shape. Fast mode falls back to standard speed once. */
async function ask(
  client: Anthropic,
  opts: ExtractOptions,
  req: { system: string; schema: unknown; source: FileSource; text: string; maxTokens: number; effort?: "low" | "medium" },
) {
  const model = opts.model ?? MODEL;
  // Fast mode and the server-side refusal fallback exist on the top model only.
  const top = model === MODEL;
  const request = (fast: boolean) =>
    client.beta.messages.create({
      model,
      ...(fast && top ? { speed: "fast" as const } : {}),
      max_tokens: req.maxTokens,
      ...(top ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      system: req.system,
      output_config: {
        effort: req.effort ?? opts.effort,
        format: { type: "json_schema", schema: req.schema as Record<string, unknown> },
      },
      messages: [{ role: "user", content: [req.source, { type: "text", text: req.text }] }],
    });
  let response;
  try {
    response = await request(opts.fast);
  } catch (err) {
    // Fast mode has its own rate limit and is not on every account: fall back to standard speed once.
    const retryable = err instanceof Anthropic.RateLimitError || err instanceof Anthropic.BadRequestError ||
      err instanceof Anthropic.PermissionDeniedError;
    if (!opts.fast || !top || !retryable) throw err;
    response = await request(false);
  }
  if (response.stop_reason === "refusal") throw new ReadError("The model declined to read this document.");
  if (response.stop_reason === "max_tokens") throw new ReadError("The document was too long to extract in one pass.");
  const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const speed = (response.usage as { speed?: string | null } | undefined)?.speed ?? "standard";
  return { json: JSON.parse(text) as unknown, model: response.model, usage: response.usage as unknown, speed };
}

class ReadError extends Error {}

const pdfSource = (bytes: Uint8Array): FileSource => ({
  type: "document",
  source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) },
});

/** Read every document in one file (or one slice of a file) in a single call. */
async function readWhole(client: Anthropic, opts: ExtractOptions, source: FileSource, text: string) {
  const r = await ask(client, opts, { system: SYSTEM, schema: EXTRACTION_SCHEMA, source, text, maxTokens: 16000 });
  const parts = ((blankToNull(r.json) as { documents?: Extracted[] }).documents ?? [])
    .map((p) => numbersOf({ ...p, doc_type_detected: documentType(p.doc_type_detected) }));
  return { ...r, parts };
}

const SEGMENT_SCHEMA = {
  type: "object",
  properties: {
    documents: {
      type: "array",
      items: {
        type: "object",
        properties: { first_page: { type: "integer" }, last_page: { type: "integer" } },
        required: ["first_page", "last_page"],
        additionalProperties: false,
      },
    },
  },
  required: ["documents"],
  additionalProperties: false,
} as const;

export type PageRange = { first_page: number; last_page: number };

/** Page ranges are usable only if they cover pages 1..pageCount exactly once, in order. */
export function validRanges(ranges: unknown, pageCount: number): PageRange[] | null {
  if (!Array.isArray(ranges) || ranges.length === 0) return null;
  let next = 1;
  for (const r of ranges as PageRange[]) {
    if (!Number.isInteger(r?.first_page) || !Number.isInteger(r?.last_page)) return null;
    if (r.first_page !== next || r.last_page < r.first_page) return null;
    next = r.last_page + 1;
  }
  return next === pageCount + 1 ? (ranges as PageRange[]) : null;
}

/**
 * A PDF holding several documents is slow to read in one pass, because the reply is written
 * one document after another. Find where each document starts and ends, then read the
 * documents side by side. Returns null whenever that is not clearly safe; the caller then
 * reads the file in one pass as before.
 */
async function readSplit(client: Anthropic, opts: ExtractOptions, bytes: Uint8Array, name: string) {
  const pdf = await PDFDocument.load(bytes);
  const pageCount = pdf.getPageCount();
  if (pageCount < 3) return null;
  const found = await ask(client, opts, {
    system:
      "You are shown a scanned PDF from an import shipment file. It may hold one document or several bound together " +
      "(bill of lading, commercial invoice, packing list, certificates, permits, notices). Report where each distinct " +
      "document starts and ends. Every page belongs to exactly one document, in page order, with no gaps. Continuation " +
      "pages, attached sheets, riders and the reverse side of a document stay with that document. If you are unsure " +
      "whether a page starts a new document, keep it with the previous one.",
    schema: SEGMENT_SCHEMA,
    source: pdfSource(bytes),
    text: `This PDF has ${pageCount} pages, numbered 1 to ${pageCount}. List the first and last page of each document.`,
    maxTokens: 2000,
    effort: "low",
  });
  const ranges = validRanges((found.json as { documents?: unknown }).documents, pageCount);
  if (!ranges || ranges.length < 2) return null;
  const reads = await Promise.all(ranges.map(async (r) => {
    const slice = await PDFDocument.create();
    const idx = Array.from({ length: r.last_page - r.first_page + 1 }, (_, i) => r.first_page - 1 + i);
    for (const page of await slice.copyPages(pdf, idx)) slice.addPage(page);
    return readWhole(
      client, opts, pdfSource(await slice.save()),
      `File name: ${name} (pages ${r.first_page} to ${r.last_page} of ${pageCount})\nExtract the fields of every document in these pages.`,
    );
  }));
  const parts = reads.flatMap((r) => r.parts);
  if (reads.some((r) => r.parts.length === 0)) return null;
  return { parts, model: reads[0].model, usage: reads.map((r) => r.usage), speed: reads[0].speed, segments: ranges.length };
}

/**
 * A reading worth checking with the top model: nothing found, a transport document without its
 * BL / AWB number, an invoice without a total, or a note that part of the page could not be read.
 */
export function weakReading(parts: Extracted[]): boolean {
  if (parts.length === 0) return true;
  return parts.some((p) => {
    const t = p.doc_type_detected ?? "";
    if (["bill_of_lading", "seaway_bill", "telex_release", "airway_bill"].includes(t) && !p.bl_awb_number) return true;
    if (t === "commercial_invoice" && p.invoice_total == null) return true;
    return /illegib|unreadable|cannot (?:be )?read|could not (?:be )?read|blurr|cut off|obscured/i.test((p as { notes?: string | null }).notes ?? "");
  });
}

/**
 * A file to read. `url` is a short-lived private link the AI service fetches itself, so big scans
 * cost the server no work. `bytes` is there only for small files (splitting, text, or a fallback
 * when the link cannot be fetched).
 */
export type ReadFile = { bytes?: Uint8Array; url?: string; size: number; mime: string; name: string; declaredType: string };
/** Bundled PDFs up to this size are split and read side by side; bigger ones are read in one pass. */
export const SPLIT_MAX_BYTES = 3_000_000;
/** Files up to this size are also downloaded, as a fallback if the link cannot be fetched. */
export const BYTES_MAX = 6_000_000;

/** Read a file with the low-cost model first, and with the top model when that reading is weak or fails. */
export async function extractDocument(
  client: Anthropic,
  file: ReadFile,
  opts: ExtractOptions = { effort: "medium", fast: false },
): Promise<ExtractOutcome> {
  const choice = opts.models ?? "mixed";
  if (choice === "top") return extractWith(client, file, { ...opts, model: MODEL });
  const first = await extractWith(client, file, { ...opts, model: FAST_MODEL, fast: false });
  if (choice === "fast") return first;
  if (first.ok && !weakReading(first.parts)) return first;
  const second = await extractWith(client, file, { ...opts, model: MODEL });
  if (second.ok) return { ...second, ms: second.ms + (first.ok ? first.ms : 0), rereadWithTop: true };
  return first.ok ? first : second;
}

/** How the file is handed to the AI service: by link when there is one, else its contents. */
export function sourceFor(file: ReadFile, byLink: boolean): FileSource | null {
  const isPdf = file.mime === "application/pdf";
  // Excel sheets arrive converted to CSV text by the app.
  if (file.mime === "text/csv" || file.mime === "text/plain") {
    return file.bytes ? { type: "document", source: { type: "text", media_type: "text/plain", data: new TextDecoder().decode(file.bytes) } } : null;
  }
  if (byLink && file.url) return isPdf ? { type: "document", source: { type: "url", url: file.url } } : { type: "image", source: { type: "url", url: file.url } };
  if (!file.bytes) return null;
  return isPdf ? pdfSource(file.bytes)
    : { type: "image", source: { type: "base64", media_type: file.mime as "image/png" | "image/jpeg", data: toBase64(file.bytes) } };
}

async function extractWith(
  client: Anthropic,
  file: ReadFile,
  opts: ExtractOptions,
): Promise<ExtractOutcome> {
  const started = Date.now();
  const isPdf = file.mime === "application/pdf";
  try {
    if (isPdf && opts.split && file.bytes && file.size <= SPLIT_MAX_BYTES) {
      // Any trouble splitting (an unusual PDF, an unclear page list, a failed slice) falls through to the one-pass read.
      const split = await readSplit(client, opts, file.bytes, file.name).catch(() => null);
      if (split) return { ok: true, ...split, ms: Date.now() - started };
    }
    const text = `File name: ${file.name}\n${
      file.declaredType === "other" ? "" : `The uploader filed this as: ${file.declaredType}\n`
    }Extract the fields of every document in this file.`;
    const source = sourceFor(file, true);
    if (!source) return { ok: false, error: "The file could not be opened on the server." };
    let whole;
    try {
      whole = await readWhole(client, opts, source, text);
    } catch (err) {
      // The AI service could not fetch the private link: send the contents instead, if we have them.
      const fallback = source.source.type === "url" && err instanceof Anthropic.BadRequestError ? sourceFor(file, false) : null;
      if (!fallback) throw err;
      whole = await readWhole(client, opts, fallback, text);
    }
    if (whole.parts.length === 0) return { ok: false, error: "No document could be read from this file." };
    return { ok: true, parts: whole.parts, model: whole.model, usage: whole.usage, speed: whole.speed, segments: 1, ms: Date.now() - started };
  } catch (err) {
    if (err instanceof ReadError) return { ok: false, error: err.message };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: "Claude API rate limit reached. Try again shortly." };
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: "The Claude API key is missing or invalid." };
    if (err instanceof Anthropic.BadRequestError) return { ok: false, error: `Claude API rejected the request: ${err.message}` };
    if (err instanceof Anthropic.APIError) return { ok: false, error: `Claude API error (${err.status ?? "network"}): ${err.message}` };
    if (err instanceof SyntaxError) return { ok: false, error: "The model's reply was not valid JSON." };
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

/** The document types the reader may return, as named in the instructions. */
export const DOC_TYPES = [
  "bill_of_lading", "seaway_bill", "telex_release", "airway_bill", "commercial_invoice", "sales_contract",
  "purchase_order", "packing_list", "container_list", "payment_proof", "bank_document", "insurance_certificate",
  "sps_import_clearance", "mav_certificate", "fda_permit", "peza_permit", "agency_permit", "health_certificate",
  "phytosanitary_certificate", "halal_certificate", "fumigation_certificate", "certificate_of_origin",
  "importer_accreditation", "arrival_notice", "permit", "entry", "assessment", "release", "delivery_receipt", "other",
];
/** The reader's answer as one of DOC_TYPES ("Sea Waybill" -> seaway_bill); anything unknown is "other". */
export function documentType(v: unknown): string {
  const t = String(v ?? "").trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  if (DOC_TYPES.includes(t)) return t;
  if (/sea_?way/.test(t)) return "seaway_bill";
  if (/telex|surrender/.test(t)) return "telex_release";
  if (/air_?way|awb/.test(t)) return "airway_bill";
  if (/bill_of_lading|^b_?l$/.test(t)) return "bill_of_lading";
  if (/invoice/.test(t)) return "commercial_invoice";
  if (/contract/.test(t)) return "sales_contract";
  if (/purchase|^po$/.test(t)) return "purchase_order";
  if (/packing/.test(t)) return "packing_list";
  if (/payment|remittance|receipt_of_payment/.test(t)) return "payment_proof";
  if (/letter_of_credit|^l_?c$|documentary|bank/.test(t)) return "bank_document";
  if (/insurance/.test(t)) return "insurance_certificate";
  if (/container_list|seal_list/.test(t)) return "container_list";
  if (/^mav|minimum_access/.test(t)) return "mav_certificate";
  if (/fda/.test(t)) return "fda_permit";
  if (/peza/.test(t)) return "peza_permit";
  if (/phyto/.test(t)) return "phytosanitary_certificate";
  if (/halal/.test(t)) return "halal_certificate";
  if (/fumigat|ispm/.test(t)) return "fumigation_certificate";
  if (/health|veterinar/.test(t)) return "health_certificate";
  if (/origin|form_e|form_d|atiga|acfta/.test(t)) return "certificate_of_origin";
  if (/accredit|cprs/.test(t)) return "importer_accreditation";
  if (/^sps|sanitary/.test(t)) return "sps_import_clearance";
  if (/icc|ntc|denr|pdea|fpa|sra|bai|bpi|clearance/.test(t)) return "agency_permit";
  return "other";
}

const NUMBER_FIELDS = ["gross_weight", "net_weight", "volume_cbm", "invoice_total", "freight_amount", "insurance_amount", "sps_permitted_weight"] as const;
const LINE_NUMBER_FIELDS = ["quantity", "unit_price", "amount"] as const;

/** "24,500.00 KGS", "USD 1,234.5", "24500" -> a number; anything without a clear number -> null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/\s/g, ""); // \s also covers non-breaking spaces
  const m = t.match(/-?\d[\d,]*(?:\.\d+)?|-?\.\d+/);
  if (!m) return null;
  let n = m[0];
  // "1.234,56" (European) -> 1234.56; otherwise commas are thousands separators.
  if (/^\-?\d{1,3}(\.\d{3})+,\d+$/.test(t.match(/-?[\d.,]+/)?.[0] ?? "")) n = (t.match(/-?[\d.,]+/)![0]).replace(/\./g, "").replace(",", ".");
  else n = n.replace(/,/g, "");
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

const CONTAINER_RE = /^[A-Z]{4}\d{7}$/;
/**
 * A container number is 4 letters + 7 digits. Anything else the reader listed as a container (a seal
 * printed right after the container, e.g. "EMCU5497406/EMCUQM4413") is moved to the seal numbers.
 */
export function splitSeals(p: Extracted): Extracted {
  const listed = p.container_numbers ?? [];
  if (!listed.length) return p;
  const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const containers = listed.filter((c) => CONTAINER_RE.test(clean(c)));
  const seals = listed.filter((c) => !CONTAINER_RE.test(clean(c)) && clean(c));
  if (!seals.length) return p;
  const known = new Set((p.seal_numbers ?? []).map(clean));
  return { ...p, container_numbers: containers, seal_numbers: [...(p.seal_numbers ?? []), ...seals.filter((v) => !known.has(clean(v)))] };
}

/** Turns the number fields the model wrote as text back into numbers, and keeps seals out of the containers. */
export function numbersOf(p: Extracted): Extracted {
  const out: Record<string, unknown> = { ...splitSeals(p) };
  for (const k of NUMBER_FIELDS) out[k] = toNumber(out[k]);
  const pc = toNumber(out.package_count);
  out.package_count = pc == null ? null : Math.round(pc);
  if (Array.isArray(out.line_items)) {
    out.line_items = (out.line_items as NonNullable<Extracted["line_items"]>).map((l) => {
      const o: Record<string, unknown> = { ...l };
      for (const k of LINE_NUMBER_FIELDS) o[k] = toNumber(o[k]);
      return o;
    });
  }
  return out as Extracted;
}

/** Empty strings mean "not on the document"; store them as null. */
export function blankToNull(v: unknown): unknown {
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (Array.isArray(v)) return v.map(blankToNull).filter((x) => x !== null);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankToNull(x)]));
  }
  return v;
}

/** Fast conversion of file contents for sending (the old letter-by-letter way used up the server's time on big scans). */
function toBase64(bytes: Uint8Array): string {
  return encodeBase64(bytes);
}
