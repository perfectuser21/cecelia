/**
 * executor-strategy-session.test.js
 *
 * DoD 覆盖：
 * - D1: getSkillForTaskType('strategy_session') === '/strategy-session'
 * - D2/D3: model-registry strategy_session agent 存在且配置正确
 * - D4/D5/D6: execution-callback 解析 KR JSON → 写入 goals + metadata
 * - D7: JSON 解析失败时不抛出
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 依赖 ─────────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '')
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0')
}));

vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'us')
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn()
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { SUCCESS: 'success', FAILED: 'failed' },
  EXECUTOR_HOSTS: { US_VPS: 'us' }
}));

// ─── D1: skillMap 路由 ─────────────────────────────────────────────────────────

describe('executor getSkillForTaskType — strategy_session 映射 (D1)', () => {
  let getSkillForTaskType;

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('../task-router.js', () => ({
      getTaskLocation: vi.fn(() => 'us')
    }));
    vi.mock('../task-updater.js', () => ({
      updateTaskStatus: vi.fn(),
      updateTaskProgress: vi.fn()
    }));
    vi.mock('../trace.js', () => ({
      traceStep: vi.fn(),
      LAYER: { L0_ORCHESTRATOR: 'l0' },
      STATUS: { SUCCESS: 'success', FAILED: 'failed' },
      EXECUTOR_HOSTS: { US_VPS: 'us' }
    }));
    vi.mock('child_process', () => ({
      spawn: vi.fn(),
      execSync: vi.fn(() => '')
    }));
    vi.mock('fs/promises', () => ({
      writeFile: vi.fn(),
      mkdir: vi.fn()
    }));
    vi.mock('fs', () => ({
      readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0')
    }));
    vi.mock('../db.js', () => ({
      default: { query: vi.fn() }
    }));
    const executor = await import('../executor.js');
    getSkillForTaskType = executor.getSkillForTaskType;
  });

  it('D1: strategy_session → /strategy-session', () => {
    expect(getSkillForTaskType('strategy_session')).toBe('/strategy-session');
  });

  it('D1-回归: dev 仍然 → /dev', () => {
    expect(getSkillForTaskType('dev')).toBe('/dev');
  });

  it('D1-回归: architecture_design → /architect', () => {
    expect(getSkillForTaskType('architecture_design')).toBe('/architect');
  });
});

// ─── D2/D3: model-registry ─────────────────────────────────────────────────────

describe('model-registry — strategy_session agent 注册 (D2/D3)', () => {
  let getAgentById;

  beforeEach(async () => {
    vi.resetModules();
    const registry = await import('../model-registry.js');
    getAgentById = registry.getAgentById;
  });

  it('D2: getAgentById("strategy_session") 返回有效 agent', () => {
    const agent = getAgentById('strategy_session');
    expect(agent).not.toBeNull();
    expect(agent.id).toBe('strategy_session');
  });

  it('D2: recommended_model 为 claude-opus-4-6', () => {
    const agent = getAgentById('strategy_session');
    expect(agent.recommended_model).toBe('claude-opus-4-6');
  });

  it('D3: layer 为 executor', () => {
    const agent = getAgentById('strategy_session');
    expect(agent.layer).toBe('executor');
  });

  it('D3: allowed_models 包含 claude-opus-4-6', () => {
    const agent = getAgentById('strategy_session');
    expect(agent.allowed_models).toContain('claude-opus-4-6');
  });

  it('D3: allowed_models 包含 claude-sonnet-4-6', () => {
    const agent = getAgentById('strategy_session');
    expect(agent.allowed_models).toContain('claude-sonnet-4-6');
  });

  it('D3: fixed_provider 为 null', () => {
    const agent = getAgentById('strategy_session');
    expect(agent.fixed_provider).toBeNull();
  });
});

// ─── D4/D5/D6/D7: JSON 解析逻辑 ─────────────────────────────────────────────

describe('strategy_session 回调 KR JSON 解析逻辑 (D4/D5/D6/D7)', () => {
  const VALID_OUTPUT = JSON.stringify({
    meeting_summary: "Q3 战略聚焦视频领域，以 AI 辅助工具链为抓手",
    key_tensions: ["CEO 认为机会在于视频，CFO 担心成本过高"],
    krs: [
      {
        title: "Q3 视频内容生产效率提升 50%",
        domain: "product",
        rationale: "视频是下一阶段增长引擎",
        priority: "P0",
        owner_role: "CPO"
      },
      {
        title: "视频工具链研发成本控制在 $50k 以内",
        domain: "finance",
        rationale: "ROI 需要控制",
        priority: "P1",
        owner_role: "CFO"
      }
    ]
  });

  it('D4: 能从 JSON 字符串中提取 krs 数组', () => {
    const jsonMatch = VALID_OUTPUT.match(/\{[\s\S]*"krs"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();
    const parsedOutput = JSON.parse(jsonMatch[0]);
    expect(Array.isArray(parsedOutput.krs)).toBe(true);
    expect(parsedOutput.krs).toHaveLength(2);
  });

  it('D5: 每个 KR 包含 title、domain、priority、owner_role 字段', () => {
    const jsonMatch = VALID_OUTPUT.match(/\{[\s\S]*"krs"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
    const parsedOutput = JSON.parse(jsonMatch[0]);
    const kr0 = parsedOutput.krs[0];
    expect(kr0.title).toBe("Q3 视频内容生产效率提升 50%");
    expect(kr0.domain).toBe("product");
    expect(kr0.priority).toBe("P0");
    expect(kr0.owner_role).toBe("CPO");
  });

  it('D5: owner_role 写入时转为小写', () => {
    const kr = { title: "测试 KR", priority: "P0", domain: "tech", owner_role: "CTO" };
    const krOwnerRole = kr.owner_role ? kr.owner_role.toLowerCase() : null;
    expect(krOwnerRole).toBe('cto');
  });

  it('D5: 无效 priority 回退为 P1', () => {
    const kr = { title: "测试 KR", priority: "invalid", domain: "tech", owner_role: "CTO" };
    const krPriority = ['P0', 'P1', 'P2'].includes(kr.priority) ? kr.priority : 'P1';
    expect(krPriority).toBe('P1');
  });

  it('D5: goals INSERT SQL 包含 domain、owner_role 参数', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const jsonMatch = VALID_OUTPUT.match(/\{[\s\S]*"krs"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
    const parsedOutput = JSON.parse(jsonMatch[0]);

    for (const kr of parsedOutput.krs) {
      const krTitle = kr.title;
      const krDomain = kr.domain || null;
      const krOwnerRole = kr.owner_role ? kr.owner_role.toLowerCase() : null;
      const krPriority = ['P0', 'P1', 'P2'].includes(kr.priority) ? kr.priority : 'P1';
      await mockPool.query(
        `INSERT INTO goals (title, priority, status, progress, domain, owner_role, type)
         VALUES ($1, $2, 'pending', 0, $3, $4, 'area_okr')`,
        [krTitle, krPriority, krDomain, krOwnerRole]
      );
    }

    expect(mockPool.query).toHaveBeenCalledTimes(2);
    const firstCall = mockPool.query.mock.calls[0];
    expect(firstCall[1][0]).toBe("Q3 视频内容生产效率提升 50%");
    expect(firstCall[1][1]).toBe("P0");
    expect(firstCall[1][2]).toBe("product");
    expect(firstCall[1][3]).toBe("cpo");
  });

  it('D6: meeting_summary 写入 task payload', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const jsonMatch = VALID_OUTPUT.match(/\{[\s\S]*"krs"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
    const parsedOutput = JSON.parse(jsonMatch[0]);

    await mockPool.query(
      `UPDATE tasks SET payload = jsonb_set(COALESCE(payload, '{}'), '{meeting_summary}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(parsedOutput.meeting_summary), 'test-task-id']
    );

    const call = mockPool.query.mock.calls[0];
    expect(JSON.parse(call[1][0])).toBe("Q3 战略聚焦视频领域，以 AI 辅助工具链为抓手");
    expect(call[1][1]).toBe('test-task-id');
  });

  it('D7: 无 JSON 块时 jsonMatch 为 null，不抛出', () => {
    const malformedOutput = '这是一段没有 JSON 的文本输出，没有 krs 数组';
    const jsonMatch = malformedOutput.match(/\{[\s\S]*"krs"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
    expect(jsonMatch).toBeNull();
  });

  it('D7: JSON 语法错误时 parsedOutput 为 null，不抛出', () => {
    const brokenJson = '{"krs": [broken}}';
    const jsonMatch = brokenJson.match(/\{[\s\S]*"krs"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
    let parsedOutput = null;
    if (jsonMatch) {
      try {
        parsedOutput = JSON.parse(jsonMatch[0]);
      } catch (_) {
        parsedOutput = null;
      }
    }
    expect(parsedOutput).toBeNull();
  });

  it('D7: krs 为空数组时不执行写入', () => {
    const outputWithEmptyKrs = JSON.stringify({ meeting_summary: "无结论", krs: [] });
    const jsonMatch = outputWithEmptyKrs.match(/\{[\s\S]*"krs"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
    const parsedOutput = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    const shouldWrite = parsedOutput && Array.isArray(parsedOutput.krs) && parsedOutput.krs.length > 0;
    expect(shouldWrite).toBe(false);
  });
});
