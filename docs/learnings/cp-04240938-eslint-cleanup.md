# Learning: Brain ESLint warning 清零（cp-04240938-eslint-cleanup）

**日期**：2026-04-24
**PR 目标**：把 packages/brain 的 95 个 eslint warning 清零、CI `--max-warnings` 锁死 0。

## 过程

### 根本原因

1. **`catch (_err)` 仍报 unused-vars**：ESLint v9 里 catch clause 的未使用变量由 `caughtErrors` 选项控制（默认 `'all'`），不受 `varsIgnorePattern: '^_'` 影响——即便下划线前缀也会 warn。
2. **`crypto` import 看似未用**：`eslint.config.mjs` 给 globals 加了 `crypto: 'readonly'`（指 Web Crypto 全局），但大部分 brain 源码 import 的是 `node:crypto`（createHash 等）。ESLint 看到 global 可用就认为 import 未用，触发 no-unused-vars。
3. **`findingsValue` / `pidMap` 的 ReferenceError 被外层 catch 吞**：在 try 块内定义的 const，在 try 外的 scope 里引用会抛 ReferenceError，而外层 catch 刚好会把它当作 non-fatal 错误吞掉——代码"跑通"靠 catch 兜底，但 eslint 的 no-undef 会正确抓出来。
4. **未用 import / 未用常量大量堆积**：tick.js、routes/execution.js、routes/ops.js、routes/status.js 的 imports 超过 10 个 named export 没用，历史累积。

### 修复策略

- **catch 未用 binding** → 改 optional catch `catch { ... }`（ES2019+ 支持，Node 18+ 全覆盖）。无业务行为变化，纯 syntax 清洗。
- **`crypto: 'readonly'` 全局** → 从 eslint.config.mjs 删除。实际代码不依赖 Web Crypto global，node:crypto import 之后 eslint 就不会误判。
- **未用 imports** → 通盘 grep 确认无引用后删除；若底下有 `await import(...)` 动态引入，顶层 import 保留或删（按动态引入为准）。
- **findingsValue/pidMap** → 保守派：改为 `null` 或 `action.slot`，保持历史 ReferenceError-被吞的实际行为（不把 try-block 变量提升作用域，那是功能变更）。
- **case 块 lexical declaration** → case 改成 `{ ... }` 封闭块。
- **unused arg 保留 API 兼容** → 加 `_` 前缀（如 `checkAndAlertExpiringCredentials(_pool)`）。

### 下次预防

- [ ] 审 ESLint 新规则时，确认 `caughtErrors` 选项设置，决定是否加 `caughtErrorsIgnorePattern: '^_'`（本 PR 没加，改用 optional catch 完全避开）。
- [ ] `eslint.config.mjs` 的 globals 不要乱加（只加真的依赖 Web API 全局的；node:crypto 之类 import 就够了）。
- [ ] 每次新写 catch block，若真不用 error 信息，直接写 `catch { ... }` 而不是 `catch (e)`/`catch (_e)`。
- [ ] imports 整理放入 code-review checklist：PR diff 涉及顶层 import 新增 → 必须 grep 确认有引用。
- [ ] CI `--max-warnings` 降为 0 后，任何 PR 新增 warning 会立刻挂 eslint，杜绝基线反弹。

## 测试验证

- `cd packages/brain && npx eslint src/ --max-warnings 0` → exit 0，0 warnings
- `vitest run --exclude='src/__tests__/integration/**'` → 6782 passed / 12 failed（仅 harness-parse-tasks.test.js 的 pre-existing 环境依赖，main 也是 12 failed），无新增 regression。
- CI workflow `.github/workflows/ci.yml` 同步降 `--max-warnings 0`。
