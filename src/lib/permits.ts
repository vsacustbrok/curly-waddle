// Permits and accreditations: which have lapsed, which lapse soon, for a client or the office.

export const PERMIT_KINDS = ["boc_accreditation", "sps_clearance", "fda_lto", "fda_cpr", "nmis", "broker_license", "business_permit", "bir_registration", "other"] as const;
export type PermitKind = (typeof PERMIT_KINDS)[number];
export const PERMIT_LABEL: Record<PermitKind, string> = {
  boc_accreditation: "BOC importer accreditation", sps_clearance: "SPS import clearance (BPI / BAI / BFAR)", fda_lto: "FDA License to Operate",
  fda_cpr: "FDA product registration (CPR)", nmis: "NMIS accreditation", broker_license: "Customs broker license (PRC)",
  business_permit: "Business / Mayor's permit", bir_registration: "BIR registration", other: "Other",
};
/** Days before expiry when the warning starts. */
export const WARN_DAYS = 30;

export type Permit = {
  id: number; client_id: string | null; kind: PermitKind; title: string | null; reference_no: string | null;
  issued_on: string | null; expires_on: string; note: string | null; renewed: boolean; clients?: { name: string } | null;
};
export type PermitState = "expired" | "soon" | "ok" | "renewed";

const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const daysLeft = (expires: string, today: string) => Math.round((utc(expires) - utc(today)) / 86400000);

/** Expired after its expiry day; "soon" within WARN_DAYS; a permit marked renewed never warns. */
export function stateOf(p: Pick<Permit, "expires_on" | "renewed">, today: string): PermitState {
  if (p.renewed) return "renewed";
  const d = daysLeft(p.expires_on, today);
  return d < 0 ? "expired" : d <= WARN_DAYS ? "soon" : "ok";
}

export const permitName = (p: Pick<Permit, "kind" | "title">) => (p.title?.trim() ? `${PERMIT_LABEL[p.kind]}: ${p.title.trim()}` : PERMIT_LABEL[p.kind]);

/** A plain sentence for a warning: "BOC importer accreditation expired 3 days ago (Nov 21)". */
export function warningText(p: Pick<Permit, "kind" | "title" | "expires_on">, today: string): string {
  const d = daysLeft(p.expires_on, today);
  const when = d < 0 ? `expired ${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "expires today" : `expires in ${d} day${d === 1 ? "" : "s"}`;
  return `${permitName(p)} ${when}`;
}

/** The warnings that matter for one client's shipment: lapsed or lapsing, newest problem first. */
export function clientWarnings(permits: Permit[], clientId: string, today: string): Permit[] {
  return permits.filter((p) => p.client_id === clientId && ["expired", "soon"].includes(stateOf(p, today)))
    .sort((a, b) => a.expires_on.localeCompare(b.expires_on));
}
