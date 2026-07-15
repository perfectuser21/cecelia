# PrepPRD — headed-smoke-test (049ebf93)

## 背景
本任务由 Brain headed relay 派发链路自测机制创建（与 07-13 已合并的 a85e0582「codex-headed-dispatch-smoke」、4bb31ef5「claude-headed-smoke」同源），用于再次验证 `executor=claude + mode=headed + orchestrator=skill-relay` 的 harness_initiative 全链路（planner→GAN→generator→evaluator→judge→merge→毕业→report）能被 Brain 正确接收、派发、跑通并留下可回归的证据。不是新业务功能需求。

`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 已是通用脚本（不绑定具体 task id），验证 headed 白名单校验接口行为；每次 headed-smoke-test 任务的产出是一份**锚定本次 task id** 的 e2e-verify.sh 薄封装，验证「这一次 dispatch」确实发生且状态正确，毕业后进永久回归池。

## 目标
验证本次 task_id=049ebf93-fa61-4777-b619-5a44fcce296a 的 headed relay 派发状态可被 Brain API/DB 观测到，且合同交付的 e2e 验证脚本能证明：
1. Brain task 记录存在，payload 含 mode=headed / executor=claude / orchestrator=skill-relay，且不含敏感字段（token/github_token/anthropic_token/thin_prd）
2. initiative_runs 里该 initiative_id 有 orchestrator_host 含 `skill-relay-claude-headed`，phase 不落在 failed/unknown
3. 复用现有 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`（已在 smoke-allowlist 登记，不重复登记，不重复实现）

## 范围
在范围内：
- 新增 `sprints/07151245-relay-049ebf93/e2e-verify.sh`，锚定 TASK_ID=049ebf93-fa61-4777-b619-5a44fcce296a、SPRINT_DIR=sprints/07151245-relay-049ebf93，结构镜像 4bb31ef5 版本（#3829）
- 调用既有 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`（已在 packages/quality/smoke-allowlist.txt 登记，仅校验存在，不重复登记）
- 校验本次 task 的 Brain API 记录与 initiative_runs 记录

不在范围内：
- 不新增/修改 `claude-headed-dispatch-smoke.sh` 本体（已通用、已合并）
- 不扩展业务功能，不改 dashboard/UI
- 不改 migrations
- 不跨 repo 生产 promote
- 不重复 ci.yml 的 claude-headed 分支改动（4bb31ef5 已落地，本次仅验证其仍生效，不重复实现）

## base_repo
当前工作区（Cecelia monorepo，`https://github.com/perfectuser21/cecelia.git`）

## target_environment
`local_api`

理由：验收信号来自本地 Brain API `localhost:5221`、PostgreSQL 查询；无需浏览器或远端 runner。

## journey_type
`autonomous`

理由：纯 Brain/harness 后端派发链路 smoke，无用户可见 UI 交互。

## review_required
`false`

理由：纯回归验证型 smoke wrapper，模式与已合并的 a85e0582(#3827)/4bb31ef5(#3829) 完全同构，无新业务范围引入，无需人工预览门。

## NFR
- 可观测：必须能通过 Brain API/DB 看到本次 task_id 与 initiative_runs 状态
- 安全：不得把 GitHub token、Claude 凭据、prompt 全文中的敏感内容写入报告/日志/脚本
- 幂等：e2e-verify.sh 可重复执行不产生副作用（只读校验）
- 最小变更：本任务是 smoke 验证，不引入无关代码改动

## 铁律清单
- 单 slot 串行：同一 slot/session 内严格串行，不并发写同一工作区
- 禁写死环境假设：端口、路径优先读取 env/当前工作区；缺失时保守推断并注明来源
- 真环境验证才 done：未实际验证 Brain API/DB 信号前不能标 done
- 凭据安全：secrets 不硬编码、不进 git、不进日志
- 日志脱敏：不输出明文 token
- 端点鉴权：本次不新增端点
- 租户隔离：本 smoke 不触及租户数据

## 建议验收
1. `GET /api/brain/tasks/049ebf93-fa61-4777-b619-5a44fcce296a` 返回 task，payload 含 `mode=headed`, `executor=claude`, `orchestrator=skill-relay`
2. DB `initiative_runs` 中该 initiative_id 有 `orchestrator_host` 含 `skill-relay-claude-headed`，phase 非 failed
3. e2e-verify.sh 全部断言通过（含 claude-headed-dispatch-smoke.sh 全绿 + allowlist 登记核对 + 本次 task 记录字段核对）
