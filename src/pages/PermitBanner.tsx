// The permit warning shown on a shipment and in its Pre-Lodgment Audit, and the shared permit loader.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { today } from "../lib/types";
import { clientWarnings, stateOf, warningText, type Permit } from "../lib/permits";

let cache: { at: number; rows: Promise<Permit[]> } | null = null;
/** All permits, kept for a minute so shipment pages do not each download them. */
export function loadPermits(fresh = false): Promise<Permit[]> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.rows;
  const rows = Promise.resolve(supabase.from("permits").select("*, clients(name)").order("expires_on").limit(2000))
    .then(({ data, error }) => { if (error) throw new Error(error.message); return (data as Permit[]) ?? []; });
  cache = { at: Date.now(), rows };
  rows.catch(() => { cache = null; });
  return rows;
}

/** Red banner on a shipment (and the audit) when its client has a permit lapsed or lapsing. */
export function PermitBanner({ clientId }: { clientId: string | null | undefined }) {
  const [list, setList] = useState<Permit[]>([]);
  useEffect(() => { if (clientId) loadPermits().then((all) => setList(clientWarnings(all, clientId, today())), () => {}); }, [clientId]);
  if (!list.length) return null;
  const now = today();
  const expired = list.some((p) => stateOf(p, now) === "expired");
  return (
    <div className={expired ? "error permit-banner" : "warn permit-banner"} role="status">
      <strong>{expired ? "Client permit lapsed:" : "Client permit lapsing soon:"}</strong>{" "}
      {list.map((p) => warningText(p, now)).join("; ")}. <Link to={`/permits?client=${clientId}`}>Check permits</Link>
    </div>
  );
}

