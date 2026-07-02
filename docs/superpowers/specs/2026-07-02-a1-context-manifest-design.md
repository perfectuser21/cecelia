# A-1 Context Manifest 设计 — graph 代码注入 invariant + 累积 FR 给 proposer/generator/evaluator

> 诊断方案 A-1（docs/current/harness-verify-redesign/2026-07-02-context-pinning-and-handoff-diagnosis.md）。
> Brain task 3303915e。主理人拍板顺序 B→A-1→C-2 的第二项。
> 问题：A1 后 invariant 走"planner 写 PRD 文本→下游读文本"单线传递，GAN 改写几轮就丢；proposer/generator/evaluator 三角色对铁律失明。
> 修法：从"skill 里 curl 靠自觉"升级为"graph 节点代码注入（技术保证）"。reviewer 不动（E1 的活），planner 不动（A1 已做）。

## 新模块 `packages/brain/src/harness-line-context.js`

### API

- `fetchLineContext({ pool }, { taskId, abilityId, journeyId })` → `{ invariants: [...], cumulativeFR: [...] }`
  - 三源 invariant（SQL 与 `routes/abilities.js` 对应端点同源，直接 pool 查询不走 HTTP）：
    1. step 级：`SELECT d.*, gp.order_no FROM decisions d JOIN golden_path gp ON gp.id=d.target_id WHERE d.target_type='golden_path' AND gp.owner_task_id=$taskId AND d.category='invariant'`（taskId 缺省跳过）
    2. journey_feature 级：`SELECT * FROM decisions WHERE category='invariant' AND status='active' AND target_type='journey_feature' AND target_id=$abilityId`（abilityId 缺省跳过）
    3. area 级：`SELECT * FROM decisions WHERE category='invariant' AND status='active' AND level='area'`
  - 三源按 decision `id` 去重合并，附 `source_level`（'step'|'journey_feature'|'area'）。
  - 累积 FR：journeyId 非空时按 `routes/abilities.js` 的 `/journeys/:id/golden-paths` 同源 SQL（golden_path JOIN tasks JOIN journey_features，按 owner_task_id 分组、order_no 排序，过滤 ability_status IN ('done','working')）。
  - **任何一路查询失败 → 该路返回空数组 + console.warn，绝不 throw**（角色注入是增强不是门禁）。abilityId 从哪来：调用方传 `task.ability_id || task.payload.ability_id`。
- `formatLineContextForPrompt({ invariants, cumulativeFR })` → string
  - 空且空 → `''`。
  - invariant 段头：`## Invariant 约束（铁律，本角色产出不得违反）`；每行 **`- [标签] 铁律文字（来源: <层级>）`**，标签取 decision `topic` 里 `]` 后短语（如 `[Line04]不进群` → `不进群`），没有 `]` 则用 topic 前 6 字；铁律文字 = decision `decision` 字段，单条 ≤200 字截断。**行格式与 harness-planner v8.12.0 Step 0.4 逐字同构 = E1 解析契约，不可变。**
  - 累积 FR 段头：`## 累积 FR（本 line 已验收行为，不得回退/重复实现）`；每 ability 一行 `- <ability_name>: Step1 <note> → Step2 <note>`（单行 ≤120 字，>20 ability 截断加注）。空则整段省略（**与 planner 不同：角色注入无数据就不写占位段，减少噪音**）。
  - invariant 全量注入不裁剪；总长兜底 ≤4000 字截断。

## 三处注入（全部 try/catch warn 非致命，复制方案 B handoff 注入纪律）

1. **proposer**（`harness-gan.graph.js` proposer spawn 处，:510 附近）：spawn 前 fetch 一次（GAN 多轮复用同一 ctx——在 `runGanContractGraph` 入口 fetch 一次存 state/闭包，每轮 buildProposerPrompt 结果后 append；避免每轮重查）。注入段末尾加一句：`合同的 [BEHAVIOR] 断言不得与上述铁律冲突；已验收行为只能引用不得重做。`
2. **generator**（`harness-task.graph.js` spawnNode :301 `buildGeneratorPrompt` 结果后 append）：注入段末尾加一句：`实现代码不得违反上述铁律。`
3. **evaluator**（`harness-task.graph.js` evaluateContractNode 组装 evaluatePrompt 处 append）：注入段末尾加红线自查指令：`PASS 判定前逐条自查上述 Invariant：任何一条被违反 → 必须 FAIL 并在 feedback 指明违反哪条。`

ctx 来源：gan 图用 opts/ctx 里的 taskId + 从 tasks 表（或 state.task）取 ability_id/payload.journey_id；task 图 spawnNode/evaluateContractNode 用 state.task（tpayload.journey_id 已有先例 :720）。取不到的字段传 null，模块自动降级。

## 测试策略

- unit（`harness-line-context.test.js`，mock pool）：三源 SQL 参数断言/去重/降级（单路失败仅 warn）/格式契约逐字断言（与 planner Step 0.4 例句同构）/空→''/截断。
- wiring（`harness-line-context-wiring.test.js`，mock 前导复制 harness-handoff-wiring.test.js）：三处各两用例（有数据 prompt 含段+指令句；fetch 抛错 spawn/评估照常）。
- real-env smoke（`line-context-smoke.sh`）：真 DB 用 Line04 真实数据（feature bb5b6a1f 五条铁律）调 fetchLineContext+format，断言输出含"不进群"且格式行匹配 `- \[.+\] .+（来源: .+）`；只读不写库。
- 版本 bump patch + DevGate 三连。

## 不做（YAGNI）

- 不做 `GET /sprints/:id/context` 聚合端点（A-2 的活）
- 不动 reviewer（E1）、planner（A1）、skill 文件
- 不做 manifest registry/facts-check 校验（A-2）
