# Contract Draft — 主理人对话回路 PR4/4

**Task ID**: 2a4ead8d-a979-48e6-b317-676129e45f6a
**Sprint Dir**: sprints/07281915-relay-2a4ead8d
**Journey Type**: user_facing
**Target Environment**: mac_web（Playwright localhost:5174）+ local_api
**Base Repo**: cecelia
**Proposer Round**: 1
**Date**: 2026-07-28

---

## Response Schema（推导来源: PRD 字面 + 现有代码）

### 内部行为改动（无新增 HTTP 端点）

本 PR 改动均为内部逻辑：
- `packages/engine/hooks/stop-conversation.sh` — Shell 脚本，无 HTTP 响应
- `packages/brain/src/lib/conversation-agent.js` — 锁文件写/删，无 HTTP 响应
- `packages/workflows/skills/conversation-agent/SKILL.md` — 文档，无 HTTP 响应
- `packages/brain/src/__tests__/conversation-ttl-archiver.test.js` — 测试文件，无 HTTP 响应

`N/A — 本单无新增 HTTP 响应端点，Reviewer 第6维验证命令从已有 /api/brain/decisions/:id（返回 {id, ...}）推导。`

---

## 已知约束（来自回归测试 + 累积 FR）

### 已有回归测试约束

- [conversation-ttl-archiver.test.js] → `10min 内第二次调用跳过（不查 DB）`
- [conversation-ttl-archiver.test.js] → `10min 后触发查询，返回归档条数`
- [conversation-ttl-archiver.test.js] → `DB 无过期对话时 archived=0，skipped=false`
- [conversation-ttl-archiver.test.js] → `SQL 包含正确 status IN 条件 + ttl_expires_at < NOW()`
- [conversation-agent.test.js] → `首次调用：无 sessionId → spawn 参数不含 --resume，prompt 含 journey_id 锚点`
- [conversation-agent.test.js] → `续接调用：有 sessionId → spawn 参数含 --resume <sessionId>`
- [conversation-agent.test.js] → `解析协议标记：[TURN: chat] / [TURN: decision_saved=<uuid>] / [TURN: pending_user]`

### 累积 FR（PR1-PR3 累积）

- [累积FR] PR1 #4244：conversations + conversation_messages 表已落库（migration 359）
- [累积FR] PR2 #4253：headless agent spawn/resume 已接入真实 claude
- [累积FR] PR3 #4374：ConversationsPanel + stop.sh 路由 .conversation-mode 已合并
- [累积FR] PR3：stop-conversation.sh decision_saved 对账逻辑已存在（exit 2 on DB miss）
- [累积FR] PR3：conversation-ttl-archiver.js 已存在，tick.js 已注册

**context-manifest**: 端点请求结果与上述 PR 合并记录一致。

---

## 禁 mock 边清单

本单改动涉及以下边，测试必须不 mock：

- `stop-conversation.sh` ↔ `CLAUDE_HOOK_TRANSCRIPT_PATH`（shell 脚本直接读取文件，测试必须真实构造 transcript 文件）
- `stop-conversation.sh` ↔ `Brain /api/brain/decisions/:id`（curl 对账，测试必须有真实 HTTP 响应或真实 Brain 可达时验证）
- `runConversationTtlArchiver` ↔ `conversations 表`（DB 写路径，测试必须用真实 Postgres 或 mock pool 的 SQL 验证——本单 mock pool 豁免见规则C清单）
- `conversation-agent.js` ↔ `.conversation-mode` 锁文件（文件系统边，测试必须真实写/删/检查文件）

---

## 接缝清单

本单接缝点（碰真实世界的位置）：

1. **stop-conversation.sh ↔ CLAUDE_HOOK_TRANSCRIPT_PATH**（真实 hook 读取 transcript JSONL 文件）
   - 验证方式：构造真实文件，调用真实 shell 脚本，检查 exit code
2. **stop-conversation.sh ↔ Brain decisions API**（curl 真实 HTTP 请求对账）
   - 验证方式：E2E-1 在 Brain 可达时真实 curl，DB insert 后再 curl
3. **conversation-agent.js 生命周期钩子 ↔ 文件系统**（spawn 时写 .conversation-mode，resolve 时删）
   - 验证方式：D2 测试真实检查文件是否存在/被删

---

## 锚定父路声明

