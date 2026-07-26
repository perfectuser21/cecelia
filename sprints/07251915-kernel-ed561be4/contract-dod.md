---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel capability gate：派发前能力预检

**范围**: dispatcher 派发前 preflight、ExecutionTarget 路由矩阵、server-owned capability snapshot、故障分类、canonical machine identity、结构化 evidence 与回归测试。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] preflight / capability-gate / canonical-machine 模块与 dispatcher 最小接线已落到 `packages/brain/src/orchestrator/`
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/src/orchestrator/preflight/capability-gate.js','packages/brain/src/orchestrator/preflight/execution-targets.js','packages/brain/src/orchestrator/preflight/canonical-machine-id.js']){if(!fs.existsSync(p))throw new Error('missing '+p)};const d=fs.readFileSync('packages/brain/src/orchestrator/dispatcher.js','utf8');if(!/preflight|capabilityGate|capability_snapshot_id/.test(d))throw new Error('dispatcher missing preflight wiring')"

- [ ] [ARTIFACT] 稳定 capability parsing/routing/evidence 导出存在，且 Commander/telemetry/跨 run inheritance 保持非实现边界
  Test: bash -c 'node -e "import(\"./packages/brain/src/orchestrator/preflight/capability-gate.js\").then(m=>{for(const n of [\"parseCapabilityRequirements\",\"buildCapabilityEvidence\",\"createCapabilityGate\"]){if(typeof m[n]!==\"function\")throw new Error(\"missing export \"+n)}})" && node -e "import(\"./packages/brain/src/orchestrator/preflight/execution-targets.js\").then(m=>{if(typeof m.resolveExecutionTarget!==\"function\")throw new Error(\"missing resolveExecutionTarget\")})" && CHANGED=$(git diff --name-only origin/main...HEAD) && if printf "%s\n" "$CHANGED" | grep -Eq "packages/brain/src/.*/(commander|telemetry|contract-store)|packages/brain/src/(commander|telemetry)"; then echo "FAIL: scope crossed Commander/telemetry/contract inheritance boundary"; exit 1; fi'

