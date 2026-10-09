#!/usr/bin/env node
// 三镜头能力级前置门禁 E2E 驱动（辅助驱动，非 it() 测试；刻意置于 sprint 根，不计入冻结集）。
//
// 用注入的确定性 verdict 驱动真实 runCapabilityGate（真 pg.Client → 真 decisions 落库），
// 覆盖 contract-draft Golden Path 三步 + DoD BEHAVIOR：
//   pass <stepId>        过闸落库（decisions 出 nfr/step/journey_step 行）
//   reject <stepId>      三镜头判 reject → fail-closed（capability_gate_rejected），不落库
//   incomplete <stepId>  postcondition/NFR 不完整 → fail-closed（capability_gate_contract_incomplete），不落库
//   regression           非 new_capability（bugfix/parameter_only）路由行为不变（不接 DB）
import pg from 'pg';
import { runCapabilityGate } from '../../packages/brain/src/capability-gate.js';
import { routeWork } from '../../packages/brain/src/work-router.js';

const POSTCONDITION = 'new_capability X 上线后，routeWork 对该能力必经三镜头且门禁产物落 decisions';

function verdictFor(mode) {
  const base = {
    decision: 'pass',
    reason: 'novel capability, scoped, correctly homed',
    postcondition: POSTCONDITION,
    nfr: { cost_ceiling: 2.5, latency_ceiling: 8000, success_floor: 0.9 },
  };
  if (mode === 'reject') return { ...base, decision: 'reject', reason: 'capability_duplicate_of_line04' };
  if (mode === 'incomplete') return { ...base, nfr: { cost_ceiling: 1, latency_ceiling: 100 } }; // 缺 success_floor
  return base;
}

const REPOSITORY_FACTS = [{ scope_key: 'cecelia', repo: 'cecelia', path: '.', aliases: ['perfectuser21/cecelia'] }];

function baseRequest(overrides = {}) {
  return {
    source: 'api',
    source_id: `gate-e2e-${overrides.declared_change_kind ?? 'x'}`,
    title: 'gate e2e driver request',
    mutation_intent: 'write',
    repo_hint: 'cecelia',
    map_scope_hint: ['F1'],
    branch: 'cp-route-gate-e2e',
    base_sha: 'a'.repeat(40),
    ...overrides,
  };
}

async function runGateMode(mode, stepId) {
  if (!stepId) throw new Error(`mode ${mode} 需要 stepId 参数`);
  const dbUrl = process.env.DB_URL;
  if (!dbUrl) throw new Error('DB_URL 未注入');
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  const db = { query: (sql, params) => client.query(sql, params) };
  const adjudicate = async () => verdictFor(mode);
  try {
    const result = await runCapabilityGate(db, {
      changeKind: 'new_capability',
      stepId,
      request: { source_id: `gate-e2e-${mode}` },
      adjudicate,
    });
    if (mode === 'pass') {
      console.log(`OK pass decision_id=${result.decision_id} step=${stepId}`);
      return;
    }
    console.error(`FAIL: mode=${mode} 预期 fail-closed 抛错，却放行 ${JSON.stringify(result)}`);
    process.exitCode = 1;
  } catch (err) {
    if (mode === 'reject') {
      if (err.code === 'capability_gate_rejected') {
        console.log(`OK reject code=${err.code} reason=${err.reason}`);
        return;
      }
    } else if (mode === 'incomplete') {
      if (err.code === 'capability_gate_contract_incomplete') {
        console.log(`OK incomplete code=${err.code}`);
        return;
      }
    }
    console.error(`FAIL: mode=${mode} 抛出非预期错误`, err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`regression 断言失败：${label} 实际=${actual} 期望=${expected}`);
  }
}

function runRegression() {
  const bugfix = routeWork(baseRequest({ declared_change_kind: 'bugfix' }), REPOSITORY_FACTS);
  assertEqual(bugfix.pipeline, 'harness', 'bugfix.pipeline');
  assertEqual(bugfix.default_execution_profile, 'hotfix-v1', 'bugfix.default_execution_profile');

  const paramOnly = routeWork(baseRequest({ declared_change_kind: 'parameter_only' }), REPOSITORY_FACTS);
  assertEqual(paramOnly.pipeline, 'harness', 'parameter_only.pipeline');
  assertEqual(paramOnly.default_execution_profile, 'parameter-only-v1', 'parameter_only.default_execution_profile');

  console.log('OK regression bugfix=hotfix-v1 parameter_only=parameter-only-v1');
}

async function main() {
  const [mode, stepId] = process.argv.slice(2);
  switch (mode) {
    case 'pass':
    case 'reject':
    case 'incomplete':
      await runGateMode(mode, stepId);
      break;
    case 'regression':
      runRegression();
      break;
    default:
      console.error(`未知 mode: ${mode}（支持 pass|reject|incomplete|regression）`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('driver 异常', err);
  process.exitCode = 1;
});
