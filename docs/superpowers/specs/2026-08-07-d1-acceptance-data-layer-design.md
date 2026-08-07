# D1 · 验收一体两面数据层地基与状态机（设计）

> **规格 SSOT** = `sprints/f2-acceptance-two-column/proposal-v7-final.md` 的「D1 · 数据层地基与状态机」节（`golden_paths(7790f728).proposal_doc`）。本文件是**实现设计**，负责把 D1 节转写成可执行的单元划分、接口契约、落点文件与测试层级；凡与 v7-final 冲突处一律以 v7-final 为准。
> **task** `b35bfa0c-c798-45a5-80dc-16f12e35ca6d`（已 claim，in_progress）；**anchor** journey `2fa4d085` / gp `7790f728` / step `817f59f5`。

---

## 背景与决策链

主理人 Alex 在 08-06 拍板「验收一体两面」总方向（决策 `fdeb48aa`，架构六条为法源），08-07 又对 v6 呈报的三个呈批项逐条拍板（决策 `8640ef58`）：J17 取候选 **B**（AI 打表器用专用验收租户 + 专用抖音小号，自己发起采集并自持计时）；S5/S10 的偶发场景**升为员工每轮规定动作**；S13-c4 频控红线本版不自动验、绿必经主理人裁决。方案本体经 6 轮 GAN 对抗收敛（P0/P1 曲线 7→3→3→3→1→0），v7-final 是拍板后的落稿定稿版，GP `7790f728` 状态 approved。**本设计不重开任何设计辩论**，只做转写、核验与实现拆解。

D1 是这条 GP 的地基，**阻塞 D2/D3/D4/D5 全部**。它要交付的是「一张表两列背靠背」赖以存在的数据结构与状态语义：AI 四列在库里真实存在、格号从每轮唯一的流水号改成规程格号、run 的生命周期从 4 值扩到 7 值、格级判定与 run 级状态被拆成两件互不推导的事、以及一台把规程 yaml 变成 36 行验收单的生成器。对应 GP 的 Step 1 / 6 / 7 / 9，解锁断言 A1 / A3 / A4⑥⑦⑧ / A5 / A9 / A10 / A14 / A15 / A16 / A17。

---

## 开工前的现状核验（本设计逐条实测，不引用上轮）

所有行号来自本次直接读码（`packages/brain/src/routes/acceptance.js` 共 354 行），yaml 数字来自本次 `js-yaml` 解析实算。

| # | 核验对象 | 实测结论 |
|---|---|---|
| 1 | `acceptance_runs` 表结构（生产库 `cecelia`） | **无 `detail` 列**。列集合 = id/run_key/title/gp_id/line/surface/version/status/pass_rate/source/created_at/updated_at。`status` CHECK 现为 4 值 `pending,in_review,passed,failed` |
| 2 | `acceptance_checks` 表结构 | 有 `detail` jsonb 与 `submitted_by`（migration 380 加的）。`check_key` 上挂**全局** UNIQUE 约束 `acceptance_checks_check_key_key` |
| 3 | 生产库既有数据 | `acceptance_checks` **21 行**；`acceptance_runs` **2 行**（1 `in_review` + 1 `pending`）。21 行的 `check_key` 全是**旧格式** `line02-android-keyword-v2.1.17:001` 这种 `{run_key}:{NNN}` 流水号 |
| 4 | `acceptance.js` 三元式实际位置 | **`:86`**（不是 v7-final 写的 `:88`）：`const status = pending > 0 ? 'in_review' : fail > 0 ? 'failed' : pass === total ? 'passed' : 'in_review';` |
| 5 | 无 `run_id` 作用域的两处 SQL | `:52-55` 的 `SELECT check_key, run_id FROM acceptance_checks WHERE check_key = ANY($1)`；`:62-67` 的 `UPDATE … WHERE check_key = $4`。J5 点名的洞属实 |
| 6 | `check_key` 生成处 | **`:215`**（v7-final 写 `:216`）：`` const checkKey = `${run_key}:${String(i + 1).padStart(3, '0')}`; `` |
| 7 | 读侧两个 `SELECT *` | `loadChecks` `:147-153`、`loadRunsWithChecks` `:155-172`（v7-final 引 `:151,155-171`，语义指向一致）；`loadPendingRuns` 在 `:174`，其活跃 run 谓词 `status IN ('pending','in_review')` 在 `:175`——v7-final 引的 `:174` 指函数本身，属实 |
| 8 | yaml `line02-android.yaml` 解析实算 | version `2.1.19`，14 步；**建行格恰 36**（步骤 1-13 共 52 格 − 16 个 `na:true`），S14 `fixedNa` 4 格全排除；`verifiable_by` 分布 **human_only 16 / machine_db 20**；`hard:true` **恰 8 格** = S2-c4/S5-c4/S6-c4/S8-c4/S10-c4/S11-c4/S12-c4/S13-c4。**与 v7-final §口径定案表逐项相等** |
| 9 | yaml 里的 `kind` 与 `scenario_required` | **两者出现次数均为 0**。`scenario_required` 在 `cells-map.mjs`（7 行含 1 行注释、6 个数据项），`verifiable_by` 在 cells-map.mjs 出现 0 次 |
| 10 | 既有 48h 哨兵 | `packages/brain/src/acceptance-aging.js`（75 行）已存在并在 `scheduler-jobs.js:70` 注册为 `acceptance-aging` job（1h 自 gate）。它**只发 Bark 告警，不改 run 状态**；其 orphan 扫描段（`:36-45`）的谓词写死 `r.status = 'failed'`（`:38`） |
| 11 | migration 号与 schema 版本 | 最新 `391_industry_vocab_views.sql`，下一个可用 **392**；`selfcheck.js:28` `EXPECTED_SCHEMA_VERSION = '391'`；`packages/brain/package.json:48` version `1.267.247` |

