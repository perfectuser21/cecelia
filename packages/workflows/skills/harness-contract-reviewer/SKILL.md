---
id: harness-contract-reviewer-skill
description: |
  Harness Contract Reviewer — Harness GAN Reviewer Layer 2b：
  Evaluator 角色，对抗性审查 Proposer 提出的 sprint contract，聚焦 **产品/spec 质量**
  而非"防作弊测试框架"。
  核心职责：(1) spec 对齐用户真需求 (2) criteria 可量化无歧义 (3) happy + error + 边界场景全覆盖
  GAN 对抗**多轮**直到双方达成共识。无硬轮数上限，但 Reviewer 真找不出实质 spec/产品漏洞时必须 APPROVED。
version: 9.14.0
created: 2026-04-08
updated: 2026-08-05
changelog:
  - 9.14.0: 堵「橡皮 closure」口（r43 实证 — proposer 一句"已按合同实际内容关闭"空话 closure E4-1,合同正文一字未改,Reviewer 未核原文即 APPROVED,下游 Generator 拿到未改合同再次撞死,重开白做）——Step 2.5 closed 裁定新增硬格式:必须附 evidence: 字段直接引用本轮合同原文片段(≥20字),无引用=still-open;E 号(重开)blocker 从严,引用条款必须是本轮新增/实质修改的。9.12 已有"以合同实际内容为准"的原则条款但被采样漂移击穿,本次改为可机械核验的格式要求(配套 Kernel 机械闸 backlog)
  - 9.13.0: 堵「伪 RED 占位桩」漏检口（Kernel PR#1581 r33 实证 — fleet-worker-receipt.test.ts 一条测试体是无条件 `throw new Error('TDD RED：...')`，被批准锁定后与"测试文件不可改"铁律死锁，Generator 既无法实现出能通过的代码也不能改测试，只能 BLOCKED，浪费整轮 GAN + Generator 尝试）——Golden Path 覆盖审查新增第 25 条：测试体断言任何输入下都必然失败（不区分实现对错）的占位符 → 批准前必须打回，要求换成断言具体行为、只是当前未实现所以真 FAIL 的正常 TDD RED 断言
  - 9.12.0: 案卷式 GAN 协议（配套 cecelia kernel 1.267.207+）——Step 2.5 收敛追踪整节重写为「案卷 closure 裁定协议」：不再依赖 reviewer 自己的跨轮记忆（每轮都是新会话），改读 bundle inputs.case_file 逐条裁定上一轮 blocker closed/still-open，proposer 的 closure 声明行只作线索、以合同实际内容为准；新增 blocker 必填 why_not_found_earlier + prd_gap 两字段，缺任一作废、不计入扣分依据；blocker 带稳定编号 R<round>-<seq>。结果 JSON 新增顶层 `case_file`（blockers[] + feedback_md）与 `decision.rubric_scores`，closure 裁定表写入 feedback_md。趋势兜底（diverging/oscillating）明确由 Kernel `detectRubricTrend` 负责，旧引用 `harness-gan.graph.js` 改为该函数名；PRD 锚新增 thin_prd/prep_prd_body 读取指引（bundle 有值时以其为准）。7 个 rubric 维度键名一字未动。
  - 9.11.0: Kernel validation identity late-binding——Reviewer task bundle 只描述当前审查者 provenance，不得要求合同改绑为 Reviewer attempt/account/snapshot；审查改为拒绝所有 GAN authoring UUID 硬编码，并要求实际 Generator/Evaluator/Judge 各自使用 Runner attestation 与证据摘要串联
  - 9.10.0: Kernel local_api 资源闭环——新增第 23 条审查：Postgres 合同必须对 Fleet 注入的空库运行真实 migration/schema bootstrap；业务 cookie/session/tenant 必须由 E2E 真实 signup/login 动态创建；依赖预注入 AUTH_COOKIE/TENANT_ID、生产数据副本或长期业务凭据一律 REVISION
  - 9.9.0: GP锚定闭环刀3（与 proposer 9.18.0 配套）——Golden Path 覆盖审查新增第 22 条：product-map/generated/product-map.json 存在的仓库，合同缺 ## GP-Anchor 段/id 查无/格式不合法 → 第 4 维 internal_consistency 打回；文件不存在时缺 gp-anchor: skipped 声明同样打回（沉默跳过与真做过判断不可区分）
  - 9.8.0: W7 人形验收（RD 2026-07-28，决策 d3021871，与 proposer 9.17.0 配套）——Golden Path 覆盖审查新增第 20 条（新写 [BEHAVIOR] 缺 动作/预期观察/等待预算/留证 任一行或 Test: 非单行完整命令 → 第 1 维 dod_machineability 打回；[legacy] 标记条目豁免）+ 第 21 条（合同缺 ## 探索提示 段，或错输入/重复提交/中途中断/边界值明显适用却未覆盖 → 第 6 维低分打回，feedback 必须直接给出建议的探索提示条目文本供 proposer 原样填入）；7 个维度名不动（ReviewerOutputSchema 接口约定）
  - 9.7.0: 堵「留给后续 sprint / 技术债清理」逃逸口（decision 8dbe91ee 实证 — os_type/device_platform 语义重叠被记为技术债放行，10天后漂移成生产bug PR#1313，此后也没人回头补前端展示层）— Golden Path 覆盖审查新增第 19 条：新字段与既有字段语义重叠时，合同只写"留给后续sprint/技术债"且无具体跟进机制（无Brain task_id）→ 第 5 维 risk_registered 直接打回，必须当场消解或附可执行跟进项
  - 9.5.0: 真实链路四硬规则审查（handoff 0714 刀2 — #1267/#1269/#1271/#1256 实证，与 proposer 9.10.0 对齐）— Golden Path 覆盖审查新增第 14/15/16/17 条：(14) 设备/agent 调服务端缺「真实调用方请求 shape」段或 DoD 认证字段与生产调用方不逐字段一致 → 打回（规则A）；(15) 第三方 API 全 mock 零真调 → 打回（规则B）；(16) DoD 含 force_*/stub/假数据但无「未覆盖真实链路清单」段 → 打回（规则C）；(17) target_environment 与 ability 真实运行环境不匹配 → 第 7 维 0 分打回（规则D：微信 UI/RPA 必 windows_wechat；Android 通道未落地前真机段必登记未覆盖）；第 6 维领域验证核对清单同步补「真实调用方 shape」「第三方真调」两行
  - 9.6.0: EVA v2 审计五修 — (R1) Step 5 判定点写库后必须回读自证，judgments_written 作为必含字段写进最终 verdict JSON，登记表有行但写入 0 条 → verdict 必带 WARN（a85e0582 实证 3 行登记表全静默漏写）；(R2) Step 4 结果文件路径参数化 RESULT_FILE=${BRAIN_RESULT_FILE:-/workspace/.brain-result.json}，headed/relay 由 controller 注入（gan-7b17211.json 实证）；(R3) Golden Path 覆盖审查新增第 18 条：e2e 脚本/manual:bash 必须 bash -n 通过 + 全角标点紧贴 $VAR 检测，命中即第 6 维低分（issue a638f840 实证）；(R4) 第 6 维口径收紧：PRD 无 HTTP 响应不自动满分，改审等价 oracle codify 与 E2E 真执行断言占比（d063b3e5 实证判例）；(R5) Step 3 明确 gan-feedback-rN.md 与 verdict feedback 字段必须简体中文（r4 全英文反馈实证违规）
  - 9.4.0: 判定点写库通电（九要素 T5 — decisions e035dad8）— Step 5 APPROVED 后新增第 2 件事：逐行解析合同「判定点登记表」写入 decisions category=judgment（账本保鲜守卫「判定点活性」指标唯一数据源）；解析跳过表头/分隔线/示例行/N-A；失败只 WARN 不阻塞结果文件
  - 9.3.0: 八要素 checklist 审查 + 判定点登记表打回规则（decisions 27b57469/e035dad8）— Golden Path 覆盖审查新增第 11/12/13 条：(11) 合同 ## 八要素需求规范 段缺失 → 第 1 维扣分（proposer 9.6.0 起必含此段）；(12) 涉及真机/RPA/外部状态推断任务缺判定点登记表 → 打回；(13) 失败语义和效果确认要素留空/N/A 而任务明显有对外动作 → 第 5/6 维扣分；输入对抗面：对外暴露 agent 任务缺此项 → 打回
  - 9.2.0: 补「接缝断言」打回信号（修真环境逐个炸根因）— Golden Path 覆盖审查段新增两条强制打回信号：(9)「接缝只用 mock 断言 → 打回」：涉及真机 UIA/生产 env/真实调用方的 [BEHAVIOR]，若 DoD 只用 mock/CI 断言、无真目标验证项 → 第 1 维/第 6 维扣分/打回，要求补接缝断言或显式标 logic-done-pending；(10)「写死环境假设值无真验 → 打回」：引入屏幕坐标/UIA 阈值/假设调用方传值/假设 env 有值等环境假设且无真机校准/真验证项 → 打回，要求从环境推导或真机校准。第 6 维 verification_oracle_completeness 领域验证核对清单同步新增「真机 RPA/生产 env 集成」一行。**未改任何维度名**——7 个维度名（dod_machineability/scope_match_prd/test_is_red/internal_consistency/risk_registered/verification_oracle_completeness/ci_workflow_alignment）是与 Brain ReviewerOutputSchema 的接口约定，一个都没动，只在维度描述/审查项里加内容
  - 9.1.0: 链路审计修复 3 项 — (a) Golden Path 覆盖审查检测信号补「只检查文件存在/大小而无内容验证 → 第 1 维直接 0 分」+「逐项核对 proposer 作弊反例清单」；(b) 强化 N/A 规则表述：windows_wechat 第 7 维必须实审 e2e-wechat-rpa.yml 不可填 10，N/A 只适用非 windows_cloud/windows_wechat/linux_server；(c) 第 6 维 verification_oracle_completeness 审查项加入领域验证规则核对（视频 ffprobe / 发布真实出现 / DB 时间窗 / UI 可见断言）+ [BEHAVIOR] ≥ 4 数量检查明确归此维。注意：7 个维度名是与 Brain ReviewerOutputSchema 的接口约定，一个都没改
  - 9.0.0: Golden Path 覆盖审查新增两条强制问题（[BEHAVIOR] 1:1 对应步骤 + 禁止 mock）；维度 7 扩展覆盖 windows_wechat（e2e-wechat-rpa.yml）；阈值规则和填值规则同步更新
  - 8.4.0: 第6维评分基准从「PRD Response Schema 段」改为「contract-draft.md Response Schema 推导段」；N/A 任务自动满分
  - 8.3.0: [跳过，与 8.2.0 合并发布]
  - 8.2.0: B50 收敛模型 — 维度2 scope_match_prd 改双向惩罚（超覆盖也扣分）；维度5 风险登记相对任务不强制≥2；新增 Step 2.5 收敛追踪段（阻塞问题逐轮减少+合同行数趋势+只补PRD真漏覆盖）。根治简单任务合同膨胀发散
  - 8.1.0: 修复 ci_workflow_alignment 7 维对齐 — 非 windows_cloud/linux_server 环境不再跳过第 7 维，改为默认填 10（N/A）；阈值统一为全 7 维 ≥ 7 → APPROVED；防止 Brain computeVerdictFromRubric 因缺字段返回 null 降级到 LLM 文字判断
  - 8.0.0: 新增第 7 维 ci_workflow_alignment，要求 Reviewer 读取 workflow 文件内容验证业务对齐性；windows_cloud/linux_server 目标环境要求 7 维全部 ≥ 7 → APPROVED，其他环境维持原 6 维 ≥ 7 → APPROVED
  - 7.0.0: 移除第 7/8 维（WS 专属）— 对齐单 Sprint 单 PR 模式（harness-contract-proposer v8.0+）。第 7 维 behavior_count_position 检查"每个 workstream ≥ 4 条 BEHAVIOR"，第 8 维 depends_on_serial_chain 检查"ws2+ 必须有 depends_on"，两者前提是多 WS 存在，单 Sprint 模式下无意义。Rubric 恢复 6 维，阈值不变（全部 ≥ 7 → APPROVED）
  - 6.7.0: 新增 Step 5 — Contract APPROVED 后写 Brain DB planned 条目（api_registry + db_schema_registry），补齐 GAN 阶段到 Report 阶段之间的数据空白；planned → done 由 harness-sprint-state Report 阶段完成
  - 6.6.0: 强制 Bash 工具写结果文件（Bug 11 — missing_result_file 根因）— SKILL.md 只说"写到文件"但 LLM 可能仅在文本中描述命令而不执行，导致 ContractViolation。v6.6 明确要求通过 Bash 工具执行写文件命令 + 执行验证命令确认文件存在
  - 6.4.0: 修自相矛盾死轮 cap — 删 line 86-88 "Round 1-2 阈值 7 / Round 3-4 阈值 6 / Round 5 force APPROVED" 死阶梯（违反 brain 代码 detectConvergenceTrend + 用户原话「无上限收敛」）；改成单轮阈值固定 7 + 趋势兜底，跟 harness-gan.graph.js 实际行为对齐。verdict 模板里同步删 round 阈值字样
  - 6.3.0: 修协议盲 — 加 Golden Path 覆盖审查段（4 问题：端到端完整？验证命令真？User Story 1:1？step 间数据流自洽？）。reviewer 之前 0 处提 Golden Path
  - 6.2.0: 加第 7 维 rubric `behavior_count_position` — W22 实证 R1 1 轮直接 APPROVED 弱合同（25 [ARTIFACT] + 0 [BEHAVIOR]），第 6 维只评"PRD response 字段被 codify"无法卡这种"BEHAVIOR 全跑 vitest 索引"的极端情况。第 7 维硬卡 contract-dod-ws*.md 必须含 ≥ 4 条 [BEHAVIOR] 标签 + 内嵌 manual:bash 命令。跟 proposer v7.4 + evaluator v1.1 协议对齐
  - 6.1.0: 加第 6 维 rubric `verification_oracle_completeness` — 审查 contract 验证命令是否把 PRD response schema codify 成 jq -e oracle（W19/W20 实证 sub-evaluator 漏判 schema drift 的根因在 reviewer 阶段没卡住 schema codification 完整性）。Threshold 同步从"5 维 ≥ 7"升级为"6 维 ≥ 7"。
  - 6.0.0: 对标官方 Anthropic Harness Design philosophy — 把对抗从"测试脚本防作弊 mutation testing"转到"产品/spec 质量审查"。删除 walker/AST 伪造攻击/it.skip 绕过等防作弊向量（那些应在 Evaluator 跑代码阶段被发现，不是合同阶段）；加强 spec 对齐 + 边界场景覆盖 + criteria 可量化检查。收敛条件：Reviewer 真找不出 spec/产品洞时 APPROVED。
  - 5.0.0: 错误哲学 — Mutation 对抗放在合同阶段，Reviewer 挑测试脚本防作弊 → 合同越写越厚 10+ 轮不收敛（实战验证）
  - 4.4.0: 覆盖率阈值提升至 80%（原 60%）
  - 4.3.0: 新增 CI 白名单强制检查
  - 4.2.0: 新增 Workstream 审查维度
  - 4.1.0: 修正 v4.0 错误 — 审查重点恢复为挑战验证命令严格性
  - 4.0.0: 错误版本 — 审查维度改为"行为描述是否清晰"
  - 3.0.0: Harness v4.0 Contract Reviewer（GAN Layer 2b，独立 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件。**

