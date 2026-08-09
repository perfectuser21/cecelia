# Sprint PRD — harness 失败可观测：terminal 必写 failure_class + 失败率计量 API

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：harness_initiative 近30天 failed 274 条，其中 241 条 result 为 null（失败原因缺失率 ~88%）
- **本次推进预期**：把「失败原因缺失率」降到 0（新产生的 terminal 任务），为决策 e8f6134f 交付物4 的「连续 7 天失败率 < 25%」开锁闸提供计量地基

## 背景

法源 = 决策 e8f6134f-4131-4145-a893-79eb098011d9（交付物2）。交付物4（/dev 入口 fail-closed 强制）唯一的硬前置开锁闸是「harness_initiative 连续 7 天失败率 < 25%」。当前六成失败连原因都没写（result=null），既无法按根因收敛失败率，也无法判断锁何时能开。本 sprint 只做**观测地基与计量口径**，不做根因修复。

## Golden Path（核心场景）

系统从 [任一 harness terminal 失败发生] → 经过 [统一失败落库 + 计量] → 到达 [失败率可查、原因可分类]

具体：
1. **触发条件**：任一代码路径把 harness_initiative / golden_path_proposal 打成 terminal 状态（`failed` / `blocked` / `cancelled`）。已知写入点至少覆盖：`executor.js` 的 `markInitiativeTerminalFailed`、`orchestrator/loop.js` 的 `mark_failed` action、`dispatcher.js` 的 dispatch-fail-autoblock、`harness-relay-watchdog.js` 的超时/断链终结、`harness-death-handlers.js` 的死亡终结。**先枚举全量写入点再改，禁只改一两处。**
2. **系统处理**：每个 terminal 写入点强制写入 `result.failure_class`（受控枚举值，不接受自由文本）+ `result.failure_detail`（自由文本）。任一 terminal 写入落库后 `result->>'failure_class'` 非 null。
3. **可观测结果**：`GET /api/brain/harness/failure-stats?days=N` 返回 200，body 含 `failure_rate` 数值字段 + `by_class` 分组计数对象，供 7 天窗口计量与后续日报消费。
4. **防回归**：新增「写 terminal 状态但不带 failure_class」的代码路径必须被机械闸（CI lint 扫描写入点，或运行时 assert）拦下并 exit 1；纯文档约定不算数。

## 边界情况

- 已存在的 failure_class 字面量（executor/loop/watchdog 已散落使用 `timeout`/`runtime_crash`/`network`/`infrastructure_blocked`/`product_failure`/`evidence_invalid` 等）需收敛为**单一受控枚举源**，各写入点引用同一枚举，非法值即 lint/assert 失败。
- `days=N` 缺省、非数字、超大值时的默认与边界口径（proposer 阶段定契约）。
- 分母口径：滚动失败率 = terminal failed / (terminal failed + terminal done) 在窗口内的计数（口径需在合同中一句锁死，避免「未接线恒空子指标」失真）。
- 历史 241 条 null **不回填**（明确排除）。

## 范围限定

**在范围内**：① 全量 terminal 写入点强制 failure_class + failure_detail；② 受控枚举单一来源；③ 机械闸（CI lint / 运行时 assert）防回归；④ `GET /api/brain/harness/failure-stats?days=N` 计量端点。
**不在范围内**：失败根因修复（后续独立交付物）；gear 分档（交付物1）；/dev 入口 fail-closed 强制（交付物4）；历史 241 条 null 回填；dashboard/前端可视化。

## 假设

- [ASSUMPTION: failure-stats 端点落在 `packages/brain/src/routes/harness.js`（既有 `/api/brain/harness/*` 路由聚集处）。]
- [ASSUMPTION: 受控枚举以现有散落字面量为基础收敛，最终清单由 proposer 在合同阶段读代码定稿。]
- [ASSUMPTION: 计量数据源为 `tasks` 表 `task_type IN (harness_initiative, golden_path_proposal)` + `result->>'failure_class'`。]

## 预期受影响文件

- `packages/brain/src/executor.js`：`markInitiativeTerminalFailed` 强制写 failure_class + failure_detail
- `packages/brain/src/orchestrator/loop.js`：`mark_failed` action terminal 落库补 failure_class
- `packages/brain/src/dispatcher.js`：dispatch-fail-autoblock block 落库补 failure_class
- `packages/brain/src/harness-relay-watchdog.js`：超时/断链终结补 failure_class
- `packages/brain/src/harness-death-handlers.js`：死亡终结路径补 failure_class（枚举待 proposer 全量确认）
- `packages/brain/src/orchestrator/failure-persistence.js`：作为共享落库助手，收敛受控枚举单一来源
- `packages/brain/src/routes/harness.js`：新增 `GET /harness/failure-stats`
- CI lint 脚本（新增，`scripts/` 或 `packages/quality/`）：扫描 terminal 写入点缺 failure_class 即 exit 1

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将按 local_api 填入真实脚本（curl localhost:5221 + psql）
# 期望验收点（自然语言）：
# 1. psql：制造一条 terminal failed 的 harness 任务后，SELECT result->>'failure_class' FROM tasks WHERE id=<新任务> 结果非 null
# 2. curl：GET localhost:5221/api/brain/harness/failure-stats?days=7 返回 200，body 含 failure_rate 数值字段与 by_class 分组对象
# 3. psql：本 sprint 上线后新产生的 terminal harness 任务中 result->>'failure_class' IS NULL 的条数 = 0
# 4. 机械闸自测：故意加一处不写 failure_class 的 terminal 写入 → CI lint 必须 exit 1
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task/ability 无挂载，返回空）+ PrepPRD 显式约束 -->
- failure_class 类型: 受控枚举（非自由文本），非法值必须被机械闸拦下
- failure_detail 类型: 自由文本（允许空但不允许缺 failure_class）
- 计量口径: 滚动失败率必须真实接线（禁「未接线恒空子指标」自欺）
- 可观测: 每条 terminal harness 任务失败必写 failure_class（缺失率新增 = 0）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 journey/ability 无专属挂载）-->
- [口径三源失真] 指标口径类先查口径三源失真（未接线恒空子指标、守卫自产回流自噬、双重计数）再当真实退化处理（来源: area）
- [验证实跑] 合同里的验证命令必须实跑确认 exit code 语义，绿态不等于真验（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收行为；journey e6f803f2 现有 ability 均为 planned 态）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 后端与 Brain API，无 UI/远端 agent/engine hooks，属纯后台自主流程
## target_environment: local_api
## target_environment_reason: 验收全部为本地 curl localhost:5221 + psql（Brain 纯后端），无浏览器/Windows/远端服务器
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116（F1 开发闭环 · 步1「接单进车间即分档」· 动作=加厚）
