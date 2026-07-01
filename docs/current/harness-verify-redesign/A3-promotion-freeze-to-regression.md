# A3：Promotion —— evaluator PASS 后自动把验过的 golden path 冻结进常驻回归套件

> harness 验证模型重构 · 方案 A3（只做设计，未改代码）
> 关联病灶：harness"一会儿好一会儿坏"—— evaluator 验收是一次性的，验完即焚，没沉淀成常驻回归套件。

---

## 问题现状（引用事实 + 文件位置）

**1. 常驻回归契约是空壳，自 2026-02 未更新。**
`regression-contract.yaml`（仓库根，`/Users/administrator/perfect21/cecelia/regression-contract.yaml`）：
```yaml
version: "1.0.0"
updated: "2026-02-04"
core: []          # 核心功能回归契约（待补充）
golden_paths: []  # Golden Paths（E2E 链路，待补充）
```
两个数组都是空的。文件 `updated` 停在 2026-02-04，之后所有 sprint 验过的 golden path 一条都没进来。

**2. evaluator PASS 后没有任何自动步骤把验过的 golden path 登记进这个契约。**
harness graph（`packages/brain/src/workflows/harness-initiative.graph.js`）在 `reportNode`（L1406）里只有两条分支：
- `computedVerdict !== 'PASS'`（L1589）→ 派 FAILURE report；
- PASS → 什么都不往回归契约写（成功交付证书在 promote 完成点另派，见 `.agent-knowledge/brain.md` Slice3）。

即"判官判完 PASS，判断结果随 sprint 目录一起蒸发"，下次回归没有任何确定性脚本可复跑。

**3. 判官（LLM evaluator）每次都重新出场，没有"读卡机"。**
核心理念（今日讨论确定）：**LLM 判官只在第一次验收新 golden path 时出场一次**；之后把"什么算对"冻结成**确定性脚本**（合同 `[BEHAVIOR]` 的 `manual:` 命令，如 `jq -e` / `psql` / `curl` + exit code），进常驻套件；回归复跑的是脚本不是 LLM。现状没有这个"冻结"动作，所以每次都靠判官临场判断 → 判官波动 = 系统"一会儿好一会儿坏"。

**4. 已有可复用的原料，缺的是"搬运+登记"这一步。**
- `sprintDir`（graph state，L114 / L406）指向该 sprint 目录，内含 `contract-dod.md`、`tests/*.test.ts`、`contract-draft.md`（L344 白名单可见）。
- `contract-dod.md` 里的 `[BEHAVIOR]` 条目已经是确定性脚本，格式示例（fixture `.../contract-gate/clean/contract-dod.md`）：
  ```
  - [ ] [BEHAVIOR] 发布成功且 DB 有新记录（带时间窗）
    Test: manual:bash -c 'curl -s "$API/posts/1" | jq -e ".status == \"sent\"" && psql "$DB" ...'
  ```
- `golden_path` 表已是正模型（migration `303_golden_path_owner_task_model.sql`）：
  `owner_task_id`（FK→tasks/该 ability）+ `order_no` + `feature_id`（FK→journey_features）+ `note` + `notion_id`。**scope = 那个 task，不是 line**。
- `regression-contract.yaml` 有成熟 schema 参考：`packages/quality/contracts/regression-contract.template.yaml`（字段 id/feature/name/scope/priority/trigger/method/tags/steps.given|when|then/evidence/test），可直接对齐。
- `test_registry` 表（1037 条）是 scanner 自动扫的**索引**，不是可执行契约；A3 产出的是可执行 `manual:` 命令，二者不同层，不冲突。

---

## 目标

evaluator/harness 判定 PASS 后，**自动完成一次"冻结登记"**，把这次判官的临场判断固化成常驻卡片，让后续回归"刷卡即可"，无需判官再出场：

1. **INSERT/更新 `golden_path` 表** —— 该 task 的 golden path 步骤（owner_task_id + order_no + feature_id）落库，作为"这条路径已被验收过"的结构化事实。
2. **追加 `regression-contract.yaml`** —— 把该 sprint 的 `[BEHAVIOR] manual:` 确定性脚本，写成 `golden_paths:` 下一个带稳定 id 的条目（读卡机的常驻卡片）。
3. **确保该 sprint 的 test 已 commit 进 repo** —— `tests/*.test.ts` 与 `contract-dod.md` 必须随 PR 进主干，回归契约引用的路径必须真实存在（否则 B1 无条件复跑时 file-not-found）。

