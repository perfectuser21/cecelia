# Sprint Contract Draft (Round 2) — 金标集 v0 + LLM 判定器 eval 通过率棘轮进 CI

**锚定父路声明**: 独立小路（无父路）——本 sprint 为判定器建首个 eval 回归基线，本 journey 现有 golden-path 均为 planned，无父路可挂。

**journey_type**: autonomous
**target_environment**: local_api（runtime_resources.postgres=false：**无 Postgres、无 HTTP 服务**，local_api 退化为 node/vitest + 版本控制文件核对；标准 DB bootstrap / signup-login 自举步骤 **N/A**）
**Unified Map**: `[MAP_NOT_CONFIGURED]`（payload 无 map_repo，仅 map_scope=["F1"]，environment 无关；按 payload.anchor gp/step/journey 锚定，不回退领域硬编码）

> **前轮死因修复（validation_clock_required）**：R1 前的 RUN 用静态断言充数、未真跑出通过率，故校验时钟缺失。本合同 `## E2E 验收` 与全部 [BEHAVIOR] 均**真实执行** eval（node 逐条判读金标集 → 计算真实通过率 → 真实 exit code 驱动棘轮闸），非文本自证。
> **Round 2 修复（封印闸 FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE）**：R1 合同已 APPROVED（7 维全 ≥ 7），但被封印机械闸拒——`## Test Contract` 表「BEHAVIOR 覆盖」列曾在 lint 那条 behavior 名里含转义竖线（`pre`／`post`／`side_effects` 三词间用了 markdown 转义竖线），该转义竖线被 seal 解析链按表列分隔符切断，behavior 名被从 `pre` 后截断 → 解析不到对应 `it()` → UNRESOLVABLE。本轮把 `it()` 名与表列同步去掉竖线，改为 `lintSkillContracts 缺 pre post side_effects 任一即 fail`（保持 v9.5 子串一致、且不含表分隔符/behavior 分隔符），并将全部合同产物真实落盘 commit 进 propose 分支（含 tests/eval-ratchet.test.ts）。除此 seal 修复外，合同实质净变化趋近 0（精简纪律 B50）。

---

## Response Schema（推导来源: [NEW_PATTERN] — PRD 无 HTTP 端点；判定器 eval 无 api_registry 对应端点，按 REST/JSON 惯例定义 CLI stdout 契约）

本 sprint 无 HTTP 响应（纯 CI/CLI 判定器 eval 基础设施）。判定器 eval 入口 `node packages/quality/eval/run-eval.mjs` 向 **stdout 打印单行 JSON**（人读日志走 stderr），作为可机检契约：

### Entry: `node packages/quality/eval/run-eval.mjs`
**Success stdout (JSON)**:
```json
{"total": 5, "passed": 4, "pass_rate": 0.8, "threshold": 0.8, "ratcheted": false, "gate": "pass", "items": []}
```
- `total` (number, 必填): 金标集条目数（v0 == 5）。来源——PRD Golden Path 第 1 步五类标注。
- `passed` (number, 必填): 判读与 ground-truth 一致的条目数（fail-closed 条目计入 fail）。来源——PRD 第 2 步。
- `pass_rate` (number 0..1, 必填): `passed/total`，真实计算值。来源——PRD 第 2 步。
- `threshold` (number, 必填): 当前棘轮阈值（读自版本控制文件）。来源——PRD 第 3 步。
- `ratcheted` (boolean, 必填): 本次是否抬高阈值（仅 pass_rate>threshold 时 true）。来源——PRD 第 3 步。
- `gate` (string, 必填): `"pass"` iff `pass_rate >= threshold` 且金标集非空；否则 `"fail"`。来源——PRD 第 5 步。
- `items` (array, 必填): 逐条 `{id, label, decision, passed, failClosed}`，按 id 升序（序列固化）。来源——PRD 第 2 步。

**顶层 keys 必须完全等于**（jq keys 排序后）: `["gate","items","pass_rate","passed","ratcheted","threshold","total"]`

**退出码语义**（真实 exit code 驱动，evaluator 实测）:
- `pass_rate >= threshold` 且金标集非空 → exit 0
- `pass_rate < threshold`（棘轮不许降）→ exit 非 0
- 金标集空 → exit 非 0（防空集假绿）

