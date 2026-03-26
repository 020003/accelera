import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lock, LogIn, LogOut, User, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface LoginDialogProps {
  backendUrl?: string;
}

export function LoginDialog({ backendUrl }: LoginDialogProps) {
  const {
    isAuthenticated,
    username,
    authEnabled,
    loading,
    error,
    login,
    logout,
  } = useAuth(backendUrl);

  const [inputUser, setInputUser] = useState("");
  const [inputPass, setInputPass] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await login(inputUser, inputPass);
    if (ok) {
      setInputUser("");
      setInputPass("");
    }
  };

  // Auth not enabled on any backend
  if (authEnabled === false) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            Authentication
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" className="text-[10px] h-5">Disabled</Badge>
            <span>
              API authentication is not enabled. Set <code className="bg-muted px-1 rounded text-xs">API_AUTH_ENABLED=true</code> and{" "}
              <code className="bg-muted px-1 rounded text-xs">API_ADMIN_PASSWORD</code> in the exporter environment to enable.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Auth enabled and user is logged in
  if (isAuthenticated) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-green-500" />
            Authentication
            <Badge className="bg-green-500/10 text-green-500 text-[10px] h-5">Authenticated</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span>Signed in as <strong>{username}</strong></span>
            </div>
            <Button variant="outline" size="sm" onClick={logout} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Auth enabled but not logged in — show login form
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4 text-yellow-500" />
          Authentication
          <Badge variant="secondary" className="text-[10px] h-5">Login Required</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3 items-end">
            <div className="space-y-1">
              <Label htmlFor="auth-user" className="text-xs">Username</Label>
              <Input
                id="auth-user"
                value={inputUser}
                onChange={(e) => setInputUser(e.target.value)}
                placeholder="admin"
                autoComplete="username"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="auth-pass" className="text-xs">Password</Label>
              <Input
                id="auth-pass"
                type="password"
                value={inputPass}
                onChange={(e) => setInputPass(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" disabled={loading || !inputUser || !inputPass} className="gap-1.5">
              <LogIn className="h-3.5 w-3.5" />
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