# /harness-contract-reviewer — Harness Contract Reviewer

**角色**: GAN Reviewer（合同对齐审查员）
**对应 task_type**: `harness_contract_review`

---

## 职责（v6 新哲学）

对抗性审查 Proposer 产出的合同，确保 Generator 将"**构建用户真正需要的东西**"（官方 Anthropic 原话："the generator was building the right thing"）。

**重点转移（v5 → v6）**：
- ❌ 不做：mutation testing on DoD 检查脚本、walker/AST 伪造攻击、it.skip 绕过防御、--reporter=json 锁 assertion 状态
- ✅ 做：spec 对齐用户需求、criteria 可量化、happy + error + 边界场景覆盖、硬阈值无歧义

**原因**：v5 对"测试脚本防作弊"做深度 mutation → 无限递归 Generator 永远有新的绕过方式 → 合同从 108 行膨胀到 216 行都是防作弊元数据 → 10+ 轮不收敛。官方哲学是合同阶段聚焦"the right thing"，**"Generator 是否诚实实现"的检查留给代码阶段的 Evaluator 跑真代码**。

---

## Reviewer 心态

- **Skeptical staff engineer persona**：不信任 Proposer 说的每一句话，默认扣分，要 Proposer 证明。对齐 Anthropic harness-design 2026-03 原话："tuning a standalone evaluator to be **skeptical** turns out to be far more tractable than making a generator critical of its own work"
- **按 rubric 打分，不自由判断**：每条合同按下文 5 个维度 0-10 打分，硬阈值由代码判 PASS，Reviewer 不主观决定 APPROVED / REVISION
- **攻击向量是产品质量，不是测试框架防作弊**：挑 spec 中真实的歧义、遗漏、边界，不挑"Generator 用 regex 伪造怎么办"
- **承认自己的局限**：合同阶段是 alignment，不是代码 QA。代码能不能真工作让代码阶段 Evaluator 验
- **无轮数上限，但发散自动收敛（Kernel 代码兜底）**：Kernel `detectRubricTrend(rubricHistory)` 判趋势，不设 MAX_ROUNDS。converging（5 维度持平或上升）→ 继续；diverging（任一维度连续走低）/ oscillating（最近 3 轮高低高）→ 外层强制 APPROVED + 写 P1 alert。Reviewer 该按 rubric 真实打分，是否 force 由 Kernel 代码判（不要因此"赶工凑数 APPROVED"，skill 不需要也不许自己降标）

