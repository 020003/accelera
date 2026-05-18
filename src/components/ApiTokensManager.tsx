import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, Plus, Trash2, KeyRound, Check } from "lucide-react";

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  created_by: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked: number;
}

interface CreateResponse extends ApiToken {
  token: string;
  warning: string;
}

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: "Never expires",   days: null },
  { label: "30 days",         days: 30 },
  { label: "90 days",         days: 90 },
  { label: "180 days",        days: 180 },
  { label: "1 year",          days: 365 },
];

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

export function ApiTokensManager() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<"read" | "read:write">("read");
  const [expiresIdx, setExpiresIdx] = useState("0");
  const [newToken, setNewToken] = useState<CreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/tokens", { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setTokens(data.tokens || []);
    } catch (e: any) {
      toast.error(`Failed to load tokens: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) {
      toast.error("Token needs a name");
      return;
    }
    setCreating(true);
    try {
      const days = EXPIRY_OPTIONS[parseInt(expiresIdx)]?.days ?? null;
      const res = await fetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          ...(days !== null ? { expiresInDays: days } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create token");
        return;
      }
      setNewToken(data);
      setName("");
      setScopes("read");
      setExpiresIdx("0");
      load();
    } catch (e: any) {
      toast.error(`Network error: ${e.message ?? e}`);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string, label: string) => {
    if (!confirm(`Revoke token "${label}"?  This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/auth/tokens/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to revoke");
        return;
      }
      toast.success("Token revoked");
      load();
    } catch (e: any) {
      toast.error(`Network error: ${e.message ?? e}`);
    }
  };

  const copyToken = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Token copied to clipboard");
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };

  return (
    <div className="space-y-4">
      {/* Create form */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Token name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. grafana-prod, github-actions"
                maxLength={80}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Scope</Label>
              <Select value={scopes} onValueChange={(v) => setScopes(v as any)}>
                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">read</SelectItem>
                  <SelectItem value="read:write">read:write</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Expires</Label>
              <Select value={expiresIdx} onValueChange={setExpiresIdx}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o, i) => (
                    <SelectItem key={i} value={i.toString()}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={create}
              disabled={creating || !name.trim()}
              className="gap-1.5 h-9 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Create token
            </Button>
          </div>

          {newToken && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="h-4 w-4 text-amber-500" />
                Your new token — copy it now, it won't be shown again.
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-background border rounded px-2 py-1.5 break-all">
                  {newToken.token}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyToken}
                  className="gap-1.5 cursor-pointer"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setNewToken(null)}
                  className="cursor-pointer"
                >
                  Dismiss
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use in requests as <code className="font-mono">Authorization: Bearer {newToken.token.slice(0, 12)}…</code>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing tokens */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading tokens…</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active tokens. Create one above to start using the Accelera API.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Prefix</th>
                    <th className="py-2 pr-3">Scope</th>
                    <th className="py-2 pr-3">Owner</th>
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2 pr-3">Last used</th>
                    <th className="py-2 pr-3">Expires</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{t.name}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{t.prefix}…</td>
                      <td className="py-2 pr-3">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {t.scopes}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{t.created_by}</td>
                      <td className="py-2 pr-3 text-muted-foreground text-xs">{fmtDate(t.created_at)}</td>
                      <td className="py-2 pr-3 text-muted-foreground text-xs">{fmtDate(t.last_used_at)}</td>
                      <td className="py-2 pr-3 text-muted-foreground text-xs">
                        {t.expires_at ? fmtDate(t.expires_at) : "Never"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => revoke(t.id, t.name)}
                          className="h-7 px-2 text-destructive hover:text-destructive cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Interactive API docs:{" "}
        <a
          href="/api/v1/docs"
          target="_blank"
          rel="noreferrer"
          className="font-mono underline underline-offset-2 hover:text-foreground"
        >
          /api/v1/docs
        </a>
        {" · "}OpenAPI spec:{" "}
        <a
          href="/api/v1/openapi.json"
          target="_blank"
          rel="noreferrer"
          className="font-mono underline underline-offset-2 hover:text-foreground"
        >
          /api/v1/openapi.json
        </a>
        . Pass <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> on every request.
      </p>
    </div>
  );
}
