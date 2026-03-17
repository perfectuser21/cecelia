---
id: dev-step-05-clean
version: 2.0.0
created: 2026-03-14
updated: 2026-03-16
changelog:
  - 2.0.0: 加入执行质量自评（四维评分 + 输出格式 + Brain API 写入）
  - 1.0.0: 初始版本
---

# Step 5: Merge+Clean — 归档 + 清理

> 原 Step 11，内容完全不变。Task Card 归档到 .history/task-cp-xxx.md。
> v2.0 新增：清理前先输出执行质量自评。

> 生成任务报告 + 清理分支和配置

**Task Checkpoint**: `TaskUpdate({ taskId: "5", status: "in_progress" })`

---

## Step 5.0 执行质量自评（清理前必须完成）

> **在开始清理之前，AI 计算并输出本次任务的执行质量分。**
> 用于量化改进方向，写入 Brain（有 task-id 时）。

### 四维评分计算

**维度 1 — CI 效率分（1-5）**

```bash
# 统计本分支触发的 CI 运行次数
CI_RUNS=$(gh run list --branch "$(git rev-parse --abbrev-ref HEAD)" \
  --json conclusion --jq 'length' 2>/dev/null || echo "?")
echo "CI 运行次数: $CI_RUNS"
```

| CI 运行次数 | 分数 |
|------------|------|
| 1 次通过   | 5    |
| 2 次       | 4    |
| 3 次       | 3    |
| 4 次+      | 1    |

**维度 2 — DoD 诚实度分（1-5）**

```bash
# 检查 Task Card 中 Test: 字段在 Step 2.1 锁定后是否被修改过
TEST_CHANGES=$(git log --all --follow -p -- ".task-cp-*.md" \
  2>/dev/null | grep "^[+-].*Test:" | grep -v "^---\|^+++" | wc -l | tr -d ' ')
echo "Test: 字段修改次数: $TEST_CHANGES"
```

| Test: 修改次数（锁定后）| 分数 |
|------------------------|------|
| 0 次（锁定不动）       | 5    |
| 1-2 次小改             | 4    |
| 3-4 次                 | 3    |
| 5 次+                  | 1    |

**维度 3 — 循环效率分（1-5）**

AI 自评本次任务 Stop Hook 触发（Claude 重启）的次数：

| Stop Hook 循环次数 | 分数 |
|-------------------|------|
| 1-2 次            | 5    |
| 3-4 次            | 4    |
| 5-6 次            | 3    |
| 7 次+             | 1    |

**维度 4 — Learning 质量分（1-5）**

```bash
LEARNING_FILE="docs/learnings/$(git rev-parse --abbrev-ref HEAD).md"
HAS_ROOT=$(grep -c "根本原因" "$LEARNING_FILE" 2>/dev/null || echo 0)
HAS_PREV=$(grep -c "下次预防" "$LEARNING_FILE" 2>/dev/null || echo 0)
HAS_CHECK=$(grep -cE "- \[ \]" "$LEARNING_FILE" 2>/dev/null || echo 0)
echo "根本原因: $HAS_ROOT | 下次预防: $HAS_PREV | Checklist: $HAS_CHECK"
```

| 包含字段                         | 分数 |
|----------------------------------|------|
| 根本原因 + 下次预防 + checklist  | 5    |
| 根本原因 + 下次预防（无checklist）| 4    |
| 只有描述，无结构                  | 3    |
| 几乎没有内容                      | 1    |

### 输出格式

AI 计算后输出（必须在清理前输出，不能跳过）：

```
执行质量：X/10
- CI 效率：X/5（第N次通过）
- DoD 诚实度：X/5（Test: 锁定后改了N次）
- 循环效率：X/5（Stop Hook 循环了N次）
- Learning 质量：X/5
可优化：{1-2句改进建议，或"无"}
```

> 总分 = (四项之和 / 4) × 2，四舍五入到整数，换算为 10 分制

### Brain API 写入（有 --task-id 时）

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"

# 读取 task_id 和置信度（Step 1 写入）
TASK_ID=$(grep "^task_id:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "")
CONFIDENCE=$(grep "^confidence_score:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "null")

# 替换为实际计算的各维度分和总分
CI_EFF=X; DOD_HON=X; LOOP_EFF=X; LEARN_QUAL=X
EXEC_QUALITY=$(echo "scale=0; ($CI_EFF + $DOD_HON + $LOOP_EFF + $LEARN_QUAL) * 2 / 4" | bc)

if [[ -n "$TASK_ID" && "$TASK_ID" != "null" ]]; then
    curl -s -X PATCH "http://localhost:5221/api/brain/tasks/${TASK_ID}" \
        -H "Content-Type: application/json" \
        -d "{
            \"custom_props\": {
                \"confidence_score\": ${CONFIDENCE},
                \"execution_quality\": ${EXEC_QUALITY},
                \"quality_details\": {
                    \"ci_efficiency\": ${CI_EFF},
                    \"dod_honesty\": ${DOD_HON},
                    \"loop_efficiency\": ${LOOP_EFF},
                    \"learning_quality\": ${LEARN_QUAL}
                }
            }
        }" | jq -r '.id // "error"' \
        && echo "✅ 评分已写入 Brain task ${TASK_ID}" \
        || echo "⚠️ Brain 写入失败（不阻塞清理）"
