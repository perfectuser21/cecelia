# Step 4: 探索

> 读代码 → 理解架构 → 输出实现方案

**Task Checkpoint**: `TaskUpdate({ taskId: "4", status: "in_progress" })`

---

## 为什么需要探索

```
❌ 旧流程：拿到 PRD → 直接写代码 → 写到一半发现方向错了
✅ 新流程：拿到 PRD → 读代码理解架构 → 知道改什么 → 再写代码
```

**探索不是"调研"**，是为了写出正确代码的必要准备。

---

## 执行步骤

### 4.1 找到相关文件

根据 PRD 描述的功能，找到需要修改的文件：

```bash
# 用 Glob 找文件
Glob("**/*.ts", path="src/")

# 用 Grep 找关键词
Grep("functionName", path="src/")
```

### 4.2 读关键文件

读取找到的文件，理解：
- 现有架构和设计模式
- 数据流向
- 依赖关系

### 4.3 输出实现方案

简要记录（不需要写文档，脑子里清楚即可）：
- **要改哪些文件** — 列出文件路径
- **每个文件怎么改** — 添加/修改/删除什么
- **风险/依赖** — 有没有可能影响其他功能

### 4.4 继续下一步

探索完成后立即继续 Step 5 (DoD)。

---

## 注意事项

- **不要过度探索** — 目标是理解够用就行，不是读完整个代码库
- **发现 PRD 有问题** — 更新 PRD，继续
- **探索时间控制** — 简单功能几分钟，复杂功能不超过 10 分钟

---

## 完成后

**标记步骤完成**：

```bash
sed -i 's/^step_4_explore: pending/step_4_explore: done/' .dev-mode
echo "✅ Step 4 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "4", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/05-dod.md`
2. 立即开始写 DoD
3. **不要**输出总结或等待确认

---

**Step 5：DoD**
