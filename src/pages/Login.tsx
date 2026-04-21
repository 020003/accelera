import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Lock, LogIn, AlertCircle, UserPlus } from "lucide-react";

export default function Login() {
  const { login, setup, needsSetup, error: authError } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const ok = needsSetup
      ? await setup(username, password)
      : await login(username, password);

    if (!ok) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPassword("");
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Accelera</h1>
          <p className="text-sm text-muted-foreground">
            GPU Monitoring Dashboard
          </p>
        </div>

        <Card className={shake ? "animate-shake" : ""}>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-center">
              {needsSetup ? "Create Admin Account" : "Sign In"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {authError && (
                <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {authError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoFocus
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={needsSetup ? "Choose a password (min 6 chars)" : "Enter password"}
                  autoComplete={needsSetup ? "new-password" : "current-password"}
                />
              </div>
              <Button
                type="submit"
                className="w-full gap-2 cursor-pointer"
                disabled={!username || !password || submitting}
              >
                {needsSetup ? (
                  <><UserPlus className="h-4 w-4" /> Create Account</>
                ) : (
                  <><LogIn className="h-4 w-4" /> Sign In</>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          {needsSetup
            ? "First time? Create an admin account to get started."
            : "Contact your administrator if you forgot your password."}
        </p>
      </div>
    </div>
  );
}
