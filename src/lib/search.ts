// Searching shipments by anything typed into them: PN, client, references, BL, containers,
// entry, ticket, CRO, gatepass, TABS, trucker, plate, address, item, supplier, remarks, notes...
import { supabase } from "./supabase";

const SKIP = new Set(["id", "client_id", "processor_id", "created_by", "scan_results", "job_documents", "created_at", "updated_at"]);

/** Every value typed into a shipment (and its client and processor names) as one lower-case text. */
export function searchText(job: object): string {
  const parts: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (v == null) return;
    if (typeof v === "string") parts.push(v);
    else if (typeof v === "number") parts.push(String(v));
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth));
    else if (typeof v === "object" && depth < 3) {
      for (const [k, x] of Object.entries(v)) if (!SKIP.has(k)) walk(x, depth + 1);
    }
  };
  walk(job, 0);
  return parts.join(" \u0001 ").toLowerCase();
}

/** True when every word of the search appears somewhere in the shipment ("hexagon msc" finds both). */
export function matchesSearch(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => text.includes(w));
}

/** Text columns searched in the database (all years). */
const COLUMNS = [
  "job_no", "client_ref_no", "bl_awb_no", "booking_no", "entry_no", "ticket_no", "item_description", "supplier", "dp_contract",
  "vessel", "voyage", "carrier", "cro_no", "trucker_name", "trucker_plate_no", "delivery_address", "port_of_discharge",
  "port_of_destination", "yard", "lodge_status", "lodge_remarks", "lodge_remarks_2", "lodge_note", "notes", "gatepass_ref",
  "tabs_ref", "empty_return",
];

export type FoundJob = { id: string; job_no: string; status: string; entry_filed_date: string | null; clients: { name: string } | null };

/**
 * Shipments in any year whose details, client name, containers or daily status notes contain the search.
 * Each word must match somewhere; the first (longest) word picks the candidates, the rest narrow them.
 */
export async function searchAllYears(query: string, limit = 200): Promise<FoundJob[]> {
  const words = query.trim().split(/\s+/).map((w) => w.replace(/[,()*%\\"]/g, "")).filter((w) => w.length >= 2);
  if (!words.length) return [];
  const key = [...words].sort((a, b) => b.length - a.length)[0];
  const like = `%${key}%`;
  const [byField, byClient, byNote, byContainer] = await Promise.all([
    supabase.from("jobs").select("id").or(COLUMNS.map((c) => `${c}.ilike.${like}`).join(",")).limit(1000),
    supabase.from("clients").select("id").ilike("name", like).limit(200),
    supabase.from("job_notes").select("job_id").ilike("body", like).limit(1000),
    /^[A-Za-z]{4}\d{6,7}$/.test(key) ? supabase.from("jobs").select("id").contains("containers", [key.toUpperCase()]) : Promise.resolve({ data: [] }),
  ]);
  const ids = new Set<string>([
    ...(byField.data ?? []).map((r) => r.id as string),
    ...(byNote.data ?? []).map((r) => r.job_id as string),
    ...((byContainer.data ?? []) as { id: string }[]).map((r) => r.id),
  ]);
  const clientIds = (byClient.data ?? []).map((r) => r.id as string);
  const select = "id, job_no, status, entry_filed_date, clients(name), " + COLUMNS.filter((c) => c !== "job_no").join(", ") + ", containers";
  const rows: (FoundJob & Record<string, unknown>)[] = [];
  const idList = [...ids];
  for (let i = 0; i < idList.length && rows.length < 2000; i += 150) {
    const { data } = await supabase.from("jobs").select(select).in("id", idList.slice(i, i + 150));
    rows.push(...((data ?? []) as unknown as (FoundJob & Record<string, unknown>)[]));
  }
  if (clientIds.length) {
    const { data } = await supabase.from("jobs").select(select).in("client_id", clientIds.slice(0, 50)).order("entry_filed_date", { ascending: false }).limit(1000);
    for (const r of (data ?? []) as unknown as (FoundJob & Record<string, unknown>)[]) if (!ids.has(r.id)) { ids.add(r.id); rows.push(r); }
  }
  // The other words must also appear (in the details, or in the notes when the note matched the main word).
  const noteIds = new Set((byNote.data ?? []).map((r) => r.job_id as string));
  const rest = words.filter((w) => w !== key);
  return rows
    .filter((r) => noteIds.has(r.id) || matchesSearch(searchText(r), rest.join(" ")))
    .sort((a, b) => (b.entry_filed_date ?? "9999").localeCompare(a.entry_filed_date ?? "9999"))
    .slice(0, limit);
}