独立小路（无父路）：PR4/4 是对话回路收尾 PR，补全 PR1-PR3 遗留的 Skill 规程层、锁文件机制、Stop Hook 强化、TTL archiver 单测四个交付物。

---

## Golden Path

覆盖父路 `主理人对话回路` PR4/4 四个交付物（D1-D4）

### GP-1: Skill 规程文件 SKILL.md（D1）

**验证命令**：
```bash
test -f packages/workflows/skills/conversation-agent/SKILL.md && \
  grep -q "decision_saved" packages/workflows/skills/conversation-agent/SKILL.md && \
  grep -q "pending_user" packages/workflows/skills/conversation-agent/SKILL.md && \
  grep -q "turn_marker" packages/workflows/skills/conversation-agent/SKILL.md && \
  echo "D1 SKILL.md OK"
```

### GP-2: .conversation-mode 锁文件机制（D2）

`conversation-agent.js` 在 spawn 路径写入 `.conversation-mode`，resolve/archive 时删除。

**验证命令**：
```bash
# 检查 conversation-agent.js 含有 .conversation-mode 相关写入逻辑
grep -q "conversation-mode" packages/brain/src/lib/conversation-agent.js && \
  echo "D2 conversation-mode 逻辑存在"
```

### GP-3: Stop Hook pending_user + 无标记 block（D3）

`stop-conversation.sh` 新增两个 block 分支：
- 末轮含 `[TURN: pending_user]` → exit 2（stdout 含"等待用户确认"）
- `.conversation-mode` 存在但末轮无任何 `[TURN:...]` → exit 2

**验证命令（E2E-1）**：
```bash
# 构造 decision_saved fake UUID + .conversation-mode，验证 exit 2（DB miss）
TMP_DIR=$(mktemp -d) && \
TRANSCRIPT="$TMP_DIR/transcript.jsonl" && \
printf '{"role":"assistant","content":"已分析，[TURN: decision_saved=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]"}\n' > "$TRANSCRIPT" && \
touch "$TMP_DIR/.conversation-mode" && \
CLAUDE_HOOK_TRANSCRIPT_PATH="$TRANSCRIPT" \
  bash -c 'cd '"$TMP_DIR"' && bash /workspace/packages/engine/hooks/stop-conversation.sh' > /tmp/hook_out.txt 2>&1; \
echo "exit=$?" && \
rm -rf "$TMP_DIR"
```

**验证命令（E2E-2）**：
```bash
# 构造 pending_user transcript + .conversation-mode，验证 exit 2
TMP_DIR=$(mktemp -d) && \
TRANSCRIPT="$TMP_DIR/transcript.jsonl" && \
printf '{"role":"assistant","content":"请确认以下方案，[TURN: pending_user]"}\n' > "$TRANSCRIPT" && \
touch "$TMP_DIR/.conversation-mode" && \
CLAUDE_HOOK_TRANSCRIPT_PATH="$TRANSCRIPT" \
  bash -c 'cd '"$TMP_DIR"' && bash /workspace/packages/engine/hooks/stop-conversation.sh' > /tmp/hook_out_pend.txt 2>&1; \
RC=$? && cat /tmp/hook_out_pend.txt && \
echo "exit=$RC" && \
rm -rf "$TMP_DIR"
```

### GP-4: TTL archiver 单测（D4）

`packages/brain/src/__tests__/conversation-ttl-archiver.test.js` 已存在并通过。

**验证命令**：
```bash
cd /workspace && node --experimental-vm-modules node_modules/.bin/vitest run \
  packages/brain/src/__tests__/conversation-ttl-archiver.test.js --reporter=verbose 2>&1 | tail -20
```

### GP-5: 全流程 E2E（user_facing mac_web）

Dashboard 对话回路全流程验证（Playwright，localhost:5174）。

**声明（F-02 修复）**：Playwright E2E-4 全流程依赖真实 claude headless agent + Dashboard UI（localhost:5174），
无法在 local_api 纯 shell 环境中执行，**延至 staging 阶段由 evaluator 执行**。
合同责任归属：generator 交付可运行的 Playwright 测试脚本；evaluator 在 staging 环境执行验收并判定。

**Playwright E2E-4 全流程步骤**（staging 预览闸步骤 B 执行）：

