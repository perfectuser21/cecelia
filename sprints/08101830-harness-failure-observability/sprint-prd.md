# Sprint PRD — harness 失败可观测：terminal 必写 failure_class + 失败率计量 API

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（补齐失败观测地基，为「连续 7 天失败率 < 25%」开锁闸提供计量口径）

## 背景

近 30 天 harness_initiative failed 274 条，其中 241 条 `result` 为 null——六成失败没写原因，无法按根因收敛失败率。而决策 e8f6134f（交付物 2）要求：每条 terminal failed 必写 failure_class、241 条 null 归零。这是交付物 4（/dev 入口 fail-closed）唯一硬前置开锁闸「连续 7 天失败率 < 25%」的计量前提。本 sprint 只做观测地基与计量口径，**不做根因修复**。

归位：工厂 · F1 开发闭环（journey e6f803f2）· 步 1「接单进车间即分档」(3bf6c116) · 动作=加厚。

## Golden Path（核心场景）

系统从 [任意 terminal 收尾路径] → 经过 [强制写 result.failure_class] → 到达 [可按根因计量失败率]

具体：
1. 任一代码路径把 harness_initiative / golden_path_proposal 打成 terminal（failed / blocked / cancelled）时，触发写入。
2. 系统在同一次状态落库中，向 `tasks.result` 写入 `failure_class`（枚举值，拒绝自由文本）+ `failure_detail`（自由文本）。
3. 可观测结果 A（单条）：`SELECT result->>'failure_class' FROM tasks WHERE id=<该任务>` 返回非 null。
4. 可观测结果 B（口径）：`GET /api/brain/harness/failure-stats?days=7` 返回 200，body 含数值 `failure_rate` + `by_class` 分组计数对象。
5. 可观测结果 C（防回归）：本 sprint 上线后新产生的 terminal harness 任务中 `result->>'failure_class' IS NULL` 条数 = 0。
6. 可观测结果 D（机械闸）：故意新增一处不写 failure_class 的 terminal 写入 → CI lint / assert 判定 exit 1。

**位置词锚定**：thin_prd 含 "Brain / API / harness"，代码写在 `packages/brain/src/`，新 endpoint 挂 `localhost:5221/api/brain/harness/`。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **写入位置口径统一**：现存写入点口径不一致——`executor.js` 写 `custom_props.failure_class`、`dispatcher.js` 写 `payload.failure_class`，而验收断言查的是 `result->>'failure_class'`。本 sprint 必须把 failure_class 落点统一到 `result`，否则断言恒空。
- **枚举兜底**：未知失败原因不得写自由文本进 failure_class，须落一个 `unknown`（或等价）枚举成员，保证 IS NULL 归零。
- **全量枚举优先**：先枚举全部 terminal 写入点再改，禁只改一两处（已知至少 4 处：executor.markInitiativeTerminalFailed、orchestrator/loop.js mark_failed、dispatcher.js dispatch-fail-autoblock、harness-relay-watchdog.js 超时/断链终结）。
- **失败率分母**：failure_rate 需明确分母口径（terminal 总数 vs 全量），by_class 对空窗口返回空对象而非报错。

## 范围限定

**在范围内**：
- 全量 terminal 写入点强制写 `result.failure_class`（枚举）+ `result.failure_detail`。
- 机械闸（CI lint 扫描写入点 或 运行时 assert）拦截新增的裸 terminal 写入。
- 新增 `GET /api/brain/harness/failure-stats?days=N`（by_class 分组 + 滚动 failure_rate）。

**不在范围内**：
- 失败根因修复（后续独立交付物）。
- gear 分档改造（交付物 1）、/dev 入口 fail-closed 强制（交付物 4）。
- 历史 241 条 null **不回填**。

## 假设

