# Accelera Helm Chart

Deploy the **Accelera GPU Acceleration Platform** on Kubernetes or OpenShift
with a single `helm install`.

## Prerequisites

| Requirement | Notes |
|---|---|
| Kubernetes ≥ 1.26 **or** OpenShift ≥ 4.12 | |
| Helm ≥ 3.12 | |
| NVIDIA GPU Operator / Device Plugin | GPU nodes must expose `nvidia.com/gpu` resources |
| Container images pushed to an accessible registry | See [Build Images](#build-images) |

## Build Images

From the repo root:

```bash
# Frontend
docker build -t <REGISTRY>/accelera-frontend:latest -f Dockerfile .
docker push <REGISTRY>/accelera-frontend:latest

# GPU Exporter
docker build -t <REGISTRY>/accelera-gpu-exporter:latest -f server/Dockerfile server/
docker push <REGISTRY>/accelera-gpu-exporter:latest
```

## Quick Start (Kubernetes)

```bash
# Label GPU nodes (if not already done by the NVIDIA operator)
kubectl label node <GPU_NODE> nvidia.com/gpu.present=true

# Install
helm install accelera ./helm/accelera \
  --namespace accelera --create-namespace \
  --set frontend.image.repository=<REGISTRY>/accelera-frontend \
  --set gpuExporter.image.repository=<REGISTRY>/accelera-gpu-exporter \
  --set frontend.ingress.enabled=true \
  --set frontend.ingress.hosts[0].host=accelera.example.com \
  --set frontend.ingress.hosts[0].paths[0].path=/ \
  --set frontend.ingress.hosts[0].paths[0].pathType=Prefix
```

## Quick Start (OpenShift)

```bash
# Label GPU nodes
oc label node <GPU_NODE> nvidia.com/gpu.present=true

# Install with OpenShift route + SCC
helm install accelera ./helm/accelera \
  --namespace accelera --create-namespace \
  --set frontend.image.repository=<REGISTRY>/accelera-frontend \
  --set gpuExporter.image.repository=<REGISTRY>/accelera-gpu-exporter \
  --set openshift.enabled=true \
  --set openshift.route.enabled=true \
  --set openshift.route.host=accelera.apps.mycluster.example.com
```

## Using a values file

Create a `my-values.yaml`:

```yaml
frontend:
  image:
    repository: registry.internal/accelera-frontend
    tag: "2.1.0"
  ingress:
    enabled: true
    className: nginx
    hosts:
      - host: accelera.corp.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: accelera-tls
        hosts:
          - accelera.corp.example.com

gpuExporter:
  image:
    repository: registry.internal/accelera-gpu-exporter
    tag: "2.1.0"
  nodeSelector:
    nvidia.com/gpu.present: "true"

config:
  logLevel: DEBUG
  ollamaUrl: "http://localhost:11434"
  vllmUrl: ""          # auto-discover
  sglangUrl: ""        # auto-discover

# Enable for OpenShift
# openshift:
#   enabled: true
#   route:
#     enabled: true
#     host: accelera.apps.mycluster.example.com
```

```bash
helm install accelera ./helm/accelera -n accelera --create-namespace -f my-values.yaml
```

## Upgrade / Uninstall

```bash
helm upgrade accelera ./helm/accelera -n accelera -f my-values.yaml
helm uninstall accelera -n accelera
```

## Architecture

```
┌──────────────┐       ┌───────────────────────────────────┐
│   Browser    │──────▶│  Frontend (Deployment)            │
│              │       │  nginx:8080 + /api-proxy reverse  │
└──────────────┘       │  proxy to GPU nodes               │
                       └─────────────┬─────────────────────┘
                                     │ proxy_pass
                       ┌─────────────▼─────────────────────┐
                       │  GPU Exporter (DaemonSet)         │
                       │  hostNetwork — binds nodeIP:5000  │
                       │  hostPID — sees GPU processes     │
                       │  privileged — NVML access         │
                       │                                   │
                       │  Auto-discovers: Ollama, SGLang,  │
                       │  vLLM on localhost                │
                       └───────────────────────────────────┘
```

- **Frontend**: Nginx serves the React SPA. An entrypoint script auto-detects
  the cluster DNS resolver and patches `nginx.conf` at startup.
- **GPU Exporter**: Runs as a privileged DaemonSet on every GPU node. With
  `hostNetwork: true`, it binds directly to the node IP and can reach AI
  runtimes (Ollama, SGLang, vLLM) on `localhost`.

## Key Values

| Parameter | Default | Description |
|---|---|---|
| `frontend.enabled` | `true` | Deploy the frontend |
| `frontend.replicaCount` | `1` | Frontend replicas |
| `frontend.image.repository` | `accelera-frontend` | Frontend image |
| `frontend.ingress.enabled` | `false` | Create an Ingress |
| `gpuExporter.enabled` | `true` | Deploy the GPU exporter DaemonSet |
| `gpuExporter.image.repository` | `accelera-gpu-exporter` | Exporter image |
| `gpuExporter.hostNetwork` | `true` | Bind to node IP |
| `gpuExporter.hostPID` | `true` | See host GPU processes |
| `gpuExporter.privileged` | `true` | NVML access |
| `gpuExporter.nodeSelector` | `nvidia.com/gpu.present: "true"` | Schedule on GPU nodes |
| `gpuExporter.persistence.enabled` | `false` | Persist benchmark data |
| `config.ollamaUrl` | `http://localhost:11434` | Ollama endpoint |
| `config.sglangUrl` | `http://localhost:30000` | SGLang endpoint |
| `config.vllmUrl` | `http://localhost:8000` | vLLM endpoint |
| `config.proxyReadTimeout` | `120s` | Nginx proxy timeout |
| `openshift.enabled` | `false` | Enable OpenShift resources |
| `openshift.route.enabled` | `false` | Create an OpenShift Route |
| `openshift.scc.enabled` | `true` | Create privileged SCC |