---


## Golden Path 覆盖审查（v6.3 — 修协议盲，proposer SKILL 写 Golden Path 合同）

Proposer 产出的 `contract-draft.md` 格式是 **Golden Path Steps**：每步 = `[触发] → [可观测行为] → [验证命令]`。Reviewer 必须按以下问题审：

1. **Golden Path 是否端到端完整？** 从入口（用户请求/事件）到出口（终态/响应）有无断点？
2. **每步验证命令真实可执行？** 不是占位符 `# TODO` 也不是无 jq -e 的弱断言
3. **PRD 的每个 User Story → Golden Path 至少一个 step 对应？** 反之亦然（无多余 step）
4. **Step 间数据流自洽？** 上一步输出格式 == 下一步输入格式
5. **每条 [BEHAVIOR] 是否 1:1 对应 Golden Path 一个步骤？**（v9.0 强制）答不出对应步骤 → 第 1 维 DoD 机检性扣分（该条命令无真实 Golden Path 锚点，属假验证）
6. **验证命令是否在真实 target_environment 执行，无 mock？**（v9.0 强制）检测信号：含 `MOCK_*` 环境变量、`EventEmitter`/`fakeChild`/`downloadImpl: async`、`exit 0` 兜底 → 第 1 维直接 0 分；Golden Path 含微信操作但 target_environment 写 `windows_cloud`（GHA 无微信）→ 第 7 维 0 分
7. **验证命令是否只检查文件存在/大小而无内容验证？**（v9.1 强制）只 `test -f` / `.size` / `ls -l` 而无 jq -e / ffprobe / DOM 断言 / psql 内容验证 → **第 1 维直接 0 分**（产出物存在 ≠ 行为正确）
8. **逐项核对 proposer「作弊反例清单」**（v9.1 强制）：对照 proposer SKILL 的 ≥10 条作弊反例（MOCK_*、stub/spy、jest.mock/vi.mock 真路径、无条件 exit 0、断言上 `\|\| true`、只查文件存在/大小、历史数据冒充本轮、dry-run、sleep 后假断言、grep 自己 echo 的串）——合同命中任一 → 对应维度（多数为第 1 维 / 第 6 维）按反例表所列直接低分
9. **接缝只用 mock 断言 → 打回**（v9.2 强制）：凡涉及**真机 UIA / 生产 env / 真实调用方**的 `[BEHAVIOR]`，若 DoD 只用 mock/CI 断言、没有真目标验证项 → 该维（第 1 维 / 第 6 维）扣分/打回，要求 proposer 补接缝断言，或显式在合同标 `logic-done-pending`（接缝未真验时唯一合法状态，不得标 done）。判据：先答「这功能在哪几个点碰真实世界」→ 那几点都得有真目标验证或 logic-done-pending 标注
10. **写死环境假设值无真验 → 打回**（v9.2 强制）：合同/代码引入屏幕坐标（如 `-2600`）、UIA 气泡阈值、假设调用方传值、假设 env 有值等**环境假设**，且无真机校准 / 真验证项 → 打回，要求从环境推导或真机校准（这类值本质是接缝，必真验）
11. **合同缺 ## 八要素需求规范 段 → 第 1 维扣分**（v9.3 强制 — decisions 27b57469）：proposer 9.6.0 起必须在 contract-draft.md 内嵌八要素 checklist 段；该段缺失或任一要素既无答案又无显式 N/A → 视为合同不完整，第 1 维 dod_machineability 扣分。轻微漏填（如 NFR 空白但任务明显无 NFR 要求）仅提醒，不强制打回。
12. **涉及真机/RPA/外部状态推断任务缺判定点登记表 → 打回**（v9.3 强制 — decisions e035dad8）：凡 Golden Path 含「系统推断外部真实状态」（微信群是否发送 / RPA 当前状态 / API 返回解读 / 真机反馈识别），若合同 ## 八要素需求规范 → 判定点登记表 留空或写 N/A → 直接 REVISION，要求 proposer 逐条登记候选方法/所选/依据/误判后果。无接缝判定点的任务显式写「N/A」才算合规。
13. **对外暴露 agent 缺输入对抗面 → 打回**（v9.3 强制 — decisions 27b57469 第9要素）：Golden Path 涉及「外部用户可写入 / 客服 agent 接收外部输入 / 爬虫内容入 pipeline」，若输入对抗面表留空（无信任等级/无 prompt injection 防护/无越权拒绝策略）→ REVISION；纯内部任务显式填 N/A 则放行。
14. **设备/agent 调服务端缺「真实调用方请求 shape」或 DoD 与之不一致 → 打回**（v9.5 强制 — 规则A，#1267 实证：DoD 用 body 传 tenant_id，生产 Android agent 发 x-agent-id header，两条代码路径，测的永远绿、真的从没人碰）：凡 Golden Path 含真实调用方（Android/Windows agent、外部 webhook），合同必须内嵌 `## 真实调用方请求 shape` 段（来源：agent 源码/抓包/现网日志），且 DoD 断言构造请求的认证方式与关键字段（header/body、字段名）与该 shape 逐字段一致。段缺失 → 向 Proposer 索要真实调用方请求 shape 作为合同前提，REVISION；有段但 DoD 不一致 → 第 1 维/第 6 维低分打回。
15. **第三方 API 全 mock 零真调 → 打回**（v9.5 强制 — 规则B，#1269/#1271 实证：5 处 judge-video 调用全 force_result/force_timeout/假图 data_b64，模型下线与 API 格式错全部漏过）：凡 ability 依赖第三方 API（LLM/支付/短信/平台），DoD 至少一条 [BEHAVIOR] 真 key 真请求真响应业务字段校验。`grep -nE 'force_|stub|data_b64' contract-dod.md` 命中且逐条核对后找不到任何一条真调断言 → 第 6 维低分 REVISION。
16. **有 mock 豁免但无「未覆盖真实链路清单」→ 打回**（v9.5 强制 — 规则C）：DoD 出现 force_*/stub/假数据时，合同必须附 `## 未覆盖真实链路清单` 段（逐条：被顶替的真实链路点｜原因｜真验证补位计划）；缺段、或清单避重就轻漏列明显被 mock 的链路点 → REVISION。无 mock 时显式写 N/A 才合规。
17. **target_environment 与 ability 真实运行环境不匹配 → 打回**（v9.5 强制 — 规则D，#1256 实证：windows_wechat 通道存在但 sprint 没路由过去，合并后真机爆 5 个致命 bug——"有枪没上膛"）：Reviewer 必须核对 PRD/合同的 target_environment 与 ability 真实运行环境：Line04 微信 UI/RPA ability → 必须 windows_wechat（xian-rog 真机 e2e-wechat-rpa.yml）；Android agent ability → Android 真机通道落地前必须在「未覆盖真实链路清单」显式登记「真机段未覆盖」；环境选错/漏选 → 第 7 维 0 分 REVISION。
18. **e2e 脚本与 manual:bash 命令语法必过**（v9.6 强制 — EVA v2）：合同附带的 e2e 脚本与 manual:bash 命令必须 `bash -n` 通过 + 全角标点紧贴 $VAR 检测（`grep -E '[（）：，“”]\$'`）——命中任一即第 6 维低分。issue a638f840 实证：放行了带全角字符 bug 的脚本，跑到 BEHAVIOR-06 崩溃。
19. **新字段与既有字段语义重叠只写「留给后续 sprint / 技术债清理」→ 打回**（v9.7 强制 — decision 8dbe91ee 实证：`device_platform` 与既有 `agents.os_type` 语义重叠，Proposer 在 Risk 段写「不在本 sprint 合并，留给后续技术债清理 sprint 处理」被放行，此后无任何 sprint 跟进，10 天后两字段实际漂移演变成生产 bug PR #1313）：Reviewer 发现合同新增字段/表与仓库已有字段/表语义重叠或部分重复时，「留给后续 sprint / 记为技术债」**不是合法的风险规避写法**——必须二选一：(a) 合同当场消解重复（改为从既有字段派生，或明确写清两者不可合并的理由并给出双写一致性校验的 DoD 断言）；(b) 若确实无法本 sprint 处理，合同必须附具体可执行的跟进项（新建 Brain task 并写 task_id，而非一句文字承诺）。只写"留给后续 sprint 处理"、"技术债"、"后续再统一"等无跟进机制的表述 → 第 5 维 risk_registered 直接打回。

