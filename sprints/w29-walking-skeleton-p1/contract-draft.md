# Sprint Contract Draft (Round 3)

> **Sprint**: W29 Walking Skeleton P1 终验
> **Initiative**: Walking Skeleton P1 关账（B1–B7 全链路联调）
> **journey_type**: autonomous
> **Round 1 → 2 关键变化**: 确立 SSOT — 所有"真验证命令"集中在 smoke 脚本（分段 echo 精确 PASS 标记），contract-dod-ws*.md 的 [BEHAVIOR] Test 字段 grep smoke stdout 完成 oracle 闭环。contract-draft.md 的 Step 验证命令段改成**引用** [BEHAVIOR id]，不再粘贴第二份 psql/node 命令。新增 Risk Register。补充 PRD Response Schema codify oracle。
> **Round 2 → 3 关键变化**:
> 1. 修 Reviewer R2 阻塞 issue#1（"PRD 字面值 vs 代码现实 schema drift 未显式入 Risk Register，不可默认沉默"）— 新增 **R11**（PRD `{events,count}`+outcome enum vs 代码 `{events,limit,total}`+event_type enum 漂移）显式 mitigation：WS4 acceptance-report.md 强制独立段 "PRD 字面值与代码现实差异清单" 作 W30 回归 trail
> 2. 修 Reviewer R2 阻塞 issue#2（verification_oracle_completeness=6 < 7）— /dispatch/recent shape oracle 拆出 3 条粒度更细 BEHAVIOR：`ws1-b6-keys-strict`（jq -e 'keys == [...]' 严等）+ `ws1-b6-banned-reverse`（每个禁用字段独立 `! has(...)` 反向断言）+ `ws1-b6-error-path`（非法 query → 400/error key 存在）。smoke 输出标记契约同步新增 3 个 PASS 字面值
> 3. 修 Reviewer R2 非阻塞 observation — WS4 新增 BEHAVIOR `ws4-prd-vs-code-diff` 强制 acceptance-report.md 含独立段列出 PRD 字面值与代码现实的 2 处差异点（response shape diff + event_type enum diff）+ 代码 LOC 引用 + W30 立项 follow-up 标识，避免未来回归挖出来时找不到 trail

---

## SSOT（单一事实源）协议

本合同所有"真验证逻辑"严格遵守以下分工，杜绝 R1 反馈的"两套互不引用的测试逻辑漂移"：

| 层 | 住哪 | 角色 |
|---|---|---|
| 真 psql/node/curl 命令 | `packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh`（generator deliverable）| **SSOT**。该 smoke 在 `set -euo pipefail` 下分段执行真 invariant 检查，每段所有 assertion 真过后才 `echo` 精确 PASS 标记到 stdout |
| evaluator oracle | `contract-dod-ws{N}.md` 内 `[BEHAVIOR ws{N}-...]` 条目的 `Test: manual:bash -c ...` | 跑 SSOT smoke 缓存输出 `/tmp/w29-acceptance-smoke.out`，`grep -qE` 精确字面值 PASS 标记；SKIP 时短路 exit 0 |
| 设计描述 | 本文件 contract-draft.md 的 Step N 段 | **只**写"可观测行为 / 硬阈值 / 引用的 BEHAVIOR id 列表"，**禁止**粘贴第二份 psql 命令 |

为什么这避免漂移：smoke 的 PASS 标记串是 contract 强制定义的字面值（下面"smoke 输出标记契约"段）。改 smoke 内部 assertion → PASS 标记不变 → BEHAVIOR Test 仍能 grep 中 → 但代码 review 会抓到 assertion 弱化。改 BEHAVIOR Test 的 grep pattern → 必须改 contract → 必须走 GAN → 走完 Reviewer 第 6 维 verification_oracle_completeness 不放行。

---

## smoke 输出标记契约（被各 [BEHAVIOR] grep 的精确字面值）

generator 必须让 smoke 在对应段所有 assertion 真过后 `echo` 以下**精确**字面值（一字不漏，含空格、横杠、中文）：

