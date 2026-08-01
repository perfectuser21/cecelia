import { describe, it, expect, vi } from 'vitest';
import { runMechanicalGate, runJudgeGate } from '../harness-judge.js';

// evaluator 1.23.0 E1 schema：exit_code/log_tail 是 behavior_tests 条目级字段，
// .brain-result.json 顶层只有 {verdict, task_id, failed_step, log_excerpt}。
function goodCtx(overrides = {}) {
  return {
    taskId: 'task-1111',
    worktreePath: '/wt',
    sprintDir: 'sprints/x',
    brainResult: {
      verdict: 'PASS',
      behavior_tests: [{ command: 'npm test', exit_code: 0, log_tail: 'ok' }],
      judgments_written: 2,
      ...(overrides.brainResult || {}),
    },
    ...overrides,
  };
}

function makeDeps({ testFiles = ['a.test.ts'], behaviorCount = 3, env = 'local_api', judgmentRows = 2 } = {}) {
  return {
    listTestFilesFn: vi.fn(async () => testFiles),
    readFileFn: vi.fn(async (p) => {
      if (String(p).includes('contract-dod')) return Array(behaviorCount).fill('- [ ] [BEHAVIOR] x').join('\n');
      throw new Error('ENOENT');
    }),
    dbPool: { query: vi.fn(async (sql) => {
      if (/FROM tasks/.test(sql)) return { rows: [{ target_environment: env }] };
      if (/COUNT.*FROM decisions/is.test(sql)) return { rows: [{ count: judgmentRows }] };
      return { rows: [] };
    }) },
  };
}

