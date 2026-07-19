# PrepPRD — smoke-verify-headless-dispatch（565fa27a）

## 来源与重绑定

本 PrepPRD 派生自历史同名模板 `sprints/07191314-relay-d355821f/prep-prd.md`。历史模板只作为 smoke scope 来源，不作为当前 task 的执行成功证据。

重绑定字段：
- 历史 TASK_ID: `d355821f-4a37-4fa2-ad2f-99668bc91a3d` → 当前 TASK_ID: `565fa27a-4b5b-4eb7-905e-b6fb61eb8413`
- 历史 SPRINT_DIR: `sprints/07191314-relay-d355821f` → 当前 SPRINT_DIR: `sprints/07191541-relay-565fa27a`
- BRAIN_URL: `http://host.docker.internal:5221`（headless 容器环境可解析）
- task title: `smoke-verify-headless-dispatch`
- executor 变更：历史 `executor=codex + mode=headed` → 当前 `executor=claude + mode=headless`

## 当前任务事实

来源：`GET /api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413`（Brain API）。

- task_type: `harness_initiative`
- status: `in_progress`
- payload.mode: `headless`
- payload.executor: `claude`
- payload.orchestrator: `skill-relay`
- payload.smoke_test: `true`
- payload.dispatched_by_orchestrator: `true`
- 缺失字段：`prep_prd_body`、`thin_prd`、`sprint_dir`、`prd_content`、`ability_id`

## 目标

为当前 task `565fa27a-4b5b-4eb7-905e-b6fb61eb8413` 建立 headless skill-relay smoke 的验收边界，验证 `executor=claude + mode=headless + orchestrator=skill-relay` 能被 Brain 接收、认领，并产生当前 sprint 可追溯证据。

本 sprint 不复用历史 task 成功；历史 `d355821f` 只能证明存在同类 smoke 范围（headed），不能替代当前 `565fa27a` 的 headless API/DB 证据。

## 范围

在范围内：
- 读取当前 task payload、status 字段与 headless executor 三元组。
- 记录 Brain claim oracle 的验收边界（status=in_progress + orchestrator=skill-relay）。
- 将缺 initiative_runs 的情况列为 concern，不伪造当前 run 证据。
- 固化当前 sprint 的 PRD 与证据边界。

不在范围内：
- 不实现功能代码。
- 不改 dashboard/UI、migrations 或 Brain runtime。
- 不创建 PR，不跨 repo promote。
- 不扩大到 headed、Codex executor 或其他 mode smoke。

## Invariant 约束

- [单slot串行] 一个 slot/会话内严格串行；需要并行只能跨 slot 或独立 session。（来源: area）
- [禁写死环境] 端口、路径、host 与凭据目录不得硬编码；优先读 payload/env/当前工作区，缺失时注明推断来源。（来源: area）
- [真验才done] 依赖 Brain API/DB/session 的断言必须有真实证据后才可 done；历史成功不能冒充当前成功。（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志。（来源: area）
- [日志脱敏] 报告和日志不得明文输出 token、客户隐私、完整敏感 prompt 或凭据路径细节。（来源: area）
- [端点鉴权] 若后续触及 API 变更，所有端点必须有 auth；无鉴权端点不准 ship。（来源: area）
- [租户隔离] 若后续触及租户数据，查询/写入必须 scope 到当前租户；本 smoke 不查询租户数据。（来源: area）

## NFR

- 可观测：done/pass 必须引用当前 task 的 Brain API/DB 证据，不引用历史任务。
- 幂等：已有 headless dispatch 或 claim 时不得重复派发、抢占或误杀现有任务。
- 安全：证据文件和日志只记录脱敏摘要，不记录 secrets。
- 最小变更：Planner 阶段只产出 PRD 文档，不产生功能代码。
- 可恢复：缺少 initiative_runs 时输出 concern，供后续 proposer/evaluator 用当前 task 继续补证。

## 验收线索

- `GET /api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413` 返回当前 task，payload 三元组为 `mode=headless`、`executor=claude`、`orchestrator=skill-relay`。
- 当前 task status=in_progress，说明 Brain 已接收并认领该 headless dispatch。
- `/api/brain/harness/runs` 若无当前 task 归因 run，记录为 concern，不判 pass。
- 当前 sprint 证据写入 `sprints/07191541-relay-565fa27a/`，历史 sprint 路径只可作为来源引用。

journey_type: autonomous
target_environment: us