| 标记 | 段 | 对应 BEHAVIOR id |
|---|---|---|
| `[B1] PASS — reportNode 写回 tasks.status=completed` | Step 3 | ws1-b1-reportnode-writeback |
| `[B3-IN] PASS — slot in_progress +1` | Step 2/3 | ws1-b3-slot-in |
| `[B6-TABLE] PASS — dispatch_events +<N> 行 within 5min` | Step 2 | ws1-b6-table-write |
| `[B6-EP] PASS — /dispatch/recent shape={events,limit,total} no_banned_keys=ok` | Step 2 | ws1-b6-endpoint-shape |
| `[B6-KEYS] PASS — /dispatch/recent jq -e 'keys == ["events","limit","total"]' 严等` | Step 2 | ws1-b6-keys-strict |
| `[B6-BANNED] PASS — /dispatch/recent banned_keys=∅ (data,results,payload,count,records,history)` | Step 2 | ws1-b6-banned-reverse |
| `[B6-ERR] PASS — /dispatch/recent error path 非法 query 返 4xx + error string` | Step 2 | ws1-b6-error-path |
| `[B6-ENUM] PASS — event_type ∈ {dispatched,failed_dispatch}` | Step 2 | ws1-b6-event-type-enum |
| `[B5-A] PASS — task_A claimed_by 被释放` | Step 4 | ws2-b5-hol-task-a-claim-released |
| `[B5-BC] PASS — dispatch_events 含 task_B event_type=dispatched within 5min`（或 `task_C`）| Step 4 | ws2-b5-task-bc-dispatched |
| `[B5-LOG] PASS — dispatcher 真日志含 'HOL skip'` | Step 4 | ws2-b5-dispatcher-log |
| `[B2] PASS — reapZombies 标 task=failed error_message='[reaper] zombie ...'` | Step 5 | ws2-b2-zombie-reaped-failed |
| `[B2-RET] PASS — reapZombies returned reaped=<n≥1> errors=0` | Step 5 | ws2-b2-reaper-return-shape |
| `[B3-OUT] PASS — slot in_progress -1 after zombie reaped` | Step 5 | ws2-b3-slot-out |
| `[B4] PASS — getGuidance returned null for stale decision_id` | Step 6 | ws3-b4-stale-returns-null |
| `[B4-LOG] PASS — guidance.js 真日志含 'strategy decision stale'` | Step 6 | ws3-b4-guidance-log |
| `[B7-SHAPE] PASS — fleet entries 含 offline_reason + last_ping_at` | Step 7 | ws3-b7-shape |
| `[B7-ENUM] PASS — offline_reason ∈ {null,fetch_failed,no_ping_grace_exceeded}` | Step 7 | ws3-b7-enum |
| `[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过` | Step 8 | ws3-overall-pass |
| `SKIP: <reason>`（在 stdout 头几行）| 环境不可用退路 | ws1-skip-or-run, 所有 BEHAVIOR 短路 |

`set -e` + 分段 PASS 标记的组合保证："标记出现 ⇒ 该段所有 assertion 真过"。spoofing 难度：必须在每段 echo 前禁用 set -e 又 echo 完再恢复——会被 ARTIFACT grep 抓（`set -euo pipefail` 必须在文件级别唯一）。

---

## 关于 PRD Response Schema 的字段名澄清（v7.5 死规则 + PRD ASSUMPTION 联合解读）

PRD `## Response Schema` 段为 `GET /api/brain/dispatch/recent` 字面写 `["events","count"]` + outcome enum；但 PRD 自身 `[ASSUMPTION]` 段授权：

> `/api/brain/dispatch/recent` endpoint 响应 shape 与 PR #2904 实现一致；若有漂移，以代码为准 PRD 同步更新

代码实证（`packages/brain/src/routes/dispatch.js:34-38`）：

```json
{ "events": [{ "id", "task_id", "event_type", "reason", "created_at" }], "limit": <number>, "total": <number> }
```

`event_type` 实际枚举（`packages/brain/src/dispatch-stats.js:125-130`）：`dispatched | failed_dispatch`（其余 dispatch 流程的 `reason` 字段携带具体原因，**不**经由独立 event_type）。

合同决定：**按 PRD `[ASSUMPTION]` 条款以代码为准**，所有 jq -e oracle / 标记契约用代码现实字段名 + 枚举字面值。proposer skill v7.5"死规则"的字面名约束在此被 PRD 自身的 escape clause 覆盖（PRD 是法律，但法律自带例外条款时优先适用例外）。PRD 文本同步更新由本 sprint 收口后单独 PR 处理，明确**不**在本合同范围。

禁用字段反向（合同强制 jq -e 验）：
- `data` / `results` / `payload` / `count` / `records` / `history` 不应作为 /dispatch/recent 顶层 key 出现
- `event_type` 值不应是 `skipped_hol` / `skipped_no_worker` / `failed`（这些是 PRD 表面值，代码不产；如出现 → schema drift fail）

---

## Golden Path

[投递测试 task → tasks 表] → [POST /api/brain/tick] → [dispatcher 派发 + dispatch_events 写 + slot +1] → [模拟 reportNode 写回 + slot -1 + task_events] → [HOL skip 跳过 task_A 派发 task_B/C] → [构造 30min idle zombie → reapZombies idleMinutes=0 → 标 failed + slot -1] → [INSERT 30min stale guidance → getGuidance 短路 null] → [startFleetRefresh + getFleetStatus → offline_reason shape/enum 不漂移] → [smoke 末尾 echo 整体 PASS + exit 0]

### Step 1: 投递测试 task

**可观测行为**: smoke 内部用 `test-w29-acceptance-<timestamp>-<n>` 前缀 INSERT 1 条 `task_type='walking_skeleton_acceptance'` `status='pending'` task 到 tasks 表。

**硬阈值**: tasks 表多 1 行 status=pending；title 含前缀 `test-w29-` 便于幂等清理。

**验证命令**: 见 contract-dod-ws1.md 的 ARTIFACT 段（smoke 文件含 `test-w29-` 前缀 + 隔离清理逻辑）。本 Step 是后续 Step 的输入，无独立 [BEHAVIOR] 标记；其结果通过后续 [B6-TABLE]/[B3-IN]/[B1] 间接证明。

---

### Step 2: dispatcher 派发（B5 + B6 共同验入口）

