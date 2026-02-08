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

---

## 记录模板

```markdown
### [YYYY-MM-DD] <任务简述>
- **Bug**: <遇到的问题和解决方案>
- **优化点**: <可改进的地方和具体建议>
- **影响程度**: Low/Medium/High
```

### 影响程度说明

- **Low**: 体验小问题，不影响功能
- **Medium**: 功能性问题，需要尽快修复
- **High**: 阻塞性问题，必须立即处理

---

## 执行方式

1. **回顾本次开发**
   - 有遇到什么意外的 bug 吗？
   - 有什么地方可以做得更好？
   - 这些问题/优化会影响到未来吗？

2. **追加到对应的 LEARNINGS.md**

3. **提交 Learning**
   ```bash
   git add docs/LEARNINGS.md
   git commit -m "docs: 记录 <任务> 的开发经验"
   git push
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
        bash skills/dev/scripts/generate-feedback-report.sh "$BRANCH_NAME" develop
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
