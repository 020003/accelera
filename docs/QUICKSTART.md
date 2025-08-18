# Quick Start Guide

Get Accelera GPU Dashboard running in minutes with this step-by-step guide.

## Prerequisites

- **Docker & Docker Compose** (recommended)
- **NVIDIA GPU** with drivers installed
- **nvidia-smi** command available
- **Network access** between hosts (for multi-host setup)

## Option 1: Docker Quick Start (Recommended)

### Single Host Setup

```bash
# 1. Clone repository
git clone <your-repo-url>
cd accelera-gpu-dash

# 2. Start with Docker Compose
docker-compose up -d

# 3. Access the dashboard
# Frontend: http://localhost:3000
# Backend API: http://localhost:5000
```

### Multi-Host Setup

```bash
# 1. Deploy backend on each GPU server
./deploy-backend.sh

# 2. Start frontend dashboard
docker-compose -f docker-compose.frontend.yml up -d

# 3. Access dashboard at http://localhost:8080
```

## Option 2: Manual Development Setup

### Backend Setup (GPU Server)

```bash
cd server
pip install -r requirements.txt

# Set environment
export FLASK_HOST=0.0.0.0
export FLASK_PORT=5000

# Start backend
python app.py
```

### Frontend Setup (Dashboard Server)

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build && npm run preview
```

## Configuration

### Environment Variables

Copy the example environment file and customize:

```bash
cp .env.example .env
# Edit .env with your settings
```

### Key Settings

```bash
# Frontend
VITE_BACKEND_HOSTS=http://gpu-host-1:5000,http://gpu-host-2:5000

# Backend  
FLASK_HOST=0.0.0.0
FLASK_PORT=5000

# Security
FLASK_SECRET_KEY=$(openssl rand -base64 32)
```

## Adding GPU Hosts

1. **Access the dashboard** at your configured URL
2. **Navigate to Settings** tab
3. **Add your GPU hosts**:
   - URL: `http://your-gpu-server:5000/nvidia-smi.json`
   - Name: `GPU Server 1`
4. **Click "Add Host"**

## Verification

Check that everything is working:

```bash
# Test backend API
curl http://localhost:5000/api/health

# Test GPU data
curl http://localhost:5000/nvidia-smi.json

# Check frontend
curl http://localhost:3000
```

## Next Steps

- **Explore Advanced Visualizations**: GPU Topology, 3D Heatmaps, AI Timeline
- **Configure Ollama Integration**: Auto-discover AI model servers
- **Set Energy Rates**: Track GPU power consumption costs
- **Customize Refresh Intervals**: Optimize for your monitoring needs

## Common Issues & Solutions

### GPU Data Not Showing

```bash
# Check nvidia-smi works
nvidia-smi

# Verify backend is running
ps aux | grep "python app.py"

# Check logs
docker-compose logs backend
```

### Connection Issues

```bash
# Test connectivity
curl http://your-gpu-server:5000/api/health

# Check firewall
sudo ufw status
sudo ufw allow 5000/tcp

# Verify Docker networking
docker network ls
```

### Performance Issues

```bash
# Reduce refresh interval
# In dashboard: Settings → Refresh Interval → 10 seconds

# Check system resources
htop
docker stats
```

## Production Deployment

For production environments, see the [Deployment Guide](DEPLOYMENT.md) for:

- SSL/TLS configuration
- Kubernetes deployment
- Load balancing
- Security hardening
- Monitoring setup

## Support

- **Documentation**: [docs/](.)
- **API Reference**: [API.md](API.md)
- **Issues**: GitHub Issues
- **Community**: Discord/Forums

---

**🎉 Congratulations!** You now have Accelera GPU Dashboard running. Start monitoring your GPU infrastructure and optimizing your AI workloads!