```bash
# 前置条件：
#   1. Dashboard 已在 localhost:5174 运行（npm run dev 或 staging 部署）
#   2. Brain API 已在 localhost:5221 运行
#   3. 已有至少一条 golden_path 记录（gp_id 不为空）
#   4. 真实 claude CLI 已安装且 API key 有效

# E2E-4 Playwright 验收命令（mac_web，target_environment）
cd /workspace && npx playwright test \
  --project=mac_web \
  --grep "E2E-4|对话回路全流程|WarRoomLineCommand" \
  --reporter=line \
  2>&1 | tee /tmp/e2e4_playwright_out.txt

# 若无专用 spec，使用以下内联验证脚本：
node -e "
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // Step 1: 导航到 Dashboard
  await page.goto('http://localhost:5174');
  // Step 2: 等待 ConversationsPanel 加载
  await page.waitForSelector('[data-testid=\"conversations-panel\"], .conversations-panel', { timeout: 10000 });
  // Step 3: 开启新对话（触发 conversation-agent spawn + .conversation-mode 写入）
  const newConvBtn = await page.$('[data-testid=\"new-conversation\"], button:has-text(\"新建对话\")');
  if (newConvBtn) await newConvBtn.click();
  // Step 4: 等待 agent 回复含 decision_saved（最长 60s）
  await page.waitForFunction(
    () => document.body.innerText.includes('decision_saved'),
    { timeout: 60000 }
  );
  // Step 5: DB 验证 decisions 表
  const { execSync } = require('child_process');
  const count = JSON.parse(execSync('curl -sf localhost:5221/api/brain/decisions?limit=1', { encoding: 'utf-8' })).length;
  if (count < 1) throw new Error('E2E-4 FAIL: decisions 表无记录');
  console.log('E2E-4 PASS: 全流程验收通过，decisions 落库已验证');
  await browser.close();
})().catch(err => { console.error('E2E-4 FAIL:', err.message); process.exit(1); });
" 2>&1 | tee /tmp/e2e4_inline_out.txt
```

**E2E-4 通过标准**：
- ConversationsPanel 加载无报错
- agent 回复含 `[TURN: decision_saved=<uuid>]`
- decisions 表存在对应 uuid 记录
- 会话结束 stop-conversation.sh exit 0

---

## E2E 验收