**可观测行为**: POST /api/brain/tick 后，dispatcher 对该 task 执行 dispatch；dispatch_events 表 5 分钟内多 ≥ 1 行 event_type ∈ `{dispatched, failed_dispatch}`（B6 invariant）。slot 计数 in_progress 在派发成功时 +1（B3 invariant）。GET /api/brain/dispatch/recent 响应 shape = `{events, limit, total}` 严格匹配代码现实（jq -e 'keys==[…]' 严等 + 每个禁用字段独立 `! has(...)` 反向断言 + 非法 query 走 error path），禁用字段反向不存在（B6 endpoint shape invariant）。

**硬阈值**: dispatch_events 5 分钟内 ≥ 1 行；/dispatch/recent 顶层 keys 严等 `["events","limit","total"]`；每个禁用字段（data/results/payload/count/records/history）独立 `! has(...)` 真；非法 query 4xx + error key 存在；event_type ∈ enum；slot in_progress 相对基线 +1。

**验证命令**: 见 contract-dod-ws1.md
- [BEHAVIOR] [ws1-b6-table-write]
- [BEHAVIOR] [ws1-b6-endpoint-shape]
- [BEHAVIOR] [ws1-b6-keys-strict]
- [BEHAVIOR] [ws1-b6-banned-reverse]
- [BEHAVIOR] [ws1-b6-error-path]
- [BEHAVIOR] [ws1-b6-event-type-enum]
- [BEHAVIOR] [ws1-b3-slot-in]

---

### Step 3: 模拟 worker callback + reportNode 写回（B1 验）

**可观测行为**: smoke 在测试模式下不依赖真实 worker，通过 SQL 直接模拟 reportNode 的成功回写路径（`UPDATE tasks SET status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=$TID; INSERT INTO task_events ... 'task_completed'`）。

**硬阈值**: tasks.status='completed'；updated_at 1 分钟内；task_events 5 分钟内多 1 行 event_type='task_completed'。

**验证命令**: 见 contract-dod-ws1.md
- [BEHAVIOR] [ws1-b1-reportnode-writeback]

---

### Step 4: HOL skip 队列（B5 验）

**可观测行为**: 通过填满 codex pool（或等价"队首被阻塞"构造，复用 `packages/brain/scripts/smoke/dispatcher-hol-skip-smoke.sh` 已验过的代码路径），让 non-P0 codex 队首 task_A 触发 dispatcher.js:407 HOL skip 分支；同时投 task_B/task_C 是可派发的；POST /api/brain/tick；dispatcher 跳过 task_A 派发 task_B/task_C；dispatcher.js 真日志含字面值 `HOL skip` 字串（来自 dispatcher.js:407 真 tickLog，不是 smoke echo 自吹）。

**硬阈值**: task_A 的 `claimed_by` 被释放；task_B 或 task_C 至少 1 条 5 分钟内进入 dispatch_events 且 event_type='dispatched'；brain stdout 含 `HOL skip` 字面字串。

**验证命令**: 见 contract-dod-ws2.md
- [BEHAVIOR] [ws2-b5-hol-task-a-claim-released]
- [BEHAVIOR] [ws2-b5-task-bc-dispatched]
- [BEHAVIOR] [ws2-b5-dispatcher-log]

---

### Step 5: zombie reaper 标 failed（B2 + B3 复验）

**可观测行为**: smoke 构造 30 分钟没更新的 `in_progress` task，通过 `import('./packages/brain/src/zombie-reaper.js')` 调 `reapZombies({ idleMinutes: 0 })`；reaper 应标 status='failed' + error_message 含字面子串 `[reaper] zombie` + completed_at IS NOT NULL（与 zombie-reaper.js:73-81 实现精确一致）；返回值 shape `{reaped, scanned, errors}` reaped ≥ 1 errors=0；slot in_progress 相对 reaper 跑前减 1。

**硬阈值**: tasks.status='failed'；error_message 含 `[reaper] zombie`；reapZombies 返回 reaped ≥ 1 + errors=[]；slot in_progress -1。

**验证命令**: 见 contract-dod-ws2.md
- [BEHAVIOR] [ws2-b2-zombie-reaped-failed]
- [BEHAVIOR] [ws2-b2-reaper-return-shape]
- [BEHAVIOR] [ws2-b3-slot-out]

---

### Step 6: guidance TTL 防 stale decision（B4 验）

**可观测行为**: smoke INSERT 1 条 `brain_guidance` key='strategy:global' value JSON 含 `decision_id='stale-w29-test'` updated_at = NOW() - INTERVAL '30 minutes'（远超默认 DECISION_TTL_MIN=15min）；`import('./packages/brain/src/guidance.js')` 调 `getGuidance('strategy:global')`；返回值必须是 `null`（命中 guidance.js:46-53 短路）；brain stdout 含 guidance.js:48-49 真日志字面值 `[guidance] strategy decision stale`。

**硬阈值**: getGuidance 返回 null；brain stdout 含 `strategy decision stale` 字面字串。

**验证命令**: 见 contract-dod-ws3.md
- [BEHAVIOR] [ws3-b4-stale-returns-null]
- [BEHAVIOR] [ws3-b4-guidance-log]

---

### Step 7: fleet heartbeat offline_reason 字段不漂移（B7 验）

**可观测行为**: smoke `import('./packages/brain/src/fleet-resource-cache.js')`，`startFleetRefresh()` → 等 2 秒 → `getFleetStatus()` → `stopFleetRefresh()`；返回数组每条 entry 含 `offline_reason` + `last_ping_at` 字段（与 fleet-resource-cache.js:145-156 字段集一致；缺一个 fail）；`offline_reason` 取值 ∈ {`null`, `'fetch_failed'`, `'no_ping_grace_exceeded'`}（与 fleet-resource-cache.js:75-77, 141-143 三个字面值精确一致；任何其他值 fail）。

