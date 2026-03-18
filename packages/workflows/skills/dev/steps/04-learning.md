---
id: dev-step-04-learning
version: 1.0.0
created: 2026-03-14
---

# Step 4: Learning — 记录经验 + 合并 PR

> 原 Step 10，内容完全不变。

> 记录开发经验（必须步骤）

**Task Checkpoint**: `TaskUpdate({ taskId: "4", status: "in_progress" })`

---

## 为什么必须记录？

每次开发都是一次学习机会：
- 遇到的 Bug 可能会再次出现
- 优化点积累形成最佳实践
- 影响程度帮助优先级决策

**不记录 = 重复踩坑**

---

## 测试任务的 Learning

```bash
IS_TEST=$(git config branch."$BRANCH_NAME".is-test 2>/dev/null)
```

**所有 PR 必须有 Learning，无例外。**（与 CI check-learning.sh 强制要求一致）

| 情况 | 处理 |
|------|------|
| 发现了流程/工具的问题 | 记录具体踩坑内容 |
| 流程顺畅无问题 | 记录"为什么顺畅"——什么做对了，下次继续 |
| 测试代码后续会删除 | 记录流程经验，不记录功能细节 |

**"没什么可记"本身就是一条 Learning：记录哪些预防措施真正有效。**

---

## 记录位置

### Per-Branch Learning 文件（v2 — 消除并行冲突）

**每个分支写自己的独立 Learning 文件**，路径：

```
docs/learnings/<branch-name>.md
```

例如分支 `cp-03111707-per-branch-learning` → 文件 `docs/learnings/cp-03111707-per-branch-learning.md`

**为什么不再写 `docs/LEARNINGS.md`？**
- 多个 /dev 并行时，所有 PR 都改同一个文件 → 先合并的改了文件 → 后面的 PR 必然冲突
- Per-branch 文件天然隔离，互不影响

### 内容范围
- 工作流本身的改进点（/dev 流程、脚本 bug）
- 项目开发中的发现（踩坑、技术点、架构建议）
- 统一写到一个 per-branch 文件即可

### Auto Memory（MEMORY.md）— SSOT 原则

**每次 PR 合并后，必须按以下规则更新 `memory/MEMORY.md`：**

| 信息类型 | 处理方式 |
|---------|---------|
| 版本号、Schema版本、端口、当前激活配置 | **绝对不写** — 有 SSOT（package.json/selfcheck.js/DB） |
| 文件路径变更（新增/移动/删除） | 更新"关键文件"section 对应行 |
| 新的架构设计决策（为什么这样做） | 追加到对应 section |
| 新的踩坑（非显而易见的 bug/陷阱） | 追加到对应踩坑 section |
| Schema 新版本 | 追加一行到"Schema 版本历史" |
| 已有记录的同类知识有更新 | 更新那一行，不追加重复 |

**没有新的架构知识或踩坑 → 不改 MEMORY.md（不要为了"完整"强行追加）**

---

## 记录模板

> ⚠️ **格式严格要求**：CI `check-learning.sh` 强制检查以下三个元素，缺一不可：
> 1. `### 根本原因` 三级标题
> 2. `### 下次预防` 三级标题
> 3. `- [ ]` checklist 条目（至少一条）

```markdown
## <任务简述>（YYYY-MM-DD）

### 根本原因

<具体描述问题的根本原因，不能是"代码有问题"这种废话>
示例："existsSync mock 条件顺序错误，最具体的条件必须在最宽泛条件之前"

### 下次预防

- [ ] <具体可执行的预防措施，不能是"下次要更仔细">
- [ ] <另一条具体措施>
```

**流程顺畅时（CI 0 次失败）也必须写**，示例：

```markdown
## <任务简述>（YYYY-MM-DD）

### 根本原因

本次开发流程顺畅，无 CI 失败。<记录"为什么顺畅"——哪些预防措施真正有效>

### 下次预防

- [ ] 继续使用 <有效的做法>，证明该模式可靠
```

---

## 执行方式

### 0. 读取过程数据（必须先做）

**在写任何 Learning 之前，先读取 `.dev-incident-log.json`**：