**环境覆盖旋钮**（供 evaluator 确定性触发各分支，generator 必须实现）:
- `EVAL_FIXTURES_DIR`：覆盖金标集 fixtures 目录（默认 `packages/quality/eval/fixtures/gold-set-v0/`）
- `EVAL_THRESHOLD_FILE`：覆盖棘轮阈值文件（默认 `packages/quality/eval/ratchet-threshold.json`）
- `EVAL_THRESHOLD_OVERRIDE`：**逐字覆盖比较用阈值**（用于验证「通过率低于阈值必非零退出」的 exit-code 时钟；允许 >1 以强制走 below-threshold 分支）

---

## 已知约束

### 回归测试约束（Step 1.2）
- `packages/quality/__tests__/regression-contract.test.js` → regression-contract 非空且字段齐全（golden_paths[].id/priority/trigger/method/test_command）
- `packages/quality/__tests__/ci-core-regression.test.js` → core-regression 无 workspace 路径门 / 假绿灯 smoke 已删（本 sprint 新增 eval job 不得引入假绿）

### 累积 FR（[累积FR]，Step 1.3 T3）
- context-manifest: unavailable（fleet-worker 无法确认 journey T3 端点；PRD 明确「本 line 暂无历史」，无累积 FR 需保护）

---

## 历史约束三源加载（铁律 → INV 映射，Step 1.3）

| 铁律 | 本 sprint 处置 |
|---|---|
| [真环境done] | INV-1：eval 为真跑出通过率的可执行时钟（非静态断言），DoD B-02 实测 |
| [禁写死环境] | INV-2：阈值读自版本控制文件、fixtures 目录参数化，不写死；DoD B-03/B-06 用 env 旋钮 |
| [验证实跑] | INV-3：全部 [BEHAVIOR] 命令实跑确认 exit code，已本地实跑确认 RED |
| [Red精确add] | INV-4：Red commit 只 add `sprints/.../tests/*.test.ts` 精确路径，禁 `git add .` |
| [禁自merge] | INV-5：generator/judge 不自 merge，merge 由 CI 兜底 |
| [单slot串行] | N/A：本 sprint 无并发调度改动 |
| [多租户测试]/[租户隔离]/[端点鉴权] | N/A：本 sprint 无租户/HTTP 端点改动 |
| [凭据安全]/[日志脱敏] | INV-6：eval 离线运行不落 API key；stdout JSON 无凭据字段 |

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 判定器对金标集 v0 逐条判读，产出通过率并做棘轮 CI 闸；4 条纯代码用例锁不变量 | 见 Golden Path |
| **NFR（做得多好）** | 缓存命中零视觉调用（成本）；eval 离线确定性可复现 | DoD B-05 断言调用计数==0 |
| **Invariant（永不违反）** | 棘轮单调只升；视觉 null 必 fail-closed；空集必 fail | DoD B-03/B-04/B-06 |
| **判定点（怎么知道）** | 见下方登记表 | 见登记表 |
| **保质期（何时过期）** | 金标集 v0 为基线，扩到 v1 不在本范围；阈值文件长期有效随棘轮抬升 | N/A 退役 |
| **死亡告警（停了谁知道）** | eval job 在 CI required 化后，job 失败即阻断 merge，PR 作者立即可见 | CI 日志 |
| **失败语义（挂了怎么办）** | 见失败语义声明 | 见下 |
| **效果确认（已发≠已生效）** | eval job 打印真实通过率+阈值+失败项到 CI 日志（可观测 NFR） | DoD B-02 jq 核对 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ 视觉判定截图是否为「用户列表页」(true/false) | A. LLM 视觉判读; B. 像素/DOM 规则 | A. LLM 视觉判读（判定器视觉路径），CI 用 recorded 判读做确定性回归 | PRD 假设判定器=harness-judge.js 视觉路径；金标集有 ground-truth 标注兜底度量 | 判读质量悄悄退化不可度量（本 sprint 正为此建闸；PrepPRD 已拍 fail-closed 语义） |
| ⚠️ 视觉判定返回 null/超时视作 | A. fail-closed 判 fail; B. skip 当 pass | A. fail-closed（判 fail，不放行） | PrepPRD 显式 NFR，误判放行=面客判读退化 | 若当 pass 放行 → 判读质量静默退化 |

