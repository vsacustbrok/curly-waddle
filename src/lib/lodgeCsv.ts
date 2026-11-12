// The office's daily lodge summary sheet as CSV: the same columns, in the same order, so an
// existing summary can be brought into the app and the app's shipments taken back out.
import type { Job, JobStatus } from "./types";

/** The column headings exactly as on the office sheet. The blank one is kept so columns line up. */
export const LODGE_HEADERS = [
  "PRO", "CONSIGNEE / ITEM DESCRIPTION", "B/L & AWB", "CONTAINER NO.", "SUPPLIER", "DP/CONTRACT", "ENTRY NO.",
  "COLOR", "STATUS", "YARD", "TRKG. / PLATE NO.", "DELIVERY ADD.", "REMARKS", "CRO", "PORT", "TICKET NO.",
  "REMARKS", "EMPTY RETURN", "RETURN DATE", "", "NOTE",
] as const;

type Key = "pro" | "consignee" | "bl" | "containers" | "supplier" | "dp" | "entry" | "color" | "status" | "yard"
  | "trucking" | "delivery" | "remarks" | "cro" | "port" | "ticket" | "remarks2" | "empty" | "returnDate" | "blank" | "note";
const KEYS: Key[] = ["pro", "consignee", "bl", "containers", "supplier", "dp", "entry", "color", "status", "yard",
  "trucking", "delivery", "remarks", "cro", "port", "ticket", "remarks2", "empty", "returnDate", "blank", "note"];

/** Splits CSV text into rows of cells. Handles quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  // Excel saves CSV with ";" in some regions; pick whichever separator the heading line uses most.
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** CSV text that Excel opens with the right letters (a byte-order mark first) and Windows line ends. */
export const toCsv = (rows: string[][]) => "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";

const p2 = (x: number) => String(x).padStart(2, "0");
/** YYYY-MM-DD as MM/DD/YYYY, the way the office sheet writes dates. */
export const sheetDate = (d: string | null | undefined) => (d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : "");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/**
 * A date typed on the sheet as YYYY-MM-DD. Accepts 11/12/2026 and 11/12/26 (month first, as in
 * Excel here), 2026-11-12, 12-Nov-2026 and Nov 12, 2026. Returns "" when it is not a date.
 */