### 由核验带出的两个 SSOT 缺口（本设计补齐，见单元 ①/⑧）

- **缺口 1（阻塞级，v7-final 未点名）**：v7-final 的 A9 / A10②③④ / A12①③ / A15⑦ / A16① 全部读 `acceptance_runs.detail->>'…'`，但**该列在库里根本不存在**，prep-prd 的 14 项改动清单也没列。不补则上述断言全部无处落地。→ 单元 ① 补列。
- **缺口 2（阻塞级，prep-prd 漏项）**：J14 的 REC=A 是「yaml 每格补显式 `kind` 字段 + schema 设 `required`」，而 prep-prd 第 6/7 条把 zenithjoy 侧 PR 范围只写了 `scenario_class` 迁入、`op` 加厚、S13-c4 `verifiable_by` 改判三项，**漏了 `kind`**。yaml 零个 kind，而 `acceptance.js:191` 与 DB CHECK 双重强校验 kind ∈ {FR,NFR,Invariant,SOP}——不补则生成器首次建单必 400。→ 单元 ⑧ 纳入 zenithjoy PR 范围。

---

## 分单元设计

八个单元。**单元 ① 与 ③ 必须同批**（见「关键依赖」），其余按下表依赖顺序推进。

### 单元 ① · migration 392：AI 四列 + 状态机 CHECK + UNIQUE 换绑 + runs.detail

**做什么**：一支 migration 同时完成四件结构改动。之所以合成一支而不是拆四支，是因为 CHECK 扩容与三元式替换必须同批上线（见「关键依赖」），拆开会制造一个「CHECK 已扩、代码未改」的中间态窗口。

**落点**：`packages/brain/migrations/392_acceptance_two_column.sql`（新建）、`packages/brain/src/selfcheck.js:28`（`EXPECTED_SCHEMA_VERSION` 391 → 392）。

**up 的四件事**：

1. **AI 四列**（J6-A，加在 `acceptance_checks`）：
   - `ai_verdict TEXT CHECK (ai_verdict IN ('通过','不通过','无法验证'))`——复用人列同款中文枚举与同款 CHECK 形态；
   - `ai_evidence JSONB`——AI 自报的 reason 与证据指针（`ai_evidence->>'reason'` 是 A4③⑥ 的读取路径）；
   - `ai_run_at TIMESTAMPTZ`；
   - `adjudication JSONB`——裁决四字段 `verdict/by/reason/at`（A6 断言四字段全非空）。
   - 四列**全部 nullable**：`ai_verdict IS NULL` 是 Q0′「AI 列缺格」的机械载体，也是哑火判据条件③ 的取数口径，不能给默认值。

2. **`acceptance_runs` 加 `detail JSONB`**（补缺口 1）。这一列承载 v7-final 全部单头字段：`backend_sha`/`backend_sha_src2`/`frontend_sha`/`frontend_sha_src2`/`spec_sha`（A9）、`tenant_account`/`device_model`/`client_no`/`collect_task_no`/`passphrase`/`scenarios_observed[]`/`device_reboot_at`（A16①）、`ai_status`/`ai_incomplete`（哑火）、`abandoned_reason`/`abandoned_by`/`abandoned_at`（A10③）、`review_closed_at`/`review_closed_by`/`review_acks[]`（A15⑦）、`force_reason`/`force_opened_by`/`force_opened_at`（A15⑥⑦）、`bypass_used`（A12①）、`unverifiable_adjudicated[]`（A12 第四项）。**不给这些子键建独立列**——它们是 run 的可变附属信息，不是查询主键；A2 的读侧裁剪按列白名单做，`detail` 整列在默认视图里就不出现。

3. **状态机 CHECK 由 4 值扩到 7 值 + 2 个历史兼容值**：
   ```sql
   ALTER TABLE acceptance_runs DROP CONSTRAINT acceptance_runs_status_check;
   ALTER TABLE acceptance_runs ADD CONSTRAINT acceptance_runs_status_check
     CHECK (status IN ('pending','in_review','human_complete','adjudicated',
                       'stale','expired','abandoned',
                       'passed','failed'));
   ```
   `passed`/`failed` **保留在 CHECK 里但退为只读历史兼容值**——生产库现有 2 行是 `in_review`/`pending` 落在新集合内，无需 UPDATE 任何数据；A10⑤-c 用 `created_at > :migration_at` 断言新 run 不再产生这两个值。**三个非活跃终态（stale/expired/abandoned）是 `status` 取值，不是 `detail` 旗标**——A10④ 直接断言不存在「status 非终态而 detail 标了终态旗标」的行。

4. **UNIQUE 换绑**（J5-A）：
   ```sql
   ALTER TABLE acceptance_checks DROP CONSTRAINT acceptance_checks_check_key_key;
   ALTER TABLE acceptance_checks ADD CONSTRAINT uq_acceptance_checks_run_key
     UNIQUE (run_id, check_key);
   ```

**既有 21 行的迁移策略（本设计的方案，v7-final 未给）**：

