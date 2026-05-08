#!/usr/bin/env python3
"""Root-side fabric stats poller.

Runs as a background process (started by the container entrypoint while
still root) and periodically writes Mellanox vport counters for every
RoCE / InfiniBand netdev to ``/run/fabric/stats.json``.

The Flask app (running as the unprivileged ``accelera`` user) reads
that JSON file in its /api/fabric/live request handler — it cannot
itself enter the host's network namespace because doing so requires
CAP_SYS_ADMIN, which the dropped-privilege user does not hold.

When run outside a container, or when nsenter / ethtool aren't
available, the poller still tries plain ``ethtool`` directly.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from typing import Any

OUT_PATH = os.environ.get("FABRIC_STATS_PATH", "/run/fabric/stats.json")
INTERVAL = float(os.environ.get("FABRIC_POLL_INTERVAL", "2.0"))
HOST_SYS = "/host/sys/class/infiniband"
LOCAL_SYS = "/sys/class/infiniband"


def _resolve_ib_root() -> str:
    for root in (HOST_SYS, LOCAL_SYS):
        if os.path.isdir(root):
            return root
    return LOCAL_SYS


def _ethtool_prefix() -> list[str]:
    """Return the argv prefix to invoke ethtool in the host net ns."""
    try:
        own_ns = os.readlink("/proc/self/ns/net")
        host_ns = os.readlink("/proc/1/ns/net")
    except OSError:
        return ["ethtool"]
    if own_ns != host_ns and os.path.exists("/usr/bin/nsenter"):
        return ["nsenter", "-t", "1", "-n", "ethtool"]
    return ["ethtool"]


_ETHTOOL = _ethtool_prefix()


def _ib_netdev(ib_dev: str, ib_root: str) -> str | None:
    net_dir = f"{ib_root}/{ib_dev}/device/net"
    try:
        entries = os.listdir(net_dir)
        return entries[0] if entries else None
    except OSError:
        return None


def _ethtool_stats(iface: str) -> dict[str, int]:
    try:
        out = subprocess.run(
            [*_ETHTOOL, "-S", iface],
            capture_output=True, text=True, timeout=2, check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {}
    if out.returncode != 0:
        return {}
    stats: dict[str, int] = {}
    for line in out.stdout.splitlines():
        line = line.strip()
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        try:
            stats[k.strip()] = int(v.strip())
        except ValueError:
            continue
    return stats


def collect_once() -> dict[str, Any]:
    ib_root = _resolve_ib_root()
    out: dict[str, Any] = {
        "ts": time.time(),
        "ethtool_cmd": _ETHTOOL,
        "ib_root": ib_root,
        "ports": {},
    }
    if not os.path.isdir(ib_root):
        return out
    for dev in sorted(os.listdir(ib_root)):
        iface = _ib_netdev(dev, ib_root)
        if not iface:
            continue
        s = _ethtool_stats(iface)
        if not s:
            continue
        # Aggregate kernel-stack unicast and RDMA unicast (skip mcast/bcast).
        tx = (s.get("tx_vport_unicast_bytes", 0)
              + s.get("tx_vport_rdma_unicast_bytes", 0))
        rx = (s.get("rx_vport_unicast_bytes", 0)
              + s.get("rx_vport_rdma_unicast_bytes", 0))
        # Only publish when we actually saw vport counters.
        if not any(k.startswith("tx_vport_") or k.startswith("rx_vport_") for k in s):
            continue
        out["ports"][dev] = {
            "iface": iface,
            "tx_bytes": tx,
            "rx_bytes": rx,
            "tx_rdma_bytes": s.get("tx_vport_rdma_unicast_bytes", 0),
            "rx_rdma_bytes": s.get("rx_vport_rdma_unicast_bytes", 0),
        }
    return out


def main() -> int:
    out_dir = os.path.dirname(OUT_PATH) or "/run/fabric"
    os.makedirs(out_dir, exist_ok=True)
    # World-readable so the unprivileged Flask user can read it.
    try:
        os.chmod(out_dir, 0o755)
    except OSError:
        pass

    tmp_path = f"{OUT_PATH}.tmp"
    while True:
        try:
            data = collect_once()
            with open(tmp_path, "w") as f:
                json.dump(data, f)
            os.chmod(tmp_path, 0o644)
            os.replace(tmp_path, OUT_PATH)
        except Exception as exc:  # noqa: BLE001
            print(f"fabric_poller error: {exc}", file=sys.stderr, flush=True)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
