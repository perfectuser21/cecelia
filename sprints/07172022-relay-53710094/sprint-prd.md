# Sprint PRD — codex-headed-smoke headed relay 验收边界

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：不扩展功能，只把 Codex headed skill-relay smoke 的交接验证范围固化为可消费 PRD。

## 背景

当前 task payload 没有 `thin_prd` 或 `prep_prd_body`，Planner 以同类已完成 codex/headed relay smoke 的 scope 作为事实来源，并已用 Brain API 确认当前 task 存在且 payload 字面包含 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`。

## Golden Path（核心场景）

系统从 task `53710094-898c-452c-8cc3-a56149e8b0ac` 进入 → Brain 接收并认领 `executor=codex + mode=headed + orchestrator=skill-relay` 的 `harness_initiative` → headed relay smoke 关键状态可被本机 API/DB/session 证据观察。

具体：
1. 触发条件：task `53710094-898c-452c-8cc3-a56149e8b0ac` 存在，payload 字面包含 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`、`journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`。
2. 系统处理：Brain 将该 task 作为 `harness_initiative` 处理，并保持 skill-relay/Codex headed smoke 的认领与 run 可观测状态。
3. 可观测结果：task payload、claimed_by/claimed_at、initiative_runs phase/host、以及 `sprints/07172022-relay-53710094`/`tui.log` 约定可被本机证据验证或解释。

## 边界情况

- 已存在 headed session 或 initiative_run 时，只验证现有状态，不重复 spawn，不误杀会话。
- Brain API、DB 或 session 证据暂不可读时，不能标 done，只能记录缺失证据。
- 报告与日志不得包含 GitHub token、Codex 凭据、完整敏感 prompt 或客户隐私。

## 范围限定

**在范围内**：读取当前 task、initiative_run、headed relay 关键状态；固化 codex-headed-smoke 回归验收边界；保留当前工作区作为 Cecelia base repo。

**不在范围内**：不新增业务功能；不改 dashboard/UI；不改 migrations；不创建 PR；不跨 repo promote；不扩大到 headless 或其他 executor smoke。

## 假设

- [ASSUMPTION: 当前 payload 薄且未提供 `thin_prd`，本 PRD 以同类历史 smoke 的 scope 与当前 payload 三元组作为锚点。]
- [ASSUMPTION: headed relay host 若未由 Brain runs API 返回，则以后续 DB `initiative_runs` 查询作为最终验收源。]

## 预期受影响文件

- `sprints/07172022-relay-53710094/prep-prd.md`: 当前 task 的 PrepPRD 归档。
- `sprints/07172022-relay-53710094/sprint-prd.md`: Planner 产出的 smoke 验收边界。

## NFR 约束

- 可观测：必须能通过 Brain API/DB/session 看到 task 与 initiative_runs/headed relay 状态。
- 安全：secrets 不硬编码、不进 git、不进日志；报告不得复述 token 或敏感 prompt。
- 幂等：已有 headed session/run 时不得重复 spawn 或误杀。
- 本地验证：done 结论必须基于本机真实命令/API/DB/session 证据。
- 最小变更：仅验证/固化 codex-headed-smoke 回归链路，不生成无关代码改动。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [Lint异步] lint-test-quality 读源码必须包装 async function，不能直接 readFileSync（来源: area）
- [表格契约] Test Contract 表格固定 4 列，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [Red提交] Red commit 只 git add 精确测试路径，禁止 git add . 或 git add .harness（来源: area）
- [回归验证] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [Cron入口] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [禁止自合] harness-generator 不得自行 merge PR，merge 权归 controller（来源: area）
- [Headed环境] headed relay tmux innerCmd 必须显式 export harness 上下文变量（来源: area）
- [模板复用] 复用历史合同模板前必须核对本次任务真实派发/执行历史（来源: area）
- [共享CI] 未经合同显式授权不得修改共享 CI 基础设施文件（来源: area）
- [SHA核验] PR 被 CI 兜底提前合并时必须用 PR head SHA 核对 verdict 锚定 sha（来源: area）
- [Smoke铁律] smoke 铁律（来源: area）
- [BrainSmoke] feat+brain/src PR 开 PR 前直接带齐 smoke.sh 与 smoke-allowlist 登记（来源: area）
- [新task接线] 新 task_type 接线需覆盖约束、路由表、executor 分支、relay loadSkill 与 dispatcher 防线（来源: area）
- [服务判活] 服务存活判定使用 launchctl 状态 + 端口监听双信号（来源: area）
- [LaunchAgents] 本机常驻服务禁止再放 `~/Library/LaunchAgents`，使用系统域 LaunchDaemon（来源: area）
- [常驻服务] 新增常驻宿主服务时必须同步 launchd-patrol manifest（来源: area）
- [Smoke铁律] smoke 铁律（来源: area）
- [单slot串行] 一个 slot/会话内严格串行执行任务；需要并行时用多个 slot/独立 session（来源: area）
- [禁写死假设] 环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真验才done] 依赖真机/生产 env/真实调用方的接缝断言必须真目标验证后才算 done（来源: area）
- [多租户测试] 单元/E2E 测试默认种至少 2 个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户，绝不跨租户混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：
# 1. GET /api/brain/tasks/53710094-898c-452c-8cc3-a56149e8b0ac 返回 task，payload 含 mode=headed、executor=codex、orchestrator=skill-relay。
# 2. 本机 DB/API/session 证据能说明该 task 已被 Brain 接收/认领，并处于 headed relay smoke 可观测状态。
# 3. sprints/07172022-relay-53710094/tui.log 约定存在，或能解释为当前 headed relay smoke 的可观测输出位置。
```

## journey_type: autonomous
## target_environment: local_api
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（PrepPRD 未锚定）
