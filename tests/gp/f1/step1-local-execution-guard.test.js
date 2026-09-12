// F1「工厂 · 开发闭环」步骤 1 —— 边：调度器机器不许自己把活接下来干
//
// ── 事故（2026-09-12 全天追查，handoff 202609122045）──
//
// us-vps 那台 2 核 Linux VPS 同时是调度器和执行体。近 30 天 442 条
// orchestrator=skill-relay 的活全在它自己身上 spawn，CPU 被打满，task feef7d3f
// 卡死不动，一路挖穿四层才定位。主理人当天拍板铁律 96054a8b：us-vps 只当任务
// 调度器/分发器，真实执行负载全部下放 Mac worker。
//
// ── 为什么闸放在这里（步骤 1 接单分档），而不是放在执行器里 ──
//
// spawnSkillRelaySession 是所有 harness 派发路径（kernel / headed / headless /
// xian）的唯一咽喉，与既有 preview-guard 同位。拦在这儿的好处是拒绝时**既不建
// run 也不碰 worktree**，不留半态。
//
// 拦晚了会变成另一种死法：_spawnKernelRuntime 里先 createKernelRun 建了 run，
// 再 launchKernelProcess 本机 spawn；而 spawn 只要返回了 pid 就走 ok:true 分支
// （harness-skill-relay.js 内 `return { ok: true, mode: 'kernel-v1' ... }`），
// 子进程随后因别的原因秒死也不会 finalize —— 结果是 run 记录建了、进程没了、
// 错误只落在 kernel-<runId>.log、任务静默卡到租约过期。这正是要避免的形状。
//
// ── 为什么用独立变量而不是改 CECELIA_MACHINE_ID（纠正决策 26c1e763）──
//
// 曾提议把 CECELIA_MACHINE_ID 从 us-mac-m4 改成 us-vps-scheduler 来表达「我是
// 调度器」，三条亲验后否决：
//   1. production-transport.js 那道 localMachineId 守卫是死代码 —— 判据是入参且
//      默认值即 DEFAULT_LOCAL_MACHINE_ID，而 server.js、attempt-cleanup-worker.js
//      等四个生产调用方全不传它，if 恒为假；
//   2. harness-skill-relay.js 对 machineId 的引用数为 0，本机 spawn 判据只有
//      payload.harness_runtime === 'kernel-v1'，改身份拦不住、不减一丝 CPU；
//   3. credential-broker.js 与 github-credential-broker.js 硬编码要求
//      controllerMachineId === 'us-mac-m4' —— 这台 Brain 必须自称 us-mac-m4 因为
//      它是凭据权威，改身份会让远程派发到 MMV 也签不出凭据，全面 fail-closed。
// 该变量语义 = fleet 可调度节点身份 + 凭据签发权，不是宿主物理机标识。
//
// 守卫真 import 被改模块 harness-skill-relay.js（不 mock 它），只 mock 它的
// 外部依赖（db / child_process / worktree），这样闸一旦被挪走或改成读不可注入的
// process.env，这里立刻红。

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFile: vi.fn((...args) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null, '', '');
  }),
  spawn: vi.fn(),
}));

// 真 import 被改模块 —— 守卫在边上，不 mock 它
import { spawnSkillRelaySession } from '../../../packages/brain/src/harness-skill-relay.js';

const TASK = {
  id: 'aaaabbbb-cccc-dddd-eeee-ffff00002222',
  title: 'F1 step1 本机执行闸守卫',
  payload: {
    orchestrator: 'skill-relay',
    sprint_dir: 'sprints/09139999-guard',
    journey_id: 'j-f1',
  },
};

function deps(env) {
  return {
    env,
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    // 下面几个一旦被调用就说明闸没拦住（拦住时不该建 run、不该碰 worktree）
    createKernelRun: vi.fn(),
    ensureWt: vi.fn(),
    spawnFn: vi.fn(),
    launchKernel: vi.fn(),
  };
}

describe('F1 step1 · 调度器机器不许自己接活干', () => {
  it('CECELIA_LOCAL_EXECUTION_ENABLED=false → 拒绝派发，且不建 run 不碰 worktree', async () => {
    const d = deps({ CECELIA_LOCAL_EXECUTION_ENABLED: 'false' });
    const r = await spawnSkillRelaySession(
      { ...TASK, payload: { ...TASK.payload, harness_runtime: 'kernel-v1' } },
      d,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe('local_execution_disabled_on_scheduler');
    // 关键断言：拦在咽喉，不留半态
    expect(d.createKernelRun).not.toHaveBeenCalled();
    expect(d.ensureWt).not.toHaveBeenCalled();
    expect(d.launchKernel).not.toHaveBeenCalled();
    expect(d.spawnFn).not.toHaveBeenCalled();
  });

  it('闸拦所有派发路径，不只 kernel-v1（咽喉语义）', async () => {
    const d = deps({ CECELIA_LOCAL_EXECUTION_ENABLED: 'false' });
    const r = await spawnSkillRelaySession(TASK, d);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('local_execution_disabled_on_scheduler');
    expect(d.spawnFn).not.toHaveBeenCalled();
  });

  it('缺省不拦（行为零变化）—— 闸只在显式 false 时生效，防误杀执行机', async () => {
    const d = deps({});
    const r = await spawnSkillRelaySession(TASK, d);
    expect(r?.error).not.toBe('local_execution_disabled_on_scheduler');
  });

  it("='true' 不拦（显式开启也放行）", async () => {
    const d = deps({ CECELIA_LOCAL_EXECUTION_ENABLED: 'true' });
    const r = await spawnSkillRelaySession(TASK, d);
    expect(r?.error).not.toBe('local_execution_disabled_on_scheduler');
  });
});
