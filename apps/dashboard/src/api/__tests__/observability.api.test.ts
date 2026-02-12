import { describe, it, expect, vi, beforeEach } from 'vitest';
import { observabilityApi } from '../observability.api';
import * as client from '../client';

// Mock client module
vi.mock('../client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe('observabilityApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getActiveRuns', () => {
    it('should call correct endpoint and return active runs', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: [
            { run_id: 'run1', task_id: 'task1', status: 'running' },
            { run_id: 'run2', task_id: 'task2', status: 'running' },
          ],
          count: 2,
        },
      };

      (client.apiClient.get as any).mockResolvedValue(mockResponse);

      const result = await observabilityApi.getActiveRuns();

      expect(client.apiClient.get).toHaveBeenCalledWith('/brain/trace/runs/active');
      expect(result.data.count).toBe(2);
      expect(result.data.data).toHaveLength(2);
    });
  });

  describe('getRun', () => {
    it('should fetch run trace by ID', async () => {
      const mockRunId = 'run-123';
      const mockResponse = {
        data: {
          success: true,
          data: [
            { id: 1, run_id: mockRunId, layer: 'L0_orchestrator', status: 'success' },
          ],
        },
      };

      (client.apiClient.get as any).mockResolvedValue(mockResponse);

      const result = await observabilityApi.getRun(mockRunId);

      expect(client.apiClient.get).toHaveBeenCalledWith(`/brain/trace/runs/${mockRunId}`);
      expect(result.data.data[0].run_id).toBe(mockRunId);
    });
  });

  describe('getLastAlive', () => {
    it('should fetch last alive event for run', async () => {
      const mockRunId = 'run-456';
      const mockResponse = {
        data: {
          success: true,
          data: { id: 1, run_id: mockRunId, layer: 'L2_executor', status: 'running' },
        },
      };

      (client.apiClient.get as any).mockResolvedValue(mockResponse);

      const result = await observabilityApi.getLastAlive(mockRunId);

      expect(client.apiClient.get).toHaveBeenCalledWith(`/brain/trace/runs/${mockRunId}/last-alive`);
      expect(result.data.data.run_id).toBe(mockRunId);
    });
  });

  describe('getTopFailures', () => {
    it('should fetch top failures with default limit', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: [
            { reason_code: 'TIMEOUT', reason_kind: 'TRANSIENT', count: 5 },
            { reason_code: 'NETWORK_ERROR', reason_kind: 'TRANSIENT', count: 3 },
          ],
        },
      };

      (client.apiClient.get as any).mockResolvedValue(mockResponse);

      await observabilityApi.getTopFailures();

      expect(client.apiClient.get).toHaveBeenCalledWith('/brain/trace/failures/top', { params: { limit: 10 } });
    });

    it('should fetch top failures with custom limit', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: [],
        },
      };

      (client.apiClient.get as any).mockResolvedValue(mockResponse);

      await observabilityApi.getTopFailures(5);

      expect(client.apiClient.get).toHaveBeenCalledWith('/brain/trace/failures/top', { params: { limit: 5 } });
    });
  });

  describe('getStuckRuns', () => {
    it('should fetch stuck runs', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: [
            {
              run_id: 'stuck1',
              layer: 'L2_executor',
              step_name: 'test-step',
              stuck_duration_seconds: 360,
              executor_host: 'host1',
            },
          ],
        },
      };

      (client.apiClient.get as any).mockResolvedValue(mockResponse);

      const result = await observabilityApi.getStuckRuns();

      expect(client.apiClient.get).toHaveBeenCalledWith('/brain/trace/stuck');
      expect(result.data.data[0].stuck_duration_seconds).toBe(360);
    });
  });

  describe('getArtifact', () => {
    it('should fetch artifact by ID', async () => {
      const mockArtifactId = 'artifact-789';
      const mockResponse = {
        data: {
          success: true,
          data: { id: mockArtifactId, run_id: 'run1', type: 'report', content: 'test content' },
        },
      };

      (client.apiClient.get as any).mockResolvedValue(mockResponse);

      const result = await observabilityApi.getArtifact(mockArtifactId);

      expect(client.apiClient.get).toHaveBeenCalledWith(`/brain/trace/artifacts/${mockArtifactId}`);
      expect(result.data.data.id).toBe(mockArtifactId);
    });
  });

  describe('downloadArtifact', () => {
    it('should download artifact with correct endpoint', async () => {
      const mockArtifactId = 'artifact-999';
      const mockResponse = { data: 'artifact binary data' };

      (client.apiClient.get as any).mockResolvedValue(mockResponse);

      await observabilityApi.downloadArtifact(mockArtifactId);

      expect(client.apiClient.get).toHaveBeenCalledWith(
        `/brain/trace/artifacts/${mockArtifactId}/download`,
        { responseType: 'blob' }
      );
    });
  });
});
