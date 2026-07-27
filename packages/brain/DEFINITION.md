# Brain 模块定义

**版本**: 1.267.91

## Kernel attempt telemetry

- `harness_attempts` 以 additive migration 361 增加 logical cycle、attempt kind、retry lineage、restart reason、workstream 与 derived 时间来源。
- attempt 生命周期在 `starting` 首次记录 `started_at`，且仅在终态写 `completed_at`。
- `GET /api/brain/harness/tasks/:task_id/attempt-telemetry` 必须由 `x-tenant-id + task_id` 双作用域查询，响应采用字段白名单。
- orphan 的结构化收口区分 resume 返回 `null`、`false`、成功 child lineage 与 live lease owner fencing。
- Kernel action 路由与批准合同冻结语义不变。

## Fleet Node mandatory base admission

- `fleet-node-profiles.json` 是三台 canonical 节点的 immutable policy；Brain 从
  Worker 的有界、新鲜、同身份健康报告本地计算 `base_admitted`。
- NodeProfile 同时固定 Worker listener 与 Brain callback：US 使用回环，Xian
  M4/M1 listener 绑定各自 Tailscale IP，callback 指向 US Brain Tailscale health。
  system LaunchDaemon 固定 `DOCKER_HOST=unix:///var/run/docker.sock`。
- US M4 的 `fleet-rollout.sh` 只从 committed Git、credential-free bundle 和
  pinned Runner image 构建节点工件，经 BatchMode SSH 调用节点本地 reconciler；
  不读取或传输账号目录、Prompt、token 或 provider session。
- baseline reconciler 创建固定 UID/GID 450 的 `_cecelia` 服务身份，安装 pinned
  Node/Codex CLI 与 OrbStack 2.2.1，导入 Git baseline/Runner，再调用 transactional
  installer。installer 为 `_cecelia` 向 OrbStack owner home 授予 `search`，
  并向 exact `docker.sock` 授予 `read,write`；root-only WatchPaths helper 负责
  socket 重建后的恢复，不授权 sibling sockets。本次新增 ACL 在失败时逆序回退。
  新 generation 只有在 launchd 持续为 running、且 profile-owned `/health`
  返回匹配 machine identity 后才提交；否则恢复原文件与原服务状态。
- 所有 production machine health 都必须经过该 gate。缺失、重定向、超时、
  malformed/stale evidence、显式 drain 或 policy/resource/digest 不匹配均
  fail-closed；不存在 `online`/`effective_slots` 回退。
- production capacity 从 canonical capacity 与实时 effective/physical slots
  的较小值按 `task_bundle.role` 折算；缺失/未知角色 fail-closed，reporter
  作为生产可达的轻量角色使用权重 1。
- Phase 4A 始终返回 `dispatch_ready=false`，不定义 WorkspaceSpec/Attempt API、
  CredentialEnvelope、执行等价/恢复或 Phase 5 真实任务验收。
- self-deploy 发布尚待复审与 merge；`xian-mac-m1` 在 Docker 不可用时必须保持 drained，
  不得降低准入阈值，也不得用 synthetic canary 代替真实任务验收。
- 节点回退：
  `CECELIA_MACHINE_ID=<machine-id> sudo -E packages/brain/scripts/fleet-worker/fleet-nodectl.sh drain <machine-id> --apply`。
  Brain 回退：`bash scripts/brain-rollback.sh 1.267.89`。
