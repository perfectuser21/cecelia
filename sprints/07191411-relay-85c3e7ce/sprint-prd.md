# Sprint PRD — headless-smoke（85c3e7ce）

## 任务信息

- TASK_ID: `85c3e7ce-7849-42b8-9ff9-542dd0db8375`
- SPRINT_DIR: `sprints/07191411-relay-85c3e7ce`
- BRAIN_URL: `http://host.docker.internal:5221`
- task_type: `harness_initiative`
- title: `headless-smoke`
- 参照 sprint: `sprints/07191314-relay-d355821f`（codex-headed-smoke，已覆盖 headed 路径）

## 目标

验证 Brain headless dispatch 路径（`mode=headless + executor=claude + orchestrator=skill-relay`）
已被 Brain 接收、被当前 session 认领，并产生可追溯的 API/DB 证据。

本 sprint 覆盖 PR #4103（codex-headed-smoke）**未覆盖**的链路：Brain 无头 spawn 路径。

## Invariant 约束

- [单slot串行] 一个 slot/会话内严格串行；需要并行只能跨 slot 或独立 session。
- [禁写死环境] 端口、路径、host 与凭据目录不得硬编码；优先读 payload/env/当前工作区。
- [真验才done] 依赖 Brain API/DB/session 的断言必须有真实证据后才可 done；历史成功不替代当前证据。
- [凭据安全] secrets 不硬编码、不进 git、不进日志。
- [日志脱敏] 报告和日志不得明文输出 token、客户隐私、凭据路径细节。

## 累积 FR

1. **FR-01 Task 状态核验**
   调用 `GET /api/brain/tasks/85c3e7ce-7849-42b8-9ff9-542dd0db8375`，
   断言响应中 `status=in_progress`，`payload.mode=headless`，`payload.executor=claude`，
   `payload.orchestrator=skill-relay`，`dispatched_by_orchestrator=true`，
   `orchestrator_dispatched_at` 非空。

2. **FR-02 Claim Oracle 验证**
   同一响应中断言以下字段存在且非空：`claimed_by`、`claimed_at`、`executor_kind`；
   验证当前 session 持有 claim（`status=in_progress` 为充分条件）。

3. **FR-03 initiative_runs 检查**
   调用 Brain 提供的 relay-runs 端点（若存在）；
   若端点不存在或返回空集，记录为 **concern**（不记为失败），
   输出到 `sprints/07191411-relay-85c3e7ce/concerns.txt`。

4. **FR-04 证据写入**
   将上述 API 响应脱敏摘要写入 `sprints/07191411-relay-85c3e7ce/evidence.json`，
   包含：task_id、status、payload 三元组、orchestrator_dispatched_at、claimed_at。

5. **FR-05 e2e 验证脚本**
   生成 `sprints/07191411-relay-85c3e7ce/e2e-verify.sh`，真实调用 Brain API 并
   用 `jq` 校验响应字段；禁止 `exit 0` 兜底；脚本可重复执行（幂等）。

## NFR

- 可观测：done/pass 必须引用当前 task 的 Brain API/DB/session 证据（真实 curl 输出）。
- 幂等：已有 headless session 认领时不得重复 spawn、抢占或误杀现有会话。
- 安全：证据文件只记录脱敏摘要，不记录 secrets。
- 最小变更：不产生功能代码；不改 dashboard/UI、migrations 或 Brain runtime。
- 可恢复：initiative_runs 缺失时输出 concern，供后续阶段补证。

## 铁律

1. smoke 验收不得依赖 headed session 历史证据。
2. 任何 done 判定必须引用 task id `85c3e7ce-7849-42b8-9ff9-542dd0db8375` 的实时 API 响应。
3. initiative_runs 缺失必须列为 concern，不得伪造成功证据。
4. e2e-verify.sh 必须真实调用 Brain API 并校验响应字段（禁止 exit 0 兜底）。
5. 测试文件 commit 后不可改内容（Red 阶段锁定）。

## 不在范围

- 不实现新功能代码
- 不改 dashboard/UI、migrations 或 Brain runtime
- 不创建真实 headless container spawn
- 不扩大到其他 executor（codex/headed）smoke

## 验收标准（DoD）

| # | 断言 | 判定方式 |
|---|------|----------|
| 1 | `status=in_progress` 且 payload 三元组正确 | `GET /api/brain/tasks/:id` 实时 curl |
| 2 | `claimed_by` / `claimed_at` / `executor_kind` 非空 | 同上响应字段 |
| 3 | `orchestrator_dispatched_at` 非空 | 同上响应字段 |
| 4 | initiative_runs 若缺失已记录 concern | concerns.txt 存在 |
| 5 | evidence.json 已写入 sprint 目录 | 文件存在且含 task_id |
| 6 | e2e-verify.sh 执行返回 exit 0（真实通过） | 本地运行 |

journey_type: autonomous
target_environment: local_api
