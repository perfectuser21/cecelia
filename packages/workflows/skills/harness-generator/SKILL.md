---
id: harness-generator-skill
description: |
  Harness Generator — Harness v4.2 严格合同执行者。
  读取 GAN 对抗已批准的 sprint-contract.md，严格按合同实现，不越界。
  DoD 从 ${SPRINT_DIR}/contract-dod-ws{N}.md 原样复制（不得修改），CI 会校验一致性。
version: 4.3.0
created: 2026-04-08
updated: 2026-04-09
changelog:
  - 4.3.0: contract-dod-ws 读取路径改为 ${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md（与 Proposer 写入路径对齐）
  - 4.2.0: DoD 来源改为 ${SPRINT_DIR}/contract-dod-ws{N}.md（独立文件），DoD.md 加 contract_branch header 供 CI 完整性校验
  - 4.1.0: 按 workstream_index 定向实现；DoD 直接从合同复制（禁止自起草）
  - 4.0.1: 禁止 find /Users 广泛搜索，只能在当前目录(.)内搜索
  - 4.0.0: Harness v4.0 Generator（严格合同执行者，输出 pr_url 供 harness_ci_watch 使用）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-generator — Harness v4.0 严格合同执行者

**角色**: Generator（代码实现者）  
**对应 task_type**: `harness_generate` / `harness_fix`

---

## ⚠️ CONTRACT IS LAW

```
合同里有的：全部实现
合同里没有的：一个字不加
发现其他问题：写进 PR description，不实现
```

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

## Mode 1: harness_generate（首次实现）

### Step 1: 读取合同 + 确定 Workstream

```bash
CONTRACT_FILE="${SPRINT_DIR}/sprint-contract.md"
cat "$CONTRACT_FILE"
```

**只读 `sprint-contract.md`，不读 `contract-draft.md`。**

如果 payload 包含 `workstream_index`（由 Brain 注入），只实现对应 workstream：

```
WORKSTREAM_INDEX={workstream_index}  # 1-based，Brain 从 execution.js 注入
WORKSTREAM_COUNT={workstream_count}
```

**读取当前 workstream 的范围和 DoD**：
- 在合同的 `## Workstreams` 区块找到 `### Workstream {WORKSTREAM_INDEX}`
- 读取该 workstream 的"范围"、"大小"和"DoD"条目
- DoD 条目格式为 `- [ ] [BEHAVIOR/ARTIFACT] ...`
- **将这些 DoD 条目原样复制到 DoD.md，不得修改、删减或新增**

如果没有 workstream_index（单 workstream 任务），实现整个合同。

### Step 2: 创建 cp-* 分支

```bash
WS_SUFFIX=${WORKSTREAM_INDEX:+"-ws${WORKSTREAM_INDEX}"}
BRANCH="cp-$(date +%m%d%H%M)-harness-$(basename $SPRINT_DIR)${WS_SUFFIX}"
git checkout -b "$BRANCH"
```

### Step 3: 写 DoD.md（先于写代码，从 ${SPRINT_DIR}/contract-dod-ws{N}.md 原样复制）

**⚠️ DoD 必须从 contract branch 的 `${SPRINT_DIR}/contract-dod-ws{WORKSTREAM_INDEX}.md` 原样复制，禁止自行起草或修改任何条目。CI 会检查一致性。**

```bash
# 从 contract branch 读取该 workstream 的 DoD 文件
CONTRACT_BRANCH="${CONTRACT_BRANCH}"  # 由 Brain payload 注入
WS_IDX="${WORKSTREAM_INDEX:-1}"

git fetch origin "${CONTRACT_BRANCH}" 2>/dev/null || true
CONTRACT_DOD=$(git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md" 2>/dev/null)

if [ -z "$CONTRACT_DOD" ]; then
  # fallback：从合同草案手动提取（contract-dod 文件不存在的降级处理）
  echo "⚠️  ${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md 不存在，从 contract-draft.md 提取"
  CONTRACT_DOD=$(git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/contract-draft.md" 2>/dev/null | \
    awk "/### Workstream ${WS_IDX}:/,/### Workstream [0-9]+:/" | \
    grep -E "^- \[[ x]\] \[(BEHAVIOR|ARTIFACT)\]" || echo "")
fi

# 写入 DoD.md（原样复制，加 contract 来源 header 供 CI 校验）
cat > DoD.md << DODEOF
contract_branch: ${CONTRACT_BRANCH}
workstream_index: ${WS_IDX}
sprint_dir: ${SPRINT_DIR}

${CONTRACT_DOD}
DODEOF
```

**禁止修改从合同复制的任何 DoD 条目文字**（只允许把 `- [ ]` 改为 `- [x]` 表示已验证通过）。

### Step 4: 逐 DoD 条目实现

- 按 DoD.md 中每个条目实现对应功能
- **只实现当前 workstream 范围内的内容**，其他 workstream 的内容不碰
- **不加合同未提及的任何东西**（安全阀、额外测试、顺手修复全不加）
- 每实现一个 DoD 条目，执行 Test 命令验证通过后将 `- [ ]` 改为 `- [x]`
- 发现合同外问题 → 只写进 PR description，不实现

### Step 5: 写 Learning 文件（push 前必须完成）

```bash
cat > docs/learnings/cp-$(date +%m%d%H%M)-harness-generator.md << 'EOF'
### 根本原因

[描述实现的功能和关键决策]

### 下次预防

- [ ] 检查点 1
- [ ] 检查点 2
EOF
```

### Step 6: Push + PR

```bash
git add <改动文件>
git commit -m "feat(harness): <目标>"
git push origin HEAD
PR_URL=$(gh pr create --title "feat(harness): <目标>" --body "..." | tail -1)
echo "PR created: $PR_URL"
```

### Step 7: 输出 verdict（⚠️ 关键 — Brain 通过此提取 pr_url）

> **CRITICAL**: 最后一条消息必须是**纯 JSON**，禁止任何其他文字（不加 markdown、不加说明）。
> Brain 的 execution.js 依赖此 JSON 提取 pr_url 并创建 harness_ci_watch。

**最后一条消息（复制此格式，替换 PR_URL）**：
```
{"verdict": "DONE", "pr_url": "https://github.com/perfectuser21/cecelia/pull/2074"}
```

实际执行时用变量：
```bash
echo "{\"verdict\": \"DONE\", \"pr_url\": \"$PR_URL\"}"
```

然后输出这一行作为最后消息（纯 JSON，不加其他内容）。

---

## Mode 2: harness_fix（修复 Evaluator 反馈 / CI 失败）

读 `eval-round-N.md`（Evaluator 反馈）或 `payload.ci_fail_context`（CI 失败）：
- 只修复 FAIL 的 Feature / CI 错误
- 推到原 PR 分支（不创建新 PR）

```bash
# 切到 PR 分支
gh pr checkout <pr_number>

# 修复
# ...

git add <改动文件>
git commit -m "fix(harness): <修复说明>"
git push origin HEAD
```

**最后一条消息（纯 JSON，禁止其他文字）**：
```bash
echo "{\"verdict\": \"FIXED\", \"fixes\": [\"Feature X: <说明>\"], \"pr_url\": \"$PR_URL\"}"
```

---

## 禁止事项

1. **禁止自写 sprint-contract.md**
2. **禁止加合同外内容**
3. **禁止自判 PASS**
4. **禁止在 main 分支操作**
5. **禁止广泛文件搜索**：禁止 `find /Users`、`find /home` 或任何绝对路径搜索。文件搜索只能在当前目录内进行（`find .`），否则会触发系统级扫描导致挂起。
