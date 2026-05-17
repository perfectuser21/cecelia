### 根本原因

Bridge `/llm-call` 在 `selectBestAccount` 返回 null 时，`accountId` 为 undefined，
导致 Bridge spawn `claude -p` 时无 `CLAUDE_CONFIG_DIR`，报 "Not logged in" exit 1，500 错误。

两处需修复：
1. `cecelia-bridge.cjs`：无 `accountId` 时未设 `CLAUDE_CONFIG_DIR` 默认值
2. `llm-caller.js`：`selectBestAccount` 失败时直接传 `undefined` 给 Bridge，而非 fallback 账号

### 下次预防

- [ ] Bridge `/llm-call` handler 在设置 env 时，`accountId` 分支与 `else` 分支都需覆盖 `CLAUDE_CONFIG_DIR`
- [ ] `callClaudeViaBridge()` 中账号选择失败时必须有 `FALLBACK_ACCOUNT` 兜底，不传 `undefined`
- [ ] 新增 Bridge 端点时检查：spawn 前 `CLAUDE_CONFIG_DIR` 是否一定有值
