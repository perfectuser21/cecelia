import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ExecutionStatus } from '../ExecutionStatus';
import '@testing-library/jest-dom';

// Mock fetch
global.fetch = vi.fn();

// Mock WebSocket
class MockWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = WebSocket.CONNECTING;

  constructor(public url: string) {
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 0);
  }

  send(data: string) {
    // Mock send
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }
}

global.WebSocket = MockWebSocket as any;

const mockOverviewData = {
  success: true,
  total_runs: 10,
  running: 2,
  completed: 7,
  failed: 1,
  active_processes: 2,
  recent_runs: [
    {
      id: '1',
      project: 'Test Project',
      feature_branch: 'feature/test',
      status: 'in_progress',
      total_checkpoints: 11,
      completed_checkpoints: 5,
      failed_checkpoints: 0,
      current_checkpoint: 'Step 5: Code',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '2',
      project: 'Another Project',
      feature_branch: 'feature/another',
      status: 'completed',
      total_checkpoints: 11,
      completed_checkpoints: 11,
      failed_checkpoints: 0,
      current_checkpoint: null,
      started_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: new Date().toISOString()
    }
  ]
};

describe('ExecutionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockOverviewData
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render loading state initially', () => {
    render(<ExecutionStatus />);
    expect(screen.getByText(/loading execution status/i)).toBeInTheDocument();
  });

  it('should fetch and display execution status', async () => {
    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Execution Status')).toBeInTheDocument();
    });

    // Check summary stats
    expect(screen.getByText('2')).toBeInTheDocument(); // Running
    expect(screen.getByText('7')).toBeInTheDocument(); // Completed
    expect(screen.getByText('1')).toBeInTheDocument(); // Failed
  });

  it('should display task information when expanded', async () => {
    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Execution Status')).toBeInTheDocument();
    });

    // Click expand button
    const expandButton = screen.getByRole('button', { name: /expand/i });
    expandButton.click();

    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
      expect(screen.getByText('Another Project')).toBeInTheDocument();
    });
  });

  it('should show WebSocket connected status', async () => {
    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Live')).toBeInTheDocument();
    });
  });

  it('should fallback to polling when WebSocket is not connected', async () => {
    // Mock WebSocket to fail connection
    global.WebSocket = class FailingWebSocket {
      constructor(url: string) {
        setTimeout(() => {
          if (this.onerror) this.onerror(new Event('error'));
        }, 0);
      }
      onopen: any;
      onmessage: any;
      onerror: any;
      onclose: any;
      readyState = WebSocket.CLOSED;
      send() {}
      close() {}
    } as any;

    render(<ExecutionStatus refreshInterval={1000} />);

    await waitFor(() => {
      expect(screen.getByText(/polling \(1s\)/i)).toBeInTheDocument();
    });
  });

  it('should display error message when fetch fails', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  it('should show progress bar for in_progress tasks', async () => {
    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Execution Status')).toBeInTheDocument();
    });

    // Click expand to see runs
    const expandButton = screen.getByRole('button', { name: /expand/i });
    expandButton.click();

    await waitFor(() => {
      // Check for progress text
      expect(screen.getByText(/progress: 5\/11/i)).toBeInTheDocument();
    });
  });

  it('should display correct status badges', async () => {
    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Execution Status')).toBeInTheDocument();
    });

    const expandButton = screen.getByRole('button', { name: /expand/i });
    expandButton.click();

    await waitFor(() => {
      expect(screen.getByText('in progress')).toBeInTheDocument();
      expect(screen.getByText('completed')).toBeInTheDocument();
    });
  });

  it('should update status when WebSocket message is received', async () => {
    let mockWs: MockWebSocket;

    // Capture WebSocket instance
    const OriginalWebSocket = global.WebSocket;
    global.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        mockWs = this;
      }
    } as any;

    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Execution Status')).toBeInTheDocument();
    });

    // Simulate WebSocket message
    if (mockWs! && mockWs!.onmessage) {
      const event = new MessageEvent('message', {
        data: JSON.stringify({
          event: 'task:progress',
          data: { task_id: '1', progress: 0.6 }
        })
      });
      mockWs!.onmessage(event);
    }

    // Should trigger a refetch
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2); // Initial + after WebSocket message
    });

    global.WebSocket = OriginalWebSocket;
  });
});
