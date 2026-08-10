# Sprint PRD — harness 失败可观测：terminal 必写 failure_class + 失败率计量 API

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+2%（补齐 harness 失败观测地基，为「7 天失败率 < 25%」开锁闸提供计量口径）

## 背景

近 30 天 harness_initiative failed 274 条，其中 241 条 `result` 为 null——六成失败连原因都没写，无法按根因收敛失败率。而「连续 7 天失败率 < 25%」是决策 e8f6134f 交付物4（/dev 入口 fail-closed 强制）唯一的硬前置开锁闸；没有观测层，那把锁永远开不了、也无法判断何时能开。本 sprint 只做**观测地基与计量口径**，不做根因修复。

法源：决策 e8f6134f-4131-4145-a893-79eb098011d9（交付物2）。归位：工厂 · F1 开发闭环 · 步1「接单进车间即分档」(3bf6c116) · 动作=加厚。

## Golden Path（核心场景）

系统从 [某代码路径把 harness 任务打成 terminal] → 经过 [强制写入 failure_class + failure_detail] → 到达 [failure-stats API 可按根因计量滚动失败率]

具体：
1. **触发条件**：任一代码路径将 harness_initiative / golden_path_proposal 打成 terminal 状态（failed / blocked / cancelled）——已知写入点至少覆盖 `packages/brain/src/executor.js` 的 markInitiativeTerminalFailed、`packages/brain/src/orchestrator/loop.js` 的 mark_failed action、`packages/brain/src/dispatcher.js` 的 dispatch-fail-autoblock、`packages/brain/src/harness-relay-watchdog.js` 的超时/断链终结（改前必须先枚举全量写入点，禁止只改一两处）。
2. **系统处理**：每个 terminal 写入点强制写 `result.failure_class`（受控枚举值，拒绝自由文本）+ `result.failure_detail`（自由文本详情）。新增机械闸：任何「写 terminal 状态但不带 failure_class」的代码路径被拦下——CI lint 扫描写入点或运行时 assert，纯文档约定不算数。
3. **可观测结果**：`GET /api/brain/harness/failure-stats?days=N` 返回 200，body 含按 failure_class 分组的计数对象（by_class）与滚动失败率数值字段（failure_rate），供 7 天窗口计量与后续日报消费。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- terminal 写入点漏枚举 → 机械闸必须能抓到新增/遗漏的裸写入点并 exit 1。
- failure-stats 在窗口内无 terminal 任务 → 返回 200，by_class 为空对象、failure_rate 为 0（或明确的空口径），不得 500。
- failure_class 传入非枚举值 → 拒绝写入或规范化到「未分类」枚举，禁止把自由文本落库当 class。
- 历史 241 条 null **不回填**（明确排除）。

## 范围限定

**在范围内**：terminal 写入点全量枚举并强制 failure_class + failure_detail；防回归机械闸（CI lint 或运行时 assert）；GET /api/brain/harness/failure-stats?days=N。
**不在范围内**：失败根因修复；gear 分档（交付物1）；/dev 入口 fail-closed 强制（交付物4）；历史 241 条 null 回填。

## 假设

- [ASSUMPTION: failure_class 枚举取值由 proposer/实现方在 GAN 阶段定义并落成受控常量，planner 不锁具体枚举成员，仅锁「必须是受控枚举、拒绝自由文本」这一契约。]
- [ASSUMPTION: failure-stats 的「滚动失败率」= 窗口内 terminal failed 占该窗口 harness 任务总数之比，具体分母口径由 proposer 在 contract 阶段 codify。]
- [ASSUMPTION: 机械闸优先走 CI lint 静态扫描写入点；若静态扫描不可行则退运行时 assert，二者取其一即满足防回归约束。]

## 预期受影响文件

- `packages/brain/src/executor.js`: markInitiativeTerminalFailed 补写 failure_class + failure_detail。
- `packages/brain/src/orchestrator/loop.js`: mark_failed action 补写 failure_class + failure_detail。
- `packages/brain/src/dispatcher.js`: dispatch-fail-autoblock 终结路径补写 failure_class + failure_detail。
- `packages/brain/src/harness-relay-watchdog.js`: 超时/断链终结路径补写 failure_class + failure_detail。
- `packages/brain/src/routes/harness.js`（或同级 harness 路由）: 新增 GET /api/brain/harness/failure-stats。
- 新增机械闸脚本（CI lint 扫描 terminal 写入点）+ 其回归测试。
- `packages/brain/package.json` + `packages/brain/package-lock.json` + 根 `package-lock.json`（version bump 三处同步，见 NFR）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 sprint 无命中）+ PrepPRD 显式硬约束，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: version bump 必须**三处同步** — `packages/brain/package.json`、`packages/brain/package-lock.json`、仓库根 `package-lock.json`（`packages["packages/brain"].version`）。漏改根 lock 会挂 `gp-assertion-command-smoke.sh`（该 smoke 读根 lock 与 brain/package.json 比对）。push 前自查：`node -e "const l=require('./package-lock.json'),p=require('./packages/brain/package.json');if(l.packages['packages/brain'].version!==p.version) throw new Error('root lock 版本不同步')"`
- 可观测: failure_class 为受控枚举、拒绝自由文本；terminal 失败必须留根因，机械闸防回归不可仅靠文档约定。
- DevGate: 改 Brain 代码前须过 `node scripts/facts-check.mjs` + `bash scripts/check-version-sync.sh` + `node packages/quality/scripts/devgate/check-dod-mapping.cjs`。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 ability 无 step/journey_feature 级 invariant）；均为 capture-triage 通用学习铁律 -->
- [证据分档] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」，evidence_insufficient 优先走补证轮而非改代码（来源: area）
- [验证实跑] 合同验证命令必须实跑确认 exit code 语义，禁止假设 include 范围外路径的通过（来源: area）
- [口径三源] 指标口径类问题先查三源失真（未接线恒空、守卫自噬回流、双重计数）再当真实退化处理（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql cecelia）
# 期望验收点（自然语言）：
# 1. psql：制造一条 terminal failed 的 harness 任务后，SELECT result->>'failure_class' FROM tasks WHERE id=<制造的id> 结果非 null。
# 2. curl：GET localhost:5221/api/brain/harness/failure-stats?days=7 返回 200，body 含 failure_rate 数值字段 + by_class 分组对象。
# 3. psql：本 sprint 上线后新产生的 terminal harness 任务中 result->>'failure_class' IS NULL 的条数 = 0。
# 4. 机械闸自测：故意加一处不写 failure_class 的 terminal 写入 → CI lint 必须 exit 1。
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 后端（executor/orchestrator/dispatcher/watchdog/路由），无 UI、无远端 agent 协议，属自治后台改动。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端 + API，E2E 用本地 evaluator 走 curl localhost:5221 + psql cecelia 即可验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116（工厂·F1 开发闭环·步1「接单进车间即分档」）
