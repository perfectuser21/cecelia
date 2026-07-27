# Sprint Contract Draft (Round 3)

## 锚定父路声明

覆盖父路 `Cecelia Harness Pipeline`（`bb8cc561-b3ee-4fec-b74d-2255694bd963`）第 1-6 个现有历史步骤，并将同一路原位补齐为 S0-S12。

## Notes

- contract-gate: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。
- Registry 已读取，但照相层已过期约 205 小时；字段与表约定以 PRD、当前源码、migration 348-350 和真实只读 Brain API 响应交叉确认。
- context-manifest: unavailable（Brain 当前返回 `Cannot GET /api/brain/line/.../context-manifest`）。
- judgment-resolved-by-prd: 历史步骤不能可靠一对一映射时，保留原 ID/Notion 关联并作为同一 lifecycle stage 的历史别名，禁止删除重建。
- Round 3 收敛：补齐 S0-S12 稳定名称/promise 的逐项 oracle，并把 legacy P0/P1
  逐项映射的权威落点固定为根 `regression-contract.yaml`；派生 audit JSON 仍非权威。
- 本轮只建立账本基线；所有接缝在 evaluator 使用隔离 PostgreSQL 真验前均为 `logic-done-pending`。

## Response Schema（推导来源: PRD字面）

N/A — 本 sprint 不新增 HTTP endpoint 或新的 HTTP Response Schema。既有
`GET /api/brain/journeys/:id` 与 `GET /api/brain/journey_steps` 仅暴露迁移后的同表字段；
不得改变既有字段名或删除字段。PRD 的对外可观察契约由下文数据库断言和既有 API
的 `endpoint`、`lifecycle_stage`、`is_backbone` 字段值共同验收。

## 真实调用方请求 shape

N/A — Golden Path 不含设备/agent 调服务端，也不新增 webhook 或鉴权路径。验收调用方
是本仓库 smoke 脚本：使用 `HARNESS_TEST_DATABASE_URL` 连接隔离测试库，并对启动在独立
端口的真实 Brain 发出无 body 的 `GET /api/brain/journeys/:id` 与
`GET /api/brain/journey_steps?journey_id=<uuid>` 请求。

## 已知约束（来自回归测试与累积 FR）

- `[packages/brain/src/lib/__tests__/eleven-elements-ledger.test.js]` → `computeLedgerStatus — 11要素纯函数` 当前返回 `ok/partial/missing/stale`，本 sprint 必须把落库格态归一为 PRD 五态，且不能用文档存在推导 green。
- `[packages/brain/src/__tests__/integration/migration-349.integration.test.js]` → `旧 UNIQUE(journey_id,step_id) 已删，两个 partial unique 已建（一步多格子）`。
- `[packages/brain/src/__tests__/integration/migration-350.integration.test.js]` → `幂等：重放 348 文件内容不新增行`，新 migration 必须保持同一幂等惯例。
- `[packages/brain/src/routes/__tests__/journeys.test.js]` → `POST /journey_steps promise`、cell 行 partial-index upsert、journey/step 一致性护栏均不得回退。
- `[packages/brain/src/routes/__tests__/journey-steps-ledger.test.js]` → ledger 端点必须复用 `computeLedgerStatus`，不能复制第二套计算。
- `[packages/brain/src/__tests__/harness-promote-regression.test.js]` → 根 `regression-contract.yaml` 的 Golden Path 合并以 task 前缀幂等覆盖，不能另建第二份 SSOT。
- `[累积FR]` PRD 明确本 line 暂无历史。
- `[累积FR]` context-manifest: unavailable。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 在现有 F1 Journey 原位建立 13 个 backbone stage、保留全部历史 ID/Notion 关联、为每个 backbone stage 落 11 个 element cells，并输出 legacy P0/P1 可审计基线。 |
| **NFR（做得多好）** | 非功能需求 | migration 和入口重复执行结果相同；只允许隔离测试库写入；不改变 merge/staging/production 运行时；失败非零退出；不泄露凭据。 |
| **Invariant（永不违反）** | 安全/一致性 | Journey ID 固定；不新建平行 Journey/表/回归 SSOT；历史记录不删除；green 必须有绑定版本/SHA 的可重复执行证据。 |
| **判定点（怎么知道）** | 现实判断 | 见下方登记表。 |
| **保质期（何时过期）** | 证据寿命 | baseline 记录 `verified_at`/`artifact_sha`；SHA 变化、assertion_ref 消失或到达 `expires_at` 后降为 pending，不沿用旧 green。 |
| **死亡告警（停了谁知道）** | 停摆发现 | smoke/CI 任一结构、引用或真库断言失败即非零；后续账本保鲜任务负责持续告警，本刀仅建立可机检基线。 |
| **失败语义（挂了怎么办）** | 故障策略 | 缺真实证据 fail-closed 为 gray/red/pending/unknown，绝不乐观 green；migration 失败回滚，审计失败非零退出。 |
| **效果确认（已发≠已生效）** | 外部效果 | 隔离真 PostgreSQL 重放 migration 两次后查唯一行、历史 ID、143 格子、合法引用，再由真实 Brain GET 交叉验证。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 历史 GAN Proposer/Reviewer 与 Evaluator/Final E2E 的 stage 归属 | A. 删除合并；B. 强行占用不同 stage；C. 同 stage 保留一个 backbone 与历史别名 | C. 同 stage 历史别名 | PRD 要求 ID/Notion 关联不丢，且不可靠映射时保留 ID 并标缺口 | 历史谱系被静默改写，账本审计失真 |
| ⚠️ element cell 能否标 green | A. 文档/静态 grep；B. assertion_ref 存在；C. 绑定 SHA 的真实可重复执行 PASS | C. 绑定 SHA 的真实执行 PASS | PRD 明确文档不能单独产生 green | 假绿导致 Kernel 被错误宣布等价 |
| legacy 行为审计状态 | A. 按名字猜；B. 结合 legacy source、真实测试路径、根合同与退役事实分类 | B. 四源交叉分类 | PRD 指定冲突为 drifted、未完成为 unknown | 错误 owner/状态导致下一刀顺序失真 |

