# Learning: 重构拆文件时漏导入常量

## 上下文
重构 `packages/brain/src/routes/` 时，将共享函数和常量提取到 `shared.js`，但 `status.js` 的 import 行遗漏了 `IDEMPOTENCY_TTL` 和 `ALLOWED_ACTIONS`，导致 `/api/brain/status` 运行时 500 错误（ReferenceError）。

### 根本原因
手动拆文件时只关注了函数导入，忽略了常量导入。`IDEMPOTENCY_TTL` 和 `ALLOWED_ACTIONS` 在 `status.js` 的 `/status` 路由处理函数内部使用，但不在顶层声明，容易被遗漏。

### 下次预防
- [ ] 重构拆文件后，对每个目标文件运行全局未定义变量检查（如 `node --check` 或 ESLint no-undef）
- [ ] 拆文件 PR 合并前，确认所有路由的 HTTP 端点至少有一次冒烟测试调用
- [ ] 在 CI 中加入 ESM 静态分析检查，捕获未导入的标识符
