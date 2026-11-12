// Field extraction with the Claude API (structured outputs).
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import type { Extracted } from "./crosscheck.ts";

export const MODEL = "claude-opus-5-5";

const nullable = (t: string) => ({ type: [t, "null"] });
const str = { type: "string" };
const party = {
  type: "object",
  properties: { name: str, address: str, contact: str },
  required: ["name", "address", "contact"],
  additionalProperties: false,
};

// Every field is required so the model must state "not present" explicitly
// rather than silently dropping a key. Absent text is an empty string and only
// numbers are nullable: the API caps a schema at 16 union-typed parameters.
// blankToNull() turns the empty strings back into nulls after parsing.
// The API also caps the size of the compiled schema, and this one is close to
// that cap: adding a field usually means removing another. Prefer plain strings
// to enums, and test a real scan after any change here.
const DOC_SCHEMA = {
  type: "object",
  properties: {
    doc_type_detected: {
      type: "string",
      enum: [
        "bill_of_lading", "airway_bill", "commercial_invoice", "packing_list", "sps_import_clearance", "arrival_notice", "permit",
        "entry", "assessment", "payment_proof", "release", "delivery_receipt",
        "billing_statement", "other",
      ],
    },
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
    gross_weight: nullable("number"),
    net_weight: nullable("number"),
    weight_unit: str,
    package_count: nullable("integer"),
    package_type: str,
    volume_cbm: nullable("number"),
    goods_description: str,
    hs_codes: { type: "array", items: { type: "string" } },
    currency: str,
    incoterm: str,
    invoice_total: nullable("number"),
    issue_date: str,
    shipped_on_board_date: str,
    sps_must_ship_out_date: str,
    sps_valid_until: str,
    sps_permitted_weight: nullable("number"),
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
          quantity: nullable("number"),
          unit_price: nullable("number"),
          amount: nullable("number"),
        },
        required: ["description", "quantity", "unit_price", "amount"],
        additionalProperties: false,
      },
    },
    notes: str,
  },
  required: [
    "doc_type_detected", "document_number", "bl_awb_number", "booking_number",
    "invoice_number", "shipper", "consignee", "notify_party", "vessel", "voyage",
    "port_of_loading", "port_of_discharge", "container_numbers", "gross_weight",
    "net_weight", "weight_unit", "package_count", "package_type", "volume_cbm",
    "goods_description", "hs_codes", "currency", "incoterm", "invoice_total", "issue_date",
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

A file may hold one document or several bound together (for example a bill of lading, a commercial invoice, a packing list and certificates in one scan). Return one entry in "documents" for each distinct document, in the order they appear, and set doc_type_detected from what the document itself is, whatever the file is named. Fill each entry only from that document's own pages: never carry a value from the bill of lading into the invoice entry or the other way round. Use "other" for certificates, loading records and anything else that is not on the list.

Transcribe exactly what the document shows. Do not infer, normalise or correct values, and do not copy a value from one field into another. When a text field is not on the document, return an empty string; for a missing number return null; for a missing list return an empty array. The brokerage cross-checks these values between documents, so a guessed value is worse than a null.

Field guidance:
- bl_awb_number: the master or house Bill of Lading number, or the Air Waybill number. On an invoice or packing list, fill it only if a BL/AWB reference is printed.
- container_numbers: every container number, as printed (4 letters + 7 digits).
- gross_weight / net_weight: the shipment totals, as numbers without thousands separators; weight_unit is the unit printed (KG, LBS, MT).
- package_count: the total number of outer packages (cartons, pallets, crates), not the quantity of goods.
- invoice_total: the final total the invoice states is payable for the goods. line_items: each goods line with its quantity, unit price and line amount.
- goods_description: the description of goods as printed (for a BL, the "description of packages and goods" box).
- issue_date, shipped_on_board_date, sps_must_ship_out_date, sps_valid_until, eta_date: write these five as YYYY-MM-DD. Use them only for a full date printed on the document; if a date is masked, partly illegible, or its day and month could be read either way, return an empty string and say so in notes.
- shipped_on_board_date: the "shipped on board" / "laden on board" date of a bill of lading, or the flight date of an air waybill. It is not the date of issue unless the document says the goods were shipped on that date.
- sps_import_clearance is a Philippine Sanitary and Phytosanitary Import Clearance (SPSIC) from the Bureau of Animal Industry, Bureau of Plant Industry or BFAR. For it: document_number is the clearance number, consignee is the importer, shipper is the exporter or supplier, goods_description is the commodity, issue_date is the date issued, sps_must_ship_out_date is the "must ship out" date (the last day the goods may leave the origin), sps_valid_until is the validity or expiry date if printed separately, and sps_permitted_weight with sps_permitted_weight_unit is the quantity or volume allowed, when stated as a weight. Leave the sps_ fields empty on every other kind of document.
- arrival_notice is the carrier's or agent's notice that the shipment is arriving. eta_date is the estimated date of arrival at the port of discharge (ETA), on an arrival notice or any other document that prints one; it is not the departure (ETD) date. carrier_name is the shipping line or airline carrying the goods, as printed on a bill of lading, air waybill or arrival notice.
- country_of_origin: as printed, on any document that states it.
- shipper, consignee, notify_party: contact is the telephone or mobile number printed with that party, as printed; leave it empty if only an email or nothing is shown.
- hs_codes: every HS / tariff code printed on the document.
- un_number, dg_details: fill these only when the document declares dangerous goods; leave them empty otherwise. un_number is the UN number. dg_details is the rest as printed, in the form "Class 3; PG II; emergency contact +1 703 527 3887", leaving out any part the document does not show.
- signed: one of the words yes, no, unclear. Use "yes" if the document carries a handwritten or digital signature of its issuer, "no" if the signature space is blank or the document is marked draft / unsigned, "unclear" if you cannot tell. stamped: the same for an official stamp or seal (carrier, shipper, chamber of commerce, government agency).
- notes: anything a broker should notice, such as illegible areas, handwritten corrections, or several documents in one file. Otherwise an empty string.`;

export type ExtractOptions = { effort: "low" | "medium"; fast: boolean; split?: boolean };

export type ExtractOutcome =
  | { ok: true; parts: Extracted[]; model: string; usage: unknown; ms: number; speed: string; segments: number }
  | { ok: false; error: string };

type FileSource =
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg"; data: string } };

/** One Claude call that must answer in the given JSON shape. Fast mode falls back to standard speed once. */
async function ask(
  client: Anthropic,
  opts: ExtractOptions,
  req: { system: string; schema: unknown; source: FileSource; text: string; maxTokens: number; effort?: "low" | "medium" },
) {
  const request = (fast: boolean) =>
    client.beta.messages.create({
      model: MODEL,
      ...(fast ? { speed: "fast" as const } : {}),
      max_tokens: req.maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
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
    if (!opts.fast || !retryable) throw err;
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
  const parts = (blankToNull(r.json) as { documents?: Extracted[] }).documents ?? [];
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

export async function extractDocument(
  client: Anthropic,
  file: { bytes: Uint8Array; mime: string; name: string; declaredType: string },
  opts: ExtractOptions = { effort: "medium", fast: false },
): Promise<ExtractOutcome> {
  const started = Date.now();
  const isPdf = file.mime === "application/pdf";
  try {
    if (isPdf && opts.split) {
      // Any trouble splitting (an unusual PDF, an unclear page list, a failed slice) falls through to the one-pass read.
      const split = await readSplit(client, opts, file.bytes, file.name).catch(() => null);
      if (split) return { ok: true, ...split, ms: Date.now() - started };
    }
    const source: FileSource = isPdf ? pdfSource(file.bytes) : {
      type: "image",
      source: { type: "base64", media_type: file.mime as "image/png" | "image/jpeg", data: toBase64(file.bytes) },
    };
    const whole = await readWhole(
      client, opts, source,
      `File name: ${file.name}\n${
        file.declaredType === "other" ? "" : `The uploader filed this as: ${file.declaredType}\n`
      }Extract the fields of every document in this file.`,
    );
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

/** Empty strings mean "not on the document"; store them as null. */
export function blankToNull(v: unknown): unknown {
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (Array.isArray(v)) return v.map(blankToNull).filter((x) => x !== null);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankToNull(x)]));
  }
  return v;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
