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

### 循环逻辑（模式 B：主 Agent 改）

**主 Agent 负责循环控制，最大 3 轮**：

```javascript
const MAX_GATE_ATTEMPTS = 20;
let attempts = 0;

while (attempts < MAX_GATE_ATTEMPTS) {
  // 启动独立的 gate:test Subagent（只审核）
  const result = await Skill({
    skill: "gate:test"
  });

  if (result.decision === "PASS") {
    // 审核通过，生成 gate 文件
    await Bash({ command: "bash scripts/gate/generate-gate-file.sh test" });
    break;
  }

  // FAIL: 主 Agent 根据 Required Fixes 补充测试
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
  throw new Error("gate:test 审核失败，已重试 20 次");
}
```

### gate:test Subagent 调用

```
Skill({
  skill: "gate:test"
})
```

### PASS 后操作

```bash
bash scripts/gate/generate-gate-file.sh test
```

**Task Checkpoint**: `TaskUpdate({ taskId: "6", status: "completed" })`

---

继续 → Step 7