一句话：**让判官的一次性判断变成读卡机的常驻卡片。**

---

## 具体改动

### 3.1 在哪里加 promotion（node / skill 落点）

**落点：新增 `promoteToRegression()` 步骤，挂在 evaluator PASS 之后、reportNode 内的 PASS 分支。**

理由：
- `reportNode`（`harness-initiative.graph.js` L1406）是唯一同时握有 `computedVerdict`、`state.sprintDir`、`state.task`（含 `owner_task_id`/`journey_id`/`feature_id`）、`state.sub_tasks`（含 merged pr_url）的节点，正是 promotion 需要的全部输入。
- 现在这个节点的 PASS 分支是空的（只有 `!== 'PASS'` 才做事），A3 正好把 PASS 分支填上。

具体接法（描述，不写代码）：
```
reportNode 内，紧接 computedVerdict 计算之后：
  if (computedVerdict === 'PASS') {
    await promoteToRegression({ dbQuery, gitExec }, {
      task: state.task,                 // owner_task_id / journey_id / feature_id
      sprintDir: state.sprintDir,       // 找 contract-dod.md + tests/
      subTasks: state.sub_tasks,        // 已 merged 的 pr_url（做溯源 + commit 校验）
      worktreePath: state.worktreePath, // 写 regression-contract.yaml 的工作树
    });
  }
```
- `promoteToRegression` 建议放在**新文件** `packages/brain/src/harness-promote-regression.js`（与既有 `staging-promote.js` 平级、职责区分：staging-promote 管上线放行；harness-promote-regression 管回归冻结），由 reportNode `import()` 调用，便于单测 mock。
- **幂等**：与 reportNode 现有幂等风格一致——按 `owner_task_id`（golden_path）和 contract 条目 `id`（yaml）做 NOT EXISTS / 覆盖更新，节点重放不重复追加。
- **best-effort，非致命**：整段包 try/catch，失败只 `console.warn` 不阻断生命周期闭合（同 L1611 现有 failure-report 的容错约定）。冻结失败必须告警（见"风险"），但不能把已 PASS 的交付拖回失败。

三件事的执行顺序（先库、再文件、再校验 commit）：

### 3.2 ① INSERT/更新 golden_path 表

来源：本 sprint 的 golden path（planner 在 `sprint-prd.md` 写的 Golden Path + contract 里的有序步骤）。

- **owner_task_id** = `state.task` 对应的 task id（= 这一个 ability，scope 就是这个 task，**绝不是把一条 line 下多个 ability 排序**）。
- **order_no** = 该 task 内步骤序号（从 golden path 顺序取）。
- **feature_id** = 该步引用的 journey_features id（能对上就填，对不上留 NULL，schema 允许 `ON DELETE SET NULL`）。
- **note** = 该步的自然语言描述 + 对应回归条目 id（回指 3.3 的 yaml 条目，双向可溯）。

写法：`DELETE FROM golden_path WHERE owner_task_id = $1` 再整条 `INSERT`（该 task 的 golden path 是一个整体，重跑覆盖，避免 order_no 脏叠加），与 migration 303 索引 `idx_golden_path_owner_order` 对齐。**这是"结构化事实层"**：记录"这条路径存在且已被验收"。

### 3.3 ② 追加 regression-contract.yaml（格式）

从 `${sprintDir}/contract-dod.md` 解析出所有 `[BEHAVIOR]` 条目的 `Test: manual:...` 命令，每条 golden path 追加成 `golden_paths:` 下一个条目。对齐 `packages/quality/contracts/regression-contract.template.yaml` 的 schema：

```yaml
golden_paths:
  - id: GP-<task_short_id>-001          # 稳定 id：task id 前缀 + 序号，幂等 key
    feature: <feature_name 或 journey_features.name>
    name: "<该 golden path 的一句话描述>"
    scope: golden_path
    priority: P0
    trigger: [PR, Release]              # 无条件跑（供 B1 消费）
    method: auto                         # 冻结成确定性脚本 → auto，不再需要 LLM 判官
    tags: [harness-frozen, <journey_slug>]
    owner_task_id: <uuid>               # 回指 golden_path 表 / tasks
    journey_id: <uuid>
    source:
      pr_url: <merged PR>               # 溯源：哪个 sprint / PR 冻结的
      sprint_dir: <sprintDir>
      frozen_at: <ISO 时间>
      evaluator_verdict: PASS           # 冻结时判官的一次性判断留档
    steps:                              # 从 golden_path 表映射（given/when/then 三段）
      given: "<前置>"
      when: "<动作>"
      then: "<期望>"
    checks:                             # ★ 核心：确定性脚本，回归复跑这些，不跑 LLM
      - manual:bash -c 'curl -s "$API/..." | jq -e ".status==\"sent\""'
      - manual:psql "$DB" -c "SELECT 1 FROM posts WHERE ... created_at > NOW() - interval '5 minutes'" | grep -q 1
    test: "tests/<sprint>/<name>.test.ts"   # 指向已 commit 的 test 文件（B1 会真跑）
```

