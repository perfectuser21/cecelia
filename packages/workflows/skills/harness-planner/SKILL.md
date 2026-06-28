---
id: harness-planner-skill
description: |
  【Brain 内部节点，禁止人类直接调用】
  Harness Planner — Brain executor 在 harness_initiative 任务中自动调用的 Layer 1 节点。
  人类启动 harness/sprint 通过 /dev 路径C（POST localhost:5221/api/brain/tasks，task_type=harness_initiative）。
  Brain tick 自动 pick up 后调本 skill。直接调本 skill = 绕过 Brain 调度层，违反 zero-human-gate 原则。
version: 8.10.0
created: 2026-04-08
updated: 2026-06-11
changelog:
  - 8.10.0: 链路审计修复 4 项 — (a) target_environment 推断改为明确 if-elif 优先级链（dashboard→mac_web / windows app→windows_cloud / 微信 RPA→windows_wechat / 服务器→linux_server / 纯 API→local_api / playground 训练→playground），删除含糊的"取起点最靠前"；(b) journey_id 大小写统一为 journey_id（小写）+ 注明来源 task.payload.journey_id；(c) sprint-prd.md 模板补 ## E2E 验收 占位区块（初稿可空，最终脚本由 proposer 产出）+ journey_id/step_id 来源说明；(d) 常见错误 #2 加 ❌/✅ 正反例
  - 8.9.0: 明确"只做Scope锚定"原则；sprint-prd.md模板加journey_id+step_id强制字段
  - 8.8.0: 删Response Schema必填段（职责归Proposer Step 1.1）；Step 0.1加initiative_runs Run历史查询
  - 8.7.0: thin-slice 行数上限从 ≤50 调整为 ≤100 — 实测含 smoke script 的真实 PRD 常见 80-110 行，50 行限制在 eval 中持续误报；保留"禁止 254 行 medium/thick PRD"的精神，只放宽数字
  - 8.6.0: 删除 windows_local — 所有 Windows 测试统一走 windows_cloud（GitHub Actions windows-latest）；Cecelia 是内网产品走 mac_web/local_api，无需 windows_local；target_environment 从 6 种缩减为 5 种
  - 8.5.0: 加 target_environment 字段 — Step 0.5 新增推断规则，PRD 模板末尾新增 target_environment 行；evaluator 模式B 按此字段派发到正确机器执行 E2E
  - 8.4.0: Step 0 位置词死规则（B33 — W43 实证）— planner 把 playground 漂移到 brain route，强制 thin_prd 位置词原样映射到实现模块
  - 8.3.0: Step 0 thin_prd 主题死规则（B20 — W41 实证）— planner 把 task title 当主题导致 PRD 偏题，强制 thin_prd 关键词字面照搬到 sprint-prd.md，禁止用 task title 当主题
  - 8.2.0: Response Schema 段加"Query Parameters"子段 — W22 实证 generator 漂移到 query 名 a/b（PRD 写 base/exp）。补充 query 名约束 + 禁用别名清单，配合 proposer v7.4 强制每个 query 1 条 [BEHAVIOR]
  - 8.1.0: 加"## Response Schema"段 — API 任务必填，强制 planner 把响应字段名/类型 codify 成可机检 oracle，避免 W19/W20 类 generator schema 漂移（{result→sum/product}）。Anthropic harness-design 推荐 contract is law；schema 在 PRD 阶段就锁死，proposer/generator/evaluator 全链下游有 ground truth
  - 8.0.0: Golden Path PRD — 去掉任务拆分（Step 3）；PRD 格式从"功能需求 FR-001"改为 Golden Path（入口→步骤→出口）；journey_type 保留写入 PRD 末尾
  - 7.0.0: Working Skeleton — Step 0.5 journey_type 推断（4 类）+ Skeleton Task 强制首位
  - 6.0.0: Harness v2 M2 — 强制 4-5 Task
  - 5.0.0: Step 0 升级 Brain API 上下文采集 + 歧义自检（9类）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，直接按本文档流程操作。**

