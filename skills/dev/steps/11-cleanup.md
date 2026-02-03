# Step 11: Cleanup

> 生成任务报告 + 清理分支和配置

**Task Checkpoint**: `TaskUpdate({ taskId: "11", status: "in_progress" })`

---

## 任务报告生成

**cleanup 脚本会在清理前自动生成任务报告**：

```
.dev-runs/
├── <task-id>-report.txt   # 给用户看的纯文本报告
└── <task-id>-report.json  # 给 Cecelia 读取的 JSON 报告
```

### TXT 报告内容（重点：三层质检）

```
================================================================================
                          任务完成报告
================================================================================
任务ID:     cp-01191030-task-report
分支:       cp-01191030-task-report -> develop

--------------------------------------------------------------------------------
质检详情 (重点)
--------------------------------------------------------------------------------
Layer 1: 自动化测试    pass
Layer 2: 效果验证      pass
Layer 3: 需求验收      pass
质检结论: pass

--------------------------------------------------------------------------------
CI/CD
--------------------------------------------------------------------------------
PR:         https://github.com/.../pull/123
PR 状态:    已合并
================================================================================
```

### JSON 报告（供 Cecelia 链式任务）

```json
{
  "task_id": "cp-01191030-task-report",
  "quality_report": {
    "L1_automated": "pass",
    "L2_verification": "pass",
    "L3_acceptance": "pass",
    "overall": "pass"
  },
  "ci_cd": {
    "pr_url": "https://github.com/.../pull/123",
    "pr_merged": true
  },
  "files_changed": ["src/auth.ts", "src/auth.test.ts"]
}
```

---

## 测试任务的 Cleanup

```bash
IS_TEST=$(git config branch."$BRANCH_NAME".is-test 2>/dev/null)
```

**测试任务需要额外检查**：

| 检查项 | 说明 |
|--------|------|
| CHANGELOG.md | 确认没有测试相关的版本记录 |
| package.json | 确认版本号没有因测试而增加 |
| LEARNINGS.md | 确认只记录了流程经验（如有） |
| 测试代码 | 确认临时测试代码已删除 |

```bash
if [ "$IS_TEST" = "true" ]; then
    echo "🧪 测试任务 Cleanup 检查清单："
    echo "  - [ ] CHANGELOG.md 无测试版本记录"
    echo "  - [ ] package.json 版本号未变"
    echo "  - [ ] 测试代码已删除"
    echo "  - [ ] is-test 标记将被清理"
fi
```

---

## Post-PR Checklist（新增 - 自我进化机制）

**在清理前，运行自动化检查**：

```bash
bash scripts/post-pr-checklist.sh
```

**检查项**：
1. develop/main 无 PRD/DoD 残留
2. 派生视图版本同步
3. 无临时文件残留
4. 所有 commit 已 push

**如果发现问题**：
- Error → 立即修复并提交
- Warning → 记录但不阻塞

**Self-Evolution**：
- 发现的问题记录到 `docs/SELF-EVOLUTION.md`
- 新问题固化为检查项
- 检查项自动化

---

## 删除 .dev-mode 文件（CRITICAL）

**在 Cleanup 开始时，必须删除 .dev-mode 文件**：

```bash
# 删除 .dev-mode 文件（Stop Hook 循环控制信号）
if [[ -f ".dev-mode" ]]; then
    rm -f .dev-mode
    echo "✅ .dev-mode 已删除（Stop Hook 循环控制已禁用）"
fi
```

**注意**：如果 PR 已合并，Stop Hook 会自动删除 .dev-mode。但为了确保清理完整，Cleanup 步骤也要删除。

---

## 使用 cleanup 脚本（推荐）

```bash
bash skills/dev/scripts/cleanup.sh "$BRANCH_NAME" "$BASE_BRANCH"
```

**脚本会**：
1. **删除 .dev-mode 文件**（新增）
2. **运行 Post-PR Checklist**
3. 切换到 base 分支
4. 拉取最新代码
5. 删除本地 cp-* 分支
6. 删除远程 cp-* 分支
7. 清理 git config
8. 清理 stale remote refs
9. 检查未提交文件
10. 检查其他遗留 cp-* 分支

---

## 手动清理（备用）

```bash
# 清理 git config
git config --unset branch.$BRANCH_NAME.base-branch 2>/dev/null || true
git config --unset branch.$BRANCH_NAME.prd-confirmed 2>/dev/null || true
git config --unset branch.$BRANCH_NAME.is-test 2>/dev/null || true

# 切回 base 分支
git checkout "$BASE_BRANCH"
git pull

# 删除本地分支
git branch -D "$BRANCH_NAME" 2>/dev/null || true

# 删除远程分支
git push origin --delete "$BRANCH_NAME" 2>/dev/null || true

# 清理 stale refs
git remote prune origin 2>/dev/null || true
```

---

## 清理任务列表（CRITICAL）

**在完成前，必须清理 Task Checkpoint 创建的任务**：

```javascript
// 获取所有任务
const tasks = await TaskList()

// 将所有 pending 和 in_progress 的任务标记为 completed
tasks.forEach(task => {
  if (task.status !== 'completed') {
    TaskUpdate({ taskId: task.id, status: 'completed' })
  }
})
```

**为什么要清理**：
- 任务列表是临时的进度追踪工具
- 不清理会导致任务列表残留，影响下次 /dev 流程
- 用户界面会显示已完成的旧任务

**清理时机**：Step 11 Cleanup 结束前（在标记步骤完成之前）

---

## 完成

**Task Checkpoint**: `TaskUpdate({ taskId: "11", status: "in_progress" })`

**清理任务列表**（见上方"清理任务列表"部分）

**标记步骤完成**：

```bash
# 标记 Step 11 完成（最后一步）
sed -i 's/^step_11_cleanup: pending/step_11_cleanup: done/' .dev-mode
echo "✅ Step 11 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "11", status: "completed" })`

```bash
echo "🎉 本轮开发完成！Stop Hook 将检测到 11 步全部完成，允许会话结束。"
```
