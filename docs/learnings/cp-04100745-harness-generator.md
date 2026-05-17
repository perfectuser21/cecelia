### 根本原因

WS1 任务：`scripts/devgate/check-manual-cmd-whitelist.cjs` 的 ALLOWED_COMMANDS 集合缺少 `'playwright'`，导致合同验证命令中使用独立 `playwright test ...` 命令时被 CI 白名单校验器拦截。

关键决策：只修改 ALLOWED_COMMANDS 集合中的一个词，不触碰其他任何逻辑。

### 下次预防

- [ ] 修改白名单后立即运行 C1（非注释代码包含检查）+ C2（syntax check）两个验证命令
- [ ] 注意文件有 `#!/usr/bin/env node` shebang，`new Function(c)` 语法检查会因此报 "Invalid or unexpected token"（预存 bug，与本次改动无关）
