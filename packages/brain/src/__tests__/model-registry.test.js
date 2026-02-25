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
import { updateAgentModel, batchUpdateAgentModels, _resetProfileCache, getActiveProfile } from '../model-profile.js';

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

    it('R1b: 模型总数为 10', () => {
      expect(MODELS.length).toBe(10);
    });

    it('R2: 所有 agent 有 id/name/layer/allowed_models/recommended_model', () => {
      for (const a of AGENTS) {
        expect(a.id).toBeTruthy();
        expect(a.name).toBeTruthy();
        expect(a.layer).toMatch(/^(brain|executor)$/);
        expect(a.allowed_models.length).toBeGreaterThan(0);
        expect(a.recommended_model).toBeTruthy();
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

    it('R10: 模型存在且属性正确', () => {
      const m25 = getModelById('MiniMax-M2.5');
      expect(m25).toBeTruthy();
      expect(m25.provider).toBe('minimax');
      expect(m25.tier).toBe('standard');

      const o3 = getModelById('o3-mini');
      expect(o3).toBeTruthy();
      expect(o3.provider).toBe('openai');
      expect(o3.tier).toBe('fast');

      const o4 = getModelById('o4-mini');
      expect(o4).toBeTruthy();
      expect(o4.provider).toBe('openai');
      expect(o4.tier).toBe('fast');

      const m21 = getModelById('MiniMax-M2.1');
      expect(m21).toBeTruthy();
      expect(m21.deprecated).toBeUndefined();

      const m2 = getModelById('MiniMax-M2');
      expect(m2).toBeTruthy();
      expect(m2.provider).toBe('minimax');
      expect(m2.tier).toBe('premium');

      const sonnet46 = getModelById('claude-sonnet-4-6');
      expect(sonnet46).toBeTruthy();
      expect(sonnet46.provider).toBe('anthropic');
      expect(sonnet46.tier).toBe('standard');

      const opus46 = getModelById('claude-opus-4-6');
      expect(opus46).toBeTruthy();
      expect(opus46.provider).toBe('anthropic');
      expect(opus46.tier).toBe('premium');

      // 旧模型已移除
      expect(getModelById('MiniMax-M2.1-highspeed')).toBeNull();
      expect(getModelById('claude-sonnet-4-20250514')).toBeNull();
      expect(getModelById('claude-opus-4-20250514')).toBeNull();
    });

    it('R11: 新模型正确加入 agent 白名单', () => {
      // thalamus 包含 M2.5-highspeed（M2.1 已废弃移除）
      expect(isModelAllowedForAgent('thalamus', 'MiniMax-M2.5-highspeed')).toBe(true);
      // cortex 包含 M2.5
      expect(isModelAllowedForAgent('cortex', 'MiniMax-M2.5')).toBe(true);
      // codex_qa 包含 o3-mini 和 o4-mini
      expect(isModelAllowedForAgent('codex_qa', 'o3-mini')).toBe(true);
      expect(isModelAllowedForAgent('codex_qa', 'o4-mini')).toBe(true);
      // qa 包含 o3-mini 和 o4-mini
      expect(isModelAllowedForAgent('qa', 'o3-mini')).toBe(true);
      expect(isModelAllowedForAgent('qa', 'o4-mini')).toBe(true);
      // dev 包含 M2.5
      expect(isModelAllowedForAgent('dev', 'MiniMax-M2.5')).toBe(true);
    });

    it('R12: recommended_model 在各 agent 的 allowed_models 内', () => {
      for (const a of AGENTS) {
        expect(a.allowed_models).toContain(a.recommended_model);
      }
    });

    it('R13: 跨 provider 白名单正确（已更新为 4.6）', () => {
      expect(isModelAllowedForAgent('thalamus', 'claude-sonnet-4-6')).toBe(true);
      expect(isModelAllowedForAgent('review', 'claude-opus-4-6')).toBe(true);
      expect(isModelAllowedForAgent('audit', 'claude-opus-4-6')).toBe(true);
      expect(isModelAllowedForAgent('dev', 'claude-opus-4-6')).toBe(true);
    });
  });

  describe('辅助函数', () => {
    it('R5: getModelById 返回正确模型', () => {
      const m = getModelById('claude-opus-4-6');
      expect(m).toBeTruthy();
      expect(m.name).toBe('Opus 4.6');
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
      expect(isModelAllowedForAgent('thalamus', 'MiniMax-M2.5-highspeed')).toBe(true);
      expect(isModelAllowedForAgent('thalamus', 'MiniMax-M2.1')).toBe(false);
      expect(isModelAllowedForAgent('thalamus', 'claude-opus-4-6')).toBe(false);
    });

    it('R9: getProviderForModel 返回 provider', () => {
      expect(getProviderForModel('MiniMax-M2.1')).toBe('minimax');
      expect(getProviderForModel('claude-opus-4-6')).toBe('anthropic');
      expect(getProviderForModel('codex-mini-latest')).toBe('openai');
      expect(getProviderForModel('o3-mini')).toBe('openai');
      expect(getProviderForModel('o4-mini')).toBe('openai');
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
          decomp_review: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          codex_qa: { anthropic: null, minimax: null },
        },
        fixed_provider: {
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

    const result = await updateAgentModel(pool, 'dev', 'claude-sonnet-4-6');

    expect(result.agent_id).toBe('dev');
    expect(result.current.provider).toBe('anthropic');
    expect(result.current.model).toBe('claude-sonnet-4-6');
    // model_map 更新
    const devMap = getActiveProfile().config.executor.model_map.dev;
    expect(devMap.anthropic).toBe('claude-sonnet-4-6');
    expect(devMap.minimax).toBeNull();
  });

  it('U3: 无效 agent 抛出错误', async () => {
    const pool = makeMockPool();
    await expect(updateAgentModel(pool, 'nonexistent', 'MiniMax-M2.1'))
      .rejects.toThrow('Unknown agent: nonexistent');
  });

  it('U4: 不允许的模型抛出错误', async () => {
    const pool = makeMockPool();
    await expect(updateAgentModel(pool, 'thalamus', 'claude-opus-4-6'))
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

describe('batchUpdateAgentModels', () => {
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
          decomp_review: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          codex_qa: { anthropic: null, minimax: null },
        },
        fixed_provider: {
          codex_qa: 'openai',
          decomp_review: 'minimax',
          talk: 'minimax',
          research: 'minimax',
        },
      },
    },
  });

  it('B1: 批量更新多个 agent 成功', async () => {
    const profile = makeActiveProfile();
    const pool = makeMockPool(async (sql) => {
      if (sql.includes('SELECT')) return { rows: [profile] };
      return { rows: [] };
    });

    const result = await batchUpdateAgentModels(pool, [
      { agent_id: 'thalamus', model_id: 'MiniMax-M2.5-highspeed' },
      { agent_id: 'dev', model_id: 'claude-sonnet-4-6' },
      { agent_id: 'codex_qa', model_id: 'o3-mini' },
    ]);

    expect(result.updated.length).toBe(3);
    expect(result.updated[0]).toEqual({ agent_id: 'thalamus', provider: 'minimax', model: 'MiniMax-M2.5-highspeed' });
    expect(result.updated[1]).toEqual({ agent_id: 'dev', provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(result.updated[2]).toEqual({ agent_id: 'codex_qa', provider: 'openai', model: 'o3-mini' });

    // 缓存更新
    const cached = getActiveProfile();
    expect(cached.config.thalamus.model).toBe('MiniMax-M2.5-highspeed');
    expect(cached.config.executor.model_map.dev.anthropic).toBe('claude-sonnet-4-6');
    expect(cached.config.executor.model_map.codex_qa.openai).toBe('o3-mini');

    // 只调用一次 UPDATE
    const updateCalls = pool.query.mock.calls.filter(c => c[0].includes('UPDATE'));
    expect(updateCalls.length).toBe(1);
  });

  it('B2: 无效 agent 整体失败', async () => {
    const pool = makeMockPool();
    await expect(batchUpdateAgentModels(pool, [
      { agent_id: 'dev', model_id: 'MiniMax-M2.5-highspeed' },
      { agent_id: 'nonexistent', model_id: 'MiniMax-M2.1' },
    ])).rejects.toThrow('Unknown agent: nonexistent');
  });

  it('B3: 不允许的模型整体失败', async () => {
    const pool = makeMockPool();
    await expect(batchUpdateAgentModels(pool, [
      { agent_id: 'thalamus', model_id: 'claude-opus-4-6' },
    ])).rejects.toThrow('not allowed');
  });

  it('B4: fixed_provider 冲突整体失败', async () => {
    const pool = makeMockPool();
    await expect(batchUpdateAgentModels(pool, [
      { agent_id: 'codex_qa', model_id: 'MiniMax-M2.1' },
    ])).rejects.toThrow('not allowed');
  });

  it('B5: 无 active profile 抛出错误', async () => {
    const pool = makeMockPool(async () => ({ rows: [] }));
    await expect(batchUpdateAgentModels(pool, [
      { agent_id: 'dev', model_id: 'MiniMax-M2.5-highspeed' },
    ])).rejects.toThrow('No active profile');
  });

  it('B6: brain 层 + executor 层混合更新', async () => {
    const profile = makeActiveProfile();
    const pool = makeMockPool(async (sql) => {
      if (sql.includes('SELECT')) return { rows: [profile] };
      return { rows: [] };
    });

    const result = await batchUpdateAgentModels(pool, [
      { agent_id: 'cortex', model_id: 'MiniMax-M2.5' },
      { agent_id: 'qa', model_id: 'o4-mini' },
    ]);

    expect(result.updated.length).toBe(2);
    const cached = getActiveProfile();
    expect(cached.config.cortex.model).toBe('MiniMax-M2.5');
    expect(cached.config.cortex.provider).toBe('minimax');
    expect(cached.config.executor.model_map.qa.openai).toBe('o4-mini');
    expect(cached.config.executor.model_map.qa.minimax).toBeNull();
  });
});
