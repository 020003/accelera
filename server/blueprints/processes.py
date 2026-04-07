"""GPU Process Inspector blueprint – enriched process data with classification."""

import logging
import os
import re
import time

import requests as http_requests
from flask import Blueprint, jsonify

from blueprints.gpu import get_gpus
from config import cfg

log = logging.getLogger(__name__)
processes_bp = Blueprint("processes", __name__)

# ---------------------------------------------------------------------------
# Process enrichment helpers
# ---------------------------------------------------------------------------

_AI_PATTERNS = re.compile(
    r"(ollama|python|sglang|vllm|triton|tensorrt|torch|"
    r"llama|ggml|whisper|stable.diffusion|comfyui|"
    r"text-generation|transformers|deepspeed|megatron)",
    re.IGNORECASE,
)

_SYSTEM_PATTERNS = re.compile(
    r"^(/usr/lib/xorg|Xorg|gnome-shell|compiz|"
    r"nvidia-smi|nvidia-persistenced|nv-hostengine|dcgm)",
    re.IGNORECASE,
)

_RUNTIME_DETECT = [
    (re.compile(r"ollama", re.I), "Ollama"),
    (re.compile(r"sglang", re.I), "SGLang"),
    (re.compile(r"vllm", re.I), "vLLM"),
    (re.compile(r"triton", re.I), "Triton"),
    (re.compile(r"text-generation", re.I), "TGI"),
    (re.compile(r"deepspeed", re.I), "DeepSpeed"),
    (re.compile(r"torch|python.*train", re.I), "PyTorch"),
]

_MODEL_PATTERNS = [
    re.compile(r"--model\s+\S*?([^/\\]+?)(?:\s|$)", re.I),
    re.compile(r"--model-path\s+\S*?([^/\\]+?)(?:\s|$)", re.I),
    re.compile(r"--served-model-name\s+(\S+)", re.I),
    re.compile(r"models?/(?:blobs/sha256-[a-f0-9]{8}|(.+?)(?:/|$))", re.I),
]

# Boot time for uptime calculation
_BOOT_TIME: float | None = None


def _get_boot_time() -> float:
    """Read system boot time from /proc/stat (cached)."""
    global _BOOT_TIME
    if _BOOT_TIME is not None:
        return _BOOT_TIME
    for root in ("/host/proc", "/proc"):
        try:
            with open(f"{root}/stat") as f:
                for line in f:
                    if line.startswith("btime"):
                        _BOOT_TIME = float(line.split()[1])
                        return _BOOT_TIME
        except (OSError, PermissionError):
            continue
    _BOOT_TIME = 0.0
    return _BOOT_TIME


def _get_clock_ticks() -> int:
    try:
        return os.sysconf("SC_CLK_TCK")
    except (ValueError, OSError):
        return 100


def _classify(name: str, cmdline: str) -> str:
    combined = f"{name} {cmdline}"
    if _AI_PATTERNS.search(combined):
        return "ai"
    if _SYSTEM_PATTERNS.search(combined):
        return "system"
    return "other"


def _detect_runtime(cmdline: str) -> str:
    for pattern, label in _RUNTIME_DETECT:
        if pattern.search(cmdline):
            return label
    return ""


def _extract_model(cmdline: str) -> str:
    for pat in _MODEL_PATTERNS:
        m = pat.search(cmdline)
        if m:
            name = m.group(1) if m.lastindex and m.group(1) else m.group(0)
            name = name.strip(" /\\")
            if name and len(name) < 120 and "sha256" not in name:
                return name
    return ""


def _read_cmdline(pid: int) -> str:
    for proc_root in ("/host/proc", "/proc"):
        path = f"{proc_root}/{pid}/cmdline"
        try:
            with open(path, "rb") as f:
                raw = f.read(4096)
                return raw.replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
        except (OSError, PermissionError):
            continue
    return ""


def _read_user(pid: int) -> str:
    for proc_root in ("/host/proc", "/proc"):
        try:
            uid = os.stat(f"{proc_root}/{pid}").st_uid
            try:
                import pwd
                return pwd.getpwuid(uid).pw_name
            except (KeyError, ImportError):
                return str(uid)
        except (OSError, PermissionError):
            continue
    return ""


def _resolve_name(pid: int, raw_name: str, cmdline: str) -> str:
    """Try to get a useful process name from cmdline if raw_name is just 'PID xxx'."""
    if raw_name and not raw_name.startswith("PID "):
        return raw_name
    if not cmdline:
        return raw_name
    binary = cmdline.split()[0] if cmdline else ""
    return os.path.basename(binary) or raw_name


def _read_proc_stat(pid: int) -> dict:
    """Read uptime and CPU stats from /proc/<pid>/stat."""
    hz = _get_clock_ticks()
    boot_time = _get_boot_time()
    now = time.time()
    result = {"uptimeSeconds": 0, "cpuPercent": 0.0}

    for proc_root in ("/host/proc", "/proc"):
        try:
            with open(f"{proc_root}/{pid}/stat") as f:
                parts = f.read().split()
            if len(parts) < 22:
                continue

            utime = int(parts[13])
            stime = int(parts[14])
            starttime = int(parts[21])

            start_sec = boot_time + (starttime / hz)
            uptime = max(now - start_sec, 0)
            result["uptimeSeconds"] = int(uptime)

            total_cpu_sec = (utime + stime) / hz
            result["cpuPercent"] = round(total_cpu_sec / uptime * 100, 1) if uptime > 0 else 0.0
            return result
        except (OSError, PermissionError, ValueError, IndexError):
            continue
    return result


