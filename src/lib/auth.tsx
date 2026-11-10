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

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); return; }
    const { data } = await supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle();
    setProfile(data as Profile | null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // Deferred: calling Supabase inside this callback can deadlock the auth lock.
      setTimeout(() => loadProfile(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  return <Ctx.Provider value={{ session, profile, loading, reload: () => loadProfile(session) }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
