// E2E 驱动 — 由 evaluator 在 local_api(真 PG) 上执行；propose 阶段目标模块未实现故不运行。
// 用法: DB_URL=... node gate-e2e-driver.mjs <pass|reject|incomplete|regression> [stepId]
// DB 边(decisions 写路径)为真 PG(禁 mock)；三镜头 LLM 判决 adjudicate 为确定性注入桩
// （登记于 contract-draft ## 未覆盖真实链路清单）。任一断言失败 → 非 0 退出。
import pg from 'pg';
import { runCapabilityGate } from '../../../packages/brain/src/capability-gate.js';
import { routeWork } from '../../../packages/brain/src/work-router.js';

const [, , mode, stepIdArg] = process.argv;
const STEP_ID = stepIdArg || '11111111-2222-3333-4444-555555555555';
const DB_URL = process.env.DB_URL;
if (!DB_URL) { console.error('FAIL: DB_URL 未注入'); process.exit(1); }

function verdict(overrides = {}) {
  return {
    decision: 'pass',
    reason: 'novel capability, scoped, correctly homed',
    postcondition: 'new_capability 上线后 routeWork 对该能力必经三镜头且门禁产物落 decisions',
    nfr: { cost_ceiling: 2.5, latency_ceiling: 8000, success_floor: 0.9 },
    ...overrides,
  };
}

async function countNfrRow(db) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS c FROM decisions
      WHERE category='nfr' AND level='step' AND target_type='journey_step'
        AND target_id=$1 AND status='active'
        AND created_at > NOW() - interval '5 minutes'`,
    [STEP_ID],
  );
  return rows[0].c;
}

async function main() {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    if (mode === 'pass') {
      const adjudicate = async () => verdict();
      const res = await runCapabilityGate(db, { changeKind: 'new_capability', stepId: STEP_ID, request: { source_id: 'e2e-pass' }, adjudicate });
      if (!res || res.released !== true || res.triggered !== true) throw new Error(`released 异常: ${JSON.stringify(res)}`);
      const c = await countNfrRow(db);
      if (c < 1) throw new Error('decisions 无 nfr/step/journey_step 行(过闸未落库)');
      const { rows } = await db.query(`SELECT context FROM decisions WHERE target_id=$1 AND category='nfr' ORDER BY created_at DESC LIMIT 1`, [STEP_ID]);
      const nfr = rows[0]?.context?.nfr || {};
      for (const k of ['cost_ceiling', 'latency_ceiling', 'success_floor']) {
        if (typeof nfr[k] !== 'number') throw new Error(`context.nfr.${k} 缺失或非数值`);
      }
      console.log(`OK pass: decisions nfr 行=${c} nfr=${JSON.stringify(nfr)}`);
    } else if (mode === 'reject') {
      const adjudicate = async () => verdict({ decision: 'reject', reason: 'capability_duplicate_of_line04' });
      let threw = null;
      try {
        await runCapabilityGate(db, { changeKind: 'new_capability', stepId: STEP_ID, request: { source_id: 'e2e-reject' }, adjudicate });
      } catch (e) { threw = e; }
      if (!threw || threw.code !== 'capability_gate_rejected') throw new Error(`reject 未 fail-closed: ${threw && threw.code}`);
      if (!String(threw.reason || '').includes('duplicate')) throw new Error('拒绝原因不可查');
      const c = await countNfrRow(db);
      if (c !== 0) throw new Error(`reject 却写了 ${c} 行 nfr(应 0)`);
      console.log(`OK reject: code=${threw.code} reason=${threw.reason} rows=${c}`);
    } else if (mode === 'incomplete') {
      const adjudicate = async () => verdict({ nfr: { cost_ceiling: 1, latency_ceiling: 100 } });
      let threw = null;
      try {
        await runCapabilityGate(db, { changeKind: 'new_capability', stepId: STEP_ID, request: { source_id: 'e2e-inc' }, adjudicate });
      } catch (e) { threw = e; }
      if (!threw || threw.code !== 'capability_gate_contract_incomplete') throw new Error(`不完整产物未 fail-closed: ${threw && threw.code}`);
      const c = await countNfrRow(db);
      if (c !== 0) throw new Error(`incomplete 却写了 ${c} 行(应 0)`);
      console.log(`OK incomplete: code=${threw.code} rows=${c}`);
    } else if (mode === 'regression') {
      const facts = [{ repo: 'perfectuser21/cecelia', path: '/workspace' }];
      const base = { source: 'api', source_id: 'e2e-reg', title: 't', mutation_intent: 'write', repo_hint: 'perfectuser21/cecelia', branch: 'cp-x', base_sha: 'a'.repeat(40), decided_at: '2026-08-13T00:00:00.000Z' };
      const bug = routeWork({ ...base, declared_change_kind: 'bugfix' }, facts);
      const param = routeWork({ ...base, declared_change_kind: 'parameter_only' }, facts);
      if (bug.pipeline !== 'harness' || bug.default_execution_profile !== 'hotfix-v1') throw new Error('bugfix 路由被破坏');
      if (param.default_execution_profile !== 'parameter-only-v1') throw new Error('parameter_only 路由被破坏');
      console.log('OK regression: 非 new_capability 路由行为不变');
    } else {
      throw new Error(`未知 mode=${mode}`);
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(`FAIL(${mode}): ${e.message}`); process.exit(1); });
