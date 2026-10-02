"""Validation policy for GPU exporter URLs and central outbound requests."""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass
from urllib.parse import urlparse

EXPORTER_PORT = int(os.environ.get("EXPORTER_PORT", "5000"))
EXPORTER_PATH = "/nvidia-smi.json"


@dataclass(frozen=True)
class ExporterUrl:
    value: str
    base_url: str


def _allowed_hosts() -> frozenset[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    raw_hosts = os.environ.get("ALLOWED_EXPORTER_HOSTS", "")
    values = [value.strip() for value in raw_hosts.split(",") if value.strip()]
    try:
        return frozenset(ipaddress.ip_address(value) for value in values)
    except ValueError as exc:
        raise ValueError("ALLOWED_EXPORTER_HOSTS must contain literal IP addresses") from exc


def validate_exporter_url(url: str, *, require_snapshot_path: bool = False) -> ExporterUrl:
    """Validate an exporter URL against the explicit deployment allowlist."""
    if not isinstance(url, str) or len(url) > 2048:
        raise ValueError("Invalid exporter URL")

    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Exporter URL must use http or https")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Exporter URL must not include credentials, query, or fragment")
    if parsed.port != EXPORTER_PORT:
        raise ValueError(f"Exporter URL must use port {EXPORTER_PORT}")
    if parsed.hostname != parsed.hostname.lower():
        raise ValueError("Exporter host must be a canonical IP address")

    try:
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError as exc:
        raise ValueError("Exporter host must be an IP address") from exc

    allowed_hosts = _allowed_hosts()
    if not allowed_hosts:
        raise ValueError("No GPU exporter hosts are configured")
    if address not in allowed_hosts:
        raise ValueError("Exporter host is not approved")
    if require_snapshot_path and parsed.path.rstrip("/") != EXPORTER_PATH:
        raise ValueError(f"Exporter URL path must be {EXPORTER_PATH}")

    base_url = f"{parsed.scheme}://{parsed.netloc}"
    value = f"{base_url}{parsed.path or '/'}"
    return ExporterUrl(value=value, base_url=base_url)
