"""GPU error / event logging blueprint.

Exposes XID errors, ECC memory errors, and thermal throttling events
read from NVML and nvidia-smi.
"""

import socket
import time
from datetime import datetime

from flask import Blueprint, jsonify, request

from utils import run_cmd

events_bp = Blueprint("events", __name__)


def _query_nvml_events() -> list[dict]:
    """Try to read GPU events via NVML bindings."""
    results = []
    try:
        import pynvml
        pynvml.nvmlInit()
        device_count = pynvml.nvmlDeviceGetCount()
        hostname = socket.gethostname()

        for i in range(device_count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            gpu_name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(gpu_name, bytes):
                gpu_name = gpu_name.decode("utf-8")

            # ECC errors (volatile – since last driver load)
            for error_type, error_label in [
                (pynvml.NVML_MEMORY_ERROR_TYPE_CORRECTED, "ecc_corrected"),
                (pynvml.NVML_MEMORY_ERROR_TYPE_UNCORRECTED, "ecc_uncorrected"),
            ]:
                try:
                    count = pynvml.nvmlDeviceGetTotalEccErrors(
                        handle, error_type, pynvml.NVML_VOLATILE_ECC
                    )
                    if count and count > 0:
                        results.append({
                            "type": error_label,
                            "gpu_id": i,
                            "gpu_name": gpu_name,
                            "host": hostname,
                            "count": count,
                            "severity": "warning" if "corrected" in error_label else "critical",
                            "message": f"GPU {i} ({gpu_name}): {count} {error_label.replace('_', ' ')} errors",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        })
                except Exception:
                    pass

            # Thermal throttling
            try:
                throttle_reasons = pynvml.nvmlDeviceGetCurrentClocksThrottleReasons(handle)
                thermal_bit = 0x0000000000000040  # nvmlClocksThrottleReasonSwThermalSlowdown
                hw_thermal_bit = 0x0000000000000080  # nvmlClocksThrottleReasonHwThermalSlowdown
                power_bit = 0x0000000000000004  # nvmlClocksThrottleReasonSwPowerCap

                if throttle_reasons & thermal_bit or throttle_reasons & hw_thermal_bit:
                    results.append({
                        "type": "thermal_throttle",
                        "gpu_id": i,
                        "gpu_name": gpu_name,
                        "host": hostname,
                        "severity": "critical",
                        "message": f"GPU {i} ({gpu_name}): Thermal throttling active",
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    })
                if throttle_reasons & power_bit:
                    results.append({
                        "type": "power_throttle",
                        "gpu_id": i,
                        "gpu_name": gpu_name,
                        "host": hostname,
                        "severity": "warning",
                        "message": f"GPU {i} ({gpu_name}): Power cap throttling active",
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    })
            except Exception:
                pass

            # Retired pages (indicative of failing memory)
            try:
                pending_retired = pynvml.nvmlDeviceGetRetiredPages_v2(
                    handle, pynvml.NVML_PAGE_RETIREMENT_CAUSE_MULTIPLE_SINGLE_BIT_ECC_ERRORS
                )
                if pending_retired and len(pending_retired) > 0:
                    results.append({
                        "type": "retired_pages",
                        "gpu_id": i,
                        "gpu_name": gpu_name,
                        "host": hostname,
                        "count": len(pending_retired),
                        "severity": "warning",
                        "message": f"GPU {i} ({gpu_name}): {len(pending_retired)} retired memory pages",
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    })
            except Exception:
                pass

        pynvml.nvmlShutdown()
    except Exception:
        pass

    return results


def _query_xid_errors() -> list[dict]:
    """Parse dmesg for recent NVIDIA XID errors."""
    results = []
    try:
        import re
        dmesg = run_cmd("dmesg --time-format iso 2>/dev/null || dmesg")
        hostname = socket.gethostname()
        for line in dmesg.splitlines():
            if "NVRM: Xid" in line:
                # Extract XID number
                match = re.search(r"Xid.*?:\s*(\d+)", line)
                xid = int(match.group(1)) if match else 0
                gpu_match = re.search(r"GPU (\d+)", line)
                gpu_id = int(gpu_match.group(1)) if gpu_match else -1

                severity = "critical" if xid in (31, 43, 45, 48, 61, 62, 63, 64, 68, 69, 73, 74, 79, 92) else "warning"

                results.append({
                    "type": "xid_error",
                    "xid": xid,
                    "gpu_id": gpu_id,
                    "host": hostname,
                    "severity": severity,
                    "message": line.strip(),
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                })
    except Exception:
        pass
    return results


@events_bp.route("/api/gpu/events", methods=["GET"])
def gpu_events():
    """Get current GPU error/event state."""
    include_xid = request.args.get("xid", "true").lower() == "true"

    events = _query_nvml_events()
    if include_xid:
        events.extend(_query_xid_errors())

    # Sort by severity (critical first)
    severity_order = {"critical": 0, "warning": 1, "info": 2}
    events.sort(key=lambda e: severity_order.get(e.get("severity", "info"), 9))

    return jsonify({
        "events": events,
        "total": len(events),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    })
