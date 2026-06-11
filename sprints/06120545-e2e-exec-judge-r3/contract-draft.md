# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应端点。变更为内部节点 `evaluateContractNode` 执行流程拆分（代码执行段 + LLM 裁读段）+ `EvaluatorOutputSchema` schema 扩展（新增 `coverage` 字段）。Reviewer 第 6 维 schema oracle 对本 sprint 自动满分。

## 已知约束（来自回归测试）

- [harness-task.graph.test.js] → B10: `threadId` 必须使用 `harness-task:${initiativeId}:${task.id}` 前缀（不能用 `harness-evaluate:` 前缀），拆分后此不变量必须保留
- [harness-task.graph.test.js] → 幂等门: `evaluate_verdict` 已存在时直接返回，不重复触发代码执行段（拆分后此幂等门保留）
- [harness-task-evaluator-verdict.test.js] → B15: `evaluateContractNode` 用 `extractField(stdout, 'verdict')` 解析旧协议，不用老 regex（拆分后 legacy path 保留此逻辑）

## Golden Path

合同通过 Contract Gate → `evaluateContractNode` 进入代码执行段 → 系统逐段执行 E2E 脚本 → 写 `execution-record.json` → LLM 读执行记录出 `verdict + coverage` → Brain 代码校验 `coverage` 覆盖每一步 → 结论落盘 `.brain-result.json` → 回退开关可切换旧路径

---

### Step 1: 入口 — 合同通过 Contract Gate，进入 evaluateContractNode

**来源**: `[FROM_PRD]` — PRD 第 19 行「合同通过 Contract Gate 预检（已有，不变）」

**可观测行为**: `evaluateContractNode` 被调用后，不再直接 spawn LLM Docker 容器作为第一步；而是进入新的代码执行段调用逻辑（代码执行 → 执行记录落盘 → 再交 LLM 裁读）

**验证命令**:
```bash
# 回归：evaluateContractNode 仍可从 harness-task.graph.js 导出且为 function
cd packages/brain && node -e "import('./src/workflows/harness-task.graph.js').then(function(m){if(typeof m.evaluateContractNode!=='function'){console.error('FAIL');process.exit(1)}console.log('OK')}).catch(function(e){console.error('FAIL:',e.message);process.exit(1)})"
```

**硬阈值**: `typeof evaluateContractNode === 'function'`；exit 0

---

### Step 2: 代码执行段 — 系统逐段执行 E2E 脚本，采集 exit code/stdout/stderr/elapsedMs，落盘 execution-record.json

**来源**: `[FROM_PRD]` — PRD 第 20-21 行「系统代码在 cecelia/runner 容器内（复用 `runScenarioCommand` / `execFile` 封装）逐段执行合同 E2E 脚本；采集逐命令 exit code / stdout / stderr（截断可控）/ 耗时 / 所用环境；落盘 `execution-record.json`（按 #3345 命名协议，放 sprint 目录下）」

**可观测行为**: `harness-shared.js` 新增导出 `ExecutionRecordSchema`（Zod schema）；execution-record.json 包含 `commands` 数组，每条含 `cmd` / `exitCode` / `stdout` / `stderr` / `elapsedMs` 字段

**验证命令**:
```bash
START=$(date +%s)
cd packages/brain && node -e "import('./src/harness-shared.js').then(function(m){if(!m.ExecutionRecordSchema){console.error('FAIL: ExecutionRecordSchema not exported');process.exit(1)}var r=m.ExecutionRecordSchema.safeParse({commands:[{cmd:'echo ok',exitCode:0,stdout:'ok',stderr:'',elapsedMs:10}]});if(!r.success){console.error('FAIL schema:',r.error.message);process.exit(1)}console.log('OK')}).catch(function(e){console.error('FAIL:',e.message);process.exit(1)})"
END=$(date +%s); [ $((END-START)) -lt 5 ] || { echo "FAIL: 耗时 $((END-START))s ≥ 5s"; exit 1; }
```

**硬阈值**: `ExecutionRecordSchema.safeParse({ commands: [{ cmd, exitCode: 0, stdout, stderr, elapsedMs }] })` 返回 `success: true`；exit 0；耗时 < 5s

---

### Step 3: LLM 裁读 — LLM 只读执行记录，产出 verdict + coverage（每步 → 对应命令 → 通过与否）

**来源**: `[FROM_PRD]` — PRD 第 22-23 行「将执行记录 + 合同 + sprint-prd Golden Path 交给轻量 LLM；LLM 只读记录，产出：`verdict`（PASS/FAIL/FIXED）、`coverage`（JSON 对照表，每步 → 对应命令/断言 → 通过与否）、FAIL 时含 `failed_step` + `fix_direction`（引用执行记录原文行）」

**可观测行为**: `EvaluatorOutputSchema` 新增 `coverage` 字段（Zod optional array，每条含 `step` / `passed`）；LLM prompt 接收 `execution-record.json` 内容而非直接执行命令

