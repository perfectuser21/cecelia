# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: PRD 字面）

N/A — 本任务无 HTTP 端点。职责分离改动作用于 harness evaluate 节点内部流程（文件 I/O + Claude API 调用），输出为 `.brain-result.json` 文件。

**`.brain-result.json` 输出 schema（扩展 EvaluatorOutputSchema，在 harness-shared.js 中已定义）：**

```json
{
  "verdict": "PASS | FAIL",
  "task_id": "<string | null>",
  "feedback": "<string | null>",
  "failed_step": "<string | null>",
  "log_excerpt": "<string | null>",
  "coverage": [
    {
      "step": "<GP 步骤名，如 'Step 1: 触发'>",
      "record_segment": "<执行记录原文摘录（来自真实 stdout/stderr）>",
      "passed": true
    }
  ]
}
```

**执行记录 schema（落盘到 `${SPRINT_DIR}/exec-records/<run_id>.json`）：**

```json
{
  "run_id": "<uuid>",
  "script_path": "<string>",
  "started_at": "<ISO8601>",
  "exit_code": 0,
  "stdout": "<string>",
  "stderr": "<string>",
  "duration_ms": 0
}
```

**禁用字段名**：`result`（与 EvaluatorOutputSchema 已有字段冲突），`records`（复数形式与 coverage 语义混淆）

---

## 已知约束（来自回归测试）

- [harness-artifact-gate.test.js] → `evaluateContractNode`：ARTIFACT 门 ran && !ok → 强制返回 `verdict=FAIL`，不 spawn LLM
- [harness-artifact-gate.test.js] → `extractArtifactTests`：只提取 `[ARTIFACT]` 的 Test 命令，排除 `[BEHAVIOR]`
- [harness-initiative-evaluate.test.js] → `evaluateContractNode`：幂等门，`evaluate_verdict` 已存在则短路返回
- [harness-shared.js `EvaluatorOutputSchema`] → `verdict` 枚举值固定为 `PASS | FAIL | FIXED`；FAIL 时至少有 `feedback` / `failed_step` / `log_excerpt` 其一非空

---

## Risks

| # | 风险 | 后果 | Mitigation |
|---|---|---|---|
| R1 | LLM 裁读超时（> 30s） | verdict 丢失，harness 挂起等待 | evaluate.js 对 LLM 调用设 30s 超时；超时 → verdict=FAIL，feedback 标注"LLM timeout"，不 fallback，不重试 |
| R2 | 成本约束（目标 < $2/轮）| 使用 GPT-4 等重量级模型超支 | 使用 claude-haiku-4-5（轻量），max_tokens=1000；仅传执行记录摘要（非完整 stdout），不传完整合同全文 |
| R3 | coverage 缺步（LLM 漏对照部分 GP 步骤）| Brain 校验 FAIL 错误打回通过的 E2E | Brain 侧 strict 比对：coverage 步骤名集合 ⊇ Golden Path 步骤名集合（本合同 7 步 happy path），缺任一步强制 verdict=FAIL，feedback 标注缺失步骤名 |
| R4 | 旧路径兼容（env + payload 双机制回退开关）| 回退开关失效，旧 harness-evaluator agent 任务报错 | evaluate.js 检查 `process.env.EVAL_LEGACY === '1'` OR `JSON.parse(process.env.EVAL_PAYLOAD||'{}').use_legacy_eval === true`，任一为真即走旧路径；两个机制独立有 BEHAVIOR 覆盖 |

---

## Golden Path

[触发合同] → [代码执行脚本] → [记录落盘] → [LLM 裁读记录] → [Brain 验表完整] → [.brain-result.json 写盘] → [出口]

---

### Step 1: evaluate 节点收到含通过型 E2E 脚本的合同，成功解析脚本段落

**来源**: `[FROM_PRD]` — PRD §Golden Path 第 1 条「触发：evaluate 节点收到合同（含通过型 E2E 脚本）」

**可观测行为**: evaluate.js 能从 `contract-draft.md` 的 `## E2E 验收` 段落解析出非空 bash 脚本。

**验证命令**:
```bash
SCRIPT_LEN=$(node --input-type=module -e "
  import { parseE2EScript } from './packages/engine/src/harness/evaluate.js';
  const s = parseE2EScript('./sprints/06120850-e2e-exec-judge-r4/contract-draft.md');
  process.stdout.write(String(s ? s.trim().length : 0));
" 2>/dev/null)
[ "${SCRIPT_LEN:-0}" -gt 10 ] || { echo "FAIL: parseE2EScript 未能从合同提取 E2E 脚本（len=${SCRIPT_LEN:-0}）"; exit 1; }
echo OK
```

