/**
 * N3 skill-relay 最小接线（harness-skill-relay initiative，主理人 2026-07-04 拍板）：
 * task.payload.orchestrator==='skill-relay' → spawn 单 claude session 跑 harness-controller skill，
 * 不 compile / 不 invoke LangGraph 图。双轨：flag 缺省走原图路径，零行为变化。
 *
 * PrepPRD: sprints/07041621-harness-skill-relay-wiring/prep-prd.md
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { spawnSkillRelaySession, isSkillRelayTask, controllerSkillFor, deriveGear, GEAR_VALUES } from '../harness-skill-relay.js';

const TASK = {
  id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111',
  title: '测试 initiative',
  payload: {
    orchestrator: 'skill-relay',
    sprint_dir: 'sprints/07049999-test',
    journey_id: 'j-1',
  },
};

function makeDeps(overrides = {}) {
  return {
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid', dockerStdout: 'x' }),
    loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT_MARKER harness-controller 指令全文'),
    ensureWt: vi.fn().mockResolvedValue('/tmp/wt/task-aaaabbbb'),
    // 新契约（issue 5167ef48）：claude 执行体必须带已解析账号才 spawn——
    // 默认 deps 模拟"选号成功"；"全号不可用→defer"用不写 env 的覆盖单测
    resolveAccountFn: vi.fn().mockImplementation(async (opts) => {
      opts.env = opts.env || {};
      opts.env.CECELIA_CREDENTIALS = 'account1';
    }),
    tokenFn: vi.fn().mockResolvedValue('gh-token'),
    now: () => new Date('2026-07-04T12:00:00Z'),
    // 去重守卫默认放行（无存活容器）；单独测试里覆盖为返回容器 id 模拟"容器仍在跑"
    execFn: vi.fn().mockReturnValue(''),
    // 2026-07-21：codex 凭据不再直挂真实 CODEX_RELAY_HOME，先快照到一次性临时目录再挂
    // （见 project_codex_token_consolidation_us 记忆 — 直挂会跟宿主 cron 刷新竞态）
    snapshotCodexHome: vi.fn().mockReturnValue('/tmp/fake-snapshot-dir'),
    ...overrides,
  };
}

describe('isSkillRelayTask', () => {
  it('payload.orchestrator=skill-relay → true', () => {
    expect(isSkillRelayTask(TASK)).toBe(true);
  });
  it('flag 缺省/其他值 → false（双轨：走原图路径）', () => {
    expect(isSkillRelayTask({ id: 'x', payload: {} })).toBe(false);
    expect(isSkillRelayTask({ id: 'x', payload: { orchestrator: 'langgraph' } })).toBe(false);
    expect(isSkillRelayTask({ id: 'x' })).toBe(false);
  });
});

describe('spawnSkillRelaySession', () => {
  it('claude 执行体选号全不可用（env 无 CECELIA_CREDENTIALS）→ defer 不裸 spawn（issue 5167ef48）', async () => {
    // account-rotation 全号熔断/打满时静默返回（env 不写）——旧行为会继续裸 spawn，
    // 容器 "Not logged in" exit(1) 三连 → orphan-guard 终态（143f66e1 事故复现面）
    const deps = makeDeps({ resolveAccountFn: vi.fn().mockResolvedValue(undefined) });
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(false);
    expect(r.deferred).toBe(true);
    expect(r.reason).toBe('no_available_claude_account');
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('claude 执行体选号成功（env 有 CECELIA_CREDENTIALS）→ 正常 spawn', async () => {
    const deps = makeDeps({
      resolveAccountFn: vi.fn().mockImplementation(async (opts) => {
        opts.env.CECELIA_CREDENTIALS = 'account1';
      }),
    });
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });

  it('kernel-v1 启动确定性 orchestrator，不加载或 spawn harness-controller', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const pool = { query: vi.fn(async (sql) => {
      if (/INSERT INTO initiative_runs/.test(sql)) return { rows: [{ id: runId }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) };
    const deps = makeDeps({
      pool,
      launchKernel: vi.fn(async () => ({ pid: 4242 })),
    });
    const task = {
      ...TASK,
      payload: { ...TASK.payload, harness_runtime: 'kernel-v1', executor: 'auto' },
    };

    const result = await spawnSkillRelaySession(task, deps);

    expect(result).toMatchObject({ ok: true, mode: 'kernel-v1', runId, pid: 4242 });
    expect(deps.launchKernel).toHaveBeenCalledWith(expect.objectContaining({
      taskId: TASK.id,
      runId,
      worktreePath: '/tmp/wt/task-aaaabbbb',
    }));
    expect(deps.loadSkill).not.toHaveBeenCalled();
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('P0: heartbeat 覆写 orchestrator_host 后再派发仍命中同任务 kernel run，不 INSERT 第二条', async () => {
    const activeRunId = '55555555-5555-4555-8555-555555555555';
    const insertedRunId = '66666666-6666-4666-8666-666666666666';
    const pool = { query: vi.fn(async (sql) => {
      if (/SELECT id FROM initiative_runs/.test(sql)) {
        // 真实事故状态：heartbeat 已把 host 改成 us-macmini，因此依赖
        // orchestrator_host='kernel-v1' 的查询会漏掉活跃 run。
        return sql.includes("orchestrator_host='kernel-v1'")
          ? { rows: [] }
          : { rows: [{ id: activeRunId, orchestrator_host: 'us-macmini' }] };
      }
      if (/INSERT INTO initiative_runs/.test(sql)) {
        return { rows: [{ id: insertedRunId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }) };
    const deps = makeDeps({
      pool,
      launchKernel: vi.fn(async () => ({ pid: 4242 })),
    });
    const task = {
      ...TASK,
      payload: { ...TASK.payload, harness_runtime: 'kernel-v1', executor: 'auto' },
    };

    const result = await spawnSkillRelaySession(task, deps);

    expect(result).toMatchObject({
      ok: false,
      mode: 'kernel-v1',
      deferred: true,
      reason: 'kernel_run_exists',
      runId: activeRunId,
    });
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO initiative_runs/.test(sql))).toBe(false);
    expect(deps.launchKernel).not.toHaveBeenCalled();
  });

  it('harness_runtime 缺省继续走旧 controller，保留一键回滚路径', async () => {
    const deps = makeDeps({ launchKernel: vi.fn() });

    const result = await spawnSkillRelaySession(TASK, deps);

    expect(result.mode).toBe('skill-relay');
    expect(deps.launchKernel).not.toHaveBeenCalled();
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(deps.loadSkill).toHaveBeenCalledWith('harness-controller');
  });

  it('happy path：worktree→账号→spawn(prompt 含 skill 内容+上下文头)→initiative_runs 落行', async () => {
    const deps = makeDeps();
    const r = await spawnSkillRelaySession(TASK, deps);

    expect(r.ok).toBe(true);
    expect(r.mode).toBe('skill-relay');
    expect(deps.ensureWt).toHaveBeenCalledOnce();
    expect(deps.resolveAccountFn).toHaveBeenCalledOnce();

    // spawn 参数
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.prompt).toContain('SKILL_CONTENT_MARKER');           // skill 全文 inline
    expect(spawnOpts.prompt).toContain(TASK.id);                          // 上下文头含 task id
    expect(spawnOpts.prompt).toContain('sprints/07049999-test');          // 上下文头含 sprint_dir
    expect(spawnOpts.containerId).toMatch(/^cecelia-relay-aaaabbbb-/);    // 命名规约
    expect(spawnOpts.env.HARNESS_TASK_ID).toBe(TASK.id);
    expect(spawnOpts.env.HARNESS_INITIATIVE_ID).toBe(TASK.id);            // B51: initiative_id=task.id
    expect(spawnOpts.env.HARNESS_SPRINT_DIR).toBe('sprints/07049999-test');
    expect(spawnOpts.env.GITHUB_TOKEN).toBe('gh-token');
    expect(spawnOpts.env.CECELIA_TASK_TYPE).toBe('harness_controller');

    // initiative_runs 落行：A_planning（现有 watchdog 白名单内）+ v2 + 6h deadline
    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall, '必须 INSERT initiative_runs').toBeTruthy();
    const [sql, params] = insertCall;
    expect(sql).toContain('A_planning');
    expect(sql).toMatch(/orchestrator_version/);
    expect(sql).toMatch(/deadline_at/);
    // 刀C1（决策 dc18d43d）：current_task_id 必须写入，否则 relay-runs?task_id= 过滤恒空
    expect(sql).toMatch(/current_task_id/);
    expect(params).toContain(TASK.id);
  });

  it('task.ability_id 存在时，initiative_runs INSERT 带上 ability_id 参数', async () => {
    const deps = makeDeps();
    const task = { ...TASK, ability_id: 'ability-uuid-1' };
    await spawnSkillRelaySession(task, deps);

    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall).toBeTruthy();
    const [sql, params] = insertCall;
    expect(sql).toMatch(/ability_id/);
    expect(params).toContain('ability-uuid-1');
  });

  it('task.ability_id 缺省时，ability_id 参数为 null（不报错）', async () => {
    const deps = makeDeps();
    await spawnSkillRelaySession(TASK, deps); // TASK 本身无 ability_id 顶层字段
    const insertCall = deps.pool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    const [, params] = insertCall;
    expect(params).toContain(null);
  });

  it('spawn 失败 → ok=false 带错误，不落 initiative_runs 成功语义', async () => {
    const deps = makeDeps({ spawnFn: vi.fn().mockRejectedValue(new Error('docker down')) });
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('docker down');
  });

  it('sprint_dir 缺省时自动生成（relay-<task8> 规约），并注入 prompt', async () => {
    const deps = makeDeps();
    const task = { ...TASK, payload: { orchestrator: 'skill-relay' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.env.HARNESS_SPRINT_DIR).toMatch(/^sprints\/\d{8}-relay-aaaabbbb$/);
  });

  it('loadSkill 抛错（skill 未部署）→ ok=false，不 spawn', async () => {
    const deps = makeDeps({ loadSkill: vi.fn(() => { throw new Error('skill not found'); }) });
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(false);
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });
  it('env 注入宿主 worktree 绝对路径 HARNESS_WORKTREE_HOST（刀3：controller 容器内 curl judge API 用）', async () => {
    const deps = makeDeps();
    await spawnSkillRelaySession(TASK, deps);
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.env.HARNESS_WORKTREE_HOST).toBe('/tmp/wt/task-aaaabbbb');
  });
});

describe('live-container 去重守卫（P1 bug 39b97ade：Brain 重启后误 requeue 导致双 spawn）', () => {
  it('docker ps 发现同名容器仍在跑 → 不 spawn，返回 deferred=true reason=live_container_guard', async () => {
    const deps = makeDeps({
      execFn: vi.fn().mockReturnValue('c0ffee123456\n'),
    });
    const r = await spawnSkillRelaySession(TASK, deps);

    expect(r.ok).toBe(false);
    expect(r.deferred).toBe(true);
    expect(r.reason).toBe('live_container_guard');
    expect(deps.spawnFn).not.toHaveBeenCalled();
    // docker ps 过滤条件必须匹配 harness-relay-watchdog.js 同款命名规约（cecelia-relay-<task8>）
    expect(deps.execFn).toHaveBeenCalledWith(
      expect.stringContaining('cecelia-relay-aaaabbbb')
    );
  });

  it('docker ps 无匹配容器（空输出）→ 正常 spawn', async () => {
    const deps = makeDeps({ execFn: vi.fn().mockReturnValue('') });
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });

  it('docker ps 命令报错（docker 不可达）→ fail-open，仍正常 spawn', async () => {
    const deps = makeDeps({
      execFn: vi.fn(() => { throw new Error('docker daemon unreachable'); }),
    });
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });
});

describe('codex executor 凭据挂载（extraMounts 接线，demo task a150998c 根治）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('executor=codex + CODEX_RELAY_HOME 已配置 → 先快照真实凭据目录到临时目录，spawnFn 收到临时目录挂载（不是真实目录）', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const deps = makeDeps();
    const task = { ...TASK, payload: { ...TASK.payload, executor: 'codex' } };
    const r = await spawnSkillRelaySession(task, deps);

    expect(r.ok).toBe(true);
    expect(deps.snapshotCodexHome).toHaveBeenCalledWith('/tmp/fake-codex-home', task.id);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    // 挂的必须是快照函数返回的临时目录，不能是真实 CODEX_RELAY_HOME 本身——
    // 直挂真实目录会让容器内 codex 自刷新写回真文件，跟宿主 cron 刷新竞态
    expect(spawnOpts.extraMounts).toContain('/tmp/fake-snapshot-dir:/home/cecelia/.codex:rw');
    expect(spawnOpts.extraMounts.join(' ')).not.toContain('/tmp/fake-codex-home:');
  });

  it('executor=codex 但快照失败（真实凭据目录下找不到 auth.json）→ 不 spawn，ok=false（loud fail，不静默用真实目录兜底）', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const deps = makeDeps({
      snapshotCodexHome: vi.fn().mockImplementation(() => {
        throw new Error('CODEX_RELAY_HOME 下找不到 auth.json: /tmp/fake-codex-home/auth.json');
      }),
    });
    const task = { ...TASK, payload: { ...TASK.payload, executor: 'codex' } };
    const r = await spawnSkillRelaySession(task, deps);

    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });

  it('executor 缺省（claude）→ extraMounts 为空/未定义', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '/tmp/fake-codex-home');
    const deps = makeDeps();
    const r = await spawnSkillRelaySession(TASK, deps);

    expect(r.ok).toBe(true);
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.extraMounts ?? []).toHaveLength(0);
  });

  it('executor=codex 且 CODEX_RELAY_HOME 未设 → 不 spawn，ok=false（B4 回滚语义）', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '');
    const deps = makeDeps();
    const task = { ...TASK, payload: { ...TASK.payload, executor: 'codex' } };
    const r = await spawnSkillRelaySession(task, deps);

    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
});

describe('router 集成：flag 命中不碰图', async () => {
  it('runHarnessInitiativeRouter 对 skill-relay 任务不 compile 图', async () => {
    const { runHarnessInitiativeRouter } = await import('../executor.js');
    const compiled = new Proxy({}, { get() { throw new Error('graph must not be touched'); } });
    const deps = makeDeps();
    const r = await runHarnessInitiativeRouter(TASK, {
      pool: deps.pool,
      compiled,
      skillRelayDeps: deps,
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('skill-relay');
    expect(deps.spawnFn).toHaveBeenCalledOnce();
  });
});

describe('默认 deps 的 import 来源（N4 run-1 实证 bug：resolveGitHubToken 不在 harness-utils）', () => {
  it('源码从 harness-credentials.js 取 resolveGitHubToken', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../harness-skill-relay.js', import.meta.url), 'utf8');
    expect(src).toMatch(/harness-credentials\.js.*resolveGitHubToken|resolveGitHubToken[\s\S]{0,80}harness-credentials\.js/);
    expect(src).not.toMatch(/harness-utils\.js'\)\)\.resolveGitHubToken/);
  });

  it('harness-credentials.js 真的导出 resolveGitHubToken（防再猜错模块）', async () => {
    const mod = await import('../harness-credentials.js');
    expect(typeof mod.resolveGitHubToken).toBe('function');
  });
});

describe('deriveReviewRequired(P2-1:新功能人审/非新功能 auto merge)', () => {
  let deriveReviewRequired;
  beforeAll(async () => { ({ deriveReviewRequired } = await import('../harness-skill-relay.js')); });

  it('显式 payload.review_required 永远赢(true/false 都尊重)', () => {
    expect(deriveReviewRequired({ title: 'feat: 新东西', payload: { review_required: false } })).toBe(false);
    expect(deriveReviewRequired({ title: 'fix: 修个小事', payload: { review_required: true } })).toBe(true);
  });

  it('fix/chore/修复/bug 类标题 → false(auto merge)', () => {
    for (const t of ['fix: relay 空指针', 'fix(brain): x', 'chore: 清理', 'hotfix: 紧急', '修复 evaluator 误判', 'bug: 掉线']) {
      expect(deriveReviewRequired({ title: t, payload: {} }), t).toBe(false);
    }
  });

  it('payload.change_kind ∈ {fix,small,thicken} → false(加厚/小改不算新面)', () => {
    for (const k of ['fix', 'small', 'thicken']) {
      expect(deriveReviewRequired({ title: '随便', payload: { change_kind: k } })).toBe(false);
    }
  });

  it('新功能/默认(判定不出) → true(安全方向:宁可多看一眼)', () => {
    expect(deriveReviewRequired({ title: 'feat: 新增导出功能', payload: {} })).toBe(true);
    expect(deriveReviewRequired({ title: '视频批量下载', payload: {} })).toBe(true);
    expect(deriveReviewRequired({ title: '', payload: {} })).toBe(true);
  });

  it('spawn 时把判定结果持久化进 task payload(controller 经 API 读得到)并注入 prompt', async () => {
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({}),
      loadSkill: vi.fn().mockReturnValue('SKILL'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt'),
      resolveAccountFn: vi.fn().mockImplementation(async (o) => { o.env = o.env || {}; o.env.CECELIA_CREDENTIALS = 'account1'; }),
      tokenFn: vi.fn().mockResolvedValue('t'),
      now: () => new Date('2026-07-05T12:00:00Z'),
    };
    const task = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111', title: 'feat: 全新能力', payload: { orchestrator: 'skill-relay', sprint_dir: 's' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    // payload 持久化
    const upd = deps.pool.query.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql) && /review_required/.test(sql));
    expect(upd, '必须 UPDATE tasks payload.review_required').toBeTruthy();
    // prompt 注入
    const prompt = deps.spawnFn.mock.calls[0][0].prompt;
    expect(prompt).toMatch(/REVIEW_REQUIRED=true/);
  });
});

describe('deriveGear（harness gear 档位：default/hotfix/segmented）', () => {
  it('payload.gear 缺省/undefined/null → default', () => {
    expect(deriveGear({ payload: {} })).toBe('default');
    expect(deriveGear({ payload: { gear: undefined } })).toBe('default');
    expect(deriveGear({ payload: { gear: null } })).toBe('default');
    expect(deriveGear({})).toBe('default');
  });

  it('payload.gear ∈ GEAR_VALUES → 原值透传', () => {
    for (const g of GEAR_VALUES) {
      expect(deriveGear({ payload: { gear: g } })).toBe(g);
    }
  });

  it('GEAR_VALUES 枚举恰为 default/hotfix/segmented', () => {
    expect(GEAR_VALUES).toEqual(['default', 'hotfix', 'segmented']);
  });

  it('非法值 → throw Error 含 invalid_gear', () => {
    expect(() => deriveGear({ payload: { gear: 'turbo' } })).toThrow(/invalid_gear/);
    expect(() => deriveGear({ payload: { gear: 'turbo' } })).toThrow(/turbo/);
  });
});

describe('spawnSkillRelaySession — HARNESS_GEAR 注入（prompt 头 + env）', () => {
  it('gear 缺省 → prompt/env 均为 default（回归：存量任务零影响）', async () => {
    const deps = makeDeps();
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(true);
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.prompt).toMatch(/HARNESS_GEAR=default/);
    expect(spawnOpts.env.HARNESS_GEAR).toBe('default');
  });

  it('显式 payload.gear=segmented → prompt/env 均透传 segmented', async () => {
    const deps = makeDeps();
    const task = { ...TASK, payload: { ...TASK.payload, gear: 'segmented' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.prompt).toMatch(/HARNESS_GEAR=segmented/);
    expect(spawnOpts.env.HARNESS_GEAR).toBe('segmented');
  });

  it('HARNESS_GEAR 紧跟 REVIEW_REQUIRED 行（prompt 头顺序）', async () => {
    const deps = makeDeps();
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(true);
    const prompt = deps.spawnFn.mock.calls[0][0].prompt;
    expect(prompt).toMatch(/REVIEW_REQUIRED=\w+\nHARNESS_GEAR=\w+/);
  });
});

describe('spawnSkillRelaySession — sprint_dir 持久化 (issue 45dd6925)', () => {
  function makeSprintDirDeps(overrides = {}) {
    return {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({}),
      loadSkill: vi.fn().mockReturnValue('SKILL'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt'),
      resolveAccountFn: vi.fn().mockImplementation(async (o) => { o.env = o.env || {}; o.env.CECELIA_CREDENTIALS = 'account1'; }),
      tokenFn: vi.fn().mockResolvedValue('t'),
      now: () => new Date('2026-07-05T12:00:00Z'),
      // 2026-07-22：headed 分支缺省 executor 时按 codex 处理，CODEX_RELAY_HOME 在
      // CI 里全局设了假路径，会触发真实 snapshotCodexRelayHome 找不到 auth.json
      snapshotCodexHome: vi.fn().mockReturnValue('/tmp/fake-snapshot-dir'),
      ...overrides,
    };
  }
  const findSprintDirUpdate = (deps) =>
    deps.pool.query.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql) && /sprint_dir/.test(sql));

  it('payload 无 sprint_dir 时 spawn 持久化生成的 sprint_dir（重派漂移回归）', async () => {
    const deps = makeSprintDirDeps();
    const task = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00002222', title: 'feat: 无 sprint_dir 任务', payload: { orchestrator: 'skill-relay' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    const upd = findSprintDirUpdate(deps);
    expect(upd, '必须 UPDATE tasks payload.sprint_dir').toBeTruthy();
    expect(upd[1]).toContain(task.id);
    expect(String(upd[1][1])).toMatch(/^sprints\//);
  });

  it('payload 已有 sprint_dir 时不回写（不覆盖 /dev 交接值）', async () => {
    const deps = makeSprintDirDeps();
    const task = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00003333', title: 'feat: 带 sprint_dir', payload: { orchestrator: 'skill-relay', sprint_dir: 'sprints/x' } };
    await spawnSkillRelaySession(task, deps);
    expect(findSprintDirUpdate(deps)).toBeFalsy();
  });

  it('headed 路径同样回写缺省 sprint_dir（雷11守卫放行后）', async () => {
    const deps = makeSprintDirDeps({
      // 雷11 tmux 探活：返回 TMUX_DEAD 放行 spawn；sshSpawnFn 注入避免真 ssh
      execFn: vi.fn().mockReturnValue('TMUX_DEAD'),
      sshSpawnFn: vi.fn().mockResolvedValue({}),
    });
    const task = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00004444', title: 'feat: headed 无 sprint_dir', payload: { orchestrator: 'skill-relay', mode: 'headed' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    const upd = findSprintDirUpdate(deps);
    expect(upd, 'headed 路径也必须 UPDATE tasks payload.sprint_dir').toBeTruthy();
    expect(upd[1]).toContain(task.id);
    const dir = String(upd[1][1]);
    expect(dir).toMatch(/^sprints\//);
    // 清理 tui.log 留痕真实创建的本地目录（相对测试 cwd）
    const { rmSync } = await import('node:fs');
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  });

  it('headed 路径命中雷11守卫（TMUX_ALIVE）early-return 时不产生 sprint_dir 回写', async () => {
    const deps = makeSprintDirDeps({
      execFn: vi.fn().mockReturnValue('TMUX_ALIVE'),
      sshSpawnFn: vi.fn().mockResolvedValue({}),
    });
    const task = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00005555', title: 'feat: headed 撞名', payload: { orchestrator: 'skill-relay', mode: 'headed' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(false);
    expect(r.deferred).toBe(true);
    expect(findSprintDirUpdate(deps)).toBeFalsy();
  });
});

describe('controllerSkillFor（GP2/T2：按 task_type 选 controller skill）', () => {
  it('golden_path_proposal → golden-path-controller', () => {
    expect(controllerSkillFor('golden_path_proposal')).toBe('golden-path-controller');
  });
  it('harness_initiative / 未知类型 → harness-controller（默认不变）', () => {
    expect(controllerSkillFor('harness_initiative')).toBe('harness-controller');
    expect(controllerSkillFor(undefined)).toBe('harness-controller');
  });
});

describe('spawnSkillRelaySession: golden_path_proposal 选中 golden-path-controller', () => {
  it('loadSkill 被以 golden-path-controller 调用', async () => {
    const deps = makeDeps();
    const gpTask = { ...TASK, task_type: 'golden_path_proposal' };
    const r = await spawnSkillRelaySession(gpTask, deps);
    expect(r.ok).toBe(true);
    expect(deps.loadSkill).toHaveBeenCalledWith('golden-path-controller');
  });

  it('harness_initiative 默认仍是 harness-controller（零回归）', async () => {
    const deps = makeDeps();
    await spawnSkillRelaySession({ ...TASK, task_type: 'harness_initiative' }, deps);
    expect(deps.loadSkill).toHaveBeenCalledWith('harness-controller');
  });
});

// ─── evaluator gate 守门：headed claude relay 必须注入 HARNESS_TASK_ID ─────────────────
//
// 根因（P0 a638f840）：post-pr-create.sh hook 对所有 `gh pr create` 无条件启用
// `gh pr merge --auto --squash`，导致 harness relay PR 在 CI 绿后立刻被 GitHub 自动合并，
// evaluator 和 report stage 从未有机会执行。
//
// 修复路径：
//  1. headed claude relay 的 tmux innerCmd 注入 HARNESS_TASK_ID（本测试守住）
//  2. packages/quality/hooks/post-pr-create.sh 检测 HARNESS_TASK_ID 非空时跳过 auto-merge
//
// headless docker relay 已通过 spawnFn 的 env 参数注入 HARNESS_TASK_ID（原有行为，无需改）。
describe('headed claude relay — HARNESS_TASK_ID 注入（evaluator gate 守门）', () => {
  function makeHeadedTask(overrides = {}) {
    return {
      id: 'bbbbcccc-dddd-eeee-ffff-000011112222',
      title: 'test: headed evaluator gate',
      payload: {
        orchestrator: 'skill-relay',
        mode: 'headed',
        executor: 'claude',
        sprint_dir: 'sprints/test-headed-gate',
      },
      ...overrides,
    };
  }

  it('headed claude relay tmux innerCmd 包含 HARNESS_TASK_ID——post-pr-create hook 的检测信号', async () => {
    const execCallArgs = [];
    const execFn = vi.fn((cmd, _opts) => {
      execCallArgs.push(String(cmd));
      // tmux 守卫探活：返回 TMUX_DEAD 放行 spawn
      if (String(cmd).includes('tmux has-session')) return 'TMUX_DEAD';
      // 其余 ssh 命令（prompt 写入 + tmux new-session）返回空字符串表示成功
      return '';
    });

    const task = makeHeadedTask();
    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      execFn,
      loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/test-headed-gate'),
      resolveAccountFn: vi.fn().mockImplementation(async (o) => { o.env = o.env || {}; o.env.CECELIA_CREDENTIALS = 'account1'; }),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-15T07:10:00Z'),
      inDockerFn: () => false,
      sshKeyFn: () => null,
    };

    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);

    // 找 tmux new-session 调用（该命令携带 innerCmd，是 claude session 的启动命令）
    const tmuxCalls = execCallArgs.filter(cmd => cmd.includes('tmux new-session'));
    expect(tmuxCalls.length, 'tmux new-session 必须被调用').toBeGreaterThan(0);

    // 核心断言：HARNESS_TASK_ID 必须在 tmux innerCmd 里
    // 这是 post-pr-create.sh 检测 harness relay 模式、跳过 auto-merge 的唯一信号
    expect(tmuxCalls[0], 'tmux innerCmd 必须含 HARNESS_TASK_ID 供 hook 检测').toContain('HARNESS_TASK_ID=');
    expect(tmuxCalls[0]).toContain(task.id);

    // 清理 tui.log 真实写入目录
    const { rmSync } = await import('node:fs');
    try { rmSync(task.payload.sprint_dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  });
});
