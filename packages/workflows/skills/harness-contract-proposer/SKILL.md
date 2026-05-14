---
id: harness-contract-proposer-skill
description: |
  Harness Contract Proposer — Harness v5 GAN Layer 2a：
  读 PRD，GAN 对抗写 Golden Path 合同（每步含真实验证命令）；
  Reviewer APPROVED 后倒推拆 task-plan.json。
version: 7.6.0
created: 2026-04-08
updated: 2026-05-11
changelog:
  - 7.6.0: 修 Bug 9 proposer 写 0 条 [BEHAVIOR] 借口"v5.0 严禁"（W26 实证 r3 proposer 在 contract-dod 末尾写"v5.0 [BEHAVIOR] 条目已搬迁到 vitest，DoD 纯度规则：本文件只装 [ARTIFACT]"）—（a）changelog v5.0 行标 [已废止]；（b）Step 2b 阈值提前并改成"必须 ≥ 4 条 [BEHAVIOR]"；（c）加"禁止借口"反例段；（d）自查 checklist 加第 5 条 grep -c BEHAVIOR ≥ 4 断言
  - 7.5.0: 修 Bug 8 proposer 漂 PRD 字段名（W25 实证 proposer 把 PRD `{result,operation}` 改 `{negation}`）— Step 2 新增"死规则"段："PRD 是法律，proposer 是翻译，不许改字段名"。Contract response key 必须**字面**用 PRD 给的 key，禁用列表里的字段名 contract 严禁出现。加自查 checklist
  - 7.4.0: 修 BEHAVIOR 位置协议矛盾（W22 sub-evaluator 4 次 FAIL 的根因）— DoD 分家规则改成 BEHAVIOR 内嵌 contract-dod-ws*.md 用 manual:bash（不是 vitest 索引）。Step 2b 模板示例改成至少 4 条 [BEHAVIOR] 严示例（schema 字段 + 完整性 + 禁用字段反向 + error path）。跟 evaluator v1.1 反作弊红线第 3 条对齐
  - 7.3.0: 加 PRD Response Schema → jq -e codify 强制规则 — Step 2 验证命令写作规范新增"PRD response 字段必须 codify 成 jq -e 命令"段。配合 planner v8.1 新增的"## Response Schema"段 + reviewer v6.1 新增第 6 维 rubric verification_oracle_completeness 形成完整 schema oracle 链路。W19/W20 实证 generator schema drift 的根因消除
  - 7.2.0: 修 verdict JSON 输出限定 — Step 4 删 APPROVED-only 限定词，改成"每轮（含被 REVISION 打回轮）"；新增"输出契约"段明示 brain harness-gan.graph.js extractProposeBranch 用正则解析。配合 brain fallback 改格式 cp-harness-propose-r{round}-{taskIdSlice}，杜绝 propose_branch 协议 mismatch（W8 task 49dafaf4 实证）
  - 7.1.0: 修复 task-plan.json 永不生成 (#2819) — Step 3 改成每轮都生成（删 "仅 APPROVED 时执行" 门槛）；APPROVED 分支即最后一轮 proposer 的分支，inferTaskPlan 从此读取
  - 7.0.0: Golden Path 合同 — 格式从"Feature 1/Feature 2"改为 Golden Path Steps（每步含验证命令）；GAN 新增"验证命令可否造假"审查；合同 GAN 收敛后 Proposer 输出 task-plan.json（从 Golden Path 倒推）
  - 6.0.0: Working Skeleton — is_skeleton 检测；按 journey_type 切换 E2E test 模板（4 种）；contract-dod-ws0.md 加 YAML header
  - 5.0.0: [已废止 — v7.4 起反转] TDD 融合 — 合同产出 3 份产物；Test Contract 索引表；~~严禁 contract-dod-ws 出现 [BEHAVIOR] 条目~~（**v7.4 起反转：BEHAVIOR 必须留 contract-dod-ws*.md 内 + 带 manual:bash 命令；不要再按此条执行**）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，直接按本文档流程操作。**

# /harness-contract-proposer — Harness v5 Contract Proposer

**角色**: Generator（合同起草者）
**对应 task_type**: `harness_contract_propose`

---

## 职责

读取 `sprint-prd.md`，提出 **Golden Path 合同**（每步含真实验证命令 + 完整 E2E 脚本）。
产出：

1. **`${SPRINT_DIR}/contract-draft.md`** — Golden Path Steps 合同，每步含验证命令 + 硬阈值，末尾含 E2E 验收脚本
2. **`${SPRINT_DIR}/contract-dod-ws{N}.md`** — 每个 workstream 的 DoD（只装 [ARTIFACT] 条目）
3. **`${SPRINT_DIR}/tests/ws{N}/*.test.ts`** — 真实失败测试（TDD Red 阶段）

GAN 收敛（Reviewer APPROVED）后输出第 4 件：

4. **`${SPRINT_DIR}/task-plan.json`** — 从 Golden Path 倒推的任务 DAG

**GAN 对抗核心**：
- Reviewer 审合同是否覆盖 Golden Path 全程
- Reviewer 审验证命令是否能造假通过（核心新增）
- GAN 轮次无上限，直到 Reviewer APPROVED

---

## DoD 分家规则（v7.4 修订 — 跟 evaluator v1.1 协议对齐）

| 类型 | 住哪 | 说明 |
|---|---|---|
| **[ARTIFACT]** | `contract-dod-ws{N}.md` 内 ARTIFACT 段 | 静态产出物：文件/内容/配置 |
| **[BEHAVIOR]** | `contract-dod-ws{N}.md` 内 BEHAVIOR 段（**带 `manual:bash` 内嵌可执行命令**） | 运行时行为：API 响应/函数返回 |
| 辅助单测 | `tests/ws{N}/*.test.ts` 的 `it()` 块 | generator 写代码用的 vitest，**不当 evaluator oracle**——evaluator 不读 vitest 输出，只跑 DoD 文件 BEHAVIOR 的 manual:bash 命令 |

**关键变化（v7.4 vs v7.3）**：

v7.3 错误把 BEHAVIOR 单独拆到 vitest 测试文件，但 evaluator v1.1 反作弊红线第 3 条要求"DoD 文件含 [BEHAVIOR] 标签 + manual: 命令"（不是 vitest 索引）。两个 skill 协议矛盾，W22 实证 4 次 sub-evaluator FAIL "缺 [BEHAVIOR]"。本版本统一：DoD 文件内嵌 [BEHAVIOR] 标签 + Test: manual:bash 命令，evaluator 直接执行。

vitest 测试文件还要写（generator TDD red-green 用），但**不再被 evaluator 当 verdict 来源**。

---

## 执行流程

### Step 1: 读取 PRD

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_ROUND、INITIATIVE_ID、REVIEW_BRANCH、DB 由 cecelia-run 通过 prompt 注入，直接使用
# 每次调用 = 一轮 GAN；Brain 的 harness-gan-graph.js 管理轮次循环和 APPROVED/REVISION 路由
# REVIEW_BRANCH: 上一轮 Reviewer 的分支（第一轮为空）；DB: postgresql://localhost/cecelia（或 $DB_URL）
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || \
  cat "${SPRINT_DIR}/sprint-prd.md"
```

读取 journey_type（从 PRD 末尾）：
```bash
JOURNEY_TYPE=$(grep -m1 "^## journey_type:" "${SPRINT_DIR}/sprint-prd.md" | sed 's/## journey_type: //' | tr -d ' ') || JOURNEY_TYPE="autonomous"
```

如果是修订轮（propose_round > 1），读取 Reviewer 反馈：
```bash
if [ -n "$REVIEW_BRANCH" ]; then
  git fetch origin "${REVIEW_BRANCH}" 2>/dev/null || true
  git show "origin/${REVIEW_BRANCH}:${SPRINT_DIR}/contract-review-feedback.md" 2>/dev/null || true
fi
```

---

### Step 2: 写合同草案（Golden Path 格式）

写入 `${SPRINT_DIR}/contract-draft.md`：

````markdown
# Sprint Contract Draft (Round {N})

## Golden Path
[入口] → [步骤1] → [步骤2] → [出口]

### Step 1: {触发描述}

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

**可观测行为**: {...}

**验证命令**:
```bash
psql $DB -c "SELECT count(*) FROM brain_alerts WHERE task_id='$TASK_ID' AND created_at > NOW() - interval '5 minutes'"
# 期望：count >= 1
```

**硬阈值**: count ≥ 1，5 分钟内写入

---

### Step N: {出口描述}

**可观测行为**: {...}
**验证命令**: `...`
**硬阈值**: ...

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: {autonomous|user_facing|dev_pipeline|agent_remote}

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# 1. 注入测试数据 / 触发入口
TASK_ID=$(psql $DB -t -c "INSERT INTO tasks (task_type, status, payload) VALUES ('test_event', 'queued', '{}') RETURNING id" | tr -d ' ')

# 2. 触发处理（或等待 tick）
curl -f -X POST localhost:5221/api/brain/scan-timeout

# 3. 验证终态（带时间窗口防造假）
COUNT=$(psql $DB -t -c "SELECT count(*) FROM brain_alerts WHERE task_id='$TASK_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || exit 1

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: {N}

### Workstream 1: {标题}

**范围**: {清晰的实现边界}
**大小**: S(<100行) / M(100-300行) / L(>300行)
**依赖**: 无 / Workstream X 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws1/xxx.test.ts`

---

## Workstreams 切分硬规则（v7.7 — B14 加，2026-05-12）

**死规则**：

1. 单 workstream **≤ 200 行**净增 + **≤ 3 文件** — 超就强制再切
2. 整 contract 净增 < 200 行时才允许 `workstream_count=1`
3. proposer 自查 checklist 加第 6 条：算每 ws 预期 LoC，超 200 强制切

**反例（W36 实证）**：planner 写"加 /decrement endpoint" PRD 254 行，proposer 没切，ws1 塞 `server.js + tests + README` 三文件 335 行 → fix loop 跑 3 round → FAIL。

**正例**：W36 应切 3 ws：
- ws1 `server.js` 路由 ~50 行 S
- ws2 tests 套件 ~150 行 M
- ws3 README ~70 行 S
- ws2 依赖 ws1

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/xxx.test.ts` | {行为列表} | WS1 → N failures |
````

**验证命令写作规范**（Reviewer 重点检查，GAN 对抗焦点）：

- 命令必须可直接执行（含 $DB/$TASK_ID 等环境变量须可替换）
- `SELECT count(*)` 必须配时间窗口（如 `AND created_at > NOW() - interval '5 minutes'`）防止造假通过
- 禁止 `echo "ok"` / `true` 假验证
- curl 必须加 `-f` flag（HTTP 5xx 才返回非0 exit code）
- Playwright 脚本必须含显式 `toBeVisible` / `toHaveText` 断言，不能只 navigate

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

写完 contract-dod-ws*.md 前 proposer **必须自查**：

1. **提取 PRD response 字段名** → grep 出 `## Response Schema` 段的字面 key 名（如 `result`, `operation`, `error`）
2. **提取 contract jq -e 字段名** → grep 出 contract-dod-ws*.md 里 `jq -e '.<key>'` 的字面 key 名
3. **断言**：contract keys 集合 == PRD keys 集合（字面相等）
4. **断言**：PRD 禁用列表里的字段名 **绝对不在** contract 任何 jq -e 命令的正向断言里出现（只能在反向 `! has(...)` 检查里）
5. **断言（v7.6 新加 — Bug 9）**：`grep -c '^- \[ \] \[BEHAVIOR\]' contract-dod-ws*.md` ≥ 4。少于 4 → contract 作废，按 Step 2b 模板补齐到 ≥ 4 条不同场景（schema 字段 + keys 完整性 + 禁用字段反向 + error path 至少各 1）

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

### Step 2b: 写 contract-dod-ws{N}.md（v7.4 新结构）

**关键变化**：BEHAVIOR 段不再是"索引指向 vitest"，而是**内嵌可独立执行的 manual:bash 命令**。Evaluator v1.1 直接跑这些命令判 PASS/FAIL，不读 vitest 输出。

### ⚠️ BEHAVIOR 数量硬阈值（v7.6 — 修 Bug 9）

`contract-dod-ws{N}.md` **必须 ≥ 4 条** `- [ ] [BEHAVIOR]` 条目，至少覆盖 4 类场景各一条：

1. **schema 字段值**（PRD Response Schema 每个字段一条 jq -e）
2. **keys 完整性**（`jq -e 'keys == [...]'` 整体匹配）
3. **禁用字段反向**（`! has("X")` 每个禁用名一条）
4. **error path**（非法输入返 4xx + error 字段存在）

如果 PRD 含 Response Schema 段，**每个字段还要额外 1 条** [BEHAVIOR] 验。Reviewer 第 7 维 behavior_count_position 会 grep 数量；< 4 直接 REVISION。

### ❌ 禁止借口（v7.6 — Bug 9 实证）

W26 r3 proposer 在 contract-dod 末尾写：
> "v5.0 [BEHAVIOR] 条目已搬迁到 tests/ws1/*.test.js 的 51 个 test() 块中（DoD 纯度规则：本文件只装 [ARTIFACT]）"

**这是错的**。下列借口**全部禁止**：

- ❌ "DoD 纯度规则" — 不存在此规则。v7.4 起 DoD 必须含 [BEHAVIOR]
- ❌ "v5.0 严禁 contract-dod-ws 出现 [BEHAVIOR]" — v5.0 已废止，见 changelog
- ❌ "BEHAVIOR 已搬到 vitest" — vitest 不被 evaluator 读，evaluator 只跑 DoD 文件 manual:bash
- ❌ "本任务行为简单，1 条够了" — 阈值是死的 ≥ 4 条不同场景

只要看到 `[BEHAVIOR] 条目已搬迁` / `DoD 纯度规则` / `v5.0` 等字眼出现在 contract-dod 文件里 → 草案作废重写。

```bash
mkdir -p "${SPRINT_DIR}"

cat > "${SPRINT_DIR}/contract-dod-ws1.md" << 'DODEOF'
---
skeleton: false
journey_type: {journey_type}
---
# Contract DoD — Workstream 1: {标题}

**范围**: {实现边界}
**大小**: S/M/L
**依赖**: 无 / Workstream X

## ARTIFACT 条目

- [ ] [ARTIFACT] {文件/配置存在}
  Test: node -e "const c=require('fs').readFileSync('{path}','utf8');if(!c.includes('{pattern}'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] GET /endpoint?q=v 返 {result:N, operation:"X"} 严 schema
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!; sleep 2; RESP=$(curl -s "localhost:3001/endpoint?q=v"); R=$(echo "$RESP" | jq -e ".result == N and .operation == \"X\"" && echo OK); kill $SPID; [ -n "$R" ]'
  期望: OK

- [ ] [BEHAVIOR] response 严 schema 完整性 keys 恰好 [operation, result]
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3002 node server.js & SPID=$!; sleep 2; RESP=$(curl -s "localhost:3002/endpoint?q=v"); R=$(echo "$RESP" | jq -e "keys == [\"operation\",\"result\"]" && echo OK); kill $SPID; [ -n "$R" ]'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 product/value/answer 反向不存在
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3003 node server.js & SPID=$!; sleep 2; RESP=$(curl -s "localhost:3003/endpoint?q=v"); R=$(echo "$RESP" | jq -e "has(\"product\") | not" && echo OK); kill $SPID; [ -n "$R" ]'
  期望: OK

- [ ] [BEHAVIOR] error path /endpoint?q=foo 返 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3004 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3004/endpoint?q=foo"); kill $SPID; [ "$CODE" = "400" ]'
  期望: exit 0

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
mkdir -p "${SPRINT_DIR}/tests/ws1"
cat > "${SPRINT_DIR}/tests/ws1/xxx.test.ts" << 'TESTEOF'
import { describe, it, expect } from 'vitest';
import { targetFunction } from '../../../../packages/brain/src/target-module.js';

describe('Workstream 1 — {功能名} [BEHAVIOR]', () => {
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
npx vitest run "${SPRINT_DIR}/tests/ws1/" --reporter=verbose 2>&1 | tee /tmp/ws1-red.log || true
grep -E "FAIL|failed|✗" /tmp/ws1-red.log || { echo "ERROR: 测试未产生 Red"; exit 1; }
```

---

### Step 3: GAN 收敛后拆 task-plan.json

**每轮都生成**（REVISION 轮的 task-plan 在被打回的分支上无害；APPROVED 即最后一轮 proposer 的分支，inferTaskPlan 从此读取）：

从 Golden Path Steps 倒推拆任务：
- 每个 Golden Path Step → 对应 1-N 个 Task（按 LOC 估算）
- 每个 Task 预估 < 200 行（soft limit）；> 400 行强制拆分
- 线性依赖链：ws2 depends_on ws1

```bash
cat > "${SPRINT_DIR}/task-plan.json" << 'JSONEOF'
{
  "initiative_id": "pending",
  "journey_type": "{journey_type}",
  "journey_type_reason": "{1 句推断依据}",
  "tasks": [
    {
      "task_id": "ws1",
      "title": "{对应 Golden Path Step 1 的实现}",
      "scope": "{What，不写 How}",
      "dod": [
        "[BEHAVIOR] {可运行验证，对应合同 Step 1 验证命令}",
        "[ARTIFACT] {文件存在}"
      ],
      "files": ["{预期受影响文件}"],
      "depends_on": [],
      "complexity": "S|M|L",
      "estimated_minutes": 30
    },
    {
      "task_id": "ws2",
      "title": "{对应 Golden Path Step 2 的实现}",
      "scope": "...",
      "dod": ["[BEHAVIOR] ..."],
      "files": ["..."],
      "depends_on": ["ws1"],
      "complexity": "M",
      "estimated_minutes": 45
    }
  ]
}
JSONEOF
```

**字段约束**：
- `task_id`: ws1/ws2/... 逻辑 ID（Brain 入库时映射 UUID）
- `estimated_minutes`: 20 ≤ n ≤ 60
- `dod`: 至少 1 个 `[BEHAVIOR]`
- `depends_on`: 线性链（ws2 depends_on ws1 即可）

---

### Step 4: 建分支 + push + 输出 verdict

```bash
# $PROPOSE_BRANCH 由 Brain 通过 env var 注入，不需要本地计算
# 格式：cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID 前 8 位}
git checkout -b "${PROPOSE_BRANCH}" 2>/dev/null || git checkout "${PROPOSE_BRANCH}"

git add "${SPRINT_DIR}/contract-draft.md" \
        "${SPRINT_DIR}/contract-dod-ws"*.md \
        "${SPRINT_DIR}/tests/ws"*/ \
        "${SPRINT_DIR}/task-plan.json" 2>/dev/null  # 每轮生成；2>/dev/null 防御 LLM 偶发漏写（下游 inferTaskPlan 兜底报错）

git commit -m "feat(contract): round-${PROPOSE_ROUND} Golden Path draft + DoD + tests + task-plan"
git push origin "${PROPOSE_BRANCH}"
```

**结果文件写入**（每轮 — 含被 REVISION 打回轮）：

```bash
# 写结果文件（Brain 读文件，不读 stdout）
WORKSTREAM_COUNT=$(find "${SPRINT_DIR}" -name "contract-dod-ws*.md" 2>/dev/null | wc -l | tr -d ' ')
cat > /workspace/.brain-result.json << BREOF
{"propose_branch":"${PROPOSE_BRANCH}","workstream_count":${WORKSTREAM_COUNT},"task_plan_path":"${SPRINT_DIR}/task-plan.json"}
BREOF
echo "[proposer] .brain-result.json 写入完成 propose_branch=${PROPOSE_BRANCH}"
```

**输出契约（v8.0.0+ — 文件协议）**：

proposer 调用结束时必须向 `/workspace/.brain-result.json` 写入 JSON：
- `propose_branch`：Brain 注入的 `$PROPOSE_BRANCH` 值
- `workstream_count`：contract-dod-ws*.md 文件数量
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
3. **在 contract-dod-ws{N}.md 出现 [BEHAVIOR] 条目** → CI `dod-structure-purity` 会 exit 1
4. **禁止在 main 分支操作**