**硬阈值**: 解析后 bash 脚本长度 > 10 字符，`parseE2EScript` 导出可调用

---

### Step 2: 系统以代码方式执行 E2E 脚本，逐段落盘结构化执行记录

**来源**: `[FROM_PRD]` — PRD §Golden Path 第 2 条「代码执行：系统在 cecelia/runner 容器内以代码方式执行脚本（复用 runScenarioCommand/execFile），逐段落盘结构化执行记录（exit/stdout/stderr/耗时/环境）」

**可观测行为**: `${SPRINT_DIR}/exec-records/<run_id>.json` 文件生成，包含 `exit_code=0`、非空 `stdout`、非负 `duration_ms`。LLM **不得**通过工具调用（Bash tool / execSync）直接执行脚本——只有系统代码调用 `runScenarioCommand`。

**验证命令**:
```bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
RECF=$(ls -t "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | head -1)
[ -n "$RECF" ] || { echo "FAIL: 执行记录文件未生成"; exit 1; }
REC=$(cat "$RECF")
echo "$REC" | jq -e '.exit_code == 0' || { echo "FAIL: exit_code 不为 0"; exit 1; }
echo "$REC" | jq -e '(.stdout | length) > 0' || { echo "FAIL: stdout 为空"; exit 1; }
echo "$REC" | jq -e '(.duration_ms | type) == "number" and .duration_ms >= 0' || { echo "FAIL: duration_ms 无效"; exit 1; }
```

**硬阈值**: 文件存在，`exit_code=0`，`stdout` 非空，`duration_ms ≥ 0`，文件写入时间晚于 evaluate 触发时间

---

### Step 3: LLM 裁读执行记录，不执行任何命令，record_segment 来自真实执行输出

**来源**: `[FROM_PRD]` — PRD §Golden Path 第 3 条「LLM 裁读：执行记录 + 合同 + Golden Path 交轻量 LLM；LLM 不执行任何命令，仅输出 verdict=PASS + 覆盖对照表 JSON」

**可观测行为**: `.brain-result.json` 出现 `verdict=PASS` 和非空 `coverage` 数组（每条含 `step` / `record_segment` / `passed` 三字段）。**关键**：`coverage` 的 `record_segment` 字段必须是执行记录 stdout/stderr 的真实摘录——使用含已知 sentinel 的 fixture，验证 sentinel 出现在 record_segment 中，排除 LLM 杜撰。

**验证命令**:
```bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
cat > /tmp/eval-sentinel-step3.sh << 'FIXTURE'
#!/bin/bash
echo "EXEC_SENTINEL_XK9W: evaluation_confirmed"
FIXTURE
chmod +x /tmp/eval-sentinel-step3.sh
SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-sentinel-step3.sh \
  node packages/engine/src/harness/evaluate.js

BRES=$(cat ".brain-result.json")
echo "$BRES" | jq -e '.verdict == "PASS"' || { echo "FAIL: verdict 不为 PASS"; exit 1; }
echo "$BRES" | jq -e '(.coverage | type) == "array" and (.coverage | length) >= 1' \
  || { echo "FAIL: coverage 字段缺失或为空"; exit 1; }
# 内容真实性：record_segment 必须含 fixture 已知 sentinel，排除 LLM 杜撰
echo "$BRES" | jq -e '.coverage | map(.record_segment // "") | join(" ") | test("EXEC_SENTINEL_XK9W")' \
  || { echo "FAIL: record_segment 未含 fixture 输出标记，疑似 LLM 杜撰"; exit 1; }
```

**硬阈值**: `verdict == "PASS"`, `coverage` 数组非空，`record_segment` 含 fixture 已知标记字符串

---

### Step 4: Brain 校验覆盖对照表完整性，缺步即 FAIL

**来源**: `[FROM_PRD]` — PRD §Golden Path 第 3 条「Brain 校验覆盖对照表缺步即 FAIL」

**来源**: `[AI_ADDED]` — GAN Round 1 加入，理由：PRD 明确说「缺步即 FAIL」，此步是该规则可观测的唯一验证点，必须有 BEHAVIOR 对应。

