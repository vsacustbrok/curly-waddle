// Field extraction with the Claude API (structured outputs).
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import type { Extracted } from "./crosscheck.ts";

export const MODEL = "claude-opus-5-5";

const nullable = (t: string) => ({ type: [t, "null"] });
const str = { type: "string" };
const party = {
  type: "object",
  properties: { name: str, address: str },
  required: ["name", "address"],
  additionalProperties: false,
};

// Every field is required so the model must state "not present" explicitly
// rather than silently dropping a key. Absent text is an empty string and only
// numbers are nullable: the API caps a schema at 16 union-typed parameters.
// blankToNull() turns the empty strings back into nulls after parsing.
export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    doc_type_detected: {
      type: "string",
      enum: [
        "bill_of_lading", "airway_bill", "commercial_invoice", "packing_list", "permit",
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
    "goods_description", "hs_codes", "currency", "incoterm", "invoice_total", "line_items", "notes",
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `You read import shipping documents for a Philippine customs brokerage and transcribe their fields into JSON.

Transcribe exactly what the document shows. Do not infer, normalise or correct values, and do not copy a value from one field into another. When a text field is not on the document, return an empty string; for a missing number return null; for a missing list return an empty array. The brokerage cross-checks these values between documents, so a guessed value is worse than a null.

Field guidance:
- bl_awb_number: the master or house Bill of Lading number, or the Air Waybill number. On an invoice or packing list, fill it only if a BL/AWB reference is printed.
- container_numbers: every container number, as printed (4 letters + 7 digits).
- gross_weight / net_weight: the shipment totals, as numbers without thousands separators; weight_unit is the unit printed (KG, LBS, MT).
- package_count: the total number of outer packages (cartons, pallets, crates), not the quantity of goods.
- invoice_total: the final total the invoice states is payable for the goods. line_items: each goods line with its quantity, unit price and line amount.
- goods_description: the description of goods as printed (for a BL, the "description of packages and goods" box).
- notes: anything a broker should notice, such as illegible areas, handwritten corrections, or several documents in one file. Otherwise an empty string.`;

export type ExtractOutcome =
  | { ok: true; data: Extracted & { notes?: string | null }; model: string; usage: unknown }
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
            text: `File name: ${file.name}\nThe uploader filed this as: ${file.declaredType}\nExtract the fields.`,
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
    const data = blankToNull(JSON.parse(text)) as Extracted;
    return { ok: true, data, model: response.model, usage: response.usage };
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
