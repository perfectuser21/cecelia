/**
 * CORE-INV-02 — P0 铁律「租户隔离」proven-to-fire 断言。
 *
 * 守卫落点：packages/brain/src/lib/contract-gate.js 的 domain/tenant-no-isolation 规则
 * （多租户面上的 DB 探测不带 tenant_id 约束 → 可能跨租户读/改，代码层硬拦；
 *  误报走 gate-allow: domain/tenant-no-isolation 单条豁免留痕，fail-open 逃生口）。
 *
 * 断言三件事：
 *  1. RULES 里租户隔离规则仍然存在（防被删/改 id 静默放水）；
 *  2. proven-to-fire：喂涉及多租户面却无隔离约束的合同 → 必须命中且整体不通过；
 *  3. 不误伤：带 tenant_id 等值约束的同类探测 → 不得命中。
 *
 * CI 干净环境兼容：只用 node 内建 + 仓库内零依赖源文件，不 curl/psql/docker。
 */
import {
  evaluateContractText,
  RULES,
  isTenantProbeWithoutIsolation,
} from '../../../packages/brain/src/lib/contract-gate.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const TENANT_RULE_ID = 'domain/tenant-no-isolation';

console.log('== CORE-INV-02 租户隔离（contract-gate 租户红线）==');

// 1) 规则存在性
check(
  `RULES 含 ${TENANT_RULE_ID} 规则`,
  RULES.some((r) => r.id === TENANT_RULE_ID),
  `现有规则: ${RULES.map((r) => r.id).join(', ')}`
);
check(
  'isTenantProbeWithoutIsolation 判定函数存在',
  typeof isTenantProbeWithoutIsolation === 'function'
);

// 2) proven-to-fire：多租户面探测无隔离约束 → 命中
const violatingContract = [
  '# Sprint 验收合同（违规样本：跨租户探测）',
  '```bash',
  'psql "$DATABASE_URL" -c "SELECT email FROM tenant_users WHERE status = \'active\'"',
  '```',
].join('\n');
const bad = evaluateContractText(violatingContract);
const tenantHits = bad.hits.filter((h) => h.ruleId === TENANT_RULE_ID && !h.exempted);
check('违规合同（tenant 面无隔离约束）命中租户红线', tenantHits.length > 0,
  `hits=${JSON.stringify(bad.hits.map((h) => h.ruleId))}`);
check('违规合同整体不通过（ok=false）', bad.ok === false, `ok=${bad.ok}`);

// 3) 不误伤：带 tenant_id 等值约束的同类探测放行
const cleanContract = [
  '# Sprint 验收合同（干净样本：带租户隔离约束）',
  '```bash',
  'psql "$DATABASE_URL" -c "SELECT email FROM tenant_users WHERE tenant_id = \'$TENANT_ID\' AND status = \'active\'"',
  '```',
].join('\n');
const good = evaluateContractText(cleanContract);
const falsePositive = good.hits.filter((h) => h.ruleId === TENANT_RULE_ID);
check('带 tenant_id 约束的探测不命中（不误伤）', falsePositive.length === 0,
  `误命中: ${JSON.stringify(falsePositive)}`);

// 4) fail-open 逃生口：gate-allow 单条豁免机制对本规则生效
const exemptedContract = [
  '# Sprint 验收合同（豁免样本）',
  `gate-allow: ${TENANT_RULE_ID} 该表实为单租户共享配置表`,
  '```bash',
  // 带时间窗（避免与 domain/db-no-time-window 叠加，只留租户规则一条命中面）
  'psql "$DATABASE_URL" -c "SELECT email FROM tenant_users WHERE status = \'active\' AND created_at > NOW() - interval \'5 minutes\'"',
  '```',
].join('\n');
const exempted = evaluateContractText(exemptedContract);
check(
  'gate-allow 豁免后整体通过（fail-open 逃生口有效）',
  exempted.ok === true &&
    exempted.hits.some((h) => h.ruleId === TENANT_RULE_ID && h.exempted),
  `ok=${exempted.ok} hits=${JSON.stringify(exempted.hits)}`
);

if (failures > 0) {
  console.error(`== CORE-INV-02 FAIL（${failures} 项）— 铁律「租户隔离」守卫被破坏 ==`);
  process.exit(1);
}
console.log('== CORE-INV-02 PASS ==');
