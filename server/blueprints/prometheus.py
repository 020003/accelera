"""Prometheus metrics export blueprint.

Exposes GPU metrics in Prometheus text exposition format at /metrics.
"""

from flask import Blueprint, Response

from blueprints.gpu import get_gpus

prometheus_bp = Blueprint("prometheus", __name__)


def _format_metric(name: str, help_text: str, metric_type: str, samples: list[tuple]) -> str:
    """Format a single metric family in Prometheus exposition format."""
    lines = [
        f"# HELP {name} {help_text}",
        f"# TYPE {name} {metric_type}",
    ]
    for labels, value in samples:
        if labels:
            label_str = ",".join(f'{k}="{v}"' for k, v in labels.items())
            lines.append(f"{name}{{{label_str}}} {value}")
        else:
            lines.append(f"{name} {value}")
    return "\n".join(lines)


@prometheus_bp.route("/metrics", methods=["GET"])
def metrics():
    """Prometheus-compatible metrics endpoint."""
    try:
        gpus = get_gpus()
    except Exception:
        gpus = []

    sections = []

    # GPU count
    sections.append(_format_metric(
        "accelera_gpu_count",
        "Number of NVIDIA GPUs detected",
        "gauge",
        [({}, len(gpus))],
    ))

    # Per-GPU metrics
    util_samples = []
    temp_samples = []
    mem_used_samples = []
    mem_total_samples = []
    power_draw_samples = []
    power_limit_samples = []
    fan_samples = []
    process_count_samples = []

    for gpu in gpus:
        labels = {
            "gpu_id": str(gpu["id"]),
            "gpu_name": gpu["name"],
            "gpu_uuid": gpu.get("uuid") or "",
        }

        util_samples.append((labels, gpu["utilization"]))
        temp_samples.append((labels, gpu["temperature"]))
        mem_used_samples.append((labels, gpu["memory"]["used"]))
        mem_total_samples.append((labels, gpu["memory"]["total"]))
        power_draw_samples.append((labels, gpu["power"]["draw"]))
        power_limit_samples.append((labels, gpu["power"]["limit"]))

        if gpu.get("fan") is not None:
            fan_samples.append((labels, gpu["fan"]))

        process_count_samples.append((labels, len(gpu.get("processes", []))))

    sections.append(_format_metric(
        "accelera_gpu_utilization_percent",
        "GPU utilization percentage",
        "gauge",
        util_samples,
    ))
    sections.append(_format_metric(
        "accelera_gpu_temperature_celsius",
        "GPU temperature in Celsius",
        "gauge",
        temp_samples,
    ))
    sections.append(_format_metric(
        "accelera_gpu_memory_used_mib",
        "GPU memory used in MiB",
        "gauge",
        mem_used_samples,
    ))
    sections.append(_format_metric(
        "accelera_gpu_memory_total_mib",
        "GPU total memory in MiB",
        "gauge",
        mem_total_samples,
    ))
    sections.append(_format_metric(
        "accelera_gpu_power_draw_watts",
        "GPU power draw in watts",
        "gauge",
        power_draw_samples,
    ))
    sections.append(_format_metric(
        "accelera_gpu_power_limit_watts",
        "GPU power limit in watts",
        "gauge",
        power_limit_samples,
    ))

    if fan_samples:
        sections.append(_format_metric(
            "accelera_gpu_fan_speed_percent",
            "GPU fan speed percentage",
            "gauge",
            fan_samples,
        ))

    sections.append(_format_metric(
        "accelera_gpu_process_count",
        "Number of processes running on GPU",
        "gauge",
        process_count_samples,
    ))

    body = "\n\n".join(sections) + "\n"
    return Response(body, mimetype="text/plain; version=0.0.4; charset=utf-8")