# /harness-planner — Harness Initiative Planner（阶段 A · Layer 1）

**角色**: Planner（Initiative 级规划师）
**对应 task_type**: `harness_initiative`（v2）/ `harness_planner`（v1 兼容）

---

## 核心原则

- **只做 Scope 锚定**：Planner 唯一职责 = 把 dev 产出的 Golden Path 映射到具体 Journey Step，写入 sprint-prd.md。不查代码，不查新上下文，只用 PrepPRD 里已有信息做锚定。
- **只写 What，不写 How**：PRD 描述用户看到的行为，不描述实现路径
- **Golden Path 优先**：PRD 围绕核心使用场景（入口→关键步骤→出口）组织，不按功能列表
- **不拆任务**：Planner 只写 PRD；任务 DAG 由 Proposer 在合同 GAN 确认后从 Golden Path 倒推

---

## Thin Slice 字数硬上限（v8.X — B14 加，2026-05-12）

为防 planner 把 thin slice 写成 medium thick spec（W36 实证 254 行 PRD）：

- **thin slice PRD ≤ 100 行**（含 smoke script 区块；禁止写历史背景、实现路径、OKR 叙事）
- **thin slice DoD ≤ 8 条**（不分 BEHAVIOR/ARTIFACT 总数 ≤ 8）
- 超 → planner 自审 reject + 强制砍范围 / 拆 multi-sprint

**反例**：W36 planner 254 行 PRD + 32 DoD 条目，引用 W19-W26 全部历史 + B1-B13 全部 fix 上下文 → 不是 thin slice 是 medium thick。

**正例**：含 Golden Path + Response Schema + smoke script 的完整 thin PRD，80-90 行以内。

---

## 执行流程

### Step 0: thin_prd 主题死规则（B20 — W41 实证）

**第一件事**：读 `task.payload.thin_prd`，把它当**产品法律**。sprint-prd.md 必须含 thin_prd 关键词字面。

**死规则**：

1. thin_prd 写 "加 /ping" → sprint-prd.md 主题必须含 "/ping" 字面，禁止改成 /decrement / /negate / 别的 endpoint
2. **禁止把 task title 当 PRD 主题**（W41 实证：title "B19 修后真验"，planner 误当主题 → 偏题写"测 B19 演练"）
3. task title 是元数据（任务标记），thin_prd 是产品意图，两者优先级 thin_prd > title

**自查 checklist**（写完 sprint-prd.md 后必 grep）：

- [ ] grep "## Golden Path" 段含 thin_prd 关键词字面
- [ ] endpoint 描述含 thin_prd 主题字面
- [ ] 主题词字面相等（不能同义改写："/ping" 不能改成 "/health-check"）

**违规示例**（禁止）：

- thin_prd "/ping" → PRD 主题"测演练" ❌
- thin_prd "/decrement" → PRD 主题 "/abs" ❌

**正确示例**：

- thin_prd "/ping" → PRD 主题 "/ping endpoint 实现" ✅

### 位置词死规则（B33 — W43 实证）

**第二件事**：检查 thin_prd 是否含**位置词**（模块/目录名），保证实现落在正确模块。

**死规则**：

1. thin_prd 含 "playground" → 代码必须写在 `playground/server.js`，禁止放 `packages/brain/src/`
2. thin_prd 含 "Brain" / "brain" / "Brain API" → 代码写在 `packages/brain/src/`
3. thin_prd 含 "dashboard" → 代码写在 `apps/dashboard/`
4. thin_prd 含 "apps/api" → 代码写在 `apps/api/`
5. thin_prd 无明确位置词 → 遵循 Step 0.5 journey_type 推断

**自查 checklist**（写完 sprint-prd.md 后必 grep）：

- [ ] thin_prd 含哪个位置词 → PRD 的实现位置描述必须与之一致
- [ ] 禁止跨模块漂移（playground → brain route / brain route → playground）

