# API Reference

Accelera provides a comprehensive REST API for monitoring GPUs, managing hosts, and integrating with AI workload platforms.

## Base URL

```
http://localhost:5000/api
```

## Authentication

Currently, Accelera uses environment-based security without user authentication. For production deployments, configure CORS origins in the environment variables.

## Core Endpoints

### Health Check

#### GET /api/health
Check if the API service is running.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00Z",
  "version": "2.0.0"
}
```

### GPU Monitoring

#### GET /nvidia-smi.json
Get current GPU metrics in nvidia-smi format.

**Response:**
```json
{
  "host": "gpu-server-1",
  "timestamp": "2024-01-01T12:00:00Z",
  "platform": "Accelera",
  "version": "2.0",
  "gpus": [
    {
      "id": 0,
      "name": "NVIDIA H100 80GB HBM3",
      "uuid": "GPU-12345678-1234-1234-1234-123456789012",
      "utilization": 95,
      "memory": {
        "used": 76800,
        "total": 81920
      },
      "temperature": 67,
      "power": {
        "draw": 685,
        "limit": 700
      },
      "processes": [
        {
          "pid": 12345,
          "name": "python",
          "memory": 40960,
          "command": "python train.py"
        }
      ],
      "clocks": {
        "graphics": 1980,
        "memory": 2619
      },
      "pci": {
        "bus": "0000:17:00.0",
        "device_id": "233010DE",
        "sub_device_id": "157E10DE"
      }
    }
  ]
}
```

#### GET /api/gpu
Alternative endpoint with enhanced GPU data.

**Query Parameters:**
- `format` (optional): `json` (default) or `prometheus`
- `host` (optional): Filter by hostname

**Response:** Same as `/nvidia-smi.json` but with additional fields:
```json
{
  "host": "gpu-server-1",
  "gpus": [...],
  "metadata": {
    "driver_version": "535.86.10",
    "cuda_version": "12.2",
    "hostname": "gpu-server-1",
    "uptime": 3600
  }
}
```

### GPU Topology

#### GET /api/topology
Get GPU interconnect topology information.

**Response:**
```json
{
  "gpus": [
    {
      "id": "gpu-0",
      "name": "NVIDIA H100 80GB HBM3",
      "host": "gpu-node-1",
      "connections": [
        {
          "target": "gpu-1",
          "type": "NVLink",
          "bandwidth": 900,
          "description": "High-speed GPU interconnect"
        }
      ],
      "nic_connections": [
        {
          "nic_id": "mlx5_0",
          "nic_name": "ConnectX-7",
          "connection_type": "NODE",
          "description": "Mellanox InfiniBand adapter"
        }
      ]
    }
  ],
  "hosts": {
    "gpu-node-1": {
      "hostname": "gpu-node-1",
      "gpu_count": 8,
      "mellanox_nics": [
        {
          "id": "mlx5_0",
          "name": "ConnectX-7",
          "type": "InfiniBand"
        }
      ]
    }
  },
  "mellanoxFabric": true
}
```

### Historical Data

#### GET /api/heatmap
Get historical GPU metrics for heatmap visualization.

**Query Parameters:**
- `metric` (required): `utilization`, `temperature`, `power`, or `memory`
- `hours` (optional): Number of hours of historical data (default: 24, max: 168)
- `host` (optional): Filter by hostname

**Example:**
```
GET /api/heatmap?metric=utilization&hours=6
```

**Response:**
```json
{
  "hosts": ["gpu-server-1", "gpu-server-2"],
  "timestamps": [
    "2024-01-01T06:00:00Z",
    "2024-01-01T06:05:00Z",
    "2024-01-01T06:10:00Z"
  ],
  "metrics": {
    "utilization": [
      [95, 87, 92],  // gpu-server-1 over time
      [78, 82, 85]   // gpu-server-2 over time
    ]
  }
}
```

#### GET /api/timeline
Get AI workload timeline events.

**Query Parameters:**
- `host` (optional): Filter by hostname
- `hours` (optional): Number of hours (default: 24)
- `type` (optional): Filter by event type

**Response:**
```json
{
  "events": [
    {
      "id": "event-1",
      "content": "llama3.1:8b - inference",
      "start": "2024-01-01T12:00:00Z",
      "end": "2024-01-01T12:05:00Z",
      "type": "inference",
      "host": "gpu-server-1",
      "gpu": "GPU-0",
      "model": "llama3.1:8b",
      "status": "completed",
      "metadata": {
        "tokensPerSecond": 45.2,
        "requestCount": 15,
        "memoryUsage": 12800,
        "duration": 300
      }
    }
  ],
  "hosts": ["gpu-server-1", "gpu-server-2"]
}
```

## Ollama Integration

### Discovery

#### POST /api/ollama/discover
Discover Ollama instances on GPU hosts.

**Request Body:**
```json
{
  "hostUrl": "http://gpu-server-1:5000"
}
```

**Response:**
```json
{
  "isAvailable": true,
  "version": "0.1.17",
  "models": [
    {
      "name": "llama3.1:8b",
      "size": 4368896768,
      "modified": "2024-01-01T12:00:00Z"
    }
  ],
  "performanceMetrics": {
    "tokensPerSecond": 45.2,
    "modelLoadTimeMs": 2500,
    "totalDurationMs": 15000,
    "promptProcessingMs": 500,
    "averageLatency": 150,
    "requestCount": 25,
    "errorCount": 0
  },
  "recentRequests": [
    {
      "timestamp": "2024-01-01T12:00:00Z",
      "model": "llama3.1:8b",
      "prompt": "What is machine learning?",
      "response_time": 2.5,
      "tokens": 150
    }
  ]
}
```

#### GET /api/ollama/models
Get available Ollama models across all hosts.

**Response:**
```json
{
  "hosts": {
    "gpu-server-1": {
      "models": [
        {
          "name": "llama3.1:8b",
          "size": 4368896768,
          "modified": "2024-01-01T12:00:00Z"
        }
      ]
    }
  },
  "total_models": 5,
  "total_hosts": 2
}
```

#### GET /api/ollama/performance
Get Ollama performance metrics.

**Query Parameters:**
- `host` (optional): Filter by hostname
- `model` (optional): Filter by model name

**Response:**
```json
{
  "hosts": {
    "gpu-server-1": {
      "models": {
        "llama3.1:8b": {
          "tokensPerSecond": 45.2,
          "averageLatency": 150,
          "requestCount": 25,
          "errorRate": 0.04
        }
      },
      "overall": {
        "totalRequests": 100,
        "totalErrors": 4,
        "uptimeHours": 24
      }
    }
  }
}
```

## Host Management

#### GET /api/hosts
Get configured GPU hosts.

**Response:**
```json
{
  "hosts": [
    {
      "url": "http://gpu-server-1:5000/nvidia-smi.json",
      "name": "GPU Server 1",
      "isConnected": true,
      "lastSeen": "2024-01-01T12:00:00Z"
    }
  ]
}
```

#### POST /api/hosts
Add a new GPU host.

**Request Body:**
```json
{
  "url": "http://gpu-server-2:5000/nvidia-smi.json",
  "name": "GPU Server 2"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Host added successfully",
  "host": {
    "url": "http://gpu-server-2:5000/nvidia-smi.json",
    "name": "GPU Server 2",
    "isConnected": false
  }
}
```

#### DELETE /api/hosts/{url}
Remove a GPU host.

**Response:**
```json
{
  "success": true,
  "message": "Host removed successfully"
}
```

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid request parameters",
    "details": {
      "field": "metric",
      "reason": "must be one of: utilization, temperature, power, memory"
    }
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### HTTP Status Codes

- `200 OK` - Request successful
- `400 Bad Request` - Invalid request parameters
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Service temporarily unavailable

## Rate Limiting

API endpoints have rate limiting to ensure fair usage:

- **GPU endpoints**: 60 requests per minute
- **Ollama endpoints**: 30 requests per minute
- **Host management**: 10 requests per minute

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1640995200
```