**可观测行为**: `coverage` 数组长度 ≥ 5（happy path 步骤数）；若 LLM 返回 coverage 缺漏 GP 步骤，Brain 侧校验逻辑将 verdict 改为 FAIL 并在 feedback 中标注缺失步骤名。

**验证命令**:
```bash
BRES=$(cat ".brain-result.json")
echo "$BRES" | jq -e '(.coverage | length) >= 5' \
  || { echo "FAIL: coverage 步骤数 < 5，覆盖不完整"; exit 1; }
echo "$BRES" | jq -e '[.coverage[].passed] | all' \
  || { echo "FAIL: 存在 passed=false 的覆盖步骤"; exit 1; }
```

**硬阈值**: `coverage` 长度 ≥ 5，所有步骤 `passed=true`

---

### Step 5: .brain-result.json 写盘（EvaluatorOutputSchema 兼容 + coverage 字段）

**来源**: `[FROM_PRD]` — PRD §Golden Path 第 5 条「出口：.brain-result.json 写盘（EvaluatorOutputSchema 兼容，扩展 coverage 字段）」

**可观测行为**: `.brain-result.json` 满足现有 `EvaluatorOutputSchema`（verdict / task_id / feedback / failed_step / log_excerpt 字段）同时新增 `coverage` 字段。现有 Brain 解析逻辑（`readAndValidateBrainResult`）不因新字段报 schema_mismatch（zod passthrough 兼容）。

**验证命令**:
```bash
BRES=$(cat ".brain-result.json")
echo "$BRES" | jq -e 'has("verdict") and has("coverage")' \
  || { echo "FAIL: .brain-result.json 缺 verdict 或 coverage 字段"; exit 1; }
echo "$BRES" | jq -e '.verdict == "PASS" or .verdict == "FAIL" or .verdict == "FIXED"' \
  || { echo "FAIL: verdict 不在枚举值内"; exit 1; }
# 禁用字段反向检查（PRD 禁用字段清单 — result / records 不得出现）
echo "$BRES" | jq -e 'has("result") | not' \
  || { echo "FAIL: 禁用字段 result 出现在输出中"; exit 1; }
echo "$BRES" | jq -e 'has("records") | not' \
  || { echo "FAIL: 禁用字段 records 出现在输出中"; exit 1; }
```

**硬阈值**: `verdict` 在 `PASS|FAIL|FIXED` 枚举内，`coverage` 字段存在，`result` 和 `records` 禁用字段不存在

---

### Step 6: 失败路径 — 失败型 fixture → verdict=FAIL + failed_step + 修复方向引执行记录

**来源**: `[FROM_PRD]` — PRD §Golden Path 第 4 条「失败路径：失败型 fixture → 执行记录如实捕获失败 → LLM 裁读 verdict=FAIL + failed_step + 修复方向（引执行记录原文）」

**可观测行为**: 使用 exit_code=1 的脚本触发 evaluate → `.brain-result.json` 的 `verdict=FAIL`、`failed_step` 非空字符串、`feedback` 内容引用了执行记录的 stderr/stdout 原文。

**验证命令**:
```bash
# 失败型 fixture 触发后
BRES=$(cat ".brain-result.json")
echo "$BRES" | jq -e '.verdict == "FAIL"' \
  || { echo "FAIL: 失败型 fixture 未返回 FAIL"; exit 1; }
echo "$BRES" | jq -e '(.failed_step | type) == "string" and (.failed_step | length) > 0' \
  || { echo "FAIL: failed_step 空"; exit 1; }
echo "$BRES" | jq -e '(.feedback | length) > 20' \
  || { echo "FAIL: feedback 内容过短，未引执行记录"; exit 1; }
```

**硬阈值**: `verdict=FAIL`，`failed_step` 非空，`feedback` 长度 > 20 chars（有效引用）

---

### Step 7: EVAL_LEGACY=1 env 回退开关 — 旧路径生效，新执行器不介入

**来源**: `[FROM_PRD]` — PRD §边界情况「回退开关：env EVAL_LEGACY=1 → 走旧路径」

**可观测行为**: 设置 `EVAL_LEGACY=1` 后触发 evaluate，`${SPRINT_DIR}/exec-records/` 目录无新文件生成（新执行器未运行）；evaluate 仍可正常完成（回退到旧 harness-evaluator LLM agent 路径）。

