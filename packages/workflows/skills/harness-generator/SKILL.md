---
id: harness-generator-skill
description: |
  Harness Generator — Harness v5.0 严格合同执行者 × Superpowers 融合。
  读取 GAN 对抗已批准的 sprint-contract.md + tests/ws{N}/*.test.ts + contract-dod-ws{N}.md，按 TDD 纪律两次 commit（commit 1 = 测试 Red / commit 2 = 实现 Green）。
  融入 4 个 superpowers：test-driven-development / verification-before-completion / systematic-debugging / requesting-code-review。
  CONTRACT IS LAW：合同里有的全实现，合同外一字不加；**测试文件从合同原样复制，commit 1 后不可修改**（CI 强校验）。
version: 5.0.0
created: 2026-04-08
updated: 2026-04-20
changelog:
  - 5.0.0: TDD × Superpowers 融合 — 两次 commit 纪律（commit 1 测试 Red / commit 2 实现 Green）+ 4 个 superpowers（test-driven-development / verification-before-completion / systematic-debugging / requesting-code-review）；测试文件从合同原样 checkout，commit 1 后不可修改；Mode 2 harness_fix 走 systematic-debugging
  - 4.3.0: contract-dod-ws 读取路径改为 ${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md（与 Proposer 写入路径对齐）
  - 4.2.0: DoD 来源改为 ${SPRINT_DIR}/contract-dod-ws{N}.md（独立文件），DoD.md 加 contract_branch header 供 CI 完整性校验
  - 4.1.0: 按 workstream_index 定向实现；DoD 直接从合同复制（禁止自起草）
  - 4.0.1: 禁止 find /Users 广泛搜索，只能在当前目录(.)内搜索
  - 4.0.0: Harness v4.0 Generator（严格合同执行者，输出 pr_url 供 harness_ci_watch 使用）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-generator — Harness v5.0 TDD 执行者（Superpowers 融合）

**角色**: Generator（代码实现者，遵循 TDD Red-Green 纪律）
**对应 task_type**: `harness_generate` / `harness_fix`

---

## ⚠️ CONTRACT IS LAW

```
合同里有的：全部实现
合同里没有的：一个字不加
测试文件（从合同 checkout）：commit 1 后绝对不可修改，CI 强校验
发现其他问题：写进 PR description，不实现
```

---

## ⚠️ 文件搜索规则（CRITICAL — 违反会导致系统挂起数小时）

**当前工作目录（pwd）即项目根目录，直接使用相对路径。**

```bash
# ❌ 严禁（会遍历 iCloud/网络挂载点，挂起数小时）
find /Users -name "server.js"
find /home -name "*.js"
find / -name "*.ts"

# ✅ 只在当前目录内搜索
find . -name "server.js" -path "*/brain/src/*" 2>/dev/null | head -5
ls packages/brain/src/
cat packages/brain/src/server.js
grep -r "tick_stats" packages/brain/src/
```

---

## Mode 1: harness_generate（首次实现，TDD Red-Green 两次 commit）

### Step 0: 解析任务上下文

Brain 在 prompt 头部注入：

```
TASK_ID={task_id}
SPRINT_DIR={sprint_dir}
CONTRACT_BRANCH={contract_branch}
PLANNER_BRANCH={planner_branch}
WORKSTREAM_INDEX={workstream_index}  # 1-based，可能为空（单 workstream 时）
WORKSTREAM_COUNT={workstream_count}
```

**CONTRACT_BRANCH / SPRINT_DIR 未定义时绝对禁止继续。**

### Step 1: 读合同 + 测试文件清单

```bash
WS_IDX="${WORKSTREAM_INDEX:-1}"

git fetch origin "${CONTRACT_BRANCH}" 2>/dev/null || true

# 读合同
git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/sprint-contract.md"

# 读 DoD（只含 [ARTIFACT]）
git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md"

# 列出测试文件
git ls-tree -r "origin/${CONTRACT_BRANCH}" -- "${SPRINT_DIR}/tests/ws${WS_IDX}/"
```

**只读 sprint-contract.md，不读 contract-draft.md。**

### Step 2: 创建 cp-* 分支

```bash
WS_SUFFIX=${WORKSTREAM_INDEX:+"-ws${WORKSTREAM_INDEX}"}
BRANCH="cp-$(date +%m%d%H%M)-harness-$(basename $SPRINT_DIR)${WS_SUFFIX}"
git checkout -b "$BRANCH"
```

### Step 3: ★ TDD Red 阶段（commit 1 = 测试文件 + DoD，禁含实现）

**调用 skill: `superpowers:test-driven-development`** — 遵循 Red-Green-Refactor 铁律。

```bash
# 从合同 branch 原样 checkout 测试文件（禁止修改）
git checkout "origin/${CONTRACT_BRANCH}" -- "${SPRINT_DIR}/tests/ws${WS_IDX}/"

# 原样复制 DoD（contract-dod-ws{N}.md → DoD.md，加 contract 来源 header）
CONTRACT_DOD=$(git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md")
cat > DoD.md << DODEOF
contract_branch: ${CONTRACT_BRANCH}
workstream_index: ${WS_IDX}
sprint_dir: ${SPRINT_DIR}

${CONTRACT_DOD}
DODEOF

# commit 1 只能 touch：sprints/*/tests/**/*.test.ts + DoD.md
# 禁含 packages/ apps/ 等实现目录
git add "${SPRINT_DIR}/tests/ws${WS_IDX}/" DoD.md
git commit -m "test(harness): ws${WS_IDX} failing tests (Red)"

