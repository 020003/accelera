import { useState } from "react";
import { proxyUrl } from "@/lib/proxy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Server, Wifi, WifiOff, Loader2, Bot, Sparkles } from "lucide-react";
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
      // Try to add to backend first if available
      const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
      try {
        const response = await fetch(proxyUrl(`${apiUrl}/api/hosts`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url, name })
        });
        
        if (!response.ok && response.status !== 404) {
          // Backend exists but returned an error
          const error = await response.json();
          throw new Error(error.error || 'Failed to add host to backend');
        }
      } catch (backendError) {
        // Backend might not be available, continue with local storage only
        console.log('Backend host management not available, using local storage only');
      }

      const newHost: Host = {
        url,
        name,
        isConnected: false
      };

      const updatedHosts = [...hosts, newHost];
      setHosts(updatedHosts);
      localStorage.setItem("gpu_monitor_hosts", JSON.stringify(updatedHosts));
      
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
      // Try to remove from backend first if available
      const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
      try {
        const encodedUrl = encodeURIComponent(url);
        const response = await fetch(proxyUrl(`${apiUrl}/api/hosts/${encodedUrl}`), {
          method: 'DELETE',
        });
        
        if (!response.ok && response.status !== 404) {
          // Backend exists but returned an error
          const error = await response.json();
          throw new Error(error.error || 'Failed to remove host from backend');
        }
      } catch (backendError) {
        // Backend might not be available, continue with local storage only
        console.log('Backend host management not available, using local storage only');
      }

      const updatedHosts = hosts.filter(host => host.url !== url);
      setHosts(updatedHosts);
      localStorage.setItem("gpu_monitor_hosts", JSON.stringify(updatedHosts));
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Host Management
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
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
              {hosts.map((host) => (
                <div
                  key={host.url}
                  className="flex items-center justify-between p-3 border rounded-lg bg-card/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      {host.isConnected ? (
                        <Wifi className="h-4 w-4 text-emerald" />
                      ) : (
                        <WifiOff className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <div className="font-medium">{host.name}</div>
                        <div className="text-sm text-muted-foreground">{host.url}</div>
                      </div>
                    </div>
                    <Badge variant={host.isConnected ? "default" : "secondary"}>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeHost(host.url)}
                    disabled={removingHost === host.url}
                  >
                    {removingHost === host.url ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}