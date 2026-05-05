#!/usr/bin/env bash
# Smoke: insight → dispatch_constraint 同次 session 自动转化
# 验证：
#   1. insight-to-constraint.js 存在且 export 三函数
#   2. cortex.js 已 import + 调用 autoExtractAndPersist
#   3. lint-learning-constraint-coverage.sh 可执行通过
#   4. 启发式抽取在典型 insight 上输出有效 DSL（pure-function check, 不依赖 DB）
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "[learning-to-constraint-smoke] 1. 检查 insight-to-constraint.js 存在并 export 三函数"
node -e "
const fs = require('fs');
const SRC = 'packages/brain/src/insight-to-constraint.js';
if (!fs.existsSync(SRC)) { console.error('FAIL: ' + SRC + ' 不存在'); process.exit(1); }
const src = fs.readFileSync(SRC, 'utf8');
const required = ['extractConstraintHeuristic', 'persistConstraint', 'autoExtractAndPersist'];
const missing = required.filter(fn => !src.match(new RegExp('export[^\\\\n]+' + fn)));
if (missing.length > 0) { console.error('FAIL: 缺少 export:', missing.join(', ')); process.exit(1); }
console.log('insight-to-constraint.js 含三 export ✓');
"

echo "[learning-to-constraint-smoke] 2. 验证 cortex.js 已集成"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/cortex.js', 'utf8');
if (!src.includes(\"from './insight-to-constraint\")) {
  console.error('FAIL: cortex.js 未 import insight-to-constraint'); process.exit(1);
}
if (!src.includes('autoExtractAndPersist')) {
  console.error('FAIL: cortex.js 未调用 autoExtractAndPersist'); process.exit(1);
}
console.log('cortex.js 集成点已就位 ✓');
"

echo "[learning-to-constraint-smoke] 3. 验证 lint 脚本通过"
bash .github/workflows/scripts/lint-learning-constraint-coverage.sh

echo "[learning-to-constraint-smoke] 4. 启发式抽取在典型样本上输出有效 DSL"
node --input-type=module -e "
import { extractConstraintHeuristic } from './packages/brain/src/insight-to-constraint.js';
import { isValidConstraint } from './packages/brain/src/insight-constraints.js';

const cases = [
  { input: 'task title 中禁止使用 \"force-merge\" 关键字。', expectRule: 'deny_keyword' },
  { input: 'retry 任务必须含 payload.parent_task_id 才能追溯。',     expectRule: 'require_payload' },
  { input: '任务 title 至少 12 字才能避免歧义。',                    expectRule: 'require_field' },
];
let ok = true;
for (const c of cases) {
  const constraint = extractConstraintHeuristic(c.input);
  if (!constraint || constraint.rule !== c.expectRule) {
    console.error('FAIL: 输入', JSON.stringify(c.input), '期望 rule=' + c.expectRule, '实际', JSON.stringify(constraint));
    ok = false;
    continue;
  }
  if (!isValidConstraint(constraint)) {
    console.error('FAIL: 输出 DSL 未通过 isValidConstraint:', JSON.stringify(constraint));
    ok = false;
  }
}
if (!ok) process.exit(1);
console.log('启发式抽取 3 case 全 pass ✓');
"

echo "[learning-to-constraint-smoke] 全部检查通过 ✓"
