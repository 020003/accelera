"""Shared utility functions."""

import ipaddress
import subprocess
from urllib.parse import urlparse


def run_cmd(cmd: str) -> str:
    """Run a shell command and return stripped stdout.

    NOTE: Uses ``shell=True`` — only pass trusted, non-user-supplied strings.
    """
    return subprocess.check_output(cmd, shell=True, text=True).strip()


# ---------------------------------------------------------------------------
# URL / SSRF helpers
# ---------------------------------------------------------------------------

_PRIVATE_NETS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def is_valid_host_url(url: str) -> bool:
    """Return True if *url* looks like a valid http(s) GPU-exporter URL."""
    try:
        p = urlparse(url)
        if p.scheme not in ("http", "https"):
            return False
        if not p.hostname:
            return False
        # Port must be numeric if present
        if p.port is not None and not (1 <= p.port <= 65535):
            return False
        return True
    except Exception:
        return False


def is_private_ip(hostname: str) -> bool:
    """Return True if *hostname* resolves to a private/loopback address."""
    try:
        addr = ipaddress.ip_address(hostname)
        return any(addr in net for net in _PRIVATE_NETS)
    except ValueError:
        # It's a hostname, not a bare IP — allow it (DNS could resolve to
        # anything, but blocking hostnames would break legitimate setups).
        return False
