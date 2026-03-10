# Step 6: 写代码

> 根据 PRD 和探索结果实现功能代码 + 测试

**Task Checkpoint**: `TaskUpdate({ taskId: "6", status: "in_progress" })`

---

## 原则

1. **只做 PRD 里说的** - 不要过度设计
2. **保持简单** - 能用简单方案就不用复杂方案
3. **遵循项目规范** - 看看已有代码怎么写的
4. **测试是代码的一部分** - 写功能代码时同步写测试

---

## 代码检查清单

写代码时注意：

- [ ] 文件放对位置了吗？
- [ ] 命名符合项目规范吗？
- [ ] 有没有引入安全漏洞？
- [ ] 有没有硬编码的配置？

---

## 测试要求

**DoD 里写的验收标准 → 变成测试代码**：

```
DoD: "用户能登录"
  ↓
测试: it('用户能登录', () => { ... })
```

### 测试文件命名

- `功能.ts` → `功能.test.ts`
- 例：`login.ts` → `login.test.ts`

### 测试标准

- [ ] 必须有断言（expect）
- [ ] 覆盖核心功能路径
- [ ] 覆盖主要边界情况

---

## 常见问题

**Q: 发现 PRD 有问题怎么办？**
A: 更新 PRD，调整实现方案，继续。

**Q: 需要改已有代码怎么办？**
A: 改之前先理解原代码逻辑，改完确保不破坏原有功能。

**Q: 代码写到一半发现方案不对？**
A: 调整方案，重新实现。

---

## Instruction Book Update

**代码写完后，判断是否新增了用户可见的能力，如果是则更新说明书。**

### 判断标准

| 变更类型 | 是否需要更新 instruction book |
|---------|-------------------------------|
| 新增 `/skill` 命令 | ✅ 是 → `docs/instruction-book/skills/<name>.md` |
| 新增系统自动运行的 feature | ✅ 是 → `docs/instruction-book/features/<name>.md` |
| 修改已有命令的行为/参数 | ✅ 是 → 更新对应已有 entry |
| 纯 bug fix（行为不变） | ❌ 否 |
| 内部重构（用户无感知） | ❌ 否 |
| 测试/文档改动 | ❌ 否 |

### Entry 格式

```markdown
## What it is
（一句话描述功能）

## Trigger
（什么时候触发 / 如何调用）

## How to use
（具体用法，命令示例）

## Output
（会产出什么）

## Added in
PR #xxx（YYYY-MM-DD）
```

### 存放位置

- 新 skill → `docs/instruction-book/skills/<skill-name>.md`
- 新 feature → `docs/instruction-book/features/<feature-name>.md`

**不需要写 CI gate**，这是开发者自律行为。尽量做，做了就有，不做就没有。

---

## 完成后

**标记步骤完成**：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
[[ -f "$DEV_MODE_FILE" ]] || DEV_MODE_FILE=".dev-mode"
sed -i "s/^step_6_code: pending/step_6_code: done/" "$DEV_MODE_FILE"
echo "✅ Step 6 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "6", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/07-verify.md`
2. 立即开始本地验证
3. **不要**输出总结或等待确认
4. **不要**停顿

---

**Step 7：本地验证**
