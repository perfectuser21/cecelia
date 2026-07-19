# Sprint PRD — headed relay 派发链路自测（claude-headed, task 57e25e92）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：headed relay 链路（planner→GAN→generator→evaluator→judge→merge→毕业→report）已有 a85e0582(#3827)、4bb31ef5(#3829)、049ebf93(#3970) 三条同类先例毕业
- **本次推进预期**：为本次 task_id=57e25e92 生成锚定该 task 的独立回归证据，巩固 executor=claude + mode=headed + orchestrator=skill-relay 链路可信度

## 背景

本任务由 Brain headed relay 派发链路自测机制创建（task_type=harness_initiative，journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963「Cecelia Harness Pipeline」，即 harness 流水线自身的开发基础设施 Journey），与已合并的 a85e0582「codex-headed-dispatch-smoke」、4bb31ef5「claude-headed-smoke」、049ebf93「headed relay e2e-verify.sh 回归证据」同源，用于再次验证 `executor=claude + mode=headed + orchestrator=skill-relay` 的 harness_initiative 全链路能被 Brain 正确接收、派发、跑通并留下可回归证据。不是新业务功能需求。

`payload` 中无 `prep_prd_body`/`thin_prd` 字段（已知情况，非缺陷）；本 PRD 依据 task title「headed-smoke-test」+ payload 三元组（mode=headed/executor=claude/orchestrator=skill-relay）+ 历史同类先例（PR #3827、#3970）锚定范围。

`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 已是通用脚本（不绑定具体 task id，已在 `packages/quality/smoke-allowlist.txt` 登记），本次不改动它，只复用。每次 headed-smoke-test 任务的产出是一份**锚定本次 task id** 的 e2e-verify.sh 薄封装。

## Golden Path（核心场景）

Brain 派发 headed relay 任务 → 本次 e2e-verify.sh 校验 → 证据留痕

具体：
1. [触发条件] task_id=57e25e92-84a3-4599-992c-b4b74ec54acc 已由 Brain 以 task_type=harness_initiative、payload.mode=headed / executor=claude / orchestrator=skill-relay / journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963 派发
2. [系统处理] e2e-verify.sh 依次：调用既有 `claude-headed-dispatch-smoke.sh`（不重实现）→ 查 `GET /api/brain/tasks/57e25e92...` 核对 task 记录与敏感字段脱敏 → 查 DB `initiative_runs` 核对本次 initiative_id 的 orchestrator_host/phase
3. [可观测结果] 全部断言通过则脚本 exit 0 并打印 PASS；任一断言失败则 exit 1 并打印具体 FAIL 原因

## 边界情况

- Brain task 记录不存在（未派发成功）→ e2e-verify.sh 必须 FAIL，不得静默跳过
- `initiative_runs` 无该 initiative_id 记录 → FAIL
- `initiative_runs.phase` 落在 `failed` → FAIL；`unknown`/非法枚举值 → FAIL
- task payload 意外携带 `token`/`github_token`/`anthropic_token`/`thin_prd` 明文字段 → FAIL（敏感字段泄漏）
- `claude-headed-dispatch-smoke.sh` 未在 `packages/quality/smoke-allowlist.txt` 登记 → FAIL

## 范围限定

**在范围内**：
- 新增 `sprints/07191312-relay-57e25e92/e2e-verify.sh`，锚定 TASK_ID=57e25e92-84a3-4599-992c-b4b74ec54acc、SPRINT_DIR=sprints/07191312-relay-57e25e92，结构镜像 049ebf93 版本（#3970）
- 调用既有 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`（已在 allowlist 登记，仅校验存在，不重复登记）
- 校验本次 task 的 Brain API 记录（含敏感字段脱敏检查）与 initiative_runs 记录

**不在范围内**：
- 不新增/修改 `claude-headed-dispatch-smoke.sh` 本体
- 不扩展业务功能，不改 dashboard/UI
- 不改 migrations
- 不跨 repo 生产 promote
- 不重复实现 ci.yml 的 claude-headed 分支改动（4bb31ef5 已落地）

## 假设

- [ASSUMPTION: 本次 task 派发已由 Brain 完成，initiative_runs 中存在 initiative_id=57e25e92-84a3-4599-992c-b4b74ec54acc 至少一条 run 记录]
- [ASSUMPTION: 复用 packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh 现有通用行为，本次不校验其内部实现细节]

