---
id: harness-contract-proposer-skill
description: |
  Harness Contract Proposer — Harness v5 GAN Layer 2a：
  读 PRD，GAN 对抗写 Golden Path 合同（每步含真实验证命令）；
  Reviewer APPROVED 后倒推拆 task-plan.json。
version: 9.1.0
created: 2026-04-08
updated: 2026-06-11
changelog:
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

判断领域以 Golden Path + journey_type + target_environment 为准。视频类合同缺 ffprobe、发布类缺真实出现验证、DB 类缺时间窗、UI 类缺可见断言 → 合同不合格，必须补齐再交 Reviewer。

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

## 执行流程

### Step 1: 读取 PRD

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_ROUND、INITIATIVE_ID、DB 由 cecelia-run 通过 prompt 注入，直接使用
# 每次调用 = 一轮 GAN；Brain 的 harness-gan-graph.js 管理轮次循环和 APPROVED/REVISION 路由
# DB: postgresql://localhost/cecelia（或 $DB_URL）
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
**target_environment**: {local_api|mac_web|windows_cloud|windows_wechat|linux_server|playground}

> **选模板规则**：看 PRD 末尾的 `target_environment` 字段，不是 `journey_type`。evaluator 模式B 按 `target_environment` SSH 派发到正确机器，合同 E2E 脚本必须与目标机器匹配。
> `windows_wechat` 与 `windows_cloud` 的区别：前者走 xian-rog self-hosted runner（含真实微信 4.1.8），后者走 GHA windows-latest（无微信，适合 Agent 安装包/Publisher 测试）。

---

### target_environment = local_api（autonomous — curl+psql 全程链路，本地执行）

```bash
#!/bin/bash
set -e

# 1. 注入测试数据 / 触发入口（操作真实 Brain API）
TARGET_TASK_ID=$(psql $DB -t -c "INSERT INTO tasks (task_type, status, payload) VALUES ('{task_type}', 'queued', '{}') RETURNING id" | tr -d ' ')

# 2. 触发处理（tick 或主动 POST）
curl -f -X POST localhost:5221/api/brain/{trigger_endpoint}

# 3. 等待处理（最多 30 秒，带时间窗口防止利用历史数据造假）
MAX_WAIT=30
for i in $(seq 1 $MAX_WAIT); do
  STATUS=$(curl -sf localhost:5221/api/brain/tasks/$TARGET_TASK_ID | jq -r '.status')
  [ "$STATUS" = "completed" ] && break
  [ "$i" = "$MAX_WAIT" ] && { echo "FAIL: 超时 status=$STATUS"; exit 1; }
  sleep 1
done

# 4. 验证副作用（DB 状态，带时间窗口）
COUNT=$(psql $DB -t -c "SELECT count(*) FROM {result_table} WHERE task_id='$TARGET_TASK_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
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

**⚠️ Windows PS1 强制规则（4 条，违反会导致 CI 失败）**：
1. `npm run dev` / `npm run preview` 必须用 `Start-Process` + `-WorkingDirectory "$scriptDir\..\.."` 显式指定工作目录
2. `npx` / `npm` 在 Windows 需要 `.cmd` shim：用 `cmd.exe /c npx.cmd ...` 或 `cmd.exe /c npm.cmd ...`
3. localhost 端口检测必须用 `Test-NetConnection -ComputerName localhost -Port $VitePort`（避免 IPv6 解析失败）
4. Vite 端口固定 `$VitePort = 5174`，与 playwright `baseURL` 保持一致；`npm run preview` 用 `--port $VitePort`

**E2E 验收步骤（写入 `sprints/.../e2e-verify.ps1`）**：

```powershell
# final-e2e 验证脚本 — ZenithJoy Dashboard Playwright（windows-latest）
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$SuperAdminEmail = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword = $env:E2E_SUPER_ADMIN_PASSWORD
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
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

# 3. Build + 启动 Vite preview（preview 比 dev 更快就绪）
Write-Host "▶ Building dashboard..."
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow
if ($buildProc.ExitCode -ne 0) { throw "FAIL: build failed" }

Write-Host "▶ Starting Vite preview on port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

# 4. 等待服务就绪（Test-NetConnection 兼容 IPv6/IPv4）
$maxWait = 30
$waited = 0
do {
  Start-Sleep -Seconds 1
  $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort" }
Write-Host "✅ Vite 就绪 port=$VitePort"

# 5. 跑 Playwright E2E（写在 apps/dashboard/e2e/<feature>.spec.ts）
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\{feature}.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    BASE_URL = $BaseUrl
    E2E_EMAIL = $SuperAdminEmail
    E2E_PASSWORD = $SuperAdminPassword
  }

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }
Write-Host "✅ windows_cloud Dashboard E2E 验证通过"
exit 0
```

**PASS 标准**：`e2eProc.ExitCode -eq 0` + Playwright 所有 spec 通过
**FAIL 标准**：任何 step exit≠0 OR Playwright 失败 OR Vite 30s 内未就绪
**GHA workflow**：`.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）
**secrets 必须**：`E2E_SUPER_ADMIN_EMAIL`、`E2E_SUPER_ADMIN_PASSWORD`（在 sprint PRD 的认证前提条件段中声明）

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
# 写结果文件（Brain 读文件，不读 stdout）
cat > /workspace/.brain-result.json << BREOF
{"propose_branch":"${PROPOSE_BRANCH}","workstream_count":1,"task_plan_path":"${SPRINT_DIR}/task-plan.json"}
BREOF
echo "[proposer] .brain-result.json 写入完成 propose_branch=${PROPOSE_BRANCH}"
```

**输出契约（v8.0.0+ — 文件协议）**：

proposer 调用结束时必须向 `/workspace/.brain-result.json` 写入 JSON：
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

## 禁止事项

1. **合同格式用 `## Feature 1 / ## Feature 2`** → v7 必须改为 Golden Path Steps
2. **验证命令用 `echo "ok"` / `true`** → 假验证，Reviewer 必须打回
3. **autonomous BEHAVIOR 命令测 playground 服务器** → `cd playground && node server.js` 等只能出现在明确标注 `is_skeleton: true` 的 playground 训练 sprint 里；真实功能 sprint 必须测 `localhost:5221`（Brain）
4. **user_facing 模式B E2E 不含 Playwright 断言** → 只有 curl 没有 `toBeVisible/toHaveText` 等 UI 断言 = 假 E2E，Reviewer 打回
5. **禁止在 main 分支操作**
6. **windows_wechat 路由错误**（v9.0）→ Golden Path 含微信操作但 `target_environment` 写成 `windows_cloud` → BEHAVIOR 在 GHA runner（无微信）上全部假绿，Reviewer 打回；反之亦然（非微信功能写 `windows_wechat` 也错）
