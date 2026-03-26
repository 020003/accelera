"""GPU topology blueprint – topology map and network interface detection."""

import re
import socket

from flask import Blueprint, jsonify

from utils import run_cmd
from blueprints.gpu import get_gpus

topology_bp = Blueprint("topology", __name__)

# Connection type → human-readable info
CONNECTION_MAP = {
    "NV1":  {"type": "NVLink",     "bandwidth": 25,  "description": "NVLink 1st gen (25 GB/s per link)"},
    "NV2":  {"type": "NVLink",     "bandwidth": 50,  "description": "NVLink 2nd gen (50 GB/s per link)"},
    "NV3":  {"type": "NVLink",     "bandwidth": 100, "description": "NVLink 3rd gen (100 GB/s per link)"},
    "NV4":  {"type": "NVLink",     "bandwidth": 112, "description": "NVLink 4th gen (112 GB/s per link)"},
    "NV6":  {"type": "NVLink",     "bandwidth": 200, "description": "NVLink 6th gen (200 GB/s per link)"},
    "SYS":  {"type": "PCIe-SYS",   "bandwidth": 32,  "description": "PCIe traversing NUMA nodes (Cross-socket)"},
    "NODE": {"type": "PCIe-NODE",  "bandwidth": 24,  "description": "PCIe within NUMA node"},
    "PHB":  {"type": "PCIe-PHB",   "bandwidth": 16,  "description": "PCIe through Host Bridge"},
    "PIX":  {"type": "PCIe-PIX",   "bandwidth": 32,  "description": "PCIe through single switch"},
    "PXB":  {"type": "PCIe-PXB",   "bandwidth": 16,  "description": "PCIe through multiple bridges"},
    "SOC":  {"type": "SoC",        "bandwidth": 200, "description": "System-on-Chip interconnect"},
    "X":    {"type": "Self",       "bandwidth": 0,   "description": "Self or disabled connection"},
}


def parse_topology_matrix() -> dict:
    """Parse nvidia-smi topo -m output to get real interconnection data including NICs."""
    try:
        result = run_cmd("nvidia-smi topo -m")
        result = re.sub(r'\x1b\[[0-9;]*m', '', result)

        lines = result.strip().split('\n')

        matrix_start = -1
        for i, line in enumerate(lines):
            if 'GPU0' in line:
                matrix_start = i
                break

        if matrix_start == -1:
            return {'gpus': {}, 'nics': {}, 'nic_legend': {}}

        header_line = lines[matrix_start]
        header_parts = header_line.split()

        gpu_columns = []
        nic_columns = []
        for i, part in enumerate(header_parts):
            if re.match(r'^GPU\d+$', part):
                gpu_columns.append((i, part))
            elif re.match(r'^NIC\d+$', part):
                nic_columns.append((i, part))

        topology_matrix = {}
        nic_connections = {}

        for i in range(matrix_start + 1, len(lines)):
            line = lines[i].strip()
            if not line or line.startswith('Legend'):
                break

            parts = line.split()
            if len(parts) < 2:
                continue

            src_device = parts[0]

            if src_device.startswith('GPU') and len(src_device) > 3:
                connections = {}
                for col_idx, dst_gpu in gpu_columns:
                    parts_idx = col_idx + 1
                    if parts_idx < len(parts):
                        connection_type = parts[parts_idx]
                        if src_device != dst_gpu and connection_type != 'X':
                            connections[dst_gpu] = connection_type

                nic_conns = {}
                for col_idx, dst_nic in nic_columns:
                    parts_idx = col_idx + 1
                    if parts_idx < len(parts):
                        connection_type = parts[parts_idx]
                        if connection_type != 'X':
                            nic_conns[dst_nic] = connection_type

                topology_matrix[src_device] = {'gpus': connections, 'nics': nic_conns}

            elif src_device.startswith('NIC') and len(src_device) > 3:
                connections = {}
                for col_idx, dst_gpu in gpu_columns:
                    parts_idx = col_idx + 1
                    if parts_idx < len(parts):
                        connection_type = parts[parts_idx]
                        if connection_type != 'X':
                            connections[dst_gpu] = connection_type
                nic_connections[src_device] = connections

        # Parse NIC Legend
        nic_legend = {}
        for i, line in enumerate(lines):
            if line.strip().startswith('NIC Legend:'):
                for j in range(i + 1, len(lines)):
                    legend_line = lines[j].strip()
                    if legend_line and ':' in legend_line:
                        lparts = legend_line.split(':')
                        if len(lparts) == 2:
                            nic_legend[lparts[0].strip()] = lparts[1].strip()
                break

        return {'gpus': topology_matrix, 'nics': nic_connections, 'nic_legend': nic_legend}

    except Exception as e:
        print(f"Error parsing topology matrix: {e}")
        return {}