**验证命令**:
```bash
cd packages/brain && node -e "import('./src/harness-shared.js').then(function(m){var shape=m.EvaluatorOutputSchema.shape||{};if(!('coverage' in shape)){console.error('FAIL: coverage field missing from EvaluatorOutputSchema.shape');process.exit(1)}var r=m.EvaluatorOutputSchema.safeParse({verdict:'PASS',coverage:[{step:'Step 1',passed:true},{step:'Step 2',passed:true}]});if(!r.success){console.error('FAIL coverage parse:',r.error.message);process.exit(1)}console.log('OK coverage.length='+r.data.coverage.length)}).catch(function(e){console.error('FAIL:',e.message);process.exit(1)})"
```

**硬阈值**: `EvaluatorOutputSchema.shape` 含 `coverage`；`{ verdict: 'PASS', coverage: [{step, passed}] }` parse 成功；exit 0

---

### Step 4: Brain 校验覆盖表 — coverage 覆盖 Golden Path 每一步；缺步整体 FAIL（Brain 代码判，非 LLM 自判）

**来源**: `[FROM_PRD]` — PRD 第 24 行「Brain 代码校验 coverage 对照表覆盖 Golden Path 每一步；缺步 → 整体 FAIL（不由 LLM 自判）」

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入 coverage 缺步的单测验证；理由：防止 generator 实现 coverage 校验时用 LLM 自判代替 Brain 代码判（二者不等价，LLM 判有幻觉风险）

**可观测行为**: `evaluateContractNode` 中存在代码级 coverage 覆盖完整性检查；coverage 缺步时返回 `evaluate_verdict: 'FAIL'`，不依赖 LLM 输出来决定

**验证命令**:
```bash
# 单测验证 coverage 缺步场景（TDD Green 阶段通过）
(cd packages/brain && npx vitest run ../../sprints/06120545-e2e-exec-judge-r3/tests/evaluate-split.test.ts --reporter=verbose --testNamePattern="coverage") || { echo 'FAIL: coverage 缺步校验单测未通过'; exit 1; }
echo OK
```

**硬阈值**: `evaluate-split.test.ts` 中 coverage 相关测试全通过（exit 0）

---

### Step 5: 结论落盘 — verdict + coverage 写入 .brain-result.json（EvaluatorOutputSchema 兼容 + 新增 coverage 字段）

**来源**: `[FROM_PRD]` — PRD 第 25 行「verdict + coverage 写入 `.brain-result.json`（EvaluatorOutputSchema 兼容 + 新增 coverage 字段）；执行记录与裁读输出均按运行实例落盘」

**可观测行为**: `.brain-result.json` 通过扩展后的 `EvaluatorOutputSchema` 校验（含 coverage）；`readAndValidateBrainResult` 可解析含 `coverage` 的结果而不报 schema_mismatch

**验证命令**:
```bash
cd packages/brain && node -e "import('./src/harness-shared.js').then(function(m){var r=m.EvaluatorOutputSchema.safeParse({verdict:'PASS',coverage:[{step:'Step 1',passed:true},{step:'Step 2',passed:true},{step:'Step 3',passed:true}]});if(!r.success){console.error('FAIL:',r.error.message);process.exit(1)}if(!r.data.coverage||r.data.coverage.length!==3){console.error('FAIL: coverage array length mismatch, got',r.data.coverage&&r.data.coverage.length);process.exit(1)}console.log('OK coverage.length='+r.data.coverage.length)}).catch(function(e){console.error('FAIL:',e.message);process.exit(1)})"
```

**硬阈值**: 含 coverage 数组（3 项）的 PASS verdict parse 成功；coverage.length 正确；exit 0

---

### Step 6: 失败型验证 — 失败型 fixture → 执行记录含非零 exit → LLM 裁读 verdict=FAIL + failed_step + fix_direction

**来源**: `[FROM_PRD]` — PRD 第 26 行「失败型 fixture → 执行记录如实捕获非零 exit 与失败输出 → LLM 裁读 verdict=FAIL + 具体 failed_step 与修复方向（引用执行记录原文行）」

**可观测行为**: `ExecutionRecordSchema` 接受 `exitCode !== 0` 的命令条目（stderr 内容完整保留）；`EvaluatorOutputSchema` 接受 FAIL verdict + failed_step + coverage 含失败步

**验证命令**:
```bash
# 失败型 fixture 单测（TDD Green 阶段通过）
(cd packages/brain && npx vitest run ../../sprints/06120545-e2e-exec-judge-r3/tests/evaluate-split.test.ts --reporter=verbose --testNamePattern="失败型") || { echo 'FAIL: 失败型 fixture 单测未通过'; exit 1; }
echo OK
```

**硬阈值**: 失败型 fixture 相关测试全通过（exit 0）

---

### Step 7: 回退开关 — EVALUATE_PATH=legacy 走旧 spawn 路径（默认新路径）

**来源**: `[FROM_PRD]` — PRD 边界情况段「回退开关：env/payload 控制新旧路径，默认走新路径；旧路径逻辑保留」

**可观测行为**: `evaluateContractNode` 内部读取 `EVALUATE_PATH` 环境变量（或 payload 字段）；值为 `legacy` 时跳过代码执行段 + LLM 裁读段，直接走原有 spawn LLM Docker 路径；源码中旧路径逻辑完整保留