**验证命令**:
```bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
PREV=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d ' ')
# gate-allow: cheat/or-true EVAL_LEGACY 路径预期走旧逻辑可能 exit 非 0，|| true 必要；断言在 AFTER 比较行
LEGACY_LOG=$(EVAL_LEGACY=1 SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-pass-fixture.sh \
  node packages/engine/src/harness/evaluate.js 2>&1 || true)
AFTER=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d ' ')
[ "$AFTER" -eq "$PREV" ] || { echo "FAIL: EVAL_LEGACY=1 时执行记录数量增加"; exit 1; }
```

**硬阈值**: EVAL_LEGACY=1 时 exec-records 目录无新文件

---

### Step 7b: use_legacy_eval:true payload 回退 — 旧路径生效，新执行器不介入

**来源**: `[FROM_PRD]` — PRD §边界情况「回退开关：env EVAL_LEGACY=1 **或** payload `use_legacy_eval: true` → 走旧路径」（Round 1 漏覆盖的 payload 变体）

**可观测行为**: 设置 `EVAL_PAYLOAD='{"use_legacy_eval":true}'` 后触发 evaluate，新执行器同样跳过，`exec-records/` 无新文件生成。此为与 env var 独立的第二条回退机制，harness 内通过 task payload 传递。

**验证命令**:
```bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
PREV_P=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d ' ')
# gate-allow: cheat/or-true payload 回退路径预期走旧逻辑可能 exit 非 0，|| true 必要；断言在 AFTER_P 比较行
PAYLOAD_LOG=$(EVAL_PAYLOAD='{"use_legacy_eval":true}' SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-pass-fixture.sh \
  node packages/engine/src/harness/evaluate.js 2>&1 || true)
AFTER_P=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d ' ')
[ "$AFTER_P" -eq "$PREV_P" ] || { echo "FAIL: use_legacy_eval:true payload 时执行记录数量增加"; exit 1; }
```

**硬阈值**: EVAL_PAYLOAD use_legacy_eval=true 时 exec-records 目录无新文件

---

### Step 7c: LLM 裁读超时/报错 → verdict=FAIL，不回退旧路径

**来源**: `[FROM_PRD]` — PRD §边界情况「LLM 裁读超时/报错 → verdict=FAIL，不回退旧路径」

**可观测行为**: 当 LLM 裁读超时（`LLM_JUDGE_TIMEOUT_MS=1` 强制 1ms 超时），evaluate 仍能正常写盘 `.brain-result.json`，verdict=FAIL，feedback 中含 "timeout" 字样，不挂起也不回退走旧路径（exec-records 目录有新文件，说明代码执行层已完成）。

**验证命令**:
```bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
BEFORE_CNT=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d ' ')
# gate-allow: cheat/or-true LLM 超时时 evaluate 预期 exit 非 0，|| true 必要；断言在后续 jq 行
TIMEOUT_LOG=$(LLM_JUDGE_TIMEOUT_MS=1 SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-pass-fixture.sh \
  node packages/engine/src/harness/evaluate.js 2>&1 || true)
AFTER_CNT=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d ' ')
# 执行层完成（exec-records 有新文件，说明代码执行未被绕过）
[ "$AFTER_CNT" -gt "$BEFORE_CNT" ] || { echo "FAIL: LLM 超时时执行记录未生成（代码执行层未运行）"; exit 1; }
# verdict=FAIL + feedback 含 timeout
BRES_T=$(cat ".brain-result.json")
echo "$BRES_T" | jq -e '.verdict == "FAIL"' || { echo "FAIL: LLM 超时应返回 FAIL"; exit 1; }
echo "$BRES_T" | jq -r '.feedback // ""' | grep -qi "timeout" \
  || { echo "FAIL: feedback 未标注 LLM timeout 原因"; exit 1; }
```

**硬阈值**: `verdict=FAIL`，exec-records 有新文件（代码执行层不受 LLM 超时影响），feedback 含 "timeout"

---

### Step 8: Self-hosting 自验 — 本 sprint 自身 E2E 脚本类型由新执行器运行，裁读输出 verdict=PASS

**来源**: `[FROM_PRD]` — PRD §E2E 验收第 4 条「本 sprint 自身 E2E 脚本由新执行器运行、新裁读输出 verdict=PASS（self-hosting）」（Round 1 漏覆盖）

