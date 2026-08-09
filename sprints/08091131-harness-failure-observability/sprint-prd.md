# Sprint PRD — harness 失败可观测：terminal 必写 failure_class + 失败率计量 API

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：harness_initiative 近30天 274 失败中 241 条 result=null，失败率无法按根因计量
- **本次推进预期**：为「连续 7 天失败率 < 25%」开锁闸铺设观测地基（决策 e8f6134f 交付物2）

## 背景

「连续 7 天 harness 失败率 < 25%」是决策 e8f6134f 交付物4（/dev 入口 fail-closed 强制）唯一的硬前置开锁闸。当前六成失败连原因都没写（result=null），既无法按根因收敛失败率，也无法判断锁何时能开。本 sprint 只做观测地基与计量口径，不做根因修复（后续独立交付物）。

## Golden Path（核心场景）

系统从 [任一 terminal 失败写入点] → 经过 [强制写 failure_class 枚举 + failure_detail] → 到达 [failure-stats API 可按根因计量滚动失败率]

具体：
1. [触发条件] 任一代码路径把 harness_initiative / golden_path_proposal 打成 terminal 状态（failed / blocked / cancelled）——已知写入点至少覆盖：`executor.js` 的 markInitiativeTerminalFailed、`orchestrator/loop.js` 的 mark_failed action、`dispatcher.js` 的 dispatch-fail-autoblock、`harness-relay-watchdog.js` 的超时/断链终结（须先枚举全量写入点再改，禁只改一两处）
2. [系统处理] 每个 terminal 写入点强制写入 `result.failure_class`（枚举值，不接受自由文本）+ `result.failure_detail`（自由文本）；新增「写 terminal 状态但不带 failure_class」的路径被机械闸（CI lint 扫描写入点或运行时 assert）拦下 exit 1
3. [可观测结果] `GET /api/brain/harness/failure-stats?days=N` 返回 200，body 含 `by_class` 分组计数对象 + `failure_rate` 数值字段（滚动失败率），供 7 天窗口计量与后续日报消费

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- failure_class 传入非枚举值 / 空 → 写入点或机械闸必须拒绝，禁止落库为 null 或自由文本
- 已存在但未来新增的 terminal 写入点 → 机械闸必须能扫到并拦下（防回归，纯文档约定不算数）
- failure-stats 窗口内 0 条 terminal 任务 → failure_rate 返回定义良好的数值（如 0），不报错
- 历史 241 条 null → 本 sprint 不回填，failure-stats 对历史 null 需有稳定归类口径（如计入 unknown / 排除）

## 范围限定

**在范围内**：枚举全量 terminal 写入点并强制写 failure_class + failure_detail；防回归机械闸；GET /api/brain/harness/failure-stats?days=N。
**不在范围内**：失败根因修复（后续独立交付物）；gear 分档（交付物1）；/dev 入口强制（交付物4）；回填历史 241 条 null。

## 假设

- [ASSUMPTION: failure_class 枚举取值以真实失败样本为准（如 initiative_runs 观测到的 kernel_orphan_dead、task_failed_upstream 等），具体枚举集合由 Proposer 在合同阶段锁定]
- [ASSUMPTION: 滚动失败率口径 = 窗口内 terminal failed 数 / 窗口内 terminal 总数，具体分母定义由 Proposer 在合同阶段确认]

## 预期受影响文件

- `packages/brain/src/executor.js`: markInitiativeTerminalFailed 写入点加 failure_class
- `packages/brain/src/orchestrator/loop.js`: mark_failed action 写入点加 failure_class
- `packages/brain/src/dispatcher.js`: dispatch-fail-autoblock 写入点加 failure_class
- `packages/brain/src/harness-relay-watchdog.js`: 超时/断链终结写入点加 failure_class
- `packages/brain/src/routes/harness.js`: 新增 GET /failure-stats 路由（现已托管 GET /runs）
- CI lint / 机械闸脚本: 扫描 terminal 写入点是否带 failure_class（新增，位置由 Proposer 定）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）+ PrepPRD（未显式指定参数）-->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: failure_class 必须是枚举（拒绝自由文本）；terminal 失败必须写 result.failure_class + result.failure_detail，缺失即视为缺陷（机械闸拦截）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 源为空）-->
- [合同实跑] 合同里的验证命令必须实跑确认 exit code 语义，写进合同前先跑一次——机械闸自测「故意漏写 → exit 1」须实测确认（来源: area）
- [judge分流] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」，evidence_insufficient 优先补证轮而非改代码（来源: area）
<!-- 另有若干 area 级 capture-triage 学习类 invariant 与本 sprint 无直接功能约束，略 -->

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收 golden-path 历史；journey e6f803f2 现有 ability 均为 planned 态）

## E2E 验收

> Planner 初稿此区块占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql cecelia）
# 期望验收点（自然语言）：
# 1. psql：制造一条 terminal failed 的 harness 任务后，SELECT result->>'failure_class' FROM tasks WHERE id=<该任务> 结果非 null
# 2. curl：GET localhost:5221/api/brain/harness/failure-stats?days=7 返回 200，body 含 failure_rate 数值字段与 by_class 分组对象
# 3. psql：本 sprint 上线后新产生的 terminal harness 任务中 result->>'failure_class' IS NULL 的条数 = 0
# 4. 机械闸自测：故意加一处不写 failure_class 的 terminal 写入 → CI lint 必须 exit 1
```

## journey_type: autonomous
## journey_type_reason: 全部改动落在 packages/brain/ 纯后端（写入点、机械闸、failure-stats API），无 UI/远端 agent/engine 参与
## target_environment: local_api
## target_environment_reason: 验收全走 curl localhost:5221 + psql cecelia（Brain 内部/纯 API 计量与写入校验）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116-169c-46ec-bc7c-b335a22f80ec
