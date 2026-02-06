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

## 完成后

**标记步骤完成**：

```bash
sed -i 's/^step_5_code: pending/step_5_code: done/' .dev-mode
echo "✅ Step 5 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "5", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/06-test.md`
2. 立即开始写测试
3. **不要**输出总结或等待确认
4. **不要**停顿

---

**Step 6：写测试**
