import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { proxyUrl } from '@/lib/proxy';
import type { 
  OllamaModel, 
  OllamaModelInfo, 
  OllamaSystemInfo, 
  OllamaHostData, 
  OllamaHostConfig,
  OllamaRequest,
  OllamaModelStats 
} from '@/types/ollama';

interface UseOllamaOptions {
  hosts: OllamaHostConfig[];
  refreshInterval?: number;
  enabled?: boolean;
}

export function useOllama({ hosts, refreshInterval = 5000, enabled = true }: UseOllamaOptions) {
  const [hostsData, setHostsData] = useState<OllamaHostData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestHistoryRef = useRef<Map<string, OllamaRequest[]>>(new Map());

  // Fetch models from an Ollama instance
  const fetchModels = async (hostUrl: string): Promise<OllamaModel[]> => {
    const response = await fetch(proxyUrl(`${hostUrl}/api/tags`));
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    const data = await response.json();
    return data.models || [];
  };

  // Fetch model info
  const fetchModelInfo = async (hostUrl: string, modelName: string): Promise<OllamaModelInfo> => {
    const response = await fetch(proxyUrl(`${hostUrl}/api/show`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName })
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch model info: ${response.status}`);
    }
    return response.json();
  };

  // Test model performance (optional utility function)
  const testModelPerformance = async (
    hostUrl: string, 
    modelName: string,
    testPrompt: string = "Hello, how are you?"
  ): Promise<OllamaRequest> => {
    const startTime = Date.now();
    
    try {
      const response = await fetch(proxyUrl(`${hostUrl}/api/generate`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          prompt: testPrompt,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Performance test failed: ${response.status}`);
      }

      const data = await response.json();
      const duration = Date.now() - startTime;
      
      const tokensPerSecond = data.eval_count && data.eval_duration 
        ? (data.eval_count / data.eval_duration) * 1e9 
        : 0;

      return {
        timestamp: startTime,
        model: modelName,
        prompt: testPrompt,
        duration,
        tokenCount: data.eval_count || 0,
        tokensPerSecond,
        success: true
      };
    } catch (error) {
      return {
        timestamp: startTime,
        model: modelName,
        prompt: testPrompt,
        duration: Date.now() - startTime,
        tokenCount: 0,
        tokensPerSecond: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };

  // Calculate model statistics
  const calculateModelStats = (
    model: OllamaModel, 
    requests: OllamaRequest[]
  ): OllamaModelStats => {
    const modelRequests = requests.filter(r => r.model === model.name);
    const successfulRequests = modelRequests.filter(r => r.success);
    
    const averageTokensPerSecond = successfulRequests.length > 0
      ? successfulRequests.reduce((sum, r) => sum + r.tokensPerSecond, 0) / successfulRequests.length
      : 0;

    return {
      model: model.name,
      size: model.size,
      lastUsed: model.modified_at,
      requestCount: modelRequests.length,
      averageTokensPerSecond,
      isLoaded: false // We'd need additional API to determine this
    };
  };

  // Fetch data from a single Ollama host
  const fetchHostData = async (host: OllamaHostConfig): Promise<OllamaHostData> => {
    if (!host.isEnabled) {
      return {
        url: host.url,
        name: host.name,
        isConnected: false,
        recentRequests: [],
        error: 'Host disabled'
      };
    }

    try {
      const models = await fetchModels(host.url);
      const requests = requestHistoryRef.current.get(host.url) || [];
      
      const activeModels = models.map(model => calculateModelStats(model, requests));
      const totalMemoryUsage = models.reduce((sum, model) => sum + model.size, 0);
      
      const successfulRequests = requests.filter(r => r.success);
      const performanceMetrics = {
        tokensPerSecond: successfulRequests.length > 0
          ? successfulRequests.reduce((sum, r) => sum + r.tokensPerSecond, 0) / successfulRequests.length
          : 0,
        modelLoadTimeMs: 0, // Would need real-time generation to measure
        totalDurationMs: successfulRequests.length > 0
          ? successfulRequests.reduce((sum, r) => sum + r.duration, 0) / successfulRequests.length
          : 0,
        promptProcessingMs: 0, // Would need detailed metrics from generation
        averageLatency: successfulRequests.length > 0
          ? successfulRequests.reduce((sum, r) => sum + r.duration, 0) / successfulRequests.length
          : 0,
        requestCount: requests.length,
        errorCount: requests.filter(r => !r.success).length
      };

      const systemInfo: OllamaSystemInfo = {
        models,
        activeModels,
        totalMemoryUsage,
        performanceMetrics,
        isOnline: true,
        timestamp: new Date().toISOString()
      };

      return {
        url: host.url,
        name: host.name,
        isConnected: true,
        systemInfo,
        recentRequests: requests.slice(-10) // Keep last 10 requests
      };

    } catch (error) {
      return {
        url: host.url,
        name: host.name,
        isConnected: false,
        recentRequests: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };

  // Fetch all hosts data
  const fetchAllHostsData = useCallback(async () => {
    if (!enabled || hosts.length === 0) {
      setHostsData([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const results = await Promise.all(hosts.map(fetchHostData));
      setHostsData(results);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to fetch Ollama data');
    } finally {
      setIsLoading(false);
    }
  }, [hosts, enabled]);

  // Auto-refresh data
  useEffect(() => {
    if (enabled && hosts.length > 0) {
      fetchAllHostsData();
      
      if (refreshInterval > 0) {
        const interval = setInterval(fetchAllHostsData, refreshInterval);
        return () => clearInterval(interval);
      }
    }
  }, [fetchAllHostsData, refreshInterval, enabled]);

  // Utility functions for external use
  const testHostPerformance = useCallback(async (hostUrl: string, modelName: string) => {
    const request = await testModelPerformance(hostUrl, modelName);
    
    // Add to request history
    const currentHistory = requestHistoryRef.current.get(hostUrl) || [];
    currentHistory.push(request);
    
    // Keep only last 50 requests per host
    if (currentHistory.length > 50) {
      currentHistory.shift();
    }
    
    requestHistoryRef.current.set(hostUrl, currentHistory);
    
    // Refresh data to show updated metrics
    fetchAllHostsData();
    
    return request;
  }, [fetchAllHostsData]);

  const getConnectedHosts = useCallback(() => {
    return hostsData.filter(host => host.isConnected);
  }, [hostsData]);

  const getTotalModels = useCallback(() => {
    return hostsData.reduce((total, host) => {
      return total + (host.systemInfo?.models.length || 0);
    }, 0);
  }, [hostsData]);

  const getAveragePerformance = useCallback(() => {
    const connectedHosts = getConnectedHosts();
    if (connectedHosts.length === 0) return 0;
    
    const totalTokensPerSecond = connectedHosts.reduce((sum, host) => {
      return sum + (host.systemInfo?.performanceMetrics.tokensPerSecond || 0);
    }, 0);
    
    return totalTokensPerSecond / connectedHosts.length;
  }, [getConnectedHosts]);

  return {
    hostsData,
    isLoading,
    error,
    refetch: fetchAllHostsData,
    testHostPerformance,
    getConnectedHosts,
    getTotalModels,
    getAveragePerformance
  };
}

// React Query integration for caching
export function useOllamaQuery(options: UseOllamaOptions) {
  const queryKey = ['ollama', options.hosts, options.refreshInterval];
  
  return useQuery({
    queryKey,
    queryFn: async () => {
      const { hostsData } = useOllama(options);
      return hostsData;
    },
    refetchInterval: options.refreshInterval,
    enabled: options.enabled,
    staleTime: options.refreshInterval ? options.refreshInterval / 2 : 30000
  });
}