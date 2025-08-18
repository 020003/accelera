#!/usr/bin/env python3

import subprocess
import re

def simple_parse_topology():
    """Simple topology parser for debugging"""
    try:
        # Run nvidia-smi topo -m
        result = subprocess.run(['nvidia-smi', 'topo', '-m'], 
                              capture_output=True, text=True, check=True)
        
        # Strip ANSI color codes
        output = re.sub(r'\x1b\[[0-9;]*m', '', result.stdout)
        
        print("=== RAW NVIDIA-SMI TOPO OUTPUT ===")
        print(output)
        print("=== END RAW OUTPUT ===\n")
        
        lines = output.strip().split('\n')
        
        # Find the header line
        header_line = None
        matrix_start = -1
        
        for i, line in enumerate(lines):
            if 'GPU0' in line:
                header_line = line
                matrix_start = i
                print(f"Found header at line {i}: {line}")
                break
        
        if header_line is None:
            print("No GPU topology header found!")
            return {}
        
        # Parse header to find GPU columns
        header_parts = header_line.split()
        gpu_columns = []
        
        gpu_pattern = r'^GPU\d+$'
        for i, part in enumerate(header_parts):
            matches_gpu = bool(re.match(gpu_pattern, part))
            print(f"  Header part {i}: '{part}' - matches GPU: {matches_gpu}")
            if matches_gpu:
                gpu_columns.append((i, part))
        
        print(f"GPU columns found: {gpu_columns}")
        
        # Parse matrix rows
        connections = {}
        
        for i in range(matrix_start + 1, len(lines)):
            line = lines[i].strip()
            if not line or line.startswith('Legend') or line.startswith('NIC'):
                break
            
            parts = line.split()
            if len(parts) < 2:
                continue
            
            src_gpu = parts[0]
            if not src_gpu.startswith('GPU'):
                continue
            
            print(f"Processing row for {src_gpu}: {parts}")
            
            gpu_connections = {}
            for col_idx, dst_gpu in gpu_columns:
                if col_idx < len(parts):
                    conn_type = parts[col_idx]
                    print(f"  Checking {src_gpu} -> {dst_gpu}: parts[{col_idx}] = '{conn_type}'")
                    if src_gpu != dst_gpu and conn_type != 'X':
                        gpu_connections[dst_gpu] = conn_type
                        print(f"  Connection: {src_gpu} -> {dst_gpu} via {conn_type}")
            
            connections[src_gpu] = gpu_connections
        
        print(f"\nFinal connections: {connections}")
        return connections
        
    except Exception as e:
        print(f"Error in simple topology parse: {e}")
        import traceback
        traceback.print_exc()
        return {}

if __name__ == '__main__':
    simple_parse_topology()