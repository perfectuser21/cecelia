import { describe, expect, it, vi } from 'vitest';

import { createAttemptStore } from '../attempt-store.js';
import { ATTEMPT_COST_ACCRUAL_USD } from '../constants.js';

const input = {
  id: '22222222-2222-4222-8222-222222222222',
  runId: '11111111-1111-4111-8111-111111111111',
  hop: 3,
  phase: 'B_contract',
  role: 'reviewer',
  provider: 'auto',
  accountId: null,
  machineId: 'worker-1',
  callbackSecretHash: 'b'.repeat(64),
  bundle: {
    skill: {
      name: 'harness-contract-reviewer',
      version: '9.16.0',
      digest: `sha256:${'a'.repeat(64)}`,
    },
  },
};

function poolWith(...results) {
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? { rows: [], rowCount: 0 })),
  };
}

describe('attempt store', () => {
  it('首次终态 callback 在同事务内向 run 累加固定记账单价', async () => {
    const callbackResult = {
      status: 'completed',
      summary: 'ok',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})                                  // BEGIN
        .mockResolvedValueOnce({ rows: [running] })                 // 锁 + 加载
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })  // attempt 终态 UPDATE
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 }) // 通用 decision log
        .mockResolvedValue({}),                                     // 其余（投影/累加/COMMIT）
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    const accrual = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /cost_usd\s*=\s*COALESCE\(cost_usd,\s*0\)\s*\+/.test(sql),
    );
    expect(accrual).toBeDefined();
    expect(accrual[1]).toEqual([input.runId, ATTEMPT_COST_ACCRUAL_USD]);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('R8/R12: callback terminal write and one standard event share a transaction', async () => {
    const callbackResult = {
      status: 'blocked',
      summary: 'fleet transport unavailable',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      failure_class: 'infrastructure_blocked',
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'generate',
      role: 'generator',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      result: null,
    };
    const completed = { ...running, status: 'blocked', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(),
      connect: vi.fn(async () => client),
    };

    await expect(createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    })).resolves.toMatchObject({ attempt: completed, deduped: false });

    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toMatch(
      /WITH decision_lock AS MATERIALIZED[\s\S]*pg_advisory_xact_lock[\s\S]*locked_run AS MATERIALIZED[\s\S]*JOIN initiative_runs run[\s\S]*FOR UPDATE OF run[\s\S]*JOIN harness_attempts attempt[\s\S]*FOR UPDATE OF attempt/i,
    );
    expect(client.query.mock.calls[2][0]).toMatch(
      /lease_generation.*status NOT IN/is,
    );
    expect(client.query.mock.calls[3][0]).toMatch(
      /verdict:attempt_callback/i,
    );
    expect(JSON.parse(client.query.mock.calls[3][1][4])).toMatchObject({
      run_id: input.runId,
      attempt_id: input.id,
      lease_generation: 3,
      role: 'generator',
      status: 'blocked',
      artifacts: [],
    });
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('可信 receipt 投影失败时回滚 Attempt 终态与 callback event', async () => {
    const callbackResult = {
      status: 'completed',
      summary: 'ok',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'evaluate',
      role: 'evaluator',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return {};
        if (String(sql).includes('WITH decision_lock AS MATERIALIZED')) {
          return { rows: [running] };
        }
        if (String(sql).includes('UPDATE harness_attempts')) {
          return { rows: [completed], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };
    const beforeCommit = vi.fn(async () => {
      throw new Error('receipt insert failed');
    });

    await expect(createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
      beforeCommit,
    })).rejects.toThrow('receipt insert failed');

    expect(beforeCommit).toHaveBeenCalledOnce();
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
  });

  it('rejects an active callback after its exact parent run is terminal', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [{
            id: input.id,
            run_id: input.runId,
            status: 'running',
            lease_owner: 'brain-1',
            lease_generation: 3,
            run_phase: 'failed',
          }],
        })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await expect(createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: {
        status: 'completed',
        summary: 'late callback',
        artifacts: [],
        provider_metadata: { provider: 'codex' },
      },
    })).resolves.toMatchObject({
      attempt: null,
      deduped: false,
      conflict: 'parent_run_terminal',
    });

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/WITH decision_lock AS MATERIALIZED/i),
      'ROLLBACK',
    ]);
  });

  it('commits reviewer verdict in the same transaction as its successful callback', async () => {
    const callbackResult = {
      status: 'completed',
      summary: 'contract approved',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: { outcome: 'APPROVED', reason: 'contract covers the PRD' },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: {
        inputs: { contract_round: 2, contract_sha: 'a'.repeat(40) },
      },
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    expect(client.query.mock.calls[3][0]).toMatch(/verdict:attempt_callback/i);
    expect(client.query.mock.calls[4][0]).toMatch(/action=\$5/i);
    expect(client.query.mock.calls[4][1]).toContain('verdict:reviewer');
    expect(client.query.mock.calls[4][1].join(' ')).toContain('a'.repeat(40));
    // 即使没有结构化 case_file/rubric_scores，reviewer 的每轮终态也落一行
    // gan_case_file（blockers 默认 []，rubric_scores/feedback_md 为 null），
    // 案卷视图从一开始就有完整的轮次台账。
    expect(client.query.mock.calls[5][0]).toMatch(/INSERT INTO gan_case_file/);
    expect(client.query.mock.calls[5][1]).toEqual([
      input.runId,
      2,
      'reviewer',
      input.id,
      'a'.repeat(40),
      null,
      '[]',
      null,
    ]);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('reviewer 终态携带结构化 case_file 时把 rubric_scores/blockers/feedback_md 写进案卷行', async () => {
    const callbackResult = {
      status: 'completed_with_concerns',
      summary: 'contract mostly covers the PRD',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: {
        outcome: 'REVISION_REQUESTED',
        reason: 'one blocker open',
        rubric_scores: { correctness: 8, coverage: 6 },
      },
      case_file: {
        blockers: [{ id: 'R2-1', dimension: 'coverage', status: 'open' }],
        feedback_md: '# Round 2\n\nR2-1 still open.',
      },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: {
        inputs: { contract_round: 2, contract_sha: 'a'.repeat(40) },
      },
      result: null,
    };
    const completed = { ...running, status: 'completed_with_concerns', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    expect(client.query.mock.calls[5][0]).toMatch(/INSERT INTO gan_case_file/);
    const [, params] = client.query.mock.calls[5];
    expect(params[0]).toBe(input.runId);
    expect(params[1]).toBe(2);
    expect(params[2]).toBe('reviewer');
    expect(params[3]).toBe(input.id);
    expect(params[4]).toBe('a'.repeat(40));
    expect(JSON.parse(params[5])).toEqual({ correctness: 8, coverage: 6 });
    expect(JSON.parse(params[6])).toEqual([
      { id: 'R2-1', dimension: 'coverage', status: 'open' },
    ]);
    // P2-4 复审修正：feedback_md 落库前只过 redactSecrets（secret 脱敏），
    // 不折行不截断——完整反馈原文（含 markdown 换行）原样保留。
    expect(params[7]).toBe('# Round 2\n\nR2-1 still open.');
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('proposer 终态案卷行的 round 取 bundle.inputs.contract_round（proposer 推的下一轮）', async () => {
    const callbackResult = {
      status: 'completed',
      summary: 'contract revised',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: null,
      case_file: {
        blockers: [{ id: 'R2-1', closure: 'added the missing edge-case test' }],
        feedback_md: '# Round 3 proposal\n\nclosed R2-1.',
      },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'proposer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: {
        inputs: { contract_round: 3 },
      },
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    // proposer 不是 reviewer/evaluator，callbackRoleVerdictProjection 不产生
    // 第二条 decision_log 投影，案卷写入紧跟通用 callback 事件行之后。
    expect(client.query.mock.calls[4][0]).toMatch(/INSERT INTO gan_case_file/);
    const [, params] = client.query.mock.calls[4];
    expect(params[0]).toBe(input.runId);
    expect(params[1]).toBe(3);
    expect(params[2]).toBe('proposer');
    expect(params[4]).toBeNull();
    expect(JSON.parse(params[6])).toEqual([
      { id: 'R2-1', closure: 'added the missing edge-case test' },
    ]);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('bundle 与 result 都没有可用轮次时跳过案卷写入，不报错也不写残缺行', async () => {
    const callbackResult = {
      status: 'completed',
      summary: 'contract revised',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: null,
      case_file: { blockers: [] },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'proposer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: { inputs: {} },
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    expect(client.query.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO gan_case_file'),
    )).toBe(false);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('reviewer 终态既无 case_file 也无 decision 时不写案卷行', async () => {
    const callbackResult = {
      status: 'needs_context',
      summary: 'need product clarification',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: null,
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: { inputs: { contract_round: 2 } },
      result: null,
    };
    const completed = { ...running, status: 'needs_context', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    expect(client.query.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO gan_case_file'),
    )).toBe(false);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('provider 输出 case_file:null / rubric_scores:null 时回调必须被接受（strict schema 要求声明即必填，非 GAN 角色只能填 null）', async () => {
    // r38 实证回归：runner schema 把 case_file 列进 required 后，codex 对非 GAN
    // 角色输出 "case_file":null。Brain 侧若用 zod .optional()（只放行 undefined、
    // 拒绝 null）会整条回调 400——容器正常干完活、结果却丢失，attempt 永远卡
    // running 直到租约过期。必须用 .nullish() 同时放行 null 与 undefined。
    const { parseHarnessResult } = await import('../execution-contract.js');
    const base = {
      contract_version: '1.0',
      attempt_id: '22222222-2222-4222-8222-222222222222',
      status: 'completed',
      summary: 'planner done',
      artifacts: [],
      checks: [],
      error: null,
      provider_metadata: { provider: 'codex' },
    };
    expect(() => parseHarnessResult({
      ...base,
      decision: { outcome: 'PASS', reason: 'ok', rubric_scores: null },
      case_file: null,
    })).not.toThrow();
  });

  it('callback 决策行 detail 必须带 error_code(合同故障重开 GAN 的路由信号,r40 实证缺口)', async () => {
    // r40 实证:generator 报 CONTRACT_SELF_CONTRADICTION,但 callback 决策行 detail
    // 没有 error 字段 → derive 只能按笼统 semantic_refusal 转人工,无法识别
    // "根因在合同资产"而自动退回 GAN。error.code 必须进投影。
    const callbackResult = {
      status: 'blocked',
      summary: 'contract fault',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: { outcome: 'BLOCKED', reason: 'contract self contradiction' },
      failure_class: 'semantic_refusal',
      error: { code: 'CONTRACT_SELF_CONTRADICTION', message: 'final-E2E 在合同内且无法修复' },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'generate',
      role: 'generator',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: { inputs: {} },
      result: null,
    };
    const completed = { ...running, status: 'blocked', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    const logInsert = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('orchestrator_decision_log'),
    );
    expect(logInsert, '应有决策日志 INSERT').toBeTruthy();
    const detailParam = (logInsert[1] ?? []).find(
      (v) => typeof v === 'string' && v.includes('CONTRACT_SELF_CONTRADICTION'),
    );
    expect(detailParam, 'callback 决策行 detail 必须含 error_code=CONTRACT_SELF_CONTRADICTION').toBeTruthy();
    expect(JSON.parse(detailParam).error_code).toBe('CONTRACT_SELF_CONTRADICTION');
  });

  it('哨兵：GAN 权威终态落空壳案卷（blockers 空 + feedback_md 空 + rubric 空）必须告警，不许静默（r36 实证）', async () => {
    // r36 事故：runner schema 禁掉 case_file/rubric_scores → 案卷连写 14 行空壳
    // → 每轮 reviewer 零记忆重审 → 打地鼠不收敛，全程零报错零日志。案卷是收敛
    // 机制的命脉，写空壳必须在日志里喊出来，否则下次断链还是要靠人肉验尸才发现。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const callbackResult = {
        status: 'completed',
        summary: 'reviewed',
        artifacts: [],
        provider_metadata: { provider: 'codex' },
        decision: { outcome: 'REVISION', reason: 'scores below threshold' },
        // case_file 缺失 —— 正是被 runner schema 禁掉时的真实形状
      };
      const running = {
        id: input.id,
        run_id: input.runId,
        hop: input.hop,
        phase: 'gan',
        role: 'reviewer',
        status: 'running',
        lease_owner: 'brain-1',
        lease_generation: 3,
        task_bundle: { inputs: { contract_round: 2 } },
        result: null,
      };
      const completed = { ...running, status: 'completed', result: callbackResult };
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({ rows: [running] })
          .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
          .mockResolvedValue({}),
        release: vi.fn(),
      };
      const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

      await createAttemptStore(pool).recordCallbackTerminal({
        attemptId: input.id,
        runId: input.runId,
        leaseOwner: 'brain-1',
        leaseGeneration: 3,
        result: callbackResult,
      });

      const warned = warn.mock.calls.some(([msg]) => (
        typeof msg === 'string' && msg.includes('case_file_empty')
      ));
      expect(warned, '空壳案卷必须 console.warn 含 case_file_empty 标记').toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('P1：failed 状态即使带 decision 也不落案卷行（终态白名单收紧，防止占位）', async () => {
    const callbackResult = {
      status: 'failed',
      summary: 'infra crash before verdict',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: { outcome: 'REVISION_REQUESTED', reason: 'never actually reviewed' },
      error: { code: 'provider_exit', message: 'boom' },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: { inputs: { contract_round: 2 } },
      result: null,
    };
    const failed = { ...running, status: 'failed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [failed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    expect(client.query.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO gan_case_file'),
    )).toBe(false);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('P1：blocked 状态即使带 decision + case_file 也不落案卷行', async () => {
    const callbackResult = {
      status: 'blocked',
      summary: 'contract forbids this action',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: { outcome: 'REVISION_REQUESTED', reason: 'blocked mid-review' },
      case_file: { blockers: [{ id: 'R2-1', status: 'open' }], feedback_md: 'partial notes' },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: { inputs: { contract_round: 2 } },
      result: null,
    };
    const blocked = { ...running, status: 'blocked', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [blocked], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    expect(client.query.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO gan_case_file'),
    )).toBe(false);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('P2-2：bundle 缺 contract_round 时退化读 decision.contract_round（真正被使用的兜底路径）', async () => {
    const callbackResult = {
      status: 'completed',
      summary: 'contract approved',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: { outcome: 'APPROVED', reason: 'ok', contract_round: 4 },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      // 有意不带 contract_round：证明主来源缺失时兜底真的生效，不是死码。
      task_bundle: { inputs: {} },
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    const insertCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO gan_case_file'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][1]).toBe(4);
  });

  it('P2-4：feedback_md/blockers 里的 secret 落库前过 redactSecrets 净化（Bearer token 被 REDACT）', async () => {
    const callbackResult = {
      status: 'completed',
      summary: 'contract approved',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: { outcome: 'APPROVED', reason: 'ok' },
      case_file: {
        blockers: [{ id: 'R2-1', detail: 'saw Bearer sk-secret-123 in logs', status: 'open' }],
        feedback_md: 'leaked Bearer sk-secret-456 in the diff',
      },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: { inputs: { contract_round: 2 } },
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    const insertCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO gan_case_file'),
    );
    const [, params] = insertCall;
    expect(params[6]).not.toContain('sk-secret-123');
    expect(params[6]).toContain('Bearer [REDACTED]');
    expect(params[7]).not.toContain('sk-secret-456');
    expect(params[7]).toContain('Bearer [REDACTED]');
  });

  it('P2-4 复审回归：5KB 带换行的 feedback_md 落库后不折行不砍 2000（完整反馈原文不变量），Bearer 已 REDACT', async () => {
    const paragraph = 'This paragraph documents one blocker in enough prose detail to '
      + 'pad the payload out to several kilobytes of realistic review feedback text, '
      + 'proving the sanitizer no longer truncates it down to two thousand characters '
      + 'like the old shared diagnostic sanitizer used to before the P2-4 fix.';
    const bodyLines = Array.from({ length: 30 }, (_, i) => `## Blocker note ${i}\n\n${paragraph}`);
    const feedbackMd = `# Round 2 review\n\n${bodyLines.join('\n\n')}\n\n`
      + 'Bearer sk-secret-789 was left in the diff.';
    expect(Buffer.byteLength(feedbackMd)).toBeGreaterThan(5 * 1024);

    const callbackResult = {
      status: 'completed',
      summary: 'contract approved with a long review',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: { outcome: 'APPROVED', reason: 'ok' },
      case_file: { blockers: [], feedback_md: feedbackMd },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: { inputs: { contract_round: 2 } },
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    const insertCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO gan_case_file'),
    );
    const [, params] = insertCall;
    const expectedStored = feedbackMd.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
    // 唯一的差异只是 Bearer token 被替换成占位符，其余原文（含全部换行、
    // 全部长度）逐字保留——不是砍到 2000、也不是折成一行。
    expect(params[7]).toBe(expectedStored);
    expect(params[7].length).toBeGreaterThan(2000);
    expect((params[7].match(/\n/g) ?? []).length).toBe((feedbackMd.match(/\n/g) ?? []).length);
    expect(params[7]).not.toContain('sk-secret-789');
    expect(params[7]).toContain('Bearer [REDACTED]');
  });

  it('P3-5：rubric_scores 非数值项落库前被过滤，只留 number 项', async () => {
    const callbackResult = {
      status: 'completed',
      summary: 'contract approved with mixed rubric shapes',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: {
        outcome: 'APPROVED',
        reason: 'ok',
        rubric_scores: { correctness: 8, coverage: 'n/a', clarity: null, safety: 7 },
      },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: { inputs: { contract_round: 2 } },
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    const insertCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO gan_case_file'),
    );
    const [, params] = insertCall;
    expect(JSON.parse(params[5])).toEqual({ correctness: 8, safety: 7 });
  });

  it('projects evaluator PASS_WITH_CONCERNS as PASS while preserving the concerns terminal', async () => {
    const callbackResult = {
      status: 'completed_with_concerns',
      summary: 'verified evidence; continue Judge and review gates',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: {
        outcome: 'PASS_WITH_CONCERNS',
        reason: 'three environment-only checks remain visible as concerns',
      },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'evaluate',
      role: 'evaluator',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      task_bundle: { inputs: { pull_request: { head_sha: 'a'.repeat(40) } } },
      result: null,
    };
    const completed = {
      ...running,
      status: 'completed_with_concerns',
      result: callbackResult,
    };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    const outcome = await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    expect(outcome.attempt.status).toBe('completed_with_concerns');
    expect(client.query.mock.calls[3][1][3]).toBe('allow:concerns');
    expect(client.query.mock.calls[4][1][3]).toBe('allow');
    expect(JSON.parse(client.query.mock.calls[4][1][5])).toMatchObject({
      verdict: 'PASS',
      pr_head_sha: 'a'.repeat(40),
      feedback: 'three environment-only checks remain visible as concerns',
    });
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('projects only a verified generator pull request before callback commit', async () => {
    const verifiedSha = 'b'.repeat(40);
    const callbackResult = {
      status: 'completed',
      summary: 'pull request opened',
      artifacts: [{
        type: 'pull_request',
        url: 'https://github.com/acme/repo/pull/42',
        head_sha: verifiedSha,
        verification_status: 'verified',
      }],
      provider_metadata: { provider: 'codex' },
      decision: null,
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'generate',
      role: 'generator',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: input.runId }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    expect(client.query.mock.calls[5][0]).toMatch(
      /UPDATE initiative_runs[\s\S]*pr_url=\$2/i,
    );
    expect(client.query.mock.calls[5][1]).toEqual([
      input.runId,
      'https://github.com/acme/repo/pull/42',
      ATTEMPT_COST_ACCRUAL_USD,
    ]);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('commits a verified generator-fix verdict and PR projection atomically', async () => {
    const verifiedSha = 'c'.repeat(40);
    const callbackResult = {
      status: 'completed',
      summary: 'fix pushed',
      artifacts: [{
        type: 'pull_request',
        url: 'https://github.com/acme/repo/pull/42',
        head_sha: verifiedSha,
        verification_status: 'verified',
      }],
      provider_metadata: { provider: 'codex' },
      decision: null,
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'generate',
      role: 'generator',
      provider: 'codex',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ trigger_sha: 'a'.repeat(40) }] })
        .mockResolvedValueOnce({ rows: [{ hop: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: input.runId }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    expect(client.query.mock.calls[5][0]).toMatch(/verdict:generator-fix-callback/i);
    expect(client.query.mock.calls[5][1].join(' ')).toContain(verifiedSha);
    expect(client.query.mock.calls[6][0]).toMatch(/UPDATE initiative_runs/i);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('an exact terminal retry never reprojects a PR into a now-terminal run', async () => {
    const callbackResult = {
      status: 'completed',
      summary: 'pull request opened',
      artifacts: [{
        type: 'pull_request',
        url: 'https://github.com/acme/repo/pull/42',
        head_sha: 'c'.repeat(40),
        verification_status: 'verified',
      }],
      provider_metadata: {
        provider: 'codex',
        server_callback_claim_digest: 'sha256:claim',
      },
      decision: null,
    };
    const terminal = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'generate',
      role: 'generator',
      status: 'completed',
      lease_owner: 'brain-1',
      lease_generation: 3,
      result: callbackResult,
    };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [terminal] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    const outcome = await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    expect(outcome).toMatchObject({ deduped: true });
    expect(client.query.mock.calls.some(([sql]) => /UPDATE initiative_runs/i.test(sql))).toBe(false);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  it('R11: stale callback generation rolls back without terminal or decision writes', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [{
            id: input.id,
            run_id: input.runId,
            status: 'running',
            lease_owner: 'brain-1',
            lease_generation: 4,
          }],
        })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await expect(createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: {
        status: 'completed',
        summary: 'stale',
        artifacts: [],
        provider_metadata: { provider: 'codex' },
      },
    })).resolves.toMatchObject({
      attempt: null,
      deduped: false,
      conflict: 'lease_generation_mismatch',
    });

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/FOR UPDATE/i),
      'ROLLBACK',
    ]);
  });

  it('按 run/hop 幂等创建 attempt，并持久化冻结 Skill 元数据', async () => {
    const pool = poolWith({
      rows: [{
        id: input.id,
        status: 'queued',
        local_container_naming: 'generation-v1',
      }],
      rowCount: 1,
    });
    const store = createAttemptStore(pool);

    const result = await store.createAttempt(input);

    expect(result.id).toBe(input.id);
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO harness_attempts/i);
    expect(sql).toMatch(/WITH guarded_run AS/i);
    expect(sql).toMatch(/FROM initiative_runs/i);
    expect(sql).toMatch(/phase NOT IN \('done','failed'\)/i);
    expect(sql).toMatch(/FOR KEY SHARE/i);
    expect(sql).not.toMatch(/INSERT INTO harness_run_events/i);
    expect(sql).toMatch(/ON CONFLICT \(run_id, hop\)/i);
    expect(sql).toMatch(/machine_id,\s*requested_machine_id/i);
    expect(sql).toMatch(/requested_machine_id,\s*local_container_naming/i);
    expect(values.slice(7, 9)).toEqual([input.machineId, input.machineId]);
    expect(values).toContain('generation-v1');
    expect(result.local_container_naming).toBe('generation-v1');
    expect(values).toEqual(expect.arrayContaining([
      input.id,
      input.runId,
      'harness-contract-reviewer',
      '9.16.0',
      `sha256:${'a'.repeat(64)}`,
      'b'.repeat(64),
    ]));
  });

  it('refuses to create an attempt when the exact parent run is terminal or missing', async () => {
    const pool = poolWith(
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    );

    await expect(createAttemptStore(pool).createAttempt(input))
      .rejects.toThrow(`Kernel run is terminal or missing: ${input.runId}`);
  });

  it('并发冲突语句看不到 winner 时用新语句重读现有 attempt', async () => {
    const winner = {
      id: '33333333-3333-4333-8333-333333333333',
      run_id: input.runId,
      hop: input.hop,
      status: 'queued',
    };
    const pool = poolWith(
      { rows: [], rowCount: 0 },
      { rows: [winner], rowCount: 1 },
    );

    await expect(createAttemptStore(pool).createAttempt(input)).resolves.toEqual(winner);

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(run_id, hop\) DO NOTHING/i);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/DO UPDATE/i);
    expect(pool.query.mock.calls[1]).toEqual([
      expect.stringMatching(
        /FROM harness_attempts attempt[\s\S]*JOIN initiative_runs run[\s\S]*attempt\.run_id=\$1[\s\S]*attempt\.hop=\$2[\s\S]*FOR KEY SHARE OF run/i,
      ),
      [input.runId, input.hop],
    ]);
  });

  it('starting/running/heartbeat 都使用 lease owner fencing', async () => {
    const pool = poolWith(
      { rows: [{ id: input.id, status: 'starting' }], rowCount: 1 },
      { rows: [{ id: input.id, status: 'running' }], rowCount: 1 },
      { rows: [{ id: input.id, status: 'running' }], rowCount: 1 },
    );
    const store = createAttemptStore(pool);

    await store.markStarting(input.id, { leaseOwner: 'brain-1', leaseSeconds: 90 });
    await store.markRunning(input.id, {
      leaseOwner: 'brain-1',
      leaseGeneration: 0,
      providerSessionId: 'session-1',
      leaseSeconds: 90,
    });
    await store.heartbeat(input.id, {
      leaseOwner: 'brain-1',
      leaseGeneration: 0,
      leaseSeconds: 90,
    });

    expect(pool.query.mock.calls[0][0]).toMatch(/status = 'starting'.*lease_owner =/is);
    expect(pool.query.mock.calls[1][0]).toMatch(/status = 'running'.*provider_session_id/is);
    expect(pool.query.mock.calls[1][0]).toMatch(/lease_generation = \$3/is);
    expect(pool.query.mock.calls[2][0]).toMatch(
      /lease_owner = \$2.*lease_generation = \$3.*status IN \('starting','running'\)/is,
    );
    for (const [sql] of pool.query.mock.calls) {
      expect(sql).not.toMatch(/INSERT INTO harness_run_events/i);
    }
  });

  it('watchdog 只能 reclaim 已过期的同一个非终态 attempt', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'starting' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    await store.reclaim(input.id, { leaseOwner: 'watchdog-1', leaseSeconds: 180 });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/lease_expires_at < NOW\(\)/i);
    expect(sql).toMatch(/status IN \('starting','running'\)/i);
    expect(sql).toMatch(/lease_generation\s*=\s*lease_generation\s*\+\s*1/i);
    expect(values).toEqual([input.id, 'watchdog-1', 180]);
  });

  it('launch receipt 只由同一个 lease owner 写入 starting/running attempt', async () => {
    const receipt = {
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      actualMachineId: 'worker-2',
      executionTransport: 'remote-bridge',
      remoteJobId: 'remote-job-7',
      attestationStatus: 'verified',
    };
    const pool = poolWith({
      rows: [{
        id: input.id,
        actual_machine_id: receipt.actualMachineId,
        execution_transport: receipt.executionTransport,
      }],
      rowCount: 1,
    });
    const store = createAttemptStore(pool);

    const result = await store.recordLaunchReceipt(input.id, receipt);

    expect(result).toMatchObject({
      id: input.id,
      actual_machine_id: receipt.actualMachineId,
      execution_transport: receipt.executionTransport,
    });
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/actual_machine_id\s*=\s*\$3/i);
    expect(sql).toMatch(/execution_transport\s*=\s*\$4/i);
    expect(sql).toMatch(/remote_job_id\s*=\s*\$5/i);
    expect(sql).toMatch(/machine_attestation_status\s*=\s*\$6/i);
    expect(sql).toMatch(/lease_owner\s*=\s*\$2/i);
    expect(sql).toMatch(/lease_generation\s*=\s*\$7/i);
    expect(sql).toMatch(/status IN \('starting','running'\)/i);
    expect(values).toEqual([
      input.id,
      receipt.leaseOwner,
      receipt.actualMachineId,
      receipt.executionTransport,
      receipt.remoteJobId,
      receipt.attestationStatus,
      receipt.leaseGeneration,
    ]);
  });

  it('launch receipt requires an explicit non-negative lease generation', async () => {
    const pool = poolWith();
    const store = createAttemptStore(pool);

    await expect(store.recordLaunchReceipt(input.id, {
      leaseOwner: 'brain-1',
      actualMachineId: 'worker-2',
      executionTransport: 'remote-bridge',
      remoteJobId: 'remote-job-7',
      attestationStatus: 'verified',
    })).rejects.toThrow('recordLaunchReceipt requires leaseGeneration');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('reclaim 后按 lease fencing 原子轮换 callback secret hash', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'starting' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    await store.rotateCallbackSecret(input.id, {
      leaseOwner: 'watchdog-1',
      leaseGeneration: 5,
      callbackSecretHash: 'c'.repeat(64),
    });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/callback_secret_hash\s*=\s*\$3/i);
    expect(sql).toMatch(/lease_owner\s*=\s*\$2/i);
    expect(sql).toMatch(/lease_generation\s*=\s*\$4/i);
    expect(sql).toMatch(/status IN \('starting','running'\)/i);
    expect(values).toEqual([input.id, 'watchdog-1', 'c'.repeat(64), 5]);
  });

  it('终态写入只接受一次，重复 callback 返回 deduped', async () => {
    const pool = poolWith(
      { rows: [{ id: input.id, status: 'completed' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
    );
    const store = createAttemptStore(pool);
    const result = { status: 'completed', summary: 'done' };

    expect(await store.complete(input.id, result, { leaseOwner: 'brain-1' })).toMatchObject({ deduped: false });
    expect(await store.complete(input.id, result, { leaseOwner: 'brain-1' })).toEqual({ attempt: null, deduped: true });
    expect(pool.query.mock.calls[0][0]).toMatch(/status NOT IN \(/i);
    expect(pool.query.mock.calls[0][0]).toMatch(/lease_owner\s*=\s*\$6/i);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/lease_owner\s*=\s*NULL/i);
  });

  it('semantic refusal 作为成功终态的规范化 failure class 持久化', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'blocked' }], rowCount: 1 });
    const store = createAttemptStore(pool);
    const result = {
      status: 'blocked',
      summary: 'needs product context',
      failure_class: 'semantic_refusal',
    };

    await expect(
      store.complete(input.id, result, { leaseOwner: 'brain-1' }),
    ).resolves.toMatchObject({ deduped: false });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/failure_class\s*=\s*\$5/i);
    expect(sql).toMatch(/lease_owner\s*=\s*\$6/i);
    expect(values).toEqual([
      input.id,
      'blocked',
      result,
      null,
      'semantic_refusal',
      'brain-1',
    ]);
  });

  it('失败也遵循终态幂等守卫', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'failed' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    const outcome = await store.fail(input.id, {
      code: 'launch_failed',
      message: 'boom',
      failureClass: 'runner_failure',
    });

    expect(outcome.deduped).toBe(false);
    expect(pool.query.mock.calls[0][0]).toMatch(
      /error_code.*error_message.*failure_class/is,
    );
    expect(pool.query.mock.calls[0][1]).toContain('runner_failure');
    expect(pool.query.mock.calls[0][0]).toMatch(/status NOT IN \(/i);
  });

  it('claimed failure optionally fences the exact lease generation', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'failed' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    await store.fail(input.id, {
      code: 'launch_failed',
      message: 'boom',
      failureClass: 'runner_failure',
    }, {
      leaseOwner: 'brain-1',
      leaseGeneration: 4,
    });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/\$6::text IS NULL OR lease_owner = \$6/i);
    expect(sql).toMatch(/\$7::integer IS NULL OR lease_generation = \$7/i);
    expect(values).toEqual([
      input.id,
      'failed',
      'launch_failed',
      'boom',
      'runner_failure',
      'brain-1',
      4,
    ]);
  });

  it('拒绝 proposer session 被 reviewer 复用', async () => {
    const pool = poolWith({
      rows: [{
        id: '33333333-3333-4333-8333-333333333333',
        role: 'proposer',
        provider_session_id: 'same-session',
      }],
    });
    const store = createAttemptStore(pool);

    await expect(store.assertFreshRoleSession({
      runId: input.runId,
      attemptId: input.id,
      role: 'reviewer',
      sessionId: 'same-session',
    })).rejects.toThrow(/role_session_reuse/);
  });

  it('resume 只允许同一个 attempt；同角色的新 attempt 也不能偷用旧 session', async () => {
    const sameAttemptPool = poolWith({
      rows: [{ id: input.id, role: 'reviewer', provider_session_id: 'session-1' }],
    });
    await expect(createAttemptStore(sameAttemptPool).assertFreshRoleSession({
      runId: input.runId,
      attemptId: input.id,
      role: 'reviewer',
      sessionId: 'session-1',
    })).resolves.toBe(true);

    const otherAttemptPool = poolWith({
      rows: [{
        id: '44444444-4444-4444-8444-444444444444',
        role: 'reviewer',
        provider_session_id: 'session-1',
      }],
    });
    await expect(createAttemptStore(otherAttemptPool).assertFreshRoleSession({
      runId: input.runId,
      attemptId: input.id,
      role: 'reviewer',
      sessionId: 'session-1',
    })).rejects.toThrow(/cross_attempt_session_reuse/);
  });

  it('按 id 和 run/hop 读取 attempt', async () => {
    const pool = poolWith(
      { rows: [{ id: input.id }], rowCount: 1 },
      { rows: [{ id: input.id, hop: 3 }], rowCount: 1 },
    );
    const store = createAttemptStore(pool);

    expect(await store.getById(input.id)).toMatchObject({ id: input.id });
    expect(await store.getByRunHop(input.runId, 3)).toMatchObject({ id: input.id, hop: 3 });
  });

  it('按 hop 顺序暴露同 run/role 的终态失败执行目标', async () => {
    const rows = [
      {
        provider: 'codex',
        account_id: 'team3',
        requested_machine_id: 'xian-mac-m4',
      },
      {
        provider: 'codex',
        account_id: 'team5',
        requested_machine_id: 'xian-mac-m1',
      },
    ];
    const pool = poolWith({ rows, rowCount: rows.length });
    const store = createAttemptStore(pool);

    await expect(store.listFailedExecutionTargets(input.runId, 'generator')).resolves.toEqual([
      { provider: 'codex', account: 'team3', machine: 'xian-mac-m4' },
      { provider: 'codex', account: 'team5', machine: 'xian-mac-m1' },
    ]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /status IN \('failed','cancelled'\).*OR.*status='blocked'.*failure_class='infrastructure_blocked'/is,
      ),
      [input.runId, 'generator'],
    );
    expect(pool.query.mock.calls[0][0]).toMatch(
      /error_code NOT IN\s*\(\s*'worker_attempt_missing_after_lease',\s*'worker_attempt_replacement_required_after_lease'\s*\)/i,
    );
    expect(pool.query.mock.calls[0][0]).toMatch(
      /error_code IS NULL\s+OR error_code NOT IN/i,
    );
  });

  it('uses bounded SQL to read the latest Commander Attempt', async () => {
    const row = {
      id: input.id,
      run_id: input.runId,
      role: 'commander',
      status: 'completed',
    };
    const pool = poolWith({ rows: [row] });

    await expect(
      createAttemptStore(pool).getLatestCommanderAttempt(input.runId),
    ).resolves.toEqual(row);
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE run_id=\$1\s+AND role='commander'/i);
    expect(sql).toMatch(/ORDER BY hop DESC\s+LIMIT 1/i);
    expect(sql).not.toMatch(/SELECT \*/i);
    expect(sql).not.toMatch(/callback_secret_hash|error_message/i);
    expect(values).toEqual([input.runId]);
  });

  it('reads only one Commander logical-cycle failover lineage', async () => {
    const rows = [{
      id: input.id,
      logical_cycle_id: 'commander-wakeup:5',
      retry_of_attempt_id: null,
      provider: 'codex',
      status: 'failed',
      failure_class: 'infrastructure_blocked',
      error_code: 'provider_unavailable',
    }];
    const pool = poolWith({ rows });

    await expect(createAttemptStore(pool).listCommanderFailoverLineage(
      input.runId,
      'commander-wakeup:5',
    )).resolves.toEqual(rows);
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(
      /WHERE run_id=\$1\s+AND role='commander'\s+AND logical_cycle_id=\$2/i,
    );
    expect(sql).toMatch(/ORDER BY hop ASC/i);
    expect(sql).not.toMatch(/task_bundle|result|callback_secret_hash|error_message/i);
    expect(values).toEqual([input.runId, 'commander-wakeup:5']);
  });
});
