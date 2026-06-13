# Sprint Contract Draft (Round 1) — Harness CI 防线三件套（R8）

## Response Schema（推导来源: PRD 字面）

**N/A — 任务无 HTTP 响应。** 本 sprint 全部产出物为本地可跑的 node 脚本（`changed-test-router.mjs` / `contract-exists.mjs` / skill 契约测试 vitest）+ brain CI yaml 接线，验证 oracle 为**进程退出码 + stdout JSON/文本断言**，无任何 HTTP endpoint。Reviewer 第 6 维 verification_oracle_completeness 按 N/A 自动满分。

> 脚本 stdout 约定（非 HTTP，但为可机检 oracle 而固化）：
> - `changed-test-router.mjs <file...>` → stdout 一行 JSON：`{"extraTests": ["<test 文件路径>", ...]}`，并对每个映射 echo 一行 `[router] <changed> -> <test>`
> - `contract-exists.mjs --fixture <diff清单文件>` → 缺合同：exit≠0 + stderr 含缺失文件名（如 `contract-draft.md`）；含合同/空 diff/非 harness diff：exit 0
> - `skill-contract-check.mjs` 导出纯函数 `checkEvaluator/checkReviewer/checkGenerator/checkProposer(content)`，返回 `{ok:boolean, missing:string[]}`（不变量缺失项按名列出）

---

## 已知约束（来自回归测试）

- [packages/engine/tests/skills/harness-v5-ci-checks.test.ts] → "workflow 只在 sprints/ + packages/workflows/skills/harness-contract-* 改动时跑"——本 sprint 新接线触发范围须扩到 `packages/workflows/skills/**`，不得收窄既有触发
- [packages/engine/tests/skills/harness-v5-ci-checks.test.ts] → "workflow 文件存在 / 原有 job 全部硬门禁"——新增 job 不得把既有 job 改成软门禁
- [packages/engine/tests/skills/harness-contract-reviewer.test.ts] → skill 测试读 `os.homedir()/.claude/skills/<name>/SKILL.md`（安装位）；本 sprint 契约测试改读**仓库源** `packages/workflows/skills/<name>/SKILL.md`，使 PR diff 的 changed-path 能命中（这正是 changed-test-router 存在的理由：fs 读取不是 import 边，vitest --changed 探测不到）
- [packages/brain/src/workflows/harness-gan.graph.js:67 RUBRIC_DIMENSIONS] 与 [packages/brain/src/harness-shared.js:277 ReviewerOutputSchema] → 7 维名是 `harness::rubric-dimensions` 接口约定，reviewer SKILL 维度名必须与 schema 逐字一致（契约测试不变量 #3 的比对来源 = harness-shared.js 的 ReviewerOutputSchema.rubric_scores keys）

---

## Golden Path

[skill/合同文件变更] → [Step1 changed-test-router 选测] → [Step2 契约测试现网快照全绿] → [Step3 篡改必红] → [Step4 合同存在性] → [Step5 brain CI 接线] → [CI 在 PR 上当场红/绿]

---

### Step 1: 变更选测 — changed-test-router 对 skill 文件映射出 fs 依赖测试清单

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步「跑 changed-test-router，传入 evaluator/SKILL.md → 输出需额外执行的 fs 依赖测试清单，断言清单含 evaluator 契约测试，不是空」

**可观测行为**: 传入 `packages/workflows/skills/harness-evaluator/SKILL.md`，stdout 输出 JSON 清单，其中含 skill 契约测试文件路径（含子串 `skill-contract`）；过程 echo 出映射全文。传入非 skill 文件（如 `packages/brain/src/server.js`）→ 清单不含 skill 契约测试（不误报）。

**验证命令**:
```bash
# 正向：skill 文件 → 命中契约测试
OUT=$(node packages/brain/scripts/ci/changed-test-router.mjs packages/workflows/skills/harness-evaluator/SKILL.md)
echo "$OUT"
echo "$OUT" | jq -e '.extraTests | map(test("skill-contract")) | any' || { echo "FAIL: 清单未含 evaluator 契约测试"; exit 1; }

# 负向：非 skill 文件 → 不误报契约测试
OUT2=$(node packages/brain/scripts/ci/changed-test-router.mjs packages/brain/src/server.js)
echo "$OUT2"
echo "$OUT2" | jq -e '.extraTests | map(test("skill-contract")) | any | not' || { echo "FAIL: 非 skill 文件误报契约测试"; exit 1; }
```

