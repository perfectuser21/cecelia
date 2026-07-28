---
id: harness-planner-skill
description: |
  【Harness 内部节点，禁止人类直接调用】
  Harness Planner — skill-relay 接力链第一棒：Brain 派发 harness_initiative（payload.orchestrator=skill-relay）后
  spawn 单 session harness-controller，由 controller Step 1 调用本 skill 产出 sprint-prd.md。
  人类启动 harness/sprint 通过 /dev 路径C（POST localhost:5221/api/brain/tasks，payload 必须带 orchestrator=skill-relay）。
  直接调本 skill = 绕过 controller 接力链，违反 zero-human-gate 原则。
  （2026-07-05 cecelia #3554 起 LangGraph 图编排已废弃，"Brain executor Layer 1 节点"为过时语义。）
version: 8.15.0
created: 2026-04-08
updated: 2026-07-14
changelog:
  - 8.15.0: EVA v2 审计五修 — ① 修 Step 0.3 THIN_PRD 引用未定义变量 bug（TASK_PAYLOAD→TASK_JSON）；② Step 2 后新增「发货前机械闸」（journey_type/target_environment 枚举 + Invariant/累积FR/NFR/journey_id/step_id 五段结构 + thin-slice 行数自查，任一 FAIL 禁进 Step 3，恢复/重跑同样过闸——d063b3e5 实证 299 行 PRD 穿透）；③ 执行规则加防漂移铁律（输入真相只来自 task payload API，Step 0-3 不可跳）；④ 累积 FR 段加语义反例（禁表格、禁写本 sprint 新行为）；⑤ Step 3 出口 JSON 增 status 四态（DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED）
  - 8.14.0: 跨 repo 化刀3 — Step 0.5 环境映射加前置护栏：路径→环境映射表仅适用 base_repo=cecelia；zenithjoy 走既有布局约定（apps/dashboard→windows_cloud 等）；其他第三方 repo 禁止路径猜测，target_environment 必须由 payload 显式提供，缺失时 PRD 标注 environment: unresolved 交 controller 上报；映射表本体与 Brain API（localhost:5221）调用不动
  - 8.13.0: description 更新为 skill-relay 语义 — LangGraph 图编排已废弃（cecelia #3554，2026-07-05），本 skill 现由 harness-controller 单 session 接力调用，不再是 Brain executor 图节点；正文流程不变
  - 8.12.1: 补回 Step 3 最后一条消息的 review_required 字段 + 判断规则 — 该字段只存在于 cecelia 镜像（B22 时代直改镜像未进 SSOT 的历史漂移），v8.12.0 镜像同步时被覆盖丢失，b22-review-required-smoke 抓到；Brain graph 从 planner verdict JSON 消费此字段
  - 8.12.0: 新增 Step 0.4 加载整条 line 的历史约束（A1，harness 验证模型重构）— step/journey_feature/area 三源 invariant + 按 journey 聚合的累积 FR，注入 sprint-prd.md「## Invariant 约束」「## 累积 FR」两段（格式即 E1 的解析契约）；修 Step 0.3 坏查询 — 旧 GET /decisions?category=nfr 读的是 decision_log 审计表且忽略 category 参数，改用 golden-path-decisions + abilities/:id/decisions 精确端点
  - 8.11.0: 新增 Step 0.3 NFR 双源读取 — 从 decisions?category=nfr 取活跃 NFR 决策 + 从 PrepPRD 取用户显式 NFR，合并注入 sprint-prd.md ## NFR 约束章节；双源缺一不可
  - 8.10.0: 链路审计修复 4 项 — target_environment 推断改为明确 if-elif 优先级链；journey_id 大小写统一；sprint-prd.md 模板补 ## E2E 验收 占位区块；常见错误 #2 加正反例
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
> **执行规则（EVA v2）: 无论派发 prompt 厚薄（含恢复/二次点火场景），Step 0-3 一步不可跳；本 skill 的输入真相只来自 task payload API（curl 自取），不来自派发 prompt 的转述。**

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

## Thin Slice 字数硬上限

- **thin slice PRD ≤ 100 行**（含 smoke script 区块；禁止写历史背景、实现路径、OKR 叙事）
- **thin slice DoD ≤ 8 条**（不分 BEHAVIOR/ARTIFACT 总数 ≤ 8）
- 超 → planner 自审 reject + 强制砍范围 / 拆 multi-sprint