# verify Red：跑测试看红（预期 FAIL，因实现还不存在）
npx vitest run "${SPRINT_DIR}/tests/ws${WS_IDX}/" --reporter=verbose 2>&1 | tee /tmp/red-evidence.txt || true

EXPECTED_RED=$(grep -c "^\s*it(" "${SPRINT_DIR}/tests/ws${WS_IDX}/"*.test.ts 2>/dev/null | awk -F: '{s+=$2} END {print s}')
ACTUAL_RED=$(grep -cE "FAIL|✗|×" /tmp/red-evidence.txt || echo 0)
if [ "$ACTUAL_RED" -lt "$EXPECTED_RED" ]; then
  echo "ERROR: 预期 $EXPECTED_RED 个红，实际 $ACTUAL_RED — 测试本地就能过，说明 import 错或测试太弱"
  exit 1
fi
```

**Red 证据贴进 commit 1 的 git notes 或临时保存在 /tmp/red-evidence.txt，后面进 PR body。**

### Step 4: ★ TDD Green 阶段（commit 2 = 实现 + ARTIFACT 产物）

逐个 [BEHAVIOR] 对应的 `it()` 写实现。**禁止修改 `sprints/*/tests/` 下的任何文件**——测试是合同一部分，改测试 = 改合同 = 重走 GAN。

```bash
# 实现代码（让测试变绿）
# - 按 DoD.md 的 [ARTIFACT] 条目一一落实（Learning / 配置 / 文件等）
# - 按合同 BEHAVIOR 覆盖写最小实现让测试通过
# - 不加合同未提及的任何东西

# 每写一个模块就跑对应测试看绿，不整体跑直到都写完

# commit 2 必须含实现（禁止只含测试）；可含 Learning / docs / 配置等 ARTIFACT
git add <实现文件> docs/learnings/cp-*.md <配置文件>
git commit -m "feat(harness): ws${WS_IDX} implementation (Green)"
```

**硬约束**（CI 强校验）：

1. commit 1 之后，任何 commit 都**不许修改** `sprints/*/tests/**/*.test.ts`
2. commit 2+ 必须包含实现代码（`packages/` 或 `apps/` 目录变更），不能只改 docs
3. commit 1 message 含 `(Red)`，commit 2 message 含 `(Green)`

### Step 5: ★ Verification 阶段（push 前必须实跑 + 贴证据）

**调用 skill: `superpowers:verification-before-completion`** — 禁止自己声称"测试通过"，必须贴 npm test 实际输出。

```bash
# 跑完整测试套件
npx vitest run "${SPRINT_DIR}/tests/ws${WS_IDX}/" --reporter=verbose 2>&1 | tee /tmp/green-evidence.txt

# 验证：
# - 原本红的测试现在必须绿
# - 无 skip / todo / xit
# - 无新增红
```

Test Evidence 要贴进 PR body 的 `## Test Evidence` 章节（Red → Green 对比）。

### Step 6: ★ Code Review 阶段（push 前调 subagent 审 diff）

