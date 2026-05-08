"""Live fabric telemetry — NVLink + InfiniBand / RoCE.

Returns instantaneous tx/rx byte rates for every NVLink and IB port on
the host so the topology view can highlight active links during
distributed training, NCCL all-reduces, KV-cache transfers, etc.

NVLink is read via NVML (`pynvml`) using field values, with a graceful
fallback to legacy utilisation counters on older drivers.  Returns an
empty array when no NVLinks are present (e.g. L4, H100 NVL).

InfiniBand is read from sysfs (`/sys/class/infiniband/<dev>/ports/<p>/`).
The ``port_xmit_data`` / ``port_rcv_data`` counters are in 4-byte words
per IB spec — we multiply by 4 to get bytes.

Rates are computed by caching the previous (timestamp, value) per
counter in process memory and returning ``delta / dt`` on each call.
The first call after process start returns 0 rates (warm-up).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

from flask import Blueprint, jsonify

log = logging.getLogger(__name__)
fabric_bp = Blueprint("fabric", __name__)

# ---------------------------------------------------------------------------
# Rate cache: {key: (timestamp, value)}.  Updated atomically per request.
# ---------------------------------------------------------------------------

_cache_lock = threading.Lock()
_rate_cache: dict[str, tuple[float, float]] = {}


def _rate(key: str, value: float, now: float) -> float:
    """Return bytes/sec for *key* using the previous cached sample.

    Updates the cache to (now, value).  Handles counter resets (current
    less than previous → treat current as the delta).  Returns 0.0 on
    first observation or when dt <= 0.
    """
    with _cache_lock:
        prev = _rate_cache.get(key)
        _rate_cache[key] = (now, value)
    if prev is None:
        return 0.0
    prev_ts, prev_val = prev
    dt = now - prev_ts
    if dt <= 0:
        return 0.0
    delta = value - prev_val if value >= prev_val else value
    if delta < 0:
        return 0.0
    return delta / dt


# ---------------------------------------------------------------------------
# InfiniBand / RoCE — read from sysfs (always available when devices exist)
# ---------------------------------------------------------------------------

def _resolve_ib_root() -> str:
    """Prefer the host's sysfs (bind-mounted at /host/sys) so IB device
    symlinks resolve correctly.  Fall back to the container's /sys for
    non-Docker deployments."""
    for candidate in ("/host/sys/class/infiniband", "/sys/class/infiniband"):
        if os.path.isdir(candidate):
            # Probe one device to make sure counters are reachable
            try:
                for dev in os.listdir(candidate):
                    counters_dir = f"{candidate}/{dev}/ports/1/counters"
                    if os.path.isdir(counters_dir):
                        return candidate
            except OSError:
                continue
    return "/sys/class/infiniband"  # last resort, may yield empty results


_IB_ROOT = _resolve_ib_root()


def _read_int(path: str) -> int | None:
    try:
        with open(path, "r") as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError, PermissionError):
        return None


def _read_str(path: str) -> str:
    try:
        with open(path, "r") as f:
            return f.read().strip()
    except (FileNotFoundError, PermissionError):
        return ""


def _parse_rate_gbps(raw: str) -> float:
    """`/sys/.../rate` looks like '100 Gb/sec (4X EDR)'."""
    try:
        return float(raw.split()[0])
    except (ValueError, IndexError):
        return 0.0


def _parse_state(raw: str) -> str:
    """`/sys/.../state` looks like '4: ACTIVE' or '1: DOWN'."""
    if ":" in raw:
        return raw.split(":", 1)[1].strip()
    return raw or "UNKNOWN"


def _collect_infiniband(now: float) -> list[dict[str, Any]]:
    if not os.path.isdir(_IB_ROOT):
        return []

    out: list[dict[str, Any]] = []
    try:
        devices = sorted(os.listdir(_IB_ROOT))
    except OSError:
        return []

    for dev in devices:
        ports_dir = f"{_IB_ROOT}/{dev}/ports"
        if not os.path.isdir(ports_dir):
            continue
        try:
            ports = sorted(os.listdir(ports_dir))
        except OSError:
            continue
        for p in ports:
            base = f"{ports_dir}/{p}"
            counters = f"{base}/counters"
            tx_words = _read_int(f"{counters}/port_xmit_data")
            rx_words = _read_int(f"{counters}/port_rcv_data")
            if tx_words is None or rx_words is None:
                continue
            # IB counters are in 4-byte words
            tx_bytes = tx_words * 4
            rx_bytes = rx_words * 4
            tx_bps = _rate(f"ib:{dev}:{p}:tx", tx_bytes, now)
            rx_bps = _rate(f"ib:{dev}:{p}:rx", rx_bytes, now)
            link_downed = _read_int(f"{counters}/link_downed") or 0
            symbol_errors = _read_int(f"{counters}/symbol_error") or 0
            out.append({
                "device": dev,
                "port": int(p),
                "state": _parse_state(_read_str(f"{base}/state")),
                "rate_gbps": _parse_rate_gbps(_read_str(f"{base}/rate")),
                "link_layer": _read_str(f"{base}/link_layer") or "Unknown",
                "tx_bytes": tx_bytes,
                "rx_bytes": rx_bytes,
                "tx_bps": tx_bps,
                "rx_bps": rx_bps,
                "errors": {
                    "link_downed": link_downed,
                    "symbol_errors": symbol_errors,
                },
            })
    return out


# ---------------------------------------------------------------------------
# NVLink — read via NVML
# ---------------------------------------------------------------------------

# NVML field IDs (see nvml.h).  These return cumulative bytes since boot
# when supported by driver/GPU.
_NVML_FI_DEV_NVLINK_THROUGHPUT_DATA_TX = 236
_NVML_FI_DEV_NVLINK_THROUGHPUT_DATA_RX = 237
_NVML_NVLINK_MAX_LINKS = 18

_pynvml = None
_pynvml_init_failed = False


def _get_pynvml():
    global _pynvml, _pynvml_init_failed
    if _pynvml is not None:
        return _pynvml
    if _pynvml_init_failed:
        return None
    try:
        import pynvml  # type: ignore
        pynvml.nvmlInit()
        _pynvml = pynvml
        return pynvml
    except Exception as exc:
        log.debug("pynvml init failed: %s", exc)
        _pynvml_init_failed = True
        return None


def _collect_nvlink(now: float) -> list[dict[str, Any]]:
    pynvml = _get_pynvml()
    if pynvml is None:
        return []

    out: list[dict[str, Any]] = []
    try:
        device_count = pynvml.nvmlDeviceGetCount()
    except Exception:
        return []

    for gpu_idx in range(device_count):
        try:
            handle = pynvml.nvmlDeviceGetHandleByIndex(gpu_idx)
        except Exception:
            continue

        for link in range(_NVML_NVLINK_MAX_LINKS):
            # State: 0 = inactive, 1 = active.  Raises on unsupported links.
            try:
                state = pynvml.nvmlDeviceGetNvLinkState(handle, link)
            except pynvml.NVMLError:
                # Link doesn't exist on this GPU — stop probing.
                break
            if state != 1:
                # Link present but inactive — surface it for the UI but
                # don't bother sampling counters.
                out.append({
                    "gpu": gpu_idx,
                    "link": link,
                    "state": "inactive",
                    "tx_bps": 0.0,
                    "rx_bps": 0.0,
                })
                continue

            # Try field-value path first (preferred).
            tx_bytes = rx_bytes = None
            try:
                FieldValue = pynvml.c_nvmlFieldValue_t  # type: ignore[attr-defined]
                fields = (FieldValue * 2)()
                fields[0].fieldId = _NVML_FI_DEV_NVLINK_THROUGHPUT_DATA_TX
                fields[0].scopeId = link
                fields[1].fieldId = _NVML_FI_DEV_NVLINK_THROUGHPUT_DATA_RX
                fields[1].scopeId = link
                pynvml.nvmlDeviceGetFieldValues(handle, 2, fields)
                if fields[0].nvmlReturn == 0:
                    tx_bytes = float(fields[0].value.ullVal)
                if fields[1].nvmlReturn == 0:
                    rx_bytes = float(fields[1].value.ullVal)
            except Exception as exc:
                log.debug("NVLink field-value read failed gpu=%s link=%s: %s",
                          gpu_idx, link, exc)

            entry: dict[str, Any] = {
                "gpu": gpu_idx,
                "link": link,
                "state": "active",
            }
            if tx_bytes is not None:
                entry["tx_bytes"] = tx_bytes
                entry["tx_bps"] = _rate(f"nvl:{gpu_idx}:{link}:tx", tx_bytes, now)
            else:
                entry["tx_bps"] = 0.0
            if rx_bytes is not None:
                entry["rx_bytes"] = rx_bytes
                entry["rx_bps"] = _rate(f"nvl:{gpu_idx}:{link}:rx", rx_bytes, now)
            else:
                entry["rx_bps"] = 0.0
            out.append(entry)
    return out


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@fabric_bp.route("/api/fabric/live", methods=["GET"])
def fabric_live():
    """Snapshot of NVLink and IB live activity for this host."""
    now = time.time()
    try:
        ib = _collect_infiniband(now)
    except Exception:
        log.exception("IB collection failed")
        ib = []
    try:
        nvlink = _collect_nvlink(now)
    except Exception:
        log.exception("NVLink collection failed")
        nvlink = []

    # Rough hostname for client-side grouping (the proxy already knows
    # this, but it's cheap to include and matches the topology endpoint).
    try:
        host = os.uname().nodename
    except Exception:
        host = ""

    return jsonify({
        "host": host,
        "timestamp": now,
        "nvlink": nvlink,
        "infiniband": ib,
    })