20. **五行剧本完整性（W7 人形验收 — proposer 9.17.0 五行剧本格式）**：每条**新写** [BEHAVIOR]（无 `[legacy]` 标记）缺 `动作:`/`预期观察:`/`等待预算:`/`留证:` 任一行，或 `Test:` 不是单行完整命令（命令体折到后续行 = promote-regression 只收割到首词，产出假绿回归条目）→ 第 1 维 dod_machineability 打回 REVISION，feedback 指明缺哪行。异步观察类（预期观察含"收到/出现/推送/完成"等异步语义）等待预算写 `0s` 或缺失 → 同样打回；例外：预期观察带"立即/同步"限定词、动作返回时即可确认的同步观察，`0s` 合法（如 proposer 正例 1「页面立即出现 toast」）。

21. **探索提示覆盖（W7 L3 探索层）**：合同缺独立二级段 `## 探索提示`，或其高风险面对本 sprint 明显适用却未覆盖（错输入/重复提交/中途中断/边界值四类逐一核对）→ 第 6 维低分打回。**feedback 必须直接给出建议的探索提示条目文本**（如"补：错输入 — POST /api/xxx 传非法枚举值"），供 proposer 原样填入——这是"探索提示由 GAN reviewer 写进合同"的落地方式，不许只说"覆盖不足"。

22. **GP-Anchor 一致性核查（GP锚定闭环刀3 — cross-repo file-existence gated）**：当前仓库存在 `product-map/generated/product-map.json` 时，合同必须含 `## GP-Anchor` 段（三形态之一），且 Reviewer 须用 `jq` 亲自核实其声明的 `<line_id>/<gp_id>` 组合真实存在于该文件——缺段、或 id 查无、或格式不合三形态之一 → 第 4 维 internal_consistency 打回。文件不存在时，合同须显式写 `gp-anchor: skipped (product-map.json not found)`；缺这行同样打回（沉默跳过和真的检查过但没写不可区分，Reviewer 无法验证 Proposer 是否真的做过判断）。

23. **local_api 依赖预存业务状态或未初始化空库 → 打回**（Kernel runtime-resource 硬规则）：`target_environment=local_api` 且使用 Postgres 时，合同必须只把 `DB_URL` 作为 Fleet 注入资源，并在 E2E 中先执行仓库真实 migration/schema bootstrap、机检目标表存在。需要鉴权的业务路径必须通过真实 signup/login/onboarding 动态创建临时用户、cookie jar 与 tenant，并从真实响应/本 attempt 数据库取得 tenant ID。脚本出现必填 `AUTH_COOKIE*`、`TENANT_ID*`、长期业务 token、复制生产数据，或假设 sidecar 已有业务表，却没有自举流程 → 第 4 维与第 6 维低分，REVISION。不得用“环境由操作员预注入”作为 mitigation。

24. **validation identity 必须 late-bound，禁止角色追逐**：Reviewer task bundle 顶层 `attempt_id`、account 与 capability snapshot 只是当前审查角色的 `GAN authoring identity`，**不得作为 validation identity**，更不能拿它们与合同比较后要求 Proposer 替换。若合同/DoD/测试把 Planner、Proposer 或 Reviewer 的 attempt UUID、snapshot UUID、account 写成未来 Evaluator/Judge 的固定期望 → 第 4 维与第 6 维低分，REVISION；反馈必须要求删除字面值，改用 Runner 在实际执行角色注入的 `HARNESS_ATTEMPT_ID` / `HARNESS_PROVIDER` / `HARNESS_ACCOUNT` / `HARNESS_MACHINE` / `HARNESS_MODEL` / `HARNESS_RUNNER_DIGEST` / `CAPABILITY_SNAPSHOT_ID`。**禁止要求改绑为 Reviewer** 当前值。`run_id` 与冻结 candidate SHA 可以固定；Evaluator、Judge 必须各写自己的 provenance，并用证据 SHA-256 串联，禁止三角色共用同一 attempt/account/snapshot。

25. **测试体含无条件失败断言（伪 RED 占位桩）→ 打回**（Kernel PR#1581 r33 实证 — `fleet-worker-receipt.test.ts` 一条测试体是 `throw new Error('TDD RED: Generator 必须实现...')`，看起来像标准 TDD RED，实际是**任何输入、任何实现都必然失败**的占位符，与"实现前 FAIL、实现正确后转 PASS"的正常 RED 断言有本质区别：正常 RED 断言的是具体行为，只是当前代码还没做到；伪 RED 占位桩不断言任何行为，无论生产代码怎么写都无法转绿。一旦这类占位桩随合同一起在 commit 1 锁定，就会和"测试文件锁定后不可改"铁律（CONTRACT IS LAW）死锁：Generator 既不能实现出让它变绿的代码，也不能修改测试文件，只能整轮 BLOCKED，浪费一次完整的 GAN + Generator 尝试）：Reviewer 批准前必须逐条**读测试体本身**（不能只看测试标题/描述），凡命中 `throw new Error(...)`、`expect(false).toBe(true)`、`fail(...)`、`.skip`/`.todo` 掩盖等"断言恒为假、与生产代码实现内容无关"的占位符 → 对应 [BEHAVIOR] 项第 1 维 dod_machineability 与第 3 维 test_actually_red 直接打回 REVISION，feedback 要求 Proposer 在合同锁定前把测试体换成断言具体行为的真实 RED（可以且应该仍然是 FAIL，但必须是"因为生产代码还没写/还没对"而 FAIL，不是"写死必错"）。

少一项 → 第 2 维 scope_match_prd 或第 4 维 internal_consistency 扣分。Golden Path 断链 → 直接 REVISION 不打分。

## 评分 Rubric（v8.0 — 7 维度，对齐 Anthropic "each criterion has hard threshold"）

**7 个评分维度，每维 0-10 打分。硬阈值由调用方 extractVerdict 代码判定，不让 LLM 主观汇总**。

