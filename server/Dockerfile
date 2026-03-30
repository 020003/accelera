FROM nvidia/cuda:12.3.2-base-ubuntu22.04

# Install Python, tini (PID 1 init), and minimal tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python3-pip tini curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

# Persistent data directory — mount a volume here
RUN mkdir -p /app/data && \
    groupadd -r accelera && \
    useradd -r -g accelera -d /app accelera && \
    chown -R accelera:accelera /app/data && \
    chmod +x /app/entrypoint.sh

EXPOSE 5000

# Docker / orchestrator health probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:5000/health || exit 1

# tini handles PID 1 duties; entrypoint fixes volume perms then drops to non-root
ENTRYPOINT ["tini", "--", "/app/entrypoint.sh"]

# Default: Flask dev server (supports background threads natively).
# For higher concurrency, use: CMD ["gunicorn", "-b", "0.0.0.0:5000", "-w", "1", "--threads", "4", "app:app"]
# Note: keep workers=1 since the app uses in-process background threads.
CMD ["python3", "app.py"]