关键点：
- **`checks` = 冻结的 `manual:` 命令原样搬运**（判官验过什么就冻结什么，退出码即判据）。这是"读卡机的卡片"。
- **`test` 指向 repo 里真实存在的 `tests/*.test.ts`**（3.4 保证），B1 无条件复跑时能跑到。
- **id 稳定 + 幂等**：同一 owner_task_id 再次 PASS（同一 ability 被多个 Run 反复推进，ability:run=1:N）→ 按 id 覆盖对应条目，不重复追加；`golden_paths[]` 只增不无脑堆。
- 写文件用**结构化读改写**（js-yaml load → 改 golden_paths 数组 → dump），不做字符串拼接，保留注释头靠模板/或接受注释丢失（见风险）。同时 bump `updated:` 字段为当天。
- **写在哪个文件**：仓库根 `regression-contract.yaml`（现存空壳的那个），在 `state.worktreePath` 工作树内改，随本 sprint 的 PR 一起 commit（或由 reportNode 的自合流程带上）。

### 3.4 ③ 确保该 sprint 的 test 已 commit 进 repo

回归契约引用的 `test:` 路径必须真实存在，否则冻结进去等于埋雷。promotion 前做一道**commit 校验**：

- 用 `git ls-files ${sprintDir}/contract-dod.md ${sprintDir}/tests/` 在 `worktreePath` 检查这些文件是否已被 git 跟踪（已 commit 进 PR 分支）。
- harness-generator 的 TDD 纪律本就要求 test 先 commit（commit 1 = 测试 Red），且 CI 强校验 test 文件；A3 这里是**兜底断言**：若发现 contract-dod.md / tests 未入库 → 冻结**失败并告警**（记 issue / 飞书），**不把引用不存在文件的条目写进 regression-contract.yaml**（宁可不冻结，不可冻结假卡）。
- 若 test 文件在但 `contract-dod.md` 的 `manual:` 命令引用了未 commit 的脚本/fixture，同样拒绝该条目。

即：**只冻结"引用物已在 repo 里、B1 复跑一定跑得到"的条目。**

---

## DoD（Definition of Done）

- [ ] [BEHAVIOR] evaluator PASS 后，`regression-contract.yaml` 的 `golden_paths:` 不再为空且含本次条目
  Test: `manual:node -e "const y=require('js-yaml').load(require('fs').readFileSync('regression-contract.yaml','utf8')); if(!y.golden_paths || y.golden_paths.length===0) throw new Error('golden_paths still empty'); if(!y.golden_paths.some(g=>g.checks && g.checks.length)) throw new Error('no frozen checks')"`
- [ ] [BEHAVIOR] PASS 后 `golden_path` 表存在该 task 的整条路径（owner_task_id 命中、order_no 有序）
  Test: `manual:psql "$DB" -c "SELECT count(*) FROM golden_path WHERE owner_task_id='<task_id>'" | grep -qv ' 0'`
- [ ] [BEHAVIOR] 冻结进 yaml 的每个 `test:` 路径在 repo 中真实存在（git 已跟踪）
  Test: `manual:bash -c 'node -e "const y=require(\"js-yaml\").load(require(\"fs\").readFileSync(\"regression-contract.yaml\",\"utf8\")); for(const g of (y.golden_paths||[])){ if(g.test){ require(\"child_process\").execSync(\"git ls-files --error-unmatch \"+g.test) } }"'`
- [ ] [BEHAVIOR] 幂等：同一 owner_task_id 二次 PASS 不产生重复 golden_paths 条目（按 id 覆盖）
  Test: `tests/harness/promote-regression-idempotent.test.js`（mock dbQuery + fs，跑两次断言条目数不翻倍）
