# Sprint PRD — check-handoffs.mjs 契约 schema 化：CHECKS 扩为 CONTRACTS（coding 九格 + leadgen 八格业务 postcondition）

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（Commander 验收机械项脱离 LLM 眼睛，交接判定确定性提升）

## 背景

Commander 验收各格交接时，机械可判的项（产出物是否合规、记录是否落库、状态是否迁移等）目前混在 LLM 语义审查里，靠"眼睛看"，不确定且可被工人编造值绕过（r40/r42/r53 案卷实证）。`check-handoffs.mjs` 现有 CHECKS 仅 4 条坐标契约，只查缺漏与格式，防不住编造值、更没有按格的业务 postcondition。本 sprint 把 CHECKS 扩为 CONTRACTS，为 coding 线九格、leadgen 线八格每格定义可执行的 precondition/postcondition/side_effects 断言，Commander 验收前先机械跑一遍。依据决策 28ca1f69。

## Golden Path（核心场景）

系统从 [Commander 到达某格收口] → 经过 [check-handoffs.mjs 按该格 CONTRACTS 机械跑断言] → 到达 [每格每断言的确定性 PASS/FAIL 判定，Commander 据此放行或打回]

具体：
1. Commander 在某格（coding 九格之一 / leadgen 八格之一）验收前，调用 `check-handoffs.mjs`，传入格标识 + 该格交接对象/坐标。
2. `check-handoffs.mjs` 按该格 CONTRACTS 定义执行 precondition / postcondition / side_effects 三段断言；断言覆盖六类可参数化判据：产出物合规、记录落库、外部可见、状态迁移、数值达标、负向越界。
3. 校验器输出结构化机械判定结果（逐格逐断言 PASS/FAIL + 失败原因），机械项判定不再进入 LLM 语义审查；Commander 依机械结果放行或打回。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 传入未知格标识 / 未定义 CONTRACTS 的格：应显式报错，不得静默 PASS。
- 交接对象缺字段或字段格式非法（承接现 CHECKS 的坐标契约能力）：当场 FAIL。
- 断言依赖的外部资源不可达（DB / 产出物路径）：判为不可判定，不得当 PASS。
- coding 九格与 leadgen 八格断言集不同，不得互相串用。
- 负向越界断言（本应失败的输入若通过则视为漏洞）：必须真被断言拦住。

## 范围限定

**在范围内**：
- `check-handoffs.mjs` 的 CHECKS（4 条坐标契约）扩为 CONTRACTS = {coding 九格 + leadgen 八格}。
- 每格 precondition / postcondition / side_effects 三段，六类断言参数化。
- CONTRACTS 定义作为 SSOT 进入本 repo。

**不在范围内**：
- Commander 侧 LLM 语义审查逻辑本身（保留，不改）。
- HK worker 侧的实际部署同步执行（SSOT 进 repo 后由运维/同步机制完成，非本 sprint 代码任务）。
- 轻对抗审契约完备性的 reviewer skill（Crystal 第 3 件，独立 sprint）。

## 假设

- [ASSUMPTION: `check-handoffs.mjs` 当前 CHECKS 为 4 条坐标契约；该文件现主要存在于 HK worker 侧，本 sprint 将其 SSOT 引入 repo，具体落盘路径由 Proposer 在 GAN 阶段确认。]
- [ASSUMPTION: coding 九格 = home-sequencer.js 定义的 coding 线完整格序（init + 九格 + finalize）中的九格；leadgen 八格 = leadgen 线对应格序。]
- [ASSUMPTION: 六类断言 = 产出物合规 / 记录落库 / 外部可见 / 状态迁移 / 数值达标 / 负向越界。]
- [ASSUMPTION: 决策 28ca1f69 为本任务的授权依据。]

## 预期受影响文件

- `check-handoffs.mjs`：CHECKS → CONTRACTS 主改点，SSOT 落盘（位置词铁律：实现必须落在 check-handoffs.mjs）。
- `packages/brain/src/orchestrator/home-sequencer.js`：coding 九格格序定义，CONTRACTS 每格对齐的来源。
- `packages/brain/src/orchestrator/commander-contract.js`：Commander 验收调用 CONTRACTS 校验器的接入点。
- 对应单测 / smoke 脚本：机械断言的回归覆盖。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step + feature 双源均为空），PrepPRD 显式值优先 -->
- 超时/延迟：待定（PrepPRD 未指定；机械校验应快速返回，Proposer 阶段可与用户确认上限）
- 频控：无
- 版本要求：无
- 可观测：机械判定结果须结构化输出（逐格逐断言 PASS/FAIL + 原因），失败项可追溯

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 空；area 层 90 条中筛出与本 harness 契约域直接相关者全量列出，其余为他域 capture-triage 学习条目（见段末披露） -->
- [机械判定] 机械判定不能建立在 LLM 自愿配合上；坐标/断言值一律以服务端权威产物为准，工人抄写值不信（来源: area / DEFINITION.md r40 案卷）
- [DIRTY路由] PR 与 main 冲突（DIRTY）时必须路由 generator-fix 做 rebase，根除死等/误判死（来源: area，决策 3ecd7ffa）
- [证据窗口] judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 .brain-result 时须适配该窗口（来源: area）
- [脚本隔离] evaluator/校验临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名（来源: area）
<!-- 披露：area 层 invariant 台账共 90 条，绝大多数为 capture-triage / android / feishu 等他域 learning 条目，与本 sprint「契约 schema 化」无直接冲突，此处只列直接相关的 4 条，其余略。 -->

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 下 golden-paths 经 done/working 过滤后为空 -->
- （本 line 暂无已验收历史）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（node + curl localhost:5221 + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#   1. 以一个"合规交接对象"跑 check-handoffs.mjs 某 coding 格 → 六类断言全 PASS，退出码 0；
#   2. 以一个"故意越界/缺字段的交接对象"跑同一格 → 对应断言 FAIL 且给出原因，退出码非 0（负向越界真被拦）；
#   3. 校验 CONTRACTS 覆盖 coding 九格 + leadgen 八格全部格标识，未知格标识显式报错不静默 PASS。
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/src/orchestrator 的 Commander/kernel 后端机械校验器，非 UI、非 bridge、非 engine hooks，属后端自主流水线。
## target_environment: local_api
## target_environment_reason: 纯 Node 机械校验器 + Brain 侧调用，验收走本地 evaluator（node + curl localhost:5221 + psql），无 UI/远端机器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
