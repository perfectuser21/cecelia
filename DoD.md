contract_branch: cp-07270814-fleet-node-admission-4a
sprint_dir: docs/superpowers/plans/2026-07-27-fleet-node-phase-4-wiring.md

---
skeleton: false
journey_type: autonomous
target_environment: local
---
# Contract DoD — Phase 4A Fleet Node Contract and base admission

**范围**: 三台 canonical Fleet Node 的 immutable profile、system LaunchDaemon
Worker 健康证据、本地基础准入计算、bootstrap/drain 工具，以及 production
machine-health 的 mandatory fail-closed 接线。

**大小**: L

## ARTIFACT 条目

- [x] [ARTIFACT] NodeProfile、纯基础准入 evaluator 与有界 Worker evidence client
  已落到 `packages/brain/src/orchestrator/fleet-node/`，canonical policy 固定三台
  machine、Runner digest、Worker listener、Worker/OS/OrbStack/Git/Node/Codex
  版本和资源阈值；US listener 为 loopback，Xian listener 为各自 Tailscale IP。
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/fleet-node/node-profile.test.js src/orchestrator/fleet-node/node-admission.test.js src/orchestrator/fleet-node/node-admission-client.test.js'

- [x] [ARTIFACT] `fleet-worker.cjs` 与 `node-probe.cjs` 提供 system LaunchDaemon
  的只读、有界、脱敏 `/health` 报告；一次性 worktree/container/callback 探针
  都有 cleanup，且无 credential/account/prompt 材料。
  Test: manual:bash -c 'cd packages/brain && npx vitest run scripts/fleet-worker/fleet-worker.test.js'

- [x] [ARTIFACT] Worker plist、transactional installer 与 `fleet-nodectl.sh`
  bootstrap/status/admit/drain/undrain 命令已冻结；plist 固定 `/var/run/docker.sock`，
  installer 为 `_cecelia` 管理最小 owner-home search ACL，远程 mutation 不在命令能力内。
  Test: manual:bash -c 'bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh && bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh'

- [x] [ARTIFACT] P0 `must_never_break` 回归、feature registry、smoke allowlist 与
  Brain `1.267.90` canonical version sources 已同步。
  Test: manual:bash -c 'bash scripts/check-version-sync.sh && node scripts/registry-lint.mjs && node -e "const fs=require(\"fs\"),yaml=require(\"js-yaml\");yaml.load(fs.readFileSync(\"regression-contract.yaml\",\"utf8\"));yaml.load(fs.readFileSync(\"docs/registry/features/orchestration.yml\",\"utf8\"));"'

## BEHAVIOR 条目

- [x] [BEHAVIOR] [L2] 完整、匹配且新鲜的 report 只能得到
  `base_admitted=true` 与 `dispatch_ready=false`；M1 Docker 不可用、错误 Runner
  digest、drain 或任一必需证据失败都得到 `draining`。
  动作: 运行冻结 Fleet Node contract smoke 的正例、M1 Docker 反例、digest
  反例和角色容量断言。
  预期观察: smoke exit 0；成功态也不授予最终 dispatch readiness。
  Test: contract:KERNEL-FLEET-NODE-ADMISSION-01
  期望: exit 0

- [x] [BEHAVIOR] production capacity 使用 `task_bundle.role` 将 canonical/live
  较小值换算成角色单位：8 个 base slots 得到 planner/reporter 8、proposer 4、
  generator 2；generator 只有 3 个 base slots 时 capability gate 必须阻断，
  缺失或未知角色不得回退到 1:1。
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/fleet-node/node-profile.test.js src/orchestrator/preflight/production-probes.test.js src/orchestrator/preflight/capability-gate.test.js src/orchestrator/preflight/production-wiring.test.js'
  期望: exit 0

- [x] [BEHAVIOR] [L2] production machine health 必须取得 server-owned Worker URL
  的新鲜 evidence，再由 Brain immutable profile 计算准入；不存在
  `online`/`effective_slots` fallback 或 default-off enforcement flag。
  动作: 表驱动运行 Worker URL 缺失、redirect、timeout、non-2xx、oversize、
  malformed、stale、identity mismatch 和 drain 的 production probe tests。
  预期观察: 每种缺失/漂移均返回 `node_not_base_admitted`，不以 slots 放行。
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/preflight/production-probes.test.js src/orchestrator/preflight/production-wiring.test.js'
  期望: exit 0

- [x] [BEHAVIOR] [L2] 安装失败恢复原 plist 与原 launchd 状态；显式 drain
  先写本地 marker 再 bootout，undrain 失败恢复 marker；installer `--apply`
  有显式 root gate，nodectl mutation 只接受与本机 identity 相同的 canonical
  machine，并使用 system-owned target/launchctl（测试仅通过注入 seam 隔离）。
  `_cecelia` 不存在、socket target 越界或 ACL grant 失败均在 mutation 前关闭；
  本次新增 ACL 在 preflight/install 失败时撤销，撤销失败输出稳定安全告警。
  动作: 对 bootstrap/launchctl 各失败阶段与 stopped/running 原状态运行行为测试。
  预期观察: mutation 顺序确定、失败后状态恢复、跨机或非 root apply 拒绝。
  Test: manual:bash -c 'bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh && bash packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh'
  期望: exit 0

## 明确非声明与待复审项

- Phase 4A 始终 `dispatch_ready=false`；本 DoD 不声明 WorkspaceSpec/Attempt API、
  CredentialEnvelope、执行等价/恢复，也不声明 Phase 4B～4D 完成。
- 确定性单测与 contract smoke 是回归证据，不是 Phase 5 真实业务任务验收；
  synthetic canary 不得替代会产生代码 diff、Red/Green commits、PR、CI 与 verdict
  的真实任务。
- 真实节点 evidence 与 Worker-first rollout 尚待本 PR 复审，未在本分支执行。
  当前 `xian-mac-m1` 的 Docker 为 false，必须保持 drained；不得降低 policy 或
  resource threshold 来获取绿灯。
- 本阶段不使用、复制或安装 Xian 本地长期 Codex 凭据；没有新增 credential、
  auth、transport 或 canary 行为。

## 回退

```bash
# 在目标节点本机先 fail closed；machine-id 必须与 CECELIA_MACHINE_ID 相同。
CECELIA_MACHINE_ID=<machine-id> sudo -E \
  packages/brain/scripts/fleet-worker/fleet-nodectl.sh drain <machine-id> --apply

# Brain 发布后的镜像回退锚点；Phase 4A 合并/发布前不执行。
bash scripts/brain-rollback.sh 1.267.89
```

恢复前必须重新取得真实 Worker health evidence 并通过准入；synthetic canary
不能作为恢复依据。