以上两个 ⚠️ 判定点均已由 PRD 的“已确认纠偏”、边界情况和假设拍板，无待用户确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| migration 任一 SQL 失败 | 整体事务回滚、命令非零 | 是；固定 ID + partial unique upsert | 无放行 |
| 历史映射有歧义 | 保留历史行，`is_backbone=false`，baseline 记录 gap | 是 | 不删除、不伪造一对一映射 |
| assertion_ref 缺失/不可执行 | cell 不得 green；审计状态 drifted 或 unknown | 是 | fail-closed |
| 根/legacy 合同冲突 | 标 drifted 并给出 next knife | 是 | 不覆写 legacy source 冒充已统一 |
| 隔离测试库不可用或误指生产库 | smoke 立即非零退出 | 是 | 不执行任何写入 |

### 输入对抗面

N/A — 本 sprint 不暴露新 agent 或外部写接口。仍须防止恶意/陈旧 repository
evidence 把 cell 推成 green：审计只认根合同、真实可执行测试、绑定 SHA 和执行回执。

## 接缝清单

1. `migration 365 ↔ 真 PostgreSQL journeys/journey_steps/journey_step_links`：在名称以
   `_test` 或 `preview_` 标识的隔离库中重放两次，验证唯一性、历史保全和 143 个 element cells。
2. `审计器 ↔ 根 regression-contract.yaml/真实测试路径`：逐条解析并实际校验引用存在；
   green 还必须有当前 SHA 的真实 PASS envelope。
3. `Brain journeys API ↔ 迁移后测试库`：真实启动 Brain 到独立端口，用 curl+jq 验证 endpoint
   与 S0-S12 的 `lifecycle_stage/name/promise/is_backbone`；不得以 pool mock 或静态文件 grep 替代。

## 禁 mock 边清单

- `packages/brain/migrations/365_* ↔ PostgreSQL journeys/journey_steps/journey_step_links`（本单修改 DB 写路径，integration 与 smoke 必须真 PostgreSQL）。
- `packages/brain/src/lib/eleven-elements-ledger.js ↔ journey_step_links cell_status/assertion_ref`（本单改变状态判定与落库映射，禁止 mock 查询结果证明接缝）。
- `baseline 审计器 ↔ regression-contract.yaml ↔ test_command 指向的真实文件`（禁止虚构 YAML/假路径）。
- `packages/brain/src/routes/journeys.js ↔ 迁移后 PostgreSQL`（API 交叉验收须启动真实 Brain；现有 mock route 单测只能作辅助）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；所有被改接缝在隔离真 PostgreSQL 与真实 Brain 上验证。生产库按 PRD 禁止写入。）

