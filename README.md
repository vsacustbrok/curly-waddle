# VSA Brokerage — Phase 1

Customs brokerage workflow site: job files, document upload, a status board, role-based screens, and an
AI document scan that cross-checks the shipping documents on a job.

## Parts

| Part | Where |
|---|---|
| Web app (Vite + React + TypeScript) | `src/` |
| Document scan Edge Function | `supabase/functions/scan-job/` |
| Database, security rules, `job-docs` bucket | Supabase project `xskvjxbvkgysvwlotjpf` |

## Roles

| Role | Can do |
|---|---|
| Owner | Everything: team roles, delete jobs/clients, move a job back, activity log |
| Processor | Create and edit jobs and clients, upload/delete documents, run scans, move jobs forward |
| Dispatcher | View jobs, upload documents, mark a job Delivered |
| Billing | View jobs, edit clients, upload documents, mark a job Paid or Billed |
| Pending | Nothing until the owner assigns a role |

The first account to sign up becomes the owner. The database enforces every rule; the app only hides
buttons a role cannot use.

## Document scan (`scan-job`)

`POST /functions/v1/scan-job` with `{ "job_id": "<uuid>", "force": false }`, signed in as owner or processor.

1. Reads each Bill of Lading / Airway Bill, Commercial Invoice and Packing List with the Claude API
   (`extract.ts`) and saves the fields to `job_documents.extracted`.
2. Cross-checks the fields in plain code (`crosscheck.ts`): shipper, consignee, BL number, container
   numbers (with ISO 6346 check digit), gross weight, package count, invoice arithmetic and goods description.
3. Writes the findings to `scan_results`.

It needs one secret on the Supabase project: `ANTHROPIC_API_KEY` (Dashboard → Edge Functions → Secrets).

## Develop

```bash
npm install
npm run dev
```

Cross-check unit tests:

```bash
deno test supabase/functions/scan-job/crosscheck_test.ts
```
