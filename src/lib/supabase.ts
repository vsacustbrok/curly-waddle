import { createClient } from "@supabase/supabase-js";

// The URL and publishable key are public by design; row-level security does the protecting.
const url = import.meta.env.VITE_SUPABASE_URL || "https://xskvjxbvkgysvwlotjpf.supabase.co";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_y1cGn2Hjulv81UCbUArdDw_MhdsTqeM";

export const supabase = createClient(url, key);