## Golden Path

审计者进入现有 F1 → 确认唯一 Journey → 保留历史并补齐 S0-S12 → 落 11 要素可信状态
→ 审计 legacy P0/P1 与 assertion_ref → 延伸 endpoint 语义 → 输出基线与下一刀顺序。

### Step 1: 只认现有 Cecelia Harness Pipeline
**来源**: `[FROM_PRD]` — PRD「Golden Path」具体步骤 1 与产品法律。

**可观测行为**: Journey ID 仍为 `bb8cc561-b3ee-4fec-b74d-2255694bd963`，名称仍为
`Cecelia Harness Pipeline`；不存在 `Kernel Harness Delivery`，也没有同域第二条 Harness Journey。

**验证命令**:
```bash
HARNESS_TEST_DATABASE_URL="${HARNESS_TEST_DATABASE_URL:?}" timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh unique-journey
```

**硬阈值**: 目标 Journey count=1；禁止名称 count=0；平行账本表 count=0。以上均由命令非零失败。

### Step 2: 保留历史 ID 并形成 S0-S12 backbone
**来源**: `[FROM_PRD]` — PRD「Golden Path」步骤 1-2 与边界情况。

**可观测行为**: 六个历史 Step ID 及 Notion 关联逐字保留；13 个 `is_backbone=true`
的 stage 使用以下稳定名称和 promise；不能可靠合并的 GAN Reviewer/Final E2E 作为同 stage
历史别名保留，且 `is_backbone=false`。

| Stage | 稳定名称 | promise |
|---|---|---|
| S0 | Task Born | 每个任务有稳定身份、来源、仓库、环境、风险和锚点 |
| S1 | Intent / PrepPRD | 用户意图、成功标准、真实旅程和依赖被冻结 |
| S2 | Planner | 计划覆盖 FR/NFR/Invariant/真实 E2E，范围足够薄 |
| S3 | Contract GAN | 对抗审核后的合同可执行且批准后不可偷改 |
| S4 | Generator | 在受控工作树先 Red 后 Green，创建 Harness-owned PR |
| S5 | CI | 客观检查全绿，只产证据，不持有 Harness merge 权 |
| S6 | Evaluator | 新 session 真跑合同、反作弊和真实 E2E |
| S7 | Independent Judge | 独立复核 Evaluator 证据并给最终机器裁决 |
| S8 | Risk-based Human Review | 首次/高风险变更在 merge 前由主理人查看 |
| S9 | Merge | 只有唯一 Merge Authority 在全部门禁满足后合并 |
| S10 | Staging | 部署并验证刚合并的精确 artifact |
| S11 | Production | 按发布策略 promote、验活并留回滚锚点 |
| S12 | Report / Learning / Complete | 更新承诺地图、回归、学习和外部状态后才收账 |

历史 backbone 映射固定为 Planner→S2、GAN Proposer→S3、Generator→S4、Evaluator→S6；
GAN Reviewer 是 S3 历史别名，Final E2E 是 S6 历史别名。六个历史行均不得删除或换 ID。

**验证命令**:
```bash
HARNESS_TEST_DATABASE_URL="${HARNESS_TEST_DATABASE_URL:?}" timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh history-and-backbone
```

**硬阈值**: 6/6 历史 ID 与 notion_id 不变；13 个 backbone stage 的
`lifecycle_stage/name/promise` 与上表逐字相等且无缺失/重复；Reviewer/Final E2E
`is_backbone=false`；migration 二次应用前后行数与映射摘要一致。

### Step 3: 为每个 backbone Step 落可信的 11 要素
**来源**: `[FROM_PRD]` — PRD「Golden Path」步骤 2-3 与 11 要素统一含义；
`[AI_ADDED]` — 将“文档不能产生 green”具体化为 current-SHA PASS envelope 断言，防止历史/静态证据假绿。

**可观测行为**: 每个 S0-S12 恰有以下 11 个 `cell_kind='element'`：
`FR/NFR/不变量/判定点/保质期/死亡告警/失败语义/效果确认/对抗面/账本保鲜/两轴衔接`。
状态只可能是 `gray/red/pending/green/na`。

