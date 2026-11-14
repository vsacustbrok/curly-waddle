# VSA Customs Brokerage app: notes for Claude

A customs brokerage workflow app for VSA Customs Brokerage (Philippines). The owner is not a
developer: explain changes in plain words, without code terms.

- Web app: Vite + React + TypeScript in `src/`, hosted on Vercel.
- Data, logins and files: Supabase (`supabase/migrations/`, edge function `supabase/functions/scan-job/`).
- Never ask for secrets in chat. API keys live in Supabase Edge Function secrets.
- Clean up test data by exact ids only.

## Skills codex

Use these skills at the moments below. They are already available; invoke them with the Skill tool.

| Skill | When to use it |
|---|---|
| `security-review` | Before more staff or clients get access, and after any change to roles or row-level security. Check who can see or change shipment, billing and client data. |
| `engineering:code-review` | After big changes (billing, the document reader, imports), before they go live. |
| `engineering:deploy-checklist` | Before each website or database update, so nothing breaks for staff during working hours. |
| `design:accessibility-review`, `design:ux-copy` | When changing screens or labels, to keep them easy to read and clear for encoders. |
| `operations:process-doc`, `operations:runbook` | When writing staff guides, e.g. how to encode a new shipment or print the Billing Statement. |
| `xlsx`, `pdf` | For Excel reports and printable documents beyond what the app already makes. |
| `small-business:invoice-chase` | For follow-up messages to clients with overdue balances, using the Collections list. |