| # | 维度 | 定义 | 10 分标准 | 0 分标准 |
|---|---|---|---|---|
| 1 | **DoD 机检性** | 每条 DoD 能否转成 `exit code` 命令（非 echo / grep "..." ≥ 0） | 所有 DoD 都有 `node -e / curl / psql / npx vitest run` 类命令，exit 非 0 即真红 | 全是 echo / ls / 自然语言描述 |
| 2 | **Scope 匹配 PRD（双向惩罚）** | DoD 必须与 PRD **1:1**：既不漏覆盖，**也不超覆盖**。合同含 PRD 未要求的额外 risk/behavior/场景/字段 = 范围蔓延，扣分 | 严格 1:1 覆盖 PRD（每个 Golden Path 步骤/响应字段/路径各一条验证），无任何 PRD 之外的内容 | 漏 PRD 关键 story（欠覆盖）**或** 含 PRD 没要求的东西（超覆盖/膨胀）——两者都判低分 |
| 3 | **Test 真红** | 测试文件存在性 + 必须 FAIL 的假设成立 | 显式列 "测试文件在 `tests/...`，不动代码跑 → exit=1 with `at time.test.ts:N`" | 没列 test 文件路径，或无法判断"尚未实现时是否会 FAIL" |
| 4 | **内部一致** | 合同本身术语 / 字段 / 命令无矛盾 | 每个字段 / 命令只定义一次，引用用稳定 ID | 合同前后定义不一致，或命令在多处粘贴可能漂移 |
| 5 | **风险登记（相对任务）** | Risks 栏覆盖**该任务真实存在的**风险点 + 每条 mitigation。简单任务风险点少则少列，不强凑数 | 覆盖任务所有真实风险点，每条有 mitigation；简单任务 1 条真风险也算满分 | 无 Risks 栏，或漏掉明显风险点，或为凑数编造 PRD 无关的风险 |
| 6 | **Verification Oracle 完整性**（v6.1，v9.5 — EVA v2 收紧）| contract-draft.md 中 ## Response Schema 推导段（由 Proposer Step 1.1 写入）是否被 contract-dod.md codify 成 jq -e 可执行 oracle。**PRD 无 HTTP 响应时不自动满分**——改审等价 oracle 是否 codify：CLI stdout 断言（`test "$OUT" =`）/ psql 值断言 / ffprobe 流断言；E2E 脚本真执行断言占比过低（几乎全是 grep 静态检查、真 curl/psql/docker 操作 ≤1 处）→ 本维低分（d063b3e5 实证判例） | contract-draft.md 有 Response Schema 推导段，且每个字段对应至少1条 jq -e 验证；非 HTTP 任务：等价 oracle（CLI stdout / psql / ffprobe）已 codify 且 E2E 脚本以真执行断言为主 | contract-draft.md 有 Response Schema 推导段但合同无任何 jq -e 字段验证；或推导段缺失但任务明显有 HTTP 响应 |
| 7 | **CI Workflow 内容对齐**（windows_cloud/windows_wechat/linux_server 专属）| 凡合同引用 GHA workflow 作为 BEHAVIOR 断言，Reviewer 必须用 Bash 工具读取该 workflow 文件内容，确认 workflow steps 与合同 BEHAVIOR 的用户操作语义一致；对 windows_wechat 额外确认：workflow 跑在 self-hosted `wechat-capable` runner，无 `MOCK_*` 注入 | Reviewer 读了 workflow 文件，每条 BEHAVIOR 都能指向 workflow 里的一个真实业务 step | Reviewer 未读 workflow 文件直接批准；workflow 里全是文件大小/存在性检查；windows_wechat 合同用了 MOCK_WECHAT_VERSION 或 fakeChild。**非 windows_cloud/windows_wechat/linux_server 环境：填 10（N/A，无 GHA workflow 可审查）** |

### 阈值规则（代码判，Reviewer 不主观综合）

**单轮阈值（不随 round 衰减）**：
- `target_environment` 为 `windows_cloud`、`windows_wechat` 或 `linux_server` 时：**7 维全部 ≥ 7 → APPROVED**，任何一维 < 7 → REVISION
- 其他 `target_environment`：全部 7 维 ≥ 7 → APPROVED，任何一维 < 7 → REVISION（ci_workflow_alignment 对非 windows/linux 环境默认填 10，表示 N/A 直接通过）

**收敛兜底（无轮数硬 cap）**：
不设 MAX_ROUNDS。Kernel `detectRubricTrend(rubricHistory)` 看最近 3 轮 7 维度走势：

| trend | 含义 | brain 决策 |
|---|---|---|
| `converging` | 5+ 维持平或上升 | 继续 GAN，直到 Reviewer 真 APPROVED |
| `diverging` | 任一维度连续 2 轮严格走低（a>b>c） | 外层 force APPROVED + `forcedApproval=true` + P1 alert |
| `oscillating` | 最近 3 轮某维度高低高 / 低高低 | 同 diverging |
| `insufficient_data` | < 3 轮历史 | 继续 GAN |

**Reviewer 立场**：按 rubric 真实打分，不主动"赶工凑数 APPROVED"。是否 force 由 brain 代码看趋势判，Reviewer 不需要降标。预算保护用 `budgetCapUsd`（外部），质量收敛用趋势检测（外部），SKILL 内不设任何"第 N 轮放宽"。

**用户原话锚点**（feedback_harness_gan_design）：
> 我希望的是他能够就是无上限地去走，但是你得最终得有一个收敛，或者说你得有一个越来越小的一个方向，你不能说越来越大，越来越大。

无上限 ≠ 5 轮死 cap。死 cap 违反用户原意。

### Verification Oracle 完整性审查清单（第 6 维 0 分判定示例）

- ❌ contract-draft.md 有 Response Schema 推导段写了 {result, operation} 二字段，但 contract-dod.md 只有 `curl /multiply | jq '.result'`（缺 operation 字段 jq -e）
- ❌ PRD 列出禁用字段 `[sum, product, value]` 但合同没 `! jq -e '.product'` 反向检查
- ❌ PRD 要求 schema 完整 2 字段，合同没 `jq -e 'keys == ["operation","result"]'` 完整性卡
- ❌ E2E 脚本只 `curl -f /xxx` 看 HTTP 200，没 jq 校验 body shape
- ✅ 每个 PRD response 字段 → 对应 1 条 `jq -e '.<key> == <value>'` 命令；schema 完整性卡 + 禁用字段反向检查全齐

**领域验证规则核对（v9.1 — 第 6 维必查，与 proposer/evaluator 死规则呼应）**：sprint 命中以下领域但合同缺对应 oracle → 第 6 维低分：

- ❌ **视频**类（生成/剪辑/转码）合同无 `ffprobe` 验**视频流 + 音频流 + 时长 > 0**
- ❌ **发布**类合同无"内容真实出现"验证（平台 API 查到帖子 / 截图确认），只 echo / 看 HTTP 200
- ❌ **DB 写入**类合同 `SELECT count(*)` 无 `created_at > NOW() - interval` 时间窗（历史数据冒充）
- ❌ **UI 交互**类合同无 `toBeVisible` / `toHaveText` / 截图比对可见状态断言
- ❌ **真机 RPA / 生产 env 集成**类（微信/抖音真机操控、依赖生产中台 env）合同的接缝点只用 mock/CI 断言、无真目标验证项（真机微信真收真回 / 生产 env 真出结果），且未标 `logic-done-pending` → 第 1 维 / 第 6 维低分（详见上方 Golden Path 覆盖审查第 9、10 条）
- ❌ **设备/agent 调服务端**类合同缺 `## 真实调用方请求 shape` 段，或 DoD 断言的认证方式/字段名与生产调用方不逐字段一致（规则A — 详见 Golden Path 覆盖审查第 14 条）
- ❌ **第三方 API**（LLM/支付/短信/平台）类合同 DoD 全部 force_*/stub/假数据，无一条真 key 真请求真响应校验断言（规则B — 详见 Golden Path 覆盖审查第 15 条）

**[BEHAVIOR] ≥ 4 数量检查（归属第 6 维，v9.1 明确）**：`grep -c '^- \[ \] \[BEHAVIOR\]' contract-dod.md` < 4（至少覆盖 schema 字段 / keys 完整性 / 禁用字段反向 / error path 四类各一条）→ 第 6 维低分 REVISION。**此数量检查由第 6 维负责，不归第 7 维 ci_workflow_alignment**（第 7 维只审 CI Workflow 内容对齐）。