**正例**：含 Golden Path + E2E 验收占位 + smoke script 的完整 thin PRD，80-90 行以内。

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

### Step 0.3: 读取 NFR 决策（decisions 副源）

**目的**：将 decisions 表中已沉淀的 NFR 决策注入 sprint-prd.md，避免每次重新问用户。PrepPRD 显式写了的参数优先；decisions 只补 PrepPRD 没写到的。

> ⚠️ **禁止使用 `GET /api/brain/decisions?category=nfr`**：该路由读的是 `decision_log`（LLM 决策审计日志，9 万+ 行），不是 `decisions` 表，且完全忽略 `category` 参数——拉回来的是审计噪音，不是 NFR。必须用下面按 task / ability 精确 join 的端点。

```bash
# 锚点：task_id 来自 prompt「本次任务参数」注入；先拉任务详情提取 ability_id / journey_id
# （Step 0.4 也复用这三个变量）
TASK_ID=<本次任务参数里的 task_id>
TASK_JSON=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID" || echo '{}')
ABILITY_ID=$(echo "$TASK_JSON" | jq -r '.ability_id // .payload.ability_id // ""')
JOURNEY_ID=$(echo "$TASK_JSON" | jq -r '.payload.journey_id // ""')

# ① step 级 NFR：本 ability golden_path 各步骤上挂的 NFR（副源）
curl -sf "localhost:5221/api/brain/tasks/$TASK_ID/golden-path-decisions?category=nfr" \
  > /tmp/nfr_decisions.json 2>/dev/null || echo '[]' > /tmp/nfr_decisions.json

# ② journey_feature 级 NFR：ability 本体上挂的（该端点不支持 category 参数，用 jq 过滤）
if [ -n "$ABILITY_ID" ]; then
  curl -sf "localhost:5221/api/brain/abilities/$ABILITY_ID/decisions" > /tmp/nfr_feature_raw.json 2>/dev/null \
    || echo '[]' > /tmp/nfr_feature_raw.json
  jq '[.[] | select(.category=="nfr")]' /tmp/nfr_feature_raw.json > /tmp/nfr_feature.json 2>/dev/null \
    || echo '[]' > /tmp/nfr_feature.json
else
  echo '[]' > /tmp/nfr_feature.json
fi

# 读取本 sprint 的 thin_prd（主源）
THIN_PRD=$(echo "$TASK_JSON" | jq -r '.payload.thin_prd // ""')   # EVA v2：修未定义变量 TASK_PAYLOAD，复用上文 TASK_JSON
```

**合并规则**（PrepPRD 主源 > decisions 副源）：

| PrepPRD 是否写明 | decisions 是否有值 | 结论 |
|------|------|------|
| ✅ 明确写了（如"超时=5秒"）| 任意 | 用 PrepPRD 的值，decisions 忽略 |
| ❌ 没写 | ✅ 有值 | 用 decisions 的值，注入 sprint-prd.md |
| ❌ 没写 | ❌ 没值 | 留空（Proposer 阶段对用户提问） |

**sprint-prd.md 注入**：在 `## E2E 验收` 之前插入 `## NFR 约束` 段：

```markdown
## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: <值，或"待定（PrepPRD 未指定）">
- 频控: <值>
- 版本要求: <如 WeChat=4.1.8，或空>
- 可观测: <如"失败必须写 Brain log"，或空>
```

**自查 checklist**：
- [ ] `/tmp/nfr_decisions.json` + `/tmp/nfr_feature.json` 已读取（即便为空数组也继续）
- [ ] PrepPRD 已有的 NFR 参数不被 decisions 覆盖
- [ ] sprint-prd.md 含 `## NFR 约束` 段

---

### Step 0.4: 加载整条 line 的 invariant + 累积 FR（历史约束进合同）

**目的**：planner 每个 sprint 不能只看自己的新合同——必须带着**整条 line 的历史约束**进 GAN 对抗，否则已验收的行为会被新 sprint 回退/破坏（"一会儿好一会儿坏"的根源就是验收一次性、没沉淀）。invariant 是铁律（只增不减，不可被 PrepPRD 覆盖）；累积 FR 是本 line 已验收的行为清单（本 sprint 不得回退/重复实现）。