else
    echo "ℹ️ 无 task_id，跳过 Brain 写入"
fi
```

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

## 归档 Task Card

```bash
# 归档 Task Card：
mv .task-${BRANCH}.md .history/
```

---

## 删除 .dev-mode 文件（CRITICAL - 必须在最后）

**⚠️ 重要顺序**：`.dev-mode` 必须在 Step 5 的**最后一步**才能删除，不是开始时。

原因：`sed -i "s/^step_5_clean: pending/step_5_clean: done/" "$DEV_MODE_FILE"` 需要文件存在才能写入完成标记；Stop Hook 检测到这个标记后才允许退出，然后才删除 `.dev-mode`。

**正确顺序**：
```
1. 所有清理操作...
2. 写入 step_5_clean: done → .dev-mode
3. Stop Hook 检测完成 → 删除 .dev-mode（由 Stop Hook 负责）
```

**会话注册清理**（在开始时就可以做，与 .dev-mode 无关）：

```bash
# 读取 session_id（用于清理会话注册）
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
[[ -f "$DEV_MODE_FILE" ]] || DEV_MODE_FILE=".dev-mode"
SESSION_ID=$(grep "^session_id:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "")

# 清理会话注册（多会话检测）
if [[ -n "$SESSION_ID" ]]; then
    SESSION_FILE="/tmp/claude-engine-sessions/session-$SESSION_ID.json"
    if [[ -f "$SESSION_FILE" ]]; then
        rm -f "$SESSION_FILE"
        echo "✅ 会话注册已清理（session_id: $SESSION_ID）"
    fi
fi

# 清理过期会话（超过 1 小时无心跳）
find /tmp/claude-engine-sessions/ -name "session-*.json" -mmin +60 -delete 2>/dev/null || true
echo "✅ 过期会话已清理（超过 1 小时）"
```

---

## 使用 cleanup 脚本（推荐）

```bash
bash skills/dev/scripts/cleanup.sh "$BRANCH_NAME" "$BASE_BRANCH"
```

**脚本会**：
1. **归档 `.dev-incident-log.json` 到 `.dev-runs/`**（新增）
2. **删除 `.dev-feedback-report.json`**（新增）
3. **运行 Post-PR Checklist**
4. 切换到 base 分支
5. 拉取最新代码
6. 删除本地 cp-* 分支
7. 删除远程 cp-* 分支
8. **归档 Task Card：`mv .task-${BRANCH}.md .history/`**
9. 归档 PRD/DoD 到 `.history/`（如存在）
10. 清理 git config
11. 清理 stale remote refs
12. 检查未提交文件
13. 检查其他遗留 cp-* 分支
14. **标记 `step_5_clean: done` → Stop Hook 检测到允许退出**
15. **删除 `.dev-mode` 文件**（必须在最后！）

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

**清理时机**：Step 5 Cleanup 结束前（在标记步骤完成之前）

---

## ⛔ 自检：清理前确认（继续前必须通过）

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
ERRORS=0
echo "🔍 Step 5 自检..."

# 检查1: PR 已合并
PR_STATE=$(gh pr list --head "$BRANCH" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
if [[ -z "$PR_STATE" ]]; then
    echo "❌ PR 尚未合并（不能在 PR 合并前清理）"
    ERRORS=1
fi

# 检查2: Learning 文件已存在
LEARNING_FILE="docs/learnings/${BRANCH}.md"
if [[ ! -f "$LEARNING_FILE" ]]; then
    echo "❌ Learning 文件不存在: $LEARNING_FILE（必须先完成 Step 4）"
    ERRORS=1
fi

if [[ $ERRORS -gt 0 ]]; then
    echo ""
    echo "⛔ Step 5 自检失败！先完成上述问题再执行清理。"
    exit 1
fi

echo "✅ Step 5 自检通过 — 可以安全清理"
```

---

## 完成

**Task Checkpoint**: `TaskUpdate({ taskId: "5", status: "in_progress" })`

**清理任务列表**（见上方"清理任务列表"部分）

**标记步骤完成**：

```bash
# 标记 Step 5 完成（最后一步）
sed -i "s/^step_5_clean: pending/step_5_clean: done/" "$DEV_MODE_FILE"
echo "✅ Step 5 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "5", status: "completed" })`

```bash
echo "🎉 本轮开发完成！Stop Hook 将检测到 5 步全部完成，允许会话结束。"
```
