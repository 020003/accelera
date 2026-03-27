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

/** SHA-256 hash — returns hex string prefixed with "sha256:". */
async function _sha256(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);

  // Prefer Web Crypto API (available in secure contexts: HTTPS / localhost)
  if (globalThis.crypto?.subtle) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", data);
      return "sha256:" + Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch { /* fall through to JS implementation */ }
  }

  // Fallback: pure-JS SHA-256 (identical output, works over plain HTTP)
  return "sha256:" + _jsSha256(data);
}

/** Minimal pure-JS SHA-256 — produces the same digest as Web Crypto. */
function _jsSha256(msg: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
    0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19,
  ]);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  const bitLen = msg.length * 8;
  const padLen = (msg.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 4, bitLen, false);

  const W = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i-15], 7) ^ rotr(W[i-15], 18) ^ (W[i-15] >>> 3);
      const s1 = rotr(W[i-2], 17) ^ rotr(W[i-2], 19) ^ (W[i-2] >>> 10);
      W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e,6)^rotr(e,11)^rotr(e,25)) + ((e&f)^(~e&g)) + K[i] + W[i]) | 0;
      const t2 = ((rotr(a,2)^rotr(a,13)^rotr(a,22)) + ((a&b)^(a&c)^(b&c))) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  return Array.from(H).map(v => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

/** Legacy DJB2 hash — only used to verify old stored hashes for migration. */
function _legacyHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return "h:" + h.toString(36);
}
