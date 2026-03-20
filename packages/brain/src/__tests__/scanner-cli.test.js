/**
 * Tests for scanner-cli.js - Brain API integration and embedded capability detection
 */

import { jest } from '@jest/globals';

// Mock node-fetch for Brain API tests
const mockFetch = jest.fn();
jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch
}));

describe('Scanner CLI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Brain API Integration', () => {
    test('should connect to Brain API successfully', async () => {
      // Mock successful Brain API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          service: 'cecelia-brain',
          status: 'running',
          port: 5221
        })
      });

      const { queryBrainAPI } = await import('../scanner-cli.js');
      const result = await queryBrainAPI();

      expect(result).toEqual({
        service: 'cecelia-brain',
        status: 'running',
        port: 5221
      });
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:5221/');
    });

    test('should handle Brain API connection errors', async () => {
      // Mock failed Brain API response
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const { queryBrainAPI } = await import('../scanner-cli.js');
      
      await expect(queryBrainAPI()).rejects.toThrow('Brain API 连接失败: Connection refused');
    });
  });

  describe('Embedded Capability Scanning', () => {
    test('should identify embedded capabilities correctly', async () => {
      // Mock successful Brain API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          service: 'cecelia-brain',
          status: 'running',
          port: 5221
        })
      });

      const { scanEmbeddedCapabilities } = await import('../scanner-cli.js');
      const result = await scanEmbeddedCapabilities();

      expect(result.status).toBe('success');
      expect(result.brain_api_connected).toBe(true);
      expect(result.embedded_capabilities).toEqual({
        'branch-protect': 'embedded',
        'ci-devgate': 'embedded', 
        'watchdog': 'embedded',
        'three-pool-slot': 'embedded',
        'autonomous-scheduling': 'embedded',
        'circuit-breaker': 'embedded'
      });
    });

    test('should handle scan errors gracefully', async () => {
      // Mock failed Brain API response
      mockFetch.mockRejectedValueOnce(new Error('API Error'));

      const { scanEmbeddedCapabilities } = await import('../scanner-cli.js');
      const result = await scanEmbeddedCapabilities();

      expect(result.status).toBe('error');
      expect(result.brain_api_connected).toBe(false);
      expect(result.error).toContain('API Error');
    });
  });
});
