#!/usr/bin/env bash
# Smoke: 飞书群交办入账（决策 1c6679cd / 判定点 398d5f36）
# 真行为验证重点：入账状态绝不产出 queued——queued + claimed_by IS NULL 会被 Brain tick
# 每 2 分钟捡走，真去"执行"群里的客户对话。这条靠 grep 验不出来，必须真跑。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

MODULE="packages/brain/src/feishu-task-ledger.js"

echo "[feishu-task-ledger-smoke] 1. 模块存在且导出三道判据"
for fn in selectCandidates classifyCandidates dedupeResends resolveReplyEvidence \
          buildTaskRequest runFeishuTaskLedger maybeRunFeishuTaskLedger; do
  if ! grep -q "export \(async \)\?function $fn" "$MODULE"; then
    echo "FAIL: 缺少导出 $fn"
    exit 1
  fi
done
echo "OK: 七个导出齐全"

echo "[feishu-task-ledger-smoke] 2. 禁止读第三方明文配置（凭据只走 env）"
# 只查非注释行——注释里写明"来源/不读"是允许的，代码里真读才是问题
if grep -vE '^\s*(\*|//|/\*)' "$MODULE" | grep -q "clawdbot.json"; then
  echo "FAIL: 模块代码直接读 OpenClaw clawdbot.json（内含明文 appSecret）"
  exit 1
fi
if ! grep -q "env.FEISHU_APP_ID" "$MODULE"; then
  echo "FAIL: 未从 env 读 FEISHU_APP_ID"
  exit 1
fi
echo "OK: 凭据只从 env 读"

echo "[feishu-task-ledger-smoke] 3. task-creation-inventory 已登记且非可执行任务"
if ! grep -q "module: 'feishu-task-ledger.js'" packages/brain/src/task-creation-inventory.js; then
  echo "FAIL: 未在 task-creation-inventory.js 登记"
  exit 1
fi
if ! grep -A0 "module: 'feishu-task-ledger.js'" packages/brain/src/task-creation-inventory.js \
     | grep -q "creates_executable_task: false"; then
  echo "FAIL: 登记项必须 creates_executable_task: false（账本留痕，不产可执行任务）"
  exit 1
fi
echo "OK: inventory 登记正确"

echo "[feishu-task-ledger-smoke] 4. scheduler 已注册"
if ! grep -q "feishu-task-ledger" packages/brain/src/scheduler-jobs.js; then
  echo "FAIL: scheduler-jobs.js 未注册"
  exit 1
fi
echo "OK: scheduler 已注册"

echo "[feishu-task-ledger-smoke] 5. 真行为：入账状态绝不产出 queued"
cd packages/brain
node --input-type=module -e "
import { buildTaskRequest } from './src/feishu-task-ledger.js';
const head = {
  message_id: 'om_smoke', create_time: '1789500000000',
  sender: { sender_type: 'user', id: 'ou_alex' },
  body: { content: JSON.stringify({ text: '帮我建三个飞书文档' }) },
};
const group = { chatId: 'c', name: 'g', requireMention: true };
for (const replied of [true, false]) {
  const r = buildTaskRequest({ head, messageIds: ['om_smoke'], group, botReplied: replied, contextText: '' });
  if (r.task.status === 'queued') {
    console.error('FAIL: botReplied=' + replied + ' 产出了 queued —— 会被 tick 捡走真执行群消息');
    process.exit(1);
  }
  if (!['completed', 'blocked'].includes(r.task.status)) {
    console.error('FAIL: 非预期状态 ' + r.task.status);
    process.exit(1);
  }
  if (r.source !== 'inbox' || r.source_id !== 'om_smoke') {
    console.error('FAIL: 幂等键未用飞书 message_id');
    process.exit(1);
  }
}
console.log('OK: completed/blocked 二选一，无 queued，幂等键为 message_id');
"
cd "$ROOT_DIR"

echo "[feishu-task-ledger-smoke] 6. 缺凭据时优雅跳过（不得抛错阻塞 scheduler）"
cd packages/brain
node --input-type=module -e "
import { runFeishuTaskLedger } from './src/feishu-task-ledger.js';
const out = await runFeishuTaskLedger({}, { env: {} });
if (out.skipped !== 'missing_credentials') {
  console.error('FAIL: 缺凭据未走跳过分支, got ' + JSON.stringify(out));
  process.exit(1);
}
console.log('OK: 缺凭据跳过');
"
cd "$ROOT_DIR"

echo "[feishu-task-ledger-smoke] 7. 单元测试跑通"
cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js --reporter=basic 2>&1 | tail -6

echo "[feishu-task-ledger-smoke] ALL PASS"