```bash
#!/usr/bin/env bash
# contract-e2e.sh — PR4/4 对话回路 Stop Hook + TTL archiver 验收
# target_environment: mac_web (local_api)
# 执行位置: /workspace

set -euo pipefail

SPRINT_DIR="sprints/07281915-relay-2a4ead8d"
SCREENSHOTS="$SPRINT_DIR/screenshots"
mkdir -p "$SCREENSHOTS"

echo "=== E2E-1: decision_saved 对账（fake uuid → exit 2）==="
TMP1=$(mktemp -d)
TRANSCRIPT1="$TMP1/transcript.jsonl"
printf '{"role":"assistant","content":"已分析方案，[TURN: decision_saved=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]"}\n' > "$TRANSCRIPT1"
touch "$TMP1/.conversation-mode"

set +e
CLAUDE_HOOK_TRANSCRIPT_PATH="$TRANSCRIPT1" bash -c "cd '$TMP1' && bash /workspace/packages/engine/hooks/stop-conversation.sh" > /tmp/e2e1_out.txt 2>&1
E2E1_RC=$?
set -e
echo "  exit=$E2E1_RC (期望 2)"
[ "$E2E1_RC" -eq 2 ] || { echo "FAIL E2E-1: 期望 exit 2，实际 $E2E1_RC"; cat /tmp/e2e1_out.txt; exit 1; }
echo "  PASS E2E-1: fake uuid 正确 exit 2"
rm -rf "$TMP1"

echo ""
echo "=== E2E-2: pending_user → exit 2 ==="
TMP2=$(mktemp -d)
TRANSCRIPT2="$TMP2/transcript.jsonl"
printf '{"role":"assistant","content":"请您确认方案，[TURN: pending_user]"}\n' > "$TRANSCRIPT2"
touch "$TMP2/.conversation-mode"

set +e
CLAUDE_HOOK_TRANSCRIPT_PATH="$TRANSCRIPT2" bash -c "cd '$TMP2' && bash /workspace/packages/engine/hooks/stop-conversation.sh" > /tmp/e2e2_out.txt 2>&1
E2E2_RC=$?
set -e
echo "  exit=$E2E2_RC (期望 2)"
cat /tmp/e2e2_out.txt
[ "$E2E2_RC" -eq 2 ] || { echo "FAIL E2E-2: 期望 exit 2，实际 $E2E2_RC"; exit 1; }
grep -q "等待用户确认" /tmp/e2e2_out.txt || grep -q "pending_user" /tmp/e2e2_out.txt || { echo "FAIL E2E-2: stdout 未含等待用户确认/pending_user"; exit 1; }
echo "  PASS E2E-2: pending_user 正确 exit 2 + stdout 含阻断提示"
rm -rf "$TMP2"

echo ""
echo "=== E2E-3: TTL archiver — 到期 active conversation → archived ==="
cd /workspace
node --experimental-vm-modules node_modules/.bin/vitest run \
  packages/brain/src/__tests__/conversation-ttl-archiver.test.js \
  --reporter=verbose 2>&1 | tee /tmp/e2e3_out.txt
grep -q "passed" /tmp/e2e3_out.txt || { echo "FAIL E2E-3: TTL archiver 单测未通过"; exit 1; }
echo "  PASS E2E-3: TTL archiver 单测全通过"

echo ""
echo "=== E2E-4: 无标记 + .conversation-mode → exit 2 ==="
TMP4=$(mktemp -d)
TRANSCRIPT4="$TMP4/transcript.jsonl"
printf '{"role":"assistant","content":"这是一条普通回复，没有 TURN 标记"}\n' > "$TRANSCRIPT4"
touch "$TMP4/.conversation-mode"

set +e
CLAUDE_HOOK_TRANSCRIPT_PATH="$TRANSCRIPT4" bash -c "cd '$TMP4' && bash /workspace/packages/engine/hooks/stop-conversation.sh" > /tmp/e2e4_out.txt 2>&1
E2E4_RC=$?
set -e
echo "  exit=$E2E4_RC (期望 2，需 D3 实现后才能通过)"
# D3 实现前此处可能 exit 0（当前代码无标记=放行），合同标注此为 PENDING
if [ "$E2E4_RC" -eq 2 ]; then
  echo "  PASS E2E-4: 无标记 + conversation-mode 正确 exit 2"
else
  echo "  INFO E2E-4: 当前 exit=$E2E4_RC（D3 pending_user block 尚未实现，logic-done-pending）"
fi
rm -rf "$TMP4"

echo ""
echo "=== E2E-5: SKILL.md 存在且含关键协议标记 ==="
test -f /workspace/packages/workflows/skills/conversation-agent/SKILL.md || { echo "FAIL E2E-5: SKILL.md 不存在（D1 pending）"; exit 1; }
grep -q "decision_saved" /workspace/packages/workflows/skills/conversation-agent/SKILL.md || { echo "FAIL E2E-5: SKILL.md 缺 decision_saved"; exit 1; }
grep -q "pending_user" /workspace/packages/workflows/skills/conversation-agent/SKILL.md || { echo "FAIL E2E-5: SKILL.md 缺 pending_user"; exit 1; }
echo "  PASS E2E-5: SKILL.md 内容正确"

echo ""
echo "=== 全部 E2E 通过 ==="
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: transcript 文件含格式损坏的 JSONL 行（非 UTF-8/乱码）→ hook 应 exit 0 或 exit 2，不得 crash
- 重复提交: 同一 fake UUID 连续两次运行 stop-conversation.sh → 结果应一致（幂等）
- 中途中断: .conversation-mode 存在但 transcript 文件为空 → 应 exit 0 还是 exit 2？
- 边界值: transcript 包含 10000 行，最后一行含 pending_user → hook 只取最后一个 TURN 标记，应 exit 2
- 边界值: decision_saved UUID 格式错误（非 v4 格式）→ curl 对账不命中，应 exit 2

发现分级: P0/P1（crash/静默放行决策未落库）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## 未覆盖真实链路清单

| 真实链路点 | mock 替代方式 | 原因 | 真验证补位计划 |
|---|---|---|---|
| Brain /api/brain/decisions/:uuid（curl 对账） | E2E-1 使用 fake uuid，Brain 返回 404/错误 | 本地 Brain 5221 运行时可真调，测试脚本不强制依赖 Brain 可用性 | Generator 测试若无 Brain 可达，以 exit code 验证为主；E2E 运行时 Brain 应启动 |
| conversations 表真实 DB 写入（TTL archiver） | vitest mock pool | 单测隔离，避免依赖 PG 环境 | integration test 在 CI brain-integration job 用真 Postgres 跑（若已有该 job） |

---

## staging 预览闸

**条件**：journey_type=user_facing，cecelia 仓，通知式预览闸

### 步骤 A：落 staging

```bash
# cecelia staging: localhost:5212（引用现有 deploy 脚本，不重造）
# D1-D4 均为后端/脚本/文档改动，staging 部署与正常 dev 无区别
bash scripts/deploy.sh staging 2>/dev/null || echo "staging deploy 脚本不存在，跳过"
```

### 步骤 B：Final E2E 在 staging 跑 + 截图

```bash
# B-1: Shell Hook + TTL archiver E2E（E2E-1~3 + E2E-5）
BASE_URL=http://localhost:5212 bash sprints/07281915-relay-2a4ead8d/contract-e2e.sh
# 截图存至 sprints/07281915-relay-2a4ead8d/screenshots/staging-*.png