**验证命令**:
```bash
grep -E "EVALUATE_PATH|evaluate_path|legacy.*path|path.*legacy" packages/brain/src/workflows/harness-task.graph.js | head -1 || { echo "FAIL: legacy 回退开关未在 harness-task.graph.js 中找到"; exit 1; }
echo OK
```

**硬阈值**: `harness-task.graph.js` 含 `EVALUATE_PATH` 或 `legacy` 分支代码；exit 0

---

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/evaluate-split.test.ts` | ExecutionRecordSchema / coverage 字段 / EVALUATE_PATH / 代码执行段函数 | 实现前 schema undefined / coverage 字段不存在 / 源码无 EVALUATE_PATH / runner 未创建 |

---

## Risks

| # | 风险 | 影响 | Mitigation |
|---|---|---|---|
| R1 | **执行器超时**：代码执行段逐命令跑 E2E 脚本，单命令挂死（如 sleep 无限循环）会阻塞整个 evaluate task | 高：评估 task 永不完成，initiative 卡死 | 代码执行段封装 `execFile` 时设硬超时（如 `timeout: 60_000` ms）；超时命令写入 execution-record.json 的 `exitCode: -1` + `stderr: 'TIMEOUT'`；整体 FAIL，不阻塞后续 tick |
| R2 | **coverage 误判**：LLM 裁读 coverage 时将"命令跑通但断言语义有误"标为 passed=true（幻觉），导致 Brain 代码覆盖校验通过但实际功能未验证 | 中：假绿放行本应 FAIL 的 sprint | Brain 代码校验仅验 coverage 数组的**结构完整性**（每步都有对应条目），不验 LLM 的 passed 语义；passed=true/false 的语义裁定仅供 Reviewer 参考，不用于 Brain 决策；关键场景（失败型 fixture）写回归单测固定期望行为 |

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

### target_environment = local_api（autonomous — node + vitest 全程链路，本地执行）

```bash
#!/bin/bash
set -e

REPO_ROOT="${WORKSPACE_PATH:-/workspace}"
cd "$REPO_ROOT"

echo "=== Step 1: 入口 — evaluateContractNode 导出检查（回归保护）==="
(cd packages/brain && node -e "import('./src/workflows/harness-task.graph.js').then(function(m){if(typeof m.evaluateContractNode!=='function'){console.error('FAIL');process.exit(1)}console.log('OK')}).catch(function(e){console.error('FAIL:',e.message);process.exit(1)})") || { echo 'FAIL Step 1: evaluateContractNode 未导出'; exit 1; }

echo "=== Step 2: 代码执行段 — ExecutionRecordSchema 导出 + parse 验证 ==="
(cd packages/brain && node -e "import('./src/harness-shared.js').then(function(m){if(!m.ExecutionRecordSchema){console.error('FAIL: ExecutionRecordSchema not exported');process.exit(1)}var r=m.ExecutionRecordSchema.safeParse({commands:[{cmd:'echo ok',exitCode:0,stdout:'ok',stderr:'',elapsedMs:5}]});if(!r.success){console.error('FAIL schema:',r.error.message);process.exit(1)}console.log('OK')}).catch(function(e){console.error('FAIL:',e.message);process.exit(1)})") || { echo 'FAIL Step 2: ExecutionRecordSchema 验证失败'; exit 1; }

echo "=== Step 3: LLM 裁读 — EvaluatorOutputSchema coverage 字段存在 + parse 验证 ==="
(cd packages/brain && node -e "import('./src/harness-shared.js').then(function(m){if(!('coverage' in (m.EvaluatorOutputSchema.shape||{}))){console.error('FAIL: coverage field missing');process.exit(1)}var r=m.EvaluatorOutputSchema.safeParse({verdict:'PASS',coverage:[{step:'Step 1',passed:true}]});if(!r.success){console.error('FAIL:',r.error.message);process.exit(1)}console.log('OK')}).catch(function(e){console.error('FAIL:',e.message);process.exit(1)})") || { echo 'FAIL Step 3: EvaluatorOutputSchema coverage 验证失败'; exit 1; }

echo "=== Step 4+5+6: 单测全量验证（coverage 完整性 + 落盘 + 失败型 fixture）==="
(cd packages/brain && npx vitest run ../../sprints/06120545-e2e-exec-judge-r3/tests/evaluate-split.test.ts --reporter=verbose) || { echo 'FAIL: 单测未全通过'; exit 1; }

echo "=== Step 7: 回退开关 — EVALUATE_PATH=legacy 分支代码存在 ==="
grep -E "EVALUATE_PATH|evaluate_path|legacy.*path|path.*legacy" packages/brain/src/workflows/harness-task.graph.js | head -1 || { echo 'FAIL Step 7: legacy 回退开关未实现'; exit 1; }

echo "✅ Golden Path 全部 7 步验证通过"
```

**通过标准**: 脚本 exit 0
**失败标准**: 任何步骤 exit≠0 OR vitest 测试未全通过
