# Step 6: 写测试

> 每个功能必须有对应的测试

**Task Checkpoint**: `TaskUpdate({ taskId: "6", status: "in_progress" })`

---

## 核心原则

```
DoD 里写的验收标准 → 变成测试代码

例如：
  DoD: "用户能登录"
    ↓
  测试: it('用户能登录', () => { ... })

  DoD: "密码错误有提示"
    ↓
  测试: it('密码错误有提示', () => { ... })
```

---

## 测试文件命名

- `功能.ts` → `功能.test.ts`
- 例：`login.ts` → `login.test.ts`

---

## 测试要求

- [ ] 必须有断言（expect）
- [ ] 覆盖核心功能路径
- [ ] 覆盖主要边界情况

---

## 示例

```typescript
// login.test.ts
import { describe, it, expect } from 'vitest'
import { login } from './login'

describe('login', () => {
  it('正确用户名密码能登录成功', async () => {
    const result = await login('user', 'password')
    expect(result.success).toBe(true)
  })

  it('错误密码显示错误提示', async () => {
    const result = await login('user', 'wrong')
    expect(result.success).toBe(false)
    expect(result.error).toBe('密码错误')
  })

  it('空用户名不能提交', async () => {
    const result = await login('', 'password')
    expect(result.success).toBe(false)
  })
})
```

---

## 不写测试的后果

- 没有测试可能被 CI 拦截
- PR review 时会被指出缺少测试

---

## gate:test 审核（必须）

测试写完后，**必须**启动 gate:test Subagent 审核。

### 循环逻辑

```
主 Agent 写测试
    ↓
启动 gate:test Subagent
    ↓
Subagent 返回 Decision
    ↓
├─ FAIL → 主 Agent 根据 Required Fixes 补充测试 → 再次启动 Subagent
└─ PASS → 生成 gate 文件 → 继续 Step 7
```

### gate:test Subagent 调用

```
Task({
  subagent_type: "general-purpose",
  prompt: `你是独立的测试审核员。审核以下文件：
- DoD: {dod_file}
- 测试文件: {test_files}

## 审核标准

### 1. DoD ↔ 测试覆盖率
- 列出 DoD 中 Test: tests/xxx 的验收项
- 检查对应测试文件是否存在
- 检查是否有对应的测试用例

### 2. 边界用例
检查测试是否覆盖：
- [ ] 正常路径：预期输入 → 预期输出
- [ ] 边界值：最小值、最大值、空值、临界值
- [ ] 异常路径：无效输入、错误状态

示例（正则匹配测试）：
// 正常路径
it("should match ~/.claude/skills/dev/xxx", ...)

// 边界用例
it("should NOT match ~/.claude/skills/dev-tools/xxx", ...)  // 相似但不同
it("should match ~/.claude/skills/qa/", ...)                 // 多个受保护 skill
it("should NOT match ~/.claude/skills/my-skill/", ...)       // 非保护 skill

// 异常路径
it("should handle empty path", ...)
it("should handle path without skills/", ...)

### 3. 反例测试
- [ ] 是否测试失败情况？
- [ ] 是否测试错误输入？

测试不应该只验证"正确时通过"，还要验证"错误时失败"：
❌ 只测 "valid input → success"
✅ 测 "valid input → success"
✅ 测 "invalid input → error message"
✅ 测 "edge case → expected behavior"

### 4. 测试质量
- [ ] 每个测试有断言（expect/assert）？
- [ ] 断言具体明确（不是 toBeTruthy()）？
- [ ] 测试独立（不相互依赖）？

## 输出格式（必须严格遵守）

## Gate Result

Decision: PASS | FAIL

### Findings
- [PASS/FAIL] DoD↔测试覆盖率：X/Y 验收项有测试
- [PASS/FAIL] 边界用例：覆盖/缺失
- [PASS/FAIL] 反例测试：有/无
- [PASS/FAIL] 测试质量：...

### Required Fixes (if FAIL)
1. 缺失测试的验收项：...
2. 缺失的边界用例：...
3. 缺失的反例测试：...
4. 测试质量问题：...

### Evidence
- DoD 验收项列表：...
- 测试文件内容摘要：...
- 测试用例统计：X 个正例，Y 个反例，Z 个边界`,
  description: "gate:test"
})
```

### PASS 后操作

```bash
bash scripts/gate/generate-gate-file.sh test
```

**Task Checkpoint**: `TaskUpdate({ taskId: "6", status: "completed" })`

---

继续 → Step 7