- **不回填、不改写、不删除**。这 21 行是 Notion Worker 时代按 `{run_key}:{NNN}` 流水号建的，它们的 `check_key` 与 line02-android 规程的格号**没有任何映射关系**——强行映射成 `S{n}-c{m}` 等于伪造历史判定记录。
- **新 UNIQUE 对旧行天然成立**：21 行分属 2 个 run，同一 run 内 `{run_key}:{NNN}` 本就互不重复，`(run_id, check_key)` 上无冲突，`ADD CONSTRAINT` 可直接跑通，不需要任何 DDL 前的数据清洗。
- **不给 `check_key` 加格式 CHECK**（如 `~ '^S\d+-c[1-4]$'`）。加了会当场挡死这 21 行，而删旧行不在本刀授权范围内。格号规范由**建单生成器**（单元 ②）在写入侧保证，由 **A1 的 `check_key ~ '^S\d+-c[1-4]$'`**（作用域限定 `run_id = :rid`）在断言侧验证。新旧格式靠 run 分界共存，这是 UNIQUE 从全局改成 run 内之后自然获得的性质。
- **两个存量 run（1 pending + 1 in_review）不做状态迁移**：它们是活跃 run，落在新 CHECK 集合内，让它们各自按现有路径走完即可。但**它们会被单元 ⑤ 的过期扫描器扫到**（created_at 早于 48h）——这是符合预期的行为（本来就该过期），不是回归。

**down 的可逆性与一处显式不可逆点**：

down 按逆序执行：`DROP` 四列 + `detail` 列 → CHECK 恢复 4 值 → UNIQUE 恢复全局。**但恢复全局 `UNIQUE (check_key)` 在新格号数据存在时物理不可能**——第二轮 run 的 `S3-c1` 与第一轮的 `S3-c1` 必然重复，这恰恰是 J5-A 要解决的原问题。因此 down 必须：

```sql
DO $$
DECLARE dup int;
DECLARE newstat int;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT check_key FROM acceptance_checks GROUP BY check_key HAVING count(*) > 1
  ) t;
  IF dup > 0 THEN
    RAISE EXCEPTION '不可回滚：已存在 % 个跨 run 重复的 check_key（新格号数据）。回滚前须先清理这些 run，否则全局 UNIQUE 无法重建', dup;
  END IF;

  -- 与重复格号守卫对称的第二道：status 收回 4 值同样会被新状态值的存量行挡住
  SELECT count(*) INTO newstat FROM acceptance_runs
   WHERE status NOT IN ('pending','in_review','passed','failed');
  IF newstat > 0 THEN
    RAISE EXCEPTION '不可回滚：已存在 % 个处于 7 值新状态（human_complete/adjudicated/stale/expired/abandoned）的 run。回滚前须先清理或迁走这些 run，否则 4 值 CHECK 无法重建', newstat;
  END IF;
END $$;
```

两道守卫必须成对：只挡重复格号、不挡新状态值，回滚会在 `ADD CONSTRAINT` 处抛裸 23514「is violated by some row」，运维拿不到「该清哪些 run」的信息，只能自己去猜——这与 fail-fast 要给出清理路径的初衷相悖。

即 **down 在「尚未建过任何新格号 run、也没产生过新状态值」时完全可逆，越过任一边界后 fail-fast 报错说明**，而不是静默丢数据。这一点写进 migration 注释与 A10 的回归测试。

**依赖**：无（最先做）。**被依赖**：全部其余单元。

---

### 单元 ② · 规程 yaml → 36 行建单生成器

**做什么**：读 `line02-android.yaml`，产出一份可直接喂给 `POST /api/brain/acceptance/runs` 的 checks 数组。

**落点**：`packages/brain/scripts/acceptance/build-checks-from-spec.mjs`（新建；同时导出纯函数供单测直接调用，不走文件 IO）。

**输入契约**：yaml 文件路径（或已解析对象）。

**输出契约**：`{ checks: [...], spec_sha, version, stats }`，其中每个 check 为
```js
{ check_key: 'S3-c1', kind: 'FR', name: <cell.t>, device: null,
  detail: { verifiable_by, scenario_class, hard: <bool>, step_n, step_name, fails: [...] } }
```

**排除集（J10-B，逐条机械）**：
- 排除 `cells[cX].na === true` 的格；
- 排除 `step.fixedNa === true` 步骤下的**全部四格**（含该步 c1 那个有 `t` 和 `verifiable_by` 的格——`fixedNa` 优先级高于单格属性）；
- 其余全部建行。对 `line02-android.yaml` 恰得 **36 行**（本设计已实算验证）。

**`spec_sha` 算法**：对 yaml **文件原始字节**取 sha256（不是解析后重序列化——重序列化会随 js-yaml 版本漂移，让冻结锁在无人改规程时误报 `stale`）。`version` 直取 `yaml.version`（`2.1.19`）。

**A14 的构造断言**：喂一份把 S7 也标 `fixedNa: true` 的构造 yaml，建行数必须从 36 降到 **34**（S7 有效格 = c1/c2 共 2 格），且结果中不含任何 `S7-*`。这条是生成器排除逻辑的直接回归测试，写进单测。

**依赖**：单元 ⑧（yaml 侧必须先有 `kind` 与 `scenario_class` 字段，否则生成器无处取数）。这是**跨 repo 依赖**，处理方式见「关键依赖」。

---

### 单元 ③ · 状态机与格级判定分离（本刀的核心，也是最容易做错的一处）

**做什么**：把「run 的生命周期」与「格的最终态」拆成两段互不推导的计算——这是 r6-P2-1 核销的措辞，v7-final 明写「两者不得共用同一个动词或同一段计算」。

**落点**：`packages/brain/src/acceptance-state.js`（新建，纯函数，零 DB 依赖）；调用方 `packages/brain/src/routes/acceptance.js`。

**第一段：格级判定（作用域 = 单个格）**

```js
computeCellState({ result, ai_verdict, adjudication, verifiable_by, scenario_class })
  → { final_state: '绿' | '红' | '未定' }
```

严格按 v7-final §九组合表实现，无自由发挥空间：