**违规示例**（禁止）：

- thin_prd "playground 加 GET /ping" → PRD 写 `packages/brain/src/routes/status.js` 加 `/api/brain/ping` ❌

**正确示例**：

- thin_prd "playground 加 GET /ping" → PRD 写 `playground/server.js` 加 `GET /ping` ✅

---

### Step 0.2: e2e 脚本位置词死规则（B33 — W35/W43 实证）

**第二件事**：如果本 sprint 涉及 playground 端点（`/ping`/`/sum`/`/multiply` 等），在 PRD 末尾写 `## E2E 验收` 区块时，**必须执行如下位置词检查**：

**位置词定义**：URL 前缀用于标识被测服务：
- `localhost:3000/`（或 `localhost:$PLAYGROUND_PORT/`）→ playground（被测服务）✅
- `localhost:5221/api/brain/` → Brain API（调度/决策层）❌ 不可出现在 playground 的 e2e 中

**死规则**（违反 → evaluator 在运行时以 `planner_drift` 标签拦截，task=failed）：

| 类别 | 严禁 ❌ | 必须 ✅ |
|------|---------|---------|
| playground 端点验证 | `curl localhost:5221/api/brain/ping` | `curl localhost:3000/ping` 或 `localhost:$PLAYGROUND_PORT/ping` |
| 健康检查混用 | 在 playground sprint 的 e2e 里用 Brain `/api/brain/ping` 确认"服务存活" | 在 playground 自己的端口上测自己的端点 |
| 端口混淆 | 5221（Brain 调度端口）出现在 playground e2e 命令 | 3000 / $PLAYGROUND_PORT（playground 端口）|

**自查 checklist**（写完 `## E2E 验收` bash 脚本后必 grep）：

```bash
# 禁止项：playground sprint 的 e2e 里不得出现 Brain API URL
! grep -qE "localhost:5221/api/brain/|/api/brain/(ping|health|tasks)" /tmp/e2e-draft.sh \
  || { echo "FAIL: e2e 含 Brain URL，请改用 localhost:3000（planner_drift 将被 evaluator 拦截）"; exit 1; }
```

**违规示例**（W35-W43 根因，禁止重复）：

```bash
# ❌ playground sprint 里写 Brain ping 做 Step 1
curl -f localhost:5221/api/brain/ping  # 这是 Brain 健康检查，不是 playground 验证
```

**正确示例**（playground sprint /ping 的 e2e）：

```bash
# ✅ 启 playground + 测自己的端点
cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!
sleep 2
curl -f localhost:3001/ping | jq -e '.pong == true'
kill $SPID
echo "✅ playground /ping 验证通过"
```

---

### Step 0.1: 采集系统上下文（Brain API）

```bash
curl localhost:5221/api/brain/context
```

从返回提取：
- **OKR 进度**：当前活跃 KR，判断本任务推进哪个 KR
- **活跃任务**：避免重复
- **最近 PR**：了解系统演进方向
- **有效决策**：PRD 不能与之矛盾

**边界**：只读运行时上下文，不探索代码实现细节。

**Journey Run 历史（initiative_runs）**：读 `task.payload.journey_id`（统一小写 `journey_id`，来源 = /dev 路径 C 点火时写入的 `payload.journey_id`），非空则：

```bash
curl "localhost:5221/api/brain/harness/runs?limit=10"
```

取前 5 条，提取字段：`id` / `phase` / `started_at` / `completed_at` / `failure_reason`，用于感知本 Journey 已跑过的 Sprint 历史、当前卡点与失败原因，避免 PRD 重复已完成范围。

---

### Step 0.5: 推断 journey_type + target_environment

**journey_type**（决定"测什么"）：

**明确 if-elif 优先级链（命中即停，不再用含糊的"取起点最靠前"）**：

