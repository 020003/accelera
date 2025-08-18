#!/bin/bash

# Backend hosts - Update these with your actual GPU server IPs
HOSTS=("192.168.1.10" "192.168.1.11" "192.168.1.12")

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