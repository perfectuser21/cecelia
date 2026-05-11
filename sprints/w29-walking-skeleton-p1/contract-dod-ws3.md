---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: guidance TTL + heartbeat + 出口 PASS（Steps 6-8）

**范围**: 在 smoke 文件上追加 Step 6（B4：INSERT 1 条 brain_guidance 含 `decision_id` + `updated_at = NOW() - INTERVAL '30 minutes'`；node -e 调 `getGuidance('strategy:global')` 应返回 null）+ Step 7（B7：node -e import fleet-resource-cache，startFleetRefresh 后 getFleetStatus；断言每条记录都含 `offline_reason` 字段且取值 ∈ {null, 'fetch_failed', 'no_ping_grace_exceeded'}）+ Step 8（出口：最后一行 `echo '[walking-skeleton-p1-终验] PASS — 7 项 P1 修复全链路联调通过'`；脚本 exit 0；任何失败 set -e 立即终止）。
**大小**: M（≈ 60 LOC 追加）
**依赖**: WS2

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke 文件含 guidance TTL 段（brain_guidance INSERT + getGuidance 调用）
  Test: `bash -c 'grep -q "brain_guidance" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "getGuidance" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 文件含 heartbeat 段（fleet-resource-cache 引用 + offline_reason 验证）
  Test: `bash -c 'grep -q "fleet-resource-cache" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "offline_reason" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 末尾含 `PASS — 7 项 P1 修复全链路联调通过` 字符串
  Test: `bash -c 'grep -q "PASS — 7 项 P1 修复全链路联调通过" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

## BEHAVIOR 条目

- [ ] [BEHAVIOR] guidance 段：INSERT 含 `decision_id` 字段且 `updated_at` 偏移 ≥ 30 分钟前（超过默认 TTL=15min）
  Test: manual:bash -c 'grep -E "decision_id.*stale|INTERVAL[[:space:]]+'\''30[[:space:]]+minutes'\''" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行（含 decision_id + 30 minute offset）

- [ ] [BEHAVIOR] guidance 段：node -e 调用 getGuidance 后断言返回 null（B4 — TTL 短路证据）
  Test: manual:bash -c 'grep -E "getGuidance.*strategy:global|v !== null|v === null|guidance.*null" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行

- [ ] [BEHAVIOR] heartbeat 段：断言 offline_reason 字段存在且枚举值 ∈ {null, fetch_failed, no_ping_grace_exceeded}（B7 — heartbeat shape 不漂移）
  Test: manual:bash -c 'grep -E "no_ping_grace_exceeded|fetch_failed" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh | head -1'
  期望: 输出至少 1 行（含 B7 实际枚举字面值）

- [ ] [BEHAVIOR] 出口段：echo 终验 PASS 信号 + exit 0
  Test: manual:bash -c 'grep -E "echo.*\[walking-skeleton-p1-终验\] PASS" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'
  期望: 输出至少 1 行

- [ ] [BEHAVIOR] 整脚本 bash 执行 exit 0（无 brain/无 docker 时走 SKIP；CI real-env-smoke 上跑真 e2e）
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh; echo "exit=$?"'
  期望: 末尾打印 `exit=0`
