# Step 5: 写代码

> 根据 PRD 实现功能代码

**Task Checkpoint**: `TaskUpdate({ taskId: "5", status: "in_progress" })`

---

## 原则

1. **只做 PRD 里说的** - 不要过度设计
2. **保持简单** - 能用简单方案就不用复杂方案
3. **遵循项目规范** - 看看已有代码怎么写的

---

## 检查清单

写代码时注意：

- [ ] 文件放对位置了吗？
- [ ] 命名符合项目规范吗？
- [ ] 有没有引入安全漏洞？
- [ ] 有没有硬编码的配置？

---

## 常见问题

**Q: 发现 PRD 有问题怎么办？**
A: 更新 PRD，调整实现方案，继续。

**Q: 需要改已有代码怎么办？**
A: 改之前先理解原代码逻辑，改完确保不破坏原有功能。

**Q: 代码写到一半发现方案不对？**
A: 调整方案，重新实现。

---

## 完成后：gate:audit 审核（必须）

代码写完后，**必须**启动 gate:audit Subagent 审计。

### 循环逻辑

```
主 Agent 写代码
    ↓
启动 gate:audit Subagent
    ↓
Subagent 返回 Decision
    ↓
├─ FAIL → 主 Agent 根据 Findings 修复 L1/L2 问题 → 再次启动 Subagent
└─ PASS → 生成 gate 文件 → 继续 Step 6
```

### gate:audit Subagent 调用

```
Skill({
  skill: "gate:audit"
})
```

### PASS 后操作

```bash
bash scripts/gate/generate-gate-file.sh audit
```

**关键原则**：
- gate:audit 在 gate:test 之前执行
- 改完代码再跑 Test，避免测试白跑

**Task Checkpoint**: `TaskUpdate({ taskId: "5", status: "completed" })`

---

继续 → Step 6
