// The words of a client status email. Kept apart from the sender so it can be tested.

export const STEP_WORDS: Record<string, string> = {
  pre_arrival: "Pre-arrival", lodged: "Entry lodged", assessed: "Entry assessed", paid: "Duties paid",
  gatepass: "Gatepass issued", tabs: "TABS booked", delivered: "Released / delivered", billed: "Billed",
};

export type Shipment = {
  job_no: string; client_ref_no: string | null; bl_awb_no: string | null; containers: string[] | null;
  vessel: string | null; voyage: string | null; eta: string | null; vessel_note: string | null;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function buildEmail(step: string, clientName: string, j: Shipment, portalUrl: string | null) {
  const stepWords = STEP_WORDS[step] ?? step;
  const ref = j.client_ref_no ? `your ref. ${j.client_ref_no}` : j.bl_awb_no ? `BL ${j.bl_awb_no}` : `PN ${j.job_no}`;
  const subject = `VSA Customs Brokerage: ${stepWords} (${ref})`;
  const rows: [string, string | null][] = [
    ["Status", stepWords],
    ["Our PN", j.job_no],
    ["Your reference", j.client_ref_no],
    ["BL / AWB", j.bl_awb_no],
    ["Containers", (j.containers ?? []).join(", ") || null],
    ["Vessel / voyage", [j.vessel, j.voyage].filter(Boolean).join(" / ") || null],
    ["ETA", j.eta],
    ["Latest vessel position", j.vessel_note],
  ];
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  const text = [
    `Dear ${clientName},`, "",
    `Your shipment (${ref}) has reached this step: ${stepWords}.`, "",
    ...shown.map(([k, v]) => `${k}: ${v}`), "",
    ...(portalUrl ? [`See all your shipments: ${portalUrl}`, ""] : []),
    "This is an automatic update from VSA Customs Brokerage. Reply to this email if you have questions.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d2a3a;max-width:560px">
<h2 style="color:#0b3a66;margin:0 0 12px">VSA Customs Brokerage</h2>
<p>Dear ${esc(clientName)},</p>
<p>Your shipment (${esc(ref)}) has reached this step: <strong>${esc(stepWords)}</strong>.</p>
<table style="border-collapse:collapse;margin:12px 0">${shown.map(([k, v]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#5b6b7d">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`).join("")}</table>
${portalUrl ? `<p><a href="${esc(portalUrl)}" style="background:#0b3a66;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">See all your shipments</a></p>` : ""}
<p style="color:#5b6b7d;font-size:12px">This is an automatic update from VSA Customs Brokerage. Reply to this email if you have questions.</p>
</div>`;
  return { subject, text, html };
}
