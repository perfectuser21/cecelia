/**
 * CORE-INV-01 — P0 铁律「真环境非 mock」proven-to-fire 断言。
 *
 * 守卫落点：packages/brain/src/lib/contract-gate.js 的 cheat/mock-env 规则
 * （spawn evaluator 前的确定性合同预检——"用 mock 环境糊弄验收"的合同在代码层被拦，
 *  不依赖 LLM 自觉）。
 *
 * 断言三件事：
 *  1. RULES 里 mock 红线规则（cheat/mock-env）仍然存在（防被删/改 id 静默放水）；
 *  2. proven-to-fire：喂一段注入 MOCK_* 假环境的违规合同 → gate 必须命中且整体不通过；
 *  3. 不误伤：喂一段读真实环境的干净合同 → 不得命中 mock 类规则。
 *
 * CI 干净环境兼容：只用 node 内建 + 仓库内零依赖源文件，不 curl/psql/docker。
 */
import { evaluateContractText, RULES } from '../../../packages/brain/src/lib/contract-gate.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const MOCK_RULE_ID = 'cheat/mock-env';

console.log('== CORE-INV-01 真环境非 mock（contract-gate mock 红线）==');

// 1) 规则存在性（防静默删除）
check(
  `RULES 含 ${MOCK_RULE_ID} 规则`,
  RULES.some((r) => r.id === MOCK_RULE_ID),
  `现有规则: ${RULES.map((r) => r.id).join(', ')}`
);

// 2) proven-to-fire：mock 环境糊弄验收的合同必须被命中
const violatingContract = [
  '# Sprint 验收合同（违规样本：mock 环境糊弄验收）',
  '```bash',
  'MOCK_API_URL=http://localhost:9999 MOCK_DB=1 node run-e2e.js',
  'echo done',
  '```',
].join('\n');
const bad = evaluateContractText(violatingContract);
const mockHits = bad.hits.filter((h) => h.ruleId === MOCK_RULE_ID && !h.exempted);
check('违规合同（MOCK_* 注入）命中 mock 红线（hits 非空）', mockHits.length > 0,
  `hits=${JSON.stringify(bad.hits.map((h) => h.ruleId))}`);
check('违规合同整体不通过（ok=false）', bad.ok === false, `ok=${bad.ok}`);

// 3) 不误伤：读真实环境的干净合同不得命中 mock 类规则
const cleanContract = [
  '# Sprint 验收合同（干净样本：真实环境）',
  '```bash',
  "curl -s http://localhost:5221/api/brain/health | jq -e '.ok == true'",
  '```',
].join('\n');
const good = evaluateContractText(cleanContract);
const falsePositive = good.hits.filter((h) => h.ruleId === MOCK_RULE_ID);
check('干净合同不命中 mock 规则（不误伤）', falsePositive.length === 0,
  `误命中: ${JSON.stringify(falsePositive)}`);
check('干净合同整体通过（ok=true）', good.ok === true,
  `hits=${JSON.stringify(good.hits.map((h) => h.ruleId))}`);

if (failures > 0) {
  console.error(`== CORE-INV-01 FAIL（${failures} 项）— 铁律「真环境非 mock」守卫被破坏 ==`);
  process.exit(1);
}
console.log('== CORE-INV-01 PASS ==');
