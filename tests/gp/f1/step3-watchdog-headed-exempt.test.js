// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：harness-watchdog never-started 有头豁免（并行血管P2）
//
// 案卷（decision 45a2bcfb）：09-06 战役中有头 /dev 会话被区段 C 误杀 4 次——
// claimed_by=interactive-dev-skill 的会话在 PrepPRD/探索/TDD 阶段 20min 内不写
// initiative_runs 行，watchdog 只看「无 run 行 + claimed_at>20min」即标 failed 清 claim，
// 触发重复派发；docker 容器探测救不了有头（没有 cecelia-relay-* 容器）。
//
// 守卫的边：有头在工窗口（40min）内 watchdog 绝不判死；超窗落回原判死防真死占坑。
// 真 import 被改模块，不 vi.mock 它——pool 走 resumeStalledHarnessDrivers 的依赖注入口。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HEADED_CLAIM_GRACE_MINUTES,
  resumeStalledHarnessDrivers,
} from '../../../packages/brain/src/harness-watchdog.js';

function fakePool(candidateRows = []) {
  const calls = [];
  const client = {
    query: async (sql) => { calls.push(String(sql)); return { rows: [] }; },
    release: () => {},
  };
  return {
    calls,
    query: async (sql) => {
      const text = String(sql);
      calls.push(text);
      const isNeverStartedCandidate = /NOT\s+EXISTS/i.test(text)
        && /initiative_runs/i.test(text) && /claimed_at/i.test(text);
      return { rows: isNeverStartedCandidate ? candidateRows : [] };
    },
    connect: async () => client,
  };
}

describe('F1 step3 — watchdog never-started 有头豁免（并行血管P2）', () => {
  it('有头豁免窗常量 = 40 分钟（宽于通用 20min 阈值）', () => {
    expect(HEADED_CLAIM_GRACE_MINUTES).toBe(40);
  });

  it('候选 SELECT 与事务锁双处都带 interactive-dev-skill 豁免谓词（防 TOCTOU）', async () => {
    const pool = fakePool([{ id: 'a795594b-0000-4000-8000-000000000001' }]);
    await resumeStalledHarnessDrivers({ pool, execFn: () => '' });

    const candidateSql = pool.calls.find(sql =>
      /NOT\s+EXISTS/i.test(sql) && /initiative_runs/i.test(sql) && /claimed_at/i.test(sql));
    expect(candidateSql).toBeDefined();
    expect(candidateSql).toMatch(/interactive-dev-skill/);
    expect(candidateSql).toContain(`INTERVAL '${HEADED_CLAIM_GRACE_MINUTES} minutes'`);

    const lockSql = pool.calls.find(sql => /FOR\s+UPDATE/i.test(sql));
    expect(lockSql).toBeDefined();
    expect(lockSql).toMatch(/interactive-dev-skill/);
    expect(lockSql).toContain(`INTERVAL '${HEADED_CLAIM_GRACE_MINUTES} minutes'`);
  });

  it('豁免谓词是排除式（NOT (有头 AND 新鲜)）——无头任务与超窗有头任务不受保护', async () => {
    const pool = fakePool([]);
    await resumeStalledHarnessDrivers({ pool, execFn: () => '' });
    const candidateSql = pool.calls.find(sql =>
      /NOT\s+EXISTS/i.test(sql) && /initiative_runs/i.test(sql) && /claimed_at/i.test(sql));
    // NOT ( claimed_by LIKE '%interactive-dev-skill%' AND claimed_at >= NOW() - INTERVAL ... )
    expect(candidateSql).toMatch(/NOT\s*\(\s*[\s\S]*?claimed_by\s+LIKE\s+'%interactive-dev-skill%'[\s\S]*?AND[\s\S]*?claimed_at\s*>=\s*NOW\(\)/i);
  });
});

// ── 续案（2026-09-16）：豁免窗不够，判死方式本身也错 ─────────────────────
//
// 45a2bcfb 那道豁免只解决了「在工窗口内不判死」，但豁免看的是 claimed_at
// ——「开工那一刻」，不是「是否仍在活动」。于是认真干了 44 分钟和 118 分钟的
// 有头会话，与 40 分钟前就死掉的会话，在 watchdog 眼里完全一样，超窗即判死。
//
// 更要命的是判死方式选错了：failed 是终端态（状态机 allowed: []），
// PATCH /tasks/:id 直接拒绝，只能绕过 API 直写 DB 才能救回来。
// 09-16 一次会话 4 个有头任务全中（abcbc09f/2091c21b/9e949390/27600369），
// 四次人工直写库——而它们的 PR 其实都正常合并了。
//
// 而 executor-contracts 早就给 headed-session 定了处置：
//   { staleMinutes: 120, onStale: 'release-claim-and-alert' }
// zombie-reaper 老实遵守，harness-watchdog 的 never-started 是另写的一套 SQL，
// 绕过了合同。这道边就是让它回到合同上：有头超窗降级 blocked（可恢复），不判 failed。
describe('F1 step3 — 有头会话超窗只降级不判死（终端态不可恢复）', () => {
  const source = readFileSync(
    new URL('../../../packages/brain/src/harness-watchdog.js', import.meta.url),
    'utf8',
  );

  it('never-started 分支按 executor_kind/claimed_by 识别有头会话', () => {
    expect(source).toMatch(/isHeaded/);
    expect(source).toMatch(/executor_kind === 'headed-session'/);
    expect(source).toMatch(/interactive-dev-skill/);
  });

  it('事务锁 SELECT 必须取到判定所需字段，否则 isHeaded 永远判不出来', () => {
    expect(source).toMatch(/SELECT id, status, claimed_at, claimed_by, executor_kind/);
  });

  it('有头分支落 blocked 且带 blocked_at（DB 约束 chk_blocked_at_not_null）', () => {
    const headedBranch = source.slice(source.indexOf('isHeaded'));
    expect(headedBranch).toMatch(/status = 'blocked'/);
    expect(headedBranch).toMatch(/blocked_at = NOW\(\)/);
  });

  it('自动流水线路径保持判 failed —— 那条是对的，它本就该在阈值内建起 run', () => {
    expect(source).toMatch(/harness_initiative never started graph/);
    // 终态经 lib/task-terminal.js 收口（09-25）：自动流水线分支调 finalizeTask(..., 'failed')
    expect(source).toMatch(/finalizeTask\(client, row\.id, 'failed'/);
  });

  it('blocked 优于 failed 的理由写进代码注释，防后人"优化"掉', () => {
    expect(source).toMatch(/终端态|allowed:\s*\[\]|无法回正|可恢复/);
  });
});
