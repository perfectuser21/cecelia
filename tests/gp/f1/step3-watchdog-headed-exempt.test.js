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
