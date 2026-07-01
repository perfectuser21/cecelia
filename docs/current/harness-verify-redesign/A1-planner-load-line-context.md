# A1：harness-planner 动态加载整条线的 FR + NFR + invariant 注入合同

> harness 验证模型重构 8 处修复中的第 1 处（A1）。
> 目标：让每个 sprint 的 planner 不再"只看自己新合同"，而是带着**整条线的历史约束**（累积 FR + NFR + invariant）进 GAN 对抗，从源头堵住"一会儿好一会儿坏"（验收一次性没沉淀）。
> 本文只做设计，不改任何生产代码。

---

## 问题现状（引用事实 + 读代码确认的文件:行号）

### 1. NFR 这条线"看似通、实则读错表"（重要背景更正）

- **SSOT 位置更正**：harness-planner 的 NFR Step 0.3 **不在** `cecelia/packages/workflows/skills/harness-planner/SKILL.md`（该副本停在 v8.8.0，349 行，全文无 "NFR" / "Step 0.3" / "category=nfr"），而在真正 SSOT `~/perfect21/zenithjoy-skills/harness-planner/SKILL.md:180-216`（v8.11.0 `### Step 0.3: 读取 NFR 决策（decisions 副源）`）。
  - 即 cecelia 仓库内那份是**过时的部署镜像**（连 NFR 0.3 都没同步到）。改动必须落在 SSOT 的 zenithjoy-skills，走 skill-creator→PR（见"依赖"）。
- **NFR 0.3 的查询实际是坏的**：它执行
  `curl "localhost:5221/api/brain/decisions?category=nfr&limit=50"`
  但该路由 `packages/brain/src/routes/status.js:270 GET /decisions` → `getRecentDecisions()`（`packages/brain/src/routes/shared.js:19-22`）**读的是 `decision_log` 表（LLM 决策审计日志，9.5 万行），不是 `decisions` 表，且完全忽略 `category` 参数**。
  - 实测：`decisions` 表里 `category='nfr'` 有 17 条、`category='invariant'` 有 19 条；但 `GET /decisions` 一条都取不到它们，只会吐回一堆 decision_log 审计行。
  - 结论：**A1 绝不能照抄 NFR 0.3 的 `GET /decisions?category=` 写法**，那是个假通的门。要用下面按 golden_path / journey_feature 精确 join 的端点。

### 2. invariant 没被 headless harness 加载

- `decisions` 表 `category='invariant'` 共 19 条，其中题述 5 条 [Line04] 铁律（不进群 / 不回自己 / 防假成功 / 后台静默发送 / 记忆按租户隔离）实际存储形态（psql 确认）：
  - `level='ability', target_type='journey_feature'`（挂在某个 journey_feature 上）
  - 另有 2 条租户隔离是 `level='area', target_type=NULL`（挂在 area 级）。
- planner 全流程（SSOT 与镜像两份）都**没有任何一步读 invariant**，所以这 5 条铁律在 headless sprint 里对 proposer/generator/evaluator 完全不可见。

### 3. 累积 FR 没被加载

- golden_path 是唯一 FR 正模型（`packages/brain/src/routes/abilities.js:161` `GET /golden_path?owner_task_id=`，表列：`id/owner_task_id/order_no/feature_id/note`）。每条 golden_path 挂在**一个 task（=一个 ability）**上。
- planner 每个 sprint 只写自己新 sprint-prd.md 的 Golden Path，从不回读**这条 line 之前已完成 ability 的 golden_path**，导致新 sprint 会重复/遗漏、或破坏前面已验收过的行为。

### 4. 现成端点在，但只有 smoke 在用

- `packages/brain/src/routes/abilities.js:250` `GET /api/brain/tasks/:id/golden-path-decisions?category=&scope=`：
  `SELECT d.*, gp.order_no FROM decisions d JOIN golden_path gp ON gp.id=d.target_id WHERE d.target_type='golden_path' AND gp.owner_task_id=$1`（可再按 `category`/`scope` 过滤，按 `order_no` 排序）。
  - **唯一调用方**：`packages/brain/scripts/smoke/golden-path-step-nfr-smoke.sh:93-97`。真实 pipeline 零调用。
  - **局限（关键）**：它只 join `target_type='golden_path'`（挂在 golden_path 步上的决策）。题述 5 条 Line04 invariant 是 `target_type='journey_feature'` / area 级，**这个端点抓不到**。
- 另有两个可复用端点：
  - `abilities.js:143` `GET /abilities/:id/decisions?scope=` → `WHERE target_type='journey_feature' AND target_id=$1`：这是够到 journey_feature 级 invariant 的正确入口（`:id` = feature_id）。
  - `abilities.js:13` `GET /abilities?journey_id=&kind=&status=`：列一条 line 下所有 ability/feature（journey_features）。
- 数据模型约束：`tasks` 表**无 journey_id**，但有 `ability_id`（→ journey_feature）；`journey_features` 有 `journey_id`。所以 "task ↔ line" 的桥是 `task.ability_id → journey_features.journey_id`。

---

