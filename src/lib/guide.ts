// Staff guide: short step-by-step procedures for the everyday tasks, shown on the Help page.
// Each guide lists who does it, when, the steps, and what to do when something is off.
// Keep the button and page names exactly as they appear in the app.
import type { Role } from "./types";

export type Guide = {
  id: string;
  title: string;
  roles: Role[];           // who sees this guide first; everyone can open all of them
  who: string;
  when: string;
  steps: string[];
  whatIf: [string, string][];
  link?: { to: string; label: string };
};

const OFFICE: Role[] = ["owner", "processor", "billing", "dispatcher"];

export const GUIDES: Guide[] = [
  {
    id: "new-shipment", title: "Encode a new shipment from the documents", roles: ["owner", "processor"],
    who: "Processor or owner", when: "As soon as the shipping documents arrive from the client or the shipping line.",
    steps: [
      "Open New shipment.",
      "Click Choose documents and pick the bill of lading or airway bill, commercial invoice and packing list (PDF or photos, up to 10 MB each). Several documents scanned into one PDF are fine. Add the certificate of origin and other permits too.",
      "Click Create shipment from … file(s) and wait while the app reads them. It shows how many seconds have passed.",
      "Check the summary that appears: client, BL / AWB no., containers, vessel, ETA. If a duplicate is warned, open the existing PN instead.",
      "Click to confirm. The new PN opens; look at the Document check box and fix anything shown in red or yellow.",
    ],
    whatIf: [
      ["A document was not read (\"unread\")", "On the shipment, in Document check, click Re-read all. If it still fails, check the file opens on your computer and upload a clearer copy."],
      ["The document is in Chinese, Thai or another language", "That is fine: the app reads it and records the details in English."],
      ["A seal number shows up as a container number", "Correct it on the shipment (Edit) and tell the owner, so the reader can be improved."],
      ["No documents yet but the shipment must be opened", "Use Or enter the details by hand on the New shipment page."],
    ],
    link: { to: "/jobs/new", label: "Open New shipment" },
  },
  {
    id: "documents", title: "Add documents and read the Document check", roles: ["owner", "processor"],
    who: "Processor or owner", when: "Whenever a new or corrected document comes in for a PN.",
    steps: [
      "Open the shipment (search its PN on the Status board).",
      "In Documents, click + Add documents and choose the files. The app reads them on its own.",
      "Read the Document check: green means the documents agree; red or yellow lists what does not match (for example, a weight or container number that differs between the BL and the packing list).",
      "Fix the shipment details or ask the client for a corrected document. Click Mark reviewed when a finding has been checked and is acceptable.",
    ],
    whatIf: [
      ["The same file was uploaded twice", "The app skips the copy; nothing to do."],
      ["Reading takes very long or shows an error", "Wait a minute and click Re-read all. Very large scans (over 10 MB) should be split or re-scanned in black and white."],
    ],
  },
  {
    id: "board", title: "Move a shipment to its next step", roles: OFFICE,
    who: "Processor or owner; Billing moves to Paid and Billed; Dispatcher moves to Released / Delivered", when: "Each time a shipment moves forward: lodged, assessed, paid, gatepass, TABS, delivered, billed.",
    steps: [
      "On the Status board, drag the PN card onto the next column, or click Move ▾ on the card and choose the step.",
      "Answer the question that appears (for example, the entry number when moving to Lodged).",
      "If you moved the wrong card, click Undo in the note that appears above the board, straight away.",
      "Add a line in the shipment's Daily status report (Add update) for anything the next person should know.",
    ],
    whatIf: [
      ["\"Enter the entry number before moving a brokerage job to Lodged\"", "Open the shipment, fill in the entry number, then move it."],
      ["A card cannot be moved back to an earlier step", "Only the owner can move a shipment back. Ask the owner."],
      ["Billed is not offered", "A shipment can be marked Billed only from Released / Delivered."],
    ],
    link: { to: "/", label: "Open the Status board" },
  },
  {
    id: "audit", title: "Pre-Lodgment Audit and duties estimate", roles: ["owner", "processor"],
    who: "Processor prepares; a licensed customs broker approves", when: "Before encoding the entry for BOC lodgment.",
    steps: [
      "Open Pre-Lodgment Audit and choose the PN.",
      "Check Shipping documents and fill in Lodgment details, then Save lodgment details.",
      "Go through the stages; every 🔴 must be fixed, every 🟡 checked. Click a finding to see what it compared.",
      "Open Duties and taxes to see the estimate; it is a guide to check against the BOC assessment.",
      "The licensed broker reads the Broker sign-off and clicks Approve for BOC lodgment.",
      "Use Export for VASP encoding to copy the details into the BOC system.",
    ],
    whatIf: [
      ["A tariff rate is missing (\"rate needed\")", "The owner adds the AHTN code and rate in Duty rates; until then, type the rate on the line."],
      ["The BOC assessment differs from the estimate", "Note the difference in the Daily status report and tell the owner; rates or exchange rate may need updating."],
    ],
    link: { to: "/pre-lodgment-audit", label: "Open Pre-Lodgment Audit" },
  },
  {
    id: "billing", title: "Bill a shipment and print the Billing Statement", roles: ["owner", "billing"],
    who: "Billing staff or owner", when: "When the shipment is released or delivered and all costs are known.",
    steps: [
      "Open the shipment and scroll to Billing.",
      "Click Add charge for each item: brokerage fee, trucking, arrastre, and so on. Tick Advance for client for amounts you paid on the client's behalf (duties and taxes, shipping line charges); these carry no VAT.",
      "Check the totals, then click Print Billing Statement (and Print Statement of Charges when there are advances).",
      "Send the statement to the client, then move the shipment to Billed on the Status board.",
    ],
    whatIf: [
      ["A charge was entered wrongly", "Click Remove on that line and add it again. Charges already on a sales invoice cannot be removed; void the invoice first (see the BIR guide)."],
      ["The duties estimate should be billed", "In the Duties page, use Add to billing; it is added as an advance."],
    ],
  },
  {
    id: "bir", title: "Issue a BIR sales invoice or collection receipt", roles: ["owner", "billing"],
    who: "Billing staff or owner", when: "Sales invoice: when billing VSA's services. Collection receipt: when a payment is received.",
    steps: [
      "First time only: the owner fills in BIR books → BIR details (registered name, TIN, address, permit no. and the number series). Until then the buttons explain what is missing.",
      "Sales invoice: in the shipment's Billing section click Issue sales invoice. It takes all service charges not yet invoiced; advances for the client are left out. Use Preview first if you want to see it.",
      "Collection receipt: record the payment (next guide), then click Issue receipt on that payment.",
      "Click Print on the document that opens and give the original to the client.",
      "A mistake on an issued document: click Void, type the reason, and issue a new one. Numbers are never reused or deleted, as BIR requires.",
    ],
    whatIf: [
      ["\"The … series is used up\"", "Register a new series with BIR; the owner then enters it in BIR details."],
      ["The client asks for a copy later", "Open BIR books, find the number, open it and print. It prints exactly as issued."],
    ],
    link: { to: "/bir-books", label: "Open BIR books" },
  },
  {
    id: "payments", title: "Record a payment and follow up balances", roles: ["owner", "billing"],
    who: "Billing staff or owner", when: "Whenever a client pays, and once a week for follow-ups.",
    steps: [
      "Open the shipment, go to Billing → Payments received and click Record payment: date, amount received, method and reference (check no., bank reference).",
      "If the client withheld tax and gave a BIR Form 2307, enter that amount in Withheld ₱ (2307). It counts as paid.",
      "Issue the collection receipt (see the BIR guide).",
      "Weekly: open Collections to see every unpaid balance by client and age, and follow up the oldest first.",
    ],
    whatIf: [
      ["A payment covers several shipments", "Record it on each shipment with the amount for that shipment, using the same reference."],
      ["The 2307 arrives after the payment", "Record the withheld amount as its own payment line with the 2307 reference."],
    ],
    link: { to: "/collections", label: "Open Collections" },
  },
  {
    id: "books", title: "Monthly BIR books for the accountant", roles: ["owner", "billing"],
    who: "Owner or billing staff", when: "In the first days of each month, for the month before.",
    steps: [
      "Open BIR books, choose the month.",
      "Check the tiles: VATable sales, output VAT, VAT-exempt, collected, and tax withheld by clients.",
      "Click Download Excel for the accountant and send the file with the 2307 forms received that month.",
    ],
    whatIf: [["A voided invoice appears", "That is correct: void documents keep their number and count as zero."]],
    link: { to: "/bir-books", label: "Open BIR books" },
  },
  {
    id: "client-updates", title: "Status emails and the client page", roles: ["owner", "processor", "billing"],
    who: "Owner, processor or billing", when: "Once per client, when they want to be kept informed.",
    steps: [
      "Open Clients and the client, then Status updates for this client.",
      "Enter the email for updates and tick the steps that should send an email (for example Lodged, Assessed, Delivered).",
      "To give the client a page where they can see their shipments, tick Client page on and save. Then click Copy link in the client list and send it to them. The page shows steps, ETA and vessel only, never amounts or documents.",
      "The shipment page shows Emails to the client: what was sent and when.",
    ],
    whatIf: [
      ["The link was sent to the wrong person", "Click New link. The old link stops working at once; send the new one to the right person."],
      ["Emails stay \"queued\"", "The email service key is not set up yet. Ask the owner."],
    ],
    link: { to: "/clients", label: "Open Clients" },
  },
  {
    id: "rider", title: "Rider daily log, photos and trip sheet", roles: ["rider", "owner", "processor", "dispatcher"],
    who: "Each rider on their phone; the office can encode or correct", when: "Every working day: before leaving, during the trips, and at the end of the day.",
    steps: [
      "Open Riders (riders see only this page). Fill in the vehicle and odometer start.",
      "Add each trip: what for, from, to, shipping line, document, PN, and contact. Click Save record.",
      "Before leaving, click Print trip sheet if a paper copy is needed for signatures.",
      "During the day, change each trip's status (Picked up, Delivered / done, Not done) and the times, and click Save changes.",
      "Under Photos and receipts, tap 📷 Take or choose photo for each receipt (enter its amount) and for each signed receiving copy.",
      "At the end of the day enter the odometer end, gas, food and other expenses, and save.",
    ],
    whatIf: [
      ["The rider forgot to log yesterday", "Riders can still fill in yesterday. For older days, the office corrects it."],
      ["\"Your login is not linked to a rider yet\"", "The office links the login in Riders → Riders tab."],
      ["A photo will not upload", "Check the phone has signal and try again; the photo is made smaller first, so mobile data is enough."],
    ],
    link: { to: "/riders", label: "Open Riders" },
  },
  {
    id: "offsite", title: "Weekly off-site copy of the records", roles: ["owner"],
    who: "Owner", when: "Once a week; a reminder appears after 7 days.",
    steps: [
      "Open Security → Off-site copy and click Save off-site copy (ZIP).",
      "Move the ZIP file to a USB drive, an external disk or your own Google Drive, not just the office computer.",
      "After the first full copy you may tick Only documents added since the last copy for a smaller file. Keep the earlier copies.",
    ],
    whatIf: [["Some files could not be downloaded", "They are listed in READ ME.txt inside the ZIP. Try again later; if it keeps failing, tell the developer."]],
    link: { to: "/security", label: "Open Security" },
  },
  {
    id: "staff", title: "Give a new staff member or rider access", roles: ["owner"],
    who: "Owner", when: "When someone joins, changes job, or leaves.",
    steps: [
      "Open Security → Who may create an account, enter their email and the role they start with, and click Invite.",
      "Tell them to open the app and sign up with that email and their own password.",
      "For a rider: after they sign up, open Riders → Riders tab and choose their login next to their name.",
      "When someone leaves, change their role in Team so they can no longer see the records.",
    ],
    whatIf: [["They see \"Waiting for approval\"", "Open Team and give them their role; next time, invite the exact email they sign up with."]],
    link: { to: "/security", label: "Open Security" },
  },
];

/** The guides for a role first, then the rest; with a search, only the guides that mention every word. */
export function guidesFor(role: Role, query = ""): { mine: Guide[]; others: Guide[] } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = (g: Guide) => [g.title, g.who, g.when, ...g.steps, ...g.whatIf.flat()].join(" ").toLowerCase();
  const hits = GUIDES.filter((g) => words.every((w) => text(g).includes(w)));
  if (role === "rider") return { mine: hits.filter((g) => g.roles.includes("rider")), others: [] };
  return { mine: hits.filter((g) => g.roles.includes(role)), others: hits.filter((g) => !g.roles.includes(role)) };
}