复用 Step 0.3 已提取的 `TASK_ID` / `ABILITY_ID` / `JOURNEY_ID`：

```bash
# ① step 级 invariant：本 ability golden_path 各步骤上挂的铁律
curl -sf "localhost:5221/api/brain/tasks/$TASK_ID/golden-path-decisions?category=invariant" \
  > /tmp/inv_step.json 2>/dev/null || echo '[]' > /tmp/inv_step.json

# ② journey_feature 级 invariant（如 Line04 五条客服铁律所在层）
if [ -n "$ABILITY_ID" ]; then
  curl -sf "localhost:5221/api/brain/invariants?target_type=journey_feature&target_id=$ABILITY_ID" \
    > /tmp/inv_feature.json 2>/dev/null || echo '[]' > /tmp/inv_feature.json
else
  echo '[]' > /tmp/inv_feature.json
fi

# ③ area 级 invariant（如租户隔离，target_type=NULL 挂 area 上）
curl -sf "localhost:5221/api/brain/invariants?level=area" \
  > /tmp/inv_area.json 2>/dev/null || echo '[]' > /tmp/inv_area.json

# ④ 累积 FR：本 line 已验收 ability 的 golden_path（端点已按 owner_task_id 分组、order_no 有序）
if [ -n "$JOURNEY_ID" ]; then
  curl -sf "localhost:5221/api/brain/journeys/$JOURNEY_ID/golden-paths" > /tmp/line_fr_raw.json 2>/dev/null \
    || echo '[]' > /tmp/line_fr_raw.json
  jq '[.[] | select(.ability_status=="done" or .ability_status=="working")]' /tmp/line_fr_raw.json \
    > /tmp/line_fr.json 2>/dev/null || echo '[]' > /tmp/line_fr.json
else
  echo '[]' > /tmp/line_fr.json   # 无 journey_id（非路径 C 点火）→ 优雅降级为仅 step/feature/area 级，不报错
fi
```

**端点选择的 why（禁止改用别的写法）**：
- `GET /invariants` 读的是 `decisions` 表 `category='invariant' AND status='active'`。`GET /decisions?category=invariant` 是坏门（读错 decision_log 表，见 Step 0.3 警告），拉回来的审计行会污染合同。
- `GET /journeys/:id/golden-paths` 内部走 `golden_path.owner_task_id → tasks.ability_id → journey_features.journey_id` 三表桥，返回 `[{ability_name, ability_status, steps:[{order_no, note}]}]`，已按 ability（owner_task_id）分组。

**sprint-prd.md 注入**：在 `## NFR 约束` 之后、`## E2E 验收` 之前插入两段。**无数据时占位写"（本 line 暂无历史）"，不留空段、不报错**（对齐 Step 0.3"空数组也继续"纪律）：

```markdown
## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [不进群] 只私聊；群聊一律跳过（来源: journey_feature）
- [防假成功] 发送后必须确认真实发出，气泡未刷新不得判成功（来源: journey_feature）
- [租户隔离] 记忆按租户×联系人隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
<!-- EVA v2：累积 FR 段每行必须是 "- <ability名>: Step..." 或占位"（本 line 暂无历史）"；禁止表格、禁止把本 sprint 自己要新做的行为写进本段（那是 Golden Path 段的事）——EVA v2 实证 B run 误用 -->
- <ability A>: Step1 ... → Step2 ... → Step3 ...
- <ability B>: Step1 ... → Step2 ...
```

**格式契约（E1 依赖，不可变）**：Invariant 段每条一行，格式 `- [标签] 铁律文字（来源: <层级>）`。标签取 decision `topic` 里 `]` 之后的短语（如 `[Line04]不进群` → `不进群`），没有则自拟 2-6 字概括。下游 GAN（E1）按此格式把每条 invariant 翻成 proposer 对抗断言 / evaluator 红线检查，改格式会打断解析。

**膨胀控制**：invariant 全量注入（铁律不裁剪）；累积 FR 每个 ability 只列一行摘要（名称 + 关键步骤 note 串联，单行 ≤120 字），超过 20 个 ability 时保留最近 20 个并注明"（另有 N 个 ability 略）"。这两段是系统注入的历史约束，**不计入 Thin Slice 100 行上限**。