describe('runMechanicalGate（刀B：DeepSeek 前纯代码闸）', () => {
  it('全部合规 → pass:true', async () => {
    const r = await runMechanicalGate(goodCtx(), makeDeps());
    expect(r.pass).toBe(true);
  });
  it('behavior_tests 声明缺失/空数组 → FAIL 理由含 behavior_tests', async () => {
    const ctx = goodCtx({ brainResult: { behavior_tests: [] } });
    const r = await runMechanicalGate(ctx, makeDeps());
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/behavior_tests/);
  });
  it('behavior_tests 条目缺 exit_code → FAIL 理由含 exit_code', async () => {
    const ctx = goodCtx({ brainResult: { behavior_tests: [{ command: 'x', log_tail: 'ok' }] } });
    const r = await runMechanicalGate(ctx, makeDeps());
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/exit_code/);
  });
  it('local_api 环境条目 log_tail 空但有命令输出（agentStdout）→ 不误杀', async () => {
    const ctx = goodCtx({
      brainResult: { behavior_tests: [{ command: 'x', exit_code: 0, log_tail: '' }] },
      agentStdout: '$ npm test\nall pass',
    });
    const r = await runMechanicalGate(ctx, makeDeps({ env: 'local_api' }));
    expect(r.pass).toBe(true);
  });
  it('windows_wechat 真机环境条目 log_tail 空 → FAIL', async () => {
    const ctx = goodCtx({
      brainResult: { behavior_tests: [{ command: 'x', exit_code: 0, log_tail: '' }] },
      agentStdout: 'x',
    });
    const r = await runMechanicalGate(ctx, makeDeps({ env: 'windows_wechat' }));
    expect(r.pass).toBe(false);
  });
  it('sprint 无测试文件且 contract-dod 无 [BEHAVIOR] → FAIL 理由含 contract_tests', async () => {
    const deps = makeDeps({ testFiles: [] });
    deps.readFileFn = vi.fn(async () => { throw new Error('ENOENT'); });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/contract_tests/);
  });
  it('kernel contract-draft 含 [BEHAVIOR] 时不因缺 contract-dod 误判 contract_tests=0', async () => {
    const deps = makeDeps({ testFiles: [] });
    deps.readFileFn = vi.fn(async (p) => {
      if (String(p).includes('contract-dod')) throw new Error('ENOENT');
      if (String(p).includes('contract-draft')) return '- [ ] [BEHAVIOR] manual:bash npm test';
      throw new Error('ENOENT');
    });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(true);
    expect(r.reasons.join()).not.toMatch(/contract_tests/);
  });
  it('Fleet bundle 无宿主路径但锁版本内嵌合同有 [BEHAVIOR] 时不误判 contract_tests=0', async () => {
    const deps = makeDeps({ testFiles: [] });
    deps.readFileFn = vi.fn(async () => { throw new Error('ENOENT'); });
    const ctx = goodCtx({
      worktreePath: undefined,
      contractText: '- [ ] [BEHAVIOR] [L3] Android 真机安全退出 [接缝×2]',
    });

    const r = await runMechanicalGate(ctx, deps);

    expect(r.pass).toBe(true);
    expect(r.reasons.join()).not.toMatch(/contract_tests/);
  });
  it('contract-draft 只有 [BEHAVIOR] 章节标题时仍判 contract_tests=0', async () => {
    const deps = makeDeps({ testFiles: [] });
    deps.readFileFn = vi.fn(async (p) => {
      if (String(p).includes('contract-dod')) throw new Error('ENOENT');
      if (String(p).includes('contract-draft')) return '## [BEHAVIOR]\n\n在这里填写行为断言。';
      throw new Error('ENOENT');
    });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/contract_tests/);
  });
  it('contract-draft 只有空的 [BEHAVIOR] 列表项时仍判 contract_tests=0', async () => {
    const deps = makeDeps({ testFiles: [] });
    deps.readFileFn = vi.fn(async (p) => {
      if (String(p).includes('contract-dod')) throw new Error('ENOENT');
      if (String(p).includes('contract-draft')) return '- [BEHAVIOR]';
      throw new Error('ENOENT');
    });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/contract_tests/);
  });
  it('judgments_written=5 声明 > decisions 回读 0 → FAIL', async () => {
    const ctx = goodCtx(); ctx.brainResult.judgments_written = 5;
    const r = await runMechanicalGate(ctx, makeDeps({ judgmentRows: 0 }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/judgments/);
  });
  it('judgments_written 非数字声明（如 "abc"）→ FAIL 不静默放行', async () => {
    const ctx = goodCtx(); ctx.brainResult.judgments_written = 'abc';
    const r = await runMechanicalGate(ctx, makeDeps({ judgmentRows: 0 }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/judgments/);
  });
  it('无 judgments_written 声明 → 跳过不 FAIL', async () => {
    const ctx = goodCtx(); delete ctx.brainResult.judgments_written;
    const r = await runMechanicalGate(ctx, makeDeps({ judgmentRows: 0 }));
    expect(r.pass).toBe(true);
  });
  it('target_environment 查不到 → 缺省 local_api 最宽口径', async () => {
    const deps = makeDeps();
    deps.dbPool.query = vi.fn(async (sql) => {
      if (/FROM tasks/.test(sql)) return { rows: [] };
      if (/COUNT.*FROM decisions/is.test(sql)) return { rows: [{ count: 2 }] };
      return { rows: [] };
    });
    const ctx = goodCtx({
      brainResult: { behavior_tests: [{ command: 'x', exit_code: 0, log_tail: '' }], judgments_written: 2 },
      agentStdout: 'cmd out',
    });
    const r = await runMechanicalGate(ctx, deps);
    expect(r.pass).toBe(true);
  });
});

