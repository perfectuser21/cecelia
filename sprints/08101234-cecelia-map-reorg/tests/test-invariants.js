/**
 * test-invariants.js — Cecelia 承诺地图归位 · Invariant 合同测试
 * 覆盖 INV-1 至 INV-9 全部 9 条铁律
 *
 * 运行：
 *   node sprints/08101234-cecelia-map-reorg/tests/test-invariants.js
 *
 * 环境变量：
 *   BRAIN_URL  默认 http://localhost:5221
 *   DB_URL     可选，直连 PostgreSQL（如 postgres://user:pass@localhost/cecelia）
 */

'use strict';

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

// ─── 工具函数 ──────────────────────────────────────────────────────────────

async function brainQuery(sql) {
  const res = await fetch(`${BRAIN_URL}/api/brain/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw new Error(`Brain query failed: ${res.status} — ${await res.text()}`);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : (data.rows || data.data || []);
  return rows;
}

async function brainQueryScalar(sql) {
  const rows = await brainQuery(sql);
  if (!rows.length) return null;
  return Object.values(rows[0])[0];
}

// ─── 测试框架（极简） ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (e) {
    console.log(`  [FAIL] ${name}`);
    console.log(`         ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${label || ''}: expected=${expected}, actual=${actual}`);
  }
}

// ─── Brain 连通性检查 ──────────────────────────────────────────────────────

async function checkHealth() {
  const res = await fetch(`${BRAIN_URL}/api/brain/health`);
  if (!res.ok) throw new Error(`Brain 不可达: ${BRAIN_URL} (status=${res.status})`);
}

// ─── INV-1：已有 journey 行不得 DELETE ────────────────────────────────────

async function inv1_no_journey_deleted() {
  // 验证：迁移前已知的 10 条 active/deprecated journey 行均应存在
  // 已知 ID 前缀（来自 PRD 实测快照）
  const knownIds = [
    '743f0e7c', // F0
    'e6f803f2', // F1
    '2fa4d085', // F2
    'ec4eb591', // F3
    '91c17939', // F4
    '8bb8252f', // F5→G1
    '824ee0f5', // F6→G2
    'a824b567', // F7→G4
    '51754939', // MJ5
    '0c1f70f1', // 西安机群
  ];
  for (const prefix of knownIds) {
    const count = await brainQueryScalar(
      `SELECT COUNT(*)::text FROM journeys WHERE id::text LIKE '${prefix}%'`
    );
    assertEqual(count, '1', `journey ${prefix}... 行应存在（禁止 DELETE）`);
  }
}

// ─── INV-2：in_progress 任务 journey_id 迁移后仍可解析 ────────────────────

async function inv2_task_anchors_intact() {
  const danglingCount = await brainQueryScalar(
    `SELECT COUNT(*)::text
     FROM tasks t
     WHERE t.status = 'in_progress'
       AND t.journey_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM journeys j WHERE j.id = t.journey_id
       )`
  );
  assertEqual(danglingCount, '0', 'in_progress 任务无悬空 journey_id FK');
}

// ─── INV-3：全部 schema 变更走 migration 文件 ─────────────────────────────

async function inv3_migration_files_exist() {
  const { existsSync, readdirSync } = await import('fs');
  const { resolve } = await import('path');
  const { fileURLToPath } = await import('url');

  // 从测试文件位置推断 workspace 根
  const wsRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
  const migDir = resolve(wsRoot, 'packages/brain/migrations');

  for (const num of [397, 398, 399, 400]) {
    const files = readdirSync(migDir).filter(f => f.startsWith(`${num}_`) && f.endsWith('.sql'));
    assert(files.length >= 1, `migration ${num} 文件不存在（目录: ${migDir}）`);
  }

  // selfcheck EXPECTED_SCHEMA_VERSION 必须为 400
  const { readFileSync } = await import('fs');
  const selfcheck = readFileSync(resolve(wsRoot, 'packages/brain/src/selfcheck.js'), 'utf8');
  assert(
    selfcheck.includes("EXPECTED_SCHEMA_VERSION = '400'"),
    "selfcheck.js EXPECTED_SCHEMA_VERSION 不是 '400'（INV-6 同步验证）"
  );
}

// ─── INV-4：孤儿 journey_features 归位或 deprecated，禁止 DELETE ──────────

async function inv4_orphan_features_handled() {
  // 活跃孤儿必须为 0
  const activeOrphans = await brainQueryScalar(
    `SELECT COUNT(*)::text FROM journey_features
     WHERE journey_id IS NULL AND status != 'deprecated'`
  );
  assertEqual(activeOrphans, '0', '活跃孤儿 journey_features 必须清零（归位或 deprecated）');

  // deprecated 孤儿必须 ≥1（验证未被物理删除，留档）
  const deprecatedOrphans = await brainQueryScalar(
    `SELECT COUNT(*)::text FROM journey_features
     WHERE journey_id IS NULL AND status = 'deprecated'`
  );
  assert(
    parseInt(deprecatedOrphans, 10) >= 1,
    `deprecated 孤儿数应≥1（留档），实际=${deprecatedOrphans}。禁止 DELETE 孤儿行。`
  );
}

// ─── INV-5：migration 必须有 rollback SQL ─────────────────────────────────

async function inv5_rollback_files_exist() {
  const { readdirSync } = await import('fs');
  const { resolve } = await import('path');
  const { fileURLToPath } = await import('url');

  const wsRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
  const rollbackDir = resolve(wsRoot, 'packages/brain/migrations/rollback');

  for (const num of [397, 398, 399, 400]) {
    const files = readdirSync(rollbackDir).filter(
      f => f.startsWith(`${num}_`) && f.endsWith('.down.sql')
    );
    assert(files.length >= 1, `rollback ${num}_*.down.sql 不存在（INV-5 up/down 对称）`);
  }
}

// ─── INV-6：selfcheck.js EXPECTED_SCHEMA_VERSION=400 ─────────────────────

async function inv6_schema_version_updated() {
  // 已在 inv3 中顺带验证，这里通过 Brain healthcheck 的 schema 报告来二次确认
  const health = await fetch(`${BRAIN_URL}/api/brain/health`).then(r => r.json()).catch(() => ({}));
  // 如果 health 报告 schema 不匹配会有 warn，但具体格式依实现而定
  // 主要断言来自文件内容（inv3 已覆盖），这里验证 Brain 能正常启动（schema version >= 400）
  const schemaOk = !JSON.stringify(health).includes('behind expected');
  assert(schemaOk, `Brain health 报告 schema 版本落后，selfcheck 未同步至 400: ${JSON.stringify(health)}`);
}

// ─── INV-7：分拣规则机器可核查（audit 记录存在）────────────────────────────

async function inv7_audit_record_exists() {
  const count = await brainQueryScalar(
    `SELECT COUNT(*)::text FROM working_memory
     WHERE key = 'migration_audit:399_orphan_triage'`
  );
  assert(parseInt(count, 10) >= 1, `migration_audit:399_orphan_triage 记录不存在（INV-7 机器可核查要求）`);

  // 内容完整性：必须有 triage_log 字段
  const auditRow = await brainQuery(
    `SELECT value FROM working_memory WHERE key = 'migration_audit:399_orphan_triage' LIMIT 1`
  );
  if (auditRow.length) {
    const val = auditRow[0].value;
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    assert('triage_log' in parsed, `audit 记录缺少 triage_log 字段，实际 keys: ${Object.keys(parsed)}`);
    assert(Array.isArray(parsed.triage_log), `triage_log 应为数组，实际: ${typeof parsed.triage_log}`);
  }
}

// ─── INV-8：横切件 7 项有可查询登记记录 ──────────────────────────────────

async function inv8_xcut_pool_complete() {
  const totalCount = await brainQueryScalar(
    `SELECT COUNT(*)::text FROM working_memory WHERE key LIKE 'xcut::%'`
  );
  assertEqual(totalCount, '7', '横切件池 working_memory 记录总数');

  const expectedKeys = [
    'xcut::heartbeat',
    'xcut::credential_chain',
    'xcut::executor_pool',
    'xcut::skill_dispatch',
    'xcut::alert_chain',
    'xcut::database',
    'xcut::network',
  ];

  for (const key of expectedKeys) {
    const cnt = await brainQueryScalar(
      `SELECT COUNT(*)::text FROM working_memory WHERE key='${key}'`
    );
    assertEqual(cnt, '1', `${key} 登记记录`);

    // 内容验证：必须有 owner_capability_code
    const row = await brainQuery(
      `SELECT value FROM working_memory WHERE key='${key}' LIMIT 1`
    );
    if (row.length) {
      const val = typeof row[0].value === 'string' ? JSON.parse(row[0].value) : row[0].value;
      assert(
        val.owner_capability_code && val.owner_capability_code.length > 0,
        `${key} 缺少 owner_capability_code 字段`
      );
    }
  }

  // owner 合法性：F1/F4 是唯一合法的横切件主管 Capability
  const validOwners = new Set(['F1', 'F4']);
  const rows = await brainQuery(
    `SELECT key, value->>'owner_capability_code' AS owner FROM working_memory WHERE key LIKE 'xcut::%'`
  );
  for (const r of rows) {
    assert(
      validOwners.has(r.owner),
      `${r.key} 的 owner_capability_code='${r.owner}' 不在合法集合 [F1, F4] 中`
    );
  }
}

// ─── INV-9：2 条价值流 + 11 个 Capability 结构正确（CI 数据层验证）────────

async function inv9_structure_correct() {
  // value_stream 数量
  const vsCount = await brainQueryScalar(
    `SELECT COUNT(*)::text FROM journeys WHERE type='value_stream' AND status='active'`
  );
  assertEqual(vsCount, '2', 'active value_stream 数量');

  // 工厂 6 个 Capability
  const factoryCount = await brainQueryScalar(
    `SELECT COUNT(*)::text
     FROM journeys c
     JOIN journeys j ON j.id = c.parent_journey_id
     WHERE j.type='value_stream' AND j.name='工厂'
       AND c.type='capability' AND c.status='active'`
  );
  assertEqual(factoryCount, '6', '工厂 active capability 数量');

  // 管家 5 个 Capability
  const stewardCount = await brainQueryScalar(
    `SELECT COUNT(*)::text
     FROM journeys c
     JOIN journeys j ON j.id = c.parent_journey_id
     WHERE j.type='value_stream' AND j.name='管家'
       AND c.type='capability' AND c.status='active'`
  );
  assertEqual(stewardCount, '5', '管家 active capability 数量');

  // capability_code 覆盖：F0-F4/MJ5 归工厂，G1-G5 归管家
  const factoryCodes = ['F0', 'F1', 'F2', 'F3', 'F4', 'MJ5'];
  const stewardCodes = ['G1', 'G2', 'G3', 'G4', 'G5'];

  for (const code of factoryCodes) {
    const cnt = await brainQueryScalar(
      `SELECT COUNT(*)::text FROM journeys
       WHERE capability_code='${code}' AND type='capability' AND status='active'`
    );
    assertEqual(cnt, '1', `工厂 capability_code=${code}`);
  }
  for (const code of stewardCodes) {
    const cnt = await brainQueryScalar(
      `SELECT COUNT(*)::text FROM journeys
       WHERE capability_code='${code}' AND type='capability' AND status='active'`
    );
    assertEqual(cnt, '1', `管家 capability_code=${code}`);
  }
}

// ─── 主运行 ───────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Cecelia 承诺地图归位 · INV-1 至 INV-9 合同测试 ===');
  console.log(`Brain URL: ${BRAIN_URL}`);
  console.log('');

  try {
    await checkHealth();
  } catch (e) {
    console.error(`[ERROR] Brain 不可达: ${e.message}`);
    console.error('请先启动 Brain: cd packages/brain && npm start');
    process.exit(2);
  }

  console.log('--- INV-1: 已有 journey 行不得 DELETE ---');
  await test('已知 10 条 journey 行全部存在', inv1_no_journey_deleted);

  console.log('');
  console.log('--- INV-2: in_progress 任务锚点保护 ---');
  await test('无悬空 journey_id FK', inv2_task_anchors_intact);

  console.log('');
  console.log('--- INV-3: schema 变更走 migration 文件 ---');
  await test('migration 397-400 文件存在 + selfcheck 版本', inv3_migration_files_exist);

  console.log('');
  console.log('--- INV-4: 孤儿 journey_features 归位/归档（禁 DELETE）---');
  await test('活跃孤儿=0, deprecated 孤儿≥1（留档）', inv4_orphan_features_handled);

  console.log('');
  console.log('--- INV-5: migration 有 rollback SQL ---');
  await test('rollback 397-400 .down.sql 文件全部存在', inv5_rollback_files_exist);

  console.log('');
  console.log('--- INV-6: selfcheck EXPECTED_SCHEMA_VERSION=400 ---');
  await test('Brain health 无 schema 落后报警', inv6_schema_version_updated);

  console.log('');
  console.log('--- INV-7: 分拣规则机器可核查（audit 记录）---');
  await test('migration_audit:399_orphan_triage 含 triage_log', inv7_audit_record_exists);

  console.log('');
  console.log('--- INV-8: 横切件 7 项登记完整 ---');
  await test('7 项 xcut::* 记录存在且 owner 合法', inv8_xcut_pool_complete);

  console.log('');
  console.log('--- INV-9: 2 价值流 + 11 Capability 结构验证 ---');
  await test('2 VS + 工厂6 + 管家5 + 所有 capability_code', inv9_structure_correct);

  console.log('');
  console.log('==========================================');
  console.log(`结果: PASS=${passed} / TOTAL=${passed + failed}  FAIL=${failed}`);
  console.log('==========================================');

  if (failed > 0) {
    console.log(`\n存在 ${failed} 项失败，请修复后重新运行。`);
    process.exit(1);
  } else {
    console.log('\n全部铁律（INV-1 至 INV-9）验收通过。');
    process.exit(0);
  }
}

main().catch(e => {
  console.error('[FATAL]', e.message);
  process.exit(2);
});