```bash
INCIDENT_FILE=".dev-incident-log.json"
if [[ -f "$INCIDENT_FILE" ]]; then
    echo "=== 本次开发 Incident Log ==="
    jq -r '.[] | "[\(.step)] \(.type): \(.description)\n  错误: \(.error | split("\n")[0])\n  修复: \(.resolution)\n"' "$INCIDENT_FILE"
    CI_FAILURES=$(jq '[.[] | select(.type == "ci_failure")] | length' "$INCIDENT_FILE")
    TEST_FAILURES=$(jq '[.[] | select(.type == "test_failure")] | length' "$INCIDENT_FILE")
    echo "CI 失败次数: $CI_FAILURES"
    echo "本地测试失败次数: $TEST_FAILURES"
else
    echo "无 Incident Log（本次开发无失败记录）"
    CI_FAILURES=0
    TEST_FAILURES=0
fi
```

### 1. 强制回答以下问题（必答，不允许跳过）

**基于 Incident Log 和本次开发过程，必须回答**：

| # | 问题 | 数据来源 |
|---|------|---------|
| Q1 | 本次 CI 失败了几次？每次的根本原因是什么？ | `.dev-incident-log.json` (type=ci_failure) |
| Q2 | 本次本地验证失败了几次？每次的根本原因是什么？ | `.dev-incident-log.json` (type=test_failure) |
| Q3 | 有没有哪个判断"以为对但后来发现是错的"？ | 回顾整个开发过程 |
| Q4 | 这些问题会不会再次出现？如果会，下次怎么更快解决？ | 分析根因 |
| Q5 | 有没有什么应该加入 MEMORY.md 的新踩坑或架构决策？ | 判断是否有"非显而易见"的知识 |

**答案决定 Learning 内容的深度**：
- CI 失败 0 次 + 本地失败 0 次 + 无错误判断 → 可简要记录"流程顺畅"
- 有任何失败或错误判断 → 必须详细记录根因和预防措施

### 2. 写 Learning（基于问题回答）

2. **写到 per-branch Learning 文件**

   ```bash
   BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
   LEARNING_FILE="docs/learnings/${BRANCH_NAME}.md"
   mkdir -p docs/learnings
   # 将 Learning 内容写到 $LEARNING_FILE
   ```

### 2.5 ⛔ 自检：Learning 格式验证（push 前必须通过）

**在 push 之前，必须执行以下自检命令。任何一项失败 = 禁止 push，先修复。**

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
LEARNING_FILE="docs/learnings/${BRANCH_NAME}.md"
ERRORS=0

echo "🔍 Learning 格式自检..."

# 检查1: 文件存在
if [[ ! -f "$LEARNING_FILE" ]]; then
    echo "❌ Learning 文件不存在: $LEARNING_FILE"
    ERRORS=1
fi

# 检查2: 包含 ### 根本原因
if ! grep -q "### 根本原因" "$LEARNING_FILE" 2>/dev/null; then
    echo "❌ 缺少 '### 根本原因' 三级标题（CI check-learning.sh 强制要求）"
    ERRORS=1
fi

# 检查3: 包含 ### 下次预防
if ! grep -q "### 下次预防" "$LEARNING_FILE" 2>/dev/null; then
    echo "❌ 缺少 '### 下次预防' 三级标题（CI check-learning.sh 强制要求）"
    ERRORS=1
fi

# 检查4: 包含 - [ ] checklist
if ! grep -qE "^- \[ \]" "$LEARNING_FILE" 2>/dev/null; then
    echo "❌ 缺少 '- [ ]' checklist 条目（下次预防必须有可执行的 checklist）"
    ERRORS=1
fi

if [[ $ERRORS -gt 0 ]]; then
    echo ""
    echo "⛔ Learning 格式验证失败！修复后才能 push。"
    echo "   正确格式（三段缺一不可）："
    echo "   ## 标题 → ### 根本原因 → ### 下次预防 → - [ ] 条目"
    exit 1
fi