describe('runMechanicalGate — GP-Anchor 一致性核查（刀4，file-existence gated）', () => {
  const PRODUCT_MAP_JSON = JSON.stringify({
    golden_paths: [
      { id: 'customer_smart_acquisition', line_id: 'line02', status: 'active' },
      { id: 'gp_anchor_enforcement', line_id: 'line00', status: 'proposed' },
    ],
  });

  function makeAnchorDeps({ productMap = PRODUCT_MAP_JSON, contractDraft = null, behaviorCount = 3 } = {}) {
    return {
      listTestFilesFn: vi.fn(async () => ['a.test.ts']),
      readFileFn: vi.fn(async (p) => {
        if (String(p).includes('product-map/generated/product-map.json')) {
          if (productMap === null) throw new Error('ENOENT');
          return productMap;
        }
        if (String(p).includes('contract-draft')) {
          if (contractDraft === null) throw new Error('ENOENT');
          return contractDraft;
        }
        if (String(p).includes('contract-dod')) return Array(behaviorCount).fill('- [ ] [BEHAVIOR] x').join('\n');
        throw new Error('ENOENT');
      }),
      dbPool: { query: vi.fn(async (sql) => {
        if (/FROM tasks/.test(sql)) return { rows: [{ target_environment: 'local_api' }] };
        if (/COUNT.*FROM decisions/is.test(sql)) return { rows: [{ count: 2 }] };
        return { rows: [] };
      }) },
    };
  }

  it('product-map.json 不存在（非zenithjoy项目）→ 完全跳过，不新增任何 gp_anchor 相关 FAIL', async () => {
    const r = await runMechanicalGate(goodCtx(), makeAnchorDeps({ productMap: null, contractDraft: null }));
    expect(r.pass).toBe(true);
    expect(r.reasons.join()).not.toMatch(/gp_anchor/);
  });

  it('product-map.json 存在但 contract-draft.md 既无 GP-Anchor 段也无 skipped 声明 → FAIL', async () => {
    const deps = makeAnchorDeps({ contractDraft: '## Golden Path\n无关内容，没有GP-Anchor段。' });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/gp_anchor_missing/);
  });

  it('contract 声明 gp-anchor: skipped → 不 FAIL', async () => {
    const deps = makeAnchorDeps({ contractDraft: 'gp-anchor: skipped (product-map.json not found)' });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(true);
  });

  it('contract 声明推进 GP-Anchor 且 id 在 product-map.json 里真实存在 → 不 FAIL', async () => {
    const deps = makeAnchorDeps({ contractDraft: '## GP-Anchor\n\nGP-Anchor: line02/customer_smart_acquisition#step7' });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(true);
  });

  it('contract 声明推进 GP-Anchor 但 id 在 product-map.json 里查无 → FAIL', async () => {
    const deps = makeAnchorDeps({ contractDraft: '## GP-Anchor\n\nGP-Anchor: line99/nonexistent_gp#step1' });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/gp_anchor_id_notfound/);
  });

  it('contract 声明 keep-green 且 id 存在 → 不 FAIL（不查 diff，只查存在性）', async () => {
    const deps = makeAnchorDeps({ contractDraft: '## GP-Anchor\n\nGP-Anchor: line00/gp_anchor_enforcement keep-green' });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(true);
  });

  it('contract 声明 none(docs) → 不 FAIL', async () => {
    const deps = makeAnchorDeps({ contractDraft: '## GP-Anchor\n\nGP-Anchor: none(docs)' });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(true);
  });

  it('contract 声明格式不合法（既非三形态之一）→ FAIL', async () => {
    const deps = makeAnchorDeps({ contractDraft: '## GP-Anchor\n\nGP-Anchor: 这不是合法格式' });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/gp_anchor_format_invalid/);
  });
});

describe('runJudgeGate 接线：机械闸 FAIL → 不调 DeepSeek', () => {
  it('contract_tests=0 时 judgeFn 零调用且 verdict=FAIL judged=true', async () => {
    const judgeFn = vi.fn();
    const compliantBR = { verdict: 'PASS', behavior_tests: [{ command: 'npm test', exit_code: 0, log_tail: 'ok' }] };
    const r = await runJudgeGate(
      { agentVerdict: 'PASS', worktreePath: '/wt', sprintDir: 'sprints/x', taskId: 't1', brainResult: compliantBR },
      {
        judgeFn,
        listTestFilesFn: async () => [],
        collectEvidence: async () => ({ contractE2E: 'e2e', goldenPathSteps: ['s1'], transcript: '', agentStdout: '', brainResult: compliantBR }),
        readFileFn: async () => { throw new Error('ENOENT'); },
        dbPool: { query: async () => ({ rows: [] }) },
        writeFileFn: async () => {},
      }
    );
    expect(r.verdict).toBe('FAIL');
    expect(r.judged).toBe(true);
    expect(judgeFn).not.toHaveBeenCalled();
  });
  it('agentVerdict=FAIL 直接透传（机械闸只管 PASS 复核路径）', async () => {
    const r = await runJudgeGate({ agentVerdict: 'FAIL', agentFeedback: 'x' }, {});
    expect(r.verdict).toBe('FAIL');
    expect(r.judged).toBe(false);
  });
});