| 人列 | AI 列 | 组合 | final_state |
|---|---|---|---|
| 通过 | 通过 | Q1 双绿 | **绿** |
| 通过 | 不通过 | Q2 分歧 | 未定 |
| 通过 | 合法无法验证 | Q3 仅人列绿 | **绿**（定义域写死 = `verifiable_by='human_only'` 且 `scenario_class ≠ 'unverifiable_this_version'`，本版恰 16 格） |
| 通过 | 故障无法验证 | Q3′ | 未定 |
| 不通过 | 通过 | Q4 分歧 | 未定 |
| 不通过 | 不通过 | Q5 双红 | **红** |
| 不通过 | 无法验证 | Q6 人红独判 | **红** |
| 无法验证 | 通过 | Q7 | 未定 |
| 无法验证 | 不通过 | Q8 | **红** |
| 无法验证 | 无法验证 | Q9 双盲 | 未定 |
| 未填 | 任意 | Q0 | 未定 |
| 任意 | **未跑（NULL）** | Q0′ | **未定（恒定，与人列取值无关）** |

三条不可动摇的实现细节：
- **Q0′ 优先级最高**：`ai_verdict IS NULL` 时直接返回「未定」，**在读人列之前就短路**。A5 要求同一格分别构造「人列通过/不通过/无法验证 + AI 缺格」三种，三次读回都必须是「未定」——写成先算人列再看 AI 是否为空，很容易在「人列通过」分支上漏掉这个短路。
- **Q3 的合法性判据是格的静态属性，不是 AI 自报的 reason**。`ai_verdict='无法验证'` 走 Q3 还是 Q3′，取决于该格 yaml 的 `verifiable_by`：`human_only` → Q3（合法）；`machine_db`（19 格）→ Q3′（故障）。AI 写什么 reason 只作补充说明。
- **`scenario_class='unverifiable_this_version'` 的格（本版 = S13-c4）不走 Q3 绿通道**，绿只能来自裁决。
- **裁决覆盖**：`adjudication.verdict='绿'` 时 final_state 判绿（这是 hard 格唯一逃生阀，记裁决人/理由/时间并计入 A12 棘轮）。

**第二段：run 级 gate 判定（作用域 = 整个 run，但仍不是 status）**

```js
computeGateVerdict(cells /* 36 格的 final_state */, runDetail)
  → { gate_verdict: '绿' | '红', red_cells: [...] }
```
- `gate_verdict='绿'` **当且仅当 36 格 final_state 全绿**；
- 任一 hard 格（8 格）非绿 → `'红'` 且 `red_cells[]` 含该格号；
- run 标 `ai_incomplete` 时闸一律拦（走 `ai_run_infra_error` 路径，与「格红」机械可区分）。

**第三段：run 级 status（7 值状态机，独立，不由前两段推导）**

替换 `acceptance.js:86` 的三元式。新算法**只看人列填写进度**，不看 AI 列、不看 final_state：

```js
const RUN_STATUSES = ['pending','in_review','human_complete','adjudicated','stale','expired','abandoned'];
const ACTIVE_RUN_STATUSES = ['pending', 'in_review'];  // 只有这两个会被「提交人列结果」改写

// 提交人列这条路径必须原样保留的前态：5 个非活跃终态 + 2 个只读历史兼容值
const PRESERVED_RUN_STATUSES = [
  ...RUN_STATUSES.filter((s) => !ACTIVE_RUN_STATUSES.includes(s)),  // human_complete/adjudicated/stale/expired/abandoned
  'passed', 'failed',                                               // migration 392 之前的历史值
];

function computeRunStatus(prevStatus, { total, humanFilled }) {
  // 非活跃终态由各自的显式转移路径设置，提交人列结果这条路径不得把它们改回去
  if (PRESERVED_RUN_STATUSES.includes(prevStatus)) return prevStatus;
  if (humanFilled === 0) return 'pending';
  if (humanFilled < total) return 'in_review';
  return 'human_complete';   // 人列填满即达，与「其中有几格不通过」无关
}
```

**必须是白名单，不能写成「不在活跃集里就透传」**：前态缺失（run 行被并发删掉，`prevStatus === undefined`）或库里躺着不可识别的历史值时，取反式判据会把 `undefined` 透传出去，写进 NOT NULL 的 `status` 列直接炸掉整笔提交，连带已落库的 check 结果一起回滚。白名单外的一律按填写进度重算。

`human_complete` 的判据是**人列 36 格全部非 NULL**，与取值无关——这正是 A10⑤ 要堵的洞：旧三元式只要有一格「不通过」就写 `failed`，而合看页/裁决/员工回显全部以 `human_complete` 为开门条件，于是「员工判出不通过的那一轮」永远打不开后续流程。其余状态转移各有专属入口：`human_complete → adjudicated`（裁决完成，D4）；`* → stale`（sha/spec_sha 变，单元 ⑦）；`pending → expired`（48h 扫描，单元 ⑤）；`* → abandoned`（显式作废端点，单元 ⑤）。

**同批必须清理的连带项**：`acceptance.js` 的驳回建任务触发条件是 `prev.status !== 'failed' && status === 'failed'`。这段在新状态机下**对任何 run 都不触发**：`computeRunStatus` 的返回只可能是三个活跃值，或经 `PRESERVED_RUN_STATUSES` 白名单原样透传的前态；`'failed'` 在白名单里，于是历史 failed run 算出的 next 仍是 `'failed'`，被 `prevStatus !== 'failed'` 挡掉，其余前态则永远算不出 `'failed'`。处理：本刀不删（分流建任务是 D4 的范围，删了会留下一段时间的空窗），但把条件抽成具名函数 `isLegacyRejectionTransition()` 并加注释写明「对任何 run 都不触发，纯占位待 D4 删除」——**不能留一段看起来在工作、实际恒不触发的裸条件**（形状同 P2-8 的棘轮击穿）。

