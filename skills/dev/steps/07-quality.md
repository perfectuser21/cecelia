# Step 7: Quality Gate

> **检查 + 汇总** - 在 PR 前跑所有本地检查，提前发现问题

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "in_progress" })`

---

## gate:quality 检查（必须）

Quality 使用 Subagent 执行，**所有检查通过才能继续**。

### 循环逻辑

```
主 Agent 写完代码/测试
    ↓
调用 gate:quality Subagent
    ↓
Subagent 跑 4 项检查：
  1. npm run typecheck
  2. npm run test
  3. npm run build
  4. bash -n *.sh
    ↓
├─ FAIL → 返回错误 → 主 Agent 回 Step 5 修代码 → 重新执行
└─ PASS → 生成 .gate-quality-passed → 继续 Step 8 (PR)
```

### gate:quality Subagent 调用

```
Skill({
  skill: "gate:quality"
})
```

### PASS 后操作

```bash
# 1. 生成 gate 文件
bash scripts/gate/generate-gate-file.sh quality

# 2. 汇总结果
cat > quality-summary.json << EOF
{
  "branch": "$BRANCH_NAME",
  "checks": {
    "typecheck": {"status": "pass"},
    "test": {"status": "pass"},
    "build": {"status": "pass"},
    "shell": {"status": "pass"}
  },
  "gates": {
    "quality": {"status": "pass", "file": ".gate-quality-passed"}
  }
}
EOF

# 3. 提交代码
git add -A
git commit -m "chore: quality gate passed"
git push origin HEAD
```

---

## 完成后

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/08-pr.md`
2. 立即创建 PR
3. **不要**输出总结或等待确认

---

**Step 8：创建 PR**
