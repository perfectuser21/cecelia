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

## gate:learning 审核（必须）

Learning 使用 Subagent 执行，**写好才能继续**。

### 循环逻辑（模式 B：主 Agent 改）

**主 Agent 负责循环控制，最大 3 轮**：

```javascript
const MAX_GATE_ATTEMPTS = 20;
let attempts = 0;

while (attempts < MAX_GATE_ATTEMPTS) {
  // 启动独立的 gate:learning Subagent（只审核）
  const result = await Skill({
    skill: "gate:learning"
  });

  if (result.decision === "PASS") {
    // 审核通过，追加到 LEARNINGS.md
    await Bash({
      command: "git add docs/LEARNINGS.md && git commit -m 'docs: 记录开发经验' && git push"
    });
    break;
  }

  // FAIL: 主 Agent 根据 Required Fixes 补充内容
  for (const fix of result.requiredFixes) {
    await Edit({
      file_path: fix.location,
      old_string: "...",
      new_string: "..."
    });
  }

  attempts++;
}

if (attempts >= MAX_GATE_ATTEMPTS) {
  throw new Error("gate:learning 审核失败，已重试 20 次");
}
```

### gate:learning Subagent 调用

```
Skill({
  skill: "gate:learning"
})
```

### PASS 后操作

追加到 LEARNINGS.md 并提交：
```bash
git add docs/LEARNINGS.md
git commit -m "docs: 记录开发经验"
git push
```

### 手动模式（备选）

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

## 完成条件

- [ ] 至少有一条 Learning 记录（Engine 或项目层面）
- [ ] Learning 已提交并推送

**Task Checkpoint**: `TaskUpdate({ taskId: "10", status: "completed" })`

**完成后进入 Step 11: Cleanup**
