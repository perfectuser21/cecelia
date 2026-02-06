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

## 完成后

**标记步骤完成**：

```bash
sed -i 's/^step_6_test: pending/step_6_test: done/' .dev-mode
echo "✅ Step 6 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "6", status: "completed" })`

**立即执行下一步**：读取 `skills/dev/steps/07-quality.md` 并继续

---

**Step 7：质检**
