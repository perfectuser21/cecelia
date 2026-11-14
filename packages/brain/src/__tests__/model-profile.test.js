/**
 * Brain 运行时模型参数只读装载 - 单元测试
 *
 * 覆盖：
 * - loadActiveProfile（从 DB 加载、fallback）
 * - getActiveProfile（缓存、fallback）
 * - executor profile-aware 路由
 * - thalamus profile dispatch
 * - cortex profile-aware 模型选择
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadActiveProfile,
  getActiveProfile,
  FALLBACK_PROFILE,
  _resetProfileCache,
} from '../model-profile.js';

// ============================================================
// Mock Pool Helper
// ============================================================

function makeMockPool(queryHandler) {
  return {
    query: vi.fn(queryHandler || (async () => ({ rows: [] }))),
  };
}

describe('model-profile', () => {
  beforeEach(() => {
    _resetProfileCache();
  });

  // ==================== loadActiveProfile ====================

  describe('loadActiveProfile', () => {
    it('D1: 从 DB 加载 active profile 到缓存', async () => {
      const dbProfile = {
        id: 'profile-anthropic',
        name: 'Anthropic 主力',
        config: { thalamus: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } },
        is_active: true,
      };
      const pool = makeMockPool(async () => ({ rows: [dbProfile] }));

      const result = await loadActiveProfile(pool);

      expect(result).toEqual(dbProfile);
      expect(getActiveProfile()).toEqual(dbProfile);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('model_profiles'),
      );
    });

    it('D2: DB 无 active profile 时使用 fallback', async () => {
      const pool = makeMockPool(async () => ({ rows: [] }));

      const result = await loadActiveProfile(pool);

      expect(result).toEqual(FALLBACK_PROFILE);
      expect(getActiveProfile()).toEqual(FALLBACK_PROFILE);
    });

    it('D3: DB 查询失败时使用 fallback', async () => {
      const pool = makeMockPool(async () => {
        throw new Error('connection refused');
      });

      const result = await loadActiveProfile(pool);

      expect(result).toEqual(FALLBACK_PROFILE);
      expect(getActiveProfile()).toEqual(FALLBACK_PROFILE);
    });
  });

  // ==================== getActiveProfile ====================

  describe('getActiveProfile', () => {
    it('D4: 未加载时返回 FALLBACK_PROFILE', () => {
      const profile = getActiveProfile();
      expect(profile).toEqual(FALLBACK_PROFILE);
      expect(profile.id).toBe('profile-anthropic');
    });

    it('D5: 加载后返回缓存的 profile', async () => {
      const dbProfile = {
        id: 'profile-anthropic',
        name: 'Anthropic 主力',
        config: {},
        is_active: true,
      };
      const pool = makeMockPool(async () => ({ rows: [dbProfile] }));
      await loadActiveProfile(pool);

      expect(getActiveProfile()).toEqual(dbProfile);
    });
  });

  // ==================== FALLBACK_PROFILE 结构 ====================

  describe('FALLBACK_PROFILE', () => {
    it('D10: 包含 thalamus/cortex/reflection/mouth/memory/executor 六层配置', () => {
      expect(FALLBACK_PROFILE.config.thalamus).toBeDefined();
      expect(FALLBACK_PROFILE.config.cortex).toBeDefined();
      expect(FALLBACK_PROFILE.config.reflection).toBeDefined();
      expect(FALLBACK_PROFILE.config.mouth).toBeDefined();
      expect(FALLBACK_PROFILE.config.memory).toBeDefined();
      expect(FALLBACK_PROFILE.config.executor).toBeDefined();

      expect(FALLBACK_PROFILE.config.thalamus.provider).toBe('anthropic-api');
      expect(FALLBACK_PROFILE.config.cortex.provider).toBe('anthropic-api');
      expect(FALLBACK_PROFILE.config.reflection.provider).toBe('anthropic');
      expect(FALLBACK_PROFILE.config.mouth.provider).toBe('anthropic');
      expect(FALLBACK_PROFILE.config.memory.provider).toBe('anthropic');
      expect(FALLBACK_PROFILE.config.executor.default_provider).toBe('anthropic');
    });

    it('D11: executor model_map 包含所有 task type', () => {
      const taskTypes = ['dev', 'review', 'qa', 'audit', 'talk', 'research', 'decomp_review', 'dept_heartbeat', 'codex_qa'];
      for (const tt of taskTypes) {
        expect(FALLBACK_PROFILE.config.executor.model_map[tt]).toBeDefined();
      }
    });
  });

  // ==================== _resetProfileCache ====================

  describe('_resetProfileCache', () => {
    it('D12: 重置后 getActiveProfile 返回 fallback', async () => {
      const pool = makeMockPool(async () => ({
        rows: [{ id: 'profile-anthropic', name: 'Anthropic 主力', config: {}, is_active: true }],
      }));
      await loadActiveProfile(pool);
      expect(getActiveProfile().id).toBe('profile-anthropic');

      _resetProfileCache();
      expect(getActiveProfile()).toEqual(FALLBACK_PROFILE);
    });
  });
});
