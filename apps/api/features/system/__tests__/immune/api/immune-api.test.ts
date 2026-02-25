/**
 * Immune API Tests
 *
 * 测试 API 客户端的基本功能
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { immuneApi } from '../../../api/immune.api';

// Mock fetch
global.fetch = vi.fn();

describe('Immune API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchDashboard', () => {
    it('should fetch dashboard data successfully', async () => {
      const mockData = {
        success: true,
        data: {
          policies: { draft: 1, probation: 2, active: 3, disabled: 1, total: 7 },
          quarantine: { total: 5, by_reason: { failure_threshold: 3, manual: 1, resource_hog: 1 } },
          failures: { top_signatures: [{ signature: 'error-test', count: 10 }] },
          recent_promotions: [],
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      });

      const result = await immuneApi.fetchDashboard();
      expect(result).toEqual(mockData.data);
    });

    it('should throw error on API failure', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(immuneApi.fetchDashboard()).rejects.toThrow('API Error (500)');
    });
  });

  describe('fetchPolicies', () => {
    it('should fetch policies with filters', async () => {
      const mockData = {
        success: true,
        data: [
          {
            policy_id: 1,
            signature: 'test-sig',
            status: 'active',
            policy_json: { action: 'requeue', params: {} },
            risk_level: 'low',
            success_count: 5,
            failure_count: 0,
            created_at: '2026-01-01T00:00:00Z',
            promoted_at: null,
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      });

      const result = await immuneApi.fetchPolicies({ status: 'active', limit: 10 });
      expect(result).toEqual(mockData.data);
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('status=active'));
    });
  });

  describe('updatePolicyStatus', () => {
    it('should update policy status successfully', async () => {
      const mockData = { success: true, data: undefined };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      });

      await immuneApi.updatePolicyStatus(1, 'disabled', 'Test reason');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/policies/1/status'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'disabled', reason: 'Test reason' }),
        })
      );
    });
  });
});
