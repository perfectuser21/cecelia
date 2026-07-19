# PrepPRD — headless-smoke（85c3e7ce）

## 来源

本 PrepPRD 派生自 PR #4103（codex-headed-smoke d355821f）`## 未覆盖真实链路清单`：

> 本 sprint 未覆盖 Brain 无头 spawn 出来的 skill-relay container run；当前可用证据是
> 人工前台/foreground relay-run + 当前 task API + DB tasks claim oracle。

本 sprint 覆盖 **Brain headless dispatch 路径**：`mode=headless + executor=claude + orchestrator=skill-relay`。

重绑定字段：
- TASK_ID: `85c3e7ce-7849-42b8-9ff9-542dd0db8375`
- SPRINT_DIR: `sprints/07191411-relay-85c3e7ce`
- BRAIN_URL: `http://host.docker.internal:5221`
- 参照 sprint: `sprints/07191314-relay-d355821f` (codex-headed-smoke)

## 当前任务事实

来源：`GET /api/brain/tasks/85c3e7ce-7849-42b8-9ff9-542dd0db8375`

- task_type: `harness_initiative`
- title: `headless-smoke`
- status: `in_progress`（已认领）
- domain: `quality`
- payload 三元组：`mode=headless`, `executor=claude`, `orchestrator=skill-relay`
- dispatched_by_orchestrator: true
- orchestrator_dispatched_at: `2026-07-19T02:26:28.051Z`
- 缺失字段：`prep_prd_body`, `thin_prd`, `sprint_dir`, `journey_id`, `initiative_runs`

## 目标

为 task `85c3e7ce-7849-42b8-9ff9-542dd0db8375` 建立 **Brain headless skill-relay smoke** 的验收边界。

验证 `executor=claude + mode=headless + orchestrator=skill-relay` 能被 Brain 接收、认领，
并产生当前 sprint 可追溯证据。

**本 sprint 不复用 headed-smoke 历史成功**；headed smoke 只能证明存在同类 smoke 范围，
不能替代当前 `85c3e7ce` 的 API/DB/session 证据。

## 范围

在范围内：
- 读取当前 task payload、状态、claim 字段（status/claimed_by/claimed_at/executor_kind）
- 验证 Brain 已接收 headless dispatch（orchestrator_dispatched_at 存在）
- 记录 headless takeover oracle：当前 session 认领该 task（in_progress 状态证据）
- Brain relay-runs 若有 initiative_run 行，记录其 phase；若无，列为 concern
- 固化当前 sprint 的 PRD 与 API 证据边界

不在范围内：
- 不实现新功能代码（非 headless container 实际运行验证，仅 API/DB 证据层）
- 不改 dashboard/UI、migrations 或 Brain runtime
- 不创建真实 headless container spawn（证明 Brain 接收+任务被认领即可）
- 不扩大到其他 executor（codex/headed）smoke

## Invariant 约束

- [单slot串行] 一个 slot/会话内严格串行；需要并行只能跨 slot 或独立 session。
- [禁写死环境] 端口、路径、host 与凭据目录不得硬编码；优先读 payload/env/当前工作区，缺失时注明推断来源。
- [真验才done] 依赖 Brain API/DB/session 的断言必须有真实证据后才可 done；历史成功不能冒充当前成功。
- [凭据安全] secrets 不硬编码、不进 git、不进日志。
- [日志脱敏] 报告和日志不得明文输出 token、客户隐私、完整敏感 prompt 或凭据路径细节。

## NFR

- 可观测：done/pass 必须引用当前 task 的 Brain API/DB/session 证据（真实 curl 输出）
- 幂等：已有 headless session 认领时不得重复 spawn、抢占或误杀现有会话
- 安全：证据文件只记录脱敏摘要，不记录 secrets
- 最小变更：Planner 阶段只产出 PRD 文档，不产生功能代码
- 可恢复：缺少 initiative_runs 时输出 concern，供后续阶段用当前 task 继续补证

## 判定点登记

- 「headless task 是否已被认领」判定：检查 Brain DB tasks 表 status=in_progress，
  current session 为 claim owner → 选 **API oracle**（curl GET tasks/:id 实时查询）。
  误判后果：低（claim 状态幂等，多查无副作用）。

## 铁律清单

1. smoke 验收不得依赖 headed session（必须是 headless 路径的独立证据）
2. 任何 done 判定必须引用当前 task id `85c3e7ce-7849-42b8-9ff9-542dd0db8375` 的实时 API 响应
3. initiative_runs 缺失时必须列为 concern，不得伪造成功证据
4. e2e-verify.sh 必须真实调用 Brain API 并校验响应字段（不许 exit 0 兜底）
5. 测试文件 commit 1（Red）后不可改内容

## 验收线索

- `GET /api/brain/tasks/85c3e7ce-7849-42b8-9ff9-542dd0db8375` 返回 status=in_progress，
  payload 三元组 `mode=headless`, `executor=claude`, `orchestrator=skill-relay`
- 当前 task 的 claim oracle 至少包含 `status`, `claimed_by`, `claimed_at`, `executor_kind`
- Brain `/api/brain/orchestrator/relay-runs/85c3e7ce-7849-42b8-9ff9-542dd0db8375` 当前未提供
  可归因 run 证据；这是 concern，不是失败（前台接管路径无 initiative_runs INSERT）
- 当前 sprint 证据写入 `sprints/07191411-relay-85c3e7ce/`

journey_type: autonomous
target_environment: local_api