**可观测行为**: 用代表本 sprint local_api E2E 脚本模式的 fixture（bash + 多步骤 echo，模拟真实 E2E 输出风格），经新执行器执行 + LLM 裁读，输出 `verdict=PASS` 且 `coverage` 长度 ≥ 5。验证新执行器确实能处理本 sprint 类型的 E2E 脚本。

**验证命令**:
```bash
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"
cat > /tmp/eval-selfhosting.sh << 'FIXTURE'
#!/bin/bash
echo "self_hosting_step1: evaluate node received contract OK"
echo "self_hosting_step2: code executed in runner container exit=0"
echo "self_hosting_step3: structured execution record captured"
echo "self_hosting_step4: coverage table validated by Brain"
echo "self_hosting_step5: brain-result.json written"
FIXTURE
chmod +x /tmp/eval-selfhosting.sh
SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-selfhosting.sh \
  node packages/engine/src/harness/evaluate.js

BRES_SH=$(cat ".brain-result.json")
echo "$BRES_SH" | jq -e '.verdict == "PASS"' || { echo "FAIL: self-hosting 自验 verdict 非 PASS"; exit 1; }
echo "$BRES_SH" | jq -e '(.coverage | length) >= 5' || { echo "FAIL: self-hosting coverage 步骤不足 5"; exit 1; }
```

**硬阈值**: `verdict=PASS`，`coverage` 长度 ≥ 5

---

## E2E 验收（local_api — bash + 文件校验）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -e
SPRINT_DIR="sprints/06120850-e2e-exec-judge-r4"

# ── Fixture 准备 ─────────────────────────────────────────────────────────────
cat > /tmp/eval-pass-fixture.sh << 'FIXTURE'
#!/bin/bash
echo "step1_trigger: evaluate node received contract OK"
echo "step2_execution: code executed in runner container exit=0"
echo "step3_record: structured execution record captured"
echo "step4_coverage: all GP steps covered"
echo "step5_output: brain-result.json ready"
FIXTURE
chmod +x /tmp/eval-pass-fixture.sh

cat > /tmp/eval-fail-fixture.sh << 'FIXTURE'
#!/bin/bash
echo "step1: started"
echo "CRITICAL_ERROR: DB connection refused at localhost:5432"
echo "step2: execution halted"
exit 1
FIXTURE
chmod +x /tmp/eval-fail-fixture.sh

# ── Test A: 通过型 fixture ────────────────────────────────────────────────────
SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-pass-fixture.sh \
  node packages/engine/src/harness/evaluate.js

# A1: 执行记录落盘（内容检查）
RECF=$(ls -t "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | head -1)
[ -n "$RECF" ] || { echo "FAIL: 执行记录未生成"; exit 1; }
REC=$(cat "$RECF")
echo "$REC" | jq -e '.exit_code == 0' || { echo "FAIL: exit_code"; exit 1; }
echo "$REC" | jq -e '(.stdout | length) > 0' || { echo "FAIL: stdout 空"; exit 1; }
echo "$REC" | jq -e '.duration_ms >= 0' || { echo "FAIL: duration_ms"; exit 1; }

# A2: .brain-result.json verdict + coverage（含 record_segment 内容真实性）
BRES=$(cat ".brain-result.json")
echo "$BRES" | jq -e '.verdict == "PASS"' || { echo "FAIL: verdict"; exit 1; }
echo "$BRES" | jq -e '(.coverage | length) >= 5' || { echo "FAIL: coverage 步骤数"; exit 1; }
echo "$BRES" | jq -e '.coverage[0] | has("step") and has("passed") and has("record_segment")' \
  || { echo "FAIL: coverage schema"; exit 1; }
echo "$BRES" | jq -e '[.coverage[].passed] | all' || { echo "FAIL: passed=false 存在"; exit 1; }
# record_segment 真实性：必须含 fixture 已知输出
echo "$BRES" | jq -e '.coverage | map(.record_segment // "") | join(" ") | test("step1_trigger")' \
  || { echo "FAIL: record_segment 未含 fixture 输出标记"; exit 1; }

# ── Test B: 失败型 fixture ────────────────────────────────────────────────────
# gate-allow: cheat/or-true 失败型 fixture 预期 exit 1，|| true 必要；断言在后续 jq 行
FAIL_LOG=$(SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-fail-fixture.sh \
  node packages/engine/src/harness/evaluate.js 2>&1 || true)

BRES_FAIL=$(cat ".brain-result.json")
echo "$BRES_FAIL" | jq -e '.verdict == "FAIL"' || { echo "FAIL: 失败型 verdict 应为 FAIL"; exit 1; }
echo "$BRES_FAIL" | jq -e '(.failed_step | type) == "string" and (.failed_step | length) > 0' \
  || { echo "FAIL: failed_step 空"; exit 1; }
echo "$BRES_FAIL" | jq -e '(.feedback | length) > 20' || { echo "FAIL: feedback 过短"; exit 1; }

# ── Test C: EVAL_LEGACY=1 env 回退 ───────────────────────────────────────────
PREV_CNT=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d ' ')
# gate-allow: cheat/or-true EVAL_LEGACY 路径可能 exit 非 0，|| true 必要；断言在 NEW_CNT 比较行
LEGACY_LOG=$(EVAL_LEGACY=1 SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-pass-fixture.sh \
  node packages/engine/src/harness/evaluate.js 2>&1 || true)
