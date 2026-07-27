# Sprint PRD — Kernel Knife1 Recovery 3：PR #4372 F1 等价基线收口

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：85%（把 PR #4372 重新绑定到 current `origin/main`，收口 F1 基线与审批链漂移）

## 背景

任务 `aee91b5d-149e-4375-b6ba-c15cd7623208` 是对失败 run `9fea4e93-035e-4334-9209-bf82d154d452` 的恢复。现有 Draft PR #4372 必须继续沿用，不能新开 PR、不能继承旧 approval。恢复目标不是“让旧证据重新绿”，而是在 current `origin/main` 上重做一套 fail-closed oracle 证据链：重新绑定最终 head SHA、重跑真实隔离 DB 的 migration 366、恢复 F1 Golden Path × 11要素、补齐旧 Claude Code P0/P1 等价基线，并证明 evaluator PASS、judge PASS、human approval 都只能绑定同一个最终 SHA。

## Golden Path（核心场景）

入口：恢复任务接管现有 Draft PR #4372，并先对齐 current `origin/main` 与最终 PR head SHA → 经过「六个重叠语义面与 current main 对账 → migration 366 双跑稳定验证 → evaluator 测试库护栏与 F1 fail-closed 套件 → 审批/判官/人工批准同 SHA 失效链验证」→ 出口：PR #4372 仍为 Draft，所有当前 required context 只绑定同一个最终 SHA，旧 76 checks 与旧 approval 全部失效，生产库零写入

具体：
1. 执行时先获取 current `origin/main`，若已不同于任务出生基线 `1dc9d4107`，则明确作废旧 merge-base 证据，并把 PR #4372 的收口基准切到新的 current main
2. 仅复用现有 Draft PR #4372，保留 proposer commit `d8db6d9f07711fec53d5c88dce60ad03066dfeea` 与 reviewer attempt `6dc36461-01db-443c-9e71-31b7895386dd` 作为历史证据，不把它们当作当前有效批准
3. 对 PR #4372 与 current main 的六个已知重叠/冲突语义面做逐项对账，要求零 conflict marker、零 parallel old/new behavior path，且对账基准是 current main 现状而不是旧 merge-base
4. F1 基线只认真实 migration 文件 `packages/brain/migrations/366_kernel_harness_f1_baseline.sql`；所有语义上仍指向 migration-365 的集成测试、oracle 或文案必须改绑到 366 合同，但不得误伤仓库内仍合法存在的 363/364/365 历史文件
5. 在一个可达的隔离数据库里连续执行同一份 migration 366 两次，验证 schema、data、index、constraint 终态稳定，且稳定性判定不得依赖脆弱的五分钟 `schema_version` 行
6. evaluator 容器内必须强制使用 `HARNESS_TEST_DATABASE_URL`，拒绝 production-like/default/`127.0.0.1` URL，要求 `host.docker.internal`，并在任何写入前核实 `current_database()`、`inet_server_addr()` 与库名白名单（仅 `*_test` 或 `preview_*`）
7. F1 等价验收必须是 fail-closed 的可执行套件，独立覆盖合同 oracle、真实集成测试、端点语义、运行时非回归、DevGate/current-SHA 检查、以及七个具名 legacy smoke，并最终断言单一 F1 Journey、S0-S12、143 cells、精确 11 elements、8 个 legacy families
8. 在隔离 fixture 或只读查询路径里证明 evaluator PASS、judge PASS、human approval 是三条服务端记录，且三者都绑定同一个最终 PR head SHA；只要出现新 commit 或 head 变化，这三条记录与 required checks 必须一起失效
9. PR #4372 在收口后仍保持 `isDraft=true` 且 `autoMergeRequest=null`；`review_required=true` 仍由服务端控制，merge/deploy 必须等待 evaluator、judge、user approval 三者在同一最终 SHA 上齐备

## 边界情况