不模拟 heartbeat 超时（PRD 边界），只验字段存在 + 类型正确足以证明 B7 修复不漂移。

**硬阈值**: 每条 entry 含 offline_reason + last_ping_at；offline_reason 取值 ∈ 上述 3 个字面值。

**验证命令**: 见 contract-dod-ws3.md
- [BEHAVIOR] [ws3-b7-shape]
- [BEHAVIOR] [ws3-b7-enum]

---

### Step 8: 出口 — smoke exit 0 + 打印整体 PASS

**可观测行为**: 上述 Steps 全部 assertion 真过后，smoke 末尾 `echo '[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过'`，进程 exit 0。任何前置 assertion 失败 → `set -e` 立即终止 → 末尾 echo 达不到。trap EXIT 清理本次 `test-w29-` 前缀全部测试数据。

**硬阈值**: stdout 末尾含字面 `[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过`；exit code = 0（或 stdout 首行 `SKIP:` + exit 0）。

**验证命令**: 见 contract-dod-ws3.md
- [BEHAVIOR] [ws3-overall-pass]
- [BEHAVIOR] [ws3-overall-exit-zero]

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous（所有改动仅在 `packages/brain/scripts/` + `sprints/` + 文档，无 dashboard / 无 remote agent / 无 dev pipeline hooks）。

**完整验证脚本**:

