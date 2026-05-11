---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 整合 smoke 骨架 + happy path（Steps 1-3）

**范围**: 创建 `packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh`，含 shebang + `set -euo pipefail` + 顶部环境探测（brain/pg 不可用 → SKIP exit 0）+ 隔离前缀清理 helper + assert helper + Steps 1-3（投 task → POST /api/brain/tick → 断言 dispatch_events 表 5 分钟内 ≥ 1 行 + /api/brain/dispatch/recent jq -e 严 keys 完整性 + jq -e 6 个禁用字段反向 + 非法 query error path 4xx + event_type ∈ enum → SQL 模拟 reportNode 写回 status='completed' + 写 task_events 'task_completed' → 断言 tasks.status='completed' 且 updated_at 1 分钟内）。

**大小**: M（≈ 150 LOC bash + ≈ 30 LOC node helpers — Round 3 因 B6 段拆 4 条 jq -e oracle 略增）
**依赖**: 无

## SSOT 协议

本 DoD 的 [BEHAVIOR] 条目 = evaluator **真执行的命令**（SSOT，单一事实源）。
所有 [BEHAVIOR] Test 命令一律采用相同 pattern：
1. 跑 `packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh`（首次跑时缓存到 `/tmp/w29-acceptance-smoke.out`，后续 BEHAVIOR 复用同一份输出，避免重复跑七遍）
2. 若 stdout 首行命中 `^SKIP:` → 评测视为 PASS exit 0（PRD 边界："本地无 docker 时不算 fail"）
3. 否则按 PRD 设计的"分段 PASS 标记"在 stdout 中 grep 精确字面值（例如 `[B1] PASS — reportNode 写回 ...`）

smoke 内部用 `set -euo pipefail`，分段 PASS 行只有在该段所有 psql/node assertion 真过后才会被 `echo` 出来；因此 `grep -q "^\[B1\] PASS"` 等价于"smoke 真跑过 B1 那段且全过"。

contract-draft.md 的 Step 验证命令段只能**引用** 本 DoD 的 BEHAVIOR id（如 `参见 contract-dod-ws1.md [BEHAVIOR] [ws1-b1-reportnode-writeback]`），**禁止**粘贴第二份 psql 命令。

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke 脚本文件存在且可执行
  Test: `bash -c '[ -x packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh ]'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 顶部 shebang + set -euo pipefail
  Test: `bash -c 'head -3 packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh | grep -q "^#!/usr/bin/env bash" && grep -q "^set -euo pipefail" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 顶部含隔离前缀 `test-w29-` 便于幂等清理
  Test: `bash -c 'grep -q "test-w29-" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 顶部含 brain/pg 环境探测（探测失败 → SKIP exit 0）
  Test: `bash -c 'grep -qE "SKIP:.*(docker|brain|pg|postgres|not available|不可用)" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "exit 0" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 文件含 /dispatch/recent shape jq -e 严 keys 完整性断言（`jq -e .keys == [`）
  Test: `bash -c 'grep -qE "jq\s+-e\s+.keys\s*==\s*\[" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 文件含 6 个禁用字段反向 `! has(...)` 断言（data/results/payload/count/records/history 任意 ≥ 4 个字面值出现作反向断言段证据）
  Test: `bash -c 'C=0; for k in data results payload count records history; do grep -qE "has\\(\"$k\"\\)" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && C=$((C+1)); done; [ $C -ge 4 ]'`
  期望: exit 0（≥ 4 个禁用字段反向断言）

- [ ] [ARTIFACT] smoke 文件含 /dispatch/recent error path 段（非法 query 期待非 2xx）
  Test: `bash -c 'grep -qE "(limit=foo|limit=-1|/recentXYZ|/dispatch/recent[^ ]*=[^0-9])" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -qE "(http_code|status.*[45][0-9][0-9])" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

## BEHAVIOR 条目（SSOT — smoke 跑完后断言分段 PASS 行存在；evaluator 真执行）

- [ ] [BEHAVIOR] [ws1-skip-or-run] smoke 整脚本要么走 SKIP exit 0（无 brain/无 pg 时），要么真跑到最后并打印整体 PASS 信号
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[walking-skeleton-p1-终验\] PASS — 7 项 P1 修复全链路联调通过" "$OUT"'
  期望: exit 0（要么 SKIP 退路，要么真跑到底）

