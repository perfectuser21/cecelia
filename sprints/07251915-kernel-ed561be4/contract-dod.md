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

- [ ] [ARTIFACT] Red→Green 证据覆盖本 sprint 合同测试，且不改写冻结合同/telemetry schema
  Test: node -e "const fs=require('fs');const prd=fs.readFileSync('sprints/07251915-kernel-ed561be4/sprint-prd.md','utf8');if(!prd.includes('不得削弱、删除或改写既有合同测试凑绿'))throw new Error('prd anchor missing');const tests=fs.readFileSync('sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts','utf8')+fs.readFileSync('sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts','utf8');if(!tests.includes('logical_cycle'))throw new Error('missing logical_cycle coverage')"

- [ ] [ARTIFACT] Brain 版本账本同步
  Test: bash scripts/check-version-sync.sh

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] dispatcher 在 createAttempt 前执行 preflight 并写 capability_snapshot_id
  动作: 以注入依赖运行真实 `createDispatcher`，传入能力满足与能力缺失两组上下文；能力缺失时尝试派发 generator/proposer 角色。
  预期观察: dispatcher 先调用 preflight gate，再决定是否写 `harness_attempts`；健康路径把 `capability_snapshot_id` 传入 attempt bundle/result，缺能力路径不调用 `launcher.launch`。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "dispatcher 在 createAttempt 前执行 preflight 并写 capability_snapshot_id"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] capability snapshot 包含 provider auth GitHub PostgreSQL 外部模型能力与 canonical machine_id
  动作: 调用真实 capability gate 构造函数，用注入 probe 返回 provider auth、GitHub、PostgreSQL、model、machine、health、capacity 结果，并给出冻结合同要求。
  预期观察: 产出的 snapshot keys 完整且字段命名稳定；任一 required capability 缺失时返回 `contract_capability_mismatch` 或 `infrastructure_blocked`，不会返回 success。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "capability snapshot 包含 provider auth GitHub PostgreSQL 外部模型能力与 canonical machine_id"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] team4 503 后同 cycle 最多重试一次且切换同 provider 健康账号 team1
  动作: 用结构化 transient provider failure fixture 触发 capability gate，保持同一 logical_cycle 与 role/phase，模拟 team4 第一次 503、恢复重试仍失败、team1 健康。
  预期观察: 同账号仅一次恢复重试；随后短时熔断 team4，并按固定顺序切到 team1；`from_target`、`to_target`、`fallback_reason` 写入结构化 evidence。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "team4 503 后同 cycle 最多重试一次且切换同 provider 健康账号 team1"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 全池失败或 contract capability mismatch 返回 infrastructure_blocked 且不创建 attempt
  动作: 构造五个 Codex 账号全失败、合同要求能力与 snapshot 不匹配两组 case，并通过真实 dispatcher/preflight 路径派发。
  预期观察: 返回 `infrastructure_blocked` 或 `contract_capability_mismatch`；`attemptStore.createAttempt` 次数保持 0；分类不进入 generator-fix。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "全池失败或 contract capability mismatch 返回 infrastructure_blocked 且不创建 attempt"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] capacity cache 误报与宿主真实凭据不一致时 fail-safe
  动作: 注入“容量缓存可用但真实凭据探测失败”的 fixture，再运行真实 capability gate。
  预期观察: gate 以真实 probe 为准 fail-safe，返回阻断分类；不会因为缓存可用而放行 attempt。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "capacity cache 误报与宿主真实凭据不一致时 fail-safe"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 未验证 provider-account-machine 组合与未知 machine_id fail-closed
  动作: 注入未验证的 provider×account×machine 组合与未知 `CECELIA_MACHINE_ID` / Fleet 记录，运行真实 execution-target resolver。
  预期观察: 两种 case 都返回 fail-closed；不落 attempt；错误 detail 明确指出非法组合或未知 machine。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "未验证 provider-account-machine 组合与未知 machine_id fail-closed"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] USM4 才允许跨厂商降级，CM4/CM1 禁止本地 Claude 或 Grok
  动作: 分别构造 `us-mac-m4`、`xian-mac-m4`、`xian-mac-m1` 的 Codex 池耗尽 case，运行真实路由决策函数。
  预期观察: USM4 可在 Codex 无法使用时降级到 Claude/Grok；CM4/CM1 只能迁回 USM4 或阻断，绝不在本机挑选 Claude/Grok。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "USM4 才允许跨厂商降级，CM4/CM1 禁止本地 Claude 或 Grok"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 同签名 transient retry 受 logical_cycle 收敛闸约束
  动作: 连续两次以相同 failure signature、相同 logical_cycle 调用 dispatcher preflight 路径。
  预期观察: 第一次按规则恢复重试；第二次不再对白名单同账号重复重试，而是直接走熔断/人工复审路径。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "同签名 transient retry 受 logical_cycle 收敛闸约束"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] container hostname 不会污染 attempt machine_id
  动作: 以 `hostname=79f7d974a2ce`、`CECELIA_MACHINE_ID` 缺失/存在、Fleet 注册命中三组输入运行 canonical machine resolver 与 dispatcher。
  预期观察: resolver 只接受 `{us-mac-m4,xian-mac-m4,xian-mac-m1}`；纯 Docker hostname 必须 fail-closed；成功路径落库 machine_id 为 canonical id 而非容器 hostname。
  验证命令: Test: manual:bash -c 'npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "container hostname 不会污染 attempt machine_id"'
  期望: exit 0

## E2E 验收

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

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