**硬阈值**: 正向命中契约测试（exit 0），负向不命中（exit 0），过程 echo 清单全文可见

---

### Step 2: 契约测试现网快照全绿 — 5 类不变量守卫

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步「新增 skill 契约测试（vitest），对现网 skill 快照全部通过；覆盖 evaluator 含 env_missing/B-1.6/1.7/1.8 段、无 ws_id 残留；reviewer 7 维名与 ReviewerOutputSchema 逐字一致；generator 无可执行 gh pr merge；proposer 含「领域验证规则」段」

**可观测行为**: `npx vitest run` 跑 skill 契约测试，对当前仓库 skill 快照**全绿 exit 0**，覆盖 5 类不变量：
1. evaluator 正文含 `env_missing` / `B-1.6` / `1.7` / `1.8` 段
2. evaluator 正文（frontmatter 之后）无 `ws_id` 残留（changelog 内描述清理动作的 ws_id 不算残留——不变量只扫正文）
3. reviewer 7 维名（`dod_machineability` / `scope_match_prd` / `test_is_red` / `internal_consistency` / `risk_registered` / `verification_oracle_completeness` / `ci_workflow_alignment`）与 `packages/brain/src/harness-shared.js` 的 `ReviewerOutputSchema.rubric_scores` keys 逐字一致
4. generator 无**可执行** `gh pr merge`（changelog/红线 blockquote 里的 prose 提及允许；bash 代码栅栏内以 `gh pr merge` 开头的命令行 = 违规）
5. proposer 含「领域验证规则」段

**验证命令**:
```bash
npx vitest run packages/brain/scripts/ci/__tests__/skill-contract.test.mjs --reporter=verbose
# 期望：exit 0（现网快照全绿）；vitest 报告含 5 类不变量用例名
```

**硬阈值**: vitest exit 0；5 类不变量用例全 PASS

---

### Step 3: 篡改必红 — 删 env_missing 段 → 契约测试红且指明缺失不变量名

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步「对一份 fixture 副本删掉 env_missing 段 → 跑契约测试，结果为红，报错信息指明缺失的具体不变量（echo 可见缺失项名）」

**可观测行为**: 把不变量判定抽成纯函数 `checkEvaluator(content)`（`skill-contract-check.mjs`），对**删除了 env_missing 段的内存副本/fixture** 调用 → 返回 `{ok:false, missing:[...]}` 且 `missing` 含字面 `env_missing`；过程 echo 出缺失项名。篡改作用于副本字符串/fixture，**不污染真实 skill 文件**（边界情况要求）。

**验证命令**:
```bash
# 篡改副本（删 env_missing 段）→ 检查器报红且点名缺失项
node -e 'import("./packages/brain/scripts/ci/skill-contract-check.mjs").then(m=>{const fs=require("fs");let c=fs.readFileSync("packages/workflows/skills/harness-evaluator/SKILL.md","utf8");const tampered=c.replace(/env_missing/g,"ENV_REMOVED");const r=m.checkEvaluator(tampered);console.log("missing="+JSON.stringify(r.missing));if(r.ok){console.error("FAIL: 篡改未被检出");process.exit(1)}if(!r.missing.includes("env_missing")){console.error("FAIL: 报错未指明缺失 env_missing");process.exit(1)}console.log("OK: 篡改被检出，点名 env_missing")})'

# 真实 skill 文件未被污染（仍含 env_missing）
grep -q "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md || { echo "FAIL: 真实 skill 文件被篡改污染"; exit 1; }
echo "OK: 真实 skill 文件完好"
```

**硬阈值**: 检查器对篡改副本返回 ok=false 且 missing 含 `env_missing`（exit 0 表示反例验证成功）；真实文件仍含 env_missing

---

### Step 4: 合同存在性 — 缺 contract-draft.md 的 diff → 非零退出且点名；完整 diff → 退出 0

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步「对缺 contract-draft.md 的 diff fixture 跑存在性脚本 → 非零退出并指明缺失；对含合同的完整 fixture → 退出 0」+ 边界「空 diff / 非 harness PR 不误拦」

**可观测行为**: `contract-exists.mjs --fixture <diff清单>` 读 fixture（模拟 PR changed-files 清单）：
- 缺合同 fixture（改了 sprints 代码但无 contract-draft.md）→ exit≠0 + stderr 点名 `contract-draft.md`
- 完整 fixture（含 contract-draft.md + contract-dod.md）→ exit 0
- 非 harness diff fixture（无 sprints/ 改动，如纯 packages/brain 改动）→ exit 0（不误拦）

