# VSA Customs Brokerage — Phase 1

Customs brokerage workflow site: shipments numbered by PN (project number), document upload, an AI
document check, a status board, daily status notes, reports, the office's daily lodge sheet as CSV,
role-based screens and an owner Security page. It holds the office's lodge history from 2017 onward.

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
| Owner | Everything: team roles, invitations, backups, activity log, delete or merge clients, delete shipments, move a shipment back |
| Processor | Create and edit shipments and clients, upload and delete documents, run checks, move shipments forward |
| Dispatcher | View shipments, upload documents, mark a shipment Released / Delivered |
| Billing | View shipments, edit clients, upload documents, mark a shipment Paid or Billed |
| Pending | Nothing until the owner assigns a role |

Sign-up is by invitation: only emails the owner lists on the Security page can create an account, and
each starts with the role chosen there. The database enforces every rule (row-level security and
triggers); the app only hides buttons a role cannot use.

## Shipments

- **Steps**: Pre-arrival → Lodged → Assessed (green) → Paid → Gatepass (orange) → TABS (blue) →
  Released / Delivered (yellow) → Billed. Released and Delivered are one step.
- **New shipment → From documents** creates a shipment from uploaded files alone: the check fills in the
  project details and sets the client from the consignee. One PDF may hold several documents.
- **Project details** follow the order of entry filing: shipment and client (item, supplier, client ref.),
  arrival (one row per container, warehouse), CRO and BL release (original, telex, SWB with their dates),
  entry filing (entry no., filed on, ticket, lodge code, DP/contract, status, colour once lodged, final SAD
  and SSDT with dates), gatepass ref. and date, TABS booking ref. and date and time, yard, trucker and plate,
  delivery address, empty return, remarks and notes. Dates are picked from a calendar. Earlier entries
  (trucker, plate, address, supplier, carrier, vessel, ports) are offered in drop-downs. Undo and Redo work
  on the form, and saving first lists every change, warning if the client ref., BL, entry no. or a
  container is already on another shipment.
- **Daily status report**: dated notes on each shipment. The comments from the office's Google Sheet were
  brought in as notes with their author and date. ASSESSED, GATEPASS, TABS and DELIVERED are coloured in notes.
- **Status board**: this year's shipments and any not lodged yet, every step through Billed. Click a column
  for its list, or ⬇ to download it as Excel for a processor. The search covers every field, and also
  finds matches in earlier years and in the daily notes.
- **Shipments**: filter by year, search every field, export to Excel.
- **Calendar**: shipments by ETA per month.
- **Reports**: my daily report (the owner sees everyone's), documents received per day, entry lodgement
  summary (weekly, monthly or yearly, with Excel export), shipments per client, and the daily lodge CSV.

## Daily lodge CSV

Reports → Daily lodge summary uses the office sheet's columns (PRO, CONSIGNEE / ITEM DESCRIPTION, B/L & AWB,
CONTAINER NO., SUPPLIER, DP/CONTRACT, ENTRY NO., COLOR, STATUS, YARD, TRKG. / PLATE NO., DELIVERY ADD.,
REMARKS, CRO, PORT, TICKET NO., REMARKS, EMPTY RETURN, RETURN DATE, NOTE). A blank template is in
`templates/vsa-daily-lodge-template.csv`.

- **Export** a date range, laid out like the sheet with a line for each lodge day.
- **Import** shows a preview and saves nothing until confirmed. Each row becomes a shipment, or updates the
  one with the same PRO (blank cells never erase). The reader (`src/lib/lodgeCsv.ts`) follows the sheet as
  written: day lines give the lodge date; older headings (PRO#, CNEE / ITEM DESC., DEL. ADD.) are accepted;
  the colour comes from the COLOR column or the entry number's letter; "VSA CBF8594" splits into trucker
  and plate; RELEASED or DELIVERED in the remarks makes the shipment Released / Delivered; rows with no PRO
  and no entry number are more containers of the shipment above; extra columns go into the note.
- The PRO gets the sheet's year (HCC04-225 → HCC04-225-26); the same PRO twice in a year becomes -2.
- Client names are grouped by the PRO's letter code and typo matching (`assignClients` in
  `src/pages/LodgeCsv.tsx`); the owner can merge any remaining duplicates on the Clients page.

The 2017–2026 lodge sheet (7,284 shipments) was imported this way. 2017–2025 shipments are Billed.

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
- A nightly job (`pg_cron`, 1:00 AM Manila) saves the business tables to `backups` and keeps the last 14,
  with a summary of the last 30 days of the activity log (the full log stays in the database). The owner
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
