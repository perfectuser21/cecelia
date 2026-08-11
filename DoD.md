# DoD — 凭据新鲜度前置闸（token 过期时退避等待而非空烧 attempt）

事故实证（2026-08-10）：provider 凭据 access token 过期期间 kernel 仍照常派发 attempt，
每次 384ms 死在 "Not logged in · Please run /login"，零 token 消耗纯空转，三条 run 被判
terminal（callback_runner_failure）。本任务在派发前加**只读**凭据新鲜度闸，让 run 走
既有 infrastructure backoff 退避等待，凭据恢复新鲜后自行继续。

> 说明：本任务由 fleet generator 从 thin-PRD 直接实现（无 GAN 合同分支）。权威回归测试落在
> `packages/brain/src/orchestrator/preflight/`（brain-unit CI 收集 `src/**`），符合硬规则 20
> 「failing test 永久留 CI」。

## [ARTIFACT]

- [x] [ARTIFACT] `packages/brain/src/orchestrator/preflight/credential-freshness.js` — 纯只读凭据新鲜度模块（inspectCredentialFreshness / createCredentialFreshnessCheck / 阈值解析）
- [x] [ARTIFACT] `packages/brain/src/orchestrator/preflight/capability-gate.js` — 在候选选择前插入 checkCredentialFreshness，凭据不新鲜则跳过该 account 并走 blockedResult（infrastructure_blocked / should_create_attempt=false）+ emitAlert
- [x] [ARTIFACT] `packages/brain/src/orchestrator/run.js` — 生产 wiring：仅对 claude provider 解析 `~/.claude-accountN/.credentials.json`，注入 gate
- [x] [ARTIFACT] `packages/brain/scripts/smoke/credential-freshness-preflight-smoke.sh` — 真环境自验脚本（已登记 smoke-allowlist）
- [x] [ARTIFACT] `packages/brain/src/orchestrator/preflight/credential-freshness.test.js` — 纯模块单测（阈值 / 文件缺失·非法·缺 oauth / 只读红线 mtime 不变）
- [x] [ARTIFACT] `packages/brain/src/orchestrator/preflight/credential-freshness-gate.test.js` — capability gate 拦截 + 告警单测
- [x] [ARTIFACT] `packages/brain/src/orchestrator/preflight/credential-freshness-dispatch.test.js` — dispatch 端「未调用 spawn」+ 恢复推进单测

## [BEHAVIOR]

- [x] [BEHAVIOR] credential-freshness-preflight 真环境全过（token 5min 拦截 / 8h 放行 / 文件缺失·非法·缺 oauth 三拦截 / 只读红线 mtime 不变 / codex 跳过）
      Test: manual:bash packages/brain/scripts/smoke/credential-freshness-preflight-smoke.sh
