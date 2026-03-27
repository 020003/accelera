/**
 * Frontend dashboard authentication.
 *
 * - Password hash (SHA-256) is stored in localStorage.
 * - Session lives in sessionStorage (cleared when the browser tab closes).
 * - When no password is configured, auth is disabled and the dashboard
 *   is accessible to everyone.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

const PASSWORD_KEY = "accelera_dashboard_password";
const SESSION_KEY = "accelera_session";

interface AuthContextValue {
  /** True when a dashboard password has been configured */
  authEnabled: boolean;
  /** True when the user has entered the correct password this session */
  isAuthenticated: boolean;
  /** Attempt login – returns true on success */
  login: (password: string) => Promise<boolean>;
  /** End the session */
  logout: () => void;
  /** Set (or clear) the dashboard password */
  setPassword: (password: string) => Promise<void>;
  /** Remove the password entirely (disables auth) */
  clearPassword: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [passwordHash, setPasswordHash] = useState<string>(
    () => localStorage.getItem(PASSWORD_KEY) ?? ""
  );
  const [session, setSession] = useState<boolean>(
    () => sessionStorage.getItem(SESSION_KEY) === "1"
  );

  const authEnabled = passwordHash.length > 0;
  const isAuthenticated = !authEnabled || session;

  const login = useCallback(
    async (password: string): Promise<boolean> => {
      const h = await _sha256(password);

      // Support legacy DJB2 hashes (prefix "h:") — auto-upgrade on match
      if (passwordHash.startsWith("h:") && _legacyHash(password) === passwordHash) {
        localStorage.setItem(PASSWORD_KEY, h);
        setPasswordHash(h);
        sessionStorage.setItem(SESSION_KEY, "1");
        setSession(true);
        return true;
      }

      if (h === passwordHash) {
        sessionStorage.setItem(SESSION_KEY, "1");
        setSession(true);
        return true;
      }
      return false;
    },
    [passwordHash]
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(false);
  }, []);

  const setPassword = useCallback(async (password: string) => {
    if (!password) {
      localStorage.removeItem(PASSWORD_KEY);
      setPasswordHash("");
      sessionStorage.removeItem(SESSION_KEY);
      setSession(false);
      return;
    }
    const h = await _sha256(password);
    localStorage.setItem(PASSWORD_KEY, h);
    setPasswordHash(h);
    // Auto-authenticate the person who just set the password
    sessionStorage.setItem(SESSION_KEY, "1");
    setSession(true);
  }, []);

  const clearPassword = useCallback(() => {
    localStorage.removeItem(PASSWORD_KEY);
    setPasswordHash("");
    sessionStorage.removeItem(SESSION_KEY);
    setSession(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{ authEnabled, isAuthenticated, login, logout, setPassword, clearPassword }}
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

/** SHA-256 hash via Web Crypto API — returns hex string prefixed with "sha256:". */
async function _sha256(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "sha256:" + hex;
}

/** Legacy DJB2 hash — only used to verify old stored hashes for migration. */
function _legacyHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return "h:" + h.toString(36);
}