def _format_uptime(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m {seconds % 60}s"
    hours = seconds // 3600
    mins = (seconds % 3600) // 60
    if hours < 24:
        return f"{hours}h {mins}m"
    days = hours // 24
    hours = hours % 24
    return f"{days}d {hours}h"


def _query_ollama_running_models() -> list[dict]:
    """Query Ollama /api/ps for currently loaded models."""
    url = cfg("OLLAMA_URL")
    if not url:
        return []
    try:
        resp = http_requests.get(f"{url}/api/ps", timeout=3)
        data = resp.json()
        return data.get("models", [])
    except Exception:
        return []


def _query_sglang_running_models() -> list[str]:
    """Query SGLang /v1/models for loaded models."""
    url = cfg("SGLANG_URL")
    if not url:
        return []
    try:
        resp = http_requests.get(f"{url}/v1/models", timeout=3)
        data = resp.json()
        return [m.get("id", "") for m in data.get("data", [])]
    except Exception:
        return []


def _query_vllm_running_models() -> list[str]:
    """Query vLLM /v1/models for loaded models."""
    url = cfg("VLLM_URL")
    if not url:
        return []
    try:
        resp = http_requests.get(f"{url}/v1/models", timeout=3)
        data = resp.json()
        return [m.get("id", "") for m in data.get("data", [])]
    except Exception:
        return []


def _match_model_to_process(proc: dict, ollama_models: list[dict], sglang_models: list[str], vllm_models: list[str]) -> str:
    """Try to match a running AI model name to a process."""
    runtime = proc.get("runtime", "")
    mem_mib = proc.get("memory", 0)

    if runtime == "Ollama" and ollama_models:
        # Match by VRAM size (closest match)
        best = None
        best_diff = float("inf")
        for m in ollama_models:
            vram_mib = m.get("size_vram", 0) / (1024 * 1024)
            diff = abs(vram_mib - mem_mib)
            if diff < best_diff:
                best_diff = diff
                best = m
        if best and best_diff < 2048:  # within 2GB tolerance
            return best.get("name", "") or best.get("model", "")

    if runtime == "SGLang" and sglang_models:
        return sglang_models[0] if len(sglang_models) == 1 else ", ".join(sglang_models)

    if runtime == "vLLM" and vllm_models:
        return vllm_models[0] if len(vllm_models) == 1 else ", ".join(vllm_models)

    return proc.get("model", "")


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@processes_bp.route("/api/gpu/processes", methods=["GET"])
def list_processes():
    """Return enriched process list across all GPUs."""
    gpus = get_gpus()

    processes = []
    gpu_summaries = []
    total_proc_mem = 0

    for gpu in gpus:
        gpu_procs = gpu.get("processes", [])
        gpu_proc_mem = sum(p.get("memory", 0) for p in gpu_procs)
        total_proc_mem += gpu_proc_mem

        gpu_summaries.append({
            "id": gpu["id"],
            "name": gpu["name"],
            "memoryTotal": gpu["memory"]["total"],
            "memoryUsed": gpu["memory"]["used"],
            "processCount": len(gpu_procs),
            "processMemory": gpu_proc_mem,
        })

        for proc in gpu_procs:
            pid = proc.get("pid", 0)
            raw_name = proc.get("name", "unknown")
            mem = proc.get("memory", 0)
            cmdline = _read_cmdline(pid)
            user = _read_user(pid)
            category = _classify(raw_name, cmdline)
            runtime = _detect_runtime(cmdline)
            model = _extract_model(cmdline)
            name = _resolve_name(pid, raw_name, cmdline)
            stats = _read_proc_stat(pid)

            processes.append({
                "pid": pid,
                "name": name,
                "cmdline": cmdline[:500] if cmdline else "",
                "user": user,
                "gpuId": gpu["id"],
                "gpuName": gpu["name"],
                "memory": mem,
                "memoryPercent": round(mem / gpu["memory"]["total"] * 100, 1) if gpu["memory"]["total"] > 0 else 0,
                "category": category,
                "runtime": runtime,
                "model": model,
                "uptimeSeconds": stats["uptimeSeconds"],
                "uptime": _format_uptime(stats["uptimeSeconds"]),
                "cpuPercent": stats["cpuPercent"],
            })

    # Enrich model names from runtime APIs
    ollama_models = _query_ollama_running_models() if any(p.get("runtime") == "Ollama" for p in processes) else []
    sglang_models = _query_sglang_running_models() if any(p.get("runtime") == "SGLang" for p in processes) else []
    vllm_models = _query_vllm_running_models() if any(p.get("runtime") == "vLLM" for p in processes) else []

    for p in processes:
        if not p.get("model") and p.get("runtime"):
            p["model"] = _match_model_to_process(p, ollama_models, sglang_models, vllm_models)

    processes.sort(key=lambda p: p["memory"], reverse=True)

    seen_keys = set()
    unique = []
    for p in processes:
        key = (p["pid"], p["gpuId"])
        if key not in seen_keys:
            seen_keys.add(key)
            unique.append(p)

    ai_count = sum(1 for p in unique if p["category"] == "ai")
    sys_count = sum(1 for p in unique if p["category"] == "system")

    return jsonify({
        "processes": unique,
        "gpus": gpu_summaries,
        "summary": {
            "totalProcesses": len(unique),
            "aiProcesses": ai_count,
            "systemProcesses": sys_count,
            "otherProcesses": len(unique) - ai_count - sys_count,
            "totalProcessMemoryMiB": total_proc_mem,
        },
    })