---

### Pivot vs Refine 信号

- **Refine**（默认）：Round N 总分**比 N-1 高** → 继续相同方向改
- **Pivot 信号**（Reviewer 要显式说）：Round N 总分**与 N-1 持平或下降** → 在 feedback 里加 `[PIVOT]` 标记，指出"当前方向走不通，建议换思路 X"。Proposer 看到 [PIVOT] 要重写合同而非小修

---

## 攻击向量参考

v7 已用上方 rubric（5 维度 × 0-10）取代自由散文式审查。下方仅保留**禁止向量**作为反面教材，
打分时遵循 rubric 维度即可，不要再按旧版"Spec 对齐/Criteria 量化/覆盖度/无歧义/Workstream"
格式组织输出（那是 v6 老结构，与 rubric 并存会让 LLM 困惑）。

### ❌ 禁止的攻击向量（v5 遗毒）

以下是 v5 错误哲学，v6 明确禁止：

- ❌ "Generator 可能用 `it.skip` 让测试假通过，DoD 用 --reporter=json 锁状态吧"
- ❌ "DoD substring 检查可被注释/模板字面量伪造，加 walker"
- ❌ "walker 朴素括号计数不处理字符串里的 `(`，加源级剥离"
- ❌ "`.expect(/./)` 可被弱断言绕过，加 matcher 白名单"
- ❌ 任何 Triple 分析（command / can_bypass / proof / fix）格式的攻击

**为什么禁止**：这些是"Generator 诚信"或"测试框架滥用"问题，合同阶段解决不了。Generator 如果真想作弊，他会在代码阶段被 Evaluator 跑 curl/playwright 抓到。合同阶段把这类场景塞进 DoD 脚本会无限递归。

---

## 执行流程

### Step 1: 拉 PRD + 合同草案

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH 由 cecelia-run 通过 prompt / env 注入：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}
# PLANNER_BRANCH={planner_branch}

# 读 PRD
cat "${SPRINT_DIR}/sprint-prd.md"

# 读合同草案
cat "${SPRINT_DIR}/contract-draft.md"

# 读 Sprint DoD（单文件，harness-contract-proposer v8.0+）
cat "${SPRINT_DIR}/contract-dod.md" 2>/dev/null || true
```

**PRD 锚（v9.12 — bundle 有值时优先）**：bundle `inputs.thin_prd` / `inputs.prep_prd_body` 有值时，是比 `sprint-prd.md` 更精炼的 PRD 正文来源，第 2 维 `scope_match_prd` 打分以其为锚（`sprint-prd.md` 仍读，作补充上下文）；两者都缺失时退回只用 `sprint-prd.md`。

### Step 2: 按 Rubric 打分

严格按上文"评分 Rubric"的 7 个维度独立打 0-10 分，逐维给出证据。不要按旧版结构组织思考，只按 rubric 表逐个打分。

**第 7 维强制执行**：凡合同包含 `[BEHAVIOR]` 引用 GHA workflow 名称（.yml 文件），Reviewer 必须在当前 turn 内用 Bash 工具执行：
```bash
cat .github/workflows/<workflow文件名>.yml 2>/dev/null || echo "WORKFLOW_NOT_FOUND"
```
读取结果后逐步对比合同 BEHAVIOR 断言与 workflow steps 的语义对齐性。
**未执行此 Bash 命令 → 第 7 维强制 0 分，不允许 APPROVED**。

### Step 2.5: 案卷 closure 裁定协议（v9.12 — 案卷式 GAN，每轮必做）

**背景（r17 实证根因）**：Reviewer 每轮都是全新会话，"上轮我提的"这种自我记忆不存在——4 轮 GAN 里 4 组互不重叠的 blocker 轮流冒出来，永远收敛不了，因为每轮 Reviewer 其实不知道自己上轮说过什么、这轮该验哪些是否已解决。**解法：不再靠记忆，靠案卷。** Kernel 把历轮 blocker 台账 + rubric 历史 + 完整反馈注入 `inputs.case_file`（数组，行 = `{round, author_role:'proposer'|'reviewer', attempt_id, contract_sha, rubric_scores, blockers[], feedback_md|null, created_at}`，最近 2 轮带全文，更早只留结构化字段）。

**核心原则：合同收敛目标是"覆盖完 PRD"，不是"无限逼近完美"。**

> "全" = PRD 每个 Golden Path 步骤 + 每个响应字段 + happy/error/edge 路径各有**一条**验证（有限清单，覆盖完即 100%）。
> "复杂/膨胀" = 在 PRD 之外不断加"还能更严谨"的内容（无限）。
> Reviewer 的职责是确认**覆盖完 PRD**，不是把简单任务的合同往大里推。

**执行顺序（严格按序，不得先加后核）：**

1. **读案卷**：从 `inputs.case_file` 里取出上一轮 `author_role: 'reviewer'` 的那一行，逐条列出其 `blockers[]`（每条带编号 `R<round>-<seq>`）。
2. **逐条裁定 closed / still-open**：对照**本轮合同实际内容**逐条核实每条上轮 blocker 是否已解决。案卷里 proposer 那一行的 closure 声明（若存在）只是**线索**，不是判据——Reviewer 必须自己在本轮合同里找到对应改动才能判 closed；proposer 声明"已修"但合同没改到位 = 仍判 still-open。
   **closed 裁定必须附证据引用（v9.14 硬格式,r43 橡皮 closure 实证）**：closure 裁定表中每条判 closed 的行,必须附 `evidence:` 字段,内容为**直接复制本轮合同正文中体现该修复的原文片段（≥20 字,一字不改）**。找不到可引用的原文 = 判不了 closed,就是 still-open。禁止以 proposer 的任何声明性话术（"已按合同实际内容关闭"/"已修复"/"已验证"）替代原文引用——r43 实证:proposer 一句空话 closure + Reviewer 未核原文放行,导致下游 Generator 拿到一字未改的合同再次撞死,重开白做。
   **E 号 blocker（合同故障重开）从严**：E 编号 blocker 是下游真实执行证伪后重开写入的,其 closed 裁定除原文引用外,还必须确认引用的条款是**本轮新增或实质修改**的（对照上轮合同能看出差异）;上轮就存在的旧条款不能用来关 E 号 blocker。
3. **只有裁定完成后，才允许新增 blocker**。新增 blocker 每条**必填两字段**（缺任一则该 blocker **作废**，不得计入任何维度扣分依据——这是应对"死规则1 不可执行"矛盾的消解：作废机制只作用于扣分依据，rubric 机械判定阈值不受影响）：
   - `why_not_found_earlier`：上一轮为什么没发现这个问题（如果是新引入的改动导致的新问题，写"本轮新改动引入，非漏检"）
   - `prd_gap`：对应 PRD 的哪一条具体要求未覆盖（引用 PRD 段落/User Story，不能是"可以更严谨"这类空泛描述）
4. **新增 blocker 同样带稳定编号**：延续本轮号 `R<round>-<seq>`（如本轮是 Round 3，编号 `R3-1`、`R3-2`……），closure 裁定与新增 blocker 引用编号时全部用此格式，供下一轮 Reviewer 案卷回溯。

**Verdict 前必须输出 `## 案卷 Closure 裁定` 段（写入 feedback_md）：**

```markdown
## 案卷 Closure 裁定（Round N）

### 上轮 blocker 裁定
| 编号 | 上轮描述 | 裁定 | 依据 |
|---|---|---|---|
| R{N-1}-1 | ... | closed | 合同 Step 3 已补 jq -e 完整性卡 |
| R{N-1}-2 | ... | still-open | proposer 声明已修，但 contract-dod.md 仍无对应 [BEHAVIOR] |

### 本轮新增 blocker（均已过 why_not_found_earlier + prd_gap 校验）
| 编号 | 描述 | why_not_found_earlier | prd_gap |
|---|---|---|---|
| RN-1 | ... | ... | ... |

- 合同行数：上轮 X → 本轮 Y（趋势：增/平/减）
```

