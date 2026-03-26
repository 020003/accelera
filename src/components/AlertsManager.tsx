import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Bell, Plus, Trash2, Check, AlertTriangle, AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  useAlertRules,
  useAlertEvents,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
  useAcknowledgeAlert,
} from "@/hooks/useAlerts";
import type { AlertRule, AlertMetric, AlertComparison } from "@/types/alerts";

const METRIC_OPTIONS: { value: AlertMetric; label: string }[] = [
  { value: "utilization", label: "GPU Utilization (%)" },
  { value: "temperature", label: "Temperature (°C)" },
  { value: "power_draw", label: "Power Draw (W)" },
  { value: "memory_percent", label: "Memory Usage (%)" },
  { value: "memory_used", label: "Memory Used (MiB)" },
  { value: "fan", label: "Fan Speed (%)" },
];

const COMPARISON_OPTIONS: { value: AlertComparison; label: string }[] = [
  { value: ">", label: "Greater than" },
  { value: ">=", label: "Greater or equal" },
  { value: "<", label: "Less than" },
  { value: "<=", label: "Less or equal" },
  { value: "==", label: "Equal to" },
];

function severityColor(severity: string) {
  switch (severity) {
    case "critical": return "destructive";
    case "warning": return "secondary";
    default: return "outline";
  }
}

function timeAgo(ts: number): string {
  const seconds = Math.floor(Date.now() / 1000 - ts);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function AlertsManager() {
  const { data: rules = [], isLoading: rulesLoading } = useAlertRules();
  const { data: events = [], isLoading: eventsLoading } = useAlertEvents();
  const createRule = useCreateAlertRule();
  const updateRule = useUpdateAlertRule();
  const deleteRule = useDeleteAlertRule();
  const acknowledgeAlert = useAcknowledgeAlert();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formMetric, setFormMetric] = useState<AlertMetric>("temperature");
  const [formComparison, setFormComparison] = useState<AlertComparison>(">");
  const [formThreshold, setFormThreshold] = useState("");
  const [formGpuFilter, setFormGpuFilter] = useState("*");
  const [formCooldown, setFormCooldown] = useState("300");
  const [formWebhook, setFormWebhook] = useState(false);
  const [formEmail, setFormEmail] = useState(false);

  const resetForm = () => {
    setFormName("");
    setFormMetric("temperature");
    setFormComparison(">");
    setFormThreshold("");
    setFormGpuFilter("*");
    setFormCooldown("300");
    setFormWebhook(false);
    setFormEmail(false);
  };

  const handleCreate = () => {
    if (!formName || !formThreshold) {
      toast.error("Name and threshold are required");
      return;
    }
    createRule.mutate(
      {
        name: formName,
        metric: formMetric,
        comparison: formComparison,
        threshold: parseFloat(formThreshold),
        gpu_filter: formGpuFilter,
        host_filter: "*",
        enabled: true,
        cooldown_seconds: parseInt(formCooldown),
        notify_webhook: formWebhook,
        notify_email: formEmail,
      },
      {
        onSuccess: () => {
          toast.success("Alert rule created");
          setDialogOpen(false);
          resetForm();
        },
        onError: () => toast.error("Failed to create rule"),
      }
    );
  };

  const handleToggle = (rule: AlertRule) => {
    updateRule.mutate({ id: rule.id, enabled: !rule.enabled });
  };

  const handleDelete = (id: string) => {
    deleteRule.mutate(id, {
      onSuccess: () => toast.success("Rule deleted"),
    });
  };

  const handleAck = (eventId: number) => {
    acknowledgeAlert.mutate(eventId, {
      onSuccess: () => toast.success("Alert acknowledged"),
    });
  };

  const unacknowledgedCount = events.filter((e) => !e.acknowledged).length;

  return (
    <div className="space-y-4">
      <Tabs defaultValue="rules">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="rules" className="gap-1.5">
              <Bell className="h-4 w-4" /> Rules ({rules.length})
            </TabsTrigger>
            <TabsTrigger value="events" className="gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Events
              {unacknowledgedCount > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 min-w-[20px] px-1 text-xs">
                  {unacknowledgedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" /> New Rule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Alert Rule</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input
                    placeholder="e.g. High Temperature Alert"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Metric</Label>
                    <Select value={formMetric} onValueChange={(v) => setFormMetric(v as AlertMetric)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {METRIC_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Condition</Label>
                    <Select value={formComparison} onValueChange={(v) => setFormComparison(v as AlertComparison)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COMPARISON_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Threshold</Label>
                    <Input
                      type="number"
                      placeholder="85"
                      value={formThreshold}
                      onChange={(e) => setFormThreshold(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>GPU Filter (* = all)</Label>
                    <Input value={formGpuFilter} onChange={(e) => setFormGpuFilter(e.target.value)} />
                  </div>
                  <div>
                    <Label>Cooldown (seconds)</Label>
                    <Input
                      type="number"
                      value={formCooldown}
                      onChange={(e) => setFormCooldown(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch checked={formWebhook} onCheckedChange={setFormWebhook} />
                    <Label>Webhook</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={formEmail} onCheckedChange={setFormEmail} />
                    <Label>Email</Label>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createRule.isPending}>
                  {createRule.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Rules tab */}
        <TabsContent value="rules" className="space-y-3">
          {rulesLoading && <p className="text-muted-foreground text-sm">Loading rules...</p>}
          {!rulesLoading && rules.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No alert rules configured yet. Click "New Rule" to get started.
              </CardContent>
            </Card>
          )}
          {rules.map((rule) => (
            <Card key={rule.id} className={!rule.enabled ? "opacity-50" : ""}>
              <CardContent className="flex items-center justify-between py-3 px-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Switch
                    checked={!!rule.enabled}
                    onCheckedChange={() => handleToggle(rule)}
                  />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{rule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {rule.metric} {rule.comparison} {rule.threshold}
                      {rule.gpu_filter !== "*" && ` · GPU ${rule.gpu_filter}`}
                      {" · "}cooldown {rule.cooldown_seconds}s
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {rule.notify_webhook && <Badge variant="outline">Webhook</Badge>}
                  {rule.notify_email && <Badge variant="outline">Email</Badge>}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => handleDelete(rule.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Events tab */}
        <TabsContent value="events" className="space-y-2">
          {eventsLoading && <p className="text-muted-foreground text-sm">Loading events...</p>}
          {!eventsLoading && events.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No alert events recorded yet.
              </CardContent>
            </Card>
          )}
          {events.slice(0, 100).map((event) => (
            <Card key={event.id} className={event.acknowledged ? "opacity-50" : ""}>
              <CardContent className="flex items-center justify-between py-2.5 px-4">
                <div className="flex items-center gap-3 min-w-0">
                  {event.severity === "critical" ? (
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm truncate">{event.message}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={severityColor(event.severity) as any} className="text-[10px] h-4">
                        {event.severity}
                      </Badge>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {timeAgo(event.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
                {!event.acknowledged && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1"
                    onClick={() => handleAck(event.id)}
                  >
                    <Check className="h-3.5 w-3.5" /> Ack
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