- [ ] [ARTIFACT] Brain 版本账本同步
  Test: bash scripts/check-version-sync.sh

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] dispatcher 真实调用 preflight 后才创建合法 UUID attempt 并写完整 evidence
  动作: 以合法裸 UUID 的 task/run/attempt 运行真实 gate↔dispatcher 接缝。
  预期观察: preflight 严格先于 createAttempt/adapter/launch；attempt bundle 含 capability_snapshot_id 与五字段 evidence。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "dispatcher 真实调用 preflight 后才创建合法 UUID attempt 并写完整 evidence"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] capability parsing routing evidence 是 Commander 可消费的稳定导出且不依赖 Commander
  动作: 直接 import 三个纯函数接口并用 task bundle 调用 parsing/routing/evidence。
  预期观察: 接口保持 role/phase/logical_cycle/task bundle，结果无 CommanderDirective/Actor Inbox 字段。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "capability parsing routing evidence 是 Commander 可消费的稳定导出且不依赖 Commander"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] capability snapshot 包含 provider auth GitHub PostgreSQL 外部模型能力与 canonical machine_id
  动作: 调用真实 capability gate，用注入 probe 生成 server-owned snapshot。
  预期观察: snapshot 包含能力、canonical machine、logical_cycle、created_at/expires_at 与唯一 snapshot id。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "capability snapshot 包含 provider auth GitHub PostgreSQL 外部模型能力与 canonical machine_id"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] capacity cache 可用但宿主真实 credential probe 失败时 fail-safe
  动作: 让容量缓存返回 available=9，同时让宿主 provider credential probe 返回 credential_missing。
  预期观察: 真实 probe 覆盖缓存乐观值，返回 infrastructure_blocked/credential_probe_mismatch 且不创建 attempt。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "capacity cache 可用但宿主真实 credential probe 失败时 fail-safe"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] ExecutionTarget 完整矩阵逐项放行且未列组合 fail-closed
  动作: 表驱动逐项运行 Codex team1..team5×三机、Claude account1/account2×USM4、Grok grok×USM4 及反例。
  预期观察: 恰好 18 个组合通过；CM1/CM4 Claude/Grok、team6、Docker hostname 等未列组合全部拒绝。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "ExecutionTarget 完整矩阵逐项放行且未列组合 fail-closed"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] team4 transient 恢复与跨机跨厂商降级保持确定性
  动作: 触发 team4 503 重试耗尽，并分别运行 CM1/CM4 禁 Claude/Grok、USM4 Claude/Grok、Codex 跨机 fresh recovery。
  预期观察: team4 仅重试一次后切 team1；CM1/CM4 禁跨厂商；USM4 三个降级目标可用；跨机从 Git/PR/DB fresh 恢复且不 resume session。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "team4 503 后同 cycle 最多重试一次且切换同 provider 健康账号 team1|CM1 CM4 禁 Claude Grok 且 USM4 Claude Grok 可确定性降级|Codex 跨机 fresh recovery 保持 task bundle 并从 Git PR DB 真相恢复"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 同 failure signature 同 logical_cycle 跨调用首次最多恢复一次后直接熔断轮换
  动作: 在同一 gate 上以相同 logical_cycle 和 http_503 signature 连续调用两次。
  预期观察: 首次最多重试 team4 一次；后续调用不再 probe team4，直接以 logical_cycle_retry_exhausted 熔断并轮换 team1。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "同 failure signature 同 logical_cycle 跨调用首次最多恢复一次后直接熔断轮换"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 五个 Codex 账号全失败时 dispatcher 不建 attempt 并转人审告警
  动作: 通过真实 gate↔dispatcher 依次让 team1..team5 probe 全失败。
  预期观察: 不创建 attempt、不 launch、不进 generator-fix；返回 wait:human_review/infrastructure_blocked，发带五字段 evidence 的结构化告警。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "五个 Codex 账号全失败时 dispatcher 不建 attempt 并转人审告警"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] provider auth GitHub PostgreSQL 外部模型任一 required capability 缺失均阻断 attempt
  动作: 表驱动逐项让 provider auth、GitHub、PostgreSQL、structured_output probe 缺失，其余 probe 保持健康。
  预期观察: 每一项都返回 infrastructure_blocked/contract_capability_mismatch，createAttempt 与 launch 始终为 0。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "provider auth GitHub PostgreSQL 外部模型任一 required capability 缺失均阻断 attempt"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 能力匹配后的 product failure 仍进入 generator-fix
  动作: 传入 capability_matched=true 与测试断言失败的结构化执行结果。
  预期观察: 分类为 product_failure，action=generator-fix，不能误分为 infrastructure_blocked。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "能力匹配后的 product failure 仍进入 generator-fix"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] canonical machine 仅接受 env 或受控 Fleet 且忽略 Docker hostname
  动作: 直接运行 canonical resolver 的 env、Fleet、缺失、未知、Docker hostname 五组输入。
  预期观察: 只返回三台 canonical id；缺失/未知/Docker hostname 均 fail-closed。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "canonical machine 仅接受 env 或受控 Fleet 且忽略 Docker hostname"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] preflight probe 有界 timeout 且过期 snapshot 竞态不得放行
  动作: 让 GitHub probe 永不 resolve，并在 snapshot 生成后推进 server clock 越过 expires_at；另在 dispatcher createAttempt 前制造过期竞态。
  预期观察: 250ms 内返回 preflight_timeout；过期 snapshot 返回 capability_snapshot_expired 且 createAttempt/launch 都为 0。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "preflight probe 有界 timeout 且过期 snapshot 竞态不得放行" && npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "过期 snapshot 在 createAttempt 前被竞态闸拒绝"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 结构化 evidence 脱敏凭据并保留路由审计字段
  动作: 构造含 authorization/token/password/cookie 的 probe detail，调用真实 evidence builder。
  预期观察: 凭据原文全部消失并替换为 [REDACTED]；五个路由/分类审计字段保持。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "结构化 evidence 脱敏凭据并保留路由审计字段"'
  期望: exit 0

## E2E 验收

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

HARNESS_TASK_ID="${HARNESS_TASK_ID:-ed561be4-940a-4c26-844c-e3c5a5a3f7c8}"
TASK_JSON=$(curl -fsS --max-time 10 "http://localhost:5221/api/brain/tasks/$HARNESS_TASK_ID")
echo "$TASK_JSON" | jq -e --arg id "$HARNESS_TASK_ID" '
  (.id // .task.id) == $id
  and ((.title // .task.title) | contains("Kernel capability gate"))
  and ((.payload.sprint_dir // .task.payload.sprint_dir) == "sprints/07251915-kernel-ed561be4")
' >/dev/null

npx vitest run \
  sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts \
  sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts \
  packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  packages/brain/src/orchestrator/__tests__/derive.test.js \
  packages/brain/src/__tests__/dispatcher-preflight-three-strikes.test.js \
  packages/brain/src/__tests__/executor-codex-review-preflight.test.js \
  packages/brain/src/__tests__/fleet-heartbeat.test.js

bash scripts/check-version-sync.sh
```