- current `origin/main` 已漂移到新 SHA，但 PR 仍引用旧 merge-base 证据时，必须视为旧证据全部失效
- 仓库内仍存在合法 migration 363/364/365 文件时，不能因为“全面升级到 366”而误报历史文件违规
- evaluator URL 指向默认库、生产库、`127.0.0.1`、非 `host.docker.internal` 或库名不在白名单时，必须在写入前 fail-closed
- migration 366 第二次执行若出现索引、约束、种子数据或 schema 偏移，视为 recovery 失败
- 任一 approval/judge/evaluator 记录与最终 head SHA 不一致时，视为 stale record，不得复用
- 任何路径试图修改真实 approval 或生产数据库时，必须被排除在范围外

## 范围限定

**在范围内**：收敛既有 Draft PR #4372；重新绑定 current main 与最终 head SHA；migration 366 双跑稳定性；evaluator 测试库强护栏；F1 fail-closed 套件；Draft/approval/judge/evaluator 同 SHA 失效链证明；风险与缓解写入合同
**不在范围内**：创建新 PR；继承旧 approval；修改生产数据库；把 evaluator 判绿替代 human approval；泛化改造全部历史 migration；引入第二条 F1 Journey 或扩展 F1 范围外新行为

## 假设

- [ASSUMPTION: PR #4372 当前仍处于打开且 Draft 状态，恢复工作直接在该 PR 头分支继续收口]
- [ASSUMPTION: 可提供一个真正隔离、可重复写入的测试数据库，且 evaluator 容器能通过 `host.docker.internal` 访问]
- [ASSUMPTION: 六个重叠语义面的具体清单已在现有恢复证据中定义，Proposer 阶段会把它们翻成逐项可执行断言]

## 预期受影响文件

- `packages/brain/migrations/366_kernel_harness_f1_baseline.sql`：F1 基线唯一合法 migration 实体，需作为双跑与等价验证锚点
- `packages/brain/src/__tests__/integration/migration-365-executor-kind-kernel-process.integration.test.js`：若语义已切到 366，需要同步更名或改合同断言
- `packages/brain/src/routes/harness-kernel-approvals.js`：Draft/approval/head-SHA 绑定与失效链只读证明的主要服务面
- `packages/brain/src/harness-judge.js`：judge PASS 与最终 head SHA 绑定约束的主要判定面
- `packages/engine/src/harness/evaluate.js`：evaluator 容器内 `HARNESS_TEST_DATABASE_URL`、host 校验、库名白名单、写前探测护栏
- `packages/engine/src/harness/e2e-judge.js`：F1 等价 suite 的 fail-closed 汇总与最终 oracle 断言
- `packages/quality/scripts/devgate/ci-preflight.sh`：current-SHA/DevGate 相关前置核查面
- `packages/brain/scripts/smoke/` 下相关 F1/legacy smoke：七个具名 legacy smoke 与当前 SHA 绑定验收面

## NFR 约束

<!-- 来源: PrepPRD 显式值优先；golden-path-decisions 与 ability decisions 查询均为空数组 -->
- 数据库隔离: 只允许隔离测试库；生产 DB mutation forbidden
- 连接护栏: evaluator 内必须使用 `HARNESS_TEST_DATABASE_URL` + `host.docker.internal`，拒绝 production-like/default/`127.0.0.1`
- 写前校验: 任何写入前必须验证 `current_database()`、`inet_server_addr()` 与库名白名单（仅 `*_test` 或 `preview_*`）
- 失败策略: F1 验收必须 fail-closed；禁止 `|| true`，禁止 grep-only proxy，禁止以单条弱信号替代真实套件
- SHA 一致性: evaluator PASS、judge PASS、human approval、required checks 必须全部绑定同一最终 PR head SHA
- PR 状态: PR #4372 必须保持 `isDraft=true` 且 `autoMergeRequest=null`
- 风险显式化: 合同中必须显式列出并缓解测试库污染、历史 head 复用、stale approval/judge/evaluator 复用、current-main drift

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step 级/feature 级为空；area 级取与本任务直接相关的有效铁律 -->
- [环境来源] target_environment 必须从 DB tasks.payload 读取，不从文件读，任务注册时须正确设置（来源: area）
- [结果格式] Brain judge `.brain-result.json` 必须有顶层 `exit_code` + `log_tail` + `behavior_tests[]`，每条含 `exit_code` 与 `log_tail`（来源: area）
- [PR-SHA核对] PR 被 CI 侧提前合并或 head 变化时，必须用 PR head SHA 对齐 evaluator/judge verdict 锚点，确认无代码漂移后才可视为有效（来源: area）
- [CI文件禁区] 跨 sprint 共享 CI 基础设施文件未经合同显式授权不可修改（来源: area）
- [PR带smoke] `feat+brain/src` 类 PR 开 PR 前须一次带齐 smoke/allowlist 登记，不能等 CI 二次兜底（来源: area）
- [合同复用核对] 复用历史合同模板或 E2E 断言前，必须先核对本次任务的真实派发/执行历史，不能假设与先例相同（来源: area）
- [manual-exit-code] 合同批准前必须记录 manual oracle 的真实 exit code，并确认目标解释器确实启动（来源: area）
- [node-e真跑] `node -e` 双引号中的 JavaScript `${}` 必须逐条真跑，`bash -n` 不能替代真实执行（来源: area）
- [失败硬退] 部署/验证链任何失败路径禁止 warning 降级，必须显式失败并保留告警或证据（来源: area）
- [判变基准] 判变与验收必须用生产实体或目标实体自报 SHA 对账 current `origin/main`，不能靠旧 merge-base 或旁路缓存（来源: area）
- [单slot串行] 单 slot/单会话内严格串行，一个任务收口后才能起下一个（来源: area）
- [禁写死环境] 禁止写死环境假设值，测试库 host/库名/端口都必须由环境或真验证据给出（来源: area）
- [真环境验证] 依赖真实容器/真实 DB/真实调用链的接缝断言，必须在真目标上验证后才算 done（来源: area）
- [默认多租户] 涉及数据库写读的测试默认至少种两租户并断言互不串扰（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/敏感内容不得明文进日志（来源: area）
- [租户隔离] 任何触碰租户数据的读写必须 scope 到当前租户，禁止跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块只定义端到端必须验到的结果。最终可执行脚本由 proposer 按 `target_environment=local_api` 产出。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（git fetch + curl + psql + 容器内 evaluator 命令）
# 期望验收点（自然语言）：
# 1. 取 current origin/main，与任务出生基线 1dc9d4107 对比；若已漂移，则旧 merge-base 证据被显式作废
# 2. 对 PR #4372 最终 head SHA 跑六个重叠语义面对账，确认零 conflict marker、零 old/new 双路径共存
# 3. 在同一个隔离数据库里连续执行 migration 366 两次，第二次后 schema/data/index/constraint 与第一次完全等价
# 4. evaluator 容器内若 HARNESS_TEST_DATABASE_URL 非 host.docker.internal 或库名非 *_test/preview_*，在任何写入前直接失败
# 5. fail-closed F1 suite 独立通过合同 oracle、真实集成测试、端点语义、运行时非回归、DevGate/current-SHA、七个 legacy smokes
# 6. 最终只存在一个有效 F1 Journey，覆盖 S0-S12、143 cells、精确 11 elements、8 legacy families
# 7. 只读证明 evaluator PASS、judge PASS、human approval 三条服务端记录绑定同一最终 head SHA；任一新 commit 会使三者与 required checks 一起失效
# 8. PR #4372 收口后仍为 Draft，autoMergeRequest 为空，且全程无生产数据库写入
```

## journey_type: autonomous
## journey_type_reason: 任务聚焦 `packages/brain/`、`packages/engine/`、本地 DB/容器与 Brain API 的后端恢复链，无 dashboard、无远端 agent 协议 UI 交互，按优先级链归类为 autonomous
## target_environment: local_api
## target_environment_reason: 最终验收依赖本地 Brain API、git/current-SHA、容器内 evaluator 与隔离 Postgres 测试库，不涉及浏览器或远端服务器；执行面为 localhost + 本机容器
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