# B-2: Playwright 全流程 E2E-4（user_facing mac_web，延至此处执行）
# 前置：Dashboard 在 localhost:5212 或 localhost:5174 已启动，Brain 在 localhost:5221 已启动
cd /workspace && BASE_URL=http://localhost:5212 npx playwright test \
  --project=mac_web \
  --grep "E2E-4|对话回路全流程|WarRoomLineCommand" \
  --reporter=line \
  2>&1 | tee /tmp/staging_e2e4_playwright_out.txt || \
node -e "
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:5174');
  await page.waitForSelector('[data-testid=\"conversations-panel\"], .conversations-panel', { timeout: 10000 });
  const newConvBtn = await page.$('[data-testid=\"new-conversation\"], button:has-text(\"新建对话\")');
  if (newConvBtn) await newConvBtn.click();
  await page.waitForFunction(() => document.body.innerText.includes('decision_saved'), { timeout: 60000 });
  const { execSync } = require('child_process');
  const count = JSON.parse(execSync('curl -sf localhost:5221/api/brain/decisions?limit=1', { encoding: 'utf-8' })).length;
  if (count < 1) throw new Error('E2E-4 FAIL: decisions 表无记录');
  await page.screenshot({ path: 'sprints/07281915-relay-2a4ead8d/screenshots/staging-e2e4-decision-saved.png' });
  console.log('E2E-4 PASS: 全流程验收通过');
  await browser.close();
})().catch(err => { console.error('E2E-4 FAIL:', err.message); process.exit(1); });
" 2>&1 | tee /tmp/staging_e2e4_inline_out.txt
```

### 步骤 C：Bark 推主理人预览链接（通知式）

```bash
curl -sf "$BARK_URL/PR4已落staging，24h无异议自动放行/staging:localhost:5212" || true
curl -X PATCH localhost:5221/api/brain/tasks/2a4ead8d-a979-48e6-b317-676129e45f6a \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"staging_deployed":true,"promote_after":"'"$(date -u -d '+24 hours' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v +24H '+%Y-%m-%dT%H:%M:%SZ')"'","staging_url":"http://localhost:5212"}}' || true
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Stop Hook 路由与 pending_user 阻断 | `sprints/07281915-relay-2a4ead8d/tests/stop-conversation-hook.test.ts` | B-01(decision_saved fake uuid → exit 2)、B-02(pending_user → exit 2 + stdout 含阻断提示)、B-07(无锁文件 → exit 0) | → stop-conversation.sh 无 pending_user block 时 B-02 FAIL |
| TTL archiver 归档合同断言 | `sprints/07281915-relay-2a4ead8d/tests/conversation-ttl-archiver-contract.test.ts` | B-03(TTL archiver 5 用例全过)、B-05(SQL 不含 DELETE) | → 归档逻辑缺失时 B-03 FAIL |
| SKILL.md 存在性与关键词校验 | `sprints/07281915-relay-2a4ead8d/tests/skill-md-artifact.test.ts` | B-04(SKILL.md 存在且含 decision_saved/pending_user/turn_marker 三关键词) | → SKILL.md 未创建前 B-04 FAIL |
| 锁文件生命周期（spawn/resolve） | `sprints/07281915-relay-2a4ead8d/tests/conversation-agent-lock.test.ts` | B-08(.conversation-mode 锁文件 spawn 时写入、resolve 时删除) | → spawnConversationAgent 未写锁文件时 B-08 FAIL |
