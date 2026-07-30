#!/usr/bin/env bash
# t10-capture-atom-routing-smoke.sh — T10 统一收件箱路由补齐 真环境验证
#
# 验证 11 处 INSERT INTO learnings 调用点已接入 pushCaptureAtom（真源码检查）
# + 真实 Postgres 端到端触发（auto-learning.js::createAutoLearning 写 learnings
# 后，capture_atoms 应在 5 分钟窗口内同步新增对应记录）。
#
# task_id: 9f24e3a9-683e-4151-9323-f4a9170242c8
# 用法: DATABASE_URL=<postgres_url> bash t10-capture-atom-routing-smoke.sh

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

DB="${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia_test}"

echo "[t10-capture-atom-routing-smoke] 1. 检查 8 个源文件均已引用 pushCaptureAtom"
node -e "
const fs = require('fs');
const files = [
  'packages/brain/src/cortex.js',
  'packages/brain/src/executor.js',
  'packages/brain/src/conversation-consolidator.js',
  'packages/brain/src/learning.js',
  'packages/brain/src/auto-learning.js',
  'packages/brain/src/chat-action-dispatcher.js',
  'packages/brain/src/decision-executor.js',
  'packages/brain/src/fact-extractor.js',
];
let missing = [];
for (const f of files) {
  const c = fs.readFileSync(f, 'utf8');
  if (!c.includes('pushCaptureAtom')) missing.push(f);
}
if (missing.length > 0) {
  console.error('FAIL: 以下文件缺少 pushCaptureAtom 引用:', missing.join(', '));
  process.exit(1);
}
console.log('8 个源文件均已引用 pushCaptureAtom ✓');
"

echo "[t10-capture-atom-routing-smoke] 2. 结构性回归测试（source-code inspection，零 mock）"
(cd packages/brain && npx vitest run src/__tests__/learnings-capture-atom-routing.test.js --reporter=verbose)

echo "[t10-capture-atom-routing-smoke] 3. cortex.js::recordLearnings 行为级复现测试"
(cd packages/brain && npx vitest run src/__tests__/cortex-learnings-capture-push.test.js --reporter=verbose)

echo "[t10-capture-atom-routing-smoke] 4. 已接入 2 处防回归护栏"
(cd packages/brain && npx vitest run src/__tests__/learning-capture-push.test.js src/__tests__/learnings-received.test.js --reporter=verbose)

echo "[t10-capture-atom-routing-smoke] 5. 真实触发（零 mock，真 Postgres）— auto-learning.js::createAutoLearning"
MARKER_TITLE="smoke-t10-$(date +%s)-${RANDOM}"

RESULT=$(cd packages/brain && node --input-type=module -e "
import { createAutoLearning } from './src/auto-learning.js';
import pool from './src/db.js';
const r = await createAutoLearning({
  title: '${MARKER_TITLE}',
  category: 'dev_insight',
  content: 'smoke 验证：createAutoLearning 写 learnings 后应同步推送 capture_atoms',
  triggerEvent: 'smoke_verify',
  metadata: {},
});
console.log(JSON.stringify(r));
await pool.end();
")

echo "$RESULT" | grep -q '"id"' || { echo "FAIL: createAutoLearning 未返回 id（learnings 主写入未成功）"; exit 1; }
echo "  learning 写入结果: $RESULT"

COUNT=$(psql "$DB" -t -c "
  SELECT count(*) FROM capture_atoms ca
  JOIN captures c ON c.id = ca.capture_id
  WHERE ca.target_type = 'learning'
    AND c.content ILIKE '%${MARKER_TITLE}%'
    AND ca.created_at > NOW() - interval '5 minutes'
" | tr -d ' ')

if [ "$COUNT" -ge 1 ]; then
  echo "  ✓ capture_atoms 已同步产出 marker=${MARKER_TITLE} count=${COUNT}"
else
  echo "FAIL: capture_atoms 未在 5 分钟窗口内同步产出 marker=${MARKER_TITLE}"
  exit 1
fi

echo "[t10-capture-atom-routing-smoke] 全部检查通过 ✓"