**自查 checklist**：
- [ ] `/tmp/inv_step.json` / `/tmp/inv_feature.json` / `/tmp/inv_area.json` / `/tmp/line_fr.json` 已读取（空数组也继续）
- [ ] 三源 invariant 已按 decision `id` 去重合并
- [ ] sprint-prd.md 含 `## Invariant 约束` 段与 `## 累积 FR` 段（无数据用占位文字，非空段）
- [ ] 累积 FR 段每行必须是 "- <ability名>: Step..." 或占位"（本 line 暂无历史）"；禁止表格、禁止把本 sprint 自己要新做的行为写进本段（那是 Golden Path 段的事）——EVA v2 实证 B run 误用

---

### Step 0.5: 推断 journey_type + target_environment

> **跨 repo 护栏（刀3）**：本节的路径→环境映射（journey_type if-elif 链 + target_environment 表）**仅适用 base_repo = cecelia**（Cecelia monorepo 目录布局）。
> - **zenithjoy** → 用 zenithjoy 布局既有约定（apps/dashboard 等 UI/Electron → `windows_cloud`，全局 E2E 环境路由死规则）；
> - **其他第三方 repo** → 不做任何路径猜测：`target_environment` 必须由 payload 显式提供；缺失时 planner 不猜，在 PRD 末尾标注 `environment: unresolved` 交 controller 上报处理。

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

### 发货前机械闸（EVA v2）

任一 FAIL 禁止进 Step 3。恢复/重跑场景（d063b3e5 实证 299 行 PRD 穿透）同样必须过闸。

```bash
# 发货前机械闸（EVA v2：实战 2/3 跑枚举非法——feature/local/deploy 都出现过，下游 proposer 选模板/evaluator 派机器全瞎）
grep -qE '^(## )?journey_type: (autonomous|user_facing|dev_pipeline|agent_remote)$' "$SPRINT_DIR/sprint-prd.md" || { echo "FAIL: journey_type 非法枚举"; exit 1; }
grep -qE '^(## )?target_environment: (mac_web|windows_cloud|windows_wechat|linux_server|local_api|playground)$' "$SPRINT_DIR/sprint-prd.md" || { echo "FAIL: target_environment 非法枚举"; exit 1; }
grep -q '## Invariant 约束' "$SPRINT_DIR/sprint-prd.md" || { echo "FAIL: 缺 Invariant 段"; exit 1; }
grep -q '## 累积 FR' "$SPRINT_DIR/sprint-prd.md" || { echo "FAIL: 缺累积 FR 段"; exit 1; }
grep -q '## NFR' "$SPRINT_DIR/sprint-prd.md" || { echo "FAIL: 缺 NFR 段"; exit 1; }
grep -q '^## journey_id:' "$SPRINT_DIR/sprint-prd.md" || { echo "FAIL: 缺 journey_id 行（无值写 none）"; exit 1; }
grep -q '^## step_id:' "$SPRINT_DIR/sprint-prd.md" || { echo "FAIL: 缺 step_id 行（无值写 none（PrepPRD 未锚定））"; exit 1; }
BODY_LINES=$(sed '/^## Invariant 约束/,/^## [^I]/d' "$SPRINT_DIR/sprint-prd.md" | wc -l)
[ "$BODY_LINES" -le 100 ] || { echo "FAIL: 正文超 thin-slice 100 行（扣除 Invariant/累积FR 段后 $BODY_LINES 行），裁剪后重发"; exit 1; }
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
{"verdict": "DONE", "branch": "cp-...", "sprint_dir": "sprints/run-...", "planner_branch": "cp-...", "review_required": false, "status": "DONE"}
```

说明：`planner_branch` 字段供 Brain `runGanLoopNode` 读取，作为 GAN proposer 的 `PLANNER_BRANCH` env，避免回退到 main 读 PRD。

**`status` 四态出口（EVA v2）**：`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`。
- `NEEDS_CONTEXT` = payload 缺 thin_prd 且 PrepPRD 无法锚定 scope
- `BLOCKED` = Brain API 全程不可达导致 Step 0.1/0.3/0.4 三步全空

**`review_required` 判断规则**（Brain 从 planner verdict JSON 提取，决定 evaluator PASS 后是否需人工确认才 merge）：
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