> 两条 ⚠️ 判定点均已由 PrepPRD 显式拍板（NFR: fail-closed / 判定器=视觉路径），无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 视觉判定返回 null/超时 | 该条判 fail（fail-closed），计入失败率 | 是（同 fixture 幂等） | 不降级，宁可拉低通过率 |
| 通过率 < 棘轮阈值 | eval exit 非 0，gate=fail，阻断 merge | 是 | 无降级（棘轮不许降） |
| 金标集为空 | eval exit 非 0（防空集假绿） | 是 | 无 |
| 某技能契约缺 pre/post/side_effects | lint fail → 关联 [BEHAVIOR] fail | 是 | 无 |

### 输入对抗面（对外暴露 agent 必填）
N/A — 本 sprint 为内部 CI/CLI eval 基础设施，无对外暴露 agent 输入面。

---

## GP-Anchor
gp-anchor: skipped (product-map.json not found)

---

## 禁 mock 边清单

- **eval 聚合器 ↔ 判定器决策路径**（本单新建 eval 调 classify + fail-closed 决策；测试必须真调 `classifyToOutcome` / runEval 的 fail-closed 与聚合逻辑，不 mock 判定器决策；只允许 spy/inject 最外层 LLM vision client 用于**计数**——正是 B-05 零调用断言的对象）
- **eval ↔ 棘轮阈值文件**（代码↔文件写路径；测试必须真读写临时阈值文件，断言 `applyRatchet` 单调只升，不 mock fs）
- **eval ↔ 金标集 fixtures 文件**（真读 manifest.json，空集真抛 `gold_set_empty`）

（说明：视觉 null fail-closed 原语绑定既有真实函数 `arbitrateContractAppeal`，测试真调该函数验证 upheld===null，不 mock 判定器本体。）

---

## 未覆盖真实链路清单（mock 豁免显式登记 — 规则 C）

| 被 mock/替身顶替的真实链路点 | 为什么 | 真验证补位计划 |
|---|---|---|
| CI eval job 中**实时 LLM 视觉 API 调用** | PRD 铁律「缓存命中零视觉调用」= 成本回归防护，且 eval 必须离线确定性可复现（无 API key 依赖、跨 run 稳定）；CI 内真调 LLM 与该不变量直接冲突 | eval 在 CI 用 recorded/cached 判读做确定性回归；**live 视觉判读由生产判定器路径（harness-judge.js）承载**，本 eval 不覆盖 live 调用。zero-call 由 B-05 不变量锁死；判读退化由金标集通过率棘轮 + fail-closed 不变量间接守卫 |

> 该项将由 harness-controller 原样呈现进 PR 描述与最终报告（DONE_WITH_CONCERNS）。

---

## 接缝清单（接缝 vs 逻辑）

| 接缝点 | 真目标验证方式 | 状态 |
|---|---|---|
| CI eval job 在 GitHub Actions ubuntu 上真跑 | evaluator 本地 local_api 复现同一 `node run-eval.mjs` + 冻结 vitest；GHA 真跑接线由 B-08 断言 workflow 引用 eval 入口 | logic-done（本地实测 exit code）+ CI 接线断言 |

其余（判定器决策/棘轮阈值/空集）均为环境无关**逻辑断言**，node/vitest 实测即 done。

---

## Golden Path

[CI push/PR 触发] → [加载金标集 v0 五类标注] → [判定器逐条判读算真实通过率] → [与棘轮阈值比较 + 只升写回] → [并行 4 条纯代码不变量] → [全绿放行 / 任一 fail 阻断 merge]

### Step 1: CI 触发加载金标集 v0（五类标注）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步（A/B 截图五类标注：用户列表页=true；桌面/计算器/搜索历史/联想页=false）

**可观测行为**: `loadGoldSet(fixturesDir)` 返回 5 条带 ground-truth label；空集抛 `gold_set_empty`。

