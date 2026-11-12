import { createClient } from "@supabase/supabase-js";

// The URL and publishable key are public by design; row-level security does the protecting.
const url = import.meta.env.VITE_SUPABASE_URL || "https://xskvjxbvkgysvwlotjpf.supabase.co";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_y1cGn2Hjulv81UCbUArdDw_MhdsTqeM";

export const supabase = createClient(url, key);

/** Every row of a query, fetched 1,000 at a time (the most the server returns in one go). */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
