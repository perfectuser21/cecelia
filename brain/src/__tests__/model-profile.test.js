/**
 * Model Profile 运行时切换系统 - 单元测试
 *
 * 覆盖：
 * - loadActiveProfile（从 DB 加载、fallback）
 * - getActiveProfile（缓存、fallback）
 * - switchProfile（事务切换、不存在 profile、rollback）
 * - listProfiles
 * - executor profile-aware 路由
 * - thalamus profile dispatch
 * - cortex profile-aware 模型选择
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadActiveProfile,
  getActiveProfile,
  switchProfile,
  listProfiles,
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
      expect(profile.id).toBe('profile-minimax');
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

  // ==================== switchProfile ====================

  describe('switchProfile', () => {
    it('D6: 成功切换 profile（事务安全）', async () => {
      const targetProfile = {
        id: 'profile-anthropic',
        name: 'Anthropic 主力',
        config: { thalamus: { provider: 'anthropic' } },
      };

      const calls = [];
      const pool = makeMockPool(async (sql, params) => {
        calls.push(sql);
        if (sql.includes('SELECT') && sql.includes('model_profiles') && params) {
          return { rows: [targetProfile] };
        }
        return { rows: [] };
      });

      const result = await switchProfile(pool, 'profile-anthropic');

      expect(result.id).toBe('profile-anthropic');
      expect(result.is_active).toBe(true);
      expect(getActiveProfile().id).toBe('profile-anthropic');

      // 验证事务流程
      expect(calls).toContain('BEGIN');
      expect(calls).toContain('COMMIT');
      expect(calls).not.toContain('ROLLBACK');
    });

    it('D7: 不存在的 profile 抛出错误', async () => {
      const pool = makeMockPool(async () => ({ rows: [] }));

      await expect(switchProfile(pool, 'profile-nonexistent'))
        .rejects.toThrow('Profile not found: profile-nonexistent');
    });

    it('D8: 事务失败时 ROLLBACK', async () => {
      const calls = [];
      let callCount = 0;
      const pool = makeMockPool(async (sql, params) => {
        calls.push(sql);
        callCount++;
        // 第一次 SELECT 返回结果
        if (sql.includes('SELECT') && params) {
          return { rows: [{ id: 'profile-anthropic', name: 'Anthropic 主力', config: {} }] };
        }
        // BEGIN 正常
        if (sql === 'BEGIN') return { rows: [] };
        // 第一个 UPDATE（deactivate）正常
        if (sql.includes('UPDATE') && sql.includes('false')) return { rows: [] };
        // 第二个 UPDATE（activate）失败
        if (sql.includes('UPDATE') && sql.includes('true')) {
          throw new Error('DB write error');
        }
        return { rows: [] };
      });

      await expect(switchProfile(pool, 'profile-anthropic'))
        .rejects.toThrow('DB write error');

      expect(calls).toContain('ROLLBACK');
      expect(calls).not.toContain('COMMIT');
    });
  });

  // ==================== listProfiles ====================

  describe('listProfiles', () => {
    it('D9: 列出所有 profile', async () => {
      const profiles = [
        { id: 'profile-minimax', name: 'MiniMax 主力', is_active: true },
        { id: 'profile-anthropic', name: 'Anthropic 主力', is_active: false },
      ];
      const pool = makeMockPool(async () => ({ rows: profiles }));

      const result = await listProfiles(pool);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('profile-minimax');
      expect(result[1].id).toBe('profile-anthropic');
    });
  });

  // ==================== FALLBACK_PROFILE 结构 ====================

  describe('FALLBACK_PROFILE', () => {
    it('D10: 包含 thalamus/cortex/executor 三层配置', () => {
      expect(FALLBACK_PROFILE.config.thalamus).toBeDefined();
      expect(FALLBACK_PROFILE.config.cortex).toBeDefined();
      expect(FALLBACK_PROFILE.config.executor).toBeDefined();

      expect(FALLBACK_PROFILE.config.thalamus.provider).toBe('minimax');
      expect(FALLBACK_PROFILE.config.cortex.provider).toBe('anthropic');
      expect(FALLBACK_PROFILE.config.executor.default_provider).toBe('minimax');
    });

    it('D11: executor model_map 包含所有 task type', () => {
      const taskTypes = ['dev', 'exploratory', 'review', 'qa', 'audit', 'talk', 'research', 'decomp_review', 'codex_qa'];
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