**验证命令**:
```bash
npx vitest run sprints/09060510-kernel-cde056a0/tests/ -t '金标集 v0' --reporter=basic
```
**硬阈值**: 5 条标注齐全（用户列表页=true 其余=false）；对应命令上行 exit 0。

---

### Step 2: 判定器逐条判读 → 真实通过率（validation clock）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步 + E2E 期望验收点 1

**可观测行为**: `node run-eval.mjs` stdout 打印 `{total,passed,pass_rate,threshold,gate,...}`，pass_rate 为真实计算值 ∈ [0,1]，items 按 id 升序（序列固化）。

**验证命令**:
```bash
OUT=$(node packages/quality/eval/run-eval.mjs); echo "$OUT" | jq -e '.total==5 and (.pass_rate|type=="number") and (.pass_rate>=0) and (.pass_rate<=1)'
```
**硬阈值**: total==5 且 pass_rate 为 [0,1] 实数；命令 exit 0。

---

### Step 3: 棘轮比阈值 + 只升写回（不许降）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + 边界「通过率低于历史阈值 → CI fail」+ E2E 验收点 2

**可观测行为**: pass_rate >= threshold → exit 0；把阈值临时抬到 pass_rate 之上 → exit 非 0（实测 exit code）；pass_rate>threshold 时 `ratcheted=true` 且阈值文件被抬高，更低时文件不下调。

**验证命令**:
```bash
PR=$(node packages/quality/eval/run-eval.mjs | jq -r '.pass_rate'); OVER=$(node -e "console.log(Number(process.argv[1])+0.01)" "$PR"); EVAL_THRESHOLD_OVERRIDE="$OVER" node packages/quality/eval/run-eval.mjs; test $? -ne 0
```
**硬阈值**: 阈值高于通过率时 exit 非 0；`applyRatchet` 单调（vitest 断言）。

---

### Step 4: 并行 4 条纯代码不变量
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步（序列固化 / 缓存命中零视觉调用 / 视觉 null fail-closed / 契约完备性 lint）

**可观测行为**: 四类不变量 vitest 全绿：① runEval 迭代顺序固化；② memoizeClassify 缓存命中底层零调用；③ classifyToOutcome(null) 判 fail 且真实 `arbitrateContractAppeal` 非布尔→upheld null；④ lintSkillContracts 缺 pre/post/side_effects 即 fail。

**验证命令**:
```bash
npx vitest run sprints/09060510-kernel-cde056a0/tests/ --reporter=basic
```
**硬阈值**: 全部 it() 绿；命令 exit 0。

---

### Step 5: 全绿放行 / 任一 fail 阻断 merge（CI eval job 接线）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加，理由：PRD 第 5 步要求 eval 进 CI 阻断合并，需断言 workflow 真实接线 eval 入口（防「有脚本没接 CI」假绿）。

**可观测行为**: `.github/workflows` 至少一个 workflow 的 run 步骤真实执行 `run-eval.mjs`；空集 → job fail。

**验证命令**:
```bash
node -e 'const fs=require("fs"),d=process.cwd()+"/.github/workflows/";if(!fs.readdirSync(d).filter(f=>/\.ya?ml$/.test(f)).some(f=>fs.readFileSync(d+f,"utf8").includes("run-eval.mjs"))){process.exit(1)}'
```
**硬阈值**: 命令 exit 0（存在 workflow 接线 eval 入口）。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api，node/vitest + 文件核对，无 Postgres 无 HTTP）

**journey_type**: autonomous
**target_environment**: local_api（postgres=false → DB bootstrap / signup-login 步骤 N/A；本段为真跑出通过率的 validation clock，非静态断言）

