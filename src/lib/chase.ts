// Overdue balance follow-ups: one reminder per client covering all their overdue shipments, in a
// tone that follows how the client usually pays and how old the debt is. Drafts only; staff send.

export type Payer = "good" | "occasional" | "repeat";
export type Tone = "gentle" | "neutral" | "firm";
export const TONE_LABEL: Record<Tone, string> = { gentle: "Friendly", neutral: "Follow-up", firm: "Firm, with a pay-by date" };
export const PAYER_LABEL: Record<Payer, string> = {
  good: "Usually pays on time", occasional: "Sometimes late (or little history)", repeat: "Often pays late",
};

/** How the client paid fully settled billings: on or before the due date, or late. Fewer than 3 → "occasional". */
export function payerScore(history: { due: string; paidOn: string }[]): Payer {
  if (history.length < 3) return "occasional";
  const late = history.filter((h) => h.paidOn > h.due).length / history.length;
  return late <= 0.25 ? "good" : late <= 0.5 ? "occasional" : "repeat";
}

/** Tone from the payer score, made firmer by age: over 30 days at least a follow-up, over 60 days firm. */
export function toneFor(payer: Payer, maxDaysOverdue: number): Tone {
  if (payer === "repeat" || maxDaysOverdue > 60) return "firm";
  if (payer === "occasional" || maxDaysOverdue > 30) return "neutral";
  return "gentle";
}

export type ChaseItem = { pn: string; soa: string | null; billedOn: string | null; due: string | null; daysOverdue: number; balance: number };
export type ChaseInput = {
  client: string; items: ChaseItem[]; tone: Tone; today: string; sender: string;
  paymentInstructions?: string | null; withholdsTax?: boolean;
};

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const plus = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);

/** The email: subject and plain-text body. */
export function draftReminder(x: ChaseInput): { subject: string; body: string; payBy: string | null } {
  const items = [...x.items].sort((a, b) => b.daysOverdue - a.daysOverdue || a.pn.localeCompare(b.pn));
  const total = items.reduce((s, i) => s + i.balance, 0);
  const oldest = items[0]?.daysOverdue ?? 0;
  const many = items.length > 1;
  const payBy = x.tone === "firm" ? plus(x.today, 7) : null;
  const subject = x.tone === "gentle" ? `Friendly reminder: VSA billing${many ? "s" : ""} for ${peso(total)}`
    : x.tone === "neutral" ? `Following up: past due balance of ${peso(total)}`
    : `Past due notice: ${peso(total)}, ${oldest} days overdue`;
  const lines = items.map((i) =>
    `- PN ${i.pn}${i.soa ? `, SOA no. ${i.soa}` : ""}: ${peso(i.balance)}, billed ${longDate(i.billedOn)}, due ${longDate(i.due)} (${i.daysOverdue} day${i.daysOverdue === 1 ? "" : "s"} overdue)`);
  const opening = x.tone === "gentle"
    ? `Good day! We hope all is well. This is a friendly reminder that the following billing${many ? "s" : ""} from VSA Customs Brokerage ${many ? "are" : "is"} now past due:`
    : x.tone === "neutral"
      ? `We are following up on the balance below, which is now past due:`
      : `Our records show the following balance${many ? "s" : ""} still unpaid, the oldest now ${oldest} days past due:`;
  const ask = x.tone === "firm"
    ? `Kindly settle the total on or before ${longDate(payBy)}. If there is any concern about these billings, please let us know right away so we can resolve it.`
    : x.tone === "neutral"
      ? `Kindly arrange payment at your earliest convenience.`
      : `We would appreciate your payment at your earliest convenience.`;
  const body = [
    `Dear ${x.client},`,
    "",
    opening,
    "",
    ...lines,
    "",
    `Total amount due: ${peso(total)}`,
    "",
    ask,
    ...(x.paymentInstructions?.trim() ? ["", x.paymentInstructions.trim()] : []),
    ...(x.withholdsTax ? ["", "If you withhold tax on this payment, please send the BIR Form 2307 together with it so we can credit the amount withheld."] : []),
    "",
    "If you have already paid, please disregard this message and send us the deposit slip or payment reference so we can update our records.",
    "",
    "Thank you very much.",
    "",
    "Respectfully,",
    x.sender,
    "VSA Customs Brokerage",
  ].join("\n");
  return { subject, body, payBy };
}

/** A mailto: link that opens the draft in the computer's email program. */
export const mailtoLink = (to: string | null | undefined, subject: string, body: string) =>
  `mailto:${encodeURIComponent(to ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
