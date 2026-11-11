// Uploading documents and running the scan, shared by the job file and the
// "new shipment from documents" screen.
import { supabase } from "./supabase";

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 15;
const MIME_OK = ["application/pdf", "image/png", "image/jpeg"];

/** Why a file cannot be uploaded, or null if it is fine. */
export function fileProblem(file: File): string | null {
  if (!MIME_OK.includes(file.type)) return `${file.name}: only PDF, PNG or JPG files are accepted`;
  if (file.size > MAX_BYTES) return `${file.name}: larger than 10 MB`;
  if (file.size === 0) return `${file.name}: the file is empty`;
  return null;
}

export async function uploadDocs(jobId: string, files: File[], docType: string, userId: string) {
  const problems: string[] = [];
  let uploaded = 0;
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
