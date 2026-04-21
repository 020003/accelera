import { useState } from "react";
import { HostManager } from "@/components/HostManager";
import { ConfigPanel } from "@/components/ConfigPanel";
import { SystemStatus } from "@/components/SystemStatus";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Timer, DollarSign, Lock, Cpu, LogOut, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { CURRENCIES } from "@/hooks/useCurrency";
import type { Host, HostData } from "@/types/dashboard";

interface SettingsTabProps {
  refreshInterval: number;
  handleRefreshInterval: (value: string) => void;
  energyRate: number;
  handleEnergyRate: (value: string) => void;
  demo: boolean;
  handleDemoToggle: (enabled: boolean) => void;
  currency: { code: string; symbol: string; name: string };
  setCurrency: (code: string) => void;
  hosts: Host[];
  setHosts: (hosts: Host[]) => void;
  hostsData: HostData[];
  fetchAllHostsData: () => Promise<void>;
}

export function SettingsTab({
  refreshInterval,
  handleRefreshInterval,
  energyRate,
  handleEnergyRate,
  demo,
  handleDemoToggle,
  currency,
  setCurrency,
  hosts,
  setHosts,
  hostsData,
  fetchAllHostsData,
}: SettingsTabProps) {
  return (
    <div className="space-y-8">
      {/* ── Section: Polling & Refresh ── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Timer className="h-4 w-4 text-blue-500" />
            Polling & Refresh
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Controls how often the dashboard fetches new data from GPU hosts.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Auto-Refresh Interval</Label>
                <Select value={refreshInterval.toString()} onValueChange={handleRefreshInterval}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Manual only</SelectItem>
                    <SelectItem value="2000">Every 2 seconds</SelectItem>
                    <SelectItem value="3000">Every 3 seconds</SelectItem>
                    <SelectItem value="5000">Every 5 seconds (default)</SelectItem>
                    <SelectItem value="10000">Every 10 seconds</SelectItem>
                    <SelectItem value="30000">Every 30 seconds</SelectItem>
                    <SelectItem value="60000">Every 60 seconds</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {refreshInterval === 0
                    ? "Auto-refresh is paused. Use the Refresh button on each host tab."
                    : `GPU metrics, power data, and AI runtime status update every ${refreshInterval / 1000}s.`}
                </p>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Demo Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Show sample GPU data without connecting to real hosts.
                  </p>
                </div>
                <Switch checked={demo} onCheckedChange={handleDemoToggle} />
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Section: Display & Costs ── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            Display & Costs
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Currency and energy rate used for power cost estimates across the dashboard.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Currency</Label>
                <Select value={currency.code} onValueChange={setCurrency}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.symbol} — {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Affects all cost and energy rate displays.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Energy Rate ({currency.symbol}/kWh)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.12"
                  value={energyRate || ""}
                  onChange={(e) => handleEnergyRate(e.target.value)}
                  className="h-9"
                />
                <p className="text-xs text-muted-foreground">
                  Your electricity cost per kilowatt-hour. Used to estimate GPU running costs.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Section: Security ── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-500" />
            Security
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Protect this dashboard with a password. Stored locally in your browser.
          </p>
        </div>
        <DashboardAccessCard />
      </section>

      {/* ── Section: GPU Hosts ── */}
      {!demo && (
        <section className="space-y-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Cpu className="h-4 w-4 text-purple-500" />
              GPU Hosts
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage the GPU exporter endpoints this dashboard connects to.
            </p>
          </div>
          <HostManager
            hosts={hosts}
            setHosts={(newHosts) => {
              setHosts(newHosts);
              if (newHosts.length > hosts.length) {
                fetchAllHostsData();
              }
            }}
            onHostStatusChange={() => {}}
            hostsAiInfo={Object.fromEntries(
              hostsData.map((h) => [h.url, { ollama: h.ollama, sglang: h.sglang }])
            )}
          />
        </section>
      )}

      {/* ── Section: Exporter Configuration ── */}
      {!demo && hosts.length > 0 && (
        <section className="space-y-4">
          <ConfigPanel hosts={hosts} />
        </section>
      )}

      {/* ── Section: System Status ── */}
      {!demo && hosts.length > 0 && (
        <section className="space-y-4">
          <SystemStatus hosts={hosts} />
        </section>
      )}
    </div>
  );
}

function DashboardAccessCard() {
  const { username, logout } = useAuth();
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async () => {
    if (!currentPass) {
      toast.error("Enter your current password");
      return;
    }
    if (!newPass || newPass !== confirmPass) {
      toast.error("New passwords do not match");
      return;
    }
    if (newPass.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Password updated");
        setCurrentPass("");
        setNewPass("");
        setConfirmPass("");
        setShowPass(false);
      } else {
        toast.error(data.error || "Failed to update password");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="font-medium">Signed in as <span className="font-mono">{username}</span></span>
          </div>
          <Button variant="outline" size="sm" onClick={logout} className="gap-1.5 h-7 text-xs cursor-pointer">
            <LogOut className="h-3 w-3" />
            Sign Out
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Current Password</Label>
            <Input
              type={showPass ? "text" : "password"}
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              placeholder="Current password"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">New Password</Label>
            <div className="relative">
              <Input
                type={showPass ? "text" : "password"}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Enter new password"
                className="h-9 pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Confirm New Password</Label>
            <Input
              type={showPass ? "text" : "password"}
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              placeholder="Confirm password"
              className="h-9"
            />
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleChangePassword}
          disabled={!currentPass || !newPass || !confirmPass || saving}
          className="cursor-pointer"
        >
          Change Password
        </Button>
      </CardContent>
    </Card>
  );
}
