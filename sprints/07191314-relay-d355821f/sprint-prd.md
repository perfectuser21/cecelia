# Sprint PRD — codex-headed-smoke d355821f 验收边界

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%（来源：`GET /api/brain/context`）
- **本次推进预期**：不扩展功能，只把当前 Codex headed skill-relay smoke 的验收边界固化为可消费 PRD。

## 背景

当前 task `d355821f-4a37-4fa2-ad2f-99668bc91a3d` 的 payload 很薄，没有 `prep_prd_body`、`thin_prd`、`sprint_dir` 或 `prd_content`。Planner 采用历史同名 `sprints/07172022-relay-53710094/prep-prd.md` 的 smoke scope 派生当前 PRD，但所有验收必须重绑定到当前 task。

明确边界：本 sprint 不是复用历史 task `53710094` 的成功，而是为当前 task `d355821f` 建立验收边界；历史 task 证据不得冒充当前 task 证据。

## Golden Path（核心场景）

系统从当前 task `d355821f-4a37-4fa2-ad2f-99668bc91a3d` 进入 → Brain 接收 `executor=codex + mode=headed + orchestrator=skill-relay` 的 `harness_initiative` → headed relay smoke 的 payload、claim 与证据边界可被本机 API/DB/session 观察。

具体：
1. 触发条件：task API 返回当前 task，payload 字面包含 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`、`journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`。
2. 系统处理：Brain 将该 task 作为 `harness_initiative` 的 headed Codex relay 处理，并暴露 foreground takeover/claim oracle。
3. 可观测结果：当前 task 的 `status=in_progress`、`claimed_by=session:engine-patch`、`claimed_at=2026-07-19T05:16:22.702Z`、`executor_kind=headed-session` 可被验证；缺 run 证据时必须保留 concern。

## 边界情况

- payload 缺 `thin_prd/prep_prd_body/sprint_dir` 时，只允许从历史模板派生 scope，并必须标注来源与当前重绑定字段。
- `/api/brain/harness/runs` 或 DB 未能提供当前 task 的 initiative_run 时，不得判定 headed relay 已成功完成。
- 已存在 headed session 或 claim 时，只验证当前状态，不重复 spawn，不误杀已有 session。
- 任何报告、日志或证据文件不得包含 token、Codex 凭据、完整敏感 prompt 或客户隐私。

## 范围限定

**在范围内**：当前 task payload/状态验证；foreground takeover/claim oracle；initiative_runs 缺失 concern 处理；当前 sprint 证据文件与日志边界。

**不在范围内**：不实现功能代码；不改 Brain runtime、dashboard/UI、migrations；不创建 PR；不把历史 task 的 run/success 当作当前 task 成功。

## 假设

- [ASSUMPTION: 当前 payload 缺 `thin_prd`，因此主题以历史同名 smoke scope + 当前 payload 三元组锚定。]
- [ASSUMPTION: `host.docker.internal` 在本 headed 本机不可解析，当前验收使用已验证可达的 `http://localhost:5221`。]
- [ASSUMPTION: `ability_id` 为空，step/journey_feature 级 decisions 为空时，仅加载 area 级历史铁律。]

## 预期受影响文件

- `sprints/07191314-relay-d355821f/prep-prd.md`: 当前 task 的来源、重绑定与证据边界。
- `sprints/07191314-relay-d355821f/sprint-prd.md`: Planner 产出的 thin-slice PRD。
- `sprints/07191314-relay-d355821f/tui.log`: 如后续 headed session 产生日志，只能作为当前 sprint 运行证据；不得写入 secrets。

## NFR

- 可观测：done/pass 必须基于当前 task 的 Brain API/DB/session 证据。
- 安全：secrets 不硬编码、不进 git、不进日志；证据输出必须脱敏。
- 幂等：已有 headed session/run/claim 时不得重复 spawn、抢占或误杀。
- 本地验证：本 sprint 的 local_api 验收以 `localhost:5221` 与当前工作区为准。
- 最小变更：Planner 阶段只交付 PRD 文档，不生成实现代码。

## Invariant 约束

- [单slot串行] 一个 slot/会话内严格串行；需要并行只能跨 slot 或独立 session。（来源: area）
- [禁写死环境] 端口、路径、host 与凭据目录不得硬编码；优先读 payload/env/当前工作区，缺失时注明推断来源。（来源: area）
- [真验才done] 依赖 Brain API/DB/session 的断言必须有真实证据后才可 done；历史成功不能冒充当前成功。（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志。（来源: area）
- [日志脱敏] 报告和日志不得明文输出 token、客户隐私、完整敏感 prompt 或凭据路径细节。（来源: area）
- [端点鉴权] 若后续触及 API 变更，所有端点必须有 auth；无鉴权端点不准 ship。（来源: area）
- [租户隔离] 若后续触及租户数据，查询/写入必须 scope 到当前租户；本 smoke 不查询租户数据。（来源: area）

## 累积 FR

- FR-001 当前 task payload/状态：`GET /api/brain/tasks/d355821f-4a37-4fa2-ad2f-99668bc91a3d` 必须返回当前 task，且 payload 三元组为 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`。
- FR-002 foreground takeover/claim oracle：验收必须读取当前 task 的 `status`、`claimed_by`、`claimed_at`、`executor_kind`；claim 变化必须用当前 task 证据说明。
- FR-003 缺 initiative_runs 的 concern 处理：`/api/brain/harness/runs?limit=50` 与 journey golden-paths 未提供当前 task run 时，Planner/Proposer/Evaluator 只能记录 concern，不能判定当前 headed smoke 成功。
- FR-004 sprint 证据文件/日志边界：当前证据只落在 `sprints/07191314-relay-d355821f/`；历史 `sprints/07172022-relay-53710094/` 只可作来源引用，不能作当前成功证据。
- FR-005 安全日志边界：`tui.log`、报告和验收输出只允许脱敏摘要，禁止写入 secrets、完整 prompt、token 或客户隐私。

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：
# 1. 当前 task API 返回 d355821f，payload 含 mode=headed、executor=codex、orchestrator=skill-relay。
# 2. 当前 task 的 status/claimed_by/claimed_at/executor_kind 构成 foreground takeover/claim oracle。
# 3. initiative_runs 缺当前 task 证据时输出 concern；不得用历史 53710094 的成功替代。
# 4. 当前 sprint 证据文件位于 sprints/07191314-relay-d355821f/，日志脱敏。
```

## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（当前 task payload 未提供 step_id，历史模板未能锚定）
journey_type: autonomous
journey_type_reason: 纯 Brain/harness 后端派发链路 smoke，无用户 UI 或远端 agent 协议变更。
target_environment: local_api
target_environment_reason: 验收信号来自本机 Brain API/DB/session，使用 `http://localhost:5221`。
