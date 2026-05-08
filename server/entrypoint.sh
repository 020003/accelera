#!/bin/sh
# Fix data directory ownership when volumes were created by an older root-based image.
chown -R accelera:accelera /app/data 2>/dev/null || true

# Background fabric stats collector — runs as root so it can enter the
# host's network namespace via nsenter and read Mellanox vport counters
# (the only accurate source for RoCE RDMA RX bytes).  Writes JSON to a
# tmpfs file that the unprivileged Flask process reads on each request.
mkdir -p /run/fabric
chmod 755 /run/fabric
if [ -f /app/fabric_poller.py ]; then
    nohup python3 /app/fabric_poller.py >>/var/log/fabric-poller.log 2>&1 &
fi

# Drop to non-root user and exec the CMD
exec runuser -u accelera -- "$@"