## WebSocket API (Future)

Real-time updates will be available via WebSocket:

```javascript
const ws = new WebSocket('ws://localhost:5000/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  switch(data.type) {
    case 'gpu_update':
      // Handle GPU metric updates
      break;
    case 'ollama_status':
      // Handle Ollama status changes
      break;
  }
};
```

## SDK Examples

### Python
```python
import requests

class AcceleraAPI:
    def __init__(self, base_url="http://localhost:5000"):
        self.base_url = base_url
    
    def get_gpu_data(self):
        response = requests.get(f"{self.base_url}/nvidia-smi.json")
        return response.json()
    
    def get_topology(self):
        response = requests.get(f"{self.base_url}/api/topology")
        return response.json()

# Usage
api = AcceleraAPI()
gpu_data = api.get_gpu_data()
print(f"Found {len(gpu_data['gpus'])} GPUs")
```

### JavaScript
```javascript
class AcceleraAPI {
    constructor(baseUrl = 'http://localhost:5000') {
        this.baseUrl = baseUrl;
    }
    
    async getGpuData() {
        const response = await fetch(`${this.baseUrl}/nvidia-smi.json`);
        return await response.json();
    }
    
    async getTopology() {
        const response = await fetch(`${this.baseUrl}/api/topology`);
        return await response.json();
    }
}

// Usage
const api = new AcceleraAPI();
const gpuData = await api.getGpuData();
console.log(`Found ${gpuData.gpus.length} GPUs`);
```

### curl Examples

```bash
# Get GPU data
curl http://localhost:5000/nvidia-smi.json

# Get topology
curl http://localhost:5000/api/topology

# Get heatmap data
curl "http://localhost:5000/api/heatmap?metric=utilization&hours=6"

# Discover Ollama
curl -X POST http://localhost:5000/api/ollama/discover \
  -H "Content-Type: application/json" \
  -d '{"hostUrl": "http://gpu-server-1:5000"}'

# Add host
curl -X POST http://localhost:5000/api/hosts \
  -H "Content-Type: application/json" \
  -d '{"url": "http://gpu-server-2:5000/nvidia-smi.json", "name": "GPU Server 2"}'
```

For more examples and integration guides, see the [deployment documentation](DEPLOYMENT.md).