echo "✅ Learning 格式验证通过"
```

### 2.5b ⛔ CI 镜像检查（bash 自检通过后、LLM Gate 前执行）

> **本地跑 CI 同款 check-learning.sh，让格式问题在本地被拦截，不等 CI 才发现。**

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
echo "🔍 本地 CI 镜像：check-learning.sh..."

# 设置 CI 所需的环境变量
export GITHUB_HEAD_REF="$BRANCH_NAME"
export PR_TITLE=$(git log --oneline -1 2>/dev/null || echo "feat: temp")

bash packages/engine/scripts/devgate/check-learning.sh
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
    echo ""
    echo "⛔ Learning 格式不符合 CI 要求！修复后再进 LLM Subagent。"
    echo "   常见问题："
    echo "   - 每个陷阱章节必须有 '### 根本原因' 三级标题"
    echo "   - 每个陷阱章节必须有 '### 下次预防' 三级标题"
    echo "   - '下次预防' 下必须有 '- [ ]' checklist 条目"
    exit 1
fi

echo "✅ CI 镜像检查通过 — Learning 格式符合要求"
```

### 2.6 ⛔ LLM 质量 Gate（CI 镜像检查通过后执行）

> **bash 检查格式，LLM 检查实质。召唤 Verifier Subagent 判断 Learning 是否有真正的学习价值。**

召唤 Verifier Subagent，prompt：

```
你是 Learning 质量审查员。判断以下 Learning 记录是否有真正的学习价值。

Learning 内容：
{粘贴 docs/learnings/{branch}.md 全文}

评估标准：

1. 根本原因是否真实：是否找到了问题的根本原因（不是表面症状）？
   真实根因示例："existsSync mock 条件顺序错误，具体条件必须在宽泛条件之前"
   敷衍示例："代码有问题" / "需要更仔细"

2. 预防措施是否可执行：checklist 条目是否具体可执行（不是废话）？
   可执行示例："- [ ] mock 多条件时，最具体的条件写在最前面"
   废话示例："- [ ] 下次要更小心" / "- [ ] 注意测试"

3. 是否记录了真实发生的事：失败次数和原因是否如实填写（不是零失败但实际有失败）？

输出格式：
[PASS] 或 [NEEDS_IMPROVEMENT]
问题（仅 NEEDS_IMPROVEMENT 时）：{具体指出哪里敷衍、怎么改}

注意：不要修改任何文件，不要写入 .dev-mode，只做评估并报告。
```

处理结果：
- **[PASS]** → **立即写入 Gate 2 agent_seal**（双签机制），然后继续 Step 3：
  ```bash
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  STAMP=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S%z)
  echo "step_4_agent: approved@${STAMP}" >> ".dev-agent-seal.${BRANCH}"
  echo "✅ Gate 2 agent_seal 已写入：step_4_agent: approved"
  ```
- **[NEEDS_IMPROVEMENT]** → 按反馈重写对应部分 → 重新执行 LLM 质量 Gate

---

### 3. **提交 Learning（push 到功能分支，PR 自动包含 Learning）**

   **⚠️ 注意：此时 PR 尚未合并，仍在功能分支上**

   ```bash
   BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
   LEARNING_FILE="docs/learnings/${BRANCH_NAME}.md"

   # 直接在功能分支提交（PR 还开着）
   git add "$LEARNING_FILE"
   git commit -m "docs: 记录 <任务简述> 的开发经验

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

   git push origin HEAD
   echo "✅ Learning 已推送到功能分支（PR 已自动更新）"
   ```

   **好处**：
   - 每个分支独立文件，并行 /dev 不再冲突
   - Learning 包含在同一个 PR 中（有完整 CI 历史）
   - 不需要另开单独的 docs PR

### 3.5. **触发 LEARNINGS_RECEIVED 事件 → 丘脑分拣**

   **将 LEARNINGS.md 中的知识发送给 Brain，经丘脑分拣走不同路径**：

   ```bash
   # 从 .dev-mode 读取分支和任务信息
   BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
   PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
   TASK_ID=$(grep "^task_id:" .dev-mode 2>/dev/null | cut -d' ' -f2 || echo "")

   # 触发 LEARNINGS_RECEIVED 事件（丘脑分拣两条路径）
   bash skills/dev/scripts/fire-learnings-event.sh \
     --branch "$BRANCH_NAME" \
     --pr "$PR_NUMBER" \
     --task-id "$TASK_ID"
   ```

   **两条路径**：
   - `issues_found`（CI/测试失败记录）→ 创建 **fix task**（任务线，不让 bug 跑掉）
   - `next_steps_suggested`（预防措施/经验）→ 写 **learnings 表**（成长线 → 反刍 → NotebookLM 持久化）

   **降级策略**：Brain 不可用时跳过（`|| true`），不阻塞流程。