- [ ] [BEHAVIOR] [ws1-b1-reportnode-writeback] B1 invariant: reportNode 写回后 tasks.status 从 in_progress 变 completed 且 updated_at 1 分钟内（smoke 该段所有 psql assert 真过后才打印此标记）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B1\] PASS — reportNode 写回 tasks\.status=completed" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws1-b6-table-write] B6 invariant: dispatch_events 表在 POST /api/brain/tick 之后 5 分钟内多 ≥ 1 行（task_id=本测试前缀，created_at 时间窗口断言防造假）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B6-TABLE\] PASS — dispatch_events \+[1-9][0-9]* 行 within 5min" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws1-b6-endpoint-shape] B6 invariant: GET /api/brain/dispatch/recent 响应 shape 严格为 `{events:array, limit:number, total:number}`（按 PRD `[ASSUMPTION]` 条款以代码为准；禁用字段 `data/results/payload/count/records` 反向不存在 — 复合断言；ws1-b6-keys-strict / ws1-b6-banned-reverse 是其拆分细化）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B6-EP\] PASS — /dispatch/recent shape=\{events,limit,total\} no_banned_keys=ok" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws1-b6-keys-strict] B6 invariant (粒度细化 — 配合 R11 漂移防御): smoke 段在 echo `[B6-KEYS] PASS` 之前必须真跑 `curl -fs localhost:5221/api/brain/dispatch/recent | jq -e 'keys == ["events","limit","total"]'`，jq -e 非 0 退则 set -e 终止；不能多 key 不能少 key 不能换名。这条独立 BEHAVIOR 覆盖"schema 完整性 keys 集合"category（PRD `count` ↔ 代码 `limit+total` 漂移防双向回归）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B6-KEYS\] PASS — /dispatch/recent jq -e .keys == \[" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws1-b6-banned-reverse] B6 invariant (粒度细化 — 配合 R11 漂移防御): smoke 段在 echo `[B6-BANNED] PASS` 之前必须真跑 6 条独立 `jq -e '! has("X")'` 反向断言（X ∈ {`data`, `results`, `payload`, `count`, `records`, `history`}）；任一禁用字段一旦出现 set -e 立即终止。这条独立 BEHAVIOR 覆盖"禁用字段反向"category（PRD 字面 `count` 字段已显式列入禁用，防止 generator 误"语义优化"漂回 PRD 字面）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B6-BANNED\] PASS — /dispatch/recent banned_keys=∅ \(data,results,payload,count,records,history\)" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws1-b6-error-path] B6 invariant (新增 — error path category): smoke 段必须用非法 query（如 `limit=foo` 字符串、或 `limit=-1` 负数、或路径错乱 `/api/brain/dispatch/recentXYZ`）打 `/api/brain/dispatch/recent`，断言 HTTP 状态码 ∈ {400,404,422,500} 任一非 2xx；若服务端真返 200（说明 endpoint 缺 error path 防御），smoke fail。这条独立 BEHAVIOR 覆盖"error path"category（v7.6 阈值 4 类场景的第 4 类）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B6-ERR\] PASS — /dispatch/recent error path" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws1-b6-event-type-enum] B6 invariant: dispatch_events 表内对应 task 的 event_type 字面值 ∈ {`dispatched`, `failed_dispatch`}（与 `packages/brain/src/dispatch-stats.js:125-130` 代码 enum 一致；PRD `[ASSUMPTION]` 授权以代码为准；配合 R11 漂移防御：PRD 字面 `skipped_hol/skipped_no_worker/failed` 三个值绝对不应出现在代码 event_type 字段里）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B6-ENUM\] PASS — event_type ∈ \{dispatched,failed_dispatch\}" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws1-b3-slot-in] B3 invariant: 派发成功后 slot 计数 in_progress 相对基线 +1（用 `GET /api/brain/tick/status` 或对应 slot 查询接口在派发前后两次取值断言增量）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B3-IN\] PASS — slot in_progress \+1" "$OUT"'
  期望: exit 0
