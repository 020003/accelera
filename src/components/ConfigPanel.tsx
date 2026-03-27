import { useEffect, useState, useCallback } from "react";
import { proxyUrl } from "@/lib/proxy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Save,
  RefreshCw,
  Server,
  AlertCircle,
  CheckCircle,
  Settings,
  Activity,
} from "lucide-react";
import { toast } from "sonner";

interface Host {
  url: string;
  name: string;
}

interface HostSettings {
  config: Record<string, string>;
  mutable: Record<string, boolean>;
}

interface ConfigPanelProps {
  hosts: Host[];
}

// Group definitions for organized display
const SETTING_GROUPS = [
  {
    id: "monitoring",
    title: "GPU Monitoring",
    icon: Activity,
    description: "Collection intervals and data retention",
    keys: [
      "GPU_COLLECT_INTERVAL",
      "HISTORICAL_DATA_RETENTION",
      "PROMETHEUS_ENABLED",
    ],
  },
  {
    id: "network",
    title: "Network & Alerts",
    icon: Server,
    description: "CORS, webhook, and logging settings",
    keys: ["CORS_ORIGINS", "ALERT_WEBHOOK_URL", "LOG_LEVEL"],
  },
];

const FRIENDLY_LABELS: Record<string, string> = {
  GPU_COLLECT_INTERVAL: "Collection Interval (seconds)",
  HISTORICAL_DATA_RETENTION: "Data Retention (hours)",
  PROMETHEUS_ENABLED: "Prometheus Metrics",
  CORS_ORIGINS: "CORS Origins",
  ALERT_WEBHOOK_URL: "Alert Webhook URL",
  LOG_LEVEL: "Log Level",
};

const BOOLEAN_KEYS = new Set(["PROMETHEUS_ENABLED"]);
const SECRET_KEYS = new Set<string>();
const NUMBER_KEYS = new Set([
  "GPU_COLLECT_INTERVAL",
  "HISTORICAL_DATA_RETENTION",
]);

function SettingField({
  settingKey,
  value,
  onChange,
  mutable,
}: {
  settingKey: string;
  value: string;
  onChange: (val: string) => void;
  mutable: boolean;
}) {
  const label = FRIENDLY_LABELS[settingKey] || settingKey;
  const isBoolean = BOOLEAN_KEYS.has(settingKey);
  const isSecret = SECRET_KEYS.has(settingKey);
  const isNumber = NUMBER_KEYS.has(settingKey);
  const isLogLevel = settingKey === "LOG_LEVEL";

  if (isBoolean) {
    const checked = value.toLowerCase() === "true" || value === "1";
    return (
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{label}</Label>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={(c) => onChange(c ? "true" : "false")}
          disabled={!mutable}
        />
      </div>
    );
  }

  if (isLogLevel) {
    return (
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">{label}</Label>
        <Select value={value} onValueChange={onChange} disabled={!mutable}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["DEBUG", "INFO", "WARNING", "ERROR"].map((lvl) => (
              <SelectItem key={lvl} value={lvl}>
                {lvl}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <Input
        type={isSecret ? "password" : isNumber ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isSecret ? "Enter new value" : ""}
        disabled={!mutable}
        className="h-9"
      />
    </div>
  );
}

function HostConfigCard({
  host,
  onSaved,
}: {
  host: Host;
  onSaved?: () => void;
}) {
  const [settings, setSettings] = useState<HostSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = host.url.replace(/\/nvidia-smi\.json$/, "");

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(proxyUrl(`${baseUrl}/api/settings`), {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: HostSettings = await res.json();
      setSettings(data);
      setDraft({ ...data.config });
    } catch (err: any) {
      setError(err.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const getDirtyKeys = (): Record<string, string> => {
    if (!settings) return {};
    const dirty: Record<string, string> = {};
    for (const key of Object.keys(draft)) {
      if (!settings.mutable[key]) continue;
      const orig = settings.config[key] ?? "";
      const cur = draft[key] ?? "";
      // Skip masked values that weren't changed
      if (orig === "••••••••" && cur === "••••••••") continue;
      if (cur !== orig) {
        dirty[key] = cur;
      }
    }
    return dirty;
  };

  const dirty = getDirtyKeys();
  const hasDirty = Object.keys(dirty).length > 0;

  const handleSave = async () => {
    if (!hasDirty) return;
    setSaving(true);
    try {
      const res = await fetch(proxyUrl(`${baseUrl}/api/settings`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: dirty }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      toast.success(
        `${host.name}: ${result.message}`,
        { description: Object.keys(result.applied || {}).join(", ") }
      );
      // Re-fetch to get clean state
      await fetchSettings();
      onSaved?.();
    } catch (err: any) {
      toast.error(`${host.name}: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const res = await fetch(proxyUrl(`${baseUrl}/api/settings/reset`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`${host.name}: All overrides cleared`);
      await fetchSettings();
      onSaved?.();
    } catch (err: any) {
      toast.error(`${host.name}: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
          Loading settings from {host.name}...
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {host.name}: {error}
            <Button variant="outline" size="sm" onClick={fetchSettings} className="ml-auto">
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!settings) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            {host.name}
            <span className="text-xs text-muted-foreground font-normal">
              {baseUrl}
            </span>
          </div>
          {hasDirty && (
            <Badge className="bg-yellow-500/10 text-yellow-500 text-[10px]">
              Unsaved changes
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-6">
        {SETTING_GROUPS.map((group) => {
          const Icon = group.icon;
          const groupKeys = group.keys.filter((k) => k in settings.config);
          if (groupKeys.length === 0) return null;

          return (
            <div key={group.id} className="space-y-3">
              <div className="flex items-center gap-2 border-b pb-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{group.title}</span>
                <span className="text-xs text-muted-foreground">
                  {group.description}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {groupKeys.map((key) => (
                  <SettingField
                    key={key}
                    settingKey={key}
                    value={draft[key] ?? ""}
                    onChange={(val) => handleChange(key, val)}
                    mutable={!!settings.mutable[key]}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <div className="flex items-center justify-between pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={saving}
            className="text-muted-foreground"
          >
            Reset to Defaults
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchSettings}
              disabled={loading || saving}
              className="gap-1.5"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Reload
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasDirty || saving}
              className="gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ConfigPanel({ hosts }: ConfigPanelProps) {
  const [applyAll, setApplyAll] = useState(false);

  if (hosts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Settings className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p>Add GPU hosts to configure their settings.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Exporter Configuration
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure authentication, monitoring, and network settings on each
            GPU exporter. Changes take effect immediately and persist across
            restarts.
          </p>
        </div>
      </div>

      {hosts.map((host) => (
        <HostConfigCard key={host.url} host={host} />
      ))}
    </div>
  );
}