## 目标（一句话）

给 harness-planner 加一个 Step 0.3 的孪生步骤 **Step 0.4「加载整条 line 的历史约束」**，每个 sprint 用 golden_path / journey_feature 精确端点拉本 ability 及本 line 已完成 ability 的**累积 FR + invariant（+ 正确的 NFR）**，把它们注入 sprint-prd.md 新增的 `## Invariant 约束` 与 `## 累积 FR（本 line 已验收行为）` 两段，让 GAN 对抗每次都带着整条线的历史。

---

## 具体改动（写方案，不写最终代码）

### 改哪：SSOT `~/perfect21/zenithjoy-skills/harness-planner/SKILL.md`

在现有 `### Step 0.3: 读取 NFR 决策` 之后、`### Step 0.5: 推断 journey_type` 之前，插入新的 `### Step 0.4: 加载整条 line 的 invariant + 累积 FR`。同时**顺手修 Step 0.3 的坏查询**（把 `GET /decisions?category=nfr` 换成下面按 task/feature 精确的端点），避免留一个假通的门。

### Step 0.4 的三段读取逻辑（复用哪个 API）

上下文里 planner 已有 `$HARNESS_INITIATIVE_ID`、`TASK_PAYLOAD`（含 `journey_id`、`ability_id`/`step_id`、本 task id）。以此为锚：

1. **本 ability golden_path 上挂的 invariant + nfr（step 级）** — 复用 `GET /api/brain/tasks/:TASK_ID/golden-path-decisions?category=invariant`（再拉一次 `category=nfr` 补 Step 0.3 的真数据）。
2. **journey_feature 级 invariant（题述 5 条 Line04 铁律所在层）** — 从 `TASK_PAYLOAD.ability_id`（= feature_id）复用 `GET /api/brain/abilities/:ABILITY_ID/decisions`，过滤 `category=invariant`。
3. **累积 FR（本 line 已完成 ability 的 golden_path）** —
   - 先 `GET /api/brain/abilities?journey_id=<journey_id>&kind=ability&status=done`（或等价 completed）列出本 line 已完成的 ability；
   - 对每个 ability 找到其 owner task，再 `GET /api/brain/golden_path?owner_task_id=<task>` 取有序步骤，汇成"本 line 已验收行为清单"。
   - **注意此处存在端点缺口**（见"依赖 / 缺口"），A1 落地时需要一个"按 journey_id 直接聚合 golden_path"的端点或按 ability→task 逐个取。

> 全部 curl 用 `-sf ... || echo '[]'` 兜底，空数组也继续（对齐 Step 0.3 的自查纪律，不因历史为空而中断）。

### 注入合同哪个位置

sprint-prd.md 模板里，在 `## E2E 验收` 之前、紧挨 Step 0.3 注入的 `## NFR 约束` 段，新增两段（占位符不留空，无数据写"（本 line 暂无历史）"）：

```markdown
## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，按本 ability golden_path 步 + journey_feature + area 三源合并 -->
- [不进群] 只私聊；群一律跳过（来源: journey_feature <id>）
- [不回自己] 只回对方发来的消息，永不回自己/AI 发出的
- [防假成功] 发送后必须确认真发出，气泡未刷新不得判成功
- ...（每条一行，标来源）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- <ability A>: Step1 ... → Step2 ... → Step3 ...
- <ability B>: Step1 ... → Step2 ...
```

下游天然受益：GAN proposer 已"合同必须覆盖 Golden Path 全程"，evaluator 已按合同断言——只要这两段进了 sprint-prd.md，proposer 会把 invariant 翻成对抗断言、把累积 FR 纳入不回退检查（E1 会进一步把 invariant 强制喂给 GAN，见依赖）。

### SKILL 版本与 changelog

按 harness-planner 现有 changelog 惯例 bump minor（如 v8.12.0），写"新增 Step 0.4 加载 line 级 invariant + 累积 FR；修 Step 0.3 NFR 查询改用 golden-path-decisions 端点（旧 GET /decisions 读错 decision_log 表）"。

---

## DoD（可验证断言，优先 manual:）

1. `[BEHAVIOR]` manual: SSOT SKILL 含新步骤标题 —
   `manual: bash -c "grep -c '### Step 0.4' ~/perfect21/zenithjoy-skills/harness-planner/SKILL.md | grep -q 1"`
2. `[BEHAVIOR]` manual: 模板含 Invariant 段 —
   `manual: node -e "const s=require('fs').readFileSync(process.env.HOME+'/perfect21/zenithjoy-skills/harness-planner/SKILL.md','utf8'); if(!s.includes('## Invariant 约束')) process.exit(1)"`
3. `[BEHAVIOR]` manual: 模板含累积 FR 段 —
   `manual: node -e "const s=require('fs').readFileSync(process.env.HOME+'/perfect21/zenithjoy-skills/harness-planner/SKILL.md','utf8'); if(!s.includes('## 累积 FR')) process.exit(1)"`