```
if 涉及 apps/dashboard/                          → user_facing
elif 涉及远端 agent 协议 / bridge / cecelia-run  → agent_remote
elif 涉及 packages/engine/（hooks/skills）        → dev_pipeline
elif 涉及 packages/brain/（或纯后端）             → autonomous
else（无路径线索）                                → autonomous（默认）
```

> 多路径命中时按上面顺序从上往下匹配，第一个命中的即结果（UI > agent 协议 > engine > brain）。

**target_environment**（决定"在哪台机器跑 E2E"）：

| 场景 | target_environment | 执行位置 | 说明 |
|---|---|---|---|
| Cecelia Dashboard / Web UI | `mac_web` | 本机 Playwright | localhost:5174，context 原生隔离 |
| **Windows 产品**（ZenithJoy Agent 等）| **`windows_cloud`** | **GitHub Actions windows-latest** | 完全干净 VM，public repo 免费无限次，永远无历史状态 |
| **微信 RPA**（Path 4 个微接管）| **`windows_wechat`** | **xian-rog self-hosted runner** | 真实微信 4.1.8 已登录环境，xian-rog 注册为 GHA self-hosted |
| 生产 API 验证 | `linux_server` | SSH hk-vps / us-vps | curl + psql |
| Brain 内部 / 纯后端 | `local_api` | 本地 evaluator | curl localhost:5221 + psql |
| playground 训练 sprint | `playground` | 本地 | node playground/server.js |

**明确 if-elif 优先级链（命中即停，从上往下第一个命中即结果）**：

```
if is_skeleton=true 或 thin_prd 含 "playground"        → playground   （playground 训练优先判，避免被后面规则吞掉）
elif 涉及 apps/dashboard/ 或前端页面 / 浏览器打开 Cecelia → mac_web
elif Windows App（ZenithJoy Agent / Publisher 安装包等）  → windows_cloud（GitHub Actions windows-latest）
elif 微信 RPA / wechat_rpa / listen_chat / Path4 个微    → windows_wechat（xian-rog self-hosted 真机）
elif 涉及生产部署 / 远端服务器                            → linux_server（SSH hk-vps / us-vps）
elif 仅 packages/brain/ 或纯 API / 后台任务              → local_api
else                                                    → local_api（默认）
```

> 优先级理由：playground 训练 sprint 必须最先判（否则"涉及 brain"会把它误判 local_api）；微信 RPA 必须在 windows_cloud 之后单独判（GHA 无微信，写错会全部假绿）。

记录：`journey_type: <值>` + `target_environment: <值>`，写入 PRD 末尾。两个字段**缺一不可**，proposer 和 evaluator 都依赖这两个字段。

---

### Step 1: 歧义自检（9 类扫描）

在输出 PRD 前对需求描述执行扫描：

| # | 歧义类型 | 检查内容 |
|---|----------|----------|
| 1 | 功能范围 | 哪些功能在范围内，哪些排除 |
| 2 | 数据模型 | 涉及哪些数据结构 |
| 3 | UX 流程 | 用户交互路径 |
| 4 | 非功能需求 | 性能/安全/兼容性 |
| 5 | 集成点 | 依赖哪些外部系统 |
| 6 | 边界情况 | 异常/空状态/并发 |
| 7 | 约束 | 技术栈/框架/部署环境 |
| 8 | 术语 | 关键术语歧义 |
| 9 | 完成信号 | 验收标准 |

无法推断的写 `[ASSUMPTION: ...]` 进 PRD 假设列表。**只有方向性歧义才向用户提问**（预期 0-1 问题）。

---

### Step 2: 输出 sprint-prd.md（Golden Path 格式）

```bash
# SPRINT_DIR 由 cecelia-run 通过 prompt 注入（如 sprints/run-20260506-1400）
# 直接使用，无需手动设置
mkdir -p "$SPRINT_DIR"
```

模板（不留占位符）：

