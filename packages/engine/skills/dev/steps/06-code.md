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

## Step 6.5：Cleanup Sub-Agent（强制，不可跳过）

> **代码写完后立刻执行。不做完不能进 Step 7。**
> **使用 Agent 工具召唤 sub-agent 自动扫描，不要自己手动检查。**

### 召唤方式

使用 **Agent 工具**（subagent_type=general-purpose），直接执行，不要问用户：

**第一步**：获取改动文件列表

```bash
git diff --name-only HEAD
```

**第二步**：召唤 sub-agent，prompt 内容如下：

```
分析以下改动文件，找到并删除4类垃圾代码。

改动文件列表：
[粘贴 git diff --name-only HEAD 的输出]

4类问题（必须全部检查）：
1. 被新代码替代的旧函数/旧变量（同文件或跨文件）——包括注释掉的旧实现块（// old: / /* deprecated */ 等）
2. 重复逻辑——改动文件里出现两段几乎一样的代码，提取成共用函数
3. 矛盾注释——注释说"做A"但代码做B，或 TODO 临时方案已成正式代码
4. 无用 import——文件里有 import 但代码里没用到

要求：
- 只处理上面列出的文件，不扫全仓库
- 每处改动说明原因（是哪类问题）
- 改完后输出 git diff 内容供确认
- 如果某个文件没有问题，明确说"无需清理"
- 如果没有任何文件需要清理，说"全部文件无需清理"
```

### sub-agent 完成后

1. **检查它的 diff**：确认没有误删业务逻辑
2. **如有误删**：用 Edit 工具在当前文件恢复被误删的内容
3. **直接继续 Step 7**，不要向用户汇报"清理完了请看"

### 完成标准（sub-agent 执行完毕后确认）

- ✅ 无被替代的旧函数/旧变量残留
- ✅ 无注释掉的旧代码块
- ✅ 无矛盾注释（注释和代码行为一致）
- ✅ 无未使用的 import

全部满足后才能继续。

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
