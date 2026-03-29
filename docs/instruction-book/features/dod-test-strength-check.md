---
id: dod-test-strength-check
version: 1.0.0
created: 2026-03-29
updated: 2026-03-29
authority: USER_FACING
changelog:
  - 1.0.0: 新增 P2-weak-inline 弱命令检测 + curl-to-localhost CI 反模式检测
---

# DoD Test 字段强度检查

## What it is

`check-dod-mapping.cjs` 在 CI DevGate 阶段自动检查 DoD 每条验收项的 `Test:` 字段，拦截弱测试命令（无断言、恒真命令）和 CI 反模式（向本地服务发请求）。

## Trigger

每次 PR 触发 CI L1 Process Gate 时自动运行，通过 `node packages/engine/scripts/devgate/check-dod-mapping.cjs` 执行。

## How to use

**被拦截的命令类型**：

```
Test: manual:ls src/           # 弱测试：只列目录，无断言
Test: manual:cat package.json  # 弱测试：只读文件，无断言
Test: manual:true              # 弱测试：永远成功，无断言
Test: manual:exit 0            # 弱测试：永远成功，无断言
Test: manual:curl localhost:5221/api/health  # CI 反模式：CI 环境无服务器
```

**推荐写法**：

```
# 验证文件包含特定内容
Test: manual:node -e "const c=require('fs').readFileSync('path/to/file','utf8');if(!c.includes('expected'))process.exit(1)"

# 验证导出函数行为
Test: manual:node -e "const m=require('./module.cjs');if(m.fn('input').valid!==false)process.exit(1)"

# 外部 HTTP 验证（非 localhost）
Test: manual:curl -sf https://api.example.com/health
```

## Output

- 检测到弱命令 → `valid:false`，`reason` 包含拦截原因（如"禁止使用 ls 弱测试"）
- `curl localhost/127.0.0.1` → `valid:false`，`reason` 包含"CI 环境无服务器"
- 合规命令 → `valid:true`

## Added in

PR #1674
