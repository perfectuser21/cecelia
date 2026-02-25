# Step 7: 本地验证

> 推送前跑一次本地测试，省一轮 CI

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "in_progress" })`

---

## 为什么需要本地验证

```
❌ 旧流程：写完代码 → 直接推送 → CI 失败 → 修复 → 再推送（浪费 CI 时间）
✅ 新流程：写完代码 → 本地跑测试 → 通过再推送（省一轮 CI）
```

---

## 执行步骤

### 7.1 检测项目测试命令

```bash
# 检查 package.json 中是否有测试命令
if [[ -f "package.json" ]]; then
    HAS_TEST=$(node -e "const p=require('./package.json'); console.log(p.scripts?.test ? 'yes' : 'no')" 2>/dev/null)
    HAS_QA=$(node -e "const p=require('./package.json'); console.log(p.scripts?.qa ? 'yes' : 'no')" 2>/dev/null)
fi
```

### 7.2 运行测试

```bash
# 优先用 qa（包含 typecheck + test + build）
if [[ "$HAS_QA" == "yes" ]]; then
    npm run qa
# 否则只跑 test
elif [[ "$HAS_TEST" == "yes" ]]; then
    npm test
else
    echo "⚠️ 没有测试命令，跳过本地验证"
fi
```

### 7.3 处理结果

| 结果 | 动作 |
|------|------|
| 通过 | 继续 Step 8 (PR) |
| 失败 | 修复代码 → 重跑测试 |
| 无测试 | 跳过，继续 Step 8 |

---

## 完成后

**标记步骤完成**：

```bash
sed -i 's/^step_7_verify: pending/step_7_verify: done/' .dev-mode
echo "✅ Step 7 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/08-pr.md`
2. 立即创建 PR
3. **不要**输出总结或等待确认

---

**Step 8：创建 PR**
