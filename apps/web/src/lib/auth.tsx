import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, currentOrgId, setCurrentOrgId } from "./api";

export type Org = {
  id: string;
  name: string;
  slug: string;
  role: string;
  timezone: string;
  defaultTransferNumber: string | null;
  tcpaDisclaimer: string | null;
  creditRatePerSecond: number;
};

type Session = {
  user: { userId: string; email: string; name: string };
  organizations: Org[];
};

type AuthState = {
  loading: boolean;
  session: Session | null;
  org: Org | null;
  setOrgId: (id: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [orgId, setOrgIdState] = useState(() => currentOrgId());

  const refresh = useCallback(async () => {
    try {
      const data = await api<Session>("/api/v1/me");
      setSession(data);
      const existing = currentOrgId();
      const next =
        (existing && data.organizations.some((o) => o.id === existing) && existing) ||
        data.organizations[0]?.id ||
        "";
      if (next && next !== existing) setCurrentOrgId(next);
      if (next) setOrgIdState(next);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onDenied = () => {
      setSession(null);
      setLoading(false);
    };
    window.addEventListener("dialix:unauthorized", onDenied);
    return () => window.removeEventListener("dialix:unauthorized", onDenied);
  }, []);

  const org = useMemo(
    () => session?.organizations.find((o) => o.id === orgId) ?? session?.organizations[0] ?? null,
    [session, orgId],
  );

  const value: AuthState = {
    loading,
    session,
    org,
    setOrgId: (id) => {
      setCurrentOrgId(id);
      setOrgIdState(id);
    },
    refresh,
    logout: async () => {
      await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" });
      localStorage.removeItem("dialix.org");
      setSession(null);
      setOrgIdState("");
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
