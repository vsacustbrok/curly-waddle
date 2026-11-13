// Uploading documents and running the scan, shared by the job file and the
// "new shipment from documents" screen.
import { supabase } from "./supabase";

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 15;
const MIME_OK = ["application/pdf", "image/png", "image/jpeg"];

/** Why a file cannot be uploaded, or null if it is fine. */
export function fileProblem(file: File): string | null {
  if (!MIME_OK.includes(file.type)) return `${file.name}: only PDF files and pictures (PNG, JPG, screenshots) are accepted`;
  if (file.size > MAX_BYTES) return `${file.name}: larger than 10 MB`;
  if (file.size === 0) return `${file.name}: the file is empty`;
  return null;
}

/**
 * Pictures in other formats (WebP, GIF, BMP, HEIC where the browser can open it) become JPG,
 * the format the document reader and storage take. PDF, PNG and JPG pass through unchanged.
 */
export async function toUploadable(file: File): Promise<File> {
  if (MIME_OK.includes(file.type) || !file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // the browser cannot open it; fileProblem explains
  }
}

/** A pasted screenshot has no useful name; give it one with the date and time. */
export function nameScreenshot(file: File): File {
  if (file.name && file.name !== "image.png") return file;
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  const ext = file.type === "image/jpeg" ? "jpg" : "png";
  return new File([file], `Screenshot ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`, { type: file.type });
}

export async function uploadDocs(jobId: string, originals: File[], docType: string, userId: string) {
  const problems: string[] = [];
  let uploaded = 0;
  const files = await Promise.all(originals.map(toUploadable));
  // Files go up side by side: the wait is for the slowest file, not the sum of them.
  await Promise.all(files.map(async (file) => {
    const problem = fileProblem(file);
    if (problem) { problems.push(problem); return; }
    const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
    const path = `${jobId}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from("job-docs").upload(path, file, { contentType: file.type });
    if (up.error) { problems.push(`${file.name}: ${up.error.message}`); return; }
    const ins = await supabase.from("job_documents").insert({
      job_id: jobId, doc_type: docType, file_path: path, file_name: file.name,
      mime_type: file.type, size_bytes: file.size, uploaded_by: userId,
    });
    if (ins.error) {
      await supabase.storage.from("job-docs").remove([path]);
      problems.push(`${file.name}: ${ins.error.message}`);
    } else uploaded++;
  }));
  return { uploaded, problems };
}

export type ScanOutcome = { error?: string; filled: string[] };

/** Read the job's documents, fill in its empty details and cross-check them. */
export async function runScan(jobId: string, force: boolean): Promise<ScanOutcome> {
  // Run the check in the same region as the database (Singapore): it makes many short
  // database calls, and from any other region each one crosses the ocean. The region goes
  // in the address rather than an x-region header, which the browser would have to pre-clear.
  const { data, error } = await supabase.functions.invoke("scan-job?forceFunctionRegion=ap-southeast-1", {
    body: { job_id: jobId, force },
  });
  if (error) {
    // Non-2xx: the function's own message is in the response body.
    const ctx = (error as { context?: Response }).context;
    const body = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    return { error: body?.error ?? error.message, filled: [] };
  }
  if (data?.error) return { error: data.error, filled: [] };
  return { filled: Array.isArray(data?.filled) ? data.filled : [] };
}
