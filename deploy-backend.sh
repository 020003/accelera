#!/bin/bash

# Backend hosts — read from env var, .gpu-hosts file, or command-line args
if [ $# -gt 0 ]; then
    HOSTS=("$@")
elif [ -n "${GPU_EXPORTER_HOSTS:-}" ]; then
    IFS=',' read -ra HOSTS <<< "$GPU_EXPORTER_HOSTS"
elif [ -f "$(dirname "$0")/.gpu-hosts" ]; then
    mapfile -t HOSTS < <(grep -v '^\s*#' "$(dirname "$0")/.gpu-hosts" | grep -v '^\s*$')
else
    echo "ERROR: No hosts specified."
    echo "Usage: $0 HOST1 HOST2 ..."
    echo "   or: GPU_EXPORTER_HOSTS=host1,host2 $0"
    echo "   or: create a .gpu-hosts file (one host per line)"
    exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Deploying Accelera Backend to GPU Hosts ===${NC}"

for host in "${HOSTS[@]}"; do
    echo -e "\n${YELLOW}Deploying to ${host}...${NC}"
    
    # Copy necessary files
    echo "Copying files to ${host}..."
    ssh labadmin@${host} "mkdir -p ~/gpu-dash-glow/server"
    scp -r server/* labadmin@${host}:~/gpu-dash-glow/server/
    scp docker-compose.gpu-exporter.yml labadmin@${host}:~/gpu-dash-glow/
    
    # Deploy with docker-compose
    echo "Starting Docker container on ${host}..."
    ssh labadmin@${host} "cd ~/gpu-dash-glow && docker-compose -f docker-compose.gpu-exporter.yml down"
    ssh labadmin@${host} "cd ~/gpu-dash-glow && docker-compose -f docker-compose.gpu-exporter.yml up -d --build"
    
    # Check deployment status
    echo "Checking deployment status on ${host}..."
    sleep 5
    if ssh labadmin@${host} "curl -s http://localhost:5000/api/health > /dev/null 2>&1"; then
        echo -e "${GREEN}✓ Backend successfully deployed on ${host}${NC}"
    else
        echo -e "${RED}✗ Backend deployment may have issues on ${host}${NC}"
    fi
done

echo -e "\n${GREEN}=== Backend Deployment Complete ===${NC}"
echo "You can now deploy the frontend with:"
echo "  docker-compose -f docker-compose.frontend.yml up -d --build"