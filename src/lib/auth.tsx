import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile } from "./types";

type AuthState = { session: Session | null; profile: Profile | null; loading: boolean; reload: () => Promise<void> };
const Ctx = createContext<AuthState>({ session: null, profile: null, loading: true, reload: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // The profile (name and role) is remembered for this browser tab, so a refresh shows the app at once
  // and checks the saved copy in the background. Signing out clears it.
  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); clearCachedData(); return; }
    const { data } = await supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle();
    setProfile(data as Profile | null);
    try { if (data) sessionStorage.setItem(PROFILE_KEY, JSON.stringify(data)); } catch { /* not saved; fine */ }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      let cached: Profile | null = null;
      try { cached = JSON.parse(sessionStorage.getItem(PROFILE_KEY) ?? "null"); } catch { cached = null; }
      if (data.session && cached?.id === data.session.user.id) {
        setProfile(cached);
        setLoading(false);
        loadProfile(data.session);
      } else {
        await loadProfile(data.session);
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s);
      if (e === "TOKEN_REFRESHED" || e === "INITIAL_SESSION") return; // same person; startup is handled above
      // Deferred: calling Supabase inside this callback can deadlock the auth lock.
      setTimeout(() => loadProfile(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  return <Ctx.Provider value={{ session, profile, loading, reload: () => loadProfile(session) }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);

const PROFILE_KEY = "vsa-profile";
/** Copies kept only to show pages faster; removed when someone signs out. */
export function clearCachedData() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("vsa-")) sessionStorage.removeItem(k);
  } catch { /* storage unavailable; nothing kept */ }
}
