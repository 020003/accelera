import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Lock, LogIn, AlertCircle } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await login(password)) {
      setError(false);
    } else {
      setError(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPassword("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo / Title */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Accelera</h1>
          <p className="text-sm text-muted-foreground">
            GPU Monitoring Dashboard
          </p>
        </div>

        {/* Login Card */}
        <Card className={shake ? "animate-shake" : ""}>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-center">Sign In</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Incorrect password
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">Dashboard Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(false);
                  }}
                  placeholder="Enter password"
                  autoFocus
                  autoComplete="current-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full gap-2"
                disabled={!password}
              >
                <LogIn className="h-4 w-4" />
                Sign In
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          Dashboard access is password-protected.
          <br />
          Configure in Settings after signing in.
        </p>
      </div>
    </div>
  );
}