**验证命令**:
```bash
# 缺合同 → 非零退出 + 点名缺失
ERR=$(node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-missing-contract.txt 2>&1 || true)
echo "$ERR"
if node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-missing-contract.txt; then echo "FAIL: 缺合同应非零退出"; exit 1; fi
echo "$ERR" | grep -q "contract-draft.md" || { echo "FAIL: 未指明缺失文件名"; exit 1; }

# 完整 diff → 退出 0
node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-complete.txt && echo "OK: 完整合同退出 0" || { echo "FAIL: 完整合同应退出 0"; exit 1; }

# 非 harness diff → 退出 0（不误拦）
node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-non-harness.txt && echo "OK: 非 harness 不误拦" || { echo "FAIL: 非 harness PR 被误拦"; exit 1; }
```

**硬阈值**: 缺合同 exit≠0 且点名 `contract-draft.md`；完整 exit 0；非 harness exit 0

---

### Step 5: brain CI 接线 — brain-ci-deploy.yml 对 skills/** 变更强制跑三件套

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步「brain CI（brain-ci-deploy.yml）对 packages/workflows/skills/** 变更强制跑上述三件套（yaml 改动最小，全部判断逻辑落在可本地跑的 node 脚本里）」

**[CI_GAP: 当前 brain-ci-deploy.yml 只有 `push: branches:[main]` 的部署 job，无 PR 触发、无 `packages/workflows/skills/**` 路径、无三件套 step]** — Proposer 已用 Bash `cat .github/workflows/brain-ci-deploy.yml` 全文核对（见下「workflow 1:1 映射核对」）。Generator 必须新增一个 PR 触发的 job 跑三件套，且**不得改动既有 deploy job**（既有 push:main 部署逻辑保持原样）。

**可观测行为**: brain-ci-deploy.yml 新增 job：
- 触发含 `pull_request` + `paths: packages/workflows/skills/**`
- job steps 调用三件套脚本：`changed-test-router.mjs` + `skill-contract.test.mjs`（vitest）+ `contract-exists.mjs`
- yaml 语法合法（python3 yaml.safe_load 通过）
- 既有 deploy job（push:main）原样保留

**workflow 1:1 映射核对（Proposer 已读 workflow 全文）**:
| 用户真实路径 | 对应 workflow step（Generator 须落地） |
|---|---|
| 用户在 PR 改了某 skill 的 SKILL.md | `pull_request` + `paths: packages/workflows/skills/**` 触发 |
| 系统对变更选测，跑相应 fs 依赖契约测试 | step 调 `changed-test-router.mjs` 拿清单 → `npx vitest run` 跑清单内契约测试 |
| 系统守卫 5 类不变量 | step 跑 `skill-contract.test.mjs`（红即 PR 红） |
| 系统防缺合同 PR 进 main | step 调 `contract-exists.mjs` 校验本 PR diff |

**验证命令**:
```bash
# 触发范围含 skills 路径 + PR 触发
grep -q "packages/workflows/skills" .github/workflows/brain-ci-deploy.yml || { echo "FAIL: 未接 skills 路径"; exit 1; }
grep -q "pull_request" .github/workflows/brain-ci-deploy.yml || { echo "FAIL: 未加 PR 触发"; exit 1; }
# 三件套脚本被引用
grep -Eq "changed-test-router|skill-contract|contract-exists" .github/workflows/brain-ci-deploy.yml || { echo "FAIL: 未接三件套脚本"; exit 1; }
# 既有 deploy job 原样保留
grep -q "Deploy Brain (Gate 3)" .github/workflows/brain-ci-deploy.yml || { echo "FAIL: 既有 deploy job 被破坏"; exit 1; }
# yaml 语法合法
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/brain-ci-deploy.yml'))" || { echo "FAIL: yaml 语法非法"; exit 1; }
echo "OK: brain CI 三件套已接线"
```

**硬阈值**: 4 条 grep 全过 + yaml.safe_load exit 0；既有 deploy job 字面保留

---

## E2E 验收（最终 final-e2e 跑 — local_api）

**journey_type**: autonomous
**target_environment**: local_api

> evaluator 模式 B 在本地直跑（node + vitest + python3，无需远端机器）。每步过程 stdout 必须 echo 可见，独立裁判逐步核对。

```bash
#!/bin/bash
set -euo pipefail
cd /workspace
echo "==================== [STEP1] changed-test-router 变更选测 ===================="
OUT=$(node packages/brain/scripts/ci/changed-test-router.mjs packages/workflows/skills/harness-evaluator/SKILL.md)
echo "$OUT"
echo "$OUT" | jq -e '.extraTests | map(test("skill-contract")) | any' || { echo "FAIL[STEP1]: 清单未含 evaluator 契约测试"; exit 1; }
OUT2=$(node packages/brain/scripts/ci/changed-test-router.mjs packages/brain/src/server.js)
echo "$OUT2"
echo "$OUT2" | jq -e '.extraTests | map(test("skill-contract")) | any | not' || { echo "FAIL[STEP1]: 非 skill 文件误报"; exit 1; }
echo "✅ STEP1 PASS"

echo "==================== [STEP2] 契约测试现网快照全绿 ===================="
npx vitest run packages/brain/scripts/ci/__tests__/skill-contract.test.mjs --reporter=verbose
echo "覆盖 5 类不变量: evaluator段存在 / evaluator无ws_id残留 / reviewer7维==schema / generator无可执行gh-pr-merge / proposer领域验证规则段"
echo "✅ STEP2 PASS"

echo "==================== [STEP3] 篡改必红（删 env_missing）===================="
node -e 'import("./packages/brain/scripts/ci/skill-contract-check.mjs").then(m=>{const fs=require("fs");let c=fs.readFileSync("packages/workflows/skills/harness-evaluator/SKILL.md","utf8");const tampered=c.replace(/env_missing/g,"ENV_REMOVED");const r=m.checkEvaluator(tampered);console.log("缺失项 missing="+JSON.stringify(r.missing));if(r.ok){console.error("FAIL[STEP3]: 篡改未被检出");process.exit(1)}if(!r.missing.includes("env_missing")){console.error("FAIL[STEP3]: 报错未点名 env_missing");process.exit(1)}console.log("OK: 篡改被检出且点名 env_missing")})'
grep -q "env_missing" packages/workflows/skills/harness-evaluator/SKILL.md || { echo "FAIL[STEP3]: 真实 skill 文件被污染"; exit 1; }
echo "✅ STEP3 PASS（真实文件未被污染）"

echo "==================== [STEP4] 合同存在性 ===================="
ERR=$(node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-missing-contract.txt 2>&1 || true)
echo "缺合同 stderr: $ERR"
if node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-missing-contract.txt; then echo "FAIL[STEP4]: 缺合同应非零退出"; exit 1; fi
echo "$ERR" | grep -q "contract-draft.md" || { echo "FAIL[STEP4]: 未点名缺失文件"; exit 1; }
echo "缺合同退出码: 非零 ✓"
node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-complete.txt && echo "完整合同退出码: 0 ✓"
node packages/brain/scripts/ci/contract-exists.mjs --fixture packages/brain/scripts/ci/__tests__/fixtures/diff-non-harness.txt && echo "非 harness 退出码: 0 ✓（不误拦）"
echo "✅ STEP4 PASS"

echo "==================== [STEP5] brain CI 接线 ===================="
grep -q "packages/workflows/skills" .github/workflows/brain-ci-deploy.yml || { echo "FAIL[STEP5]: 未接 skills 路径"; exit 1; }
grep -q "pull_request" .github/workflows/brain-ci-deploy.yml || { echo "FAIL[STEP5]: 未加 PR 触发"; exit 1; }
grep -Eq "changed-test-router|skill-contract|contract-exists" .github/workflows/brain-ci-deploy.yml || { echo "FAIL[STEP5]: 未接三件套"; exit 1; }
grep -q "Deploy Brain (Gate 3)" .github/workflows/brain-ci-deploy.yml || { echo "FAIL[STEP5]: 既有 deploy job 被破坏"; exit 1; }
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/brain-ci-deploy.yml'))" && echo "yaml 语法: 合法 ✓"
echo "✅ STEP5 PASS"

echo "==================== ✅ Golden Path 5 步全部验证通过 ===================="
```

**通过标准**: 脚本 exit 0，5 步 echo 全部 PASS

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 三件套脚本存在性 + 行为 | `tests/ci-defense.test.ts` | changed-test-router / 缺合同 / 篡改检出 | 脚本未建 → import/require 失败 → N failures |
