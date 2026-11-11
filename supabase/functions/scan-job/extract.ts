// Field extraction with the Claude API (structured outputs).
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
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
    document_date: str,
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
    hazard_class: str,
    packing_group: str,
    dg_emergency_contact: str,
    signed: { type: "string", enum: ["yes", "no", "unclear"] },
    stamped: { type: "string", enum: ["yes", "no", "unclear"] },
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
    "doc_type_detected", "document_number", "document_date", "bl_awb_number", "booking_number",
    "invoice_number", "shipper", "consignee", "notify_party", "vessel", "voyage",
    "port_of_loading", "port_of_discharge", "container_numbers", "seal_numbers", "gross_weight",
    "net_weight", "weight_unit", "package_count", "package_type", "volume_cbm",
    "goods_description", "hs_codes", "currency", "incoterm", "invoice_total", "issue_date",
    "shipped_on_board_date", "sps_must_ship_out_date", "sps_valid_until", "sps_permitted_weight",
    "sps_permitted_weight_unit", "country_of_origin", "eta_date", "carrier_name", "un_number", "hazard_class", "packing_group",
    "dg_emergency_contact", "signed", "stamped", "line_items", "notes",
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
- issue_date, shipped_on_board_date, sps_must_ship_out_date, sps_valid_until, eta_date: write these five as YYYY-MM-DD. Use them only for a full date printed on the document; if a date is masked, partly illegible, or its day and month could be read either way, return an empty string and say so in notes. document_date stays exactly as printed.
- shipped_on_board_date: the "shipped on board" / "laden on board" date of a bill of lading, or the flight date of an air waybill. It is not the date of issue unless the document says the goods were shipped on that date.
- sps_import_clearance is a Philippine Sanitary and Phytosanitary Import Clearance (SPSIC) from the Bureau of Animal Industry, Bureau of Plant Industry or BFAR. For it: document_number is the clearance number, consignee is the importer, shipper is the exporter or supplier, goods_description is the commodity, issue_date is the date issued, sps_must_ship_out_date is the "must ship out" date (the last day the goods may leave the origin), sps_valid_until is the validity or expiry date if printed separately, and sps_permitted_weight with sps_permitted_weight_unit is the quantity or volume allowed, when stated as a weight. Leave the sps_ fields empty on every other kind of document.
- arrival_notice is the carrier's or agent's notice that the shipment is arriving. eta_date is the estimated date of arrival at the port of discharge (ETA), on an arrival notice or any other document that prints one; it is not the departure (ETD) date. carrier_name is the shipping line or airline carrying the goods, as printed on a bill of lading, air waybill or arrival notice.
- country_of_origin: as printed, on any document that states it.
- shipper, consignee, notify_party: contact is the telephone or mobile number printed with that party, as printed; leave it empty if only an email or nothing is shown.
- hs_codes: every HS / tariff code printed on the document.
- un_number, hazard_class, packing_group, dg_emergency_contact: fill these only when the document declares dangerous goods (for example "UN 1263, Class 3, PG II"); leave them empty otherwise.
- signed: "yes" if the document carries a handwritten or digital signature of its issuer, "no" if the signature space is blank or the document is marked draft / unsigned, "unclear" if you cannot tell. stamped: the same for an official stamp or seal (carrier, shipper, chamber of commerce, government agency).
- notes: anything a broker should notice, such as illegible areas, handwritten corrections, or several documents in one file. Otherwise an empty string.`;

export type ExtractOutcome =
  | { ok: true; parts: Extracted[]; model: string; usage: unknown }
  | { ok: false; error: string };

export async function extractDocument(
  client: Anthropic,
  file: { bytes: Uint8Array; mime: string; name: string; declaredType: string },
): Promise<ExtractOutcome> {
  const b64 = toBase64(file.bytes);
  const source =
    file.mime === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } } as const)
      : ({
        type: "image",
        source: { type: "base64", media_type: file.mime as "image/png" | "image/jpeg", data: b64 },
      } as const);

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{
        role: "user",
        content: [
          source,
          {
            type: "text",
            text: `File name: ${file.name}\n${
              file.declaredType === "other" ? "" : `The uploader filed this as: ${file.declaredType}\n`
            }Extract the fields of every document in this file.`,
          },
        ],
      }],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "The model declined to read this document." };
    }
    if (response.stop_reason === "max_tokens") {
      return { ok: false, error: "The document was too long to extract in one pass." };
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    const parsed = blankToNull(JSON.parse(text)) as { documents?: Extracted[] };
    const parts = parsed.documents ?? [];
    if (parts.length === 0) return { ok: false, error: "No document could be read from this file." };
    return { ok: true, parts, model: response.model, usage: response.usage };
  } catch (err) {
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
