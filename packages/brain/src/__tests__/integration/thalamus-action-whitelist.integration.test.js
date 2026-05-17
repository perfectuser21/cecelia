/**
 * Integration Test: Thalamus ACTION_WHITELIST + validateDecision 验证链
 *
 * 验证 thalamus.js 的 ACTION_WHITELIST 配置完整性，以及 validateDecision
 * 函数在不同输入下的验证行为。
 *
 * 与单元测试的区别：
 *   - 单元测试：验证单个 action 处理函数
 *   - 本集成测试：验证 ACTION_WHITELIST 作为配置中心的完整性，
 *     以及 validateDecision 的完整验证链路
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// ─── Mock 所有外部依赖（避免 DB/LLM 连接）────────────────────────────────────

vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  },
}));

vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue('{"actions": []}'),
  default: vi.fn().mockResolvedValue('{"actions": []}'),
}));

vi.mock('../../memory-retriever.js', () => ({
  buildMemoryContext: vi.fn().mockResolvedValue({
    block: '',
    meta: { semantic: {}, events: {}, conversation: {}, episodic: {} },
  }),
}));

vi.mock('../../learning.js', () => ({
  getRecentLearnings: vi.fn().mockResolvedValue([]),
  upsertLearning: vi.fn().mockResolvedValue(null),
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn(),
}));

vi.mock('../../role-registry.js', () => ({
  buildDomainRouteTable: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../distilled-docs.js', () => ({
  getDoc: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../decisions-context.js', () => ({
  getDecisionsContext: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../cortex.js', () => ({
  callCortex: vi.fn().mockResolvedValue({ actions: [] }),
}));

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('Thalamus ACTION_WHITELIST + validateDecision 集成验证', () => {
  let ACTION_WHITELIST;
  let validateDecision;

  beforeAll(async () => {
    const mod = await import('../../thalamus.js');
    ACTION_WHITELIST = mod.ACTION_WHITELIST;
    validateDecision = mod.validateDecision;
  });

  // ─── 1. ACTION_WHITELIST 结构完整性 ────────────────────────────────────────

  describe('ACTION_WHITELIST 配置完整性', () => {
    it('ACTION_WHITELIST 是非空对象', () => {
      expect(ACTION_WHITELIST).toBeDefined();
      expect(typeof ACTION_WHITELIST).toBe('object');
      expect(Object.keys(ACTION_WHITELIST).length).toBeGreaterThan(5);
    });

    it('每个 action 类型都有 description 字段', () => {
      for (const [type, config] of Object.entries(ACTION_WHITELIST)) {
        expect(config.description, `${type} 缺少 description`).toBeTruthy();
        expect(typeof config.description, `${type}.description 应为 string`).toBe('string');
      }
    });

    it('每个 action 类型都有 dangerous 布尔字段', () => {
      for (const [type, config] of Object.entries(ACTION_WHITELIST)) {
        expect(typeof config.dangerous, `${type}.dangerous 应为 boolean`).toBe('boolean');
      }
    });

    it('dangerous=true 的 action 类型正确标记', () => {
      // 已知危险操作（必须存在且 dangerous=true）
      const knownDangerous = ['quarantine_task', 'request_human_review', 'propose_decomposition'];
      for (const type of knownDangerous) {
        expect(ACTION_WHITELIST[type], `缺少必要的危险操作: ${type}`).toBeDefined();
        expect(ACTION_WHITELIST[type].dangerous, `${type} 应为 dangerous=true`).toBe(true);
      }
    });
  });

  // ─── 2. 核心 action 类型存在 ───────────────────────────────────────────────

  describe('核心 action 类型存在', () => {
    const CORE_ACTIONS = [
      'dispatch_task',
      'create_task',
      'create_learning',
      'notify_user',
      'no_action',
      'handle_chat',
    ];

    for (const actionType of CORE_ACTIONS) {
      it(`包含核心 action: ${actionType}`, () => {
        expect(ACTION_WHITELIST[actionType], `缺少核心 action: ${actionType}`).toBeDefined();
      });
    }
  });

  // ─── 3. validateDecision 验证链 ───────────────────────────────────────────

  describe('validateDecision 验证链', () => {
    it('有效 action 通过验证', () => {
      const decision = {
        level: 1,
        rationale: '正常操作',
        confidence: 0.9,
        safety: true,
        actions: [{ type: 'notify_user', message: '测试通知' }],
      };

      const result = validateDecision(decision);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('无效 action 类型被拒绝', () => {
      const decision = {
        level: 1,
        rationale: '测试',
        confidence: 0.5,
        safety: true,
        actions: [{ type: 'INVALID_ACTION_TYPE_XYZ' }],
      };

      const result = validateDecision(decision);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('不在白名单内');
    });

    it('缺少 type 字段的 action 被拒绝', () => {
      const decision = {
        level: 1,
        rationale: '测试',
        confidence: 0.5,
        safety: true,
        actions: [{ message: '没有 type 字段' }],
      };

      const result = validateDecision(decision);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('type'))).toBe(true);
    });

    it('混合有效/无效 action 时整体 valid=false', () => {
      const decision = {
        level: 1,
        rationale: '测试',
        confidence: 0.5,
        safety: true,
        actions: [
          { type: 'notify_user', message: '有效 action' },
          { type: 'HACK_SYSTEM' },
        ],
      };

      const result = validateDecision(decision);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('空 actions 数组通过验证', () => {
      const decision = {
        level: 0,
        rationale: '无需操作',
        confidence: 1.0,
        safety: true,
        actions: [],
      };

      const result = validateDecision(decision);

      expect(result.valid).toBe(true);
    });

    it('多个有效 action 通过验证', () => {
      const decision = {
        level: 1,
        rationale: '批量操作',
        confidence: 0.8,
        safety: true,
        actions: [
          { type: 'notify_user', message: '通知' },
          { type: 'log_event', event: '记录' },
          { type: 'no_action' },
        ],
      };

      const result = validateDecision(decision);

      expect(result.valid).toBe(true);
    });
  });

  // ─── 4. 无效 action 类型识别 ───────────────────────────────────────────────

  describe('无效 action 类型直接检测', () => {
    const INVALID_ACTIONS = [
      'UNKNOWN_ACTION',
      'hack_system',
      'DROP_TABLE',
      'invalid_action_xyz',
    ];

    for (const invalidType of INVALID_ACTIONS) {
      it(`无效 action "${invalidType}" 不在 ACTION_WHITELIST 中`, () => {
        expect(ACTION_WHITELIST[invalidType]).toBeUndefined();
      });
    }
  });

  // ─── 5. ACTION_WHITELIST 版本稳定性（PRESERVE 快照）────────────────────────

  describe('ACTION_WHITELIST 版本稳定性', () => {
    it('ACTION_WHITELIST 至少有 20 个 action 类型（防止意外删除）', () => {
      const actionCount = Object.keys(ACTION_WHITELIST).length;
      expect(actionCount).toBeGreaterThanOrEqual(20);
    });

    it('safe/dangerous 分类比例合理（dangerous 不超过 40%）', () => {
      const total = Object.keys(ACTION_WHITELIST).length;
      const dangerousCount = Object.values(ACTION_WHITELIST).filter(c => c.dangerous).length;
      const ratio = dangerousCount / total;
      expect(ratio).toBeLessThan(0.4);
    });
  });
});
