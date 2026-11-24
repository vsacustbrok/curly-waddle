// Off-site copy: one ZIP file with the latest nightly backup and the uploaded documents, one folder
// per PN, for the owner to keep on their own computer, a USB drive or a cloud drive.
export type DocRow = { id: string; file_path: string; file_name: string; size_bytes: number | null; uploaded_at: string; jobs?: { job_no: string | null } | null };
export type CopyRow = { id: number; made_at: string; files_included: number; bytes: number; only_new_since: string | null };

export const REMIND_AFTER_DAYS = 7;

/** Days since the last copy (null when there has never been one). */
export function daysSince(last: string | null | undefined, now = new Date()): number | null {
  if (!last) return null;
  return Math.floor((now.getTime() - new Date(last).getTime()) / 86_400_000);
}
export const copyIsDue = (last: string | null | undefined, now = new Date()) => {
  const d = daysSince(last, now);
  return d == null || d >= REMIND_AFTER_DAYS;
};

/** A file or folder name that is safe on Windows, Mac and phones. */
export function safeName(s: string): string {
  const cleaned = s.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return (cleaned || "file").slice(0, 120);
}

/** The path of each document inside the ZIP: documents/<PN>/<file name>, never two the same. */
export function zipPaths(docs: DocRow[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const d of docs) {
    const folder = safeName(d.jobs?.job_no || "no PN");
    const name = safeName(d.file_name || d.file_path.split("/").pop() || "file");
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let path = `documents/${folder}/${name}`;
    for (let i = 2; used.has(path.toLowerCase()); i++) path = `documents/${folder}/${stem} (${i})${ext}`;
    used.add(path.toLowerCase());
    out.set(d.id, path);
  }
  return out;
}

export function readme(made: Date, backupAt: string | null, files: number, missing: string[], since: string | null, photos = 0): string {
  return [
    "VSA Customs Brokerage - off-site copy",
    `Made: ${made.toLocaleString()}`,
    `Nightly backup inside: ${backupAt ? new Date(backupAt).toLocaleString() : "none yet"} (backup.json)`,
    since ? `Documents: only the ${files} uploaded since ${new Date(since).toLocaleString()} (keep the earlier copies too).` : `Documents: ${files} uploaded files, one folder per PN.`,
    ...(photos ? [`Rider photos (receipts, signed receiving copies): ${photos}, in "rider photos", one folder per day and rider.`] : []),
    ...(missing.length ? ["", "These files could not be downloaded and are NOT in this copy:", ...missing.map((m) => `- ${m}`)] : []),
    "",
    "Keep this file somewhere outside the system: a USB drive, an external disk or your own cloud drive.",
    "backup.json holds all shipments, clients, charges, payments, BIR documents and history; it can be restored by a developer.",
  ].join("\r\n");
}