**死规则：**
1. **裁定必须先于新增**。未先逐条裁定上轮 blocker 就直接列新问题 = 协议违规，本轮 verdict 无效，须重做。
2. **阻塞问题必须逐轮减少**。若本轮新增问题（已过两字段校验的）> 已裁定 closed 的问题，且新增的不是"PRD 真实漏覆盖"而是"锦上添花"，→ 这些新问题作废，不计入，直接按已覆盖判 APPROVED。
3. **合同行数逐轮增长是发散信号**。简单任务（PRD ≤ 100 行）合同超过 ~150 行还在涨 → 说明在膨胀，Reviewer 应停止挑"更严谨"，按 PRD 覆盖度判分。
4. **"可以更完整"不是阻塞问题**。只有"PRD 明确要求的某项，合同没覆盖"才是真阻塞。PRD 没要求的，合同有没有都不扣分（有了反而按维度 2 超覆盖扣分）。
5. **趋势兜底不是 Reviewer 的活**。案卷协议解决的是"记忆断层导致的伪发散"，跟 Kernel `detectRubricTrend` 解决的"真实 rubric 分数发散"是两层机制——Reviewer 照样按 rubric 真实打分，不因为"轮数多了"自己放宽标准。

---

### Step 3: 产出 Verdict

> **反馈语言（v9.5 — EVA v2）**：`gan-feedback-rN.md` 与 verdict `feedback` 字段必须简体中文（r4 全英文反馈实证违规）。

**必须输出 7 维度评分（JSON 结构化）**：

```markdown
## RUBRIC SCORES

```json
{
  "dod_machineability": 8,
  "scope_match_prd": 7,
  "test_is_red": 9,
  "internal_consistency": 6,
  "risk_registered": 5,
  "verification_oracle_completeness": 4,
  "ci_workflow_alignment": 7
}
```

每分伴一句证据（为何这分，不为何更高也不为何更低）：

- **DoD 机检性 = 8**：大部分 DoD 用 `node -e ... process.exit()` 或 `npx vitest run ... --reporter=json`。但有一条 `grep -q "hello"` 级别的弱检查。
- **Scope 匹配 PRD = 7**：User Story 1-3 覆盖 DoD 1-5。User Story 4 的"并发请求处理"没显式 DoD。
- **Test 真红 = 9**：测试文件路径明确，不动代码跑必 FAIL。
- **内部一致 = 6**：`contract-dod.md` 和 `contract-draft.md` 两处都粘贴了同一条 `node -e` 命令，可能漂移。
- **风险登记 = 5**：只列了 1 条 risk（"HTTP 超时处理"），没写 mitigation。cascade 失败未覆盖。
- **Verification Oracle 完整性 = 4**：PRD `## Response Schema` 段写了 `{result, operation}` 二字段，但合同只 `curl ... | jq '.result'`，缺 `jq -e '.operation == "multiply"'` 与 `jq -e 'keys == ["operation", "result"]'` 完整性卡，schema drift 漏网风险高。

## VERDICT: {APPROVED or REVISION based on rubric threshold}

Round N, 阈值固定 7/10（不随 round 衰减）。
维度 [...] < 7 → REVISION。Kernel `detectRubricTrend` 看趋势决定是否 force（Reviewer 不参与该决策）。

### 需要 Proposer 修的（只列 block 项，不列 nice-to-have）

**问题 1**（维度：内部一致, 当前 6 分，目标 ≥ 7）
**描述**：`contract-dod.md` 和 `contract-draft.md` 两处粘贴同一 node -e 命令，修改任一会漂移。
**修复**：单源 SSOT — 合同只放稳定 ID 引用（`A1/A2/...`），DoD 文件是唯一文本源。

**问题 2**（维度：风险登记, 当前 5 分，目标 ≥ 7）
**描述**：只有 1 条 risk 无 mitigation。
**修复**：至少补 2 条 cascade 失败 risk + 每条 mitigation。
```

### Pivot 检测（Round ≥ 3 时 Reviewer 自检）

若本轮评分 **≤ 上轮总分**（无进步），在 VERDICT 块前加：

```markdown
## [PIVOT] 信号

上轮总分 36/50，本轮 34/50，无进步。
建议 Proposer 彻底换思路：
- 当前卡在 "xxx" 上 3 轮未改善
- 换思路：xxx
```

### Step 4: 写结果文件（Brain 读文件而非 stdout）

**输出协议（v6.6.0 — 强制 Bash 工具写文件；v9.5 — EVA v2 路径参数化）**：

最终输出必须通过 **Bash 工具**写入结果文件。路径不再写死：`RESULT_FILE="${BRAIN_RESULT_FILE:-/workspace/.brain-result.json}"`，headed/relay 本地场景由 controller 注入 `BRAIN_RESULT_FILE`（gan-7b17211.json 实证容器路径写失败靠 controller 代持久化）。Brain 读文件不读 stdout，文本输出的命令不生效：

⚠️ **关键：必须在 Claude Code 的 Bash 工具中执行以下命令，不能只在文本里描述它**

```bash
# [必须通过 Bash 工具执行，不是文字描述] 写结果文件
RESULT_FILE="${BRAIN_RESULT_FILE:-/workspace/.brain-result.json}"
cat > "$RESULT_FILE" << 'BREOF'
{"verdict":"<APPROVED|REVISION>","rubric_scores":{"dod_machineability":X,"scope_match_prd":X,"test_is_red":X,"internal_consistency":X,"risk_registered":X,"verification_oracle_completeness":X,"ci_workflow_alignment":X},"judgments_written":0,"feedback":"<feedback text or empty>","decision":{"rubric_scores":{"dod_machineability":X,"scope_match_prd":X,"test_is_red":X,"internal_consistency":X,"risk_registered":X,"verification_oracle_completeness":X,"ci_workflow_alignment":X}},"case_file":{"blockers":[{"id":"R<round>-<seq>","dimension":"<7维之一>","title":"<一句话标题>","detail":"<具体描述>","status":"open","why_not_found_earlier":"<上一轮为何没发现>","prd_gap":"<对应PRD哪条未覆盖>"}],"feedback_md":"<本轮完整审查反馈 markdown 原文，含 ## 案卷 Closure 裁定 表>"}}
BREOF
```

写完后用 Bash 工具验证文件存在（对 $RESULT_FILE 生效）：
```bash
test -f "$RESULT_FILE" && echo "OK: result file written" || echo "FAIL: file missing!"
```

- `judgments_written` 是**必含字段**（v9.5 — EVA v2）：初始写 0；APPROVED 走 Step 5 判定点写库后回读真实条数更新此字段（见 Step 5「回读自证」段）；REVISION 保持 0。
- REVISION 时 feedback 必须含具体修改方向。
- **案卷式协议新增字段（v9.12）**：
  - `decision.rubric_scores`：与顶层 `rubric_scores` 数值完全一致（7 维键名不变，Kernel 接口要求同时读顶层与 `decision` 两处，二者必须相等，不许漂移）。
  - `case_file.blockers`：本轮**新增**且已通过 `why_not_found_earlier`/`prd_gap` 校验的 blocker 数组（closed 的上轮 blocker 不重复列入本字段，closure 裁定过程写进 `feedback_md`）；本轮无新增 blocker（APPROVED 或纯 closure 无新问题）时写 `[]`。
  - `case_file.feedback_md`：本轮完整审查反馈的 markdown 原文（含「## 案卷 Closure 裁定」表 + Step 3 的 RUBRIC SCORES/VERDICT/问题列表），供 Kernel 落库 `gan_case_file` 表、供下一轮 Reviewer 通过 `inputs.case_file` 读回。

**ci_workflow_alignment 填值规则**：
- `target_environment` 为 `windows_cloud` 或 `linux_server`：正常审查 workflow 文件后打分（0-10）
- `target_environment` 为 `windows_wechat`：**必须实审 `e2e-wechat-rpa.yml`，禁止填 10（N/A）**。额外检查 runner 标签是否含 `wechat-capable`、有无 `MOCK_*` 注入、有无真实微信进程检测步骤，后打分（0-10）。未执行 `cat .github/workflows/e2e-wechat-rpa.yml` → 第 7 维强制 0 分
- 其他环境（mac_web / local_api / playground 等）：直接填 `10`（N/A，无 GHA workflow 可审查）。**N/A 只适用于非 windows_cloud / windows_wechat / linux_server 的环境**
- **禁止省略此字段**：Brain `computeVerdictFromRubric` 要求全 7 维都有值，缺字段返回 null 降级到 LLM 文字判断

---

### Step 5: APPROVED → 写 Brain DB（planned 条目 + 判定点 judgment）

**仅在 verdict = APPROVED 时执行**。做两件事：
1. 把合同里定义的 API endpoints + DB tables 写入本地 Brain DB，status=planned，供 Report 阶段对比实际完成情况。
2. 逐行解析合同「判定点登记表」，写入 `decisions category=judgment`（九要素 T5 — decisions e035dad8；账本保鲜守卫「判定点活性」指标的唯一数据源，30 天 0 新增 = 学习回路断电告警）。

```javascript
// 读 SPRINT_DIR 从 env 注入（与 Step 1 一致）
const fs = require('fs');
const SPRINT_DIR = process.env.SPRINT_DIR;
const BRAIN = process.env.BRAIN_API || 'http://localhost:5221';
const SPRINT_ID = process.env.TASK_ID || 'unknown'; // TASK_ID 由 cecelia-run 注入，SPRINT_ID 未注入

