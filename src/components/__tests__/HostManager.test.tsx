import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HostManager } from '../HostManager';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('HostManager', () => {
  const mockSetHosts = vi.fn();
  const mockOnHostStatusChange = vi.fn();
  
  const defaultProps = {
    hosts: [],
    setHosts: mockSetHosts,
    onHostStatusChange: mockOnHostStatusChange,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Host Addition', () => {
    it('should add a new host with valid URL', async () => {
      render(<HostManager {...defaultProps} />);
      
      const urlInput = screen.getByPlaceholderText(/http:\/\/your-gpu-server/i);
      const nameInput = screen.getByPlaceholderText(/Main Server/i);
      const addButton = screen.getByText(/Add Host/i);

      fireEvent.change(urlInput, { target: { value: 'http://test-server:5000/nvidia-smi.json' } });
      fireEvent.change(nameInput, { target: { value: 'Test Server' } });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(mockSetHosts).toHaveBeenCalled();
      });
    });

    it('should validate URL format', async () => {
      const { toast } = await import('sonner');
      render(<HostManager {...defaultProps} />);
      
      const urlInput = screen.getByPlaceholderText(/http:\/\/your-gpu-server/i);
      const addButton = screen.getByText(/Add Host/i);

      fireEvent.change(urlInput, { target: { value: 'invalid-url' } });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining('valid URL format')
        );
        expect(mockSetHosts).not.toHaveBeenCalled();
      });
    });

    it('should prevent duplicate hosts', async () => {
      const { toast } = await import('sonner');
      const existingHost = {
        url: 'http://existing:5000/nvidia-smi.json',
        name: 'Existing',
        isConnected: true,
      };
      
      render(<HostManager {...defaultProps} hosts={[existingHost]} />);
      
      const urlInput = screen.getByPlaceholderText(/http:\/\/your-gpu-server/i);
      const addButton = screen.getByText(/Add Host/i);

      fireEvent.change(urlInput, { target: { value: existingHost.url } });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Host already exists');
        expect(mockSetHosts).not.toHaveBeenCalled();
      });
    });

    it('should auto-generate name from URL if not provided', async () => {
      render(<HostManager {...defaultProps} />);
      
      const urlInput = screen.getByPlaceholderText(/http:\/\/your-gpu-server/i);
      const addButton = screen.getByText(/Add Host/i);

      fireEvent.change(urlInput, { target: { value: 'http://gpu-server:5000/nvidia-smi.json' } });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(mockSetHosts).toHaveBeenCalled();
      });
    });

    it('should call backend API to add host', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({  // POST /api/hosts
          ok: true,
          json: async () => ({ url: 'http://test:5000/nvidia-smi.json', name: 'test:5000' }),
        })
        .mockResolvedValueOnce({  // Connection test
          ok: true,
          json: async () => ({ gpus: [] }),
        });

      const { toast } = await import('sonner');
      render(<HostManager {...defaultProps} />);
      
      const urlInput = screen.getByPlaceholderText(/http:\/\/your-gpu-server/i);
      const addButton = screen.getByText(/Add Host/i);

      fireEvent.change(urlInput, { target: { value: 'http://test:5000/nvidia-smi.json' } });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/hosts',
          expect.objectContaining({
            method: 'POST',
            credentials: 'include',
          })
        );
        expect(toast.success).toHaveBeenCalledWith('Added host: test:5000');
      });
    });
  });

  describe('Host Removal', () => {
    it('should remove host via backend API', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Host deleted' }),
      });

      const { toast } = await import('sonner');
      const host = { url: 'http://host1:5000/nvidia-smi.json', name: 'Host 1', isConnected: true };
      
      render(<HostManager {...defaultProps} hosts={[host]} />);
      
      const removeButton = screen.getByRole('button', { name: '' });
      fireEvent.click(removeButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/hosts/'),
          expect.objectContaining({ method: 'DELETE', credentials: 'include' })
        );
        expect(mockSetHosts).toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('Host removed');
      });
    });

    it('should show error on backend failure', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      });

      const { toast } = await import('sonner');
      const host = { url: 'http://host1:5000/nvidia-smi.json', name: 'Host 1', isConnected: true };
      
      render(<HostManager {...defaultProps} hosts={[host]} />);
      
      const removeButton = screen.getByRole('button', { name: '' });
      fireEvent.click(removeButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });
    });
  });

  describe('UI State Management', () => {
    it('should show loading state while adding host', async () => {
      render(<HostManager {...defaultProps} />);
      
      const urlInput = screen.getByPlaceholderText(/http:\/\/your-gpu-server/i);
      const addButton = screen.getByText(/Add Host/i);

      fireEvent.change(urlInput, { target: { value: 'http://test:5000/nvidia-smi.json' } });
      fireEvent.click(addButton);

      expect(screen.getByText(/Adding.../i)).toBeInTheDocument();
      expect(addButton).toBeDisabled();
    });

    it('should display host count correctly', () => {
      const hosts = [
        { url: 'http://host1:5000/nvidia-smi.json', name: 'Host 1', isConnected: true },
        { url: 'http://host2:5000/nvidia-smi.json', name: 'Host 2', isConnected: false },
      ];

      render(<HostManager {...defaultProps} hosts={hosts} />);
      
      expect(screen.getByText(/Configured Hosts \(2\)/)).toBeInTheDocument();
    });

    it('should show connection status badges', () => {
      const hosts = [
        { url: 'http://host1:5000/nvidia-smi.json', name: 'Host 1', isConnected: true },
        { url: 'http://host2:5000/nvidia-smi.json', name: 'Host 2', isConnected: false },
      ];

      render(<HostManager {...defaultProps} hosts={hosts} />);
      
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });
  });

  describe('Backend Integration', () => {
    it('should POST to /api/hosts with credentials', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'http://test:5000/nvidia-smi.json', name: 'Test' }),
      });

      render(<HostManager {...defaultProps} />);
      
      const urlInput = screen.getByPlaceholderText(/http:\/\/your-gpu-server/i);
      const addButton = screen.getByText(/Add Host/i);

      fireEvent.change(urlInput, { target: { value: 'http://test:5000/nvidia-smi.json' } });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/hosts',
          expect.objectContaining({
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: 'http://test:5000/nvidia-smi.json',
              name: 'test:5000',
            }),
          })
        );
      });
    });

    it('should show error when backend rejects the request', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Host already exists' }),
      });

      const { toast } = await import('sonner');
      render(<HostManager {...defaultProps} />);
      
      const urlInput = screen.getByPlaceholderText(/http:\/\/your-gpu-server/i);
      const addButton = screen.getByText(/Add Host/i);

      fireEvent.change(urlInput, { target: { value: 'http://test:5000/nvidia-smi.json' } });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Host already exists');
      });
    });
  });
});