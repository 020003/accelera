import React, { useEffect, useRef, useState } from 'react';
import { Timeline, TimelineOptions } from 'vis-timeline/standalone';
import { DataSet } from 'vis-data/standalone';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bot, Clock, Cpu, Play, Square, Pause } from 'lucide-react';
import 'vis-timeline/styles/vis-timeline-graph2d.min.css';

interface WorkloadEvent {
  id: string;
  content: string;
  start: Date;
  end?: Date;
  type: 'model-load' | 'inference' | 'gpu-allocation' | 'training';
  host: string;
  gpu?: string;
  model?: string;
  status: 'running' | 'completed' | 'failed' | 'queued';
  metadata?: {
    tokensPerSecond?: number;
    requestCount?: number;
    memoryUsage?: number;
    duration?: number;
  };
}

interface TimelineData {
  events: WorkloadEvent[];
  hosts: string[];
}

const eventTypeConfig = {
  'model-load': {
    color: '#0078FF', // Accelera Blue
    icon: '📚',
    label: 'Model Loading',
  },
  'inference': {
    color: '#00FF88', // Accelera Green
    icon: '🧠',
    label: 'Inference',
  },
  'gpu-allocation': {
    color: '#9A4DFF', // Accelera Violet
    icon: '⚡',
    label: 'GPU Allocation',
  },
  'training': {
    color: '#0078FF', // Accelera Blue
    icon: '🎓',
    label: 'Training',
  },
};

const statusConfig = {
  running: { color: '#00FF88', icon: Play }, // Accelera Green
  completed: { color: '#6b7280', icon: Square },
  failed: { color: '#ef4444', icon: Square },
  queued: { color: '#9A4DFF', icon: Pause }, // Accelera Violet
};

