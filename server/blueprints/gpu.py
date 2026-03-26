"""GPU metrics blueprint – nvidia-smi endpoint and process detection."""

import socket
import subprocess
from datetime import datetime

from flask import Blueprint, jsonify

from utils import run_cmd

gpu_bp = Blueprint("gpu", __name__)


def get_gpus() -> list[dict]:
    """Query nvidia-smi for GPU metrics and attach process info."""
    q = ("index,uuid,name,driver_version,temperature.gpu,utilization.gpu,"
         "memory.used,memory.total,power.draw,power.limit,fan.speed")
    out = run_cmd(f"nvidia-smi --format=csv,noheader,nounits --query-gpu={q}")
    gpus = []
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 10:
            continue
        idx = int(parts[0])
        uuid = parts[1] or None
        name = parts[2]
        driver = parts[3] or None
        temp = int(float(parts[4] or 0))
        util = int(float(parts[5] or 0))
        mem_used = int(float(parts[6] or 0))
        mem_total = int(float(parts[7] or 0))
        p_draw = int(float(parts[8] or 0))
        p_limit = int(float(parts[9] or 0))
        fan_raw = parts[10] if len(parts) > 10 else ""
        fan = int(float(fan_raw)) if fan_raw and fan_raw not in ("N/A", "[N/A]") else None
        gpus.append({
            "id": idx,
            "uuid": uuid,
            "name": name,
            "driverVersion": driver,
            "temperature": temp,
            "utilization": util,
            "memory": {"used": mem_used, "total": mem_total},
            "power": {"draw": p_draw, "limit": p_limit},
            "fan": fan,
            "processes": [],
        })

    _add_process_info(gpus)
    return gpus


# -------------------------------------------------------------------
# Process detection (multiple fallback methods)
# -------------------------------------------------------------------