4. `[BEHAVIOR]` manual: Step 0.4 复用正确端点（golden-path-decisions + abilities/:id/decisions），未沿用坏的 `GET /decisions?category=` —
   `manual: bash -c "grep -q 'golden-path-decisions' ~/perfect21/zenithjoy-skills/harness-planner/SKILL.md && grep -q 'abilities/.*/decisions' ~/perfect21/zenithjoy-skills/harness-planner/SKILL.md"`
5. `[BEHAVIOR]` 端到端产物断言（真验收，非文本）：对一个已有历史的 line（如 Line04）跑一次 planner，产出的 `sprint-prd.md` 里 `## Invariant 约束` 段实际含 ≥1 条 Line04 铁律文字（不进群/不回自己/防假成功/后台静默/租户隔离之一）——
   `contract: sprints/<run>/sprint-prd.md 的「## Invariant 约束」段非空且至少命中一条已知 Line04 invariant 关键词`
6. `[BEHAVIOR]` 若本 line 无历史，两段各写"（本 line 暂无历史）"占位而非空段（对齐 Step 0.3"空数组也继续"纪律）。

> DoD 5 是核心行为断言：只要它过，就证明 invariant 真的从 DB 走到了合同里，而不是只加了段模板文字。

---

## 依赖 / 缺口（与 A3、E1 的关系）

**必须先补的 Brain 端点缺口（A1 的硬前置）：**
- **累积 FR 聚合端点缺失**：现有 `GET /golden_path` 只接 `owner_task_id`；`tasks` 无 `journey_id`。要"按 line 拉所有已完成 ability 的 golden_path"，需新增/扩一个端点（如 `GET /api/brain/journeys/:journey_id/golden-paths?status=done`，内部走 `journey_features.journey_id → owner task → golden_path`）。这是一处小 Brain 改动，应作为 A1 的伴生子任务或前置依赖登记，不能只靠 SKILL 侧 curl 拼。
- **journey_feature/area 级 invariant 端点**：`GET /abilities/:id/decisions` 够到 journey_feature 级；但 area 级 invariant（`level=area, target_type=NULL`，如租户隔离 2 条）目前无干净端点（`GET /decisions` 读错表）。A1 需要一个能按 area/journey 取 invariant 的正确端点，否则 area 铁律仍漏。

**与 A3（promotion）的关系：**
- A3 把已验收行为"沉淀/升级"为长期约束；A1 是**消费端**——A1 保证每个新 sprint 会把 A3 沉淀下来的 invariant/累积 FR 重新加载进合同。两者构成"沉淀（A3 写）→ 复用（A1 读）"闭环。A1 读取的数据源（golden_path + decisions category=invariant）应与 A3 写入的目标表/字段严格对齐，避免写一处读另一处。

**与 E1（invariant → GAN）的关系：**
- A1 负责把 invariant **搬进 sprint-prd.md**（进合同上游文本）；E1 负责在 GAN 阶段把这些 invariant **强制转成 proposer 的对抗断言 / evaluator 的红线检查**。A1 是 E1 的输入前提：没有 A1 注入，E1 无 invariant 可喂。二者接口约定：sprint-prd.md 的 `## Invariant 约束` 段格式（每行"[标签] 铁律文字（来源: ...）"）即 E1 的解析契约，需两处对齐。

---

## 风险与注意

1. **别照抄坏门**：Step 0.3 的 `GET /api/brain/decisions?category=nfr` 读的是 `decision_log`、忽略 category（status.js:270 / shared.js:19）。A1 若沿用会拉回一堆 LLM 审计行当"约束"，污染合同。必须用 golden-path-decisions / abilities/:id/decisions 精确端点，并顺手修 0.3。
2. **端点覆盖面**：golden-path-decisions 只覆盖 `target_type='golden_path'`；题述 5 条 Line04 invariant 是 journey_feature/area 级，**必须走第 2、第 3 源**，否则 DoD 5 会因"合同里没有 Line04 铁律"而失败——这正是本 A1 最容易踩空的点。
3. **SSOT vs 镜像**：改 SSOT（zenithjoy-skills）后，cecelia/packages/workflows/skills/harness-planner 那份过时镜像需一并同步（它连 NFR 0.3 都缺），否则跑到旧副本仍无效。确认 headless harness 运行时实际解析到哪份（`~/.claude/skills` symlink → SSOT）。
4. **注入膨胀**：累积 FR 随 line 变长会越堆越大，可能撑爆 sprint-prd.md / proposer context。建议 Step 0.4 对累积 FR 做"只列已完成 ability 的 golden_path 标题行 + 关键步骤"的摘要，而非全文，并设条数上限。
5. **journey_id 缺失兜底**：若 `TASK_PAYLOAD.journey_id` 为空（非路径 C 点火），Step 0.4 应优雅降级为"仅本 ability step 级 + journey_feature 级"，不因取不到 line 而报错。
6. **PrepPRD 优先原则延续**：invariant 是铁律（不可被 PrepPRD 覆盖，只增不减）；但累积 FR 与 NFR 仍遵循"PrepPRD 显式值优先"，避免历史值盖掉用户本次明确要求。
