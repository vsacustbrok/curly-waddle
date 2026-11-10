// scan-job: read a job's shipping documents with Claude, save the extracted
// fields on each job_documents row, cross-check them in code, and write the
// findings to scan_results.
//
// POST { job_id: uuid, force?: boolean }
//   force=false (default) only extracts documents that have not been read yet.
//
// Callers must be signed in with role owner or processor. Writes use the
// service role because job_documents has no UPDATE policy and scan_results has
// no INSERT policy for app users; this function is the only writer.
import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { crossCheck, type DocInput } from "./crosscheck.ts";
import { extractDocument, MODEL } from "./extract.ts";

const SCAN_ROLES = new Set(["owner", "processor"]);
const EXTRACT_TYPES = new Set(["bill_of_lading", "airway_bill", "commercial_invoice", "packing_list"]);
const MAX_DOCS = 15;
const CONCURRENCY = 3;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // --- who is calling? ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: "Your session has expired. Sign in again." }, 401);
  const userId = userData.user.id;

  const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!profile || !SCAN_ROLES.has(profile.role)) {
    return json({ error: "Only the owner or a processor can run a document scan." }, 403);
  }

  // --- input ---
  let body: { job_id?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (!body.job_id || !UUID_RE.test(body.job_id)) return json({ error: "job_id must be a UUID" }, 400);
  const force = body.force === true;

  const { data: job, error: jobErr } = await admin
    .from("jobs")
    .select("id, job_no, bl_awb_no, containers, vessel, voyage, port_of_discharge, clients(name)")
    .eq("id", body.job_id)
    .maybeSingle();
  if (jobErr) return json({ error: jobErr.message }, 500);
  if (!job) return json({ error: "Job not found" }, 404);

  const { data: docs, error: docsErr } = await admin
    .from("job_documents")
    .select("id, doc_type, file_path, file_name, mime_type, extracted, extract_error")
    .eq("job_id", job.id)
    .order("uploaded_at");
  if (docsErr) return json({ error: docsErr.message }, 500);

  const relevant = (docs ?? []).filter((d) => EXTRACT_TYPES.has(d.doc_type)).slice(0, MAX_DOCS);
  const toExtract = relevant.filter((d) => force || !d.extracted);

  // --- extraction ---
  const extractErrors: Array<{ doc_id: string; file_name: string; error: string }> = [];
  if (toExtract.length) {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return json({ error: "ANTHROPIC_API_KEY is not set on the Supabase project (Edge Function secrets)." }, 500);
    }
    const anthropic = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });

    const queue = [...toExtract];
    const worker = async () => {
      for (let d = queue.shift(); d; d = queue.shift()) {
        const { data: blob, error: dlErr } = await admin.storage.from("job-docs").download(d.file_path);
        let outcome;
        if (dlErr || !blob) {
          outcome = { ok: false as const, error: `Could not download file: ${dlErr?.message ?? "missing"}` };
        } else {
          const mime = d.mime_type || blob.type || "application/pdf";
          outcome = await extractDocument(anthropic, {
            bytes: new Uint8Array(await blob.arrayBuffer()),
            mime,
            name: d.file_name,
            declaredType: d.doc_type,
          });
        }
        const now = new Date().toISOString();
        if (outcome.ok) {
          const extracted = { ...outcome.data, _model: outcome.model };
          await admin.from("job_documents")
            .update({ extracted, extracted_at: now, extract_error: null })
            .eq("id", d.id);
          d.extracted = extracted;
          d.extract_error = null;
        } else {
          await admin.from("job_documents")
            .update({ extract_error: outcome.error, extracted_at: now })
            .eq("id", d.id);
          d.extract_error = outcome.error;
          extractErrors.push({ doc_id: d.id, file_name: d.file_name, error: outcome.error });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  }

  // --- cross-check ---
  const client = Array.isArray(job.clients) ? job.clients[0] : job.clients;
  const docInputs: DocInput[] = relevant.map((d) => ({
    id: d.id,
    file_name: d.file_name,
    doc_type: d.doc_type,
    extracted: d.extracted as DocInput["extracted"],
  }));
  const { issues, matches } = crossCheck(
    {
      bl_awb_no: job.bl_awb_no,
      containers: job.containers,
      vessel: job.vessel,
      voyage: job.voyage,
      port_of_discharge: job.port_of_discharge,
      client_name: (client as { name?: string } | null)?.name ?? null,
    },
    docInputs,
  );
  for (const e of extractErrors) {
    issues.unshift({
      severity: "error",
      check: "extraction",
      message: `Could not read ${e.file_name}: ${e.error}`,
      values: [],
    });
  }
  // Earlier failures that were not retried this run still matter.
  for (const d of relevant) {
    if (!d.extracted && d.extract_error && !extractErrors.some((e) => e.doc_id === d.id)) {
      issues.unshift({ severity: "error", check: "extraction", message: `Could not read ${d.file_name}: ${d.extract_error}`, values: [] });
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.length - errorCount;
  const { data: scan, error: scanErr } = await admin
    .from("scan_results")
    .insert({
      job_id: job.id,
      run_by: userId,
      docs_scanned: docInputs.filter((d) => d.extracted).length,
      error_count: errorCount,
      warning_count: warningCount,
      issues,
      matches,
    })
    .select()
    .single();
  if (scanErr) return json({ error: scanErr.message }, 500);

  return json({
    scan,
    extracted_now: toExtract.length - extractErrors.length,
    skipped_types: (docs ?? []).filter((d) => !EXTRACT_TYPES.has(d.doc_type)).length,
    model: MODEL,
  });
});