**验证命令**:
```bash
HARNESS_TEST_DATABASE_URL="${HARNESS_TEST_DATABASE_URL:?}" timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh cells-and-evidence
```

**硬阈值**: element cell 总数=143；每 step=11；非法/重复 key=0；非法状态=0；
`green AND (assertion_ref IS NULL OR current-SHA PASS envelope 缺失)` count=0。

### Step 4: 审计 legacy P0/P1 并给出基线
**来源**: `[FROM_PRD]` — PRD「Golden Path」步骤 4 与验收点 6。

**可观测行为**: 根 `regression-contract.yaml` 的
`kernel_harness_f1_baseline.behaviors[]` 是逐项归位的权威映射；派生 audit JSON 明确
`authoritative=false`。审计输入集合为以下四类的去重并集，不能只数 engine YAML：

1. `packages/engine/regression-contract.yaml` 中全部 P0/P1 条目；
2. `packages/engine/hooks/` 下现存 guard/hook 入口；
3. `scripts/devgate/` 下现存 check 入口与 `.github/workflows/` 中 DevGate/CI gate job；
4. 根合同与 `packages/brain/src/orchestrator/gates.js` 暴露的 Kernel gate。

每个发现项必须有且只有一个 `behaviors[]` 映射，字段为 `legacy_behavior_id`、`priority`、
`journey_stage(S0-S12)`、`element(11 要素之一)`、`legacy_owner`、
`audit_status(active|shadowed|retired|drifted|unknown)`、`unified_owner`、`gap`、
`next_knife_order`、`source_ref`、`assertion_ref`。`source_ref` 必须指向上述 legacy source；
非空 `assertion_ref` 必须指向根合同内带真实 `test_command` 的条目。没有足够事实的发现项
仍必须归位，但状态为 `unknown` 或 `drifted`，禁止丢弃或乐观标 active。

**验证命令**:
```bash
HARNESS_TEST_DATABASE_URL="${HARNESS_TEST_DATABASE_URL:?}" timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh legacy-baseline
```

**硬阈值**: 四类 source inventory 的 `discovered_count=mapped_count` 且
`unmapped_count=0`、`duplicate_mapping_count=0`；每条 11 字段齐全；stage/element/status
枚举合法；`source_ref` 存在；非空 `assertion_ref` 在根合同唯一解析且其 `test_command`
目标真实存在；所指 stage/element 在真库 143 cells 中存在；`next_knife_order` 为正整数且排序确定。

### Step 5: assertion_ref 只指向唯一根合同或真实可执行测试
**来源**: `[FROM_PRD]` — PRD「Golden Path」步骤 5 与边界情况。

**可观测行为**: 非空 assertion_ref 可在根 `regression-contract.yaml` 的 `test_command`
条目中唯一解析，且命令指向真实测试/脚本；engine 合同、hooks、DevGate、CI、Kernel gates
只作为 `source_ref`，不能被当作第二权威映射。

**验证命令**:
```bash
HARNESS_TEST_DATABASE_URL="${HARNESS_TEST_DATABASE_URL:?}" timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh assertion-refs
```

**硬阈值**: 悬空/静态文档 assertion_ref count=0；基线条目的非空 assertion_ref 全部解析到
根合同中的唯一 entry + 可执行 `test_command`；根回归 SSOT count=1；engine 合同未被改造成第二权威源。

### Step 6: endpoint 明确 merge 不等于 completed
**来源**: `[FROM_PRD]` — PRD「Golden Path」步骤 6 与 E2E 验收点 4。

**可观测行为**: 同一 Journey 的 endpoint 明确包含 production verified、rollback anchor、
report/learning 收账三层语义；本 sprint 不改变实际运行时状态机。

**验证命令**:
```bash
HARNESS_TEST_DATABASE_URL="${HARNESS_TEST_DATABASE_URL:?}" timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh endpoint-semantics
```

**硬阈值**: 真实 Brain GET 返回 HTTP 200；`.id` 精确匹配；`.endpoint` 同时命中三层语义，
且不等于旧的 merge-only endpoint。

### Step 7: 输出非权威报告并证明运行时零行为改动
**来源**: `[FROM_PRD]` — PRD「Golden Path」出口、范围限定与验收点 7。

