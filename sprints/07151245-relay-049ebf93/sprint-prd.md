# Sprint PRD — headed relay 派发链路自测（claude-headed, task 049ebf93）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：headed relay 链路（planner→GAN→generator→evaluator→judge→merge→毕业→report）已有 a85e0582(#3827)、4bb31ef5(#3829) 两条同类先例毕业
- **本次推进预期**：为本次 task_id=049ebf93 生成锚定该 task 的独立回归证据，巩固 executor=claude + mode=headed + orchestrator=skill-relay 链路可信度

## 背景

本任务由 Brain headed relay 派发链路自测机制创建，与已合并的 a85e0582「codex-headed-dispatch-smoke」、4bb31ef5「claude-headed-smoke」同源，用于再次验证 `executor=claude + mode=headed + orchestrator=skill-relay` 的 harness_initiative 全链路能被 Brain 正确接收、派发、跑通并留下可回归证据。不是新业务功能需求。

`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 已是通用脚本（不绑定具体 task id），本次不改动它，只复用。每次 headed-smoke-test 任务的产出是一份**锚定本次 task id** 的 e2e-verify.sh 薄封装。

## Golden Path（核心场景）

Brain 派发 headed relay 任务 → 本次 e2e-verify.sh 校验 → 证据留痕

具体：
1. [触发条件] task_id=049ebf93-fa61-4777-b619-5a44fcce296a 已由 Brain 以 task_type=harness_initiative、payload.mode=headed / executor=claude / orchestrator=skill-relay 派发
2. [系统处理] e2e-verify.sh 依次：调用既有 `claude-headed-dispatch-smoke.sh`（不重实现）→ 查 `GET /api/brain/tasks/049ebf93...` 核对 task 记录与敏感字段脱敏 → 查 DB `initiative_runs` 核对本次 initiative_id 的 orchestrator_host/phase
3. [可观测结果] 全部断言通过则脚本 exit 0 并打印 PASS；任一断言失败则 exit 1 并打印具体 FAIL 原因

## 边界情况

- Brain task 记录不存在（未派发成功）→ e2e-verify.sh 必须 FAIL，不得静默跳过
- `initiative_runs` 无该 initiative_id 记录 → FAIL
- `initiative_runs.phase` 落在 `failed` → FAIL；`unknown`/非法枚举值 → FAIL
- task payload 意外携带 `token`/`github_token`/`anthropic_token`/`thin_prd` 明文字段 → FAIL（敏感字段泄漏）
- `claude-headed-dispatch-smoke.sh` 未在 `packages/quality/smoke-allowlist.txt` 登记 → FAIL

## 范围限定

**在范围内**：
- 新增 `sprints/07151245-relay-049ebf93/e2e-verify.sh`，锚定 TASK_ID=049ebf93-fa61-4777-b619-5a44fcce296a、SPRINT_DIR=sprints/07151245-relay-049ebf93，结构镜像 4bb31ef5 版本（#3829）
- 调用既有 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`（已在 allowlist 登记，仅校验存在，不重复登记）
- 校验本次 task 的 Brain API 记录（含敏感字段脱敏检查）与 initiative_runs 记录

**不在范围内**：
- 不新增/修改 `claude-headed-dispatch-smoke.sh` 本体
- 不扩展业务功能，不改 dashboard/UI
- 不改 migrations
- 不跨 repo 生产 promote
- 不重复实现 ci.yml 的 claude-headed 分支改动（4bb31ef5 已落地）

## 假设

- [ASSUMPTION: 本次 task 派发已由 Brain 完成，initiative_runs 中存在 initiative_id=049ebf93-fa61-4777-b619-5a44fcce296a 至少一条 run 记录]
- [ASSUMPTION: 复用 packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh 现有通用行为，本次不校验其内部实现细节]

## 预期受影响文件

- `sprints/07151245-relay-049ebf93/e2e-verify.sh`：新增，锚定本次 task_id 的回归验证脚本

## E2E 验收

期望验收点（自然语言）：
1. `GET /api/brain/tasks/049ebf93-fa61-4777-b619-5a44fcce296a` 返回 task，`payload.mode=headed` / `payload.executor=claude` / `payload.orchestrator=skill-relay`，且 payload 不含 token/github_token/anthropic_token/thin_prd 明文字段
2. DB `initiative_runs` 中 `initiative_id=049ebf93-fa61-4777-b619-5a44fcce296a` 至少一条记录，`orchestrator_host` 含 `skill-relay-claude-headed`，`phase` 非 `failed`
3. 复用调用 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 全绿，且该脚本已在 `packages/quality/smoke-allowlist.txt` 登记

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql）
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重（step/feature 均为空数组） -->
- [单slot串行] 一个 slot/会话内严格串行执行任务，不并发写同一工作区（来源: area）
- [禁写死环境假设] 屏幕外坐标/端口/路径等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的接缝断言必须在真目标上验证过才算done（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户，跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths 查询结果为空数组 -->
- （本 line 暂无历史）

## NFR 约束

<!-- 来源: PrepPRD 显式值（本次 golden-path-decisions?category=nfr 查询为空数组，无副源补充） -->
- 超时/延迟: 待定（PrepPRD 未指定具体数值，e2e-verify.sh 走同步一次性校验，无长耗时依赖）
- 频控: 无（只读校验，不产生新写入）
- 版本要求: 无
- 可观测: 必须能通过 Brain API/DB 看到本次 task_id 与 initiative_runs 状态；e2e-verify.sh 断言失败必须打印明确 FAIL 原因

## journey_type: autonomous
## journey_type_reason: 纯 Brain/harness 后端派发链路 smoke，无用户可见 UI 交互（PrepPRD 已明确标注）
## target_environment: local_api
## target_environment_reason: 验收信号来自本地 Brain API localhost:5221 与本地 PostgreSQL 查询，无需浏览器或远端 runner（PrepPRD 已明确标注）
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（PrepPRD 未锚定）
