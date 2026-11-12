// scan-job: read a job's uploaded files with Claude, save what was read on each
// job_documents row, fill empty job details from the documents, cross-check the
// documents in code, and write the findings to scan_results.
//
// POST { job_id: uuid, force?: boolean }
//   force=false (default) only reads files that have not been read yet.
//
// Callers must be signed in with role owner or processor. Writes use the
// service role because job_documents has no UPDATE policy and scan_results has
// no INSERT policy for app users; this function is the only writer.
import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { crossCheck, type Issue } from "./crosscheck.ts";
import { extractDocument, MODEL } from "./extract.ts";
import { consigneeOf, etaOf, jobPatch, PLACEHOLDER_CLIENT, primaryType, sameCompany, toDocInputs } from "./assemble.ts";
import { spsChecks } from "./sps.ts";
import { extraChecks } from "./extra.ts";

const SCAN_ROLES = new Set(["owner", "processor"]);
const MAX_DOCS = 15;

type ScanSettings = { effort: "low" | "medium"; fast: boolean; split: boolean; concurrency: number };
/** Settings from app_settings ("scan" row), with safe defaults; a request may override effort and fast. */
function scanSettings(stored: unknown, body: { effort?: unknown; fast?: unknown; split?: unknown }): ScanSettings {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const effort = body.effort ?? s.effort;
  const fast = body.fast ?? s.fast;
  const n = Number(s.concurrency);
  return {
    effort: effort === "low" ? "low" : "medium",
    fast: fast === true,
    // Read the documents inside a multi-document PDF side by side. On unless switched off.
    split: (body.split ?? s.split) !== false,
    concurrency: Number.isFinite(n) ? Math.min(6, Math.max(1, Math.round(n))) : 4,
  };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELD_LABELS: Record<string, string> = {
  bl_awb_no: "BL / AWB no.",
  booking_no: "Booking no.",
  vessel: "Vessel",
  voyage: "Voyage",
  port_of_discharge: "Port of discharge",
  containers: "Containers",
  eta: "ETA",
  carrier: "Carrier",
  client_id: "Client",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const startedAt = Date.now();

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
  let body: { job_id?: string; force?: boolean; effort?: unknown; fast?: unknown; split?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (!body.job_id || !UUID_RE.test(body.job_id)) return json({ error: "job_id must be a UUID" }, 400);
  const force = body.force === true;
  const { data: settingsRow } = await admin.from("app_settings").select("value").eq("key", "scan").maybeSingle();
  const settings = scanSettings(settingsRow?.value, body);

  const { data: job, error: jobErr } = await admin
    .from("jobs")
    .select("id, job_no, client_id, bl_awb_no, booking_no, containers, vessel, voyage, port_of_discharge, eta, carrier, clients(name)")
    .eq("id", body.job_id)
    .maybeSingle();
  if (jobErr) return json({ error: jobErr.message }, 500);
  if (!job) return json({ error: "Job not found" }, 404);

  const { data: allDocs, error: docsErr } = await admin
    .from("job_documents")
    .select("id, doc_type, file_path, file_name, mime_type, extracted, extract_error")
    .eq("job_id", job.id)
    .order("uploaded_at");
  if (docsErr) return json({ error: docsErr.message }, 500);

  const docs = (allDocs ?? []).slice(0, MAX_DOCS);
  const toExtract = docs.filter((d) => force || !d.extracted);
  const issues: Issue[] = [];

  // --- read the files ---
  const failedNow = new Set<string>();
  if (toExtract.length) {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return json({ error: "ANTHROPIC_API_KEY is not set on the Supabase project (Edge Function secrets)." }, 500);
    }
    const anthropic = new Anthropic({ apiKey, maxRetries: 1, timeout: 110_000 });

    const queue = [...toExtract];
    const worker = async () => {
      for (let d = queue.shift(); d; d = queue.shift()) {
        const { data: blob, error: dlErr } = await admin.storage.from("job-docs").download(d.file_path);
        let outcome;
        if (dlErr || !blob) {
          outcome = { ok: false as const, error: `Could not download file: ${dlErr?.message ?? "missing"}` };
        } else {
          outcome = await extractDocument(anthropic, {
            bytes: new Uint8Array(await blob.arrayBuffer()),
            mime: d.mime_type || blob.type || "application/pdf",
            name: d.file_name,
            declaredType: d.doc_type,
          }, settings);
        }
        const now = new Date().toISOString();
        if (outcome.ok) {
          const extracted = { parts: outcome.parts, _model: outcome.model, _ms: outcome.ms, _speed: outcome.speed, _segments: outcome.segments };
          // Files uploaded without a type ("other") are filed under what was found in them.
          const detected = d.doc_type === "other" ? primaryType(outcome.parts) : null;
          const update: Record<string, unknown> = { extracted, extracted_at: now, extract_error: null };
          if (detected && detected !== d.doc_type) update.doc_type = detected;
          const { error: upErr } = await admin.from("job_documents").update(update).eq("id", d.id);
          if (upErr) {
            d.extract_error = `Could not save what was read: ${upErr.message}`;
            failedNow.add(d.id);
            continue;
          }
          d.extracted = extracted;
          d.extract_error = null;
          if (update.doc_type) d.doc_type = update.doc_type as string;
        } else {
          // A failed re-read must not leave the old reading in place looking current.
          await admin.from("job_documents")
            .update({ extracted: null, extract_error: outcome.error, extracted_at: now })
            .eq("id", d.id);
          d.extracted = null;
          d.extract_error = outcome.error;
          failedNow.add(d.id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(settings.concurrency, queue.length) }, worker));
  }

  for (const d of docs) {
    if (!d.extracted && d.extract_error) {
      issues.push({ severity: "error", check: "extraction", message: `Could not read ${d.file_name}: ${d.extract_error}`, values: [] });
    }
  }
  if ((allDocs ?? []).length > MAX_DOCS) {
    issues.push({
      severity: "warning",
      check: "extraction",
      message: `This job has ${(allDocs ?? []).length} files; only the first ${MAX_DOCS} are scanned.`,
      values: [],
    });
  }

  // --- fill empty job details from the documents ---
  const inputs = toDocInputs(docs.filter((d) => d.extracted));
  const clientRow = Array.isArray(job.clients) ? job.clients[0] : job.clients;
  let clientName: string | null = (clientRow as { name?: string } | null)?.name ?? null;
  const patch: Record<string, unknown> = { ...jobPatch(job, inputs) };

  // An ETA already on the job is never overwritten, but a different date on the documents is worth knowing.
  const docEta = etaOf(inputs);
  if (job.eta && docEta && docEta.date !== job.eta) {
    issues.push({
      severity: "warning",
      check: "eta",
      message: `The documents show ETA ${docEta.date}, but the job has ETA ${job.eta}. Update the job if the arrival date has changed.`,
      values: [{ source: "job: ETA", value: job.eta }, { source: docEta.source, value: docEta.date }],
    });
  }

  if (clientName === PLACEHOLDER_CLIENT) {
    const consignee = consigneeOf(inputs);
    if (consignee) {
      const { data: clients, error: cErr } = await admin.from("clients").select("id, name");
      if (cErr) {
        issues.push({ severity: "warning", check: "client", message: `Could not look up clients: ${cErr.message}`, values: [] });
      } else {
        const match = (clients ?? []).find((c) => c.name !== PLACEHOLDER_CLIENT && sameCompany(c.name, consignee.name));
        if (match) {
          patch.client_id = match.id;
          clientName = match.name;
        } else {
          const { data: created, error: insErr } = await admin
            .from("clients")
            .insert({ name: consignee.name, address: consignee.address, created_by: userId })
            .select("id, name")
            .single();
          if (insErr || !created) {
            issues.push({
              severity: "warning",
              check: "client",
              message: `Could not create a client for consignee ${consignee.name}: ${insErr?.message ?? "unknown error"}`,
              values: [],
            });
          } else {
            patch.client_id = created.id;
            clientName = created.name;
          }
        }
      }
    }
  }

  let filled: string[] = [];
  if (Object.keys(patch).length) {
    const { error: patchErr } = await admin.from("jobs").update(patch).eq("id", job.id);
    if (patchErr) {
      issues.push({
        severity: "warning",
        check: "job_details",
        message: `The job details could not be filled in from the documents: ${patchErr.message}`,
        values: [],
      });
    } else {
      Object.assign(job, patch);
      filled = Object.keys(patch).map((k) => FIELD_LABELS[k] ?? k);
    }
  }

  // --- cross-check ---
  const checked = crossCheck(
    {
      bl_awb_no: job.bl_awb_no,
      containers: job.containers,
      vessel: job.vessel,
      voyage: job.voyage,
      port_of_discharge: job.port_of_discharge,
      client_name: clientName === PLACEHOLDER_CLIENT ? null : clientName,
    },
    inputs,
  );
  const sps = spsChecks(inputs);
  const extra = extraChecks(inputs, toDocInputs(docs.filter((d) => d.extracted), null), new Date().toISOString().slice(0, 10));
  issues.push(...checked.issues, ...sps.issues, ...extra.issues);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const { data: scan, error: scanErr } = await admin
    .from("scan_results")
    .insert({
      job_id: job.id,
      run_by: userId,
      docs_scanned: docs.filter((d) => d.extracted).length,
      error_count: errorCount,
      warning_count: issues.length - errorCount,
      duration_ms: Date.now() - startedAt,
      issues,
      matches: [...checked.matches, ...sps.matches, ...extra.matches],
    })
    .select()
    .single();
  if (scanErr) return json({ error: scanErr.message }, 500);

  return json({
    scan,
    extracted_now: toExtract.length - failedNow.size,
    filled,
    client: patch.client_id ? clientName : null,
    model: MODEL,
    settings,
    timing: {
      total_ms: Date.now() - startedAt,
      files: docs.map((d) => ({ file_name: d.file_name, ms: (d.extracted as { _ms?: number } | null)?._ms ?? null })),
    },
  });
});
