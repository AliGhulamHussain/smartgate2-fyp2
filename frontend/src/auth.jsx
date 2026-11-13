import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, onSessionLost, refreshSession, setAccessToken } from "./api";

const AuthContext = createContext(null);

// What each role may open. The backend enforces the same rules; this only
// hides screens a role cannot use.
const ACCESS = {
  org_admin: ["overview", "presence", "attendance", "employees", "gates", "alerts", "kiosk", "settings"],
  manager: ["overview", "presence", "attendance", "employees", "gates", "alerts"],
  gate_operator: ["overview", "presence", "gates", "alerts", "kiosk"],
  viewer: ["overview", "presence", "attendance", "employees", "gates"],
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading");

  const signOutLocally = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus("out");
  }, []);

  useEffect(() => {
    onSessionLost(signOutLocally);
    refreshSession().then((session) => {
      if (session?.user) {
        setUser(session.user);
        setStatus("in");
      } else {
        setStatus("out");
      }
    });
  }, [signOutLocally]);

  const startSession = useCallback((session) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus("in");
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      can: (screen) => Boolean(user && ACCESS[user.role]?.includes(screen)),
      isAdmin: user?.role === "org_admin",
      login: async (email, password) =>
        startSession(await api("/api/auth/login", { method: "POST", body: { email, password } })),
      signup: async (body) => startSession(await api("/api/auth/signup", { method: "POST", body })),
      logout: async () => {
        await api("/api/auth/logout", { method: "POST" }).catch(() => {});
        signOutLocally();
      },
    }),
    [user, status, startSession, signOutLocally]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
