# Deployment Guide

This guide covers various deployment options for Accelera in production environments.

## Prerequisites

### System Requirements
- Docker and Docker Compose (recommended)
- Node.js 18+ and npm/yarn (for manual deployment)
- Python 3.8+ with pip (for manual deployment)
- NVIDIA GPU with drivers installed
- `nvidia-smi` command available

### Network Requirements
- Port 5000: Backend API
- Port 3000: Frontend development server (or 80/443 for production)
- GPU hosts must be accessible from the main dashboard

## Docker Deployment (Recommended)

### Quick Start
```bash
# Clone repository
git clone <repository-url>
cd accelera-gpu-dash

# Start with Docker Compose
docker-compose up -d

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:5000
```

### Production Docker Setup
```bash
# Use production compose file
docker-compose -f docker-compose.prod.yml up -d
```

### Custom Configuration
```bash
# Copy and edit environment file
cp .env.example .env
# Edit .env with your settings

# Start with custom configuration
docker-compose --env-file .env up -d
```

## Manual Deployment

### Backend Setup
```bash
cd server
pip install -r requirements.txt

# Set environment variables
export FLASK_HOST=0.0.0.0
export FLASK_PORT=5000
export FLASK_ENV=production

# Start backend
python app.py
```

### Frontend Setup
```bash
# Install dependencies
npm install

# Build for production
npm run build

# Serve build files (using serve)
npm install -g serve
serve -s dist -l 3000
```

## Multi-Host Deployment

### Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Main Dashboard │    │   GPU Host 1    │    │   GPU Host 2    │
│  (Frontend +    │◄──►│   (Backend)     │    │   (Backend)     │
│   Aggregator)   │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Step 1: Deploy Backend on GPU Hosts
On each GPU server:
```bash
cd server
pip install -r requirements.txt
python app.py --host 0.0.0.0 --port 5000
```

### Step 2: Deploy Main Dashboard
On your main server:
```bash
# Set backend hosts in environment
export VITE_BACKEND_HOSTS="http://gpu-host-1:5000,http://gpu-host-2:5000,http://gpu-host-3:5000"

# Build and deploy frontend
npm run build
serve -s dist -l 3000
```

### Step 3: Configure Host Discovery
1. Access the dashboard at http://your-dashboard:3000
2. Go to Settings tab
3. Add your GPU hosts:
   - `http://gpu-host-1:5000/nvidia-smi.json`
   - `http://gpu-host-2:5000/nvidia-smi.json`
   - `http://gpu-host-3:5000/nvidia-smi.json`

## Kubernetes Deployment

### Namespace Setup
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: accelera
```

### Backend Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: accelera-backend
  namespace: accelera
spec:
  replicas: 3
  selector:
    matchLabels:
      app: accelera-backend
  template:
    metadata:
      labels:
        app: accelera-backend
    spec:
      containers:
      - name: backend
        image: accelera/backend:latest
        ports:
        - containerPort: 5000
        env:
        - name: FLASK_HOST
          value: "0.0.0.0"
        - name: FLASK_PORT
          value: "5000"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: accelera-backend-service
  namespace: accelera
spec:
  selector:
    app: accelera-backend
  ports:
  - port: 5000
    targetPort: 5000
  type: LoadBalancer
```

### Frontend Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: accelera-frontend
  namespace: accelera
spec:
  replicas: 2
  selector:
    matchLabels:
      app: accelera-frontend
  template:
    metadata:
      labels:
        app: accelera-frontend
    spec:
      containers:
      - name: frontend
        image: accelera/frontend:latest
        ports:
        - containerPort: 3000
        env:
        - name: VITE_API_URL
          value: "http://accelera-backend-service:5000"
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "250m"
---
apiVersion: v1
kind: Service
metadata:
  name: accelera-frontend-service
  namespace: accelera
spec:
  selector:
    app: accelera-frontend
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

## Security Configuration