## 预期受影响文件

- `sprints/07191312-relay-57e25e92/e2e-verify.sh`：新增，锚定本次 task_id 的回归验证脚本

## E2E 验收

期望验收点（自然语言）：
1. `GET /api/brain/tasks/57e25e92-84a3-4599-992c-b4b74ec54acc` 返回 task，`payload.mode=headed` / `payload.executor=claude` / `payload.orchestrator=skill-relay`，且 payload 不含 token/github_token/anthropic_token/thin_prd 明文字段
2. DB `initiative_runs` 中 `initiative_id=57e25e92-84a3-4599-992c-b4b74ec54acc` 至少一条记录，`orchestrator_host` 含 `skill-relay-claude-headed`，`phase` 非 `failed`
3. 复用调用 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 全绿，且该脚本已在 `packages/quality/smoke-allowlist.txt` 登记

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql）
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重（step/feature 均为空数组，area 31 条全量） -->
- [多设备类型(os_type/device] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统类型？…（来源: area, id=8dbe91ee）
- [capture-triage] learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area, id=113a9330）
- [capture-triage] learning: [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area, id=26a1d06e）
- [capture-triage] learning: [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源——SKIP 钩子（来源: area, id=66f41f70）
- [capture-triage] learning: [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（来源: area, id=9202c14e）
- [capture-triage] learning: [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"（来源: area, id=5775d866）
- [capture-triage] learning: lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area, id=6414193b）
- [capture-triage] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area, id=14ed5336）
- [capture-triage] learning: Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area, id=755fb846）
- [capture-triage] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area, id=c674ab49）
- [capture-triage] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area, id=55cb4cb7）
- [capture-triage] learning: harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area, id=e8230eb5）
- [capture-triage] learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID 等）（来源: area, id=72890f7c）
- [capture-triage] learning: Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同（来源: area, id=8d92f7b1）
- [capture-triage] learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享文件）（来源: area, id=1100cb8f）
- [capture-triage] learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合并 sha 一致（来源: area, id=26886b60）
- [smoke-invariant-1783] smoke 铁律（来源: area, id=552520d0）
- [capture-triage] learning: [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area, id=3efefc23）
- [capture-triage] learning: [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除（来源: area, id=5b91a042）
- [capture-triage] learning: [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机）（来源: area, id=365d645a）
- [capture-triage] learning: [ ] 本机（美国 Mac mini）禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务——gui 域不存在，永不加载；用系统域 LaunchDaemon（来源: area, id=02e74e46）
- [capture-triage] learning: [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（来源: area, id=b145c74a）
- [smoke-invariant-1783] smoke 铁律（来源: area, id=4b73376c）
- [系统] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session（来源: area, id=7ccfa168）
- [系统] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area, id=5e125909）
- [系统] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done（来源: area, id=3c30394c）
- [系统] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area, id=55b8eb46）
- [系统] secrets 不硬编码、不进 git、不进日志（来源: area, id=564802ee）
- [系统] 客户隐私/PII/聊天内容不得明文进日志（来源: area, id=459b6ff9）
- [系统] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area, id=50954d28）
- [系统] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area, id=68976b17）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths 查询结果为空数组（journey maturity=skeleton，尚无已验收 ability） -->
- （本 line 暂无历史）

## NFR 约束

<!-- 来源: PrepPRD 无 thin_prd/NFR 显式值（已知情况）；golden-path-decisions?category=nfr 查询为空数组，无副源补充 -->
- 超时/延迟: 待定（PrepPRD 未指定具体数值，e2e-verify.sh 走同步一次性校验，无长耗时依赖）
- 频控: 无（只读校验，不产生新写入）
- 版本要求: 无
- 可观测: 必须能通过 Brain API/DB 看到本次 task_id 与 initiative_runs 状态；e2e-verify.sh 断言失败必须打印明确 FAIL 原因

## journey_type: autonomous
## journey_type_reason: 纯 Brain/harness 后端派发链路 smoke，无用户可见 UI 交互（与 049ebf93/a85e0582 同类先例一致）
## target_environment: local_api
## target_environment_reason: 验收信号来自本地 Brain API localhost:5221 与本地 PostgreSQL 查询，无需浏览器或远端 runner
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（PrepPRD 未锚定）