def _add_process_info(gpus: list[dict]):
    """Add process information to GPU data using multiple fallback methods."""
    appended = 0

    # Method 1: NVML (most accurate)
    try:
        import pynvml
        pynvml.nvmlInit()

        for i, gpu in enumerate(gpus):
            try:
                handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                try:
                    compute_procs = pynvml.nvmlDeviceGetComputeRunningProcesses(handle)
                    graphics_procs = pynvml.nvmlDeviceGetGraphicsRunningProcesses(handle)
                    all_procs = list(compute_procs) + list(graphics_procs)

                    for proc in all_procs:
                        try:
                            pid = proc.pid
                            memory_mb = proc.usedGpuMemory // (1024 * 1024) if hasattr(proc, 'usedGpuMemory') else 0
                            try:
                                proc_name = pynvml.nvmlSystemGetProcessName(pid).decode('utf-8')
                            except Exception:
                                proc_name = f"PID {pid}"

                            gpu["processes"].append({
                                "pid": pid,
                                "name": proc_name,
                                "memory": memory_mb,
                            })
                            appended += 1
                        except Exception:
                            continue
                except Exception:
                    continue
            except Exception:
                continue

        pynvml.nvmlShutdown()

    except Exception:
        pass

    # Method 2: nvidia-smi XML query
    if appended == 0:
        try:
            import re
            xml = run_cmd("nvidia-smi -x -q")
            for gpu_block in re.findall(r"<gpu>(.*?)</gpu>", xml, flags=re.S):
                uuid_match = re.search(r"<uuid>\s*([^<]+)\s*</uuid>", gpu_block)
                if not uuid_match:
                    continue
                gpu_uuid = uuid_match.group(1).strip()
                for proc in re.findall(r"<process_info>(.*?)</process_info>", gpu_block, flags=re.S):
                    pid_m = re.search(r"<pid>\s*(\d+)\s*</pid>", proc)
                    mem_m = re.search(r"<used_memory>\s*(\d+)\s*MiB\s*</used_memory>", proc)
                    name_m = re.search(r"<process_name>\s*([^<]+)\s*</process_name>", proc)
                    if not pid_m:
                        continue
                    pid = int(pid_m.group(1))
                    pmem = int(mem_m.group(1)) if mem_m else 0
                    pname = name_m.group(1).strip() if name_m else "unknown"
                    for g in gpus:
                        if g.get("uuid") == gpu_uuid:
                            g.setdefault("processes", []).append({"pid": pid, "name": pname, "memory": pmem})
                            appended += 1
        except Exception:
            pass

    # Method 3: CLI compute-apps (older drivers)
    if appended == 0:
        pout = ""
        queries = [
            "gpu_uuid,pid,process_name,used_memory",
            "gpu_uuid,pid,process_name,used_gpu_memory",
        ]
        for pq in queries:
            try:
                pout = run_cmd(f"nvidia-smi --query-compute-apps={pq} --format=csv,noheader,nounits")
                if pout and "No running" not in pout:
                    break
            except subprocess.CalledProcessError:
                continue
        if pout:
            for line in pout.splitlines():
                if not line or "No running" in line or "Not Supported" in line:
                    continue
                parts = [p.strip() for p in line.split(",")]
                if len(parts) < 4:
                    continue
                gpu_uuid = parts[0]
                try:
                    pid = int(parts[1])
                except ValueError:
                    continue
                pname = parts[2]
                try:
                    pmem = int(float(parts[3])) if parts[3] not in ("N/A", "[N/A]") else 0
                except ValueError:
                    pmem = 0
                for g in gpus:
                    if g.get("uuid") == gpu_uuid:
                        g.setdefault("processes", []).append({"pid": pid, "name": pname, "memory": pmem})
                        appended += 1

    # Method 4: Plain-text table fallback
    if appended == 0:
        try:
            txt = run_cmd("nvidia-smi")
            in_block = False
            for line in txt.splitlines():
                if "Processes:" in line:
                    in_block = True
                    continue
                if in_block and line.strip().startswith("+") and "Processes" not in line:
                    continue
                if in_block and line.strip().startswith("|"):
                    cols = [c.strip() for c in line.strip("|\n").split("|")]
                    if len(cols) < 7:
                        continue
                    try:
                        idx = int(cols[0].split()[0])
                        pid = int(cols[3].split()[0])
                        pname = cols[5]
                        mem_part = cols[6].split()[0]
                        pmem = int(mem_part.replace("MiB", "")) if mem_part.endswith("MiB") else int(mem_part)
                    except Exception:
                        continue
                    for g in gpus:
                        if g.get("id") == idx:
                            g.setdefault("processes", []).append({"pid": pid, "name": pname, "memory": pmem})
                            appended += 1
        except Exception:
            pass

    # Method 5: PMON as last resort
    if appended == 0:
        try:
            pmon = run_cmd("nvidia-smi pmon -c 1 -s mu")
            for line in pmon.splitlines():
                line = line.strip()
                if not line or line.startswith("#") or line.lower().startswith("gpu"):
                    continue
                parts = line.split()
                if len(parts) < 9:
                    continue
                try:
                    idx = int(parts[0])
                    pid = int(parts[1])
                except ValueError:
                    continue
                pname = parts[8]
                fb_raw = parts[7]
                try:
                    pmem = int(float(fb_raw)) if fb_raw not in ("-", "N/A", "[N/A]") else 0
                except ValueError:
                    pmem = 0
                for g in gpus:
                    if g.get("id") == idx:
                        g.setdefault("processes", []).append({"pid": pid, "name": pname, "memory": pmem})
        except subprocess.CalledProcessError:
            pass

    return gpus


# -------------------------------------------------------------------
# Route
# -------------------------------------------------------------------

@gpu_bp.route("/nvidia-smi.json", methods=["GET"])
def nvidia():
    return jsonify({
        "host": socket.gethostname(),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "gpus": get_gpus(),
    })
