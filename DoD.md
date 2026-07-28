contract_branch: cp-0728-provider-neutral-phase4a
sprint_dir: docs/superpowers/plans/2026-07-28-provider-neutral-harness-phase-4a-production.md

---
skeleton: false
journey_type: autonomous
target_environment: production
---
# Contract DoD — Provider-neutral Harness Commander Phase 4A

**范围**: 只收敛三台生产 Fleet Node 的 contract、US M4 server baseline、
bootstrap、admission 与 drain。Phase 4B Workspace/transport、Phase 4C
CredentialEnvelope、Phase 4D execution recovery 和 Phase 5 真实业务 Canary 均不在
本 PR 的实现边界。

**大小**: L

## ARTIFACT 条目

- [x] [ARTIFACT] 三台 canonical NodeProfile 共享 US M4 server baseline，并固定
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/fleet-node/node-profile.test.js src/orchestrator/fleet-node/node-admission.test.js'
  Worker/OS floor/OrbStack/Git/Node/Codex、资源阈值、listener/callback 和唯一
  Runner digest
  `sha256:5a4c1918bd30d44ddddd29da6970a85eb49c8394ec3c734d50d3d6e1b6b807e7`。

- [x] [ARTIFACT] `fleet-worker.cjs`、`node-probe.cjs`、system LaunchDaemon plist、
  Test: manual:bash -c 'cd packages/brain && npx vitest run scripts/fleet-worker/fleet-worker.test.js && cd ../.. && bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh && bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh'
  transactional installer 与 `fleet-nodectl.sh` 提供受保护的 health、bootstrap、
  admission、drain 和 undrain；不依赖 GUI LaunchAgent。

- [x] [ARTIFACT] baseline reconciler 固定 Node `25.8.0`、Codex `0.145.0`、
  Test: manual:bash -c 'bash packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh'
  OrbStack `2.2.1`、UID/GID 450 `_cecelia`、credential-free Git baseline 和 pinned
  Runner，并将官方 OrbStack 与 Tailscale app CLI 暴露到 system toolchain PATH。

- [x] [ARTIFACT] rollout 只从 committed Git、pinned Runner 和受保护的 Worker
  Test: manual:bash -c 'bash packages/brain/scripts/fleet-worker/fleet-rollout.test.sh'
  bearer token 构建 root-owned staging；控制器经 sudo 验证/分阶段读取 `_cecelia`
  0700 目录而不放宽权限，不保存或复制 Xian 长期 Codex/provider credential，并按
  Xian M4 → US M4 → Xian M1 顺序执行。

- [x] [ARTIFACT] Brain `1.267.102`、两份 DEFINITION、版本锁、P0 回归契约和
  Test: manual:bash -c 'bash scripts/check-version-sync.sh && BRAIN_URL=http://localhost:5221 bash packages/brain/scripts/smoke/provider-neutral-phase4a-node-smoke.sh && node scripts/registry-lint.mjs && node -e "const fs=require(\"fs\"),yaml=require(\"js-yaml\");yaml.load(fs.readFileSync(\"regression-contract.yaml\",\"utf8\"));yaml.load(fs.readFileSync(\"docs/registry/features/orchestration.yml\",\"utf8\"));"'
  Phase 4A production as-built/实施计划已同步。

## BEHAVIOR 条目

- [x] [BEHAVIOR] [L2] admission 必须检查 machine identity、freshness、drain、
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/kernel-fleet-node-admission-smoke.sh'
  Worker、OS、OrbStack、Git、Node、Codex、Runner digest、磁盘、内存、Docker、
  Git/worktree、callback 网络与角色加权容量；任何缺失或 drift 都 fail closed。
  期望: exit 0

- [x] [BEHAVIOR] [L2] macOS `15.7.4` 是最低补丁线；同一 `15.7` release line
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/fleet-node/node-admission.test.js'
  的更高 patch 可准入，低于 floor、跨 release line 或 malformed version 都返回
  稳定的 fail-closed reason。
  期望: exit 0

- [x] [BEHAVIOR] production capacity 使用 `task_bundle.role` 将 canonical/live
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/fleet-node/node-profile.test.js src/orchestrator/preflight/capability-gate.test.js'
  较小值换算为角色单位。US M4 的 7 个 base slots 对轻量/proposer/heavy 分别为
  7/3/1；两台 Xian 的 8 个 slots 分别为 8/4/2。未知角色不回退到 1:1。
  期望: exit 0

- [x] [BEHAVIOR] [L2] rollout/bootstrap/admission 任一步失败或被 signal 中断都恢复
  Test: manual:bash -c 'bash packages/brain/scripts/fleet-worker/fleet-rollout.test.sh'
  system drain；OrbStack/Docker 是统一执行介质，Xian M1 缺失时补齐 OrbStack，
  Xian M4 的 production Worker 由 system LaunchDaemon 承载。
  期望: exit 0

## 明确非声明

- 本 PR 不修改 Phase 4B/4C/4D 的 Workspace、transport、CredentialEnvelope、
  attestation、reconcile 或 execution recovery 语义。
- 确定性测试、health/admission 和基础设施 smoke 不是 Phase 5 真实业务任务验收；
  不用 synthetic canary 冒充真实业务 Canary。
- Xian 节点不保存或复制长期 Codex/provider credential。Worker bearer token 仅用于
  节点 transport authentication，不是 provider credential。
- Phase 4A 合并和三机 production admission 不代表整个融合 PRD 已完成。

## 回退

```bash
CECELIA_MACHINE_ID=<machine-id> sudo -E \
  packages/brain/scripts/fleet-worker/fleet-nodectl.sh drain <machine-id> --apply

bash scripts/brain-rollback.sh 1.267.101
```

恢复前必须重新取得真实 Worker health evidence 并通过 admission；不得用
synthetic canary 作为恢复依据。
