import { useState } from "react";
import { proxyUrl } from "@/lib/proxy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, X, Bot, Wifi, WifiOff, Loader2, Settings } from "lucide-react";
import { toast } from "sonner";
import type { OllamaHostConfig } from "@/types/ollama";

interface OllamaHostManagerProps {
  hosts: OllamaHostConfig[];
  setHosts: (hosts: OllamaHostConfig[]) => void;
  onHostStatusChange?: (url: string, isConnected: boolean) => void;
}

export function OllamaHostManager({ hosts, setHosts, onHostStatusChange }: OllamaHostManagerProps) {
  const [newHostUrl, setNewHostUrl] = useState("");
  const [newHostName, setNewHostName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingHost, setRemovingHost] = useState<string | null>(null);
  const [testingHost, setTestingHost] = useState<string | null>(null);

  const addHost = async () => {
    const url = newHostUrl.trim();
    const name = newHostName.trim() || extractHostName(url);
    
    if (!url) {
      toast.error("Please enter a valid URL");
      return;
    }

    // Validate URL format
    try {
      const parsedUrl = new URL(url);
      if (!parsedUrl.protocol.startsWith('http')) {
        throw new Error('Invalid protocol');
      }
    } catch {
      toast.error("Please enter a valid URL format (e.g., http://localhost:11434)");
      return;
    }

    if (hosts.some(host => host.url === url)) {
      toast.error("Host already exists");
      return;
    }

    setIsAdding(true);

    try {
      const newHost: OllamaHostConfig = {
        url,
        name,
        isEnabled: true
      };

      const updatedHosts = [...hosts, newHost];
      setHosts(updatedHosts);
      localStorage.setItem("gpu_monitor_ollama_hosts", JSON.stringify(updatedHosts));
      
      setNewHostUrl("");
      setNewHostName("");
      toast.success(`Added Ollama host: ${name}`);
      
      // Test connection immediately
      testHostConnection(url);
    } catch (error) {
      console.error("Error adding Ollama host:", error);
      toast.error("Failed to add host");
    } finally {
      setIsAdding(false);
    }
  };

  const removeHost = async (url: string) => {
    setRemovingHost(url);

    try {
      const updatedHosts = hosts.filter(host => host.url !== url);
      setHosts(updatedHosts);
      localStorage.setItem("gpu_monitor_ollama_hosts", JSON.stringify(updatedHosts));
      toast.success("Ollama host removed");
    } catch (error) {
      console.error("Error removing Ollama host:", error);
      toast.error("Failed to remove host");
    } finally {
      setRemovingHost(null);
    }
  };

  const toggleHostEnabled = (url: string, enabled: boolean) => {
    const updatedHosts = hosts.map(host => 
      host.url === url ? { ...host, isEnabled: enabled } : host
    );
    setHosts(updatedHosts);
    localStorage.setItem("gpu_monitor_ollama_hosts", JSON.stringify(updatedHosts));
    
    toast.success(`Host ${enabled ? 'enabled' : 'disabled'}`);
  };

  const testHostConnection = async (url: string) => {
    setTestingHost(url);
    
    try {
      const response = await fetch(proxyUrl(`${url}/api/tags`));
      if (response.ok) {
        const data = await response.json();
        if (data.models) {
          toast.success(`✓ Connected to Ollama (${data.models.length} models)`);
          onHostStatusChange?.(url, true);
        }
      } else {
        toast.warning(`Host reachable but returned ${response.status}`);
        onHostStatusChange?.(url, false);
      }
    } catch (error) {
      toast.warning(`Could not connect to Ollama host`);
      onHostStatusChange?.(url, false);
    } finally {
      setTestingHost(null);
    }
  };

  const extractHostName = (url: string): string => {
    try {
      const parsedUrl = new URL(url);
      const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
      return parsedUrl.hostname + (port !== '80' && port !== '443' ? `:${port}` : '');
    } catch {
      return url.split('/')[2] || url;
    }
  };

  return (
    <Card className="control-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          Ollama Host Management
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Add New Host */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="ollama-url">Ollama URL</Label>
            <Input
              id="ollama-url"
              placeholder="http://localhost:11434"
              value={newHostUrl}
              onChange={(e) => setNewHostUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ollama-name">Display Name (Optional)</Label>
            <Input
              id="ollama-name"
              placeholder="Local Ollama"
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
            <Label>Configured Ollama Hosts ({hosts.length})</Label>
            <div className="space-y-2">
              {hosts.map((host) => (
                <div
                  key={host.url}
                  className="flex items-center justify-between p-3 border rounded-lg bg-card/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-primary" />
                      <div>
                        <div className="font-medium">{host.name}</div>
                        <div className="text-sm text-muted-foreground">{host.url}</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Badge variant={host.isEnabled ? "default" : "secondary"}>
                        {host.isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Enable/Disable Toggle */}
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={host.isEnabled}
                        onCheckedChange={(enabled) => toggleHostEnabled(host.url, enabled)}
                        disabled={removingHost === host.url}
                      />
                    </div>

                    {/* Test Connection */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testHostConnection(host.url)}
                      disabled={testingHost === host.url || !host.isEnabled}
                    >
                      {testingHost === host.url ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Wifi className="h-3 w-3" />
                      )}
                    </Button>

                    {/* Remove Host */}
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
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <Settings className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-1">Ollama Integration</p>
              <p>Connect to Ollama instances to monitor AI model performance, memory usage, and inference statistics alongside your GPU metrics.</p>
              <p className="mt-1 text-xs">Default Ollama URL: http://localhost:11434</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}