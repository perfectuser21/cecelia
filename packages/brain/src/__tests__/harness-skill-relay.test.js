// 本文件验证已获授权后的协议；真实默认拒绝见 execution-directory/legacy-relay.test.js。
vi.mock('../execution-directory/legacy-relay.js',()=>({withLegacyRelayExecution:async(_identity,operation)=>operation()}));
// 此执行器测试注入模拟传输；真实隔离入口由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertExternalExecutionAllowed: () => {} }));
/**
 * N3 skill-relay 最小接线（harness-skill-relay initiative，主理人 2026-07-04 拍板）：
 * task.payload.orchestrator==='skill-relay' → spawn 单 claude session 跑 harness-controller skill，
 * 不 compile / 不 invoke LangGraph 图。双轨：flag 缺省走原图路径，零行为变化。
 *
 * PrepPRD: sprints/07041621-harness-skill-relay-wiring/prep-prd.md
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { spawnSkillRelaySession, isSkillRelayTask, controllerSkillFor, deriveGear, GEAR_VALUES, _setActiveCodexRelays } from '../harness-skill-relay.js';
import { isLaunchDeferredReason } from '../lib/kernel-launch-deferral.js';

const TASK = {
  id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111',
  title: '测试 initiative',
  payload: {
    orchestrator: 'skill-relay',
    sprint_dir: 'sprints/07049999-test',
    journey_id: 'j-1',
    // Claude 无头通道已退役（任务 76a160b3）：缺省执行体=claude 会被拒绝，
    // 与执行体无关的 relay 机制统一用 codex 执行体覆盖
    executor: 'codex',
  },
};

// codex 进程内并发守门计数是模块级状态，每例归零，避免前例 spawn 成功后让后例被 codex_concurrent_limit 挡住
beforeEach(() => { _setActiveCodexRelays(0); });
const KERNEL_RUN_ID = '11111111-1111-4111-8111-111111111111';

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
    createKernelRun: vi.fn().mockResolvedValue({
      created: true,
      run: { id: KERNEL_RUN_ID,controller_session_id:'11111111-1111-4111-8111-111111111111',controller_generation:1 },
    }),
    finalizeRun: vi.fn().mockResolvedValue({
      changed: true,
      outcome: 'failed',
      runId: KERNEL_RUN_ID,
      taskId: TASK.id,
    }),
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
  // 原「claude 执行体选号全不可用→defer / 选号成功→spawn」两例已随 Claude 通道退役删除（任务 76a160b3），改为断言拒绝

  it('loadSkill 抛错（skill 未部署）→ ok=false，不 spawn', async () => {
    const deps = makeDeps({ loadSkill: vi.fn(() => { throw new Error('skill not found'); }) });
    const r = await spawnSkillRelaySession(TASK, deps);
    expect(r.ok).toBe(false);
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

});

describe('codex executor 凭据挂载（extraMounts 接线，demo task a150998c 根治）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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

  // 原「executor 缺省（claude）→ extraMounts 为空」随 Claude 通道退役改为断言拒绝（任务 76a160b3）

  it('executor=codex 且 CODEX_RELAY_HOME 未设 → 不 spawn，ok=false（B4 回滚语义）', async () => {
    vi.stubEnv('CODEX_RELAY_HOME', '');
    const deps = makeDeps();
    const task = { ...TASK, payload: { ...TASK.payload, executor: 'codex' } };
    const r = await spawnSkillRelaySession(task, deps);

    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
});

describe('默认 deps 的 import 来源（N4 run-1 实证 bug：resolveGitHubToken 不在 harness-utils）', () => {

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

  it('payload 已有 sprint_dir 时不回写（不覆盖 /dev 交接值）', async () => {
    const deps = makeSprintDirDeps();
    const task = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00003333', title: 'feat: 带 sprint_dir', payload: { orchestrator: 'skill-relay', sprint_dir: 'sprints/x', executor: 'codex' } };
    await spawnSkillRelaySession(task, deps);
    expect(findSprintDirUpdate(deps)).toBeFalsy();
  });

});

describe('controllerSkillFor（GP2/T2：按 task_type 选 controller skill）', () => {
  it('golden_path_proposal → capability-controller', () => {
    expect(controllerSkillFor('golden_path_proposal')).toBe('capability-controller');
  });
  it('harness_initiative / 未知类型 → harness-controller（默认不变）', () => {
    expect(controllerSkillFor('harness_initiative')).toBe('harness-controller');
    expect(controllerSkillFor(undefined)).toBe('harness-controller');
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
// Claude 通道退役（任务 76a160b3）：headed claude（claude-launch.sh）已删除，HARNESS_TASK_ID/identity 注入机制
// 与执行体无关，改用 codex headed 覆盖；另加一例断言 headed claude → claude_channel_retired。

/**
 * us-vps 纯调度器化第一刀（方案 A，主理人 2026-09-13 拍板；纠正决策 26c1e763
 * supersede 962281b2）：新增 CECELIA_LOCAL_EXECUTION_ENABLED 表达宿主角色，
 * 拦在 spawnSkillRelaySession 这个「所有 harness 派发路径的唯一咽喉」上。
 *
 * 为什么不改 CECELIA_MACHINE_ID（原方案已证伪，三条硬阻碍逐条亲验）：
 *  1. production-transport.js:137 那道守卫是死代码 —— 判据是入参 localMachineId，
 *     默认值即 DEFAULT_LOCAL_MACHINE_ID，而 server.js:145 / attempt-cleanup-worker.js:208
 *     等四个生产调用方全不传它，if 恒为假；
 *  2. 本文件对 machineId 的引用数为 0，本机 spawn 判据只有 payload.harness_runtime，
 *     改身份拦不住它（改 env 不减 VPS 一丝 CPU）；
 *  3. credential-broker.js:144 与 github-credential-broker.js:36 硬编码
 *     controllerMachineId !== 'us-mac-m4' 即 fail —— 这台 Brain 必须自称 us-mac-m4
 *     因为它是凭据权威，改身份会让远程派发也签不出凭据，全面 fail-closed。
 *
 * PrepPRD: sprints/09130012-us-vps-scheduler-identity/prep-prd.md
 */