**调用 skill: `superpowers:requesting-code-review`** — 调 review subagent 审 diff。

```bash
git diff origin/main...HEAD -- . ':!DoD.md' ':!docs/learnings/'
# subagent 返回 issues list（high/medium/low 分级）
# high → 修；medium → PR 里记录；low → 忽略
```

Review Summary 贴进 PR body。

### Step 7: Push + PR

```bash
git push origin HEAD

PR_URL=$(gh pr create --title "feat(harness): ws${WS_IDX} — <目标>" --body "$(cat <<'PRBODY'
## Summary
<本 workstream 实现的功能>

## Test Evidence

### Red (commit 1)
\`\`\`
<贴 /tmp/red-evidence.txt 的摘要>
\`\`\`

### Green (commit 2+)
\`\`\`
<贴 /tmp/green-evidence.txt 的摘要>
\`\`\`

## Review Summary
<贴 subagent 的 high/medium issues 摘要>

## Learning
docs/learnings/cp-xxx-xxx.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)" | tail -1)

echo "PR created: $PR_URL"
```

### Step 8: 输出 verdict JSON（⚠️ Brain 通过此提取 pr_url）

> **CRITICAL**: 最后一条消息必须是**纯 JSON**，禁止任何其他文字（不加 markdown、不加说明）。
> Brain 的 execution.js 依赖此 JSON 提取 pr_url 并创建 harness_ci_watch。

```
{"verdict": "DONE", "pr_url": "https://github.com/perfectuser21/cecelia/pull/xxxx"}
```

实际执行：

```bash
echo "{\"verdict\": \"DONE\", \"pr_url\": \"$PR_URL\"}"
```

输出这一行作为最后消息（纯 JSON，不加其他内容）。

---

## Mode 2: harness_fix（CI 失败 / Evaluator 反馈修复）

**调用 skill: `superpowers:systematic-debugging`** — 系统化调试：

1. 先读 `payload.ci_fail_context` 或 `eval-round-N.md` 定位真实失败原因
2. 如果现有测试不足以复现 → 写一个复现测试（**但仅限修复相关的新测试，禁止动合同原测试**）
3. 按 Red-Green-Refactor 修实现代码
4. 本地跑测试 + verification-before-completion 确认所有原有测试仍绿
5. push 到原 PR 分支（不创建新 PR）

```bash
# 切到 PR 分支
gh pr checkout <pr_number>

# systematic-debugging 流程
# ... 定位 → 复现 → 修 → 验证 ...

git add <修复文件>
git commit -m "fix(harness): <修复说明> (Green after fix)"
git push origin HEAD
```

**最后一条消息（纯 JSON，禁止其他文字）**：

```bash
echo "{\"verdict\": \"FIXED\", \"fixes\": [\"<Feature X: 修复说明>\"], \"pr_url\": \"$PR_URL\"}"
```

---

## 禁止事项（严格）

1. **禁止自写 sprint-contract.md** —— 合同是上游 GAN 阶段产出，Generator 只读
2. **禁止加合同外内容** —— 安全阀/额外测试/顺手修复全不加；测试文件也是合同一部分
3. **禁止修改从合同 checkout 的测试文件** —— 测试一旦 commit 1 Red，就**不可改**（CI 强校验 git log：测试文件 diff 在 commit 2+ 里必须为空）
4. **禁止自判 PASS** —— Evaluator / CI 才是判官
5. **禁止在 main 分支操作**
6. **禁止广泛文件搜索** —— `find /Users`、`find /home` 或任何绝对路径搜索；只能在当前目录内（`find .`）

---

## 红旗（出现这些心态立刻停下）

| 想法 | 真相 |
|---|---|
| "测试写得太严，改一下让它能过" | 改测试 = 违反 CONTRACT IS LAW，push 时 CI 会抓 |
| "我知道 BEHAVIOR 应该是啥，不看测试直接写实现" | 违反 TDD Red-Green 顺序，commit 顺序检查会挂 |
| "先让一个测试过，其他等 CI 告诉我" | 违反 verification-before-completion，必须本地先全绿 |
| "合同写漏了一个功能，顺手加上" | 违反合同外不加，只能写进 PR description 上报 |
| "跑测试挺慢，跳过这一步吧" | 违反 verification-before-completion，禁止"看起来应该过了"的假设 |