```bash
#!/bin/bash
set -e

SMOKE=packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh
REPORT=sprints/w29-walking-skeleton-p1/acceptance-report.md

# A. 产物存在 + 可执行
[ -f "$SMOKE" ] || { echo "FAIL: smoke 脚本不存在"; exit 1; }
[ -x "$SMOKE" ] || { echo "FAIL: smoke 脚本无执行权限"; exit 1; }
[ -f "$REPORT" ] || { echo "FAIL: acceptance 报告不存在"; exit 1; }

# B. smoke 结构静态检查（覆盖 contract-dod-ws1-3 的 ARTIFACT 全部条目，结构防漂）
head -3 "$SMOKE" | grep -q '^#!/usr/bin/env bash' || { echo "FAIL: smoke 缺 bash shebang"; exit 1; }
grep -q '^set -euo pipefail' "$SMOKE" || { echo "FAIL: smoke 缺 set -euo pipefail"; exit 1; }
grep -q 'test-w29-' "$SMOKE" || { echo "FAIL: smoke 缺隔离前缀 test-w29-"; exit 1; }
grep -qE 'SKIP:.*(docker|brain|pg|postgres|not available|不可用)' "$SMOKE" || { echo "FAIL: smoke 缺 SKIP 退路"; exit 1; }
grep -q 'dispatch_events' "$SMOKE" || { echo "FAIL: smoke 未引用 dispatch_events"; exit 1; }
grep -q '/api/brain/tick' "$SMOKE" || { echo "FAIL: smoke 未调 POST /api/brain/tick"; exit 1; }
grep -q '/api/brain/dispatch/recent' "$SMOKE" || { echo "FAIL: smoke 未调 GET /dispatch/recent"; exit 1; }
grep -q 'reapZombies' "$SMOKE" || { echo "FAIL: smoke 未调 reapZombies"; exit 1; }
grep -qE 'reapZombies\s*\(\s*\{\s*idleMinutes\s*:\s*0' "$SMOKE" || { echo "FAIL: smoke 未传 idleMinutes:0"; exit 1; }
grep -q '\[reaper\] zombie' "$SMOKE" || { echo "FAIL: smoke 缺字面值 [reaper] zombie"; exit 1; }
grep -q 'getGuidance' "$SMOKE" || { echo "FAIL: smoke 未调 getGuidance"; exit 1; }
grep -q 'decision_id' "$SMOKE" || { echo "FAIL: smoke 未引用 decision_id"; exit 1; }
grep -qE "INTERVAL\s+'30\s+minutes'" "$SMOKE" || { echo "FAIL: smoke 缺 30 minutes stale 注入"; exit 1; }
grep -q 'fleet-resource-cache' "$SMOKE" || { echo "FAIL: smoke 未 import fleet-resource-cache"; exit 1; }
grep -q 'startFleetRefresh' "$SMOKE" || { echo "FAIL: smoke 未调 startFleetRefresh"; exit 1; }
grep -q 'offline_reason' "$SMOKE" || { echo "FAIL: smoke 未验 offline_reason"; exit 1; }
grep -q 'no_ping_grace_exceeded' "$SMOKE" || { echo "FAIL: smoke 缺 no_ping_grace_exceeded 字面"; exit 1; }
grep -q 'fetch_failed' "$SMOKE" || { echo "FAIL: smoke 缺 fetch_failed 字面"; exit 1; }
grep -q 'test-w29-hol-A' "$SMOKE" || { echo "FAIL: smoke 缺 HOL 段 task_A"; exit 1; }
grep -q 'test-w29-hol-B' "$SMOKE" || { echo "FAIL: smoke 缺 HOL 段 task_B"; exit 1; }
grep -q 'test-w29-hol-C' "$SMOKE" || { echo "FAIL: smoke 缺 HOL 段 task_C"; exit 1; }
grep -q 'test-w29-zombie' "$SMOKE" || { echo "FAIL: smoke 缺 zombie 段标识"; exit 1; }
grep -qE 'trap\s+.*(cleanup|EXIT)' "$SMOKE" || { echo "FAIL: smoke 缺 trap 清理"; exit 1; }
grep -q '\[walking-skeleton-p1-终验\] PASS — 7 项 P1 修复全链路联调通过' "$SMOKE" || { echo "FAIL: smoke 缺整体 PASS 字面"; exit 1; }

# C. smoke 输出分段 PASS 标记（cover 全部 BEHAVIOR id；smoke 内部用 set -e 保证"echo 出现 = assertion 真过"）
grep -q '\[B1\] PASS — reportNode 写回 tasks.status=completed' "$SMOKE" || { echo "FAIL: smoke 缺 [B1] PASS 标记"; exit 1; }
grep -q '\[B3-IN\] PASS — slot in_progress +1' "$SMOKE" || { echo "FAIL: smoke 缺 [B3-IN] PASS"; exit 1; }
grep -q '\[B3-OUT\] PASS — slot in_progress -1 after zombie reaped' "$SMOKE" || { echo "FAIL: smoke 缺 [B3-OUT] PASS"; exit 1; }
grep -q '\[B6-TABLE\] PASS — dispatch_events' "$SMOKE" || { echo "FAIL: smoke 缺 [B6-TABLE] PASS"; exit 1; }
grep -q '\[B6-EP\] PASS — /dispatch/recent shape={events,limit,total} no_banned_keys=ok' "$SMOKE" || { echo "FAIL: smoke 缺 [B6-EP] PASS"; exit 1; }
grep -q '\[B6-KEYS\] PASS — /dispatch/recent jq -e' "$SMOKE" || { echo "FAIL: smoke 缺 [B6-KEYS] PASS"; exit 1; }
grep -q '\[B6-BANNED\] PASS — /dispatch/recent banned_keys=∅' "$SMOKE" || { echo "FAIL: smoke 缺 [B6-BANNED] PASS"; exit 1; }
grep -q '\[B6-ERR\] PASS — /dispatch/recent error path' "$SMOKE" || { echo "FAIL: smoke 缺 [B6-ERR] PASS"; exit 1; }
grep -q '\[B6-ENUM\] PASS — event_type ∈ {dispatched,failed_dispatch}' "$SMOKE" || { echo "FAIL: smoke 缺 [B6-ENUM] PASS"; exit 1; }
grep -q '\[B5-A\] PASS — task_A claimed_by 被释放' "$SMOKE" || { echo "FAIL: smoke 缺 [B5-A] PASS"; exit 1; }
grep -q '\[B5-BC\] PASS — dispatch_events 含 task_' "$SMOKE" || { echo "FAIL: smoke 缺 [B5-BC] PASS"; exit 1; }
grep -q "\[B5-LOG\] PASS — dispatcher 真日志含 'HOL skip'" "$SMOKE" || { echo "FAIL: smoke 缺 [B5-LOG] PASS"; exit 1; }
grep -q "\[B2\] PASS — reapZombies 标 task=failed error_message='\[reaper\] zombie" "$SMOKE" || { echo "FAIL: smoke 缺 [B2] PASS"; exit 1; }
grep -q '\[B2-RET\] PASS — reapZombies returned reaped=' "$SMOKE" || { echo "FAIL: smoke 缺 [B2-RET] PASS"; exit 1; }
grep -q '\[B4\] PASS — getGuidance returned null for stale decision_id' "$SMOKE" || { echo "FAIL: smoke 缺 [B4] PASS"; exit 1; }
grep -q "\[B4-LOG\] PASS — guidance.js 真日志含 'strategy decision stale'" "$SMOKE" || { echo "FAIL: smoke 缺 [B4-LOG] PASS"; exit 1; }
grep -q '\[B7-SHAPE\] PASS — fleet entries 含 offline_reason + last_ping_at' "$SMOKE" || { echo "FAIL: smoke 缺 [B7-SHAPE] PASS"; exit 1; }
grep -q '\[B7-ENUM\] PASS — offline_reason ∈ {null,fetch_failed,no_ping_grace_exceeded}' "$SMOKE" || { echo "FAIL: smoke 缺 [B7-ENUM] PASS"; exit 1; }

# D. 报告完整性
for b in B1 B2 B3 B4 B5 B6 B7; do
  grep -q "$b" "$REPORT" || { echo "FAIL: 报告缺 $b"; exit 1; }
done
grep -q 'walking-skeleton-p1-acceptance-smoke' "$REPORT" || { echo "FAIL: 报告未引 smoke 路径"; exit 1; }
grep -qE 'real-env-smoke' "$REPORT" || { echo "FAIL: 报告缺 CI 集成说明"; exit 1; }
grep -q '\[walking-skeleton-p1-终验\] PASS — 7 项 P1 修复全链路联调通过' "$REPORT" || { echo "FAIL: 报告缺 PASS signal"; exit 1; }
# D2. R11 trail — PRD 字面值 vs 代码现实差异清单（必须独立段 + 2 处差异 + LOC 引用 + W30 follow-up 标识）
grep -qE 'PRD 字面值与代码现实差异清单|PRD vs.*代码现实.*差异' "$REPORT" || { echo "FAIL: 报告缺 PRD 字面值与代码现实差异清单 段"; exit 1; }
grep -qE 'count.*limit.*total|limit.*total.*count' "$REPORT" || { echo "FAIL: 报告缺 response shape diff (count vs limit+total)"; exit 1; }
grep -qE 'skipped_hol|failed_dispatch' "$REPORT" || { echo "FAIL: 报告缺 event_type enum diff (4 字面值 vs 2 字面值)"; exit 1; }
grep -qE 'dispatch\.js|dispatch-stats\.js' "$REPORT" || { echo "FAIL: 报告缺代码 LOC 引用 (dispatch.js/dispatch-stats.js)"; exit 1; }
grep -qE 'W30|follow-up|后续' "$REPORT" || { echo "FAIL: 报告缺 W30 follow-up 标识"; exit 1; }

# E. 真跑 smoke（无 env 走 SKIP exit 0；real-env-smoke 上跑真 e2e）
OUT=/tmp/w29-acceptance-smoke.out
rm -f "$OUT"
bash "$SMOKE" > "$OUT" 2>&1
RC=$?
[ $RC -eq 0 ] || { echo "FAIL: smoke exit $RC（非 0）"; head -50 "$OUT"; exit 1; }
head -5 "$OUT" | grep -qE '^SKIP:' || {
  # 没走 SKIP 退路 → 必须真打到 19 个分段 PASS 标记 + 整体 PASS（v3 新增 B6-KEYS / B6-BANNED / B6-ERR）
  for tag in "\[B1\] PASS" "\[B2\] PASS" "\[B2-RET\] PASS" "\[B3-IN\] PASS" "\[B3-OUT\] PASS" "\[B4\] PASS" "\[B4-LOG\] PASS" "\[B5-A\] PASS" "\[B5-BC\] PASS" "\[B5-LOG\] PASS" "\[B6-TABLE\] PASS" "\[B6-EP\] PASS" "\[B6-KEYS\] PASS" "\[B6-BANNED\] PASS" "\[B6-ERR\] PASS" "\[B6-ENUM\] PASS" "\[B7-SHAPE\] PASS" "\[B7-ENUM\] PASS" "\[walking-skeleton-p1-终验\] PASS"; do
    grep -qE "^$tag" "$OUT" || { echo "FAIL: smoke stdout 缺标记 $tag"; head -100 "$OUT"; exit 1; }
  done
}

echo "✅ Golden Path 验证通过（W29 Walking Skeleton P1 终验）"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 4

### Workstream 1: 整合 smoke 骨架 + happy path（Steps 1-3）

**范围**: 创建 `packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh`，shebang + `set -euo pipefail` + 顶部 brain/pg 探测（不可用 SKIP exit 0）+ psql/curl helpers + assert helpers + `test-w29-` 隔离前缀 + Steps 1-3（投 task → POST /api/brain/tick → 断言 dispatch_events 表 + /dispatch/recent shape + event_type enum + slot +1 → 模拟 reportNode 写回 + task_events）。该 WS 必须打印 `[B1]/[B3-IN]/[B6-TABLE]/[B6-EP]/[B6-ENUM]` 5 个分段 PASS 标记。

**大小**: M（≈ 130 LOC bash + ≈ 30 LOC node helpers）
**依赖**: 无
**BEHAVIOR ids 覆盖**: ws1-skip-or-run, ws1-b1-reportnode-writeback, ws1-b3-slot-in, ws1-b6-table-write, ws1-b6-endpoint-shape, ws1-b6-event-type-enum

---

### Workstream 2: HOL skip + zombie reaper 段（Steps 4-5）

**范围**: 在 WS1 smoke 上追加 Step 4（填满 codex pool 让 task_A 触发 HOL skip 分支 + 验 task_B/C 派发 + 验 dispatcher 真日志 'HOL skip'）+ Step 5（构造 zombie + `reapZombies({idleMinutes:0})` + 验 status=failed + error_message + 返回 shape + slot -1）。该 WS 必须打印 `[B5-A]/[B5-BC]/[B5-LOG]/[B2]/[B2-RET]/[B3-OUT]` 6 个分段 PASS 标记。

**大小**: M（≈ 70 LOC 追加）
**依赖**: WS1
**BEHAVIOR ids 覆盖**: ws2-b5-hol-task-a-claim-released, ws2-b5-task-bc-dispatched, ws2-b5-dispatcher-log, ws2-b2-zombie-reaped-failed, ws2-b2-reaper-return-shape, ws2-b3-slot-out

---

### Workstream 3: guidance TTL + heartbeat + 出口 PASS（Steps 6-8）

**范围**: 追加 Step 6（B4 guidance：INSERT 30min stale + `getGuidance` → null + 真日志验）+ Step 7（B7 fleet：startFleetRefresh + getFleetStatus + 字段 shape + enum 验 + stopFleetRefresh 清理）+ Step 8（出口：trap EXIT 清理 test-w29-* + echo 整体 PASS + exit 0）。该 WS 必须打印 `[B4]/[B4-LOG]/[B7-SHAPE]/[B7-ENUM]/[walking-skeleton-p1-终验]` 5 个分段 PASS 标记。

**大小**: M（≈ 60 LOC 追加）
**依赖**: WS2
**BEHAVIOR ids 覆盖**: ws3-b4-stale-returns-null, ws3-b4-guidance-log, ws3-b7-shape, ws3-b7-enum, ws3-overall-pass, ws3-overall-exit-zero

---

### Workstream 4: Acceptance report

**范围**: 新建 `sprints/w29-walking-skeleton-p1/acceptance-report.md`，汇总 B1–B7 7 项修复 + 每项修复 PR + 在本 smoke 对应 Step 号 + smoke 输出片段占位（合并 PR 时回填）+ CI 集成方式说明（`real-env-smoke` job 已通过 glob 自动包含本 smoke，无需追加 workflow step）。

**大小**: S（≈ 50 行 markdown）
**依赖**: WS3
**BEHAVIOR ids 覆盖**: ws4-coverage-b1-b7, ws4-smoke-ref, ws4-ci-integration-note, ws4-pass-signal-literal, ws4-step-mapping, ws4-pr-evidence-placeholder

---

## Test Contract

| Workstream | Test File（vitest，generator TDD red-green 用，**不**当 evaluator oracle）| evaluator 真 oracle |
|---|---|---|
| WS1 | `tests/ws1/smoke-harness.test.ts` | contract-dod-ws1.md `[BEHAVIOR ws1-*]` 6 条 |
| WS2 | `tests/ws2/hol-zombie.test.ts` | contract-dod-ws2.md `[BEHAVIOR ws2-*]` 6 条 |
| WS3 | `tests/ws3/guidance-heartbeat-exit.test.ts` | contract-dod-ws3.md `[BEHAVIOR ws3-*]` 6 条 |
| WS4 | `tests/ws4/acceptance-report.test.ts` | contract-dod-ws4.md `[BEHAVIOR ws4-*]` 6 条 |

**预期 Red 证据**: 4 个 vitest 文件在 generator 开始 implementation 前必失败（文件/字串不存在）。`npx vitest run sprints/w29-walking-skeleton-p1/tests/` 必出 FAIL summary。

---

## Risk Register

| # | 风险 | 概率 | 影响 | Mitigation | 验证哪里 |
|---|---|---|---|---|---|
| R1 | HOL skip 触发条件比预期严苛（必须 codex pool 满 + non-P0 队首）→ smoke 构造复杂；可能误触 `all_candidates_failed_pre_flight` 而非 HOL 分支 | M | H — B5 验证误判 | smoke 复用 `dispatcher-hol-skip-smoke.sh` 已验过的代码路径模式；BEHAVIOR ws2-b5-dispatcher-log 强制 grep `HOL skip` 真日志（而非 echo 自吹）+ ws2-b5-hol-task-a-claim-released 强制断 claimed_by 释放（HOL skip 分支专属 SQL） | dod-ws2 ws2-b5-* 三条 |
| R2 | `reapZombies({idleMinutes:0})` 在 test 模式可能误标其他 in_progress task → DB 污染 + 其他测试误伤 | M | M | smoke 强制 `test-w29-` 隔离前缀；trap EXIT 清理；reaper 调用前先 INSERT 只此一条 zombie 让 `scanned == reaped == 1` 验证（dod-ws2 ws2-b2-reaper-return-shape） | dod-ws2 ws2-b2-* |
| R3 | `DECISION_TTL_MIN` / `HEARTBEAT_OFFLINE_GRACE_MIN` env 阈值在 CI 跟 prod 默认不同 → smoke 跑久（或假绿）| L | M | smoke 内显式 `export DECISION_TTL_MIN=0.1` 让 6 秒就过期；HEARTBEAT 段不模拟超时只验字段 shape（不依赖时间）；contract-dod-ws3 BEHAVIOR ws3-b4-* / ws3-b7-* 不依赖默认阈值 | dod-ws3 ws3-b4-* ws3-b7-* |
| R4 | `/api/brain/dispatch/recent` 响应 shape 真在某次 refactor 改了（PRD `[ASSUMPTION]` "若漂移以代码为准" 留口子）→ contract jq -e 命令失效 | L | H | smoke 用 jq -e 严格 `keys == ["events","limit","total"]` + `! has("count")` 等反向检查；shape 改 → smoke fail → 强迫开发者同步更新 contract + PRD；BEHAVIOR ws1-b6-endpoint-shape 防漂 | dod-ws1 ws1-b6-endpoint-shape |
| R5 | smoke 在 evaluator 无 brain/无 pg 环境跑 → 期望 SKIP exit 0；若 SKIP 检测漏 → 假绿（无 brain 还是 PASS）| M | H — 评测信任崩 | BEHAVIOR Test 命令头几行 `head -5 OUT \| grep -qE '^SKIP:'` 严格短路；E2E 验收脚本 Section E 强制要求**没走 SKIP 时**必须 16 个分段 PASS 标记一个不少；smoke 内部 SKIP 探测命中后立即 exit 0，不再 echo PASS | E2E 验收 Section E + 所有 BEHAVIOR Test 头部 SKIP 短路 |
| R6 | smoke 内部某段 echo PASS 标记字面值与本合同契约表不一致（一个字符差） | M | M | E2E 验收 Section C 用 grep 严匹配每个 16 个标记字面值；Section E 跑后 grep 实际 stdout；任何差异都 fail；generator code review 时 reviewer 用本合同"smoke 输出标记契约"段作 SSOT 对比 | E2E 验收 Section C + Section E |
| R7 | task_events 表 schema 不存在 `event_type='task_completed'` 字面值约束（开放枚举）→ smoke INSERT 自定义值通过但实际 reportNode 写的是别的值 | L | M | smoke 不主张该字面值是 reportNode 写入值的唯一形态，只验证"投了一行该 event_type 后能查到"作为投递通路证据；PR 评审时 reviewer 须确认与现有 task_events 用法一致 | dod-ws1 ws1-b1-reportnode-writeback（与 PR #2903 ws1 测试约定一致） |
| R8 | `set -euo pipefail` 跟某些 helpers 不兼容（如未设变量解引用 → 提前退出）→ smoke 在 happy path 上误退 | L | M | smoke 内部所有变量都 `${VAR:-default}` 形式或显式 default；CI 上跑全程一次作为冒烟基线；E2E 验收 Section E 直接跑 smoke 检 exit code | E2E 验收 Section E |
| R9 | 整合 smoke 把多个独立 invariant 串行跑 → 单个 invariant fail 后续 fail 难定位 | L | M | smoke 内部每段 PASS 标记前打印 banner `=== Step N: <desc> ===` 便于断点；任意 assertion fail → set -e 立即终止 + 打印失败上下文 | smoke 内部（generator 实现细节） |
| R10 | 本 sprint 假设 B4/B7 阈值已可配（env），但实际可能硬编码 → smoke 跑十几分钟超时 | L | H | DECISION_TTL_MIN 已验证可 env 覆盖（guidance.js:22-25）；HEARTBEAT_OFFLINE_GRACE_MIN 已验证可 env 覆盖（fleet-resource-cache.js:25-29）；如发现新硬编码，proposer 在合同 GAN 阶段允许 generator 小幅 patch 让其可测（PRD ASSUMPTION 已授权） | smoke 内部 export + dod-ws3 BEHAVIOR Test |
| **R11** | **PRD `## Response Schema` 字面值（`{events, count}` + outcome enum `dispatched/skipped_hol/skipped_no_worker/failed`）与代码现实（`{events, limit, total}` + event_type enum `dispatched/failed_dispatch`）双重漂移**。本 sprint 决定按 PRD `[ASSUMPTION]` 条款以代码为准，但此 schema 漂移属于"PRD 是法律但法律自带例外条款时优先适用例外"的边界场景。如果未来 W30+ 回归出现：(a) 代码再次漂回 PRD 字面值，(b) PRD 没及时同步更新代码现实，(c) 第三方/上层依赖按 PRD 字面接 API 实现失配，将没有 trail 找到"为什么 contract 当时这样写"。**当前 sprint 范围之外但必须显式登记，不可默认沉默** | **M** | **H — 回归 trail 断点 / 上游依赖失配** | **(1) WS4 acceptance-report.md 强制独立段 `## PRD 字面值与代码现实差异清单` 列出 2 处差异点（response shape: PRD `count` ↔ 代码 `limit+total`；event_type enum: PRD 4 字面值 ↔ 代码 2 字面值）+ 每处对应代码 LOC 引用（`packages/brain/src/routes/dispatch.js:34-38` / `packages/brain/src/dispatch-stats.js:125-130`）+ 显式 W30 follow-up 标识（建议项："PRD 同步更新 PR" or "保留 PRD 历史/代码现实分流"，由 W30 立项决议）。(2) contract `ws1-b6-endpoint-shape` + `ws1-b6-keys-strict` + `ws1-b6-banned-reverse` + `ws1-b6-event-type-enum` 四条 BEHAVIOR 同时强制 jq -e 严等代码现实字面值——任何方向回归（代码漂回 PRD 字面 OR 代码引入新字段）smoke 都立即 fail 揪出来。(3) BEHAVIOR `ws4-prd-vs-code-diff` 强制 evaluator 真 grep 报告里两处差异点字面 keyword 存在，避免合并 PR 时被遗漏 trail 记录** | **dod-ws4 ws4-prd-vs-code-diff（trail 登记）+ dod-ws1 ws1-b6-keys-strict / ws1-b6-banned-reverse / ws1-b6-event-type-enum / ws1-b6-endpoint-shape（防止双向漂移）** |

---

## 禁止事项（generator must respect）

1. **不动 B1–B7 任何一项的实现代码**（已合并到 main，本次只验，不改）
2. **不引入新诊断 endpoint**（B6 的 `/dispatch/recent` 已经够用）
3. **不动 walking-skeleton-1node graph 本身**（与本 P1 批 7 项 bug 解耦；PRD 明示）
4. **不做性能 benchmark / 不验 throughput**（终验目标是功能闭环全绿）
5. **不做 Brain restart 容灾测试**（PRD 明示在 1node smoke Phase 2 范围）
6. **不动 dashboard / 不动 ACTION_WHITELIST / 不动 LOCATION_MAP**（PRD 范围限定）
7. **smoke 分段 PASS 标记字面值必须与本合同 "smoke 输出标记契约" 段一字不差**（contract 是法律，generator 是翻译）
8. **smoke 必须用 `set -euo pipefail`，PASS 标记必须在该段所有 assertion 真过后才 echo**（任何 `echo "PASS"` 在 assertion 之前都构成造假，code review 拦）
