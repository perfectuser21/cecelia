# Sprint PRD — kernel 真读 gear：三档在 orchestrator 状态机内分流

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：harness gear 三档在 kernel 上形同虚设（近 30 天 kernel-v1 跑 192 条，hotfix 1 条未被读、segmented 0 条）
- **本次推进预期**：kernel 状态机真读 payload.gear，hotfix/segmented/default 三档在 derive.js 内真实分流

## 背景

kernel runtime（`packages/brain/src/orchestrator/`）此前完全不读 `payload.gear`——gear 只被注进旧 relay 路径的 prompt/env（harness-skill-relay.js:581,636）由 harness-controller/SKILL.md:143 提示词消费；kernel 走 `orchestrator/derive.js` 纯函数状态机，不读 controller SKILL，导致 kernel 每条都跑裸 default。

法源：决策 1b677ae3（四线四档融合）+ 决策 e8f6134f（三条边界拍板，2026-08-09 Alex 拍板：hotfix 免 planner/GAN 但保留评估）。

## Golden Path（核心场景）

系统从 [Brain 派发带 gear 的 harness_initiative] → 经过 [kernel 读 gear 并按档分流] → 到达 [initiative_attempts 记录反映该档应有的相位链]。

具体：
1. **入口**：Brain 派发 harness_initiative，`task.payload.gear ∈ {default, hotfix, segmented}`（或非法值）。
2. **读入并持久化**：kernel run 启动（`orchestrator/run.js`）时把 gear 从 payload 读进 run context 并持久化到 `initiative_runs.gear`，进程后续每跳可查（`ground-truth.js` 每跳把 `run.gear` 注入 observed，缺省 `'default'`）。
3. **derive.js 按档分叉**（位置在所有 gear 无关守卫之后、planning 门之前）：
   - `gear=hotfix`：初始态（prd 未落盘 && 合同未批）跳过 planning/gan 相位直进 generate，保留 generator→evaluator→judge 链。
   - `gear=segmented`：分段执行，语义对齐 harness-controller/SKILL.md:279-291（RPA/真机大颗粒任务拆多段串行落地，每段独立点绿再进下一段）。
   - `gear=default`（含缺省）：落到现行 planning 门，**逐字节等价，零回归**。
4. **可观测出口**：hotfix run 的 initiative_attempts 无 planner/proposer/reviewer 记录、有 generator 记录；default run 三者齐备。

## 边界情况

- **非法 gear**（不在 GEAR_VALUES）：kernel 侧 fail-closed，terminal failed（reason=`invalid_gear`），不静默降级、不进任何相位，处理形态对齐 executor.js 的 invalid_gear terminal failed。
- **gear 缺省/NULL**：等价 default，走现行 planning 门（100+ 存量 derive 用例不传 gear，零回归红线）。
- gear 分档只决定「从初始态往哪条相位链走」；外部终态真相（terminal/merged/human-review-reject）与在途观测优先于分档判定。

## 范围限定

**在范围内**：
- gear 从 payload 读入 kernel run context 并持久化 `initiative_runs.gear`；进程可查。
- derive.js 状态机对 default/hotfix/segmented 三档分叉 + 非法 gear fail-closed。

**不在范围内**：
- 不建 `gear=param` 档（独立交付物 3）。
- 不动入口强制（交付物 4，/dev 改造为纯点火器）。
- 不改旧 relay 路径（harness-skill-relay.js / controller SKILL）的 gear 消费。

## 假设

- [ASSUMPTION: GEAR_VALUES = {default, hotfix, segmented}，derive.js 因纯函数纪律不 import relay，按值复制同一枚举，两端由评审/回归守卫保持一致。]
- [ASSUMPTION: 本 sprint 交付物在基线 sha be1baca71 上已由 #4747（commit 9cc96044a，同名 PR）落地——见「## 交付状态提示」。故本 sprint 实质任务应聚焦「真跑验收断言确认三档行为」而非从零实现。]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：0.6 gear 分档判定（invalid_gear fail-closed + hotfix 跳相位分支）。
- `packages/brain/src/orchestrator/kernel-run-store.js`：initiative_runs 落盘 gear 列。
- `packages/brain/src/orchestrator/ground-truth.js`：每跳把 run.gear 注入 observed。
- `packages/brain/src/orchestrator/__tests__/derive.test.js`：hotfix/default/invalid 分档单测（回归保留）。

## 交付状态提示

<!-- planner 锚定阶段发现：基线 sha be1baca71 上 grep gear 在 orchestrator 已有命中，
     且 recent commit 9cc96044a「feat(harness): kernel 真读 gear——derive 三档在 orchestrator 状态机内分流 [v1.271.0] (#4747)」
     即本任务同名交付。thin_prd「grep gear = 0」前提已过时。
     下游 proposer/generator/evaluator 应据此优先「真跑验收断言」路径，避免重复实现。 -->

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step 空 / journey_feature 无 ability_id / area 命中 capture-triage learnings -->
- [零回归] gear=default（含缺省/NULL）必须与现行 derive 行为逐字节等价，100+ 存量用例不得转红（来源: thin_prd + derive.js 注释）
- [fail-closed] 非法 gear 在 kernel 侧 terminal failed，禁静默降级、禁进任何相位（来源: 决策 1b677ae3/e8f6134f + executor invalid_gear）
- [证据分流] judge FAIL 先区分「证据窗口截断」与「实现缺陷」，evidence_insufficient 优先补证轮而非改代码（来源: area）
- [实跑验证] 合同验证命令必须实跑确认 exit code 语义（vitest 对 include 范围外路径的退出码陷阱）（来源: area）
- [列名核对] proposer 起草涉及表字段的合同/测试前先 psql 核对真实列名（如 initiative_runs.gear / initiative_attempts.role），不凭经验假设（来源: area）
- （另有约 15 条 capture-triage area learning 略，与本 sprint kernel 分档判定非直接相关）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 golden-paths 过滤 done/working = 0 条 -->
- （本 line 暂无已验收 golden_path 历史）

## NFR 约束

<!-- 来源: decisions category=nfr（step 空 / feature 无 ability_id 空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: hotfix/default 分档差异必须落 initiative_attempts.role，可被 psql 查证

## E2E 验收

> 本区块为 planner 初稿占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql + vitest）。

```bash
# 占位：proposer 将填入真实脚本（local_api → psql + vitest）
# 期望验收点（自然语言）：
# 1. psql：跑一条 gear=hotfix 的 kernel run，查 initiative_attempts，
#    role IN ('planner','proposer','reviewer') 记录数 = 0 且 role='generator' 记录数 >= 1
# 2. psql：同条件 gear=default 的 run，planner/proposer/reviewer 三者记录数均 >= 1
# 3. 单测：derive() 喂 gear=hotfix 的 observed 初始态（prdExists=false && contract.approved=false），
#    返回 action 不等于 'spawn:planner'
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/src/orchestrator/ 纯后端状态机，无 UI / 无远端 agent 协议 / 非 engine hooks。
## target_environment: local_api
## target_environment_reason: 验收全靠本地 curl localhost:5221 + psql 查 initiative_attempts/initiative_runs + vitest 跑 derive 单测，无 UI/无远端。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116-169c-46ec-bc7c-b335a22f80ec