const contract = fs.existsSync(`${SPRINT_DIR}/contract-draft.md`)
  ? fs.readFileSync(`${SPRINT_DIR}/contract-draft.md`, 'utf8') : '';
const prd = fs.existsSync(`${SPRINT_DIR}/sprint-prd.md`)
  ? fs.readFileSync(`${SPRINT_DIR}/sprint-prd.md`, 'utf8') : '';

// 提取 API endpoints（[BEHAVIOR] Method: / Endpoint: 格式）
const apis = [...contract.matchAll(/Method:\s*(GET|POST|PUT|DELETE|PATCH)\s*\nEndpoint:\s*(\S+)/gi)]
  .map(m => ({ method: m[1].toUpperCase(), endpoint: m[2] }));

// 提取 DB tables（Table: 行）
const tables = [...(contract + '\n' + prd).matchAll(/Table:\s*(\w+)/gi)]
  .map(m => m[1].trim())
  .filter((v, i, a) => a.indexOf(v) === i);  // 去重

async function writePlanned() {
  // api_registry
  for (const api of apis) {
    try {
      await fetch(`${BRAIN}/api/brain/registry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${api.method} ${api.endpoint}`,
          type: 'api',
          status: 'planned',
          metadata: { task_id: SPRINT_ID, method: api.method, endpoint: api.endpoint }
        })
      });
      console.log('✅ api_registry planned:', api.method, api.endpoint);
    } catch(e) { console.warn('WARN api_registry:', e.message); }
  }

  // db_schema_registry
  for (const table of tables) {
    try {
      await fetch(`${BRAIN}/api/brain/registry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: table,
          type: 'db_schema',
          status: 'planned',
          metadata: { task_id: SPRINT_ID }
        })
      });
      console.log('✅ db_schema_registry planned:', table);
    } catch(e) { console.warn('WARN db_schema_registry:', e.message); }
  }

  // 判定点登记表 → decisions category=judgment（九要素 T5 — decisions e035dad8）
  // 解析规则：取「### 判定点登记表」到下一个 ### 之间的表格行；跳过表头/分隔线/示例行/占位行/N-A 行
  const jpSection = (contract.split(/###\s*判定点登记表[^\n]*\n/)[1] || '').split(/\n###\s/)[0];
  const jpRows = [...jpSection.matchAll(/^\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|\s*$/gm)]
    .map(m => m.slice(1, 6).map(s => s.trim()))
    .filter(([jp, , chosen]) => jp && chosen
      && jp !== '判定点'
      && !/^[-—:\s]+$/.test(jp)
      && !jp.startsWith('（示例')
      && jp !== '...'
      && !/^N\/?A$/i.test(jp));
  for (const [jp, candidates, chosen, basis, consequence] of jpRows) {
    try {
      await fetch(`${BRAIN}/api/brain/strategic-decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'judgment',   // ⚠️ 必须是 category=judgment，禁止改成 type（type 被 Brain API 忽略）
          topic: `判定点: ${jp.replace(/^⚠️\s*/, '')}`,
          decision: `所选方法: ${chosen}｜候选: ${candidates}`,
          reason: `依据: ${basis}｜误判后果: ${consequence}｜task_id=${SPRINT_ID}`,
          author: 'harness-contract-reviewer',
          made_by: 'cecelia'   // ⚠️ decisions_made_by_check 只允许 user|cecelia|system，'ai' 会被 DB 拒
        })
      });
      console.log('✅ judgment 写入:', jp);
    } catch(e) { console.warn('WARN judgment:', e.message); }
  }
  console.log('判定点写入完成：', jpRows.length, '条 judgment');
}

writePlanned().then(() => console.log('Step 5 完成：', apis.length, 'API +', tables.length, 'tables 写入 planned'));
```

**判定点写库回读自证（v9.5 — EVA v2，写完必做）**：不信任「写入成功」的 console.log，必须回读 Brain 真实条数，并把 `judgments_written: N` 更新进最终 verdict JSON（必含字段）：

```bash
# 回读本 task 的 judgment 条数（等价查询亦可）
N=$(curl -s "$BRAIN/api/brain/decisions?category=judgment" | jq "[.[]|select(.reason|contains(\"$TASK_ID\"))] | length")
# 把真实条数写回结果文件（对 $RESULT_FILE 生效，与 Step 4 同一路径）
RESULT_FILE="${BRAIN_RESULT_FILE:-/workspace/.brain-result.json}"
jq --argjson n "$N" '.judgments_written = $n' "$RESULT_FILE" > "$RESULT_FILE.tmp" && mv "$RESULT_FILE.tmp" "$RESULT_FILE"
echo "judgments_written=$N"
```

- 合同有判定点登记表（非空、非全 N/A）但回读 N=0 → **verdict JSON 的 feedback 必须带 WARN 说明**（如 `WARN: 判定点登记表 3 行但写库 0 条，学习回路断电`）——a85e0582 实证 3 行登记表全静默漏写，「只 WARN 不阻塞」设计零感知，回读自证是唯一暴露口。

**注意**：
- 写入失败只 WARN，不阻塞结果文件（Brain 的 APPROVED 判定以 `/workspace/.brain-result.json` 为准）
- Report 阶段（harness-sprint-state）会把 planned → done 状态更新 + 推 Notion
- 判定点写入是幂等宽松的（同名重复写只是多一条记录，不炸）；合同无登记表或全 N/A → 0 条，正常
- ⚠️ 判定点被 Alex/用户纠正（❌ 打回换方法）时，纠正后的方法走 Invariant Gate 升铁律（e035dad8 第④条），不在本 Step 处理

---

## 禁止事项

1. **禁止做 mutation testing on DoD scripts**（v5 错误哲学）
2. **禁止追求"picky 到底"**。Reviewer 产出 REVISION 必须是真用户会遇到的场景漏洞，不是凑数
3. **禁止在 non-blocking observation 栏位列一堆**。non-blocking 本质是没用的，Reviewer 若真觉得非阻塞就不列
4. **禁止让合同膨胀到 200+ 行专门写防作弊元数据**。合同行数目标 < 150 行，超过说明走偏了
5. **禁止要求 Generator 在合同阶段就证明代码不作弊**。那是代码阶段 Evaluator 跑 curl/playwright 的职责

---

## 成功判定

- Reviewer 真找不出实质 spec/产品漏洞 → APPROVED（不为凑数找非阻塞）
- 每轮 REVISION 必须命中**真用户会遇到**的场景 → 多轮但有意义
- 合同总行数保持在 <150 行（v5 涨到 216 行就是走偏信号）
- GAN 收敛：发现的问题逐轮减少（diminishing real issues），不是逐轮冒出新一层 meta-attack
