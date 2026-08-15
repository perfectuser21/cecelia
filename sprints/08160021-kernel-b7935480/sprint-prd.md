# Sprint PRD — Harness Generator/Publisher 发布运行时权限边界生产回归

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（新增一条可长期运行的 Generator/Publisher 权限边界回归护栏）

## 背景

生产 Fleet Harness 近期反复修 Generator/Publisher 运行时权威与权限边界（近期 PR：align generator runtime authority、preserve fleet Brain URL authority、bind planner to server role branch）。目前缺一条长期在库的生产回归，来钉死两条已被人肉反复守护的边界：① Generator TaskBundle 必须拿到**服务端拥有**的 PostgreSQL runtime resource，caller 传 `false` 不能把它降权；② Generator 只做本地已提交候选，Publisher 是唯一远端发布角色。本 sprint 把这两条边界固化成可执行 smoke 并永久接入 smoke ratchet，从此每次 CI 都验。

## Golden Path（核心场景）

系统从 [Generator TaskBundle 派发] → 经过 [运行时授权 + 角色权限校验] → 到达 [本地候选就绪、仅 Publisher 远端发布]

具体：
1. Generator TaskBundle 携带 `runtime_resources` 进入 attempt-runner；即便 caller/request 侧传 `postgres:false`，Generator 仍必须获得服务端拥有的 PostgreSQL runtime resource——降权请求被拒（`attempt_runtime_requirements_mismatch` 或等价 fail-closed 报错），不得静默降级为无 DB 运行。
2. Generator 角色执行结束，产出**本地已提交候选**（committed candidate，`status=candidate`）：不 push、不建 PR、不等 CI、不 merge；Generator 不在 `GITHUB_CREDENTIAL_ROLES` 内，无远端凭据。
3. Publisher 角色接手同一 exact candidate（相同 head sha），作为唯一远端发布角色执行 push / 建 PR / 等 CI / merge；凭据与权限不因本 sprint 扩大。
4. 上述边界由 `packages/brain/scripts/smoke/` 下一条新的可执行 smoke 覆盖，并永久登记进现有 smoke ratchet（`GET /api/brain/quality/ratchet` 台账 + CI 跑道），此后每次 CI 都跑、只增不减。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- caller 传 `runtime_resources.postgres:false` 而 server input 要求 `true`：必须拒绝降权，不静默放行。
- Generator 尝试携带/使用远端凭据推送：无凭据路径，push 被结构性阻断（角色不在 GITHUB_CREDENTIAL_ROLES）。
- Publisher 收到的 candidate head sha 与 Generator 产出不一致：非 exact candidate，拒绝发布。
- 容器镜像未带 `scripts/` 目录（已知拓扑 ENOENT）：ratchet 台账端点降级 `available:false` 属正确行为，smoke 需对该拓扑放行。
- local_api / 无 UI smoke 场景：合同须预声明验证真相形态，避免 judge 机械闸⑤（meta_verification_gap）死锁。

## 范围限定

**在范围内**：
- 一条精确 RED，先证明「Generator 必须获服务端 PostgreSQL runtime、caller false 不能降权」当前会红。
- Generator=本地候选、Publisher=唯一远端发布 的权限边界断言。
- `packages/brain/scripts/smoke/` 新增一条可执行 smoke + 永久接入 smoke ratchet。

**不在范围内**：
- 不改变/扩大任何角色的凭据与权限集合（GITHUB_CREDENTIAL_ROLES 保持不变）。
- 不新增 Provider 内 checkout/switch 分支行为。
- 不重写 attempt-runner 角色流水线，仅补断言与回归护栏。

## 假设

- [ASSUMPTION: 运行时授权真相来自 attempt-runner 的 server input `runtime_resources`，request 侧仅可等值匹配，不可覆盖降权。]
- [ASSUMPTION: smoke ratchet 登记入口为 `GET /api/brain/quality/ratchet` 台账 + `ratchet-registry-smoke.sh` 契约，新 smoke 需被该台账枚举到。]
- [ASSUMPTION: 本回归以 local_api 形态执行（curl localhost:5221 + 本地跑 smoke），无需真机 UI。]

## 预期受影响文件

- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`: Generator 运行时降权拒绝 + 角色发布边界的断言锚点（如需补强 fail-closed）。
- `packages/brain/scripts/fleet-worker/attempt-resources.cjs`: server-owned PostgreSQL runtime 授权来源。
- `packages/brain/scripts/fleet-worker/attempt-runner.test.cjs`: 精确 RED（降权拒绝 / Generator 无 push / Publisher 唯一发布）。
- `packages/brain/scripts/smoke/<new>-smoke.sh`: 新增可执行 smoke。
- smoke ratchet 台账/注册处（`ratchet-registry-smoke.sh` 所验的 registry 来源）: 永久登记新 smoke。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl+psql+bash 跑 smoke）。本回归为 real-harness-full-chain 验收：需附**真实 Fleet Harness** 的 Planner、GAN、Generator、人式 Evaluator、独立 Judge、Publisher 全链证据及最终 PR/CI。

```bash
# 占位：proposer 按 local_api 填入真实脚本
# 期望验收点（自然语言）：
#  1) RED→GREEN 时序：先证明降权/越权当前红，实现后转绿；
#  2) 跑新 smoke（bash packages/brain/scripts/smoke/<new>-smoke.sh）exit 0；
#  3) GET /api/brain/quality/ratchet 台账枚举到新 smoke（direction/source 齐全），证明已永久接入 ratchet；
#  4) 附真实 Fleet Harness 全链角色证据（Planner/GAN/Generator/人式 Evaluator/独立 Judge/Publisher）+ 最终 PR 链接 + CI 绿。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空）；PrepPRD/任务描述显式值优先 -->
- 凭据/权限: **不扩大**任何角色凭据与权限集合（任务描述硬约束）
- 可长期运行: smoke 永久接入 ratchet，只增不减，每次 CI 都跑
- 可观测: 降权拒绝/越权阻断必须 fail-closed 且有可机检报错标识
- 超时/延迟: 待定（PrepPRD 未指定）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 源（本任务无 step/journey_feature 级）；仅注入 harness 域相关铁律，android/logcat/metrics 域另有 3 条属其他 line 已略 -->
- [planner-branch] Planner 必须停在服务端签发的 planner_branch，Provider 可校验但不得 checkout/switch（来源: area）
- [generator-brain-url] Dispatcher+Fleet Worker 双通道注入服务端权威 HARNESS_BRAIN_URL；Generator 仅在通用 BRAIN_URL 缺失时恢复，预检 fail-closed，禁手工为单 Attempt 绕过（来源: area）
- [validation-clock] validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 pr_url/pr_head_sha 与 GitHub 实时一致时首个 Evaluator 建一次共享 validation clock，Judge 复用（来源: area）
- [local-api-gate5] judge 机械闸⑤（meta_verification_gap）对 local_api/无 UI smoke 会死锁，合同须预声明验证真相形态或对该闸放行（来源: area）
- [progress-untracked] controller 台账 `.harness/progress.md` 必须在 git 追踪之外，禁随 sprint PR 带入 repo（来源: area）
- [smoke铁律] smoke 铁律（来源: area）
- [deploy-preview-infra] Deploy Preview Environment check 跨 PR 失败是既有 infra 故障（非 required），不在功能 PR 内追修（来源: area）
- [auto-merge竞态] 高频合并 repo（如 cecelia）update-branch 后立即挂 gh pr merge --auto 抢竞态（来源: area）
- [vitest-exit] 合同验证命令须实跑确认 exit code 语义：vitest 对 include 范围外路径绿态也 exit 1（来源: area）
- [canonical-immutable] 涉 canonical 不可变文件收尾 commit 前先核对不可变清单（来源: area）
- [judge-evidence-window] judge 证据窗口前 8 条×600 字符，evaluator `.brain-result.json` 须把一手证据排序进窗口前列（来源: area）
- [judge-fail-triage] judge FAIL 先区分证据截断 vs 实现缺陷，evidence_insufficient 优先走补证轮而非改代码（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey_id 缺失（非路径 C journey 点火）→ 优雅降级 -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 纯 Brain 侧 fleet-worker 运行时授权与角色权限边界，无 UI、无外部 agent 协议变更，属自治后端回归。
## target_environment: local_api
## target_environment_reason: 验收在本地 evaluator 跑（curl localhost:5221 + psql + bash 执行 packages/brain/scripts/smoke 新 smoke），无真机 UI。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
