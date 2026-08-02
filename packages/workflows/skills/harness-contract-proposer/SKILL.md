---
id: harness-contract-proposer-skill
description: |
  Harness Contract Proposer — Harness v5 GAN Layer 2a：
  读 PRD，GAN 对抗写 Golden Path 合同（每步含真实验证命令）；
  Reviewer APPROVED 后倒推拆 task-plan.json。
version: 9.19.1
created: 2026-04-08
updated: 2026-08-02
changelog:
  - 9.19.1: 修复 local_api 示例与硬规则自相矛盾——模板改为 DB_URL + 真实 migration + signup/login 双 cookie jar 自举，禁止直接 INSERT 业务身份；同时保留 android_realmachine 枚举，防止 SSOT 同步再次回退 Cecelia 9.17.1 补丁
  - 9.19.0: Kernel local_api 资源闭环——需要 Postgres 的合同只声明由 Fleet 注入的短期 DB_URL；E2E 必须先对空库运行仓库真实 migration/schema bootstrap，再启动应用；业务 cookie/session/tenant 必须由同一 E2E 通过真实 signup/login 动态创建并用临时 cookie jar 持有，禁止要求预注入 AUTH_COOKIE/TENANT_ID 或复制生产数据/长期业务凭据
  - 9.18.0: GP锚定闭环刀3——新增 Step 1.7「GP-Anchor 声明」，cross-repo file-existence gated（仅 product-map/generated/product-map.json 存在的仓库适用，其余跳过不阻塞）；合同须含 ## GP-Anchor 段，三形态声明与刀2 lint-gp-anchor.sh CI硬闸规范逐字一致，写前用jq核实id存在，让合同阶段就能发现"这个改动挂不上任何GP"而不是等CI最后一步才拦
  - 9.17.0: W7 人形验收（RD 2026-07-28，决策 d3021871）——三段式升级五行剧本：每条新写 [BEHAVIOR] 必含 动作/预期观察/等待预算/留证/Test: 五行；Test: 强制单行（长命令 bash -c 包裹，修 #149 多行验证命令被 promote-regression 收割成 cmd="bash" 隐患）；新增 ## 探索提示 合同段模板（L3 探索层输入，默认预算 10 分钟/15 动作）；接缝步骤（真机/异步/第三方）标 [接缝×2] 由 evaluator 重复执行判 FLAKY；补同步/异步正例各一 + 旧命令行长相/缺等待预算反例各一；legacy 标记条目继续豁免
  - 9.16.0: user_facing 预览闸硬规则：journey_type=user_facing 的 Golden Path 合同末尾必须含 ## staging 预览闸 段（步骤A落staging环境/步骤B Final-E2E在staging跑截图/步骤C Bark推主理人预览链接）；按 BASE_REPO 定模式：cecelia仓=通知式（Bark注明「24h无异议自动放行」，Brain PATCH promote_after时间戳）/zenithjoy仓=阻塞式（Bark注明需主理人放行，prod promote前核查decisions/approval字段，未放行禁promote）；其余journey_type（含autonomous/dev_pipeline/agent_remote）不受约束（零回归保护）
  - 9.15.0: gear 档位：新增 Step 3.1 HARNESS_GEAR=segmented 档位分支（移植自 cecelia #4027 harness-gear 一体化 60a80ddc 决策6），恢复 v7 前多 workstream task-plan.json schema（tasks[]/depends_on 线性链/estimated_minutes 20-60），段划分依据=Golden Path"后段依赖前段真机产物"接缝；default（缺省或非 segmented）保持单 ws1 现行为不变
  - 9.14.0: 三段式 [BEHAVIOR] 剧本格式升级——每条 BEHAVIOR 须含三段：①「动作」（操作步骤）②「预期观察」（用户/系统可见状态变化）③「验证命令」（可执行断言）；新增 until-loop 等待预算范式（within 预算轮询，如 within 60s 收到消息确认）；legacy 兼容标记（存量纯命令写法保留但标为 legacy，不强制迁移）；样例剧本：点设置 → within 60s 收到消息
  - 9.13.0: [BEHAVIOR] 格式加验证等级标记+锚定父路声明（决策145014a4 W3）——[BEHAVIOR] 条目格式新增 [L1|L2|L3] 标记（与 judge #4004 解析约定一致：behavior_tests[i].verification_level 字段，L1=替身/L2=服务端真验/L3=真机真验）；新增「锚定父路声明」硬规则：sprint GP 段首行必须写「覆盖父路 <golden_path名或id> 第 N-M 步」或「独立小路（无父路）」，禁留空
  - 9.12.0: 新增硬规则「禁 mock 被改的边」（刀2 — #3830 recovery钩子剪断/#3848 sprint_dir跨节点丢/#3808 状态振荡/#3840 PR池不幂等实证：接缝层 bug 全 mock 单测结构性抓不到）——本单改动涉及调度/状态机/跨模块数据传递/生命周期钩子/DB写路径之一时，合同 failing test 必须不 mock 被改的那条边（真 Postgres、真相邻模块，只许 mock 更外层无关依赖）；合同必须输出「## 禁 mock 边清单」小节逐条列禁 mock 的边，空清单须写明理由（仅纯UI/纯文档类允许）；自查 checklist 新增第 9 条
  - 9.10.0: 真实链路四硬规则（handoff 0714 刀2 — #1267/#1269/#1271/#1256 实证根因）— 规则A【真实调用方 shape】合同必含 ## 真实调用方请求 shape 段，DoD 认证方式/关键字段与生产调用方逐字段一致（禁 body 传 tenant_id 而生产走 x-agent-id header 的双路径分叉）；规则B【第三方真调一次】涉第三方 API 的 DoD 至少一条真 key 真请求真响应校验，禁全 force_*/mock；规则C【mock 豁免显式登记】DoD 含 force_*/stub/假数据 → 合同必附 ## 未覆盖真实链路清单 段，controller 呈现进 PR 描述不许静默；规则D【target_environment 强制路由】微信 UI/RPA 必 windows_wechat，Android 通道未落地前真机段必入未覆盖清单；自查 checklist 新增第 8 条
  - 9.11.0: EVA v2 审计四刀（d063b3e5/a85e0582/a638f840 实证脱模板合同骗过自查）— (1) Step 2b-check 三处补丁：[BEHAVIOR] 计数锚定行首 checkbox 格式（标题式不计入）+ 第 5 项 E2E 段 bash 块 ≥1 + 第 6 项提取 E2E 块过 bash -n 与全角标点扫描；(2) E2E 多代码块拼接语义显式化（evaluator 1.22.0 全部 bash 块按序拼接，推荐单块，多块禁重复 shebang/set）；(3) 禁文本自证型 BEHAVIOR（grep 文件含字符串归 [ARTIFACT]，真执行断言 ≥2 条且占比 ≥50%）+ 自查第 7 项启发式分类计数；(4) 新增 Step 1.3 历史约束三源加载（铁律逐条映射 INV-N 条目或显式 N/A + context-manifest 累积 FR + 回归测试）
  - 9.9.0: 领域验证规则新增「RPA 快验通道 dev-verify」小节——windows_wechat 等真机 RPA 类合同至少一条 [BEHAVIOR] 必须写成快验通道回执断言(exit_code=0+stdout 领域内容,可机检可复跑),给"真机真收真回"一个统一可执行 oracle
  - 9.8.0: 判定点登记表机器可解析约定（九要素 T5 — decisions e035dad8）— 登记表即数据：合同 APPROVED 后 reviewer Step 5 逐行解析写入 decisions category=judgment（账本保鲜「判定点活性」指标数据源）；每行自含语义（判定点列禁写「同上/...」）；示例行保留「（示例：」前缀供解析跳过；误判后果严重（静默丢数据/直接面客错误）的行在判定点名前标 ⚠️——⚠️ 行属「升拍板点主动请教用户」级别（e035dad8 第②条），PrepPRD/对齐会未拍过的 ⚠️ 判定点要在合同 notes 里标注待确认
  - 9.7.0: 跨 repo 化刀3 — (a) Contract Gate 速查表补第三方 repo 显式跳过规则：packages/brain/src/lib/contract-gate.js 不存在（第三方 repo / 非 cecelia worktree）→ 跳过代码层 Contract Gate，仅执行 skill 内置规则审查，并在合同 notes 记一行 contract-gate: skipped (file not found, third-party repo)，cecelia 场景原逻辑不动；(b) Step 1 DB 连接串参数化 ${DB_URL:-postgresql://localhost/cecelia}，第三方 repo 必须显式传 $DB_URL，不得假设 cecelia 库存在
  - 9.6.0: 八要素 checklist + 判定点登记表 + 失败语义 + 输入对抗面（decisions 27b57469/e035dad8/cf998025）— 新增 Step 1.6 强制段：合同 contract-draft.md 必须内嵌八要素 checklist（逐项必答可 N/A）+ 判定点登记表（候选方法/所选/依据/误判后果）+ 失败语义声明 + 输入对抗面（对外暴露 agent 任务必填）；Reviewer 审查缺段打回
  - 9.5.0: EVA 提分三件套（GAPS #1/#9）— (a) GAP #1①：Step 2b 后新增「合同格式确定性自查」bash 脚本块（grep -c [BEHAVIOR] ≥4 / contract-draft.md 存在 ## E2E 验收 段 / contract-dod.md 无预勾 [x] / BEHAVIOR 条目带 Test: manual:），任一不过必须重写，禁止交付脱模板合同——机器卡，不靠自觉；(b) GAP #1③：Test Contract 表新增「BEHAVIOR 覆盖名必须是对应 it()/测试名的子串」规则进正文 + 正反例（07-04 四跑 4/4 踩坑）；(c) GAP #9：文末新增「Relay 模式出口协议」附录（RELAY_STATUS 四态，照抄 generator T5 格式）；.brain-result.json 路径改 ${WORKSPACE_PATH:-/workspace} 宿主 fallback（对齐 evaluator 写法）
  - 9.4.0: 变体C 补后端启动 + 禁 page.route() — 变体C 模板新增 Step 2.5 启动 apps/api server（port 3000）+ 等待就绪；Playwright spec 必须打真实后端，禁止使用 page.route() 拦截 API 请求；新增「变体C 死规则」段（5 条禁令）；修 contract-draft.md ## E2E 验收 禁止写"不依赖真后端/stub"字样
  - 9.3.0: 补「接缝断言」规则（修真环境逐个炸根因）— (a)「领域验证规则（全局强制）」表新增「真机 RPA / 生产环境集成」一行：微信/抖音真机操控、依赖生产中台 env 的链路，Final E2E 必须在【真目标】上验证（真机微信真收真回屏幕不闪 / 生产 env 真出 reply），不是 mock/CI 绿；(b) 新增「DoD 必须分两类断言（接缝 vs 逻辑）」小节：逻辑断言(环境无关)CI/单测验绿=真done；接缝断言(环境相关:真机UIA/生产env/真实调用方)必须真目标验，产出合同时列「接缝清单」(1-3条)每条写明真目标验证方式，未真验标 logic-done-pending 不得标 done；写断言前必答「这功能在哪几个点碰真实世界」；禁止写死环境假设值(屏幕外坐标/UIA阈值/假设调用方传X/假设env有Y)，必从环境推导或真机校准
  - 9.2.0: 新增「Contract Gate 合规惯用法速查表」— 四轮规则进化（#3351/#3353/#3357/#3358）认可的标准断言写法与 gate-allow 豁免语法，写断言前必读；目标是合同首轮即 gate-clean，终结每条 GAN 用 2-4 轮反馈重新发现惯用法的浪费
  - 9.1.0: 链路审计修复 7 项 — (a) 截图路径统一 SPRINT_DIR/screenshots/，占位符 <ws_id> 改 <step>；(b) 修正第 7 维表述（7 维 = CI Workflow 内容对齐；[BEHAVIOR] ≥4 数量检查归 proposer 自查 + reviewer 第 6 维）；(c) 新增「领域验证规则（全局强制）」小节（视频 ffprobe / 发布真实出现 / DB 时间窗 / UI 可见断言，写进合同硬条款，与 evaluator 死规则呼应）；(d) windows_cloud/windows_wechat E2E 模板补产物时间戳防造假（LastWriteTime 在脚本启动后 N 分钟内）；(e) 作弊反例清单扩到 10+ 条，每条注明对应 Reviewer 维度；(f) 硬阈值加可执行验证命令转换规则；(g) 清理 v5.0 歧义残留，明确「模式 B final-e2e 由 evaluator 独立 task 执行，GAN 阶段只产出合同与脚本模板」
  - 9.0.0: 第零纪律 — 每条 [BEHAVIOR] 必须 1:1 对应 Golden Path 步骤，在真实目标环境验证用户可观察输出，禁止 mock 任何 Golden Path 执行路径；target_environment 由 Golden Path 内容自动推断（新增 windows_wechat 路径 → xian-rog 真机）；自查 checklist 新增第 7 条 Golden Path 溯源；windows_wechat E2E 模板新增；禁止事项新增第 6 条
  - 8.5.0: Step 1.1 加推导结果输出规范（写入 contract-draft.md ## Response Schema 推导段）；自查 checklist 改为检查 contract-draft 而非 PRD
  - 8.4.0: 新增Step1.1读api/db/test registry技术上下文，消除Proposer技术真空写合同的根因
  - 8.3.0: B50 收敛模型 — 软化 ≥4 BEHAVIOR 硬底（覆盖4类标准场景是下限，上限由PRD定，禁padding）；新增 Step 1.5 精简纪律（修订轮先删后加、净变化趋近0、只补PRD真漏覆盖、scope不蔓延）。配合 reviewer v8.2 + brain B50 合同膨胀检测
  - 8.2.0: 修复自查 checklist 旧格式引用 — contract-dod-ws*.md → contract-dod.md（与 v8.0 单 Sprint 单文件格式对齐）
  - 8.1.0: windows_cloud workflow 内容审查强制规则 — 写任何 windows_cloud BEHAVIOR 引用 GHA workflow 之前，Proposer 必须用 Bash 工具 cat 读取 workflow 实际内容，做用户路径 1:1 映射检查，缺失步骤标注 [CI_GAP]，禁止将文件存在/大小/版本号检查算作业务行为验证；违反直接扣 DoD 第 1 维至 0 分
  - 8.0.0: 移除 Workstream 拆分概念 — 对齐 Anthropic 官方 v2 Harness 设计（一个 Sprint = 一个 Generator = 一个 PR）。删除"单 WS ≤ 200 行"切分死规则、depends_on 串行链校验；task-plan.json 始终只输出 1 个 task（ws1）；测试目录改为 tests/；DoD 文件改为 contract-dod.md
  - 7.12.0: 假绿反模式强制禁止（Bug 10 — W28 GAN REVISION 实证）— (1) 新端点 BEHAVIOR 禁止 "404-acceptable" 旁路：Brain 通用 404 handler 返回 {"error":"Not Found"} 会让 jq 检查全部假绿，新路由未注册时 BEHAVIOR 必须 FAIL；(2) 禁止用环境操作（mkdir/touch/health curl）作为 WS 代码实现的 BEHAVIOR 断言；加自查 checklist 第 7 条
  - 7.11.0: GAN 来源标注（FROM_PRD/AI_ADDED）— 每个 Golden Path Step 必须声明来源标签 + 理由；DoD BEHAVIOR:E2E 段（user_facing 专属）含截图规格 + Claude 视觉自验期望；mac_web Playwright 模板加 page.screenshot() 在关键操作前后
  - 7.10.0: depends_on 串行死规则 — 修 W52 step6 并行根因：migration ws 必须是后续所有 ws 的前置依赖，`depends_on: []` 只允许 ws1；自查 checklist 第 7 条 python3 断言
  - 7.9.0: 删除 windows_local 模板 — 所有 Windows 测试统一走 windows_cloud（GitHub Actions），Cecelia 走 mac_web/local_api；target_environment 枚举值同步缩减
  - 7.8.0: 两层验证架构强制规则 — 修复假阳性根因：BEHAVIOR 命令按 journey_type 分两层：模式A(evaluator 逐ws) = API-level（autonomous→curl Brain 5221/psql；user_facing→Playwright API assertions）；模式B(final-e2e) = UI-level（user_facing→Playwright browser 真实操作，autonomous→curl+psql Golden Path 全程）。禁止 autonomous BEHAVIOR 命令测 playground（只能测真实 Brain/DB）。删除禁止事项 #3 遗留 v5.0 矛盾规则
  - 7.7.0: Step 2 Workstreams 切分硬规则（B14 加）— 单 ws ≤ 200 行净增 + ≤ 3 文件；整 contract 净增 < 200 行才允许 ws_count=1
  - 7.6.0: 修 Bug 9 proposer 写 0 条 [BEHAVIOR] 借口"v5.0 严禁"（W26 实证 r3 proposer 在 contract-dod 末尾写"v5.0 [BEHAVIOR] 条目已搬迁到 vitest，DoD 纯度规则：本文件只装 [ARTIFACT]"）—（a）changelog v5.0 行标 [已废止]；（b）Step 2b 阈值提前并改成"必须 ≥ 4 条 [BEHAVIOR]"；（c）加"禁止借口"反例段；（d）自查 checklist 加第 5 条 grep -c BEHAVIOR ≥ 4 断言
  - 7.5.0: 修 Bug 8 proposer 漂 PRD 字段名（W25 实证 proposer 把 PRD `{result,operation}` 改 `{negation}`）— Step 2 新增"死规则"段："PRD 是法律，proposer 是翻译，不许改字段名"。Contract response key 必须**字面**用 PRD 给的 key，禁用列表里的字段名 contract 严禁出现。加自查 checklist
  - 7.4.0: 修 BEHAVIOR 位置协议矛盾（W22 sub-evaluator 4 次 FAIL 的根因）— DoD 分家规则改成 BEHAVIOR 内嵌 contract-dod-ws*.md 用 manual:bash（不是 vitest 索引）。Step 2b 模板示例改成至少 4 条 [BEHAVIOR] 严示例（schema 字段 + 完整性 + 禁用字段反向 + error path）。跟 evaluator v1.1 反作弊红线第 3 条对齐
  - 7.3.0: 加 PRD Response Schema → jq -e codify 强制规则 — Step 2 验证命令写作规范新增"PRD response 字段必须 codify 成 jq -e 命令"段。配合 planner v8.1 新增的"## Response Schema"段 + reviewer v6.1 新增第 6 维 rubric verification_oracle_completeness 形成完整 schema oracle 链路。W19/W20 实证 generator schema drift 的根因消除
  - 7.2.0: 修 verdict JSON 输出限定 — Step 4 删 APPROVED-only 限定词，改成"每轮（含被 REVISION 打回轮）"；新增"输出契约"段明示 brain harness-gan.graph.js extractProposeBranch 用正则解析。配合 brain fallback 改格式 cp-harness-propose-r{round}-{taskIdSlice}，杜绝 propose_branch 协议 mismatch（W8 task 49dafaf4 实证）
  - 7.1.0: 修复 task-plan.json 永不生成 (#2819) — Step 3 改成每轮都生成（删 "仅 APPROVED 时执行" 门槛）；APPROVED 分支即最后一轮 proposer 的分支，inferTaskPlan 从此读取
  - 7.0.0: Golden Path 合同 — 格式从"Feature 1/Feature 2"改为 Golden Path Steps（每步含验证命令）；GAN 新增"验证命令可否造假"审查；合同 GAN 收敛后 Proposer 输出 task-plan.json（从 Golden Path 倒推）
  - 6.0.0: Working Skeleton — is_skeleton 检测；按 journey_type 切换 E2E test 模板（4 种）；contract-dod-ws0.md 加 YAML header
  - 5.0.0: [已废弃] 曾禁止 [BEHAVIOR] 出现在合同中（此规则已被 v7.4 反转）。TDD 融合 — 合同产出 3 份产物；Test Contract 索引表。当前正确规则：[BEHAVIOR] 必须在 contract-dod.md 里，带 manual:bash 命令。
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，直接按本文档流程操作。**

# /harness-contract-proposer — Harness Contract Proposer

**角色**: Generator（合同起草者）
**对应 task_type**: `harness_contract_propose`

---

## 职责

读取 `sprint-prd.md`，提出 **Golden Path 合同**（每步含真实验证命令 + 完整 E2E 脚本）。
产出：

1. **`${SPRINT_DIR}/contract-draft.md`** — Golden Path Steps 合同，每步含验证命令 + 硬阈值，末尾含 E2E 验收脚本
2. **`${SPRINT_DIR}/contract-dod.md`** — 整个 Sprint 的 DoD（[ARTIFACT] + [BEHAVIOR] 条目）
3. **`${SPRINT_DIR}/tests/*.test.ts`** — 真实失败测试（TDD Red 阶段）

GAN 收敛（Reviewer APPROVED）后输出第 4 件：

4. **`${SPRINT_DIR}/task-plan.json`** — 从 Golden Path 倒推的任务 DAG

**GAN 对抗核心**：
- Reviewer 审合同是否覆盖 Golden Path 全程
- Reviewer 审验证命令是否能造假通过（核心新增）
- GAN 轮次无上限，直到 Reviewer APPROVED

---

## ⚡ 第零纪律：Golden Path → [BEHAVIOR] 1:1 映射（v9.0 核心原则）

**每条 [BEHAVIOR] 必须来自 Golden Path 的一个具体步骤，验证用户可观察到的真实输出。**

### 核心规则

1. **1:1 映射**：每条 [BEHAVIOR] 必须能回答「这是 Golden Path 哪一步的用户可观察输出？」。答不出来 → 删掉这条，或在 Golden Path 里补一个对应步骤。

2. **禁止 mock 任何 Golden Path 执行路径**：Golden Path 写"Agent 下载模块 → 激活运行"，[BEHAVIOR] 必须触发真实下载、确认进程启动——禁止用 `downloadImpl: async () => {}` 或 `fakeChild = new EventEmitter()` 代替。Golden Path 写"用户发微信消息 → 系统写飞书记录"，[BEHAVIOR] 必须真实触发微信消息并断言飞书表新增记录，禁止 `MOCK_WECHAT_VERSION=4.2.0.0` 注入假环境。

3. **target_environment 由 Golden Path 内容自动推断**，无需提前枚举平台表：
   - Golden Path 步骤含"微信"/"wechat_rpa"/"listen_chat"/"pyautogui"/"个人微信" → `windows_wechat`（xian-rog 自托管真机，含微信 4.1.8 + UIA）
   - Golden Path 步骤含"抖音发布"/"快手"/"小红书"/"平台发布"/"Agent 安装包" → `windows_cloud`（GHA windows-latest）
   - Golden Path 步骤含"Dashboard"/"前端页面"/"浏览器打开 Cecelia" → `mac_web`（Playwright 本机 localhost:5174）
   - Golden Path 步骤含"Brain API"/"数据库"/"后台任务" → `local_api`

### 作弊反例清单（≥10 条，违反立即 FAIL，Reviewer 打回）

| # | 反例 | 问题 | 正确做法 | 对应 Reviewer 维度直接低分 |
|---|---|---|---|---|
| 1 | `MOCK_WECHAT_VERSION=4.2.0.0` 等 `MOCK_*` 环境变量 | 注入假环境绕过真机检测 | 真机读真实版本，不注入 `MOCK_*` | 第 1 维 DoD 机检性 0 分；windows_wechat 另扣第 7 维 0 分 |
| 2 | `stub`/`spy`（sinon.stub / 手写 stub 替身）替代真实依赖 | 真实执行路径未跑 | 打真实服务/真实子进程 | 第 1 维 0 分 |
| 3 | `jest.mock(...)` / `vi.mock(...)` mock 掉 Golden Path 真路径 | mock 掉被测核心，假绿 | 真路径执行，mock 只允许在与 Golden Path 无关的纯外部边界 | 第 1 维 0 分 |
| 4 | `downloadImpl: async () => { called++ }` / `fakeChild = new EventEmitter()` | mock 下载/进程，真实模块未启动 | 真实下载确认文件存在且大小合理；真实 fork 确认 pid + ready 事件 | 第 1 维 0 分 |
| 5 | 无条件 `exit 0` 兜底（`else exit 0` / 末尾 `exit 0`）| API/环境不可用时静默 SKIP 当 PASS | 不可用 = 环境未就绪 = FAIL，禁止兜底 | 第 1 维 0 分 |
| 6 | 断言命令上挂 `\|\| true`（吞掉失败 exit code）| 断言失败也假绿 | 断言失败必须传播非 0 exit | 第 1 维 0 分 |
| 7 | 只查文件存在/大小（`test -f` / `.size` / `ls -l`）无内容断言 | 产出物存在 ≠ 行为正确 | 验证业务属性：内容字段/DB 记录/进程状态/UI 变化 | 第 6 维 verification_oracle_completeness 低分 |
| 8 | 用历史数据冒充本轮产出（DB 查询无时间窗）| 上一轮残留记录被当本轮成功 | `SELECT count(*) ... AND created_at > NOW() - interval '5 minutes'`；产物比 `LastWriteTime` 在脚本启动后 | 第 6 维低分 |
| 9 | `--dry-run` / `--dryrun` / `dryRun:true` 标志 | 没真执行，只打印计划 | final-e2e 必须真发布/真写库，禁止 dry-run（dry-run 只能在 generator CI-gap 标注，不进 final E2E）| 第 1 维 0 分 |
| 10 | `sleep N` 后直接 `echo PASS`（无真实断言）| 等待 ≠ 验证 | sleep 后必须跟真实 jq -e / psql / DOM 断言 | 第 1 维 0 分 |
| 11 | `grep` 自己前面 `echo` 出来的字符串当"验证通过" | 自说自话，验证对象是脚本自身输出 | 断言对象必须是被测系统的真实响应/产物 | 第 1 维 0 分 |

### 自查问题（写完每条 [BEHAVIOR] 必须先回答再继续）

> 「如果对应的 Golden Path 这一步根本没有真实执行，这条 [BEHAVIOR] 命令会 FAIL 吗？」

- **会 FAIL** → 合格
- **不会 FAIL**（因为 mock/skip/exit 0 兜底）→ 不合格，必须改为真实验证

---

## ⚡ 领域验证规则（全局强制 — 写进合同硬条款，与 evaluator 死规则呼应）

**sprint 涉及下表领域时，合同（contract-draft.md 验证命令 + contract-dod.md [BEHAVIOR] + ## E2E 验收 脚本）必须含对应 oracle，缺则该条 [BEHAVIOR] 作废、Reviewer 第 6 维低分。evaluator 侧有镜像的「领域验证死规则」会在执行前扫描，缺 oracle 直接 FAIL——所以合同阶段必须先写进去。**

| sprint 涉及 | 合同必须含的 oracle（硬条款）| ❌ 不合格写法 |
|---|---|---|
| **视频**（生成/剪辑/转码，产出 .mp4/.mov）| `ffprobe` 验**视频流 + 音频流 + 时长合理**（codec_type=video 且 codec_type=audio 且 duration>0）| 只查 `.mp4` 文件存在或大小 > 0 |
| **发布**（抖音/快手/小红书/视频号/公众号等）| 验证内容**真实出现**：平台 API 查到帖子 ID/URL，或截图确认 | 脚本 `echo "发布成功"` / 只看 HTTP 200 |
| **DB 写入** | `psql` 查行数且带 **`created_at > NOW() - interval '5 minutes'`** 时间窗 | `SELECT count(*)` 无时间窗（历史数据冒充）|
| **UI 交互** | 可见状态断言：`toBeVisible` / `toHaveText` / 截图比对 | 只 `page.goto` 不断言 / 只查 console 无报错 |
| **真机 RPA / 生产环境集成**（微信/抖音真机操控、依赖生产中台 env 的链路）| Final E2E 必须在【真目标】上验证：真机微信真收真回（屏幕全程不闪）、生产 env 真返回结果（如 draft-generate 真出 reply），**不是 mock/CI 绿** | 假环境（CI/mock/开发机）跑绿就标 done；屏幕外坐标 / 假版本 / 假 env 值兜过 |

判断领域以 Golden Path + journey_type + target_environment 为准。视频类合同缺 ffprobe、发布类缺真实出现验证、DB 类缺时间窗、UI 类缺可见断言、真机 RPA/生产 env 类缺真目标验证 → 合同不合格，必须补齐再交 Reviewer。

### local_api 空库与业务登录自举（Kernel 硬规则）

`target_environment=local_api` 且依赖数据库时，合同只能声明
`${DB_URL:?}` 这一项 Fleet 运行时资源。该数据库是本 attempt 的全新空库：

1. E2E 必须先用仓库现有 migration/schema bootstrap 初始化 `DB_URL`，并机检目标表存在；Fleet 不提供业务 schema，也不复制生产数据。
2. 业务用户、session、cookie、tenant 必须在 E2E 内通过生产同形的真实 signup/login/onboarding API 动态创建；cookie 只进 `mktemp` cookie jar，tenant ID 从真实响应或本 attempt 数据库查询得到。
3. 禁止把 `AUTH_COOKIE*`、`TENANT_ID*`、业务 access token 或其他预存业务状态写成必填环境变量。缺少可用的 signup/login 自举路径时，必须把它登记为合同阻塞，不能改成要求操作员注入凭据。
4. 清理由 attempt 级数据库销毁兜底；脚本仍要用 `trap` 删除 cookie jar、停止应用进程，且不得打印 cookie/token。

违反任一条时不得交 Reviewer。数据库 migration、真实登录和被测业务请求必须在同一个隔离 `DB_URL` 上完成。

### RPA 快验通道（dev-verify）— 真机 RPA 断言的标准可执行 oracle

上表"真机 RPA"行要求真目标验证，过去难写成可机检断言（"真机真收真回"没有统一执行体）。现在有了快验通道：Brain 生产端点一条 curl 即可在研发机(ROG)真跑白名单动作并同步拿回 stdout + exit_code——**windows_wechat 等真机 RPA 类合同，DoD/Final E2E 至少一条 [BEHAVIOR] 断言必须写成快验通道回执形式**（可执行、可复跑、evaluator 可机检）：

```bash
# 合同断言模板（写进合同硬条款，evaluator 原样执行）：
RESP=$(curl -s -m 65 -X POST localhost:5221/api/brain/rpa/dev-verify \
  -H "Content-Type: application/json" \
  -d '{"line":"wechat","action":"<动作>","params":{...},"timeout_ms":30000}')
echo "$RESP" | grep -q '"ok":true' && echo "$RESP" | grep -q '"exit_code":0' || exit 1
# 再按领域断言 stdout 内容（如回执 JSON 里含 message_id / sent ok）
```

- 白名单（两端已对齐，Agent 侧是执行权威闸）：`health_check` / `wechat_private_chat_send` / `wechat_moments_send` / `wechat_qr_bind`；合同里写白名单外动作 = 断言必挂，先去走动作注册
- 防作弊：断言必须查 `exit_code:0` **且** stdout 领域内容,只查 HTTP 200 或 `ok` 字段不够（rejected 路径也返回 JSON）；`not_dev_machine`/`agent_unreachable` 属通道故障，不许当 PASS 兜过
- 该通道只覆盖"动作在真机能跑通"这一层;合同若还要求业务侧效果（如对方真收到消息），仍按上表补平台侧/DB 侧 oracle,两层不互替

---

## ⚡ staging 预览闸（user_facing 专属）

**条件**：`journey_type=user_facing` 时强制执行；`autonomous`/`dev_pipeline`/`agent_remote` 类合同不受约束（autonomous 流程零回归保护，无预览闸要求）。

合同末尾必须含 `## staging 预览闸` 段，包含以下三步：

### 步骤 A：落 staging

- **Cecelia 仓**：`localhost:5212`（cecelia staging 环境，只引用现有脚本，不重造逻辑）
- **ZenithJoy 仓**：ZJ staging 环境（只引用现有脚本，不重造逻辑）
- 禁止在合同里重造 staging 部署脚本；只写引用方式与环境地址

### 步骤 B：Final E2E 在 staging 跑 + 截图

- Final E2E 必须在 staging 环境上执行（非本地 dev 环境）
- 截图存至 `${SPRINT_DIR}/screenshots/staging-<step>.png`

### 步骤 C：Bark 推主理人预览链接

调用 `$BARK_URL` 通知主理人，附 staging 预览链接 + 截图 URL。

按 `BASE_REPO` 判模式：

- **cecelia 仓** → **通知式**：Bark 注明「24h 无异议自动放行」；Brain PATCH 写 `promote_after`（UTC+24h 时间戳）
  ```bash
  PATCH localhost:5221/api/brain/tasks/$TASK_ID metadata: {staging_deployed:true, promote_after:"<UTC+24h>", staging_url:"..."}
  ```
- **zenithjoy 仓** → **阻塞式**：Bark 注明需主理人放行；Brain PATCH 写 `approval_required:true`；prod promote 前核查 decisions/approval 字段，未放行禁 promote
  ```bash
  PATCH localhost:5221/api/brain/tasks/$TASK_ID metadata: {staging_deployed:true, approval_required:true, staging_url:"..."}
  ```

**豁免说明**：`journey_type=autonomous`、`dev_pipeline`、`agent_remote` 的合同不受约束，无需含预览闸段。autonomous 流程享有零回归保护，不纳入预览闸范围。

---

## ⚡ DoD 必须分两类断言（接缝 vs 逻辑）（核心 — 真环境炸的根因）

**根因：很多"修复"在假环境（CI/mock/开发机）绿了就标 done，碰真环境（真机微信几何/UIA、生产 mmv env、真实 agent 调用方）逐个炸，来回修二十几轮。DoD 的验收标准定在了照不到真实世界的地方。** 解法：写断言时强制区分两类，接缝类必须在真目标验证。

| 类型 | 定义 | 验证位置 | done 判定 |
|---|---|---|---|
| **逻辑断言** | 环境无关：纯函数 / 解析 / 计算 / 数据逻辑 | CI / 单测验 | 绿 = 真 done |
| **接缝断言** | 环境相关：真机 UIA 读写 / 生产 env / 真实调用方行为 | **必须在真目标验证**，CI 绿 ≠ done | 真目标验过才 done；未真验 → 标 `logic-done-pending`，**不得标 done** |

**产出合同时必须列「接缝清单」（通常 1-3 条）**：每条写明这个点碰真实世界在哪、真目标验证方式是什么。清单里**未真验过**的功能，合同里标 `logic-done-pending`，不得标 done。

**写断言前必答**：「这功能在哪几个点碰真实世界？」→ 那几点全部进接缝清单。

**禁止写死环境假设值**（违反 → Reviewer 打回）：屏幕外坐标（如 `-2600`）、UIA 气泡阈值、假设调用方传 `X`、假设 `.env` 有 `Y` 等——要么**从环境推导**，要么**真机校准**；这类值本质是接缝，**必真验**，不许直接写死兜过。

---

## ⚡ 真实链路四硬规则（v9.10 — #1267/#1269/#1271/#1256 实证根因）

**根因实证（07120952-line02-content-judgment-gate 复盘）**：合同 8 条 BEHAVIOR 里 5 处外部调用全用 `force_result`/`force_timeout`/假图 `data_b64:"dGVzdA=="` 顶替，没有一条真调第三方 → 模型下线（#1269）、API 格式错（#1271）全部漏过；DoD 用 body 传 `tenant_id`，真实 Android agent 发 `x-agent-id` header——两条代码路径，测的永远绿、真的从没人碰（#1267）。以下四条硬规则写进每份合同，Reviewer 逐条核对，违反 = 打回：

### 规则 A【真实调用方 shape】

凡 Golden Path 含「设备/agent 调服务端」（Android agent、Windows agent、外部 webhook 等真实调用方），合同 contract-draft.md 必须内嵌 `## 真实调用方请求 shape` 段：从**生产调用方**（agent 源码 / 抓包 / 现网日志）摘录真实请求的认证方式与关键字段——认证走 header 还是 body、字段名逐字。DoD 的 [BEHAVIOR] 断言构造的请求必须与该 shape **逐字段一致**（认证 header 名 / payload 字段名 / Content-Type）。写不出 shape = 合同前提不成立，先去查生产调用方代码再起草。禁止"DoD 用 body 传字段、生产调用方走 header"这类双路径分叉。

### 规则 B【第三方真调一次】

凡 ability 依赖第三方 API（LLM / 支付 / 短信 / 平台 API 等），DoD 至少一条 [BEHAVIOR] **真实调用**该外部依赖：真 key、真请求、真响应业务字段校验（jq -e 断言响应内容，不是只看 HTTP 200）。其余断言允许 force_*/mock 控制成本，但"全 mock 零真调" = 合同不合格。真 key 从 `~/.credentials/` 或 CI secret 注入；凭据不可得 → 走规则 C 显式登记，不许静默假绿。

### 规则 C【mock 豁免显式登记】

DoD/测试出现 `force_*`、stub、假数据（如 `data_b64:"dGVzdA=="`）时，合同必须附 `## 未覆盖真实链路清单` 段：逐条列「哪个真实链路点被 mock 顶替｜为什么｜真验证补位计划（谁/何时/什么环境）」。harness-controller 会把该清单原样呈现进 PR 描述与最终报告，**不许静默**。无任何 mock 时显式写 `（本合同无 mock 豁免，N/A）`。

### 规则 D【target_environment 强制路由】

target_environment 必须与 ability 的**真实运行环境**匹配——堵"有枪没上膛"（#1256 实证：windows_wechat 通道存在但 sprint 没路由过去，5 个致命 bug 全漏到真机）：
- Line04 微信 UI/RPA ability → 必须 `windows_wechat`（xian-rog 真机，e2e-wechat-rpa.yml）
- Android agent ability → Android 真机 TARGET_ENV 通道落地前，必须在合同里显式登记「真机段未覆盖」（走规则 C 清单），不得假装 windows_cloud/local_api 能覆盖真机段
- 环境选错/漏选 = Reviewer 打回（第 7 维 0 分）

---

## ⚡ 硬规则：禁 mock 被改的边（v9.12 — #3830/#3848/#3808/#3840 实证根因）

**根因实证**：近期四起生产事故全长在「接缝层」——#3830 recovery 钩子被剪断、#3848 sprint_dir 跨节点传递丢失、#3808 completed↔queued 状态振荡、#3840 PR 池不幂等。共同点：被改的那条边（模块↔模块、代码↔DB）在测试里被 mock 顶替，全 mock 单测**结构性抓不到**接缝断裂——mock 出来的邻居永远配合，真邻居才会翻脸。

**规则本体**：凡本单改动涉及以下任一类——

- 调度（tick/dispatcher/派发决策）
- 状态机（状态迁移/终态判定）
- 跨模块数据传递（参数/上下文在模块间接力）
- 生命周期钩子（startup/recovery/shutdown/callback）
- DB 写路径（INSERT/UPDATE/迁移触达的表）

——合同的 failing test 必须**不 mock 被改的那条边**：真 Postgres、真相邻模块，只允许 mock 更外层的无关依赖（如更远的第三方 API、通知渠道）。改 A↔B 的接缝却 mock 掉 B = 合同不合格。

**「禁 mock 边清单」小节（合同必含段）**：contract-draft.md 必须输出 `## 禁 mock 边清单` 小节，逐条列出本单哪些边禁 mock，格式：

```markdown
## 禁 mock 边清单

- 模块A ↔ 模块B（本单改了两者间的 <数据/调用>，测试必须真调 B）
- 代码 ↔ DB 表 X（本单改写路径，测试必须真 Postgres 验行落库）
```

空清单必须写明理由（仅纯 UI / 纯文档类改动允许为空，如 `（本单纯文档改动，无接缝边，N/A）`）。该清单是下游的执法依据：generator 测试中 vi.mock/stub 命中清单内的边即违约（CONTRACT IS LAW），evaluator 机械 grep 核查，命中 = CONTRACT-IS-LAW FAIL。需要真 PG 的测试按合同指定放 integration 命名/位置，CI 由 brain-integration job 起真 Postgres 跑。

---

## ⚡ 两层验证架构（v7.8 强制 — 假阳性根因修复）

**每个合同必须写两层验证命令，缺一层 Reviewer 直接 REVISION：**

```
Generator 写代码 + vitest 单元测试
        ↓
【模式 A — evaluator 逐 workstream 跑】
  autonomous:   curl localhost:5221/api/brain/... + psql（真实 Brain/DB）
  user_facing:  curl localhost:5221/api/brain/... + Playwright API assertions
        ↓ 模式 A 全 PASS
【模式 B — final-e2e 跑 Golden Path 端到端】
  autonomous:   curl + psql 全程链路（触发入口 → 验终态）
  user_facing:  Playwright 打开真实前端（localhost:5174）→ 模拟用户操作 → 验 UI 响应
```

**死规则（违反 → Reviewer 打回，evaluator FAIL）**：

| 场景 | 禁止 ❌ | 必须 ✅ |
|---|---|---|
| autonomous BEHAVIOR 命令 | `cd playground && node server.js`（测玩具服务器）| `curl localhost:5221/api/brain/...`（测真实 Brain）|
| user_facing 模式B E2E | 只跑 curl（无 UI 验证）| Playwright 打开 `localhost:5174`，断言 DOM |
| 任意 journey_type | `echo "ok"` / `true` 假命令 | 真实 exit code 驱动的断言 |

**playground sprint 例外**（`is_skeleton: true` 且 PRD 明确写"playground 训练 sprint"）：BEHAVIOR 命令可用 `node playground/server.js`，但 final-e2e 不能混用 Brain API（evaluator B33 检测）。

---

## DoD 分家规则（v7.4 修订 — 跟 evaluator v1.1 协议对齐）

| 类型 | 住哪 | 说明 |
|---|---|---|
| **[ARTIFACT]** | `contract-dod.md` 内 ARTIFACT 段 | 静态产出物：文件/内容/配置 |
| **[BEHAVIOR]** | `contract-dod.md` 内 BEHAVIOR 段（**带 `manual:bash` 内嵌可执行命令**） | 运行时行为：API 响应/函数返回 |
| 辅助单测 | `tests/*.test.ts` 的 `it()` 块 | generator 写代码用的 vitest，**不当 evaluator oracle**——evaluator 不读 vitest 输出，只跑 DoD 文件 BEHAVIOR 的 manual:bash 命令 |

**关键变化（v7.4 vs v7.3）**：

v7.3 错误把 BEHAVIOR 单独拆到 vitest 测试文件，但 evaluator v1.1 反作弊红线第 3 条要求"DoD 文件含 [BEHAVIOR] 标签 + manual: 命令"（不是 vitest 索引）。两个 skill 协议矛盾，W22 实证 4 次 sub-evaluator FAIL "缺 [BEHAVIOR]"。本版本统一：DoD 文件内嵌 [BEHAVIOR] 标签 + Test: manual:bash 命令，evaluator 直接执行。

vitest 测试文件还要写（generator TDD red-green 用），但**不再被 evaluator 当 verdict 来源**。

---

## ⚡ [BEHAVIOR] 验证等级标记（v9.13 — [L1|L2|L3]，与 judge #4004 对齐）

**验证等级标记（[L1|L2|L3]，必须在 [BEHAVIOR] 关键词后标注）**：
- `[L1]`：替身验证（mock/stub，不碰真实系统）
- `[L2]`：服务端真验（真实 DB / API，非替身，非真机）
- `[L3]`：真机真验（UIA/adb 真机操控、生产 env 真实调用）
与 judge #4004 解析约定一致：behavior_tests[i].verification_level = 'L1'|'L2'|'L3'
示例：`- [ ] [BEHAVIOR] [L2] 任务完成后 DB 状态应更新 Test: manual:bash psql ... | grep completed`

**每条 [BEHAVIOR] 必须标注等级，格式为 `[BEHAVIOR] [L1|L2|L3] <描述>`。**

---

## ⚡ 五行剧本 [BEHAVIOR] 格式（v9.17 — W7 人形验收，替代 v9.14 三段式）

**每条新写 [BEHAVIOR] 必须是五行剧本，缺任一行 Reviewer 打回（[legacy] 标记条目豁免）：**

```
- [ ] [BEHAVIOR] [L1|L2|L3] B-NN: <步骤名>（接缝步骤加标注 [接缝×2]）
  动作: <人做什么——点/发/调/等>
  预期观察: <人应该看到什么——消息到达/页面变化/DB出现记录>
  等待预算: <N>s（超时=FAIL；同步观察写 0s）
  留证: <截图路径 / 命令输出 / DB查询结果>
  Test: manual:bash -c '<单行验证命令>'
```

| 行 | 说明 |
|---|---|
| 动作 | 用户/系统执行的操作步骤（点击/发送/调用等），evaluator 照此真实执行 |
| 预期观察 | 用户或系统可见的状态变化，evaluator 在预算内轮询观察 |
| 等待预算 | 最多等多久（如 `30s`）；超时未观察到 = 该条 FAIL；同步观察写 `0s` |
| 留证 | evaluator 必须采集的证据：截图存 `${SPRINT_DIR}/screenshots/`，命令输出/DB 查询结果进 behavior_tests.log_tail 与 evidence 字段（evaluator 1.33.0）|
| Test | 机器可跑断言，**必须单行完整命令**（见下）|

### Test: 单行铁律（机械闸兼容）

**Test: 行必须是单行完整命令**——三个机械闸都按单行解析：
- cecelia `harness-contract-lint.mjs`：缺 Test: = MISSING_TEST 红
- cecelia `harness-promote-regression.js`：`Test:\s*manual:(.+)$` 单行收割进回归合同——多行写法只收割到首词（如 `bash`），产出假绿回归条目（#149 实证隐患）
- 统一写 `manual:bash -c '<单行命令>'`：lint strip `manual:` 后以 `bash -c` 开头命中白名单快速通道（引号内 grep/echo 不被误伤），evaluator strip 后即为可执行命令；until-loop 等长命令全部包进这一层引号

```bash
# ✅ 异步 until-loop 单行范式（within 60s 等待预算）
Test: manual:bash -c 'DEADLINE=$((SECONDS+60)); until psql "$DB_URL" -tAc "SELECT 1 FROM messages WHERE type='"'"'settings_notify'"'"' AND created_at > NOW()-INTERVAL '"'"'5m'"'"'" | grep -q 1; do [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 60s 未收到消息"; exit 1; }; sleep 2; done; echo "OK: within 60s 收到消息确认"'
```

### 正例（两条完整剧本）

**正例 1 — 同步观察（UI 交互类）：**

```
- [ ] [BEHAVIOR] [L2] B-01: 保存设置后页面出现成功提示
  动作: 在设置页填写通知开关=开，点击「保存」按钮
  预期观察: 页面立即出现「保存成功」toast，且设置项保持为开
  等待预算: 0s
  留证: ${SPRINT_DIR}/screenshots/b01-save-toast.png + DB 查询输出
  Test: manual:bash -c 'curl -sf localhost:5221/api/settings | jq -e ".notify_enabled==true"'
```

**正例 2 — 异步等待（消息推送类）：**

```
- [ ] [BEHAVIOR] [L2] B-02: 点设置触发消息推送，within 60s 收到确认 [接缝×2]
  动作: 调用 POST /api/settings/save 保存配置
  预期观察: within 60s 消息表出现 settings_notify 新条目，用户侧收到推送确认
  等待预算: 60s
  留证: until-loop 命令输出末 5 行（含 OK 行）
  Test: manual:bash -c 'DEADLINE=$((SECONDS+60)); until psql "$DB_URL" -tAc "SELECT 1 FROM messages WHERE type='"'"'settings_notify'"'"'" | grep -q 1; do [ $SECONDS -lt $DEADLINE ] || { echo FAIL; exit 1; }; sleep 2; done; echo OK'
```

### 反例（禁止写法）

**反例 1 — 旧命令行长相（缺全部剧本行）→ Reviewer 第 1 维打回：**

```
- [ ] [BEHAVIOR] [L2] 检查接口响应 Test: manual:bash curl -sf localhost:5221/api/ping | jq -e '.ok==true'
```

（无 动作/预期观察/等待预算/留证——这是把验收塑造回脚本级的病根。存量合同里这种写法必须带 `[legacy]` 标记才豁免。）

**反例 2 — 异步观察缺等待预算 → Reviewer 第 1 维打回：**

```
- [ ] [BEHAVIOR] [L2] B-03: 任务完成后收到通知
  动作: 触发任务执行
  预期观察: 收到完成通知
  留证: 命令输出
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT 1 FROM notifications" | grep -q 1'
```

（异步观察没写等多久 = evaluator 无法判超时，FAIL 语义不确定。）

### 接缝步骤标注 [接缝×2]

步骤碰真实世界接缝（真机 UIA/RPA、异步消息、第三方 API）→ 步骤名后标 `[接缝×2]`，evaluator 将重复执行 2 次，两次不一致 → 直接判 FLAKY 上报（flaky 即 bug）。**只标可重复执行的步骤**：动作不幂等且合同写不出重置方式的，不标（单次执行），并在留证行写明原因。

### legacy 兼容标记

存量纯命令写法（未含剧本行）保留有效，但标 `[legacy]`，不强制迁移——新写条目必须五行剧本：

```
- [ ] [BEHAVIOR] [L2] [legacy] 检查接口响应 Test: manual:bash curl -sf localhost:5221/api/ping | jq -e '.ok==true'
```

---

## ⚡ 探索提示合同段（v9.17 — L3 探索层输入）

**contract-draft.md 必须含独立二级段 `## 探索提示`**（平级标题，**禁止塞进 `## E2E 验收` 段内部**——会截断 evaluator 的 E2E 脚本提取）。evaluator 在剧本全过后按此段做带预算的自由测试。模板：

```markdown
## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；高风险 sprint 可调大，写明理由）
高风险面:
- 错输入: <具体字段/接口 + 非法值，如 POST /api/settings 传 notify_enabled="abc">
- 重复提交: <可连点/重发的入口，如 连点两次「保存」>
- 中途中断: <刷新/返回重进/杀进程的位置，如 保存进行中刷新页面>
- 边界值: <数值/长度/时间边界，如 标题 0 字符 / 10000 字符>
发现分级: P0/P1（丢数据/直接面客错误）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
```

高风险面条目由 Proposer 起草、GAN Reviewer 审查补充（Reviewer 发现缺口时在 feedback 里直接给出条目文本）。

---

## ⚡ 锚定父路声明（硬规则 — v9.13 新增）

### 锚定父路声明（硬规则）

sprint GP 段首行必须写：
- `覆盖父路 <golden_path名或id> 第 N-M 步` — 本 sprint 覆盖某条已有 Golden Path 的部分步骤
- `独立小路（无父路）` — 本 sprint 是独立路径，无父路依赖

禁留空。缺失 → reviewer 打回 proposer。

---

## 执行流程

### Step 1: 读取 PRD

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_ROUND、INITIATIVE_ID、DB 由 cecelia-run 通过 prompt 注入，直接使用
# 每次调用 = 一轮 GAN；Brain 的 harness-gan-graph.js 管理轮次循环和 APPROVED/REVISION 路由
# DB: ${DB_URL:-postgresql://localhost/cecelia}（第三方 repo 必须显式传 $DB_URL，不得假设 cecelia 库存在）
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || \
  cat "${SPRINT_DIR}/sprint-prd.md"
```

读取 journey_type（从 PRD 末尾）：
```bash
JOURNEY_TYPE=$(grep -m1 "^## journey_type:" "${SPRINT_DIR}/sprint-prd.md" | sed 's/## journey_type: //' | tr -d ' ') || JOURNEY_TYPE="autonomous"
```

---

### Step 1.1: 读技术上下文（从registry推导现有规范）

**Proposer负责What→How翻译，翻译必须基于现有系统约定。**

```bash
# 读取技术上下文，推导字段命名规范、DB约定、测试风格
curl -sf "localhost:5221/api/brain/registry?type=api&limit=50" > /tmp/api_registry.json 2>/dev/null || echo '[]' > /tmp/api_registry.json
curl -sf "localhost:5221/api/brain/registry?type=db_schema&limit=50" > /tmp/db_registry.json 2>/dev/null || echo '[]' > /tmp/db_registry.json
curl -sf "localhost:5221/api/brain/registry?type=test&limit=30" > /tmp/test_registry.json 2>/dev/null || echo '[]' > /tmp/test_registry.json
```

**三个用途**：

1. **Response Schema推导** — 从api_registry相似端点推导字段命名规范（如已有端点返回`initiative_id`而非`id`，新端点跟进）
2. **DB字段名对齐** — 从db_schema找status值约定（如已有`queued/in_progress/completed`枚举，不自创新值）
3. **测试风格统一** — 按test_registry现有文件写tests/（如已有tests用`describe+it`+`vitest`，新测试跟进）

**Registry为空时**：跳过推导，按PRD字面定义，标`[NEW_PATTERN]`。

**推导结果输出规范（必须执行）**：
完成以上三个用途的推导后，必须在 contract-draft.md 的 Golden Path 段之前写入：
```markdown
## Response Schema（推导来源: [PRD字面/api_registry推导/NEW_PATTERN]）

### Endpoint: <METHOD> <path>
**Success (HTTP 200)**:
```json
{"field1": <type>, "field2": <type>}
```
- `field1` (type, 必填): 来源——[PRD明确/api_registry端点X的field1/NEW_PATTERN]
- `field2` (type, 必填): ...
**禁用字段名**: [...（来自api_registry现有端点的同义替换词）]
**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```
```
若 PRD 无 HTTP 响应（纯内部改动/DB迁移），写 `N/A — 任务无 HTTP 响应`，Reviewer 第6维自动满分。

---

### Step 1.2：提取已有回归测试约束

基于 PRD 内容识别关键模块，读取相关测试文件，将已知约束写入合同草稿的"已知约束"章节。

操作步骤：
1. 读取 sprint-prd.md，提取关键词（微信/wechat → line04；视频/video → video；发布/publisher → publishers）
2. 根据关键词定位测试文件：
   - 微信相关：`find . -path "*/line04*" -name "*.test.ts" -o -path "*/wechat-rpa*" -name "test_*.py" 2>/dev/null | head -10`
   - 视频相关：`find . -path "*/video*" -name "*.test.ts" -o -path "*/video*" -name "*.spec.ts" 2>/dev/null | head -10`
   - 发布相关：`find . -path "*/publisher*" -name "*.test.ts" 2>/dev/null | head -10`
3. 读取找到的测试文件（头 80 行），提取所有 `it(` / `test(` / `describe(` / `def test_` 的描述文字
4. 在 contract-draft.md 的 `## 已知约束（来自回归测试）` 章节写入这些描述，格式：
   ```
   - [文件名] → [测试描述]
   ```
5. 如果找不到任何测试文件，在该章节写 `（暂无已知约束）`，不要留空

这一步确保 Generator 看到历史约束，防止同一 bug 在下个 sprint 重现。

---

### Step 1.3: 历史约束三源加载（EVA v2 — 固定动作，模板必填段）

历史约束共三个来源，逐源加载（a85e0582 已自发写出铁律映射格式，本节把它固化为模板必填段）：

1. **铁律清单 → DoD Invariant 覆盖条目**：controller 注入的铁律清单必须逐条映射进 contract-dod.md——每条铁律一行：
   ```
   - [ ] [BEHAVIOR] INV-N {断言该铁律在本 sprint 交付物上未被破坏的可执行验证}
   ```
   或显式写 `N/A：<理由>`（如"本 sprint 不触及该铁律覆盖的模块"）。禁止整份铁律清单无声消失——每条铁律要么有 INV 条目，要么有 N/A 行。
2. **累积 FR 摘要（T3 端点）**：
   ```bash
   curl -s "$BRAIN/api/brain/line/<journey_id>/context-manifest"
   ```
   取回的累积 FR 摘要作为「已知约束」输入，写进 contract-draft.md 的 `## 已知约束` 章节（与 Step 1.2 回归测试约束同章节，标注来源 `[累积FR]`）。端点不可达时记一行 `context-manifest: unavailable`，不得静默跳过。
3. **回归测试约束**：见 Step 1.2（已有流程，不重复）。

---

### Step 1.5: 精简纪律（B50 — 防膨胀，修订轮必做）

**核心：合同收敛目标是"覆盖完 PRD"，不是"无限加严谨度"。处理 Reviewer 反馈时先减后加，净变化趋近 0。**

> "全" = PRD 每个 Golden Path 步骤 + 每个响应字段 + happy/error/edge 路径各**一条**验证（有限）。
> "复杂" = 在 PRD 之外堆"还能更健壮"的内容（无限）。

**修订轮（propose_round > 1）处理 Reviewer 反馈时：**

1. **先删后加**：先删掉上一版里 PRD 没要求的冗余（重复验证、锦上添花的额外场景、PRD 未提的字段），再加 Reviewer 指出的"PRD 真实漏覆盖"项。
2. **净变化趋近 0**：合同行数应逐轮持平或下降，不应持续增长。若你发现合同越改越大，说明在加 PRD 之外的东西——停下，回到 PRD 覆盖清单。
3. **只补"真漏覆盖"**：Reviewer 反馈里"PRD 某项没覆盖"才补；"可以更严谨/更完整/更健壮"一律忽略（这些会被 Reviewer 维度 2 超覆盖扣分，也会触发 Brain 的合同膨胀发散检测 force-approve）。
4. **scope 不蔓延**：PRD 没描述的端点/字段/场景，绝不加进合同。合同的边界 = PRD 的边界。

**自查（写完修订版必做）**：本轮合同行数 vs 上轮？若增长，逐条问"新增的每一行 PRD 要求了吗"——没要求的删掉。

---

### Step 1.6: 八要素需求规范 Checklist（decisions 27b57469/e035dad8 — 合同必含段落）

**目标**：FR/NFR 之外的隐性需求元素必须显性化，防止「表面全绿·判定方法烂·告警静默·回执缺失」类系统性故障。

写入 `contract-draft.md` 的 `## 八要素需求规范` 段（逐项必答，可 N/A 但必须显式声明）：

````markdown
## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量（安全/数据一致性/幂等） | |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见"判定点登记表"） | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

> **适用范围**：凡是"系统自行推断外部真实状态"的地方（RPA 状态判定/API 返回解读/真机反馈识别），必须逐条登记。RPA/真机/真实世界接缝类任务缺此表 → Reviewer 打回。

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ... | | | | |

> 若本次任务无接缝判定点，显式写：`（本任务无接缝判定点，N/A）`

**登记表即数据（v9.8 — 九要素 T5 通电）**：合同 APPROVED 后，reviewer Step 5 会逐行解析本表写入
`decisions category=judgment`（账本保鲜守卫「判定点活性」指标的数据源）。因此：
- 每行必须自含语义：判定点列禁止写「同上」「...」等指代；
- 示例行保留「（示例：」前缀（解析器靠它跳过）；
- **误判后果严重**（静默丢数据 / 直接面客错误 / 不可逆动作）的判定点，在判定点名前标 `⚠️`——
  这类判定点属「升拍板点主动请教用户」级别（e035dad8 第②条，用户常有更优土办法）；若 PrepPRD /
  对齐会没拍过，在合同 notes 里加一行 `judgment-pending-user: <判定点名>` 待确认。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写入 DB | 是（幂等键=task_id） | 客户端重试，Brain 端 dedup |
| ... | | | |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

> **适用范围**：对外暴露 agent（客服 agent / 爬虫内容入 pipeline / 外部用户可写入的接口）必须声明。其余任务显式写 `N/A`。

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| | | | |
````

**自查（写完本段必做）**：
- [ ] 八要素每行都有答案（N/A 必须显式）
- [ ] 判定点登记表：涉及真机/RPA/外部状态推断的点逐条列出
- [ ] 失败语义：每种关键故障场景写了放行/拦截/重试策略
- [ ] 效果确认：每个对外动作写了回执验证方式

---

### Step 1.7: GP-Anchor 声明（GP锚定闭环刀3 — cross-repo file-existence gated）

**适用范围**：仅当前仓库根目录存在 `product-map/generated/product-map.json` 时（目前只有 `zenithjoy-workspace`）。该文件不存在（如 `cecelia` 等第三方仓库）→ 本段整体跳过，在 contract-draft.md 写一行 `gp-anchor: skipped (product-map.json not found)`，不阻塞。

适用时，contract-draft.md 必须含 `## GP-Anchor` 段，三形态之一，与刀2 `lint-gp-anchor.sh` 的 CI 硬闸声明规范逐字一致：

```markdown
## GP-Anchor

GP-Anchor: <line_id>/<gp_id>#stepN      ← 推进某业务步骤（本合同的 Golden Path 须触碰该GP的smoke_files）
```

或

```markdown
## GP-Anchor

GP-Anchor: <line_id>/<gp_id> keep-green
```

或

```markdown
## GP-Anchor

GP-Anchor: none(infra|docs|config|backlog)
```

写之前用 `jq` 核实 `<line_id>/<gp_id>` 组合真实存在于 `product-map/generated/product-map.json`：

```bash
jq --arg line "<line_id>" --arg gp "<gp_id>" \
  '[.golden_paths[] | select(.line_id==$line and .id==$gp)] | length' \
  product-map/generated/product-map.json
```

结果为 0（id 不存在）→ 不得凭空声明，回头向 PRD 来源确认正确的 line/GP，或改用 `none(backlog)`（须在 PRD/合同 notes 里带 Brain issue id）。

---

### Step 2: 写合同草案（Golden Path 格式）

写入 `${SPRINT_DIR}/contract-draft.md`：

````markdown
# Sprint Contract Draft (Round {N})

## Golden Path
[入口] → [步骤1] → [步骤2] → [出口]

### Step 1: {触发描述}
**来源**: `[FROM_PRD]` — PRD 第 X 行/段直接定义（可在 PRD 原文找到对应意图）

**可观测行为**: {外部可见的结果，不写实现}

**验证命令**:
```bash
# 具体可执行命令，Evaluator 直接跑
curl -f localhost:5221/api/brain/tasks/$TASK_ID | jq '.status'
# 期望：completed
```

**硬阈值**: status = completed，耗时 < 5s

---

### Step 2: {系统处理描述}
**来源**: `[AI_ADDED]` — GAN Round N Reviewer/Proposer 加入，理由：{一句话防造假/健壮性理由}

**可观测行为**: {...}

**验证命令**:
```bash
psql $DB -c "SELECT count(*) FROM brain_alerts WHERE task_id='$TASK_ID' AND created_at > NOW() - interval '5 minutes'"
# 期望：count >= 1
```

**硬阈值**: count ≥ 1，5 分钟内写入

---

### Step N: {出口描述}
**来源**: `[FROM_PRD]` 或 `[AI_ADDED]` — {理由}

**可观测行为**: {...}
**验证命令**: `...`
**硬阈值**: ...

---

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: {autonomous|user_facing|dev_pipeline|agent_remote}
**target_environment**: {local_api|mac_web|windows_cloud|windows_wechat|linux_server|playground|android_realmachine}

> **选模板规则**：看 PRD 末尾的 `target_environment` 字段，不是 `journey_type`。evaluator 模式B 按 `target_environment` SSH 派发到正确机器，合同 E2E 脚本必须与目标机器匹配。
> `windows_wechat` 与 `windows_cloud` 的区别：前者走 xian-rog self-hosted runner（含真实微信 4.1.8），后者走 GHA windows-latest（无微信，适合 Agent 安装包/Publisher 测试）。
> **多代码块拼接语义（EVA v2 显式化）**：evaluator 1.22.0 起提取 `## E2E 验收` 段内**全部** bash 块按顺序拼接执行——推荐统一写单块；如写多块，仅第一块可含 shebang/`set -euo pipefail`，后续块必须是纯命令续体（禁止重复 shebang/set），且不得依赖块间的独立进程假设。

---

### target_environment = local_api（autonomous — curl+psql 全程链路，本地执行）

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
BASE_URL="${BASE_URL:-http://127.0.0.1:{app_port}}"
COOKIE_A=$(mktemp)
COOKIE_B=$(mktemp)
APP_PID=""
cleanup() {
  [ -z "$APP_PID" ] || kill "$APP_PID" 2>/dev/null || true
  rm -f "$COOKIE_A" "$COOKIE_B" /tmp/signup-a.json /tmp/signup-b.json
}
trap cleanup EXIT

# 1. 必须替换为仓库真实 migration/schema bootstrap；空库里机检目标表。
{run repository migration or schema bootstrap with DB_URL="$DB_URL"}
psql "$DB_URL" -tAc "SELECT to_regclass('{required_business_table}') IS NOT NULL" | grep -qx t

# 2. 启动真实 API，并等待健康端点。
{start the repository's real API with DB_URL="$DB_URL"} >/tmp/harness-api.log 2>&1 &
APP_PID=$!
for i in $(seq 1 60); do
  curl -sf "$BASE_URL/{health_endpoint}" >/dev/null && break
  [ "$i" = 60 ] && { echo "FAIL: API 未就绪"; exit 1; }
  sleep 1
done

# 3. 通过真实 signup/login/onboarding 创建两个临时主体；端点和响应路径必须按仓库实情替换。
EMAIL_A="harness-a-${RANDOM}-$(date +%s)@example.invalid"
EMAIL_B="harness-b-${RANDOM}-$(date +%s)@example.invalid"
curl -sfS -c "$COOKIE_A" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"temporary-only-Aa1!\"}" \
  "$BASE_URL/{real_signup_or_login_endpoint}" > /tmp/signup-a.json
curl -sfS -c "$COOKIE_B" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL_B\",\"password\":\"temporary-only-Bb2!\"}" \
  "$BASE_URL/{real_signup_or_login_endpoint}" > /tmp/signup-b.json
TENANT_A=$(jq -er '{real_tenant_path}' /tmp/signup-a.json)
TENANT_B=$(jq -er '{real_tenant_path}' /tmp/signup-b.json)
[ "$TENANT_A" != "$TENANT_B" ]

# 4. 用临时 cookie jar 走真实业务入口；禁止直接 INSERT 业务身份或伪造 session。
RESP=$(curl -sfS -b "$COOKIE_A" -H 'content-type: application/json' \
  -X POST "$BASE_URL/{trigger_endpoint}" -d '{real_request_body}')
TARGET_TASK_ID=$(echo "$RESP" | jq -er '.task_id')

# 5. 等待真实处理（最多 30 秒，带时间窗口防止利用历史数据造假）。
MAX_WAIT=30
for i in $(seq 1 $MAX_WAIT); do
  STATUS=$(curl -sfS -b "$COOKIE_A" "$BASE_URL/{task_status_endpoint}/$TARGET_TASK_ID" | jq -r '.status')
  [ "$STATUS" = "completed" ] && break
  [ "$i" = "$MAX_WAIT" ] && { echo "FAIL: 超时 status=$STATUS"; exit 1; }
  sleep 1
done

# 6. 验证本 attempt 空库中的真实副作用（带时间窗口）。
COUNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM {result_table} WHERE task_id='$TARGET_TASK_ID' AND created_at > NOW() - interval '5 minutes'")
[ "$COUNT" -ge 1 ] || { echo "FAIL: DB 无记录"; exit 1; }

echo "✅ Golden Path 验证通过"
```

---

### target_environment = mac_web（user_facing — Playwright 本机真实浏览器，localhost:5174）

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行）
const { chromium, expect } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: undefined }); // 每次新干净环境
  const page = await context.newPage();

  // 1. 导航到功能页（真实 Cecelia Dashboard）
  await page.goto('http://localhost:5174/{feature_path}');
  await page.waitForLoadState('networkidle');

  // 2. 模拟用户操作（填表 / 点击 / 选择）
  await page.screenshot({ path: 'screenshots/01-initial.png' });
  await page.fill('[data-testid="{input_field}"]', '{test_value}');
  await page.click('[data-testid="{submit_button}"]');
  await page.screenshot({ path: 'screenshots/02-action.png' });

  // 3. 断言 UI 响应（必须含显式断言，禁止只 navigate 不断言）
  await expect(page.locator('[data-testid="{result_element}"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="{result_element}"]')).toHaveText('{expected_text}');
  await page.screenshot({ path: 'screenshots/03-result.png' });

  // 4. 交叉验证后端状态（防止前端撒谎）
  const apiResp = await page.request.get('http://localhost:5221/api/brain/{verify_endpoint}');
  const data = await apiResp.json();
  if (data['{field}'] !== '{expected_value}') {
    console.error('FAIL: Brain 后端状态不匹配', data);
    process.exit(1);
  }

  await context.close();
  await browser.close();
  console.log('✅ Golden Path UI 验证通过');
})();
```

**BEHAVIOR:E2E 截图 DoD（mac_web user_facing sprint 合约模板末尾必须包含）**

在合约 DoD 的 `## BEHAVIOR:E2E 条目` 段末尾添加以下截图 DoD 条目，evaluator 验收后截图存入 `${SPRINT_DIR}/screenshots/<step>.png`：

```markdown
- [ ] [BEHAVIOR:E2E:screenshot] evaluator 验收后截图已存入 ${SPRINT_DIR}/screenshots/
  Screenshots:
    - 01-initial.png      期望：操作前页面初始状态，关键元素可见
    - 02-action.png       期望：用户操作后页面截图，过渡状态可见
    - 03-result.png       期望：操作完成后结果页面截图，期望变化已发生
  路径格式：${SPRINT_DIR}/screenshots/<step>.png
  期望：evaluator 完成后截图已复制到 ${SPRINT_DIR}/screenshots/ 目录
```

evaluator 完成验收后必须执行：
```bash
mkdir -p "${SPRINT_DIR}/screenshots/"
cp screenshots/*.png "${SPRINT_DIR}/screenshots/" 2>/dev/null || true
```

---

### target_environment = windows_cloud（公网 Windows 产品 — GitHub Actions windows-latest，完全干净 VM）

> 适用：ZenithJoy Agent / 任何连公网后端的 Windows App。每次运行都是全新 VM，无历史状态，public repo 免费无限次。

```powershell
# final-e2e PowerShell 脚本（在 GitHub Actions windows-latest runner 上执行）
# 环境：全新 Windows Server 2022，无任何已安装 App，无 cookie/session 历史

param(
  [string]$DownloadUrl = "{artifact_download_url}",     # 公网下载地址
  [string]$ExpectedVersion = "{expected_version}",
  [string]$CloudEndpoint = "{cloud_api_url}"             # App 连接的公网后端
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 0. 记录脚本启动时间（防造假：本轮所有产物的 LastWriteTime 必须晚于此，参照 local_api 的 created_at 时间窗）
$ScriptStart = Get-Date

# 1. 下载安装包（从公网，模拟用户点击下载）
$InstallerPath = "$env:TEMP\{app_name}-setup.exe"
Invoke-WebRequest -Uri $DownloadUrl -OutFile $InstallerPath -UseBasicParsing
if (-not (Test-Path $InstallerPath)) { throw "下载失败: $InstallerPath 不存在" }

# 2. 静默安装（模拟用户安装）
Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait -NoNewWindow

# 3. 验证安装结果
$AppPath = "${env:ProgramFiles}\{app_name}\{app_exe}"
if (-not (Test-Path $AppPath)) { throw "FAIL: 安装后程序不存在 $AppPath" }

# 3b. 时间戳防造假：安装产物必须是本轮新写入，不能是历史遗留文件冒充
$AppWrite = (Get-Item $AppPath).LastWriteTime
if ($AppWrite -lt $ScriptStart.AddMinutes(-1)) {
  throw "FAIL: $AppPath LastWriteTime=$AppWrite 早于脚本启动 $ScriptStart — 疑似历史遗留产物冒充本轮安装"
}
$InstalledVersion = (Get-Item $AppPath).VersionInfo.ProductVersion
if ($InstalledVersion -ne $ExpectedVersion) {
  throw "FAIL: 版本不匹配 installed=$InstalledVersion expected=$ExpectedVersion"
}

# 4. 启动 + 验证连接公网后端（App 的核心价值）
$Proc = Start-Process -FilePath $AppPath -PassThru
Start-Sleep -Seconds 5
if ($Proc.HasExited) { throw "FAIL: 程序启动后立即退出" }

# 验证 App 成功连上公网服务
$resp = Invoke-RestMethod -Uri "$CloudEndpoint/health" -Method GET -TimeoutSec 10
if ($resp.status -ne "ok") { throw "FAIL: App 未能连接云端 status=$($resp.status)" }

Stop-Process -Id $Proc.Id -Force
Write-Host "✅ windows_cloud E2E 验证通过 version=$InstalledVersion"
```

---

#### windows_cloud 变体 B：Playwright dryrun（ZenithJoy publisher 验证）

> 适用：sprint 目标是验证 `publish-{platform}-{type}-dryrun.cjs` 在 GitHub Actions windows-latest 上执行，非安装包交付。
> 典型场景：`zj-douyin-article-agent-port`、任何 publisher dryrun sprint。

**E2E 验收步骤（写入 `sprints/.../e2e-verify.ps1`）**：

```powershell
# final-e2e 验证脚本 — ZenithJoy publisher dryrun（windows-latest）
param(
  [string]$Platform = "{platform}",
  [string]$PublishType = "{type}",
  [string]$QueueJson = "$PSScriptRoot\test-queue.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. 安装依赖
Set-Location "$PSScriptRoot\..\.."
npm ci --prefer-offline 2>&1 | Select-Object -Last 5
npx playwright install chromium 2>&1 | Select-Object -Last 5

# 2. 创建测试队列文件
$queue = @([PSCustomObject]@{
  title   = "测试文章标题"
  content = "测试正文内容，用于 dryrun 验证。"
  cover   = ""
})
$queue | ConvertTo-Json -Depth 5 | Out-File -FilePath $QueueJson -Encoding utf8

# 3. 执行 dryrun 脚本
$scriptPath = "services\agent\publishers\$Platform-publisher\publish-$Platform-$PublishType-dryrun.cjs"
$output = node $scriptPath $QueueJson 2>&1
$lastLine = ($output | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)

if (-not $lastLine) {
  Write-Error "FAIL: 脚本无 JSON 输出"
  exit 1
}

$result = $lastLine | ConvertFrom-Json
if (-not $result.ok -or -not $result.dryRun) {
  Write-Error "FAIL: ok=$($result.ok) dryRun=$($result.dryRun)"
  exit 1
}

Write-Host "✅ dryrun 验证通过: ok=$($result.ok) dryRun=$($result.dryRun)"
exit 0
```

**PASS 标准**：脚本 exit 0 + stdout JSON `ok:true, dryRun:true`
**FAIL 标准**：exit 1 OR `ok:false` OR timeout 15min
**GHA workflow**：`.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）

---

#### windows_cloud 变体 C：Dashboard / Web App（Vite + Playwright，适用于 ZenithJoy Dashboard 功能 sprint）

> 适用：sprint 目标是验证 Dashboard（React + Vite）新页面/交互，在 GitHub Actions windows-latest 上用 Playwright 真实浏览器验收。
> 典型场景：super admin 管理页、客户管理、任何 `apps/dashboard/` 下的新 UI 功能。

**🚫 变体C 死规则（违反任意一条 → Reviewer 第 1 维 0 分，直接 REVISION）**：
1. **禁止 `page.route()`**：Playwright spec 禁止拦截任何 API 请求，所有请求必须打真实后端
2. **禁止写"不依赖真后端"/"stub"/"mock API"**：contract-draft.md `## E2E 验收` 区块严禁出现此类字样
3. **后端必须启动**：e2e-verify.ps1 必须在跑 Playwright 之前启动 `apps/api` server 并等待其就绪
4. **API 端口必须传给 Vite**：通过 `VITE_API_URL` 或 vite proxy 确保前端 API 请求打到本地真实后端
5. **Playwright spec 不得含 VITE_SKIP_AUTH=true 以外的 mock 环境变量**

**⚠️ Windows PS1 强制规则（4 条，违反会导致 CI 失败）**：
1. `npm run dev` / `npm run preview` 必须用 `Start-Process` + `-WorkingDirectory "$scriptDir\..\.."` 显式指定工作目录
2. `npx` / `npm` 在 Windows 需要 `.cmd` shim：用 `cmd.exe /c npx.cmd ...` 或 `cmd.exe /c npm.cmd ...`
3. localhost 端口检测必须用 `Test-NetConnection -ComputerName localhost -Port $Port`（避免 IPv6 解析失败）
4. Vite 端口固定 `$VitePort = 5174`，与 playwright `baseURL` 保持一致；API 端口固定 `$ApiPort = 3000`

**E2E 验收步骤（写入 `sprints/.../e2e-verify.ps1`）**：

```powershell
# final-e2e 验证脚本 — ZenithJoy Dashboard Playwright（windows-latest）
# ⚠️ 必须打真实后端，禁止 page.route() stub
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$SuperAdminEmail = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword = $env:E2E_SUPER_ADMIN_PASSWORD
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$ApiPort = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# 1. 安装依赖（必须指定 WorkingDirectory）
Write-Host "▶ Installing dependencies..."
$installProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($installProc.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

# 2. 安装 Playwright 浏览器
$playwrightProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($playwrightProc.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

# 2.5. 启动后端 API server（必须，禁止用 page.route() 代替）
Write-Host "▶ Starting API server on port $ApiPort..."
$env:DATABASE_URL = $env:E2E_DATABASE_URL
$env:NODE_ENV = "test"
$apiProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd start" `
  -WorkingDirectory "$repoRoot\apps\api" `
  -PassThru -NoNewWindow
$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: API server 未在 ${maxWait}s 内就绪 port=$ApiPort" }
Write-Host "✅ API server 就绪 port=$ApiPort"

# 3. Build + 启动 Vite preview（preview 比 dev 更快就绪）
Write-Host "▶ Building dashboard..."
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{ VITE_SKIP_AUTH = "true" }
if ($buildProc.ExitCode -ne 0) { throw "FAIL: build failed" }

Write-Host "▶ Starting Vite preview on port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

# 4. 等待 Vite 就绪
$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort" }
Write-Host "✅ Vite 就绪 port=$VitePort"

# 5. 跑 Playwright E2E（spec 禁止 page.route()，所有请求打真实后端 localhost:$ApiPort）
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\{feature}.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    E2E_BASE_URL = $BaseUrl
    E2E_EMAIL    = $SuperAdminEmail
    E2E_PASSWORD = $SuperAdminPassword
  }

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }
Write-Host "✅ windows_cloud Dashboard E2E 验证通过（真实后端）"
exit 0
```

**PASS 标准**：`e2eProc.ExitCode -eq 0` + Playwright 所有 spec 通过 + API server 已启动（无 stub）
**FAIL 标准**：任何 step exit≠0 OR API 未就绪 OR Playwright 失败 OR Vite 30s 内未就绪
**GHA workflow secrets 必须**：`E2E_SUPER_ADMIN_EMAIL`、`E2E_SUPER_ADMIN_PASSWORD`、`E2E_DATABASE_URL`（在 sprint PRD 的前置条件段中声明）

---

### windows_cloud BEHAVIOR 必须满足"用户路径 1:1 映射"规则（强制）

在写任何 `[BEHAVIOR]` 引用 GHA workflow 之前，Proposer 必须：

1. 用 Bash 工具执行 `cat .github/workflows/<workflow文件名>.yml`，读取该 workflow 的实际内容
2. 列出用户真实操作路径（每一步用户会做什么），例如：
   - 用户安装 Agent
   - 用户扫码绑定（session 写入本地文件）
   - 用户触发发布
   - Agent 读取 session 文件，注入 DOUYIN_COOKIES
   - 发布返回 ok:true，无浏览器弹出
3. 对比 workflow 里的 steps，确认每一步用户操作都有对应的 step 验证
4. 如果 workflow 缺少某个用户步骤的验证 → 必须在合同里标注 `[CI_GAP: <缺失的步骤>]` 并要求 Generator 补写 workflow step
5. **禁止将只检查文件存在/大小/版本号的 step 算作业务行为验证**

违反此规则（直接写 `[BEHAVIOR] <workflow名> PASS` 而不读 workflow 内容）→ Reviewer 第 1 维 DoD 机检性直接扣至 0 分

---

### target_environment = windows_wechat（微信 RPA — xian-rog 自托管真机，含微信 4.1.8 + UIA）

> 适用：任何 Golden Path 步骤含"微信"/"listen_chat"/"wechat_rpa"/"pyautogui" 的 Sprint。
> 机器：xian-rog self-hosted runner，标签 `wechat-capable`，微信版本已锁 4.1.8.107。
> 触发：evaluator 调 `gh workflow run e2e-wechat-rpa.yml --repo perfectuser21/zenithjoy-workspace`。

**核心禁止（违反 → Reviewer 打回）**：
- ❌ `MOCK_WECHAT_VERSION=*` — 禁止注入假版本，必须读真实微信版本
- ❌ `fakeChild = new EventEmitter()` — 禁止 mock 进程
- ❌ 把此 target 写成 `windows_cloud`（GHA 无微信，BEHAVIOR 全部假绿）

**E2E 验收步骤（写入 `sprints/.../e2e-verify.ps1`，在 xian-rog 执行）**：

```powershell
# final-e2e 验证脚本 — WeChat RPA（xian-rog 真机）
# 前提：xian-rog 已安装微信 4.1.8.107，listen_chat.py 已就绪
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 0. 记录脚本启动时间（防造假：本轮 DB 记录/产出文件的写入时间必须晚于此，参照 local_api 的 created_at 时间窗）
$ScriptStart = Get-Date

$agentDir = "$env:LOCALAPPDATA\zenithjoy-agent"   # 或 sprint 实际路径
$pythonExe = "$agentDir\python-embedded\python.exe"
$listenChat = "$agentDir\wechat-rpa\listen_chat.py"

# 1. dryrun 版本确认（读真实 listen_chat.py 版本，禁止 MOCK_WECHAT_VERSION）
$ver = & $pythonExe $listenChat --dryrun-print-version
if ($LASTEXITCODE -ne 0) { throw "FAIL: dryrun-print-version exit=$LASTEXITCODE" }
Write-Host "listen_chat version: $ver"

# 2. 真实微信进程检测（UIA 控件树验证，不注入假版本）
$wechatProc = Get-Process -Name WeChat -ErrorAction SilentlyContinue
if (-not $wechatProc) { throw "FAIL: 微信未运行，xian-rog 预置条件未满足" }

# 3. 验证核心行为（按 Golden Path 步骤写真实断言）
# 示例：listen_chat.py 监听到新消息后写 DB 记录
$result = & $pythonExe $listenChat --e2e-smoke 2>&1
if ($LASTEXITCODE -ne 0) { throw "FAIL: e2e-smoke exit=$LASTEXITCODE output=$result" }

# 3b. 时间戳防造假：本轮产出文件（如 smoke 写出的记录/截图）LastWriteTime 必须晚于脚本启动
$outFile = "$agentDir\wechat-rpa\last-smoke-result.json"   # 替换为本 sprint 实际产物路径
if (Test-Path $outFile) {
  $w = (Get-Item $outFile).LastWriteTime
  if ($w -lt $ScriptStart.AddMinutes(-1)) {
    throw "FAIL: $outFile LastWriteTime=$w 早于脚本启动 $ScriptStart — 疑似历史遗留产物冒充本轮产出"
  }
}

Write-Host "✅ windows_wechat E2E 验证通过"
exit 0
```

**PASS 标准**：脚本 exit 0 + 真实微信版本读取成功 + 核心行为断言通过
**FAIL 标准**：exit 1 OR 微信未运行 OR MOCK_* 注入（自动检测）
**GHA workflow**：`.github/workflows/e2e-wechat-rpa.yml`（`workflow_dispatch` + self-hosted `wechat-capable`）

---

### target_environment = linux_server（生产 API — SSH 到 hk-vps 执行）

```bash
#!/bin/bash
# final-e2e 脚本（由 evaluator SSH 到 hk-vps/us-vps 执行）
set -e

REMOTE_BRAIN_URL="${REMOTE_BRAIN_URL:-https://{production_domain}}"

# 1. 验证服务健康
curl -sf "$REMOTE_BRAIN_URL/api/brain/health" | jq -e '.status == "ok"' || { echo "FAIL: 服务不健康"; exit 1; }

# 2. 触发 + 验证 Golden Path
TARGET_TASK_ID=$(curl -sf -X POST "$REMOTE_BRAIN_URL/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"{task_type}","payload":{}}' | jq -r '.id')

MAX_WAIT=60
for i in $(seq 1 $MAX_WAIT); do
  STATUS=$(curl -sf "$REMOTE_BRAIN_URL/api/brain/tasks/$TARGET_TASK_ID" | jq -r '.status')
  [ "$STATUS" = "completed" ] && break
  [ "$i" = "$MAX_WAIT" ] && { echo "FAIL: 超时"; exit 1; }
  sleep 2
done

echo "✅ 生产环境 Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `tests/xxx.test.ts` | {行为列表} | → N failures |
````

**Test Contract 表「BEHAVIOR 覆盖」命名死规则（v9.5 — 07-04 四跑 4/4 踩坑）**：

「BEHAVIOR 覆盖」列写的每个覆盖名，**必须是 tests/*.test.ts 里对应 `it()`（或 `test()`）测试名的字面子串**。下游按字符串匹配把 DoD 条目对回测试用例——覆盖名和 it() 名对不上，映射就断，generator 自验与 evaluator 核对全部空转。

- ✅ **正例**：测试写 `it('POST /api/brain/tasks 返回 201 且带 task_id', ...)`，表里「BEHAVIOR 覆盖」写 `返回 201 且带 task_id`（it() 名的字面子串，能 grep 到）
- ❌ **反例**：测试写 `it('POST /api/brain/tasks 返回 201 且带 task_id', ...)`，表里写 `创建任务成功`（语义相同但不是 it() 名子串，字符串匹配失败 → 映射断裂）

**写法顺序建议**：先写 tests/*.test.ts 的 it() 名，再从 it() 名里**截取子串**填表——不要凭记忆重新措辞。写完自查：表里每个覆盖名跑 `grep -F '<覆盖名>' tests/*.test.ts` 必须命中。

**验证命令写作规范**（Reviewer 重点检查，GAN 对抗焦点）：

- 命令必须可直接执行（含 $DB/$TASK_ID 等环境变量须可替换）
- `SELECT count(*)` 必须配时间窗口（如 `AND created_at > NOW() - interval '5 minutes'`）防止造假通过
- 禁止 `echo "ok"` / `true` 假验证
- curl 必须加 `-f` flag（HTTP 5xx 才返回非0 exit code）
- Playwright 脚本必须含显式 `toBeVisible` / `toHaveText` 断言，不能只 navigate

**硬阈值 → 可执行验证命令转换规则（强制）**：

每条"**硬阈值**"（自然语言写的阈值）**必须**在合同里同时给出可执行的验证命令，禁止只写自然语言。Reviewer 第 1 维 DoD 机检性按此审查：硬阈值无对应命令 → 低分。

| 硬阈值（自然语言）| 必须给出的可执行命令 |
|---|---|
| `status = completed 且耗时 < 5s` | `START=$(date +%s); curl -fs localhost:5221/api/brain/tasks/$TID \| jq -e '.status=="completed"'; END=$(date +%s); [ $((END-START)) -lt 5 ] \|\| { echo "FAIL: 耗时 $((END-START))s ≥ 5s"; exit 1; }` |
| `count ≥ 1，5 分钟内写入` | `C=$(psql $DB -t -c "SELECT count(*) FROM t WHERE task_id='$TID' AND created_at > NOW() - interval '5 minutes'" \| tr -d ' '); [ "$C" -ge 1 ]` |
| `视频时长 > 0 且有音视频流` | `ffprobe -v error -show_entries stream=codec_type -of json out.mp4 \| jq -e '[.streams[].codec_type] \| (index("video") and index("audio"))'` |
| `UI 出现成功标志` | `await expect(page.locator('[data-testid="success"]')).toBeVisible({timeout:10000})` |

写硬阈值时，紧跟着写"验证命令"，二者成对出现；Reviewer 看到只有自然语言阈值无命令 → 视为不可机检，扣分。

### ⚠️ 假绿反模式（v7.12.0 — Bug 10 禁止，必须自查）

**反模式 1：新端点 "404-acceptable" 旁路**（test_is_red 降到 6 的根因）

Brain 的通用 404 handler 返回 `{"error": "Not Found"}` (JSON)。当你写：
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/new-endpoint/test-id)
if [ "$CODE" = "200" ]; then
  # validate 200 response
elif [ "$CODE" = "404" ]; then
  echo "OK status=404 (test UUID not in DB — 端点存在)"  # ← 这行是假绿！
fi
```
当 `new-endpoint` **路由根本没注册**时，Brain 返回 404 + `{"error":"Not Found"}`，`jq -e '.error | type == "string"'` 通过，打印 "OK"。
**所有 BEHAVIOR 全部假绿，Generator 不实现端点也能 PASS。**

**禁止** ❌：`[ "$CODE" = "404" ]` 分支接受并打印 OK（对新端点而言 404 = 路由未注册）
**必须** ✅：对新实现的端点，使用 supertest 单测（测试文件存在且运行失败），或 curl 必须要求 200（404 = FAIL）

正确写法（evaluator 模式A，测 Brain 新端点）：
```bash
# 方式1：直接要求 200（404 = 端点未实现 = FAIL）
RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$TEST_ID/detail) || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.initiative_id | type == "string"' || { echo "FAIL: schema 不符"; exit 1; }
echo OK

# 方式2：supertest 单测存在且覆盖路由（TDD 红绿证明端点注册了）
node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-detail.test.js')" || { echo "FAIL: 测试文件不存在"; exit 1; }
echo OK
```

**反模式 2：环境操作当 BEHAVIOR**（WS 实现的是代码，不是操作环境）

```bash
# ❌ 这三条在"写 e2e-screenshot-chain.test.ts"之前就能通过，不是真红
mkdir -p "${SPRINT_DIR}/screenshots/" && echo OK             # mkdir 环境无关
curl -sf localhost:5221/api/brain/health | jq -e '.ok' && echo OK  # health 检查无关本实现
touch "${SPRINT_DIR}/dummy-test.png" && echo OK              # 写别的文件不验实现
```

**禁止** ❌：`mkdir`/`touch`/`health curl`/`echo` 等与 WS 实现无关的环境操作当作 BEHAVIOR
**必须** ✅：BEHAVIOR 验证的是 WS 写的**那个文件的内容**或**那个功能的行为**

正确写法（WS5 生成 e2e-screenshot-chain.test.ts 的 BEHAVIOR）：
```bash
# 验证文件内容：WS5 没实现时这行 FAIL（文件不存在）
node -e "const c=require('fs').readFileSync('sprints/viz-v2/tests/ws5/e2e-screenshot-chain.test.ts','utf8');if(!c.includes('harness-screenshots'))process.exit(1)" || { echo "FAIL: 测试文件缺 harness-screenshots 断言"; exit 1; }
echo OK
```

### ⚠️ GAN 来源标注规则（v7.11.0 — 来源透明性）

每个 Golden Path Step **必须**在步骤标题行之后立即声明 `**来源**:` 标签：

**规则**：
- `[FROM_PRD]`：能在 PRD 里找到对应原文/意图（必须引用 PRD 具体行号或段落名称）
- `[AI_ADDED]`：proposer/reviewer 为健壮性/防造假/架构需要添加的，**必须附一句理由**（如"防止 generator 利用历史记录绕过时间窗口验证"）
- Reviewer 审查 Step 来源标签是否正确（`[FROM_PRD]` 标注的内容必须能在 PRD 原文找到）
- GAN 收敛后 harness-report 向 Notion AI Notes 写入 GAN 标注表（两列：FROM_PRD 来源步骤 | AI_ADDED 步骤+理由）

**反例（Reviewer 必须打回）**：
- `[FROM_PRD]` 标了但 PRD 里找不到对应文字 → REVISION
- `[AI_ADDED]` 没附理由 → REVISION
- 整个合同没有任何 `[AI_ADDED]` 标注但明显有 GAN 加的防造假逻辑 → REVISION（说明 proposer 没诚实标注）

### Response Schema来源优先级

写合同 Response Schema 字段名时，按以下优先级推导：

1. **PRD明确指定** → 字面用（最高优先级，不可覆盖）
2. **api_registry相似端点** → 推导用（Step 1.1读取，用于补充PRD未指定的字段命名风格）
3. **都没有** → REST惯例 + 标`[NEW_PATTERN]`注释（说明这是新增模式）

---

### ⚠️ 死规则（v7.5 — 修 Bug 8 proposer 漂 PRD 字段名）

**PRD 是法律，proposer 是翻译，不许改字段名。**

PRD `## Response Schema` 段定义的字段名（key 字面值）是**不可改的 ground truth**。Proposer **必须字面**使用 PRD 给的 key 进入 contract，不许"语义化优化"成更直观的名字。

| 类别 | 严禁 ❌ | 必须 ✅ |
|---|---|---|
| 改 response key 名 | PRD 写 `result`，contract 用 `negation`/`quotient`/`product`/`factorial`/`sum`/`value`（哪怕语义更直观）| 字面用 PRD 给的 `result` |
| 改 operation 值 | PRD 写 `"multiply"`，contract 用 `"mul"`/`"multiplication"` | 字面用 PRD 给的 `"multiply"` |
| 用禁用清单的字段名 | PRD 禁用列表含 `negation`，contract 仍用作 response key | contract response keys ⊆ PRD 允许列表 |
| 修改 schema 完整性 keys 集合 | PRD 写 `keys == ["operation","result"]`，contract 改 `keys == ["negation"]` | 字面复用 PRD 的 keys 集合 |

**实证 Bug 8（W25）**：PRD 写 `{result:-n, operation:"negate"}` + 禁用 `negation`，proposer contract 写 `{negation: result}` → generator 严守 contract 实现 `{negation:-5}` → final_evaluate FAIL → task=failed。

### 自查 checklist（contract 写完前必跑）

写完 contract-dod.md 前 proposer **必须自查**：

1. **提取 contract-draft.md Response Schema 推导段字段名** → grep 出 contract-draft.md 中 `## Response Schema` 推导段的字面 key 名（如 `result`, `operation`, `error`）
2. **提取 contract jq -e 字段名** → grep 出 contract-dod.md 里 `jq -e '.<key>'` 的字面 key 名
3. **断言**：contract keys 集合 == contract-draft.md Response Schema 推导段 keys 集合（字面相等）
4. **断言**：contract-draft.md Response Schema 推导段禁用列表里的字段名 **绝对不在** contract 任何 jq -e 命令的正向断言里出现（只能在反向 `! has(...)` 检查里）
5. **断言（v7.6 新加 — Bug 9）**：`grep -c '^- \[ \] \[BEHAVIOR\]' contract-dod.md` ≥ 4。少于 4 → contract 作废，按 Step 2b 模板补齐到 ≥ 4 条不同场景（schema 字段 + keys 完整性 + 禁用字段反向 + error path 至少各 1）
6. **假绿自查（v7.12 新加 — Bug 10）**：对每条 `[BEHAVIOR]` 命令，心想"如果对应代码**一行都没写**，这条命令会 FAIL 吗？"。答案是 YES → 真红，合格；答案是 NO（mkdir/touch/health check/404-acceptable 都能通过）→ **假绿，必须改写**
7. **Golden Path 溯源（v9.0 新加）**：对每条 `[BEHAVIOR]`，回答「这是 Golden Path 哪一步的用户可观察输出？」——答不出来 → 删掉该条目或补对应 Golden Path 步骤；命令里含 `MOCK_*` 环境变量或 mock 对象 → 不合格；Golden Path 含微信操作但 `target_environment` 写 `windows_cloud` → 路由错误，必须改 `windows_wechat`
8. **真实链路四硬规则自查（v9.10 新加）**：①涉及设备/agent 调服务端 → contract-draft.md 有 `## 真实调用方请求 shape` 段，且 DoD 请求的认证方式/字段名与之逐字段一致；②涉及第三方 API → 至少一条 [BEHAVIOR] 真 key 真请求真响应校验；③DoD 含 `force_*`/stub/假数据 → 有 `## 未覆盖真实链路清单` 段（无 mock 则显式 N/A）；④target_environment 与 ability 真实运行环境匹配（微信 RPA = windows_wechat；Android 真机段未覆盖必须入清单）
9. **禁 mock 边自查（v9.12 新加）**：contract-draft.md 有 `## 禁 mock 边清单` 段——本单涉及调度/状态机/跨模块数据传递/生命周期钩子/DB写路径之一 → 清单非空且逐条列被改的边（模块A↔模块B、代码↔DB表X），合同 tests/ 里这些边无 vi.mock/stub；空清单 → 写明理由（仅纯UI/纯文档类允许）
10. **GP-Anchor 自查（v9.18 新加）**：当前仓库存在 `product-map/generated/product-map.json` → contract-draft.md 有 `## GP-Anchor` 段，三形态之一，且 `jq` 核实 id 真实存在；文件不存在 → 有 `gp-anchor: skipped (product-map.json not found)` 一行。缺失 → contract 作废重写

任一断言 fail → contract 草案作废，**用 PRD 字面字段名 + ≥ 4 条 [BEHAVIOR] 重写**。

---

**Response Schema → jq -e codify 强制规则（v7.3 — 配合 planner v8.1 + reviewer v6.1）**：

PRD `## Response Schema` 段所有字段 + 禁用清单 + schema 完整性，**全部必须 codify 成 jq -e 命令**写进合同（按上面"死规则"字面用 PRD 字段名）。Reviewer 第 6 维 verification_oracle_completeness 会按下表逐项审查；缺一项 → < 7 分 → REVISION：

| PRD 段 | Contract 必须有的 jq -e 命令 |
|---|---|
| Success response 必填字段 `result (number)` | `curl -f /xxx \| jq -e '.result \| type == "number"'` 或 `jq -e '.result == <expected_value>'` |
| Success response 必填字段 `operation (string字面量 "multiply")` | `curl -f /xxx \| jq -e '.operation == "multiply"'` |
| Schema 完整性（顶层 keys 必须**完全等于** `["operation","result"]`）| `curl -f /xxx \| jq -e 'keys == ["operation","result"]'` |
| 禁用字段名（`sum`/`product`/`value` 等）| `! curl -f /xxx \| jq -e 'has("product")'`（禁用字段不存在）|
| Error response 必填字段 `error (string)` | `curl /xxx?bad=1 \| jq -e '.error \| type == "string"'` |

**示例（W20 /multiply 严合规版）**：

```bash
# 启服务
PLAYGROUND_PORT=3001 node server.js & SPID=$!
sleep 2

# 1. 字段值
RESP=$(curl -fs "localhost:3001/multiply?a=7&b=5")
echo "$RESP" | jq -e '.result == 35' || { echo FAIL; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "multiply"' || { echo FAIL; kill $SPID; exit 1; }

# 2. Schema 完整性 — 不允许多 key 不允许少 key
echo "$RESP" | jq -e 'keys == ["operation","result"]' || { echo FAIL; kill $SPID; exit 1; }

# 3. 禁用字段反向检查 — generator 不许漂移到 product/sum
echo "$RESP" | jq -e 'has("product") | not' || { echo "FAIL: 禁用字段 product 漏网"; kill $SPID; exit 1; }

# 4. Error path
ECODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3001/multiply?a=foo")
[ "$ECODE" = "400" ] || { echo "FAIL: 非数字未返 400"; kill $SPID; exit 1; }

kill $SPID
echo "✅ 合同 6 项 jq -e 全过"
```

**反例（W20 实证：合同太松导致 generator 漂移没被抓）**：

```bash
# ❌ 这样写 evaluator 跑了也不抓 schema drift
RESP=$(curl -f localhost:3001/multiply?a=7&b=5)
[ -n "$RESP" ] && echo "PASS"  # 只验"有响应"，generator 返 {product:35} 也过
```

**强约束总结**：PRD Response Schema 段每行字段约束 = 合同至少 1 条 jq -e 命令；禁用字段清单每个名 = 1 条 ! has() 反向检查；schema 完整性 = 1 条 keys == [...] 完整匹配。**少一条 reviewer 第 6 维就低于 7 → REVISION**。

---

### Step 2b: 写 contract-dod.md（v8.0 — 单文件，覆盖整个 Sprint）

**关键变化**：一个 Sprint 只有一个 DoD 文件（`contract-dod.md`），不再按 WS 分拆。BEHAVIOR 段内嵌可独立执行的 manual:bash 命令，Evaluator 直接跑。

### ⚠️ BEHAVIOR 数量硬阈值（v7.6 — 修 Bug 9）

`contract-dod.md` **必须 ≥ 4 条** `- [ ] [BEHAVIOR]` 条目，至少覆盖 4 类场景各一条：

1. **schema 字段值**（PRD Response Schema 每个字段一条 jq -e）
2. **keys 完整性**（`jq -e 'keys == [...]'` 整体匹配）
3. **禁用字段反向**（`! has("X")` 每个禁用名一条）
4. **error path**（非法输入返 4xx + error 字段存在）

如果 PRD 含 Response Schema 段，**每个字段还要额外 1 条** [BEHAVIOR] 验。**[BEHAVIOR] ≥ 4 数量检查由 proposer 自查 checklist 第 5 条（`grep -c` 断言）+ Reviewer 第 6 维 verification_oracle_completeness 把关**（Reviewer 第 7 维 ci_workflow_alignment 审的是 CI Workflow 内容对齐，不负责数 [BEHAVIOR]）；数量 < 4 → 自查作废重写 / Reviewer 第 6 维低分 REVISION。

### ❌ 禁止借口（v7.6 — Bug 9 实证）

W26 r3 proposer 在 contract-dod 末尾写：
> "v5.0 [BEHAVIOR] 条目已搬迁到 tests/ws1/*.test.js 的 51 个 test() 块中（DoD 纯度规则：本文件只装 [ARTIFACT]）"

**这是错的**。下列借口**全部禁止**：

- ❌ "DoD 纯度规则" — 不存在此规则。v7.4 起 DoD 必须含 [BEHAVIOR]
- ❌ "v5.0 严禁 DoD 里出现 [BEHAVIOR]" — v5.0 该规则已废止（见 changelog v7.4），现规则相反：DoD 必须内嵌 [BEHAVIOR] + manual:bash
- ❌ "BEHAVIOR 已搬到 vitest" — vitest 不被 evaluator 读，evaluator 只跑 DoD 文件 manual:bash
- ❌ "本任务行为简单，1 条够了" — API 任务至少覆盖 4 类标准场景（schema 字段 / keys 完整性 / 禁用字段反向 / error path），这是**覆盖 PRD 的下限**，不是 padding。但**上限也由 PRD 决定**：覆盖完这 4 类 + PRD 列出的字段/路径就够了，禁止为"更严谨"堆更多（见下方精简纪律 B50）

只要看到 `[BEHAVIOR] 条目已搬迁` / `DoD 纯度规则` / `v5.0` 等字眼出现在 contract-dod 文件里 → 草案作废重写。

> **GAN 阶段职责边界（澄清）**：proposer/reviewer 的 GAN 对抗阶段**只产出合同与脚本模板**（contract-draft.md 含 `## E2E 验收` 脚本、contract-dod.md、tests/）。**模式 B final-e2e 由 evaluator 作为独立 task 执行**（Brain 在代码 merge 前 dispatch `harness_evaluate`，evaluator 按 target_environment 派发跑 `## E2E 验收` 脚本）。proposer 不执行 final-e2e，只保证脚本写对、可被 evaluator 直接跑。

```bash
mkdir -p "${SPRINT_DIR}"

cat > "${SPRINT_DIR}/contract-dod.md" << 'DODEOF'
---
skeleton: false
journey_type: {journey_type}
---
# Contract DoD — Sprint: {标题}

**范围**: {实现边界}
**大小**: S/M/L

## ARTIFACT 条目

- [ ] [ARTIFACT] {文件/配置存在}
  Test: node -e "const c=require('fs').readFileSync('{path}','utf8');if(!c.includes('{pattern}'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，按 journey_type 选模板）

### journey_type = autonomous 时的 BEHAVIOR 模板（测真实 Brain/DB）

- [ ] [BEHAVIOR] {功能触发后} task 状态变 completed
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/tasks/$TARGET_TASK_ID); echo "$RESP" | jq -e ".status == \"completed\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] {副作用} DB 写入记录（带时间窗口防造假）
  Test: manual:bash -c 'COUNT=$(psql $DB -t -c "SELECT count(*) FROM {table} WHERE task_id='"'"'$TARGET_TASK_ID'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$COUNT" -ge 1 ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] {API endpoint} 返回预期 schema 字段
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/{endpoint}/$TARGET_TASK_ID | jq -e ".{field} == \"{expected_value}\""'
  期望: exit 0

- [ ] [BEHAVIOR] error path — 非法输入返 4xx + error 字段存在
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/{endpoint}/invalid"); [ "$CODE" = "400" ] || [ "$CODE" = "404" ] || exit 1; echo OK'
  期望: OK

### journey_type = user_facing 时的 BEHAVIOR 模板（模式A：API-level；模式B：Playwright）

模式A BEHAVIOR（evaluator 逐 ws 跑，API-level，测 Brain 后端逻辑）：

- [ ] [BEHAVIOR] 用户操作触发的 Brain 任务状态变更
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/tasks/$TARGET_TASK_ID); echo "$RESP" | jq -e ".status == \"completed\""'
  期望: exit 0

- [ ] [BEHAVIOR] 操作结果持久化到 DB
  Test: manual:bash -c 'COUNT=$(psql $DB -t -c "SELECT count(*) FROM {table} WHERE user_id='"'"'$TEST_USER_ID'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$COUNT" -ge 1 ] || exit 1'
  期望: exit 0

模式B E2E（final-e2e 跑，UI-level，Playwright 真实浏览器）写在 ## E2E 验收 区块（见下方）。

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path，截图可视化验证
  Screenshots:
    - 01-initial.png   期望：{页面正常加载，描述关键 UI 元素可见}
    - 02-action.png    期望：{用户操作后状态变化，描述关键变化}
    - 03-result.png    期望：{最终结果页面，描述成功标志元素}
  期望：所有截图与期望描述一致，Claude Read 图自验通过

DODEOF
```

**核心规则**（违反 reviewer 第 6 维 + 7 维直接 REVISION）：

- DoD 文件 BEHAVIOR 段**必须** ≥ 1 条 `[BEHAVIOR]` 标签 + 内嵌 `Test: manual:bash` 命令
- **禁止**只写 `## BEHAVIOR 索引` 段指向 vitest（那是 v7.3 错误格式，evaluator 不读）
- PRD 每个 response 字段 → 至少 1 条 [BEHAVIOR] 验
- PRD 每个 query parameter → 至少 1 条 [BEHAVIOR] 验（用错 query 名 endpoint 应 404 也是验证）
- error path → 至少 1 条 [BEHAVIOR] 验
- **禁文本自证型 BEHAVIOR（EVA v2）**：`grep <脚本/源码文件> 含某字符串` 型断言是文本自证——验证的是文件包含字符串而非行为发生，此类断言归 [ARTIFACT]；[BEHAVIOR] 中「真执行断言」（curl/psql/真跑脚本收 exit code/ffprobe）必须 ≥2 条且占比 ≥50%（a85e0582 实证 9 条里 6 条是文本自证）。占比由 Step 2b-check 第 7 项启发式计数把关

---

### Step 2b-check: 合同格式确定性自查（v9.5 — 机器卡，不靠自觉，产出后必跑）

**背景（07-04 四跑实证）**：4 份 contract-dod.md 无一份符合上面 Step 2b 模板；2/4 连 `## E2E 验收` 段都没有；1 跑甚至预勾 `[x]`。合同一脱模板，下游 generator 自验、evaluator manual:bash 真跑、reviewer 第 1/6 维全部空转——这是全链验收失效的单点根因。所以模板合规不能靠 LLM 自觉，必须用确定性脚本卡住。

**contract-draft.md 和 contract-dod.md 写完后，必须原样执行以下脚本（不许省略、不许只"心里过一遍"）**：

```bash
# ===== 合同格式确定性自查（任一 FAIL → 合同作废，按 Step 2 / Step 2b 模板重写后重跑本脚本）=====
SELF_CHECK_FAIL=0

# 1. [BEHAVIOR] 条目数 ≥ 4（Step 2b 硬阈值；EVA v2：锚定行首 checkbox 格式——d063b3e5 实证「## [BEHAVIOR]」标题式脱模板合同被裸 grep 计入骗过自查）
BC=$(grep -c '^- \[ \] \[BEHAVIOR\]' "${SPRINT_DIR}/contract-dod.md")
[ "$BC" -ge 4 ] || { echo "SELF-CHECK FAIL: 行首 '- [ ] [BEHAVIOR]' 格式条目只有 ${BC} 条（需 ≥4；标题式/非 checkbox 格式不计入）"; SELF_CHECK_FAIL=1; }

# 2. contract-draft.md 必须存在 ## E2E 验收 段（final-e2e 脚本载体，缺了 evaluator 模式B 无从跑）
grep -q '^## E2E 验收' "${SPRINT_DIR}/contract-draft.md" || { echo "SELF-CHECK FAIL: contract-draft.md 缺 '## E2E 验收' 段"; SELF_CHECK_FAIL=1; }

# 3. 新合同验收项必须全部未勾（- [ ]）——预勾 [x] = 还没验就宣布通过，属造假
if grep -q '^- \[x\]' "${SPRINT_DIR}/contract-dod.md"; then
  echo "SELF-CHECK FAIL: contract-dod.md 存在预勾 [x] 条目（新合同必须全部 '- [ ]' 未勾）"; SELF_CHECK_FAIL=1
fi

# 4. 每条 [BEHAVIOR] 必须带内嵌可执行命令（Test: manual:）
MC=$(grep -c 'Test: manual:' "${SPRINT_DIR}/contract-dod.md")
[ "$MC" -ge "$BC" ] || { echo "SELF-CHECK FAIL: [BEHAVIOR] ${BC} 条但 'Test: manual:' 只有 ${MC} 条（每条 BEHAVIOR 必须内嵌 manual: 命令）"; SELF_CHECK_FAIL=1; }

# 5. ## E2E 验收 段内 bash 代码块 ≥1（EVA v2 — d063b3e5 实证 E2E 段 0 个 bash 块，evaluator 提取必得空脚本）
E2E_BLOCKS=$(awk '/^## E2E 验收/{found=1; next} found && /^## /{exit} found && /^```bash/{n++} END{print n+0}' "${SPRINT_DIR}/contract-draft.md")
[ "$E2E_BLOCKS" -ge 1 ] || { echo "SELF-CHECK FAIL: E2E 验收段无 bash 代码块（evaluator 提取必得空脚本）"; SELF_CHECK_FAIL=1; }

# 6. 提取 E2E 块过 bash -n + 全角字符扫描（EVA v2 — d063b3e5 实证固化脚本带全角字符 bash bug）
awk '/^## E2E 验收/{found=1; next} found && /^## /{exit} found && /^```bash/{b=1; next} b && /^```/{b=0; next} b{print}' "${SPRINT_DIR}/contract-draft.md" > /tmp/e2e-selfcheck.sh
bash -n /tmp/e2e-selfcheck.sh || { echo "SELF-CHECK FAIL: E2E 脚本 bash 语法错误"; SELF_CHECK_FAIL=1; }
if grep -nE '[（）：，“”]\$' /tmp/e2e-selfcheck.sh; then  # 用 -E 不用 -P：macOS BSD grep 无 -P，-P 在 Mac 上直接报错致本项静默失效
  echo "SELF-CHECK FAIL: 全角标点紧贴 \$VAR（bash 3.2 下 unbound variable 崩溃，issue a638f840 实证）"; SELF_CHECK_FAIL=1
fi

# 7. BEHAVIOR 真执行断言分类计数（EVA v2 — a85e0582 实证 9 条里 6 条是文本自证；**启发式**：按 manual: 命令主体首个可执行词粗分，非精确解析，边界情况以语义自查为准）
REAL_EXEC=$(grep 'Test: manual:' "${SPRINT_DIR}/contract-dod.md" | grep -cE "manual:(bash -c ')?[[:space:]]*(curl|psql|bash|ffprobe|node)")
GREP_ONLY=$(grep 'Test: manual:' "${SPRINT_DIR}/contract-dod.md" | grep -cE "manual:(bash -c ')?[[:space:]]*grep")
[ "$REAL_EXEC" -ge 2 ] || { echo "SELF-CHECK FAIL: 真执行断言（curl/psql/bash/ffprobe/node 开头）仅 ${REAL_EXEC} 条（需 ≥2，启发式计数）"; SELF_CHECK_FAIL=1; }
[ "$REAL_EXEC" -ge "$GREP_ONLY" ] || { echo "SELF-CHECK FAIL: grep 开头文本自证条数（${GREP_ONLY}）超过真执行条数（${REAL_EXEC}）——真执行占比 <50%（启发式计数）"; SELF_CHECK_FAIL=1; }

[ "$SELF_CHECK_FAIL" -eq 0 ] && echo "✅ 合同格式自查通过" || { echo "❌ 合同脱模板，禁止交付——重写后重跑本脚本"; exit 1; }
```

**死规则**：
- 本脚本任一项 FAIL → **不许 commit/push 本轮合同**，必须重写到全过为止。交付脱模板的合同 = 本 skill 最高级违规。
- 本自查是**确定性**检查（grep 机器判定），与上面「自查 checklist」的语义自查（字段名对齐/假绿心测）互补，两者都必须做。
- 修订轮（propose_round > 1）同样必跑——Reviewer 打回后改出来的版本一样会脱模板。

---

### Step 2c: 写真实失败测试

```bash
mkdir -p "${SPRINT_DIR}/tests"
cat > "${SPRINT_DIR}/tests/xxx.test.ts" << 'TESTEOF'
import { describe, it, expect } from 'vitest';
import { targetFunction } from '../../../packages/brain/src/target-module.js';

describe('{功能名} [BEHAVIOR]', () => {
  it('{行为1}', async () => {
    const result = await targetFunction({ input: 'x' });
    expect(result).toBe('expected_value');
  });

  it('{行为2}', async () => {
    await expect(targetFunction({ bad: true })).rejects.toThrow('expected error');
  });
});
TESTEOF

# 确认 Red evidence
npx vitest run "${SPRINT_DIR}/tests/" --reporter=verbose 2>&1 | tee /tmp/sprint-red.log || true
grep -E "FAIL|failed|✗" /tmp/sprint-red.log || { echo "ERROR: 测试未产生 Red"; exit 1; }
```

---

### Step 3: GAN 收敛后拆 task-plan.json

**每轮都生成**（REVISION 轮的 task-plan 在被打回的分支上无害；APPROVED 即最后一轮 proposer 的分支，inferTaskPlan 从此读取）：

一个 Sprint = 一个 Generator = 一个 PR。task-plan.json 始终只有一个 task（ws1），Generator 读合同后一口气实现全部功能。

```bash
cat > "${SPRINT_DIR}/task-plan.json" << 'JSONEOF'
{
  "initiative_id": "${INITIATIVE_ID}",
  "journey_type": "{journey_type}",
  "journey_type_reason": "{1 句推断依据}",
  "tasks": [
    {
      "task_id": "ws1",
      "title": "{整个 Sprint 的实现目标}",
      "scope": "{What，不写 How}",
      "dod": [
        "[BEHAVIOR] {可运行验证，对应合同验证命令}",
        "[ARTIFACT] {文件存在}"
      ],
      "files": ["{预期受影响文件}"],
      "depends_on": [],
      "complexity": "S|M|L",
      "estimated_minutes": 60
    }
  ]
}
JSONEOF
```

**字段约束**：
- `task_id`: 固定 `ws1`（一个 Sprint 只有一个 task）
- `estimated_minutes`: 30 ≤ n ≤ 120
- `dod`: 至少 1 个 `[BEHAVIOR]`

---

### Step 3.1: HARNESS_GEAR=segmented 档位分支（多 workstream task-plan，v7 前 schema）

> **default 声明**：`HARNESS_GEAR` 环境变量缺失，或值不等于 `segmented` 时，本节不生效——继续走上面 Step 3 的单 `ws1` 现行为，task-plan.json 只输出 1 个 task。以下规则仅在 `HARNESS_GEAR=segmented` 时启用。

**触发条件**：controller 派发本 skill 时若在 prompt 头/env 传入 `HARNESS_GEAR=segmented`（真机 RPA / 骨架全红棋盘 + N 段串行点绿场景），Step 3 改为输出**多个 task**，schema 恢复 v7 前原样（`tasks[]` 数组，字段：`task_id`/`title`/`scope`/`dod[]`/`files[]`/`depends_on[]`/`complexity`/`estimated_minutes`）。

**段划分依据**：按 Golden Path 步骤识别"后段依赖前段真机产物"的接缝——例如 Step 1-2（骨架/环境准备）产出的真机安装包/登录态，是 Step 3+（真机操作/断言）的前置输入，接缝处即切段。段数 = 接缝数 + 1，不强行均分。

**线性链死规则**：
- `task_id` 命名 `ws1`、`ws2`……`wsN`，编号即执行顺序
- **只有 `ws1` 可以 `depends_on: []`**，`ws2` 起必须声明前置（至少含上一段 `task_id`，允许多前置）
- `estimated_minutes`：20 ≤ n ≤ 60（segmented 档位比单段 Sprint 更细粒度，故区间收窄，与 Step 3 单 ws1 档 30-120 不同）
- `dod`：每段至少 1 个 `[BEHAVIOR]`，且该 `[BEHAVIOR]` 必须是本段 scope 内可独立验证的断言（不得依赖后续段才存在的产物）

**完整两段 JSON 示例**（真机 RPA 场景：ws1=骨架环境准备，ws2=真机操作断言）：

```json
{
  "initiative_id": "${INITIATIVE_ID}",
  "journey_type": "user_facing",
  "journey_type_reason": "真机微信 RPA 操作需真实 UI 交互与截图验证",
  "tasks": [
    {
      "task_id": "ws1",
      "title": "真机环境骨架 + 登录态准备",
      "scope": "在 xian-rog 真机上准备微信登录态与目标窗口，产出后续段可复用的会话句柄",
      "dod": [
        "[BEHAVIOR] 真机微信进程存活且目标会话窗口可寻址，manual:bash 断言 pid + 窗口句柄非空",
        "[ARTIFACT] session-handle.json 写入 SPRINT_DIR"
      ],
      "files": ["scripts/wechat-session-init.ps1"],
      "depends_on": [],
      "complexity": "S",
      "estimated_minutes": 30
    },
    {
      "task_id": "ws2",
      "title": "真机消息发送 + 回执断言",
      "scope": "基于 ws1 产出的会话句柄，触发真实消息发送并断言回执",
      "dod": [
        "[BEHAVIOR] 真机发送消息后目标会话出现新记录，manual:bash 断言 UIA 读取的消息内容匹配"
      ],
      "files": ["scripts/wechat-send-verify.ps1"],
      "depends_on": ["ws1"],
      "complexity": "M",
      "estimated_minutes": 45
    }
  ]
}
```

---

### Step 4: 建分支 + push + 输出 verdict

```bash
# $PROPOSE_BRANCH 由 Brain 通过 env var 注入，不需要本地计算
# 格式：cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID 前 8 位}
git checkout -b "${PROPOSE_BRANCH}" 2>/dev/null || git checkout "${PROPOSE_BRANCH}"

git add "${SPRINT_DIR}/contract-draft.md" \
        "${SPRINT_DIR}/contract-dod.md" \
        "${SPRINT_DIR}/tests/" \
        "${SPRINT_DIR}/task-plan.json" 2>/dev/null  # 每轮生成；2>/dev/null 防御 LLM 偶发漏写（下游 inferTaskPlan 兜底报错）

git commit -m "feat(contract): round-${PROPOSE_ROUND} Golden Path draft + DoD + tests + task-plan"
git push origin "${PROPOSE_BRANCH}"
```

**结果文件写入**（每轮 — 含被 REVISION 打回轮）：

```bash
# 写结果文件（Brain 读文件，不读 stdout；容器内 /workspace，宿主 fallback 用 WORKSPACE_PATH）
cat > "${WORKSPACE_PATH:-/workspace}/.brain-result.json" << BREOF
{"propose_branch":"${PROPOSE_BRANCH}","workstream_count":1,"task_plan_path":"${SPRINT_DIR}/task-plan.json"}
BREOF
echo "[proposer] .brain-result.json 写入完成 propose_branch=${PROPOSE_BRANCH}"
```

**输出契约（v8.0.0+ — 文件协议）**：

proposer 调用结束时必须向 `${WORKSPACE_PATH:-/workspace}/.brain-result.json` 写入 JSON（与 evaluator 同款宿主 fallback 写法）：
- `propose_branch`：Brain 注入的 `$PROPOSE_BRANCH` 值
- `workstream_count`：固定为 1（一个 Sprint = 一个 Generator）
- `task_plan_path`：`${SPRINT_DIR}/task-plan.json`

Brain 读此文件获取结果，不解析 stdout。`$PROPOSE_BRANCH` 由 Brain 注入，proposer 直接使用。

---

## GAN 对抗焦点（Reviewer 重点审查项）

除"做没做对的事"外，Reviewer 还必须审查**验证命令是否能造假通过**：

- "这个 `SELECT count(*)` 没有时间窗口约束，手动 INSERT 一条就绕过，需加 `AND created_at > NOW() - interval '5 minutes'`"
- "Playwright 脚本缺 `await expect(locator).toBeVisible()` 超时，可能假绿"
- "验证命令依赖 `$TASK_ID` 但前面没有 INSERT 步骤，环境变量未定义"
- "curl 命令没有 `-f` flag，HTTP 500 也返回 exit 0"

---

## Contract Gate 合规惯用法速查表（v9.2.0 — 写断言前必读）

合同在 GAN 收敛时与 evaluate 前会过**代码层确定性 Contract Gate**（packages/brain/src/lib/contract-gate.js）。
**跨 repo 跳过规则（刀3）**：该文件不存在（第三方 repo / 非 cecelia worktree）→ 跳过代码层 Contract Gate，仅执行本 skill 内置规则审查（本速查表 + 自查 checklist + Reviewer 维度），并在合同 notes 里记一行 `contract-gate: skipped (file not found, third-party repo)`；cecelia 场景原逻辑不动。
以下惯用法是 2026-06-11/12 四轮规则进化（#3351/#3353/#3357/#3358）后 gate 认可的标准写法——照写直接过，不照写会被 REVISION 打回烧轮次：

| 意图 | ✅ gate 认可写法 | ❌ 会被命中 |
|---|---|---|
| API 值断言 | 同一 pipeline：`curl -sf URL \| jq -e '.field == "x"'`；或捕获后 **5 条语句内**对同名变量断言：`RESP=$(curl -sf URL)` + `echo "$RESP" \| jq -e '...'` | 裸 `curl -f URL` 无任何值校验；捕获后 5 句内无断言 |
| 状态码 oracle（body 刻意丢弃，如归档/探活） | `CODE=$(curl -s -o /dev/null -w "%{http_code}" ...)` + `[ "$CODE" = "200" ]`（-w %{http_code} 即被识别） | `curl -sf URL -o /dev/null \|\| echo WARN`（不会 fail 的探测） |
| 负向测试（预期失败） | 单语句：`cmd && { echo FAIL; exit 1; } \|\| true`；或捕获形态：`LOG=$(cmd 2>&1 \|\| true)` + 5 句内断言 `$LOG`；或 `if cmd; then echo FAIL; exit 1; fi` | 裸 `cmd \|\| true`（无捕获无后续断言）——这是吞错 |
| DB 时效防伪 | **计数/聚合断言**必须带时间窗：`count(*) ... AND created_at > NOW() - interval '5 minutes'`（预捕获时间戳变量比较同样可，但写 NOW() 形态最稳） | 计数无时间窗（历史数据可冒充本轮产出） |
| DB 定点读 | `SELECT status FROM t WHERE id='$ID'` 直接写，**不需要**时间窗（规则按断言意图分型，定点读/INSERT/UPDATE 不命中） | — |
| 文件检查 | 一步到位验内容：`grep -q '关键内容' file \|\| { echo FAIL; exit 1; }`（存在性被内容断言隐含覆盖） | 仅 `test -f file`（存在 ≠ 正确）——若确需独立前置守卫，与内容断言相邻或 gate-allow |
| 注释 | 注释行（行首 #）不参与扫描，可自由解释意图 | — |
| 确属误报/特例 | 在合同中加独立一行：`gate-allow: <rule-id> <一句话理由>`（豁免留痕，gate 输出会展示）。rule-id 见命中反馈，如 weak-oracle/curl-no-jq、cheat/or-true | 反复改写法绕规则字面而不改实质 |

**写完合同自查**：每条 [BEHAVIOR]/E2E 命令对照上表过一遍，比被 gate 打回一轮便宜得多。

## 禁止事项

1. **合同格式用 `## Feature 1 / ## Feature 2`** → v7 必须改为 Golden Path Steps
2. **验证命令用 `echo "ok"` / `true`** → 假验证，Reviewer 必须打回
3. **autonomous BEHAVIOR 命令测 playground 服务器** → `cd playground && node server.js` 等只能出现在明确标注 `is_skeleton: true` 的 playground 训练 sprint 里；真实功能 sprint 必须测 `localhost:5221`（Brain）
4. **user_facing 模式B E2E 不含 Playwright 断言** → 只有 curl 没有 `toBeVisible/toHaveText` 等 UI 断言 = 假 E2E，Reviewer 打回
5. **禁止在 main 分支操作**
6. **windows_wechat 路由错误**（v9.0）→ Golden Path 含微信操作但 `target_environment` 写成 `windows_cloud` → BEHAVIOR 在 GHA runner（无微信）上全部假绿，Reviewer 打回；反之亦然（非微信功能写 `windows_wechat` 也错）

---

## Relay 模式出口协议（T5，harness-controller 派发时生效）

当你是 harness-controller 的 subagent（派发 prompt 声明"按 Relay 出口协议报告"）时：
**上面所有流程与结果文件输出一字不变**（双轨期 v1 图仍消费 `.brain-result.json`），只在报告最末尾追加一行：

```
RELAY_STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
```

| 状态 | 何时用 | 必须附带 |
|---|---|---|
| DONE | 合同三产物齐（contract-draft.md + contract-dod.md + tests/）且 Step 2b-check 确定性自查全过、task-plan.json 已生成 | propose_branch + 自查脚本输出（✅ 合同格式自查通过） |
| DONE_WITH_CONCERNS | 合同已交付但有疑虑（如 registry 为空全靠 [NEW_PATTERN] 推导、PRD 缺 Response Schema 段、接缝清单存在未真验项） | 疑虑清单 |
| NEEDS_CONTEXT | 缺信息无法起草/修订（如 sprint-prd.md 缺失、PROPOSE_ROUND/SPRINT_DIR 未注入、Reviewer 反馈拿不到） | 确切缺什么（controller 补料后原模型重派） |
| BLOCKED | 干不了 | 原因分类：缺上下文 / 需更强推理 / 任务太大该拆 / PRD 本身矛盾该上报 |

**铁律**：卡住绝不静默原地重试——报 BLOCKED 让 controller 改变某样东西（补料/换模型/拆任务），这是"绝不让同一 agent 无变化重试"协议的工人侧义务。Step 2b-check 自查不过属于**自己能修**的问题，重写到过为止，不算 BLOCKED。
