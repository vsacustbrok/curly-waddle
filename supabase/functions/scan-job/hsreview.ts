// Stage 4 judgement check: do the invoice's item descriptions fit the HS / AHTN codes declared, and the
// goods named on the certificate of origin and permits? This is a judgement, so it is done by the top
// model, and it only ever adds warnings (yellow) for a broker to look at; it never blocks lodgment alone.
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { MODEL } from "./extract.ts";
import type { DocInput, Extracted, Issue } from "./crosscheck.ts";

const SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: { item: { type: "string" }, hs_code: { type: "string" }, problem: { type: "string" } },
        required: ["item", "hs_code", "problem"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
} as const;

const SYSTEM = `You help a licensed Philippine customs broker before an import entry is lodged with the Bureau of Customs.
You get the goods lines from the commercial invoice, each with the HS / AHTN code declared, and the goods and codes named on the certificate of origin and permits.

Report only clear problems: a line whose description plainly does not belong under the code given (wrong chapter or heading), or goods on the invoice that the certificate of origin or a permit does not cover. Do not report a line just because a more specific subheading might exist, a code is missing, or wording differs while meaning the same goods. When nothing is clearly wrong, return an empty list.

Write each problem as one plain sentence for office staff, naming the item and the code, with no jargon beyond the HS code itself.`;

/** The material the check looks at; returns null when there is nothing to compare. */
export function hsMaterial(docs: DocInput[]): string | null {
  const e = (d: DocInput) => d.extracted as Extracted;
  const lines = docs.filter((d) => d.extracted && d.doc_type === "commercial_invoice")
    .flatMap((d) => (e(d).line_items ?? []).map((l) => ({ desc: l.description ?? "", hs: l.hs_code ?? (e(d).hs_codes?.length === 1 ? e(d).hs_codes![0] : "") })))
    .filter((l) => l.desc && l.hs);
  if (!lines.length) return null;
  const others = docs.filter((d) => d.extracted && d.doc_type !== "commercial_invoice" && (e(d).hs_codes?.length || e(d).goods_description))
    .filter((d) => ["certificate_of_origin", "sps_import_clearance", "mav_certificate", "fda_permit", "peza_permit", "agency_permit", "permit"].includes(d.doc_type))
    .map((d) => `- ${d.doc_type.replace(/_/g, " ")}: goods "${e(d).goods_description ?? ""}", codes ${(e(d).hs_codes ?? []).join(", ") || "none shown"}`);
  return [
    "Invoice lines (description | HS code):",
    ...lines.slice(0, 60).map((l) => `- ${l.desc.slice(0, 200)} | ${l.hs}`),
    "",
    "Certificate of origin and permits:",
    ...(others.length ? others : ["- none on file"]),
  ].join("\n");
}

export async function hsReview(client: Anthropic, material: string): Promise<Issue[]> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: material }],
  });
  if (response.stop_reason !== "end_turn") return [];
  const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const findings = (JSON.parse(text) as { findings?: { item: string; hs_code: string; problem: string }[] }).findings ?? [];
  return findings.slice(0, 10).map((f) => ({
    severity: "warning" as const,
    check: "hs_description_review",
    message: f.problem,
    values: [{ source: "commercial invoice", value: `${f.item} (HS ${f.hs_code})` }],
  }));
}