### SSL/TLS Setup
```nginx
# nginx.conf for SSL termination
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /etc/ssl/certs/accelera.crt;
    ssl_certificate_key /etc/ssl/private/accelera.key;
    
    location / {
        proxy_pass http://accelera-frontend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /api/ {
        proxy_pass http://accelera-backend:5000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Firewall Rules
```bash
# Allow necessary ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 5000/tcp  # Backend API
sudo ufw enable
```

### Environment Security
```bash
# Secure environment file permissions
chmod 600 .env
chown root:root .env

# Use strong secrets
export FLASK_SECRET_KEY=$(openssl rand -base64 32)
```

## Monitoring and Logging

### Health Checks
```yaml
# Add to Docker Compose
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:5000/api/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

### Log Configuration
```python
# server/logging_config.py
import logging
import os

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/var/log/accelera/backend.log'),
        logging.StreamHandler()
    ]
)
```

## Performance Optimization

### Backend Optimization
```python
# server/app.py optimizations
from flask_caching import Cache

app = Flask(__name__)
cache = Cache(app, config={'CACHE_TYPE': 'simple'})

@app.route('/api/gpu')
@cache.cached(timeout=5)  # Cache for 5 seconds
def get_gpu_data():
    return get_nvidia_smi_data()
```

### Frontend Optimization
```javascript
// Enable service worker for caching
// sw.js
const CACHE_NAME = 'accelera-v1';
const urlsToCache = [
    '/',
    '/static/css/main.css',
    '/static/js/main.js'
];
```

### Database Optimization (Optional)
```bash
# For historical data storage
docker run -d \
  --name accelera-redis \
  -p 6379:6379 \
  redis:alpine

# Configure in backend
export REDIS_URL=redis://localhost:6379
```

## Backup and Recovery

### Data Backup
```bash
# Backup configuration
tar -czf accelera-config-$(date +%Y%m%d).tar.gz .env docker-compose.yml

# Backup historical data (if using Redis)
redis-cli SAVE
cp /var/lib/redis/dump.rdb accelera-data-$(date +%Y%m%d).rdb
```

### Disaster Recovery
```bash
# Restore configuration
tar -xzf accelera-config-YYYYMMDD.tar.gz

# Restart services
docker-compose down
docker-compose up -d

# Verify deployment
curl http://localhost:5000/api/health
```

## Troubleshooting

### Common Issues

**Service won't start:**
```bash
# Check logs
docker-compose logs accelera-backend
docker-compose logs accelera-frontend

# Check system resources
docker system df
docker system prune
```

**GPU data not showing:**
```bash
# Verify nvidia-smi works
nvidia-smi

# Check backend connectivity
curl http://localhost:5000/nvidia-smi.json

# Check frontend API calls
# Open browser dev tools and check network tab
```

**High memory usage:**
```bash
# Limit container memory
echo "
services:
  accelera-backend:
    mem_limit: 1g
  accelera-frontend:
    mem_limit: 512m
" >> docker-compose.override.yml
```

### Performance Issues
```bash
# Enable debug mode
export FLASK_DEBUG=true
export FLASK_ENV=development

# Profile Python backend
pip install py-spy
py-spy record -o profile.svg -d 60 -p $(pgrep -f "python app.py")

# Monitor resource usage
htop
iotop
```

### Logs Location
```bash
# Docker logs
docker-compose logs -f

# System logs
sudo journalctl -u docker
sudo journalctl -f

# Application logs
tail -f /var/log/accelera/backend.log
tail -f /var/log/accelera/frontend.log
```

## Maintenance

### Updates
```bash
# Update Docker images
docker-compose pull
docker-compose up -d

# Update from Git
git pull origin main
docker-compose build --no-cache
docker-compose up -d
```

### Cleanup
```bash
# Clean up old Docker images
docker system prune -a

# Clean up logs
sudo logrotate /etc/logrotate.d/accelera
```

For additional support, please refer to the [troubleshooting guide](TROUBLESHOOTING.md) or open an issue on GitHub.