NEW_CNT=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d ' ')
[ "$NEW_CNT" -eq "$PREV_CNT" ] \
  || { echo "FAIL: EVAL_LEGACY=1 时新执行器仍写了执行记录"; exit 1; }

# ── Test D: use_legacy_eval:true payload 回退 ─────────────────────────────────
PREV_CNT_D=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d ' ')
# gate-allow: cheat/or-true payload 回退路径可能 exit 非 0，|| true 必要；断言在 NEW_CNT_D 比较行
PAYLOAD_LOG=$(EVAL_PAYLOAD='{"use_legacy_eval":true}' SPRINT_DIR="$SPRINT_DIR" \
  E2E_SCRIPT=/tmp/eval-pass-fixture.sh \
  node packages/engine/src/harness/evaluate.js 2>&1 || true)
NEW_CNT_D=$(ls -1 "${SPRINT_DIR}/exec-records/"*.json 2>/dev/null | wc -l | tr -d ' ')
[ "$NEW_CNT_D" -eq "$PREV_CNT_D" ] \
  || { echo "FAIL: use_legacy_eval:true payload 时新执行器仍写了执行记录"; exit 1; }

# ── Test E: Self-hosting 自验 ─────────────────────────────────────────────────
cat > /tmp/eval-selfhosting.sh << 'FIXTURE'
#!/bin/bash
echo "self_hosting_step1: evaluate node received contract OK"
echo "self_hosting_step2: code executed in runner container exit=0"
echo "self_hosting_step3: structured execution record captured"
echo "self_hosting_step4: coverage table validated by Brain"
echo "self_hosting_step5: brain-result.json written"
FIXTURE
chmod +x /tmp/eval-selfhosting.sh
SPRINT_DIR="$SPRINT_DIR" E2E_SCRIPT=/tmp/eval-selfhosting.sh \
  node packages/engine/src/harness/evaluate.js
BRES_E=$(cat ".brain-result.json")
echo "$BRES_E" | jq -e '.verdict == "PASS"' || { echo "FAIL: self-hosting verdict 非 PASS"; exit 1; }
echo "$BRES_E" | jq -e '(.coverage | length) >= 5' || { echo "FAIL: self-hosting coverage 不足 5 步"; exit 1; }

echo "✅ Golden Path 全部验证通过（A+B+C+D+E）"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 执行记录 schema + 落盘 | `tests/evaluate.test.ts` | exit_code/stdout/duration_ms/run_id | → 4 failures（模块未实现） |
| coverage record_segment 真实性 | `tests/evaluate.test.ts` | record_segment 内容真实性 | → 1 failure |
| coverage table 完整性校验 | `tests/evaluate.test.ts` | coverage 数组/coverage ≥ 5 步 | → 2 failures |
| EVAL_LEGACY=1 env 回退 | `tests/evaluate.test.ts` | EVAL_LEGACY=1 → 跳过新执行器 | → 1 failure |
| use_legacy_eval payload 回退 | `tests/evaluate.test.ts` | EVAL_PAYLOAD use_legacy_eval:true → 跳过新执行器 | → 1 failure |
| EvaluatorOutputSchema 兼容（含禁用字段检查） | `tests/evaluate.test.ts` | verdict 和 coverage 字段 | → 1 failure |
| LLM 超时 → verdict=FAIL | `tests/evaluate.test.ts` | 执行记录为空 | → 1 failure |
| Self-hosting 自验 | `tests/evaluate.test.ts` | local_api E2E 模式 fixture | → 1 failure |