连带的遗留项：这段休眠后，其内部 `SAVEPOINT reject_task_insert`「23505 只回滚这一条 INSERT、不毒化外层事务」的回归覆盖也**失去触发路径**——D4 的聚合式分流落地时必须重新覆盖，否则这个已经付过代价的坑会在新链路上原样复发。

**依赖**：单元 ①（CHECK 必须已扩容）。**这是本刀唯一的强同批约束，见下文。**

---

### 单元 ④ · 服务端 reason 校验

**做什么**：`POST /acceptance/ai-results` 的入口校验，三条规则。

**落点**：`packages/brain/src/routes/acceptance.js`（新增 `ai-results` 处理函数与 reason 校验纯函数）。

| 输入 | 判定 | 依据 |
|---|---|---|
| `reason='human_only'` 而该格 yaml `verifiable_by ≠ 'human_only'` | **400** | A4③，reason 绑静态属性不是 AI 说了算 |
| `reason='scenario_not_triggered'`，**任何格，无例外** | **400** | A4⑥⑦，拍板 ② 后 `opportunistic = ∅`，该 reason 合法域为空集 |
| 故障类 reason（`page_unreachable`/`login_failed`/`timeout`） | 允许落库，但**不进绿通道** | 由单元 ③ 的 Q3′ 承载 |

A4⑦ 的断言形态是「对 **36 个建行格逐格**提交 `scenario_not_triggered` → 36 次全部 400」。实现上这就是一条无条件 reject，**不查上下文、不看单头是否勾了场景码**——合法域为空与上下文无关。这条替换掉 v6 的闸②/Q3″ 整套机制。

**依赖**：单元 ②（需要格的静态属性表作为校验数据源）。

---

### 单元 ⑤ · run 生命周期（过期扫描器 / 作废端点 / review-closed / review-ack / 逃生阀）

**做什么**：给 7 值状态机的每个非活跃终态配一条显式转移路径，并实现复盘闭环闸。

**落点**：`packages/brain/src/acceptance-aging.js`（**加厚既有文件，不新建平行 job**）、`packages/brain/src/routes/acceptance.js`（三个新端点）。

**⑤-a 过期扫描器（关键：复用而非新建）**

核验第 10 条查明：`acceptance-aging.js` 这个 48h 哨兵**已经存在并已在 `scheduler-jobs.js:70` 注册**，只是它只发 Bark、不改状态。prep-prd 第 11 条写的「新增 pending 48h 过期扫描器」若照字面新建一个 job，就会出现两个 48h 扫描器抢同一批 run。**正确做法是给既有 job 加厚一段状态转移**：扫到的 `pending` run（`created_at < now() - 48h`）由告警改为 `UPDATE … SET status='expired'`，Bark 保留。

同批必须修的一处连带失效：`acceptance-aging.js:36-45` 的 orphan 扫描谓词写死 `r.status = 'failed'`（`:38`）。7 值状态机上线后新 run 永不落 `failed`，这段扫描**会静默恒返回空集而无人察觉**——和 P2-8 记的「棘轮静默 fallback」是同一个形状的病。处理：把谓词改为按 `final_state='红'` 的格数取数（对齐 D4 的分流口径），或在 D4 接管前显式标注为「只覆盖历史 failed run」并加一条断言防止它被当成活的防线。本刀取后者（前者属 D4 范围），**但必须显式**。

**⑤-b 显式作废端点**：`PATCH /acceptance/runs/:run_key/abandon`，body 需 `{ reason, by }`。落 `status='abandoned'` + `detail.abandoned_reason/abandoned_by/abandoned_at` 三项（A10③ 断言三项非空）。

**⑤-c `review-closed` / `review-ack`（A15 六场景）**

| 端点 | 主体 | 前置闸 | 结果 |
|---|---|---|---|
| `POST /acceptance/runs/:run_key/review-ack` | 该 run 的**人列提交人**（`X-Staff-Identity`） | 无 | 往 `detail.review_acks[]` 追加 |
| `PATCH /acceptance/runs/:run_key/review-closed` | **发起人或主理人**；员工身份 → **403**（A15②） | 全部人列提交人已 ack **或** 距 `adjudicated_at` 满 24h（A15③⑤） | 落 `detail.review_closed_at/review_closed_by` |

24h 兜底是防死锁的：员工零 ack 时把 `adjudicated_at` 回拨 25h，发起人打 `review-closed` 必须返 200，否则一个不配合的员工能把整条发版链锁死。

**⑤-d 建单期前置校验与逃生阀**（挂在 `POST /runs`，A15①⑥）
- 同 gp 上一轮 run 的 `detail.review_closed_at` 为空 → **409**；
- body 带 `force_reason` 且 **≥20 字**（按字符数，中文按字计）→ 放行，并落 `detail.force_reason/force_opened_by/force_opened_at` 三项留痕；`force_reason` 为空或 <20 字 → 仍 409；
- 单头 `tenant_account` 必须 ∈ 验收专用租户白名单，不等则拒绝建单（A16②）。白名单来源本刀取环境变量 `ACCEPTANCE_TENANT_ALLOWLIST`（逗号分隔），**缺该 env 时 fail-closed 拒绝一切建单**——不是降级放行。

**依赖**：单元 ①（`detail` 列）、单元 ③（状态机）。

---

### 单元 ⑥ · 收单期推进闸

**做什么**：`detail.scenarios_observed[]` 未勾齐 5 个 `mandatory` 场景码时，该 run **拒收任何 AI 回写**，返 **409**，响应体含缺失的场景码清单（A4⑧ / A16①-b）。

**落点**：`packages/brain/src/routes/acceptance.js` 的 `ai-results` 前置。