### 4. **合并 PR（LEARNINGS 已包含在 PR diff 中）**

   ```bash
   BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
   PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --state open --json number -q '.[0].number')

   echo "📋 PR #$PR_NUMBER 将包含："
   echo "  - 代码变更"
   echo "  - LEARNINGS.md"

   gh pr merge "$PR_NUMBER" --squash --delete-branch

   echo "✅ PR #$PR_NUMBER 已合并（代码 + LEARNINGS 一次入库）"
   ```

   **合并后标记 Step 3 完成**：
   ```bash
   sed -i 's/^step_3_prci: in_progress/step_3_prci: done/' .dev-mode
   echo "✅ Step 3 完成标记已写入 .dev-mode"
   ```

---

## 没有特别的 Learning？

即使本次开发很顺利，也至少记录：
```markdown
### [YYYY-MM-DD] <任务简述>
- **Bug**: 无
- **优化点**: 流程顺畅，无明显优化点
- **影响程度**: N/A
```

**记录"没问题"本身也是有价值的信息**，证明这个流程/模式是可靠的。

---

## 生成反馈报告

**生成结构化反馈报告（Brain 集成）**：

```bash
bash skills/dev/scripts/generate-feedback-report.sh
```

生成 `.dev-feedback-report.json`，包含：
- task_id, branch, pr_number
- summary, issues_found, next_steps_suggested
- technical_notes, performance_notes
- code_changes（files, lines 统计）
- test_coverage

---

## 上传反馈到 Brain（PR 合并后执行）

**如果是 Brain Task，PR 合并后用 execution-callback 标记完成**：

> ⚠️ **注意**：必须在 PR 合并后执行，且必须带 `pr_url`，否则 Brain 会将 dev task 标记为 `completed_no_pr` 而非 `completed`。

```bash
# 检测 task_id（从 .dev-mode 文件读取）
task_id=$(grep "^task_id:" .dev-mode 2>/dev/null | cut -d' ' -f2 || echo "")

if [[ -n "$task_id" ]]; then
    echo ""
    echo "📤 回调 Brain 标记 Task 完成..."

    BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
    # 获取合并后的 PR URL（state=merged）
    PR_URL=$(gh pr list --head "$BRANCH_NAME" --state merged --json url -q '.[0].url' 2>/dev/null || echo "")

    # 使用 execution-callback（带 pr_url）正确标记 dev task 为 completed
    RESPONSE=$(curl -s -X POST "http://localhost:5221/api/brain/execution-callback" \
        -H "Content-Type: application/json" \
        -d "{\"task_id\":\"$task_id\",\"status\":\"completed\",\"exit_code\":0,\"pr_url\":\"$PR_URL\",\"result\":\"PR merged\"}" \
        2>/dev/null || echo "")

    if echo "$RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
        echo "✅ Task $task_id 已标记为完成（Brain 已更新）"
    else
        echo "⚠️  Brain 回调失败或不可用，可手动更新："
        echo "   psql -U cecelia -d cecelia -c \"UPDATE tasks SET status='completed' WHERE id='$task_id';\""
    fi
else
    echo ""
    echo "ℹ️  非 Brain Task，跳过回调"
fi
```

**降级策略**：
- Brain API 不可用时不阻塞流程（`|| echo ""`）
- 显示手动修复命令但不中断工作流

---

## 完成条件

- [ ] 至少有一条 Learning 记录（Engine 或项目层面）
- [ ] Learning 已提交并推送
- [ ] 反馈报告已生成（.dev-feedback-report.json）

**标记步骤完成**：

```bash
sed -i 's/^step_4_learning: pending/step_4_learning: done/' .dev-mode
echo "✅ Step 4 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "4", status: "completed" })`

**立即执行下一步**：读取 `skills/dev/steps/05-clean.md` 并继续

**完成后进入 Step 5: Merge+Clean**
