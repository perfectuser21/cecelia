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
for fn in selectCandidates resolveDisposition dedupeResends resolveReplyEvidence \
          buildTaskRequest runFeishuTaskLedger maybeRunFeishuTaskLedger mentionOpenId loadAgentRuns; do
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

echo "[feishu-task-ledger-smoke] 5. 真行为：三态判定 + 绝不产出 queued"
cd packages/brain
node --input-type=module -e "
import { buildTaskRequest, resolveDisposition, dispositionToStatus, mentionOpenId, resolveEvidenceFloor } from './src/feishu-task-ledger.js';
if (resolveEvidenceFloor([{created_at:7}], 99) !== 7) { console.error('FAIL: resolveEvidenceFloor 未取 run 最早时间'); process.exit(1); }

// 5a 三态各自判对
const mk = (id, ts, type='user') => ({ message_id: id, create_time: String(ts),
  sender: { sender_type: type, id: type==='app'?'ou_bot':'ou_alex' },
  body: { content: JSON.stringify({ text: '帮我建三个飞书文档' }) } });
const h = mk('m1', 1000000);
const cases = [
  ['executed', { head: h, messageIds: ['m1'], messages: [h], runs: [{ created_at: 1000060, task_kind: 'exec' }] }],
  ['answered', { head: h, messageIds: ['m1'], messages: [h, mk('b1', 1000030, 'app')], runs: [] }],
  ['dropped',  { head: h, messageIds: ['m1'], messages: [h], runs: [] }],
];
for (const [want, arg] of cases) {
  const got = resolveDisposition(arg);
  if (got !== want) { console.error('FAIL: 三态判定 期望 ' + want + ' 得到 ' + got); process.exit(1); }
}
console.log('OK: executed/answered/dropped 三态判定正确');

// 5b automation_run 不算响应群消息
if (resolveDisposition({ head: h, messageIds: ['m1'], messages: [h],
      runs: [{ created_at: 1000060, task_kind: 'automation_run' }] }) !== 'dropped') {
  console.error('FAIL: cron 的 automation_run 被误当成响应群消息的执行'); process.exit(1);
}
console.log('OK: automation_run 已排除');

// 5c mentions 两种形态都认（历史消息 API 是扁平字符串，webhook 是嵌套对象）
if (mentionOpenId({ id: 'ou_x', id_type: 'open_id' }) !== 'ou_x'
    || mentionOpenId({ id: { open_id: 'ou_x' } }) !== 'ou_x') {
  console.error('FAIL: mentions 解析未兼容两种形态'); process.exit(1);
}
console.log('OK: mentions 扁平/嵌套两种形态都认');

// 5d 绝不产出 queued
const group = { chatId: 'c', name: 'g', requireMention: true, agentId: 'zenithjoy-router' };
for (const d of ['executed', 'dropped']) {
  const r = buildTaskRequest({ head: h, messageIds: ['m1'], group, botReplied: false, contextText: '', disposition: d });
  if (r.task.status === 'queued') { console.error('FAIL: ' + d + ' 产出了 queued'); process.exit(1); }
  if (!['completed','blocked'].includes(r.task.status)) { console.error('FAIL: 非预期状态 ' + r.task.status); process.exit(1); }
}
if (dispositionToStatus('answered') !== null) { console.error('FAIL: answered 应不入账'); process.exit(1); }
console.log('OK: 无 queued，answered 不入账');

// 5e 证据覆盖窗口：早于 run 记录范围的消息不得被判成"派了没人管"
const early = mk('m0', 100000);
if (resolveDisposition({ head: early, messageIds: ['m0'], messages: [early], runs: [], evidenceFloorMs: 500000 }) !== 'unknown') {
  console.error('FAIL: 早于证据覆盖范围的消息未判 unknown —— 会往账本灌假的 dropped'); process.exit(1);
}
if (dispositionToStatus('unknown') !== null) { console.error('FAIL: unknown 应不入账'); process.exit(1); }
console.log('OK: 证据窗口外判 unknown 且不入账');

// 5f blocked 必带 blocked_at（DB 约束 chk_blocked_at_not_null）
const rb = buildTaskRequest({ head: h, messageIds: ['m1'], group, botReplied: false, contextText: '', disposition: 'dropped' });
if (rb.task.status !== 'blocked' || !rb.task.blocked_at) {
  console.error('FAIL: blocked 未带 blocked_at —— 整批入账会撞 chk_blocked_at_not_null'); process.exit(1);
}
console.log('OK: blocked 带 blocked_at');
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

echo "[feishu-task-ledger-smoke] 6b. 镜像须带 sqlite CLI（读 OpenClaw 执行流水用）"
if ! grep -qE "^RUN apk add .*\\bsqlite\\b" packages/brain/Dockerfile; then
  echo "FAIL: Dockerfile 未安装 sqlite，loadAgentRuns 在容器内必然降级为无 run"
  exit 1
fi
echo "OK: Dockerfile 含 sqlite"

echo "[feishu-task-ledger-smoke] 6c. 不得依赖 LLM（判据是查表不是猜意图）"
if grep -qE "callLLM|llm-caller" packages/brain/src/feishu-task-ledger.js; then
  echo "FAIL: 模块重新引入了 LLM 依赖——判据2 是机械事实，查 OpenClaw run 即可"
  exit 1
fi
echo "OK: 零 LLM 依赖"

echo "[feishu-task-ledger-smoke] 7. 单元测试跑通"
cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js --reporter=basic 2>&1 | tail -6

echo "[feishu-task-ledger-smoke] ALL PASS"
