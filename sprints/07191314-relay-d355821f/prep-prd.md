# PrepPRD — codex-headed-smoke（d355821f）

## 来源与重绑定

本 PrepPRD 派生自历史同名模板 `sprints/07172022-relay-53710094/prep-prd.md`。历史模板只作为 smoke scope 来源，不作为当前 task 的执行成功证据。

重绑定字段：
- 历史 TASK_ID: `53710094-898c-452c-8cc3-a56149e8b0ac` → 当前 TASK_ID: `d355821f-4a37-4fa2-ad2f-99668bc91a3d`
- 历史 SPRINT_DIR: `sprints/07172022-relay-53710094` → 当前 SPRINT_DIR: `sprints/07191314-relay-d355821f`
- BRAIN_URL: `http://localhost:5221`（`host.docker.internal` 在本 headed 本机不可解析）
- journey_id: `bb8cc561-b3ee-4fec-b74d-2255694bd963`
- task title: `codex-headed-smoke`

## 当前任务事实

来源：`GET /api/brain/tasks/d355821f-4a37-4fa2-ad2f-99668bc91a3d`。

- task_type: `harness_initiative`
- status: `in_progress`
- phase: `dev`
- quality_gate: `pending`
- claimed_by: `session:engine-patch`
- claimed_at: `2026-07-19T05:16:22.702Z`
- executor_kind: `headed-session`
- payload: `{"mode":"headed","executor":"codex","journey_id":"bb8cc561-b3ee-4fec-b74d-2255694bd963","orchestrator":"skill-relay","dispatched_by_orchestrator":true,"orchestrator_dispatched_at":"2026-07-19T01:56:28.019Z","dispatched_orchestrator_date":"2026-07-19"}`
- 缺失字段：`prep_prd_body`、`thin_prd`、`sprint_dir`、`prd_content`、`ability_id`

## 目标

为当前 task `d355821f-4a37-4fa2-ad2f-99668bc91a3d` 建立 Codex headed skill-relay smoke 的验收边界，验证 `executor=codex + mode=headed + orchestrator=skill-relay` 能被 Brain 接收、认领，并产生当前 sprint 可追溯证据。

本 sprint 不是复用历史 task 成功；历史 `53710094` 只能证明存在同类 smoke 范围，不能替代当前 `d355821f` 的 API/DB/session 证据。

## 范围

在范围内：
- 读取当前 task payload、状态、claim 字段与 headed executor_kind。
- 记录 foreground takeover/claim oracle 的验收边界。
- 将缺 initiative_runs 的情况列为 concern，而不是伪造当前 run 证据。
- 固化当前 sprint 的 PRD 与日志证据边界。

不在范围内：
- 不实现功能代码。
- 不改 dashboard/UI、migrations 或 Brain runtime。
- 不创建 PR，不跨 repo promote。
- 不扩大到 headless、Claude headed 或其他 executor smoke。

## Invariant 约束

- [单slot串行] 一个 slot/会话内严格串行；需要并行只能跨 slot 或独立 session。（来源: area）
- [禁写死环境] 端口、路径、host 与凭据目录不得硬编码；优先读 payload/env/当前工作区，缺失时注明推断来源。（来源: area）
- [真验才done] 依赖 Brain API/DB/session 的断言必须有真实证据后才可 done；历史成功不能冒充当前成功。（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志。（来源: area）
- [日志脱敏] 报告和日志不得明文输出 token、客户隐私、完整敏感 prompt 或凭据路径细节。（来源: area）
- [端点鉴权] 若后续触及 API 变更，所有端点必须有 auth；无鉴权端点不准 ship。（来源: area）
- [租户隔离] 若后续触及租户数据，查询/写入必须 scope 到当前租户；本 smoke 不查询租户数据。（来源: area）

## NFR

- 可观测：done/pass 必须引用当前 task 的 Brain API/DB/session 证据。
- 幂等：已有 headed session 或 claim 时不得重复 spawn、抢占或误杀现有会话。
- 安全：证据文件和日志只记录脱敏摘要，不记录 secrets。
- 最小变更：Planner 阶段只产出 PRD 文档，不产生功能代码。
- 可恢复：缺少 initiative_runs 时输出 concern，供后续 proposer/evaluator 用当前 task 继续补证。

## 验收线索

- `GET /api/brain/tasks/d355821f-4a37-4fa2-ad2f-99668bc91a3d` 返回当前 task，payload 三元组为 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`。
- 当前 task 的 claim oracle 至少包含 `status`、`claimed_by`、`claimed_at`、`executor_kind`。
- `/api/brain/harness/runs?limit=50` 与 `/api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths` 当前未提供可归因到 `d355821f` 的 run 证据；这是 concern，不是成功证据。
- 当前 sprint 证据写入 `sprints/07191314-relay-d355821f/`，历史 sprint 路径只可作为来源引用。

journey_type: autonomous
target_environment: local_api
