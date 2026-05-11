import { useState } from "react";
import { proxyUrl } from "@/lib/proxy";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  X,
  Wifi,
  WifiOff,
  Loader2,
  Bot,
  Sparkles,
  Pencil,
  Check,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";

interface Host {
  url: string;
  name: string;
  isConnected: boolean;
}

interface HostAiInfo {
  ollama?: { isAvailable: boolean; models: any[] };
  sglang?: { isAvailable: boolean; models: any[] };
}

interface HostManagerProps {
  hosts: Host[];
  setHosts: (hosts: Host[]) => void;
  onHostStatusChange: (url: string, isConnected: boolean) => void;
  hostsAiInfo?: Record<string, HostAiInfo>;
}

export function HostManager({ hosts, setHosts, onHostStatusChange, hostsAiInfo }: HostManagerProps) {
  const [newHostUrl, setNewHostUrl] = useState("");
  const [newHostName, setNewHostName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingHost, setRemovingHost] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [dragUrl, setDragUrl] = useState<string | null>(null);
  const [dragOverUrl, setDragOverUrl] = useState<string | null>(null);

  const persistOrder = async (orderedUrls: string[]) => {
    try {
      const res = await fetch("/api/hosts/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(orderedUrls),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save order (${res.status})`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save order");
    }
  };

  const onDrop = (targetUrl: string) => {
    if (!dragUrl || dragUrl === targetUrl) {
      setDragUrl(null);
      setDragOverUrl(null);
      return;
    }
    const fromIdx = hosts.findIndex((h) => h.url === dragUrl);
    const toIdx = hosts.findIndex((h) => h.url === targetUrl);
    if (fromIdx === -1 || toIdx === -1) {
      setDragUrl(null);
      setDragOverUrl(null);
      return;
    }
    const next = [...hosts];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setHosts(next);                              // optimistic local update
    persistOrder(next.map((h) => h.url));         // background persist (revert handled via toast)
    setDragUrl(null);
    setDragOverUrl(null);
  };

  const startEdit = (h: Host) => {
    setEditingUrl(h.url);
    setEditName(h.name);
  };
  const cancelEdit = () => {
    setEditingUrl(null);
    setEditName("");
  };
  const saveEdit = async (url: string) => {
    const name = editName.trim();
    if (!name) {
      toast.error("Name cannot be empty");
      return;
    }
    const current = hosts.find((h) => h.url === url);
    if (current && current.name === name) {
      cancelEdit();
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(url)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to rename (${res.status})`);
      }
      setHosts(hosts.map((h) => (h.url === url ? { ...h, name } : h)));
      toast.success("Host renamed");
      cancelEdit();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename");
    } finally {
      setSavingName(false);
    }
  };

  const addHost = async () => {
    const url = newHostUrl.trim();
    const name = newHostName.trim() || extractHostName(url);
    
    if (!url) {
      toast.error("Please enter a valid URL");
      return;
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      toast.error("Please enter a valid URL format (e.g., http://server:5000/nvidia-smi.json)");
      return;
    }

    if (hosts.some(host => host.url === url)) {
      toast.error("Host already exists");
      return;
    }

    setIsAdding(true);

    try {
      const response = await fetch("/api/hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url, name }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to add host (${response.status})`);
      }

      const newHost: Host = { url, name, isConnected: false };
      setHosts((prev) => [...prev, newHost]);
      
      setNewHostUrl("");
      setNewHostName("");
      toast.success(`Added host: ${name}`);
      
      // Test connection immediately
      testHostConnection(url);
    } catch (error) {
      console.error("Error adding host:", error);
      toast.error(error instanceof Error ? error.message : "Failed to add host");
    } finally {
      setIsAdding(false);
    }
  };

  const removeHost = async (url: string) => {
    setRemovingHost(url);

    try {
      const encodedUrl = encodeURIComponent(url);
      const response = await fetch(`/api/hosts/${encodedUrl}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok && response.status !== 404) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to remove host (${response.status})`);
      }

      setHosts((prev) => prev.filter((host) => host.url !== url));
      toast.success("Host removed");
    } catch (error) {
      console.error("Error removing host:", error);
      toast.error(error instanceof Error ? error.message : "Failed to remove host");
    } finally {
      setRemovingHost(null);
    }
  };

  const extractHostName = (url: string): string => {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname + (parsedUrl.port ? `:${parsedUrl.port}` : '');
    } catch {
      return url.split('/')[2] || url;
    }
  };

  const testHostConnection = async (url: string) => {
    try {
      const response = await fetch(proxyUrl(url));
      if (response.ok) {
        const data = await response.json();
        if (data.gpus) {
          toast.success(`Successfully connected to ${extractHostName(url)}`);
          onHostStatusChange(url, true);
        }
      } else {
        toast.warning(`Host added but not reachable: ${response.status}`);
        onHostStatusChange(url, false);
      }
    } catch (error) {
      toast.warning(`Host added but not reachable. Will retry on next refresh.`);
      onHostStatusChange(url, false);
    }
  };

  return (
    <Card className="control-panel">
      <CardContent className="pt-6 space-y-4">
        {/* Add New Host */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="host-url">Host URL</Label>
            <Input
              id="host-url"
              placeholder={import.meta.env.VITE_DEFAULT_HOST_URL || "http://your-gpu-server:5000/nvidia-smi.json"}
              value={newHostUrl}
              onChange={(e) => setNewHostUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="host-name">Display Name (Optional)</Label>
            <Input
              id="host-name"
              placeholder="Main Server"
              value={newHostName}
              onChange={(e) => setNewHostName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>&nbsp;</Label>
            <Button onClick={addHost} className="w-full" disabled={isAdding}>
              {isAdding ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {isAdding ? "Adding..." : "Add Host"}
            </Button>
          </div>
        </div>

        {/* Host List */}
        {hosts.length > 0 && (
          <div className="space-y-2">
            <Label>Configured Hosts ({hosts.length})</Label>
            <div className="space-y-2">
              {hosts.map((host) => {
                const isEditing = editingUrl === host.url;
                const isDragging = dragUrl === host.url;
                const isDragOver = dragOverUrl === host.url && dragUrl !== host.url;
                return (
                  <div
                    key={host.url}
                    onDragOver={(e) => {
                      if (!dragUrl || dragUrl === host.url) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOverUrl !== host.url) setDragOverUrl(host.url);
                    }}
                    onDragLeave={() => {
                      if (dragOverUrl === host.url) setDragOverUrl(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      onDrop(host.url);
                    }}
                    className={`flex items-center justify-between gap-3 p-3 border rounded-lg bg-card/50 transition ${
                      isDragging ? "opacity-40" : ""
                    } ${isDragOver ? "border-primary ring-1 ring-primary/40" : ""}`}
                  >
                    <div
                      draggable={!isEditing}
                      onDragStart={(e) => {
                        if (isEditing) return;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", host.url);
                        setDragUrl(host.url);
                      }}
                      onDragEnd={() => {
                        setDragUrl(null);
                        setDragOverUrl(null);
                      }}
                      className={`text-muted-foreground hover:text-foreground shrink-0 ${
                        isEditing ? "cursor-not-allowed opacity-30" : "cursor-grab active:cursor-grabbing"
                      }`}
                      title={isEditing ? "" : "Drag to reorder"}
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {host.isConnected ? (
                        <Wifi className="h-4 w-4 text-emerald shrink-0" />
                      ) : (
                        <WifiOff className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              autoFocus
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(host.url);
                                else if (e.key === "Escape") cancelEdit();
                              }}
                              maxLength={80}
                              className="h-8 max-w-[280px]"
                              disabled={savingName}
                            />
                            <Button
                              size="sm"
                              variant="default"
                              className="h-8 px-2"
                              onClick={() => saveEdit(host.url)}
                              disabled={savingName}
                              aria-label="Save name"
                            >
                              {savingName ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              onClick={cancelEdit}
                              disabled={savingName}
                              aria-label="Cancel rename"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(host)}
                            className="group flex items-center gap-1.5 text-left cursor-pointer"
                            title="Click to rename"
                          >
                            <span className="font-medium truncate">{host.name}</span>
                            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                          </button>
                        )}
                        <div className="text-xs text-muted-foreground font-mono truncate">
                          {host.url}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={host.isConnected ? "default" : "secondary"} className="text-[10px] h-5">
                          {host.isConnected ? "Connected" : "Disconnected"}
                        </Badge>
                        {hostsAiInfo?.[host.url]?.ollama?.isAvailable && (
                          <Badge variant="secondary" className="gap-1 text-[10px] h-5">
                            <Bot className="h-3 w-3" />
                            Ollama · {hostsAiInfo[host.url].ollama!.models.length}
                          </Badge>
                        )}
                        {hostsAiInfo?.[host.url]?.sglang?.isAvailable && (
                          <Badge variant="secondary" className="gap-1 text-[10px] h-5 bg-cyan-500/10 text-cyan-400">
                            <Sparkles className="h-3 w-3" />
                            SGLang · {hostsAiInfo[host.url].sglang!.models.length}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeHost(host.url)}
                      disabled={removingHost === host.url || isEditing}
                      title="Remove host"
                    >
                      {removingHost === host.url ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}