export function AIWorkloadTimeline({ data }: { data?: TimelineData }) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineInstance = useRef<Timeline | null>(null);
  const [selectedHost, setSelectedHost] = useState<string>('all');
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  
  // Generate demo data
  const generateDemoData = (): TimelineData => {
    const hosts = ['server-1', 'server-2', 'server-3'];
    const models = ['llama3.1:8b', 'qwen2.5:32b', 'deepseek-r1:14b', 'llama3.3:70b'];
    const events: WorkloadEvent[] = [];
    
    const now = new Date();
    
    // Generate events for the last 2 hours
    for (let i = 0; i < 50; i++) {
      const startTime = new Date(now.getTime() - Math.random() * 2 * 60 * 60 * 1000);
      const duration = Math.random() * 30 * 60 * 1000; // 0-30 minutes
      const endTime = new Date(startTime.getTime() + duration);
      
      const host = hosts[Math.floor(Math.random() * hosts.length)];
      const model = models[Math.floor(Math.random() * models.length)];
      const eventTypes = Object.keys(eventTypeConfig) as Array<keyof typeof eventTypeConfig>;
      const type = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      const statuses = Object.keys(statusConfig) as Array<keyof typeof statusConfig>;
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      
      events.push({
        id: `event-${i}`,
        content: `${model} - ${type}`,
        start: startTime,
        end: status === 'running' ? undefined : endTime,
        type,
        host,
        gpu: `GPU-${Math.floor(Math.random() * 4)}`,
        model,
        status,
        metadata: {
          tokensPerSecond: Math.random() * 100,
          requestCount: Math.floor(Math.random() * 1000),
          memoryUsage: Math.random() * 24000,
          duration: duration / 1000,
        },
      });
    }
    
    return { events, hosts };
  };
  
  useEffect(() => {
    // Only use demo data if no data is provided at all
    if (data === undefined) {
      // Still loading
      setTimelineData(null);
    } else if (data === null) {
      // Generate demo data
      setTimelineData(generateDemoData());
    } else {
      // Use provided data, ensure hosts array exists
      const workloadData = {
        ...data,
        hosts: data.hosts || [...new Set(data.events?.map(e => e.host) || [])]
      };
      setTimelineData(workloadData);
    }
  }, [data]);
  
  useEffect(() => {
    if (!timelineRef.current || !timelineData) return;
    
    try {
    
    // Filter events by selected host
    const filteredEvents = selectedHost === 'all' 
      ? timelineData.events 
      : timelineData.events.filter(event => event.host === selectedHost);
    
    // Ensure absolutely unique IDs by adding timestamp and random suffix
    const uniqueEvents = filteredEvents.map((event, index) => ({
      ...event,
      id: `${event.id}-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`
    }));
    
    // Convert events to timeline items
    const items = new DataSet(
      uniqueEvents.map(event => {
        const config = eventTypeConfig[event.type];
        const statusInfo = statusConfig[event.status];
        
        const startDate = typeof event.start === 'string' ? new Date(event.start) : event.start;
        let endDate = event.end ? (typeof event.end === 'string' ? new Date(event.end) : event.end) : null;
        
        // Ensure minimum visible duration for short events (at least 2 minutes)
        const minDuration = 2 * 60 * 1000; // 2 minutes in milliseconds
        if (endDate && (endDate.getTime() - startDate.getTime()) < minDuration) {
          endDate = new Date(startDate.getTime() + minDuration);
        }
        
        // If no end date, create a visible range (5 minutes)
        if (!endDate) {
          endDate = new Date(startDate.getTime() + 5 * 60 * 1000);
        }
        
        return {
          id: event.id,
          content: `
            <div style="padding: 8px 12px; min-height: 50px; display: flex; align-items: center; gap: 8px; background: ${config.color}; border-radius: 6px; color: white; font-weight: 600; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
              <span style="font-size: 18px;">${config.icon}</span>
              <div>
                <div style="font-size: 14px; font-weight: bold; margin-bottom: 2px;">${event.model || event.content}</div>
                <div style="font-size: 11px; opacity: 0.9;">${event.host} • ${event.gpu || 'GPU'}</div>
                ${event.metadata?.tokensPerSecond ? 
                  `<div style="font-size: 11px; opacity: 0.9;">⚡ ${event.metadata.tokensPerSecond.toFixed(1)} t/s</div>` : 
                  ''
                }
              </div>
            </div>
          `,
          start: startDate,
          end: endDate,
          type: 'range', // Always use range type for better visibility
          className: `timeline-item timeline-${event.type} timeline-${event.status}`,
          style: `background-color: ${config.color}; border: 2px solid ${statusInfo.color}; border-radius: 6px; min-height: 50px;`,
          title: `
            Type: ${config.label}
            Model: ${event.model}
            Host: ${event.host}
            GPU: ${event.gpu}
            Status: ${event.status}
            ${event.metadata?.duration ? `Duration: ${(event.metadata.duration / 60).toFixed(1)}m` : ''}
            ${event.metadata?.memoryUsage ? `Memory: ${(event.metadata.memoryUsage / 1024).toFixed(1)} GB` : ''}
          `.trim(),
        };
      })
    );
    
    
    // Calculate time range from events or use default
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    
    let startTime = twoHoursAgo;
    let endTime = now;
    
    if (uniqueEvents.length > 0) {
      const eventTimes = uniqueEvents.map(e => {
        const start = typeof e.start === 'string' ? new Date(e.start) : e.start;
        return start.getTime();
      });
      const minTime = Math.min(...eventTimes);
      const maxTime = Math.max(...eventTimes);
      
      startTime = new Date(minTime - 30 * 60 * 1000); // 30 min before first event
      endTime = new Date(maxTime + 30 * 60 * 1000); // 30 min after last event
      
    }
    
    // Timeline options
    const options: TimelineOptions = {
      width: '100%',
      height: '500px', // Increased height
      start: startTime,
      end: endTime,
      zoomMin: 60 * 1000, // 1 minute
      zoomMax: 24 * 60 * 60 * 1000, // 24 hours
      orientation: 'top',
      stack: true,
      showCurrentTime: true,
      format: {
        minorLabels: {
          minute: 'HH:mm',
          hour: 'HH:mm',
        },
        majorLabels: {
          minute: 'ddd DD MMM',
          hour: 'ddd DD MMM',
        },
      },
      margin: {
        item: {
          horizontal: 5, // Reduced horizontal margin
          vertical: 10, // Increased vertical margin for better separation
        },
        axis: 50, // More space for time labels
      },
      tooltip: {
        followMouse: true,
        overflowMethod: 'cap',
      },
      groupOrder: 'content', // Order groups by content
      itemsAlwaysDraggable: false, // Disable dragging for cleaner look
      editable: false, // Disable editing
    };
    
    // Create or update timeline
    if (timelineInstance.current) {
      timelineInstance.current.destroy();
    }
    
    timelineInstance.current = new Timeline(timelineRef.current, items, options);
    
    // Event listener for item selection
    timelineInstance.current.on('select', (properties) => {
      const selectedId = properties.items[0];
      if (selectedId) {
        const event = uniqueEvents.find(e => e.id === selectedId);
        if (event) {
          console.log('Selected event:', event);
        }
      }
    });
    
    return () => {
      if (timelineInstance.current) {
        timelineInstance.current.destroy();
        timelineInstance.current = null;
      }
    };
    
    } catch (error) {
      console.error('Error rendering timeline:', error);
    }
  }, [timelineData, selectedHost]);
  
  const getEventStats = () => {
    if (!timelineData) return { total: 0, running: 0, completed: 0, failed: 0 };
    
    const filteredEvents = selectedHost === 'all' 
      ? timelineData.events 
      : timelineData.events.filter(event => event.host === selectedHost);
    
    return {
      total: filteredEvents.length,
      running: filteredEvents.filter(e => e.status === 'running').length,
      completed: filteredEvents.filter(e => e.status === 'completed').length,
      failed: filteredEvents.filter(e => e.status === 'failed').length,
    };
  };
  
  const stats = getEventStats();
  
  // Show loading state first
  if (!timelineData) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            AI Workload Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] w-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
              <div className="text-lg font-medium mb-2">Loading timeline data...</div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            AI Workload Timeline
          </CardTitle>
          
          <div className="flex items-center gap-4">
            <Select value={selectedHost} onValueChange={setSelectedHost}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Hosts</SelectItem>
                {timelineData?.hosts?.map(host => (
                  <SelectItem key={host} value={host}>
                    {host}
                  </SelectItem>
                )) || []}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="flex gap-4">
          <Badge variant="secondary" className="flex items-center gap-1">
            <Bot className="h-3 w-3" />
            Total: {stats.total}
          </Badge>
          <Badge variant="default" className="flex items-center gap-1">
            <Play className="h-3 w-3" />
            Running: {stats.running}
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            <Square className="h-3 w-3" />
            Completed: {stats.completed}
          </Badge>
          {stats.failed > 0 && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <Square className="h-3 w-3" />
              Failed: {stats.failed}
            </Badge>
          )}
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="mb-4 flex gap-4 text-sm">
          {Object.entries(eventTypeConfig).map(([type, config]) => (
            <div key={type} className="flex items-center gap-2">
              <span style={{ fontSize: '16px' }}>{config.icon}</span>
              <span>{config.label}</span>
            </div>
          ))}
        </div>
        
        <div 
          ref={timelineRef} 
          className="w-full border rounded-lg"
          style={{ minHeight: '400px' }}
        />
        
        <div className="mt-4 text-sm text-muted-foreground">
          <p>📌 Click and drag to pan • Mouse wheel to zoom • Click items for details</p>
        </div>
      </CardContent>
      
      <style jsx global>{`
        .vis-timeline {
          border: none !important;
          font-family: inherit !important;
        }
        
        .vis-item {
          border-radius: 6px !important;
          border-width: 2px !important;
        }
        
        .vis-item.timeline-running {
          animation: pulse 2s infinite;
        }
        
        .vis-item.timeline-model-load {
          background: linear-gradient(45deg, #0078FF, #4DA6FF) !important;
        }
        
        .vis-item.timeline-inference {
          background: linear-gradient(45deg, #00FF88, #4DFFAA) !important;
        }
        
        .vis-item.timeline-gpu-allocation {
          background: linear-gradient(45deg, #9A4DFF, #B574FF) !important;
        }
        
        .vis-item.timeline-training {
          background: linear-gradient(45deg, #0078FF, #4DA6FF) !important;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </Card>
  );
}