```markdown
# Sprint PRD — {目标名称}

## OKR 对齐

- **对应 KR**：KR-{编号}（{标题}）
- **当前进度**：{X}%
- **本次推进预期**：{Y}%

## 背景

{为什么做，关联 OKR/决策}

## Golden Path（核心场景）

用户/系统从 [入口] → 经过 [关键步骤] → 到达 [出口]

具体：
1. [触发条件]
2. [系统处理]
3. [可观测结果]

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- {异常/空/并发}

## 范围限定

**在范围内**：...
**不在范围内**：...

## 假设

- [ASSUMPTION: ...]

## 预期受影响文件

- `path/to/file`: {为何受影响}

## E2E 验收

> Planner 初稿此区块**可留空**（只写占位 + 期望验收点的自然语言描述）。**最终可执行的 E2E 脚本由 proposer 在 GAN 阶段产出**（按 target_environment 选 bash/.ps1 模板，写进 contract-draft.md 的 `## E2E 验收` 区块）。Planner 在此先框定"端到端要验到什么"，供 proposer 翻译成命令。

```bash
# 占位：proposer 将按 target_environment 填入真实脚本（local_api→curl+psql / mac_web→Playwright / windows_*→ps1）
# 期望验收点（自然语言）：{从入口到出口，用户/系统可观察到的最终结果}
```

## journey_type: autonomous|user_facing|dev_pipeline|agent_remote
## journey_type_reason: {1 句推断依据}
## target_environment: mac_web|windows_cloud|windows_wechat|linux_server|local_api|playground
## target_environment_reason: {1 句推断依据，含目标机器名（如 GitHub Actions、hk-vps、localhost:5174）}
## journey_id: <Journey UUID，来源 = task.payload.journey_id（/dev 路径 C 点火写入），缺则取 PrepPRD 锚定结果>
## step_id: <Step UUID 或 step code，如 L01-S5，来源 = PrepPRD Golden Path 锚定结果>
```

---

### Step 3: push + 返回

```bash
git checkout -b "cp-$(TZ=Asia/Shanghai date +%m%d%H%M)-harness-prd"
git add "$SPRINT_DIR/sprint-prd.md"
git commit -m "feat(harness): Initiative PRD — {目标}"
git push origin HEAD 2>/dev/null || echo "[harness-planner] push skipped (no creds), commit retained on local branch"
```

**最后一条消息**：

```
{"verdict": "DONE", "branch": "cp-...", "sprint_dir": "sprints/run-...", "planner_branch": "cp-...", "review_required": false}
```

说明：`planner_branch` 字段供 Brain `runGanLoopNode` 读取，作为 GAN proposer 的 `PLANNER_BRANCH` env，避免回退到 main 读 PRD。

**`review_required` 判断规则**：
- `true` — 新功能、UI 变化、行为变更（evaluator PASS 后需人工确认才 merge）
- `false` — bug fix、重构、配置调整、文档更新（evaluator PASS 后自动 merge）
- **默认**: false（不确定时选 false）

---

## 常见错误

1. **task-plan.json initiative_id 写 "pending"** → 必须使用 `$HARNESS_INITIATIVE_ID` 环境变量（已注入），写 "pending" 会导致 parsePrd 警告 + 下游 DB 写入错误
2. **PRD 仍用功能需求列表格式** → 必须改为 Golden Path 格式（入口→步骤→出口）
   - ❌ 功能需求列表：`FR-001 系统应支持登录 / FR-002 系统应支持下载 / FR-003 系统应支持发布`（罗列能力，无用户流，proposer 无法 1:1 映射 [BEHAVIOR]）
   - ✅ Golden Path：`Step 1: 用户点"抖音登录" → 系统弹二维码 → 扫码后显示"已登录" / Step 2: 用户选视频点"发布" → 系统上传 → 显示帖子链接`（单线性步骤序列，每步 = 用户动作 + 系统可观察响应）
3. **写实现细节**（"引入 X 库"、"用 async 模式"）→ 违反 What-only 原则
4. **忘记 journey_type** → 必须在 PRD 末尾标注，Proposer 和 Evaluator 依赖此字段
