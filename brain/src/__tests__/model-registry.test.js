/**
 * 模型注册表 + Agent 级别模型选择 - 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MODELS,
  AGENTS,
  getModelById,
  getAgentById,
  isModelAllowedForAgent,
  getProviderForModel,
} from '../model-registry.js';
import { updateAgentModel, _resetProfileCache, getActiveProfile } from '../model-profile.js';

// ============================================================
// Mock Pool Helper
// ============================================================

function makeMockPool(queryHandler) {
  return {
    query: vi.fn(queryHandler || (async () => ({ rows: [] }))),
  };
}

describe('model-registry', () => {
  describe('数据完整性', () => {
    it('R1: 所有模型有 id/name/provider/tier', () => {
      for (const m of MODELS) {
        expect(m.id).toBeTruthy();
        expect(m.name).toBeTruthy();
        expect(m.provider).toBeTruthy();
        expect(m.tier).toBeTruthy();
      }
    });

    it('R2: 所有 agent 有 id/name/layer/allowed_models', () => {
      for (const a of AGENTS) {
        expect(a.id).toBeTruthy();
        expect(a.name).toBeTruthy();
        expect(a.layer).toMatch(/^(brain|executor)$/);
        expect(a.allowed_models.length).toBeGreaterThan(0);
      }
    });

    it('R3: agent 的 allowed_models 都在 MODELS 中', () => {
      const modelIds = new Set(MODELS.map(m => m.id));
      for (const a of AGENTS) {
        for (const mid of a.allowed_models) {
          expect(modelIds.has(mid)).toBe(true);
        }
      }
    });

    it('R4: fixed_provider agent 的 allowed_models 全部属于该 provider', () => {
      for (const a of AGENTS) {
        if (a.fixed_provider) {
          for (const mid of a.allowed_models) {
            const model = getModelById(mid);
            expect(model.provider).toBe(a.fixed_provider);
          }
        }
      }
    });
  });

  describe('辅助函数', () => {
    it('R5: getModelById 返回正确模型', () => {
      const m = getModelById('claude-opus-4-20250514');
      expect(m).toBeTruthy();
      expect(m.name).toBe('Opus');
      expect(m.provider).toBe('anthropic');
    });

    it('R6: getModelById 不存在返回 null', () => {
      expect(getModelById('nonexistent')).toBeNull();
    });

    it('R7: getAgentById 返回正确 agent', () => {
      const a = getAgentById('thalamus');
      expect(a).toBeTruthy();
      expect(a.name).toBe('L1 丘脑');
      expect(a.layer).toBe('brain');
    });

    it('R8: isModelAllowedForAgent 正确校验', () => {
      expect(isModelAllowedForAgent('thalamus', 'MiniMax-M2.1')).toBe(true);
      expect(isModelAllowedForAgent('thalamus', 'claude-opus-4-20250514')).toBe(false);
    });

    it('R9: getProviderForModel 返回 provider', () => {
      expect(getProviderForModel('MiniMax-M2.1')).toBe('minimax');
      expect(getProviderForModel('claude-opus-4-20250514')).toBe('anthropic');
      expect(getProviderForModel('codex-mini-latest')).toBe('openai');
      expect(getProviderForModel('nonexistent')).toBeNull();
    });
  });
});

describe('updateAgentModel', () => {
  beforeEach(() => {
    _resetProfileCache();
  });

  const makeActiveProfile = () => ({
    id: 'profile-minimax',
    name: 'MiniMax 主力',
    config: {
      thalamus: { provider: 'minimax', model: 'MiniMax-M2.1' },
      cortex: { provider: 'anthropic', model: 'claude-opus-4-20250514' },
      executor: {
        default_provider: 'minimax',
        model_map: {
          dev: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          qa: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          review: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          audit: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          talk: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          research: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          exploratory: { anthropic: null, minimax: 'MiniMax-M2.1' },
          decomp_review: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          codex_qa: { anthropic: null, minimax: null },
        },
        fixed_provider: {
          exploratory: 'minimax',
          codex_qa: 'openai',
          decomp_review: 'minimax',
          talk: 'minimax',
          research: 'minimax',
        },
      },
    },
  });

  it('U1: brain 层 agent 更新成功 (thalamus)', async () => {
    const profile = makeActiveProfile();
    const pool = makeMockPool(async (sql) => {
      if (sql.includes('SELECT')) return { rows: [profile] };
      return { rows: [] };
    });

    const result = await updateAgentModel(pool, 'thalamus', 'claude-haiku-4-5-20251001');

    expect(result.agent_id).toBe('thalamus');
    expect(result.current.provider).toBe('anthropic');
    expect(result.current.model).toBe('claude-haiku-4-5-20251001');
    expect(result.previous.model).toBe('MiniMax-M2.1');
    // 缓存也更新了
    expect(getActiveProfile().config.thalamus.model).toBe('claude-haiku-4-5-20251001');
  });

  it('U2: executor 层 agent 更新成功 (dev)', async () => {
    const profile = makeActiveProfile();
    const pool = makeMockPool(async (sql) => {
      if (sql.includes('SELECT')) return { rows: [profile] };
      return { rows: [] };
    });

    const result = await updateAgentModel(pool, 'dev', 'claude-sonnet-4-20250514');

    expect(result.agent_id).toBe('dev');
    expect(result.current.provider).toBe('anthropic');
    expect(result.current.model).toBe('claude-sonnet-4-20250514');
    // model_map 更新
    const devMap = getActiveProfile().config.executor.model_map.dev;
    expect(devMap.anthropic).toBe('claude-sonnet-4-20250514');
    expect(devMap.minimax).toBeNull();
  });

  it('U3: 无效 agent 抛出错误', async () => {
    const pool = makeMockPool();
    await expect(updateAgentModel(pool, 'nonexistent', 'MiniMax-M2.1'))
      .rejects.toThrow('Unknown agent: nonexistent');
  });

  it('U4: 不允许的模型抛出错误', async () => {
    const pool = makeMockPool();
    await expect(updateAgentModel(pool, 'thalamus', 'claude-opus-4-20250514'))
      .rejects.toThrow('not allowed');
  });

  it('U5: fixed_provider 冲突抛出错误', async () => {
    const pool = makeMockPool();
    // codex_qa 锁定为 openai，不能用 minimax 模型
    await expect(updateAgentModel(pool, 'codex_qa', 'MiniMax-M2.1'))
      .rejects.toThrow('not allowed');
  });

  it('U6: 无 active profile 抛出错误', async () => {
    const pool = makeMockPool(async () => ({ rows: [] }));
    await expect(updateAgentModel(pool, 'dev', 'MiniMax-M2.5-highspeed'))
      .rejects.toThrow('No active profile');
  });
});