def get_network_interfaces() -> list[dict]:
    """Get network interface information including Mellanox NICs."""
    try:
        try:
            result = run_cmd("ip addr show")
        except Exception:
            try:
                result = run_cmd("ifconfig -a")
            except Exception:
                return []

        interfaces = []
        current_interface = None
        for line in result.split('\n'):
            line = line.strip()
            if line and line[0].isdigit() and ':' in line:
                if current_interface:
                    interfaces.append(current_interface)
                parts = line.split(': ')
                if len(parts) >= 2:
                    current_interface = {
                        'name': parts[1].split('@')[0],
                        'state': 'UP' if 'UP' in line else 'DOWN',
                        'addresses': [],
                        'type': 'unknown',
                    }
            elif current_interface and line.startswith('inet '):
                ip = line.split()[1].split('/')[0]
                current_interface['addresses'].append(ip)

        if current_interface:
            interfaces.append(current_interface)

        try:
            lspci_result = run_cmd("lspci | grep -i mellanox")
            mellanox_devices = lspci_result.strip().split('\n') if lspci_result.strip() else []
            for interface in interfaces:
                if interface['name'] != 'lo':
                    try:
                        ethtool_result = run_cmd(f"ethtool {interface['name']} 2>/dev/null | grep -E 'Speed|Duplex'")
                        if 'mellanox' in ethtool_result.lower() or any('mellanox' in d.lower() for d in mellanox_devices):
                            interface['type'] = 'mellanox'
                        elif 'ib' in interface['name'] or 'infiniband' in interface['name']:
                            interface['type'] = 'infiniband'
                        elif 'eth' in interface['name'] or 'ens' in interface['name']:
                            interface['type'] = 'ethernet'
                    except Exception:
                        pass
        except Exception:
            pass

        return [iface for iface in interfaces if iface['name'] != 'lo' and iface['addresses']]

    except Exception:
        return []


def detect_gpu_topology() -> dict:
    """Detect GPU topology and interconnections using nvidia-smi topo -m."""
    try:
        gpus = get_gpus()
        hostname = socket.gethostname()

        topology_data = parse_topology_matrix()
        topology_matrix = topology_data.get('gpus', {})
        nic_connections_raw = topology_data.get('nics', {})
        nic_legend = topology_data.get('nic_legend', {})

        network_interfaces = get_network_interfaces()

        topology_gpus = []
        for i, gpu in enumerate(gpus):
            connections = []
            gpu_key = f"GPU{i}"
            nic_info = []

            if gpu_key in topology_matrix:
                gpu_data = topology_matrix[gpu_key]

                if isinstance(gpu_data, dict) and 'gpus' in gpu_data:
                    for target_gpu, conn_type in gpu_data['gpus'].items():
                        if not target_gpu.startswith('GPU') or len(target_gpu) <= 3:
                            continue
                        try:
                            target_idx = int(target_gpu.replace('GPU', ''))
                            conn_info = CONNECTION_MAP.get(conn_type, {
                                'type': conn_type, 'bandwidth': 32,
                                'description': f'Connection type: {conn_type}',
                            })
                            if conn_type != 'X' and conn_info['bandwidth'] > 0:
                                connections.append({
                                    'target': f"gpu-{target_idx}",
                                    'type': conn_info['type'],
                                    'bandwidth': conn_info['bandwidth'],
                                    'description': conn_info['description'],
                                    'raw_type': conn_type,
                                })
                        except ValueError:
                            continue
                else:
                    for target_gpu, conn_type in topology_matrix.get(gpu_key, {}).items():
                        if not target_gpu.startswith('GPU') or len(target_gpu) <= 3:
                            continue
                        try:
                            target_idx = int(target_gpu.replace('GPU', ''))
                            conn_info = CONNECTION_MAP.get(conn_type, {
                                'type': conn_type, 'bandwidth': 32,
                                'description': f'Connection type: {conn_type}',
                            })
                            if conn_type != 'X' and conn_info['bandwidth'] > 0:
                                connections.append({
                                    'target': f"gpu-{target_idx}",
                                    'type': conn_info['type'],
                                    'bandwidth': conn_info['bandwidth'],
                                    'description': conn_info['description'],
                                    'raw_type': conn_type,
                                })
                        except ValueError:
                            continue

                if isinstance(gpu_data, dict) and 'nics' in gpu_data:
                    for nic_id, conn_type in gpu_data['nics'].items():
                        nic_name = nic_legend.get(nic_id, nic_id)
                        if 'mlx' in nic_name.lower():
                            conn_info = CONNECTION_MAP.get(conn_type, {
                                'type': conn_type, 'bandwidth': 32,
                                'description': f'Connection to {nic_name}',
                            })
                            nic_info.append({
                                'nic_id': nic_id,
                                'nic_name': nic_name,
                                'connection_type': conn_type,
                                'description': conn_info['description'],
                            })

            topology_gpus.append({
                'id': f"gpu-{i}",
                'name': gpu['name'],
                'host': hostname,
                'utilization': gpu['utilization'],
                'memory': gpu['memory'],
                'temperature': gpu['temperature'],
                'power': gpu['power'],
                'connections': connections,
                'nic_connections': nic_info,
                'pci_info': gpu.get('pci', {}),
                'uuid': gpu.get('uuid', f"GPU-{i}"),
            })

        mellanox_nics = []
        for nic_id, nic_name in nic_legend.items():
            if 'mlx' in nic_name.lower():
                mellanox_nics.append({
                    'id': nic_id,
                    'name': nic_name,
                    'type': 'Mellanox InfiniBand/Ethernet',
                })

        return {
            'gpus': topology_gpus,
            'host_info': {
                'hostname': hostname,
                'network_interfaces': network_interfaces,
                'gpu_count': len(gpus),
                'mellanox_nics': mellanox_nics,
            },
            'topology_matrix': topology_matrix,
            'nic_connections': nic_connections_raw,
            'nic_legend': nic_legend,
        }

    except Exception as e:
        import traceback
        print(f"Error detecting topology: {e}")
        traceback.print_exc()
        return {'gpus': [], 'host_info': {}, 'topology_matrix': {}}


@topology_bp.route("/api/topology", methods=["GET"])
def get_topology():
    """Get GPU topology information."""
    try:
        return jsonify(detect_gpu_topology())
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500