- [ASSUMPTION: failure_class 枚举集合由 proposer 依现存 failure_reason 语料（如 no_progress_same_sha、kernel_process_fatal、relay_deadline_exceeded、remote_bridge_prepare_http_503）收敛为有限枚举 + unknown 兜底]
- [ASSUMPTION: failure-stats 分母 = 窗口内 terminal（failed/blocked/cancelled）harness 任务总数；failure_rate = failed / (该窗口 harness_initiative 完结总数)]
- [ASSUMPTION: 机械闸优先走 CI lint（静态扫描写入点），因 local_api 无 UI，运行时 assert 作为补充]

## 预期受影响文件

- `packages/brain/src/executor.js`: `markInitiativeTerminalFailed` 现写 custom_props，需改写 `result.failure_class`。
- `packages/brain/src/orchestrator/loop.js`: `mark_failed` action 的 terminal 收尾（~L298 outcome=failed）。
- `packages/brain/src/dispatcher.js`: dispatch-fail-autoblock 及 L352/399/450/512/603 各 terminal failed/blocked 写入，落点从 payload 统一到 result。
- `packages/brain/src/harness-relay-watchdog.js`: 超时/断链终结（relay_deadline_exceeded 等多处 outcome=failed）。
- `packages/brain/src/routes/harness.js`（或新 route 文件）: 新增 `GET /harness/failure-stats`，并在 `packages/brain/src/routes.js` 挂载。
- CI lint 脚本（`packages/quality/scripts/devgate/` 或 `scripts/`）: 机械闸扫描 terminal 写入点。
- `packages/brain/package.json` + `packages/brain/package-lock.json` + 根 `package-lock.json`: version 三处同步（`packages["packages/brain"].version` 必改，否则 gp-assertion-command-smoke.sh 挂）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path-decisions 返回 []）+ PrepPRD 显式硬约束 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本同步: **硬约束** — bump `packages/brain/package.json` version 时，`packages/brain/package-lock.json` 与根 `package-lock.json`（`packages["packages/brain"].version`）三处必须同步；push 前跑 `node -e "const l=require('./package-lock.json'),p=require('./packages/brain/package.json'); if(l.packages['packages/brain'].version!==p.version) throw new Error('root lock 版本不同步')"`。
- 可观测: 失败必写 result.failure_class；机械闸失败必须 CI exit 1（纯文档约定不算数）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 line/feature 级暂无 harness 专属 invariant） -->
- [local_api 验证形态] judge 机械闸⑤（meta_verification_gap）对 local_api 无 UI smoke 会死锁，合同须预先声明验证真相形态（psql/curl）或对闸⑤放行（来源: area）
- [合同命令实跑] 合同里的验证命令必须实跑确认 exit code 语义（vitest 对 include 范围外路径绿态也 exit 1），写进合同前先跑一次（来源: area）
- [台账不入库] controller 台账 .harness/progress.md 必须保持在 git 追踪之外，不得随 sprint PR 带入 repo（来源: area）
- [Deploy Preview 既有故障] Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故障（非 required check），本 PR 不追修，单独立案（来源: area）
- [证据窗口排序] evaluator 产 .brain-result.json 须把一手证据（root-cause、Red→Green 时序、exit_code）排进 judge 消费窗口（前 8 条×600 字符）前列（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 两条 golden-path 均非 terminal(done/working) 状态 -->
- （本 line 暂无已验收历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql）
# 期望验收点（自然语言）：
# 1. 制造一条 terminal failed 的 harness 任务 → psql: SELECT result->>'failure_class' FROM tasks WHERE id=<该任务> 非 null
# 2. curl -s localhost:5221/api/brain/harness/failure-stats?days=7 → HTTP 200，body 含数值 failure_rate 字段与 by_class 分组对象
# 3. psql: 本 sprint 上线后新产生 terminal harness 任务中 result->>'failure_class' IS NULL 条数 = 0
# 4. 机械闸自测：故意加一处不写 failure_class 的 terminal 写入 → CI lint / npm run <lint> exit 1
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 后端 DB 写入点 + API endpoint，无 UI、无远端 agent 协议，系统内部自治收尾。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端/API，E2E 在本地 evaluator 走 curl localhost:5221 + psql 验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116