- [ ] [BEHAVIOR] promotion 失败（如 contract-dod.md 未 commit）不阻断 reportNode 生命周期闭合，只告警
  Test: `tests/harness/promote-regression-nonfatal.test.js`（注入抛错的 gitExec，断言 reportNode 仍返回 report_path）
- [ ] `promoteToRegression` 只在 `computedVerdict === 'PASS'` 触发（FAIL/SKIP 不冻结）
  Test: 单测覆盖 PASS / FAIL 两分支
- [ ] `updated:` 字段随每次冻结 bump 为当天日期

---

## 依赖

- **依赖 A1（加载）**：本方案只负责把条目**写进** `regression-contract.yaml` + `golden_path` 表。真正让这份契约在回归时被**加载/解析并执行**，是 A1 的职责。A1 未落地前，A3 冻结的卡片是"已登记但还没有读卡机去刷"——数据正确但暂不产生回归效果。A3 的 yaml schema（3.3）必须与 A1 的 loader 期望字段（`golden_paths[].checks` / `.test` / `.trigger`）对齐，二者需共用同一 schema 定义。
- **被 B1（无条件跑）消费**：B1 = "回归套件无条件复跑"。A3 冻结的 `checks`（`manual:` 确定性脚本）与 `test`（`*.test.ts`）正是 B1 每次无条件复跑的对象。A3 保证"卡片可执行、引用物在 repo 里"（3.4），B1 才能稳定刷卡。B1 的绿/红取代判官临场判断 —— 这正是治"一会儿好一会儿坏"的闭环终点。
- **数据前置**：`golden_path` 表（migration 303，已在库）、`journey_features` 表（feature_id FK）、`tasks` 表（owner_task_id FK）—— 均已存在，无需新 migration。
- **schema 参考**：`packages/quality/contracts/regression-contract.template.yaml`（复用其字段命名，勿另造一套）。

---

## 风险与注意

1. **Golden Path scope 铁律**：owner_task_id = 一个 task = 一个 ability，**scope 就是那个 task**。绝不能把"一条 line 下多个 ability 排序"当 golden path 塞进去（migration 303 背景明确纠正过的错模型，反复掉的坑）。冻结时严格按单 task 取步骤。
2. **禁建平行表 / 平行契约**：复用现存 `regression-contract.yaml`（根）+ `golden_path` 表 + template schema，**不新建**并行回归表或第二份 yaml。`test_registry`（scanner 索引层）与本方案（可执行契约层）分层不同，别把冻结结果写进 test_registry。
3. **yaml 写入的原子性与注释保留**：js-yaml `dump` 会丢失文件头注释。建议：把注释头抽成模板常量，dump 后重贴；或接受注释精简但保留 schema 说明链接。写入用"读全量→改数组→整写"，避免并发/半写坏文件。
4. **假卡风险（最危险）**：若冻结了引用不存在文件、或 `manual:` 命令在 CI 里跑不起来（curl/psql 环境缺失）的条目，B1 会稳定翻红，制造"回归常绿变常红"的反噬。缓解：3.4 的 commit 校验 + `manual:` 命令必须 CI 兼容（遵循 `feedback_dod_ci_compatible_tests` 白名单：node/npm/curl/bash/psql，用 `grep -c`/exit code，不用 `npx vitest`）。冻结前对每条命令做一次 dry-parse 校验。
5. **判官只出场一次的边界**：同一 ability 被下一个 Run 再推进（ability:run=1:N）时，判官会再判一次 PASS —— 此时应**覆盖更新**该 owner_task_id 的卡片（路径演进了），而非叠加旧卡。id 用 owner_task_id 前缀保证覆盖。
6. **best-effort 的静默陷阱**：promotion 包 try/catch 不阻断生命周期是对的，但"冻结失败"若只 warn 会重演"验完即焚"。必须：冻结失败 → 写一条 P1 issue（`notion-create-issue.js`，sub-area=brain）或飞书告警，让缺卡可见，不静默。
7. **feature_id 对不齐**：planner 的 golden path 步骤未必都能映射到 journey_features 行。允许 feature_id 为 NULL（schema 允许），note 里保留原始描述，不因映射失败而整条 promotion 失败。
8. **A1 未就绪时的表现**：A3 先行落地时，卡片只登记不被执行，属预期中间态；需在文档/告警里说明"已冻结，待 A1 接通读卡机"，避免误判为"冻结没生效"。
