#!/usr/bin/env bash
# deploy-gpu-exporter.sh – Deploy the Accelera GPU exporter container
# to remote hosts via SSH + docker compose.
#
# Usage:
#   ./deploy-gpu-exporter.sh                  # deploy to all configured hosts
#   ./deploy-gpu-exporter.sh <HOST_IP>        # deploy to a single host
#
# Prerequisites on each remote host:
#   - Docker with NVIDIA Container Toolkit installed
#   - SSH key-based access from this machine
#   - User must have docker permissions (docker group or root)

set -euo pipefail

# ---------- Configuration ----------
REMOTE_USER="${REMOTE_USER:-$(whoami)}"
REMOTE_DIR="${REMOTE_DIR:-accelera}"

# Hosts are read from (in order of priority):
#   1. Command-line arguments
#   2. GPU_EXPORTER_HOSTS env var (comma-separated)
#   3. .gpu-hosts file (one host per line, gitignored)
DEFAULT_HOSTS=()
if [ -n "${GPU_EXPORTER_HOSTS:-}" ]; then
    IFS=',' read -ra DEFAULT_HOSTS <<< "$GPU_EXPORTER_HOSTS"
elif [ -f "$(dirname "$0")/.gpu-hosts" ]; then
    mapfile -t DEFAULT_HOSTS < <(grep -v '^\s*#' "$(dirname "$0")/.gpu-hosts" | grep -v '^\s*$')
fi

# Files to transfer
FILES_TO_SYNC=(
    "server/"
    "docker-compose.gpu-exporter.yml"
)

# ---------- Helpers ----------
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; }

deploy_to_host() {
    local host="$1"
    log "Deploying to ${host} ..."

    # 1. Create remote directory in user home
    ssh "${REMOTE_USER}@${host}" "mkdir -p ~/${REMOTE_DIR}/server"

    # 2. Sync files via rsync (falls back to scp if rsync missing)
    if command -v rsync &>/dev/null; then
        rsync -avz --delete \
            --exclude '__pycache__' \
            --exclude '*.pyc' \
            --exclude 'data/' \
            server/ "${REMOTE_USER}@${host}:~/${REMOTE_DIR}/server/"

        rsync -avz \
            docker-compose.gpu-exporter.yml \
            "${REMOTE_USER}@${host}:~/${REMOTE_DIR}/docker-compose.gpu-exporter.yml"
    else
        warn "rsync not found, using scp (slower)"
        scp -r server/* "${REMOTE_USER}@${host}:~/${REMOTE_DIR}/server/"
        scp docker-compose.gpu-exporter.yml "${REMOTE_USER}@${host}:~/${REMOTE_DIR}/"
    fi

    # 3. Build & start the container
    ssh "${REMOTE_USER}@${host}" bash <<REMOTE_SCRIPT
        set -e
        cd ~/${REMOTE_DIR}
        echo "Building GPU exporter container..."
        docker compose -f docker-compose.gpu-exporter.yml build
        echo "Starting GPU exporter container..."
        docker compose -f docker-compose.gpu-exporter.yml up -d --force-recreate
        echo "Container status:"
        docker compose -f docker-compose.gpu-exporter.yml ps
REMOTE_SCRIPT

    # 4. Verify health
    sleep 3
    if curl -sf --connect-timeout 5 "http://${host}:5000/api/health" >/dev/null 2>&1; then
        log "✓ ${host} – GPU exporter healthy"
    else
        warn "${host} – health check pending (container may still be starting)"
    fi

    echo ""
}

# ---------- Main ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}"

if [ $# -gt 0 ]; then
    HOSTS=("$@")
else
    HOSTS=("${DEFAULT_HOSTS[@]}")
fi

if [ ${#HOSTS[@]} -eq 0 ]; then
    error "No hosts specified. Provide hosts via:"
    echo "  1. Command-line args:      ./deploy-gpu-exporter.sh HOST1 HOST2"
    echo "  2. Environment variable:   GPU_EXPORTER_HOSTS=host1,host2 ./deploy-gpu-exporter.sh"
    echo "  3. Local file:             echo 'host1' >> .gpu-hosts"
    exit 1
fi

log "Deploying Accelera GPU exporter to ${#HOSTS[@]} host(s)"
echo ""

FAILED=()
for host in "${HOSTS[@]}"; do
    if deploy_to_host "$host"; then
        log "✓ ${host} complete"
    else
        error "✗ ${host} failed"
        FAILED+=("$host")
    fi
done

echo ""
echo "=============================="
if [ ${#FAILED[@]} -eq 0 ]; then
    log "All ${#HOSTS[@]} host(s) deployed successfully"
else
    error "${#FAILED[@]} host(s) failed: ${FAILED[*]}"
    exit 1
fi

echo ""
log "Exporter endpoints:"
for host in "${HOSTS[@]}"; do
    echo "  GPU metrics:  http://${host}:5000/nvidia-smi.json"
    echo "  Prometheus:   http://${host}:5000/metrics"
    echo "  Health:       http://${host}:5000/api/health"
    echo "  GPU events:   http://${host}:5000/api/gpu/events"
    echo ""
done
