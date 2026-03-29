---
id: instruction-dod-test-strength
version: 1.0.0
created: 2026-03-29
updated: 2026-03-29
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本，记录 DoD Test 字段强度升级规则
---

# DoD Test 字段强度规则

## What it is

`check-dod-mapping.cjs` 的 `detectFakeTest()` 函数在 CI L1 阶段自动检查每条 DoD 验收项的 Test 字段，拦截无真实断言的弱测试命令。

## 禁止的弱测试模式

以下命令**不能作为 DoD Test 字段**，CI 会拒绝：

| 模式 | 原因 |
|------|------|
| `echo "..."` | 只输出，无断言 |
| `printf "..."` | 只输出，无断言 |
| `ls <path>` | 只列目录，无内容验证 |
| `cat <file>` | 只读文件，无断言 |
| `true` | 永远成功，无意义 |
| `exit 0` | 永远成功，无意义 |
| `grep <pattern> <file>` | standalone grep，无失败路径 |
| `grep ... \| wc -l` | 计数不断言 |
| `test -f <file>` | 只检查文件存在，无内容验证 |
| `TODO` | 占位符 |

## 推荐的强测试写法

### 静态文件内容验证
```
manual:node -e "const c=require('fs').readFileSync('path/to/file','utf8');if(!c.includes('expected'))throw new Error('missing');console.log('OK')"
```

### 运行时 HTTP 验证
```
manual:curl -sf http://localhost:5221/api/brain/context | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.tasks)throw new Error('missing tasks');console.log('OK')"
```

### 引用已有测试文件
```
tests/packages/engine/tests/devgate/check-dod-mapping.test.ts
```

注意：`tests/` 前缀路径相对于 monorepo 根目录，文件必须存在。

## Trigger

每次 PR push 时，CI L1 的 `DoD Verification Gate` 自动运行。
