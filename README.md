# VSA Customs Brokerage — Phase 1

Customs brokerage workflow site: shipments numbered by PN (project number), document upload, an AI
document check, a status board, an Excel export, role-based screens and an owner Security page.

Live site: https://vsa-brokerage-vsacb.vercel.app

## Parts

| Part | Where |
|---|---|
| Web app (Vite + React + TypeScript) | `src/` |
| Document check Edge Function | `supabase/functions/scan-job/` |
| Database changes | `supabase/migrations/` (Supabase project `xskvjxbvkgysvwlotjpf`) |
| Logo and background photo (public `site-assets` bucket) | copies in `supabase/site-assets/` |

## Roles

| Role | Can do |
|---|---|
| Owner | Everything: team roles, invitations, backups, activity log, delete shipments and clients, move a shipment back |
| Processor | Create and edit shipments and clients, upload and delete documents, run checks, move shipments forward |
| Dispatcher | View shipments, upload documents, mark a shipment Delivered |
| Billing | View shipments, edit clients, upload documents, mark a shipment Paid or Billed |
| Pending | Nothing until the owner assigns a role |

Sign-up is by invitation: only emails the owner lists on the Security page can create an account, and
each starts with the role chosen there. The database enforces every rule (row-level security and
triggers); the app only hides buttons a role cannot use.

## Shipments

- **New shipment → From documents** creates a shipment from uploaded files alone: the check fills in the
  project details and sets the client from the consignee. One PDF may hold several documents.
- Each shipment has a PN (editable; blank numbers it automatically), entry number, ticket number and,
  once lodged, an entry colour (red, orange, yellow).
- The status board shows each shipment's latest check result. **Shipments** lists everything read from
  the documents and exports it to Excel.

## Document check (`scan-job`)

`POST /functions/v1/scan-job?forceFunctionRegion=ap-southeast-1` with `{ "job_id": "<uuid>", "force": false }`,
signed in as owner or processor.

1. Reads every unread file with the Claude API (`extract.ts`). A PDF holding several documents is split
   and its documents are read side by side. The fields are saved to `job_documents.extracted`, with timing.
2. Checks the documents against each other in plain code: `crosscheck.ts` (parties, BL number, containers
   with ISO 6346 check digit, weights, packages, invoice arithmetic, goods), `sps.ts` (SPS import clearance
   against the bill of lading: importer, must-ship-out date, weight within 3%) and `extra.ts` (notify party,
   addresses, HS codes, dangerous goods, net weight, volume, Incoterms, origin, signatures and stamps).
3. Writes the findings and the time taken to `scan_results`.

Settings live in `app_settings` (key `scan`): `effort`, `fast` (fast mode, about twice the API cost),
`split` and `concurrency`. It needs one secret on the Supabase project: `ANTHROPIC_API_KEY`.

## Security and backups

- Role helpers live in the `private` schema, out of reach of the public API.
- Every change to shipments, clients, documents, team and invitations is written to `audit_log`; the owner
  sees it on the Security page.
- A nightly job (`pg_cron`, 1:00 AM Manila) saves every table to `backups` and keeps the last 14. The owner
  downloads them from the Security page. Uploaded files are not included.

## Develop

```bash
npm install
npm run dev
```

Checker unit tests:

```bash
deno test supabase/functions/scan-job/
```
