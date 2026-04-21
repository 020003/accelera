/**
 * Server-side session authentication.
 *
 * All auth state lives on the central backend. The frontend calls
 * /api/auth/status on mount and uses httpOnly session cookies for
 * subsequent requests. No secrets in localStorage.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

interface AuthContextValue {
  /** True when the user has a valid server session */
  isAuthenticated: boolean;
  /** True while the initial session check is in progress */
  loading: boolean;
  /** True when no admin account exists yet (first-run setup) */
  needsSetup: boolean;
  /** Current username (or null) */
  username: string | null;
  /** Attempt login — returns true on success */
  login: (username: string, password: string) => Promise<boolean>;
  /** End the session */
  logout: () => Promise<void>;
  /** First-run: create the admin account */
  setup: (username: string, password: string) => Promise<boolean>;
  /** Error message from last failed operation */
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function _post(url: string, body: Record<string, unknown>) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check session on mount
  useEffect(() => {
    fetch("/api/auth/status", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setIsAuthenticated(data.authenticated ?? false);
        setNeedsSetup(data.needsSetup ?? false);
        setUsername(data.username ?? null);
      })
      .catch(() => {
        setIsAuthenticated(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (user: string, password: string) => {
    setError(null);
    try {
      const res = await _post("/api/auth/login", { username: user, password });
      const data = await res.json();
      if (res.ok) {
        setIsAuthenticated(true);
        setUsername(data.username);
        return true;
      }
      setError(data.error || "Login failed");
      return false;
    } catch {
      setError("Network error");
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    await _post("/api/auth/logout", {}).catch(() => {});
    setIsAuthenticated(false);
    setUsername(null);
  }, []);

  const setup = useCallback(async (user: string, password: string) => {
    setError(null);
    try {
      const res = await _post("/api/auth/setup", { username: user, password });
      const data = await res.json();
      if (res.ok) {
        setIsAuthenticated(true);
        setNeedsSetup(false);
        setUsername(data.username);
        return true;
      }
      setError(data.error || "Setup failed");
      return false;
    } catch {
      setError("Network error");
      return false;
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, loading, needsSetup, username, login, logout, setup, error }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