**可观测行为**: audit JSON 是从同一 Journey、根合同和 legacy source 即时派生的 artifact；
merge/staging/production 的现有行为测试不回退，报告本身不能写回成为新 SSOT。

**验证命令**:
```bash
HARNESS_TEST_DATABASE_URL="${HARNESS_TEST_DATABASE_URL:?}" timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh runtime-nonregression
```

**硬阈值**: 审计 JSON 声明 `authoritative=false`；禁止表与第二 YAML 均不存在；既有
completion/finalize/staging 回归全部 exit 0；失败不得 warning 降级。

## E2E 验收（最终 final-e2e 跑 — local_api）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

: "${HARNESS_TEST_DATABASE_URL:?必须提供隔离 PostgreSQL 连接串}"
DB_NAME=$(psql -X -qAt "$HARNESS_TEST_DATABASE_URL" -c 'SELECT current_database()')
case "$DB_NAME" in
  *_test|preview_*) ;;
  *) echo "FAIL: 拒绝在非隔离数据库执行 db=$DB_NAME"; exit 1 ;;
esac

export DATABASE_URL="$HARNESS_TEST_DATABASE_URL"
node packages/brain/src/migrate.js

for CASE_NAME in \
  unique-journey \
  history-and-backbone \
  cells-and-evidence \
  legacy-baseline \
  assertion-refs \
  endpoint-semantics \
  runtime-nonregression
do
  timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh "$CASE_NAME"
done

echo "OK: Cecelia Harness Pipeline F1 账本归位与等价基线 Golden Path 通过"
```

通过标准：脚本 exit 0；隔离真 PostgreSQL 和真实 Brain 七段全部通过。任一环境 guard、
迁移、引用、API 或回归断言失败均为 FAIL，不允许 SKIP/`|| true`/warning 降级。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 唯一 Journey 与幂等 | `sprints/07271239-kernel-harness-11-elements-baseline/tests/kernel-harness-f1-baseline.test.ts` | 唯一 F1 Journey 且二次应用不重复 | migration/module 未实现，测试收集或首个真库断言失败 |
| 历史与 backbone | `sprints/07271239-kernel-harness-11-elements-baseline/tests/kernel-harness-f1-baseline.test.ts` | 历史 ID 与 Notion 关联保留且 S0-S12 名称 promise 骨干完整 | S0-S12/历史映射当前不存在 |
| 11 要素 | `sprints/07271239-kernel-harness-11-elements-baseline/tests/kernel-harness-f1-baseline.test.ts` | 每个 S0-S12 骨干 Step 恰有 11 个合法 element cells | 当前目标 Journey 无 element cells |
| 证据可信 | `sprints/07271239-kernel-harness-11-elements-baseline/tests/kernel-harness-f1-baseline.test.ts` | green 只接受真实 assertion_ref 且引用存在 | 当前 classifier 仍接受静态 smoke 文案 |
| legacy 基线 | `sprints/07271239-kernel-harness-11-elements-baseline/tests/kernel-harness-f1-baseline.test.ts` | legacy P0/P1 四类来源逐项归位且权威映射完整 | 审计器与根合同映射未实现 |
| 完成语义 | `sprints/07271239-kernel-harness-11-elements-baseline/tests/kernel-harness-f1-baseline.test.ts` | endpoint 延伸到 production verified 与 report learning | 现 endpoint 仍停在 PR 合并 |
| 非目标护栏 | `sprints/07271239-kernel-harness-11-elements-baseline/tests/kernel-harness-f1-baseline.test.ts` | 不新增平行账本且运行时表状态不被迁移改写 | 新 migration 尚不存在，护栏先红 |

## 交付边界与版本纪律

- 允许修改：幂等 migration、11 要素状态判定/审计模块、journeys additive 查询字段、
  根 regression contract、真 PostgreSQL integration/smoke、Brain 版本与 `DEFINITION.md`。
- `packages/engine/regression-contract.yaml` 只能读取和审计；除明确 legacy-source 注释外不得改语义，
  不得成为第二份权威合同。
- 禁止修改 merge/staging/production 状态迁移与默认路由；若 generator 发现必须修改，停止并
  以 NEEDS_CONTEXT 上报，不得扩 scope。
- 修改 `packages/brain/src/` 时必须按仓库规则同步 Brain 版本与 `DEFINITION.md`。