`mandatory` 集合 = 从 yaml 解析 `scenario_class='mandatory'`，本版恰 5 格：**S4-c2 / S4-c3 / S5-c3 / S5-c4 / S10-c4**。**集合从 yaml 解析取数，不在代码里硬编码格号**——这是 r6-P2-2 立的规矩，A17① 会断言解析结果与台账逐格相等（`mandatory` 恰 5、`opportunistic` 恰 ∅、`unverifiable_this_version` 恰 {S13-c4}）。

这条是拍板 ② 的承重墙：规定动作没做完，AI 采证的前提就不成立，此时收 AI 回写等于把「场景没发生」洗成「AI 判定通过」。

**依赖**：单元 ②（yaml 静态属性取数）、单元 ①（`detail` 列）。

---

### 单元 ⑦ · 版本戳落库与冻结锁

**做什么**：建单时把六项版本标识落进 `acceptance_runs`，并实现「变了就转 `stale`」（J12-A / A9 / A10）。

**落点**：`packages/brain/src/routes/acceptance.js` 的 `POST /runs`。

- 落库六项：`detail.backend_sha` / `detail.backend_sha_src2` / `detail.frontend_sha` / `detail.frontend_sha_src2` / `detail.spec_sha` + 表上已有的 `version` 列（A9 断言六项均非空，两组 sha 各自组内相等且为 40 位）。
- **建单期双源对账**：任一组两源不等 → **拒绝建单**（4xx + 无新行）。源① 是被测系统自报，源② 是构建侧 GitHub API——两个源的取数实现属 D2，D1 侧只做**校验与落库**，接口按「调用方传入两个 sha」设计，D1 不自己去拉 GitHub API。
- **冻结锁**：staging 重新部署（sha 变）或规程改版（`spec_sha` 变）→ 人列提交返 **409** 且 run 转 `stale`。
- `stale`/`expired`/`abandoned` 三态**永远达不到 `human_complete`**，因此它们不是「活跃 run」，不持防锚定锁（A2 反向断言②，读侧裁剪属 D3）。

**依赖**：单元 ①（`detail` 列）、单元 ③（`stale` 是 7 值之一）。

---

### 单元 ⑧ · zenithjoy 侧独立 PR（yaml 与 schema）

**做什么**：三项 v7-final 明写的改动 + 一项本设计核验出的补漏（缺口 2）。**这是 zenithjoy-workspace 的独立小 PR，与 cecelia 侧 PR 同批合并**（`spec_sha` 一致性——先合 yaml 会让 cecelia 侧尚未上线的冻结锁把 run 打成 `stale`，先合 cecelia 会让生成器读到没有 `kind` 的 yaml）。

**落点**：`acceptance-spec/line02-android.yaml`、`acceptance-spec/line02-android.schema.json`、`scripts/acceptance-spec/ai-run/cells-map.mjs`。

| # | 改动 | 契约 |
|---|---|---|
| 1 | **`scenario_class` 迁进 yaml** | 新增三值枚举字段 `mandatory` / `opportunistic` / `unverifiable_this_version`。实例分布写死：`mandatory` 恰 5（S4-c2/S4-c3/S5-c3/S5-c4/S10-c4）、`opportunistic` 恰 0、`unverifiable_this_version` 恰 1（S13-c4）。同时**从 `cells-map.mjs` 删除 `scenario_required`**（现有 6 个数据项 + 1 行注释），静态属性单一 SSOT 在 yaml |
| 2 | **`verifiable_by` 只改 S13-c4 一格** | `machine_db` → `human_only`。**只此一格**——拍板 ① 后 S7-c2/S9-c2 由 AI 自持计时、S4-c2 按 Gate B 第 4 条取数，时限三格全部留在 `machine_db`。改后分布变为 human_only 17 / machine_db 19，与 §口径定案表相等 |
| 3 | **`op` 加厚**（拍板 ②） | S5 的 `op`（现文「手机登录2到3个测试小号，触发一次账号扫描」）追加「手动让其中一个小号退出登录/断网，制造一次掉线」；S10 的 `op`（现文「看命中视频评论区抓到的内容」）追加「用同一关键词再发起一次采集，对照同一视频评论是否被覆盖」 |
| 4 | **`kind` 补齐**（← 缺口 2，J14-A） | 36 个建行格每格补显式 `kind ∈ {FR,NFR,Invariant,SOP}`；schema 的 `cell` 定义里把 `kind` 加进非 `na` 分支的 `required`。不补则生成器建单必被 `acceptance.js:191` 与 DB CHECK 双重拒绝 |
| 5 | **schema 同步** | `line02-android.schema.json` 的 `$defs.cell.properties` 增加 `scenario_class`（enum 三值）与 `kind`（enum 四值），并在 `else.required` 里加 `kind`。`additionalProperties: false` 已开，不加 schema 则新字段直接校验失败 |

**改 `op` 会变 `spec_sha`**——这正是要求同批的原因：上线后首轮就因规程改版把 run 打成 `stale` 是最典型的自伤。

---

## 关键依赖：单元 ① 与 ③ 必须同批

v7-final 在 D1 节里对这一条写得很重，本设计原样承接并明确到代码行：

> `acceptance.js:86`（v7-final 记作 `:88`）的三元式必须与 migration 392 的 CHECK 扩容**同批替换**。

**只扩 CHECK 不改这一行会发生什么**：CHECK 允许了 `human_complete`，但代码仍然在人列出现任一「不通过」时写 `status='failed'`。于是员工判出不通过的那一轮**永远达不到 `human_complete`**，而合看页、裁决 API、员工回显三者全部以 `human_complete` 为开门条件——它们一律 403，与此同时放行闸照常跑。这是一个「结构已就位、语义悄悄反了」的故障，从 schema 上看不出任何异常。

**只改代码不扩 CHECK 会发生什么**：`UPDATE … SET status='human_complete'` 当场撞 CHECK 违反（23514），人列提交全部 500。

