"""GPU metrics blueprint – nvidia-smi endpoint and process detection."""

import logging
import os
import re
import socket
import subprocess
import time
from datetime import datetime

import requests as http_requests
from flask import Blueprint, jsonify

from config import cfg
from utils import run_cmd

log = logging.getLogger(__name__)

gpu_bp = Blueprint("gpu", __name__)


def _safe_int(val: str, default: int = 0) -> int:
    """Convert a nvidia-smi CSV value to int, returning *default* for N/A etc."""
    if not val or val in ("N/A", "[N/A]", "[Not Supported]", "Not Supported", "ERR!"):
        return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default


def get_gpus() -> list[dict]:
    """Query nvidia-smi for GPU metrics and attach process info.

    Returns an empty list if nvidia-smi is unavailable (no GPU host).
    """
    q = ("index,uuid,name,driver_version,temperature.gpu,utilization.gpu,"
         "memory.used,memory.total,power.draw,power.limit,fan.speed")
    try:
        out = run_cmd(f"nvidia-smi --format=csv,noheader,nounits --query-gpu={q}")
    except Exception:
        log.warning("nvidia-smi not available — running in no-GPU mode")
        return []
    gpus = []
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 10:
            continue
        try:
            idx = _safe_int(parts[0], -1)
            if idx < 0:
                continue
            uuid = parts[1] if parts[1] and parts[1] not in ("[N/A]", "N/A") else None
            name = parts[2]
            driver = parts[3] if parts[3] and parts[3] not in ("[N/A]", "N/A") else None
            temp = _safe_int(parts[4])
            util = _safe_int(parts[5])
            mem_used = _safe_int(parts[6])
            mem_total = _safe_int(parts[7])
            p_draw = _safe_int(parts[8])
            p_limit = _safe_int(parts[9])
            fan_raw = parts[10] if len(parts) > 10 else ""
            fan = _safe_int(fan_raw, -1)
            fan = fan if fan >= 0 else None
        except Exception:
            continue
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
        log.debug("Process detection: trying NVML")

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
        log.debug("Process detection: NVML unavailable, trying fallbacks")

    # Method 2: nvidia-smi XML query
    if appended == 0:
        try:
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

    if appended > 0:
        log.debug("Attached %d process(es) to %d GPU(s)", appended, len(gpus))
    _enrich_processes(gpus)
    return gpus


# -------------------------------------------------------------------
# Process enrichment (name resolution, runtime & model detection)
# -------------------------------------------------------------------

_AI_RE = re.compile(
    r"(ollama|python|sglang|vllm|triton|tensorrt|torch|llama|ggml|whisper)",
    re.IGNORECASE,
)
_RUNTIME_RE = [
    (re.compile(r"ollama", re.I), "Ollama"),
    (re.compile(r"sglang", re.I), "SGLang"),
    (re.compile(r"vllm", re.I), "vLLM"),
    (re.compile(r"triton", re.I), "Triton"),
    (re.compile(r"torch|python.*train", re.I), "PyTorch"),
]

_model_cache: dict = {"ts": 0.0, "ollama": [], "sglang": [], "vllm": []}
_MODEL_CACHE_TTL = 30  # seconds


def _refresh_model_cache():
    now = time.time()
    if now - _model_cache["ts"] < _MODEL_CACHE_TTL:
        return
    _model_cache["ts"] = now
    # Ollama
    url = cfg("OLLAMA_URL")
    if url:
        try:
            r = http_requests.get(f"{url}/api/ps", timeout=2)
            _model_cache["ollama"] = r.json().get("models", [])
        except Exception:
            pass
    # SGLang
    url = cfg("SGLANG_URL")
    if url:
        try:
            r = http_requests.get(f"{url}/v1/models", timeout=2)
            _model_cache["sglang"] = [m.get("id", "") for m in r.json().get("data", [])]
        except Exception:
            pass
    # vLLM
    url = cfg("VLLM_URL")
    if url:
        try:
            r = http_requests.get(f"{url}/v1/models", timeout=2)
            _model_cache["vllm"] = [m.get("id", "") for m in r.json().get("data", [])]
        except Exception:
            pass


def _read_cmdline(pid: int) -> str:
    for root in ("/host/proc", "/proc"):
        try:
            with open(f"{root}/{pid}/cmdline", "rb") as f:
                return f.read(4096).replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
        except (OSError, PermissionError):
            continue
    return ""


def _enrich_processes(gpus: list[dict]):
    """Post-process: resolve names, detect runtime & model for each process."""
    has_ai = False
    for gpu in gpus:
        for proc in gpu.get("processes", []):
            pid = proc.get("pid", 0)
            cmdline = _read_cmdline(pid)
            proc["cmdline"] = cmdline[:300] if cmdline else ""

            # Resolve name from cmdline if it's just "PID xxx"
            name = proc.get("name", "")
            if name.startswith("PID ") and cmdline:
                proc["name"] = os.path.basename(cmdline.split()[0]) if cmdline.split() else name

            # Detect runtime
            runtime = ""
            for pat, label in _RUNTIME_RE:
                if pat.search(cmdline):
                    runtime = label
                    break
            proc["runtime"] = runtime

            # Category
            proc["category"] = "ai" if _AI_RE.search(f"{proc['name']} {cmdline}") else "other"

            if runtime:
                has_ai = True

    if not has_ai:
        return

    # Resolve model names from cached runtime API data
    _refresh_model_cache()
    ollama_models = _model_cache["ollama"]
    sglang_models = _model_cache["sglang"]
    vllm_models = _model_cache["vllm"]

    for gpu in gpus:
        for proc in gpu.get("processes", []):
            rt = proc.get("runtime", "")
            model = ""
            if rt == "Ollama" and ollama_models:
                mem = proc.get("memory", 0)
                best, best_diff = None, float("inf")
                for m in ollama_models:
                    diff = abs(m.get("size_vram", 0) / (1024 * 1024) - mem)
                    if diff < best_diff:
                        best_diff, best = diff, m
                if best and best_diff < 2048:
                    model = best.get("name", "") or best.get("model", "")
            elif rt == "SGLang" and sglang_models:
                model = sglang_models[0] if len(sglang_models) == 1 else ", ".join(sglang_models)
            elif rt == "vLLM" and vllm_models:
                model = vllm_models[0] if len(vllm_models) == 1 else ", ".join(vllm_models)
            proc["model"] = model


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
