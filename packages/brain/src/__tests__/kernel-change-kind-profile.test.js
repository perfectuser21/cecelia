/**
 * [BEHAVIOR] 四档 change_kind 驱动 derive 执行 Profile（sprint 08131104 缺陷④修复）。
 *
 * brain CI 收割位置（合同 Test Contract 指定）。等价断言来自 proposer 红证据
 * sprints/08131104-kernel-77f19b77/tests/kernel-change-kind-profile.test.js，并补齐
 * capability_change / 四档 G→E→J 保留 / evaluator validation clock 归属不变。
 *
 * 禁 mock 边（合同「禁 mock 边清单」）：orchestrator/derive.derive() 纯函数状态机真调，
 * 禁 mock；observed 手工注入。change_kind 与 gear 独立注入、禁互推导（决策 29ae54ae）。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../orchestrator/derive.js';

const base = () => ({
  run: { phase: 'planning' },
  task: { status: 'in_progress' },
  prdExists: false,
  contract: { approved: false },
  pr: null,
  inflight: { containers: [], host_pids: [], attempts: [] },
  lastAgentExit: null,
  proposeBranchRn: null,
  ganLatestRoundVerdict: null,
  generatorSpawned: false,
  evaluateVerdict: null,
  judgeVerdict: null,
  reviewRequired: false,
  reviewApproved: false,
  counters: { hop: 1, noPushStreak: 0, noVerdictStreak: 0 },
  decisionLog: [],
  gear: 'default',
});

// 契约既有 PR + CI pass + generator 已派 的可评估初始态（contract approved）。
const approvedWithPassingPr = (changeKind) => ({
  ...base(),
  change_kind: changeKind,
  prdExists: true,
  contract: { approved: true },
  generatorSpawned: true,
  // generator 干净退出（code 0）——非 null，deriveTask 退出分路读 lastAgentExit.action。
  lastAgentExit: { code: 0, auth_failed: false, action: null },
  pr: {
    url: 'https://example/pr/1', state: 'open', ci: 'pass', merged: false, head_sha: 'sha-1',
  },
});

describe('四档 change_kind 驱动 derive 执行 Profile [BEHAVIOR]', () => {
  it('bugfix change_kind 初始态跳 Planner/GAN 直进 generate', () => {
    const d = derive({ ...base(), change_kind: 'bugfix' });
    expect(d.phase).toBe('generate');
  });

  it('parameter_only change_kind 初始态跳 Planner/GAN 直进 generate', () => {
    const d = derive({ ...base(), change_kind: 'parameter_only' });
    expect(d.phase).toBe('generate');
  });

  it('new_capability change_kind 走全链（初始态 planning）', () => {
    const d = derive({ ...base(), change_kind: 'new_capability' });
    expect(d.phase).toBe('planning');
  });

  it('capability_change change_kind 保留轻 Planner + 合同收敛（初始态 planning）', () => {
    const d = derive({ ...base(), change_kind: 'capability_change' });
    expect(d.phase).toBe('planning');
  });

  it('change_kind 缺省（null）逐字节等价现行行为（零回归：初始态 planning）', () => {
    const d = derive({ ...base() }); // 无 change_kind
    expect(d.phase).toBe('planning');
  });

  it('change_kind 与 gear 正交：gear=hotfix 初始态跳 planning，与 change_kind 无关', () => {
    // gear=hotfix 现有跳阶行为不因 change_kind 存在而回退（正交叠加）。
    const d = derive({ ...base(), gear: 'hotfix', change_kind: 'new_capability' });
    expect(d.phase).toBe('generate');
  });
});

describe('四档全部保留 Generate Evaluate Judge 与 merge fence [BEHAVIOR]', () => {
  const FOUR = ['new_capability', 'capability_change', 'bugfix', 'parameter_only'];

  it('四档 change_kind 无一跳过 evaluate 相位（CI pass 后必经 evaluator）', () => {
    for (const ck of FOUR) {
      const d = derive(approvedWithPassingPr(ck));
      expect(d.phase).toBe('evaluate');
      expect(d.action).toBe('spawn:evaluator');
    }
  });

  it('四档 change_kind 无一跳过 judge 相位（evaluate PASS 后硬门禁必经 judge）', () => {
    for (const ck of FOUR) {
      const observed = {
        ...approvedWithPassingPr(ck),
        evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
      };
      const d = derive(observed);
      expect(d.action).toBe('spawn:judge');
    }
  });

  it('四档 change_kind 均只在 evaluate+judge 双 PASS 后才越 merge fence', () => {
    for (const ck of FOUR) {
      const observed = {
        ...approvedWithPassingPr(ck),
        evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
        judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
        reviewRequired: false,
      };
      const d = derive(observed);
      expect(d.phase).toBe('merge');
      expect(d.action).toBe('merge_pr');
    }
  });

  it('gear 零回归：gear=default 首角色 planner、gear=hotfix 首角色 generator', () => {
    expect(derive({ ...base(), gear: 'default' }).phase).toBe('planning');
    expect(derive({ ...base(), gear: 'default' }).action).toBe('spawn:planner');
    expect(derive({ ...base(), gear: 'hotfix' }).phase).toBe('generate');
    expect(derive({ ...base(), gear: 'hotfix' }).action).toBe('spawn:generator');
  });
});

describe('evaluator validation clock 归属不变 [BEHAVIOR][INV-3]', () => {
  const FOUR = ['new_capability', 'capability_change', 'bugfix', 'parameter_only'];

  it('复用既有 PR 时 validation clock 归 evaluator，change_kind 不篡改归属', () => {
    // 复用既有 PR（CI pass）但本 Run 尚无 generator 原点 + 无 evaluate verdict：
    // 必须先 generator-fix 对当前 HEAD 重新封印建立本 Run 共享时钟（validation clock 归 evaluator，
    // late-bound）。四档 change_kind 均不改变这一归属（Controller 守护/change_kind 不篡改）。
    for (const ck of FOUR) {
      const observed = {
        ...base(),
        change_kind: ck,
        prdExists: true,
        contract: { approved: true },
        generatorSpawned: false,
        evaluateVerdict: null,
        lastAgentExit: { code: 0, auth_failed: false, action: null },
        pr: {
          url: 'https://example/pr/1', state: 'open', ci: 'pass', merged: false, head_sha: 'sha-1',
        },
      };
      const d = derive(observed);
      expect(d.reason).toBe('current_run_generator_required_for_existing_pr');
    }
  });
});