因此两者**在同一个 commit 里**（TDD 的 commit-2 实现步），且 A10⑤ 是它的直接回归测试，必须永久留在 CI 里。

其余依赖关系：

```
① migration ──┬─→ ③ 状态机 ──┬─→ ⑤ 生命周期
              │              └─→ ⑦ 版本戳
              ├─→ ⑥ 推进闸
⑧ zenithjoy yaml ──→ ② 生成器 ──┬─→ ④ reason 校验
                                └─→ ⑥ 推进闸
```

---

## 测试策略

**TDD 铁律**：每个单元的每条新行为，**commit-1 写 failing test（Red）、commit-2 写实现（Green）**，两次 commit 分开。bug 修复类改动的复现测试永久留在 CI 里（regression test），不删。

四档分层的判据：**能不能不碰真实外部依赖就把这条断言证伪**。

### 档 1 · E2E（真库真跑，最贵，只给「不真跑就不可信」的断言）

| 断言 | 做法 |
|---|---|
| migration 392 在**有 21 行存量数据**的库上跑通 | 把生产库 dump 出结构+数据到 `cecelia_scratch`，跑 up，`\d acceptance_runs` / `\d acceptance_checks` 验 AI 四列 + `detail` 列 + `UNIQUE (run_id, check_key)` + 7 值 CHECK；再跑 down 验可逆（此时无新格号数据，应完全可逆）。**本地一律 `DB_NAME=cecelia_scratch`，禁止对 `cecelia` 跑本地 migrate** |
| 生成器对**真** yaml 产出恰 36 行 | 跑 `build-checks-from-spec.mjs` 打真实 `line02-android.yaml`，断言 36 行、格号全匹配 `^S\d+-c[1-4]$`、`kind`/`verifiable_by`/`scenario_class` 齐全、零个 `S14-*` |
| 同 gp 第二轮建单不再 23505 | 真库连建两轮，第二轮返 201 而非 23505 |

### 档 2 · integration（vitest + 真 PG scratch 库，无 mock，覆盖跨事务与约束语义）

对应断言 A1 / A3 / A9 / A10 / A15 / A16①②：

- **A1**：单 run 内 `check_key='S3-c1'` 恰 1 行；`count(*) WHERE run_id=:rid` = 36；`count(*) … LIKE 'S14-%'` = 0。
- **A3 跨 run 写隔离**（堵 `acceptance.js:62-67`）：向 run A 提交 `S3-c1='通过'` 后，run B 的 `S3-c1` 仍为 NULL。走 psql 直查不经 API。
- **A10①**：`pg_constraint` 查回的 CHECK 定义含全部 7 值。
- **A10②**：把一个 pending run 的 `created_at` 回拨 49h，跑一次扫描器，`status` 必须变 `expired`。
- **A10③**：作废端点后三项留痕非空且 `status='abandoned'`。
- **A10④ 反二义**：不存在 `status IN ('pending','in_review')` 而 `detail ? 'stale'/'expired'/'abandoned'` 的行。
- **A10⑤（本刀最重要的回归测试）**：⑤-a 人列 36 格填满、其中至少一格「不通过」→ `status='human_complete'`，**不得为 `failed`**；⑤-b 人列全「通过」→ 同样 `human_complete`，**不得为 `passed`**；⑤-c 全表扫 `status IN ('passed','failed') AND created_at > :migration_at` = 0。
- **A15①-⑦**：六个 HTTP 场景（未闭环建单 409 / 员工打 review-closed 403 / 未 ack 未满 24h 403 / 全员 ack 后 200 / 24h 兜底 200 / `force_reason` ≥20 字放行且 <20 字仍 409）+ 留痕字段 psql 复核。
- **A16①②**：单头六项落库非空；非专用租户账号建单 → 非 200 且无新行。

### 档 3 · unit（vitest，纯函数，零 IO，跑得最快、条数最多）

- **A5 九组合矩阵逐行对表**：`computeCellState` 对 Q1/Q2/Q3/Q3′/Q4/Q5/Q6/Q7/Q8/Q9/Q0/Q0′ 每行至少 1 例。**Q0′ 单独三例**（人列分别为通过/不通过/无法验证 + AI 缺格），三次都必须「未定」。**Q3″ 与 `scenario_falsified` 不构造**——本版 `opportunistic = ∅` 使该形态物理不可产生（r6-P2-3 的核销方式）。
- **A5 闸判据**：`gate_verdict='绿'` 当且仅当 36 格全绿；任一 hard 格非绿 → 红且 `red_cells[]` 含该格号；hard 格为 Q3′ 时不得判绿。
- **A17④**：构造 S12-c1（`human_only`，恒需安卓真机）「AI reason=human_only 无法验证 + 人列通过」→ `final_state='绿'`（Q3 合法通道没被 fail-closed 误伤）。
- **A17⑤**：`unverifiable_list`（从 yaml 解析，本版 {S13-c4}）无裁决不得绿；有 `adjudication.verdict='绿'` 且 by/reason/at 非空 → 绿。
- **A4⑥⑦ reason 校验**：非 `human_only` 格 + `reason='human_only'` → 400；**对 36 个建行格逐格**提交 `reason='scenario_not_triggered'` → 36 次全 400，无一例外。
- **A4⑧ / A16①-b 推进闸**：`scenarios_observed[]` 缺任一 `mandatory` 码 → 409 且响应含缺失清单。
- **哑火三条件**：① 确定判定格数 == 0；② 19 个 `machine_db` 格中故障类无法验证 ≥ 10；③ 缺格数 > 0。任一成立即 `detail.ai_status='dumb'` + `ai_incomplete`。**分母 19 与阈值 10 从 yaml 解析得出，不硬编码**。
- **A14 生成器排除集**：喂构造 yaml（S7 加 `fixedNa: true`）→ 建行数 36 降到 34 且不含 `S7-*`。
- **A17①**：yaml 解析出的三个 `scenario_class` 集合与台账逐格相等；**「`opportunistic` 恰为空集」单列一条断言**——它一旦失败说明有人重新引入了 opportunistic 格，必须同批补回闸②/Q3″/`scenario_falsified` 整套机制。
- **A17⑥**：`(scenario_class='mandatory' ∩ verifiable_by='machine_db')` 集合基数 == 5，且每格 `ai_verdict ∈ ('通过','不通过')`。

