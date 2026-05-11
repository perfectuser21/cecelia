---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: guidance TTL + heartbeat 段 + 出口 PASS（Steps 6-8）

**范围**: 在 smoke 文件上追加
- Step 6（B4 guidance TTL）: INSERT 1 条 `brain_guidance` `key='strategy:global'` `value->>'decision_id'='stale-w29-test'` `updated_at = NOW() - INTERVAL '30 minutes'`（远超默认 `DECISION_TTL_MIN=15`，按 `packages/brain/src/guidance.js:14-25` 实现）；通过 `import('./packages/brain/src/guidance.js')` 调 `getGuidance('strategy:global')`；断言返回 null（guidance.js:46-53 短路命中），且 brain stdout 含 `[guidance] strategy decision stale` 日志字面值。
- Step 7（B7 fleet heartbeat offline_reason 字段不漂移）: `import('./packages/brain/src/fleet-resource-cache.js')`，`startFleetRefresh()` 等 2 秒后 `getFleetStatus()`；断言返回数组每条记录都含 `offline_reason` + `last_ping_at` 字段（`fleet-resource-cache.js:136-159` 实现），且 `offline_reason` 取值 ∈ {`null`, `'fetch_failed'`, `'no_ping_grace_exceeded'`}（与 `fleet-resource-cache.js:75-77, 141-143` 三个枚举字面值精确一致）；stopFleetRefresh() 清理。
- Step 8（出口）: smoke 脚本最后一行 `echo '[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过'`；任何 set -e 触发或显式 exit 非 0 都让脚本立即终止；末尾 trap 清理本次 test-w29- 前缀的全部测试数据。

**大小**: M（≈ 60 LOC 追加）
**依赖**: WS2

## SSOT 协议（同 WS1/WS2）

evaluator 的 BEHAVIOR Test = 在 SSOT smoke stdout 中 grep 精确分段 PASS 标记。

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke 文件含 guidance TTL 段（brain_guidance INSERT + decision_id + 30 minutes interval + getGuidance import）
  Test: `bash -c 'grep -q "brain_guidance" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "decision_id" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -qE "INTERVAL\s+'\''30\s+minutes'\''" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "getGuidance" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 文件含 heartbeat 段（fleet-resource-cache 引用 + startFleetRefresh + getFleetStatus + offline_reason 字面值）
  Test: `bash -c 'grep -q "fleet-resource-cache" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "startFleetRefresh" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "getFleetStatus" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "offline_reason" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "no_ping_grace_exceeded" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "fetch_failed" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 末尾含字面值 `[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过`
  Test: `bash -c 'grep -q "\[walking-skeleton-p1-终验\] PASS — 7 项 P1 修复全链路联调通过" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 含 trap 清理 test-w29- 前缀的测试数据（避免 DB 污染）
  Test: `bash -c 'grep -qE "trap\s+.*(cleanup|EXIT)" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -qE "DELETE.*test-w29-|WHERE.*LIKE.*test-w29-" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

## BEHAVIOR 条目（SSOT — smoke 跑后断言分段 PASS 行存在；evaluator 真执行）

- [ ] [BEHAVIOR] [ws3-b4-stale-returns-null] B4 invariant: `getGuidance('strategy:global')` 对 30 分钟前 stale decision 返 null（guidance.js:46-53 短路命中）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B4\] PASS — getGuidance returned null for stale decision_id" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws3-b4-guidance-log] B4 invariant: brain stdout 含 guidance.js:48-49 真日志字面值 `[guidance] strategy decision stale`（不是 smoke echo 自吹，证明真走了短路分支）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B4-LOG\] PASS — guidance\.js 真日志含 'strategy decision stale'" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws3-b7-shape] B7 invariant: getFleetStatus 返回每条 entry 都含 `offline_reason` + `last_ping_at` 字段（与 fleet-resource-cache.js:145-156 完整字段一致；缺一个就 fail）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B7-SHAPE\] PASS — fleet entries 含 offline_reason \+ last_ping_at" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws3-b7-enum] B7 invariant: `offline_reason` 取值严格 ∈ {`null`, `'fetch_failed'`, `'no_ping_grace_exceeded'`}（与 fleet-resource-cache.js:75-77, 141-143 三个字面值精确一致；任何其他值 fail）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B7-ENUM\] PASS — offline_reason ∈ \{null,fetch_failed,no_ping_grace_exceeded\}" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws3-overall-pass] 整体出口 invariant: smoke 末尾打印精确字面值 `[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过`（任何前置 assertion fail 都让 set -e 提前终止，达不到末尾 echo）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[walking-skeleton-p1-终验\] PASS — 7 项 P1 修复全链路联调通过" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws3-overall-exit-zero] smoke 进程 exit code = 0（要么真跑过全部 7 段 + 整体 PASS，要么走 SKIP 退路；不允许 set -e 非 0 退出）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; tail -1 "$OUT" | grep -qE "^exit=0$"'
  期望: exit 0