export function parseSheetDate(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const full = (y: number) => (y < 100 ? 2000 + y : y);
  const ok = (y: number, m: number, d: number) =>
    y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate() ? `${y}-${p2(m)}-${p2(d)}` : "";
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return ok(full(+m[3]), +m[1], +m[2]);
  m = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{2,4})$/);
  if (m && MONTHS.includes(m[2].toLowerCase())) return ok(full(+m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = v.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m && MONTHS.includes(m[1].toLowerCase())) return ok(full(+m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return "";
}

/** One shipment as a row of the sheet. */
export function jobToSheetRow(j: Job): string[] {
  const consignee = [j.clients?.name, j.item_description].filter(Boolean).join(" / ");
  const trucking = [j.trucker_name, j.trucker_plate_no].filter(Boolean).join(" / ");
  const status = j.lodge_status || (j.entry_status ? j.entry_status.toUpperCase() : "");
  const cells: Record<Key, string> = {
    pro: j.job_no, consignee, bl: j.bl_awb_no ?? "", containers: (j.containers ?? []).join(" "), supplier: j.supplier ?? "",
    dp: j.dp_contract ?? "", entry: j.entry_no ?? "", color: (j.entry_color ?? "").toUpperCase(), status, yard: j.yard ?? "",
    trucking, delivery: j.delivery_address ?? "", remarks: j.lodge_remarks ?? "", cro: j.cro_no ?? "", port: j.port_of_discharge ?? "",
    ticket: j.ticket_no ?? "", remarks2: j.lodge_remarks_2 ?? "", empty: j.empty_return ?? "", returnDate: sheetDate(j.empty_return_date),
    blank: "", note: j.lodge_note ?? "",
  };
  return KEYS.map((k) => cells[k]);
}

const WEEKDAY = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
/**
 * The whole sheet, laid out like the office's: headings, then each lodge day under its own
 * "11/12/2026 - THURSDAY" line. Shipments not lodged yet come last under "NOT YET LODGED".
 */
export function lodgeSheet(jobs: Job[]): string[][] {
  const out: string[][] = [[...LODGE_HEADERS]];
  const blankRow = (label: string) => { const r = LODGE_HEADERS.map(() => ""); r[1] = label; return r; };
  const sorted = [...jobs].sort((a, b) => (a.entry_filed_date ?? "9999").localeCompare(b.entry_filed_date ?? "9999") || a.job_no.localeCompare(b.job_no));
  let day: string | null | undefined;
  for (const j of sorted) {
    if (j.entry_filed_date !== day) {
      day = j.entry_filed_date;
      out.push(blankRow(day ? `${sheetDate(day)} - ${WEEKDAY[new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)).getDay()]}` : "NOT YET LODGED"));
    }
    out.push(jobToSheetRow(j));
  }
  return out;
}

/** What one row of an imported sheet says, already tidied, with anything that could not be read. */
export type SheetRow = {
  line: number;
  /** The PRO as written (blank when the sheet had none or only a placeholder like "**"). */
  pro: string; clientName: string;
  /** The day heading the row sits under (for example "01/05 - MONDAY"), as YYYY-MM-DD. */
  lodgeDate: string;
  fields: Partial<{
    item_description: string; bl_awb_no: string; supplier: string; dp_contract: string; entry_no: string;
    entry_color: "red" | "orange" | "yellow"; entry_status: "filed" | "assessed" | "paid"; lodge_status: string; yard: string;
    container_at_yard_at: string; released_at: string;
    trucker_name: string; trucker_plate_no: string; delivery_address: string; lodge_remarks: string; cro_no: string; cro_valid_until: string;
    port_of_discharge: string; ticket_no: string; lodge_remarks_2: string; empty_return: string; empty_return_date: string; lodge_note: string;
  }>;
  containers: string[];
  /** A later stage the remarks name (released or delivered), if any. */
  stage: JobStatus | null;
  warnings: string[];
};

const norm = (h: string) => h.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Other headings older sheets use for the same column. */
const ALIASES: Partial<Record<Key, string[]>> = {
  consignee: ["CNEEITEMDESC", "CONSIGNEEDESC", "CONSIGNEE"], bl: ["BL", "BLAWB"], delivery: ["DELADD", "DELIVERYADDRESS"],
  trucking: ["TRKGPLATENO", "TRUCKINGPLATENO"], returnDate: ["RETURNDATE"],
};
const PLATE = /^[A-Z]{2,3}[\s-]?\d{3,5}$|^\d{4,6}$/i;
const DAY_ROW = /^(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\s*[-/]\s*[A-Z]+DAY\b/i;

/** "01/07/26 17:08 PM", "01/05/26 01:22 AM" or "01/03/23 09:47:41 AM" as a full timestamp, when the year is written. */
function sheetDateTime(text: string, after = ""): string {
  const m = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?/i);
  if (!m) return "";
  // No year written ("RELEASED 01/10 17:03"): the year of the lodge date, or the next one if the month has wrapped round.
  if (!m[3] && !after) return "";
  const year = m[3] ?? String(+after.slice(0, 4) + (+m[1] < +after.slice(5, 7) ? 1 : 0));
  const day = parseSheetDate(`${m[1]}/${m[2]}/${year}`);
  if (!day) return "";
  let h = +m[4];
  // "17:08 PM" is already 24-hour; only 1 to 12 with AM/PM needs converting.
  if (m[6] && h <= 12) h = m[6].toUpperCase() === "PM" ? (h % 12) + 12 : h % 12;
  if (h > 23 || +m[5] > 59) return "";
  return new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h, +m[5]).toISOString();
}

/**
 * Reads an office lodge summary. Finds the heading row even if title lines sit above it, follows
 * the day headings ("01/05 - MONDAY") for the date each entry was lodged, and accepts the older
 * headings (PRO#, CNEE / ITEM DESC., DEL. ADD.). `year` is used for day headings written without one.
 */
export function readLodgeSheet(text: string, year = new Date().getFullYear()): { rows: SheetRow[]; error: string } {
  const all = parseCsv(text);
  const isHeading = (r: string[]) => r.some((c) => norm(c).startsWith("PRO") && norm(c).length <= 4) && r.some((c) => norm(c) === "ENTRYNO");
  const head = all.findIndex(isHeading);
  if (head < 0) return { rows: [], error: 'This file has no heading row with "PRO" and "ENTRY NO." columns. Start from the template.' };
  // Match columns by their heading, so a sheet with columns moved around still reads right.
  // Several year tabs pasted one under another each bring their own heading row.
  const want = LODGE_HEADERS.map(norm);
  let col: Partial<Record<Key, number>> = {};
  let extra: { name: string; j: number }[] = [];
  const mapColumns = (heading: string[]) => {
    col = {};
    const used = new Set<number>();
    KEYS.forEach((k, i) => {
      if (k === "blank") return;
      const names = k === "pro" ? ["PRO"] : [want[i], ...(ALIASES[k] ?? [])];
      const at = heading.findIndex((c, j) => !used.has(j) && names.includes(norm(c)));
      if (at >= 0) { col[k] = at; used.add(at); }
    });
    // Any other columns (BILLED DATE, SOC, AMOUNT...) are kept in the note rather than lost.
    extra = heading.map((c, j) => ({ name: c.trim(), j })).filter(({ name, j }) => name && !used.has(j));
  };
  mapColumns(all[head]);

  const rows: SheetRow[] = [];
  let lodgeDate = "";
  for (let r = head + 1; r < all.length; r++) {
    if (isHeading(all[r])) { mapColumns(all[r]); lodgeDate = ""; continue; }
    const get = (k: Key) => (col[k] == null ? "" : (all[r][col[k]!] ?? "").trim());
    const dayCell = all[r].find((c) => DAY_ROW.test(c.trim()));
    if (dayCell && !/[A-Z0-9]{3,}/i.test(get("entry"))) {
      const m = dayCell.trim().match(DAY_ROW)!;
      lodgeDate = parseSheetDate(`${m[1]}/${m[2]}/${m[3] ?? year}`) || lodgeDate;
      continue;
    }
    if (/^NOT YET LODGED$/i.test(get("consignee")) && !get("pro") && !get("entry")) { lodgeDate = ""; continue; }
    const proRaw = get("pro").toUpperCase().replace(/\s+/g, "");
    const pro = /[A-Z]{2,}\d/.test(proRaw) && proRaw !== "NOPRO" ? proRaw : "";
    // Skip filler rows (dots, dashes) that carry no shipment.
    if (!pro && !get("consignee") && !get("bl") && !get("entry")) continue;
    const warnings: string[] = [];
    const f: SheetRow["fields"] = {};
    const put = <K extends keyof SheetRow["fields"]>(k: K, v: SheetRow["fields"][K] | "") => { if (v) f[k] = v as SheetRow["fields"][K]; };

    const [client, ...desc] = get("consignee").split("/");
    put("item_description", desc.join("/").trim());
    put("bl_awb_no", get("bl").toUpperCase().replace(/\.0$/, ""));
    put("supplier", get("supplier")); put("dp_contract", get("dp").replace(/\.0$/, "")); put("entry_no", get("entry"));
    put("delivery_address", get("delivery")); const cro = get("cro");
    if (parseSheetDate(cro)) f.cro_valid_until = parseSheetDate(cro); else put("cro_no", cro); put("port_of_discharge", get("port"));
    put("ticket_no", get("ticket")); put("lodge_remarks_2", get("remarks2")); put("empty_return", get("empty"));
    put("lodge_remarks", get("remarks"));
    const notes = [get("note"), ...extra.map(({ name, j }) => ((all[r][j] ?? "").trim() ? `${name}: ${(all[r][j] ?? "").trim()}` : ""))].filter(Boolean);
    put("lodge_note", notes.join(" · "));

    const yard = get("yard");
    put("yard", yard); put("container_at_yard_at", sheetDateTime(yard));

    // The colour column, or else the letter after the entry number (1173-Y, 652-R, 982-O).
    const color = get("color").toLowerCase().replace(/[^a-z]/g, "") || (get("entry").match(/-([ROY])\s*$/i)?.[1] ?? "").toLowerCase();
    const c = ({ r: "red", red: "red", o: "orange", orange: "orange", y: "yellow", yellow: "yellow" } as const)[color as "r"];
    if (c) f.entry_color = c; else if (color) warnings.push(`Color "${get("color")}" is not red, orange or yellow; left out.`);

    const status = get("status");
    if (/[A-Z]/i.test(status)) {
      f.lodge_status = status.toUpperCase();
      const st = status.toLowerCase();
      if (st === "filed" || st === "final") f.entry_status = "filed";
      else if (st === "assessed") f.entry_status = "assessed";
      else if (st === "paid") f.entry_status = "paid";
    }

    let stage: JobStatus | null = null;
    const remarks = get("remarks").toUpperCase();
    if (/\bDELIVERED\b/.test(remarks)) stage = "delivered";
    else if (/\bRELEASED\b/.test(remarks)) { stage = "released"; put("released_at", sheetDateTime(remarks, lodgeDate)); }

    const trk = get("trucking").replace(/\s+/g, " ");
    if (trk) {
      const parts = trk.split("/").map((x) => x.trim()).filter(Boolean);
      const words = trk.split(" ");
      if (parts.length >= 2) { f.trucker_name = parts.slice(0, -1).join(" / "); f.trucker_plate_no = parts[parts.length - 1].toUpperCase(); }
      else if (words.length >= 2 && PLATE.test(words[words.length - 1])) {
        f.trucker_name = words.slice(0, -1).join(" "); f.trucker_plate_no = words[words.length - 1].toUpperCase();
      } else if (PLATE.test(trk)) f.trucker_plate_no = trk.toUpperCase();
      else f.trucker_name = trk;
    }

    const rd = get("returnDate");
    const d = parseSheetDate(rd);
    if (d) f.empty_return_date = d; else if (rd) f.lodge_note = [f.lodge_note, `Return date: ${rd}`].filter(Boolean).join(" · ");

    const containers = [...new Set(get("containers").toUpperCase().split(/[\s,;/&]+|\bAND\b/).map((x) => x.trim()).filter((x) => /[A-Z]{4}\d{6,7}/.test(x)))];
    const leftover = get("containers").toUpperCase().split(/[\s,;/&]+/).filter((x) => x && !containers.includes(x));
    if (leftover.length) f.lodge_note = [f.lodge_note, `Container: ${get("containers")}`].filter(Boolean).join(" · ");
    // A row with no PRO and no entry number is another container of the shipment above
    // ("2 X 20' CNTR"): its container joins that shipment and its own details go in the note.
    const prev = rows[rows.length - 1];
    if (!pro && !f.entry_no && prev) {
      prev.containers = [...new Set([...prev.containers, ...containers])];
      const extraNote = [containers.join(" "), f.bl_awb_no && f.bl_awb_no !== prev.fields.bl_awb_no ? `BL ${f.bl_awb_no}` : "",
        yard, get("remarks"), f.trucker_plate_no ? `plate ${f.trucker_plate_no}` : ""].filter(Boolean).join(", ");
      if (extraNote) prev.fields.lodge_note = [prev.fields.lodge_note, extraNote].filter(Boolean).join(" · ");
      continue;
    }
    if (!pro && !f.entry_no && !f.bl_awb_no && !containers.length) continue;
    if (!pro) warnings.push(proRaw ? `PRO "${get("pro")}" is not a PRO number; a new PN will be given.` : "No PRO; a new PN will be given.");
    rows.push({ line: r + 1, pro, clientName: clientKey(client), lodgeDate, fields: f, containers, stage, warnings });
  }
  return { rows, error: rows.length ? "" : "No shipments were found under the heading row." };
}

/** A consignee name written the same way every time: INT'L → INTERNATIONAL, CORP. → CORPORATION, single spaces. */
export function clientKey(name: string): string {
  return name.toUpperCase().replace(/\bINT'?L\.?(?=\s|$)/g, "INTERNATIONAL").replace(/\bCORP\.?(?=\s|$)/g, "CORPORATION")
    .replace(/\bCO\.(?=\s|$)/g, "CO").replace(/\bINC\.(?=\s|$)/g, "INC").replace(/\s+/g, " ").replace(/[.,\s]+$/, "").trim();
}

/** The PN a sheet row is saved under: the PRO with the year added, as the office writes it (HCC04-225 → HCC04-225-26). */
export function pnFor(pro: string, lodgeDate: string, year: number): string {
  if (!pro) return "";
  if (!/^[A-Z]+\d{2,3}-\d+[A-Z]?$/.test(pro)) return pro; // already has a year or is in another form
  const yy = String(lodgeDate ? +lodgeDate.slice(0, 4) : year).slice(-2);
  return `${pro}-${yy}`;
}