### 档 4 · trivial（不写测试）

migration 里的注释、`EXPECTED_SCHEMA_VERSION` 常量 bump、纯字符串文案。理由：这些改动的失败模式会被 DevGate（`facts-check.mjs` / `check-version-sync.sh` / `check-dod-mapping.cjs`）或档 1 的结构断言直接抓住，单独写测试是重复覆盖。

### 一条全局取数纪律

**所有涉及「AI 可判格数」的断言一律从 yaml 解析取数，不硬编码 19 / 17 / 5 / {S13-c4}**。Gate B 第 4 条落档 3 时 S4-c2 转 `human_only`，全表数字整体位移（human_only 18 / machine_db 18 / 阈值 ≥9 / `mandatory ∩ machine_db` 缩为 4）；硬编码等于在回落发生时静默算错。`:human_only_list` / `:unverifiable_list` / `:mandatory_scenario_codes` / `:mandatory_machine_db_list` 四个占位符共用同一套解析工具函数。

---

## 错误处理与回滚

**建单期的 fail-closed 清单**（这些都是「宁可不建单也不建错单」）：上一轮未闭环复盘 → 409；`tenant_account` 不在白名单 → 4xx；`ACCEPTANCE_TENANT_ALLOWLIST` env 缺失 → 拒绝建单而非降级放行；双源 sha 不等 → 4xx 且无新行。

**收单期**：`mandatory` 场景码未勾齐 → 409（整 run 拒收，不是逐格拒）；reason 非法 → 400（逐格拒，其余格照收）；sha/spec_sha 变 → 409 且 run 转 `stale`。

**事务边界**：`submitAcceptanceResults` 现有的 `SELECT … FOR UPDATE` 行锁（`:75`）与 SAVEPOINT 保护（`:114-131`）保留不动——那两处注释记录的是并发提交覆盖与事务毒化两个已修 bug，改状态机时不得顺手清理。

**回滚策略**：
- **代码回滚**：单元 ③ 与 ① 同批，回滚也必须同批 revert，否则落进「CHECK 已扩、代码是旧三元式」的中间态。
- **migration 回滚**：见单元 ① 的 down 设计——**未建过新格号 run 时完全可逆；建过之后 fail-fast 报错并说明清理路径**，不静默丢数据。
- **上线顺序**：cecelia PR 与 zenithjoy PR 同批合并；先合任一单边都会自伤（先合 yaml → `spec_sha` 变但 cecelia 侧冻结锁未上线；先合 cecelia → 生成器读到无 `kind` 的 yaml 建单 400）。
- **部署**：Brain 改动必须走 `brain-deploy.sh` 重建镜像（容器跑的是镜像快照不是 mount）；deploy 前 `node --check` 冒烟。

---

## 不做什么（防 scope 蔓延）

以下全部**不在 D1**，即使实现时看起来"顺手就能做"：

| 属于 | 不做的事 |
|---|---|
| **D2** | AI 打表器的任何改动：`cells-map.mjs` 的 `action` 枚举收窄、删 `signup_flow`、删 signup 回落、二次采集、自持计时、S4-c2 三档取数、打表器 workflow、Playwright allowlist、`POST /acceptance/ai-results` 的**采证侧**实现、staging `GET /api/version`、前端 build sha 标记。**D1 只做该端点的服务端校验与落库语义，不做采证器** |
| **D3** | `loadChecks:147-153` / `loadRunsWithChecks:155-172` 的 SQL 列白名单裁剪、`view` 参数、gp 级跨轮闸、反代层同步、`createBearerAuth` 下沉与三 token 分权、公网端点下线。**本刀只加列不减列**——Staff Hub 现有三页面的读接口不得破坏 |
| **D4** | 九组合矩阵合看页、裁决 API、员工回显、ack/异议 note 的**页面**、侧边栏角标、建单页表头字段、`lib.mjs` 收编、聚合式分流建任务与熔断。**D1 只提供 `final_state`/`gate_verdict` 的计算与 `adjudication` 列，不做任何 UI，也不建分流任务** |
| **D5** | 放行闸第三证据项、`two-column-gate.sh`、selftest workflow、`promote-all-prod.yml` 接线、四项棘轮计数 |
| **Phase 2** | 连续多轮双绿的格从员工表摘除、Kernel 融合、其余 GP 的 acceptance-spec yaml、S13-c4 受控注入根治 |

另外三条明确不做：

- **不删既有 21 行历史数据**，不给它们回填规程格号。
- **不给 `check_key` 加格式 CHECK**（会挡死历史行）。
- **不新建平行的 48h 扫描 job**——加厚 `acceptance-aging.js`。

---

## DevGate 与收尾

改 `packages/brain` 前必过三件套：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs`。migration 392 落地后同批 bump `selfcheck.js:28` 的 `EXPECTED_SCHEMA_VERSION` 391 → 392，并按 semver bump `packages/brain/package.json`（现 1.267.247）。DoD 三要素：至少 1 个 `[BEHAVIOR]`、push 前全 `[x]`、feat PR 含 `*.test.*`。
