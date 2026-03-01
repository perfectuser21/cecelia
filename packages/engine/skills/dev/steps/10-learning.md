# Step 10: Learning

> 记录开发经验（必须步骤）

**Task Checkpoint**: `TaskUpdate({ taskId: "10", status: "in_progress" })`

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

**测试任务的 Learning 是可选的**：

| 情况 | 处理 |
|------|------|
| 发现了流程/工具的问题 | 记录到 Engine LEARNINGS |
| 流程顺畅无问题 | 可以跳过 Learning |
| 测试代码后续会删除 | 不要记录功能相关的经验 |

**测试任务只记录"流程经验"，不记录"功能经验"**。

---

## 记录位置

### Engine 层面
工作流本身有什么可以改进的？
- /dev 流程哪里不顺畅？
- 缺少什么检查步骤？
- 脚本有什么 bug？

记录到：`zenithjoy-engine/docs/LEARNINGS.md`

### 项目层面
目标项目开发中的发现：
- 踩了什么坑？
- 学到了什么技术点？
- 有什么架构优化建议？

记录到：项目的 `docs/LEARNINGS.md`

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

```markdown
### [YYYY-MM-DD] <任务简述>

**失败统计**：CI 失败 N 次，本地测试失败 M 次

**CI 失败记录**（有则填，无则省略）：
- 失败 #1：根本原因 → 修复方式 → 下次如何预防
- 失败 #2：...

**本地测试失败记录**（有则填，无则省略）：
- 失败 #1：根本原因 → 修复方式 → 下次如何预防

**错误判断记录**（以为对但错了）：
- <描述判断错误的地方> → 正确答案是什么

**影响程度**: Low/Medium/High
**预防措施**（下次开发中应该注意什么）：
- ...
```

### 影响程度说明

- **Low**: 体验小问题，不影响功能（CI 0 次失败，流程顺畅）
- **Medium**: 功能性问题，需要尽快修复（CI 1-2 次失败，有明确根因）
- **High**: 阻塞性问题，必须立即处理（CI 3+ 次失败，或涉及架构错误判断）

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

2. **追加到对应的 LEARNINGS.md**

### 3. **提交 Learning（push 到功能分支，PR 自动包含 LEARNINGS）**

   **⚠️ 注意：此时 PR 尚未合并，仍在功能分支上**

   ```bash
   BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)

   # 直接在功能分支提交（PR 还开着）
   git add docs/LEARNINGS.md
   git commit -m "docs: 记录 <任务简述> 的开发经验

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

   git push origin HEAD
   echo "✅ LEARNINGS.md 已推送到功能分支（PR 已自动更新）"
   ```

   **好处**：
   - LEARNINGS.md 包含在同一个 PR 中（有完整 CI 历史）
   - 不需要另开单独的 docs PR
   - 合并后 LEARNINGS 直接进入 base branch，无需手动操作

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

   **合并后标记 Step 9 完成**：
   ```bash
   sed -i 's/^step_9_ci: pending/step_9_ci: done/' .dev-mode
   echo "✅ Step 9 完成标记已写入 .dev-mode"
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

## 生成反馈报告（新增 v12.15.0，4 维度分析 v12.18.0）

### 基础反馈报告

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

**用途**：
- OKR 迭代拆解（Phase 3/4）
- Brain 自动化决策
- 项目历史追溯

### 4 维度分析报告（新增 v12.18.0）

**生成深度分析报告（质量/效率/稳定性/自动化）**：

```bash
bash skills/dev/scripts/generate-feedback-report-v2.sh
```

生成 `docs/dev-reports/YYYY-MM-DD-HH-MM-SS.md`，包含：

**质量维度**：
- 每步期望 vs 实际对比
- LLM 质量分析和评分
- 发现的主要问题

**效率维度**：
- 每步耗时记录表
- 总耗时统计
- 用于改进前后对比

**稳定性维度**：
- 重试次数统计
- CI 通过率
- Stop Hook 触发次数

**自动化维度**：
- 每步自动化程度
- 人工干预次数
- 自动化率计算

**改进建议**：
- P0 质量问题
- P1 效率提升
- P2 自动化增强

**用途**：
- 持续改进 /dev 工作流
- 识别瓶颈和问题模式
- 评估优化效果

---

## 上传反馈到 Brain（新增 v12.17.0）

**如果是 Brain Task，上传反馈并更新状态**：

```bash
# 检测 task_id（从 .dev-mode 文件读取）
task_id=$(grep "^task_id:" .dev-mode 2>/dev/null | cut -d' ' -f2 || echo "")

if [[ -n "$task_id" ]]; then
    echo ""
    echo "📤 上传反馈到 Brain..."

    # 确保反馈报告已生成
    if [[ ! -f ".dev-feedback-report.json" ]]; then
        echo "⚠️  反馈报告不存在，正在生成..."
        BASE_BRANCH=$(git config branch."$BRANCH_NAME".base-branch 2>/dev/null || echo "main")
        bash skills/dev/scripts/generate-feedback-report.sh "$BRANCH_NAME" "$BASE_BRANCH"
    fi

    # 上传反馈
    if bash skills/dev/scripts/upload-feedback.sh "$task_id" 2>/dev/null || true; then
        echo "✅ 反馈已上传到 Brain"
    else
        echo "⚠️  反馈上传失败（Brain 可能不可用，继续执行）"
    fi

    # 更新 Task 状态为 completed
    if bash skills/dev/scripts/update-task-status.sh "$task_id" "completed" 2>/dev/null || true; then
        echo "✅ Task 已标记为完成"
    else
        echo "⚠️  Task 状态更新失败（Brain 可能不可用，继续执行）"
    fi

    # 更新关联 Capability stage（v12.27.0+）
    echo ""
    echo "🔄 检查 Capability stage 更新..."
    bash skills/dev/scripts/update-capability.sh "$task_id" 2>/dev/null || true
else
    echo ""
    echo "ℹ️  非 Brain Task，跳过反馈上传"
fi
```

**降级策略**：
- Brain API 不可用时不阻塞流程
- 使用 `2>/dev/null || true` 确保失败时继续
- 显示警告但不中断工作流

---

## 完成条件

- [ ] 至少有一条 Learning 记录（Engine 或项目层面）
- [ ] Learning 已提交并推送
- [ ] 反馈报告已生成（.dev-feedback-report.json）

**标记步骤完成**：

```bash
sed -i 's/^step_10_learning: pending/step_10_learning: done/' .dev-mode
echo "✅ Step 10 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "10", status: "completed" })`

**立即执行下一步**：读取 `skills/dev/steps/11-cleanup.md` 并继续

**完成后进入 Step 11: Cleanup**
