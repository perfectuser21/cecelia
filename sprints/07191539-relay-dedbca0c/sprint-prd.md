# Sprint PRD — headless-smoke dedbca0c 验收边界

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%（来源：`GET /api/brain/context`）
- **本次推进预期**：把 Brain 无头 dispatch 的 skill-relay smoke 链路固化为可验证合同，填补 PR #4103 明确标注的未覆盖链路。

## 背景

本 sprint 是 PR #4103（codex-headed-smoke d355821f）的配对任务，填补该 PR「未覆盖真实链路清单」中明确指出的盲区：
> "本 sprint 未覆盖 Brain 无头 spawn 出来的 skill-relay container run"

当前 task `dedbca0c-0864-4b0d-be69-d37f70a25827` 本身由 Brain orchestrator 以 `dispatched_by_orchestrator=true` 无头派发，payload 三元组为 `mode=headless`、`executor=claude`、`orchestrator=skill-relay`。本 sprint 验证此派发链路从 queued → in_progress → 被 harness 接管 → completed 的完整可观测性。

## Golden Path（核心场景）

Brain 以无头模式 dispatch harness_initiative → task 进入 queued → harness 接管 claim → task 推进至 in_progress → relay phase 链条可被 Brain API/DB 观察 → 最终 completed。

具体：
1. Brain API 返回当前 task，payload 含 `mode=headless`、`executor=claude`、`orchestrator=skill-relay`、`dispatched_by_orchestrator=true`。
2. `status_history` 显示 `queued → in_progress`，`claimed_by` 字段非空，`claimed_at` 有时间戳。
3. harness 执行本 sprint 所有阶段（planner → proposer → dev → evaluator）后，task 状态推进至 `completed`。
4. 全程无需人工前台干预，relay phase 链条以 Brain DB 状态为唯一证据。

## 边界情况

- `ability_id` 为空时，只加载 area 级约束，不报错。
- `status_history` 缺 queued 记录时，只验证当前 `in_progress` 状态，记录 concern。
- 历史 headed task（d355821f）的 run 证据不得冒充本 headless task 成功。
- 执行期间不得重复 claim 或抢占已有 session。

## 范围限定

**在范围内**：当前 task 状态/payload 验证；headless dispatch 链路可观测性；queued→in_progress→completed 状态机验证；relay phase 推进证据。

**不在范围内**：不实现新功能代码；不改 Brain runtime、dashboard/UI、migrations；不创建 PR；不把 headed task（d355821f）的成功替代本 task 成功。

## 假设

- [ASSUMPTION: `ability_id` 为空，step/journey_feature 级 decisions 缺失，仅加载 area 级铁律。]
- [ASSUMPTION: `host.docker.internal` 在无头环境下可用；fallback 为 `localhost:5221`。]
- [ASSUMPTION: harness executor_kind=headed-session 字段值为初始值，headless 模式下最终可被覆盖为 headless-session。]
- [ASSUMPTION: `sprint_dir` 字段在 task 中暂为 null，harness 以本文件所在目录 `sprints/07191539-relay-dedbca0c/` 为准。]

## 预期受影响文件

- `sprints/07191539-relay-dedbca0c/sprint-prd.md`：本文件，Planner 产出。
- `sprints/07191539-relay-dedbca0c/`：后续 proposer/dev/evaluator 的证据文件落地目录。

## NFR

- **可观测**：done/pass 必须基于当前 task（dedbca0c）的 Brain API/DB 证据，不得引用历史 task。
- **安全**：secrets 不硬编码、不进 git、不进日志；证据输出必须脱敏。
- **幂等**：已有 claim 时不重复 spawn；relay 中断可从当前 phase 续跑。
- **最小变更**：Planner 阶段只交付 PRD，不生成实现代码。
- **回归留存**：完成后 regression test 必须 commit 进 repo，永久留在 CI。

## Invariant 约束

（ability_id 为空，加载 area 级约束）

- [单slot串行] 一个 slot/会话内严格串行；需要并行只能跨 slot 或独立 session。（来源: area）
- [禁写死环境] 端口、路径、host 与凭据目录不得硬编码；优先读 payload/env。（来源: area）
- [真验才done] 依赖 Brain API/DB 的断言必须有当前 task 真实证据后才可 done；历史 task 成功不能冒充当前成功。（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志。（来源: area）
- [日志脱敏] 报告不得明文输出 token、完整 prompt 或凭据路径。（来源: area）

## 累积 FR

- FR-001 dispatch payload 验证：`GET /api/brain/tasks/dedbca0c-0864-4b0d-be69-d37f70a25827` 返回 `mode=headless`、`executor=claude`、`orchestrator=skill-relay`、`dispatched_by_orchestrator=true`。
- FR-002 状态机验证：task `status_history` 中存在 `queued → in_progress` 转换；`claimed_by` 非空；`claimed_at` 有时间戳。
- FR-003 headless 链路完成：task 最终 `status=completed`，`completed_at` 非空，`quality_gate` 从 pending 变更。
- FR-004 relay phase 链条：harness 全程 planner→proposer→dev→evaluator phase 在 Brain DB 可观测（通过 relay runs 或 task 字段体现）。
- FR-005 安全边界：sprint 证据文件落在 `sprints/07191539-relay-dedbca0c/`；日志脱敏，不含 secrets。

## journey_type: autonomous
## target_environment: local_api
