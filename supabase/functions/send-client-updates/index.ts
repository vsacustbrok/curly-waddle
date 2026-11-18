// Sends the queued client status emails (client_notifications) through Resend.
// Called every 5 minutes by pg_cron, only while something is queued. The caller must send the
// random token kept in Vault; anyone else gets 401. Needs the RESEND_API_KEY secret, which the
// owner adds in Supabase Edge Function secrets. Optional secrets: RESEND_FROM (the sender, once the
// office domain is verified in Resend) and APP_URL (the website address used in the client link).
import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { buildEmail, type Shipment } from "./email.ts";

const STALE_DAYS = 3;
const MAX_ATTEMPTS = 3;

type Row = {
  id: number; step: string; to_email: string; attempts: number;
  jobs: Shipment | null;
  clients: { name: string; portal_token: string | null; portal_enabled: boolean } | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: ok } = await db.rpc("check_client_updates_token", { t: req.headers.get("x-cron-token") ?? "" });
  if (ok !== true) return new Response("Unauthorized", { status: 401 });

  // Old news is not sent: clients would get a pile of stale updates at once.
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString();
  await db.from("client_notifications")
    .update({ status: "skipped", error: `Not sent: still waiting after ${STALE_DAYS} days (was the email key set up?).` })
    .eq("status", "queued").lt("created_at", cutoff);

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    await db.from("client_notifications").update({ error: "Waiting: the email key (RESEND_API_KEY) is not set up yet." }).eq("status", "queued");
    return Response.json({ sent: 0, waiting: "no RESEND_API_KEY" });
  }
  const from = Deno.env.get("RESEND_FROM") || "VSA Customs Brokerage <onboarding@resend.dev>";
  const appUrl = (Deno.env.get("APP_URL") || "https://vsa-brokerage-vsacb.vercel.app").replace(/\/+$/, "");

  const { data, error } = await db.from("client_notifications")
    .select("id, step, to_email, attempts, jobs(job_no, client_ref_no, bl_awb_no, containers, vessel, voyage, eta, vessel_note), clients(name, portal_token, portal_enabled)")
    .eq("status", "queued").order("id").limit(25);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0, failed = 0;
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!r.jobs || !r.clients) {
      await db.from("client_notifications").update({ status: "skipped", error: "The shipment or client no longer exists." }).eq("id", r.id);
      continue;
    }
    const portal = r.clients.portal_enabled && r.clients.portal_token ? `${appUrl}/track/${r.clients.portal_token}` : null;
    const mail = buildEmail(r.step, r.clients.name, r.jobs, portal);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `client-update-${r.id}` },
        body: JSON.stringify({ from, to: [r.to_email], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (res.ok) {
        await db.from("client_notifications").update({ status: "sent", sent_at: new Date().toISOString(), error: null, attempts: r.attempts + 1 }).eq("id", r.id);
        sent++;
      } else {
        const body = (await res.text()).slice(0, 300);
        const attempts = r.attempts + 1;
        await db.from("client_notifications").update({
          status: attempts >= MAX_ATTEMPTS || res.status < 500 && res.status !== 429 ? "failed" : "queued",
          error: `Email service said ${res.status}: ${body}`, attempts,
        }).eq("id", r.id);
        failed++;
      }
    } catch (e) {
      const attempts = r.attempts + 1;
      await db.from("client_notifications").update({ status: attempts >= MAX_ATTEMPTS ? "failed" : "queued", error: `Could not reach the email service: ${(e as Error).message}`, attempts }).eq("id", r.id);
      failed++;
    }
  }
  return Response.json({ sent, failed });
});