```bash
#!/bin/bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
EVAL_ENTRY="packages/quality/eval/run-eval.mjs"

# 1. 冻结契约测试全绿（4 类不变量 + eval 逻辑）—— sprints/** 从仓库根跑命中 root vitest include
npx vitest run sprints/09060510-kernel-cde056a0/tests/ --reporter=basic
echo "STEP1 OK: 冻结契约测试全绿"

# 2. 真跑 eval 时钟：判定器逐条判读金标集 → 真实通过率 + 阈值（validation clock）
OUT="$(node "$EVAL_ENTRY")"
echo "$OUT"
echo "$OUT" | jq -e '.total == 5' >/dev/null
echo "$OUT" | jq -e '.passed | type == "number"' >/dev/null
echo "$OUT" | jq -e '(.pass_rate | type == "number") and (.pass_rate >= 0) and (.pass_rate <= 1)' >/dev/null
echo "$OUT" | jq -e '.threshold | type == "number"' >/dev/null
echo "$OUT" | jq -e 'keys == ["gate","items","pass_rate","passed","ratcheted","threshold","total"]' >/dev/null
echo "STEP2 OK: eval 真跑出通过率 total=5"

# 3. 棘轮不许降：把阈值临时抬到通过率之上 → eval 必须非 0 退出（真实 exit code 语义）
PR="$(echo "$OUT" | jq -r '.pass_rate')"
OVER="$(node -e 'console.log(Number(process.argv[1]) + 0.01)' "$PR")"
set +e
EVAL_THRESHOLD_OVERRIDE="$OVER" node "$EVAL_ENTRY" >/dev/null 2>&1
CODE=$?
set -e
[ "$CODE" -ne 0 ] || { echo "FAIL: 阈值高于通过率时 eval 未非零退出（棘轮降级未拦截）"; exit 1; }
echo "STEP3 OK: 阈值高于通过率 exit=$CODE 非零"

# 4. 空金标集防假绿：指向空 fixture 目录 → eval 必须非 0 退出
EMPTY_DIR="$(mktemp -d)"
echo '{"version":"v0","items":[]}' > "$EMPTY_DIR/manifest.json"
set +e
EVAL_FIXTURES_DIR="$EMPTY_DIR" node "$EVAL_ENTRY" >/dev/null 2>&1
ECODE=$?
set -e
rm -rf "$EMPTY_DIR"
[ "$ECODE" -ne 0 ] || { echo "FAIL: 空金标集未非零退出（假绿）"; exit 1; }
echo "STEP4 OK: 空金标集 exit=$ECODE 非零"

# 5. CI eval job 已接线：node 解析 .github/workflows 断言存在步骤真实执行 run-eval 入口
node -e 'const fs=require("fs"),d=process.cwd()+"/.github/workflows/";const files=fs.readdirSync(d).filter(f=>/\.ya?ml$/.test(f));if(!files.some(f=>fs.readFileSync(d+f,"utf8").includes("run-eval.mjs"))){console.error("FAIL: 无 workflow 执行 run-eval.mjs（eval job 未接线）");process.exit(1)}console.log("STEP5 OK: eval job 已接线")'

echo "✅ Golden Path 验证通过（validation clock 真跑，非静态断言）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `ratchet-threshold.json` 写入非法值（负数 / >1 / 非数字）→ eval 应报错而非把 gate 判绿
- 重复提交: 连续两次 `node run-eval.mjs` → 第二次 pass_rate 与阈值应稳定一致（确定性），不得因 ratchet 写回后自比而漂移
- 中途中断: eval 抬高阈值写回过程中断 → 阈值文件不得留半写坏值（原子写）
- 边界值: 通过率恰等于阈值（`pass_rate == threshold`）→ gate=pass（>= 语义）；金标集恰 1 条 → 仍算真实通过率
发现分级: P0/P1（棘轮被绕过下调 / null 被当 pass 放行 / 空集假绿）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（eval + 棘轮 + 4 不变量） | `sprints/09060510-kernel-cde056a0/tests/eval-ratchet.test.ts` | 返回 5 类标注且用户列表页为 true 其余为 false / 空金标集 loadGoldSet 抛错防空集假绿 / classifyToOutcome null 判 fail 且标记 failClosed 不当 pass / memoizeClassify 缓存命中时底层判定器零调用 / applyRatchet 通过率更高才抬高阈值，更低时不下调 / runEval 通过率低于阈值时 gate 判 fail / lintSkillContracts 缺 pre post side_effects 任一即 fail | import `packages/quality/eval/gold-eval.mjs` 失败 → Failed to load url（已本地实跑确认 RED） |
