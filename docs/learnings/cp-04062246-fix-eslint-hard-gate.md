---
branch: cp-04062246-fix-eslint-hard-gate
created: 2026-04-06
pr: "1969"
---

# Learning: ESLint globals 冲突 + continue-on-error 摆设

### 根本原因

1. **`no-redeclare` 72个 error**：`eslint.config.mjs` 手动声明 `console`/`process` globals，同时64个源文件有 `/* global console */` 注释 → ESLint 视为重复声明 → `no-redeclare` error。修复：用 `globals` 包（`globals.node`）替换手动声明，批量删除冗余注释。

2. **`.mjs` 文件不受保护**：`files: ['src/**/*.js']` 不匹配 `.mjs`，这些文件只跑 `js.configs.recommended`（`no-undef: error`）不跑自定义 globals → 47个 `no-undef` error。修复：加入 `ignores: ['src/**/*.mjs']`。

3. **`continue-on-error: true`**：ESLint lint 失败从未阻断 merge，是摆设。

### 下次预防

- [ ] 新增全局变量只在 `eslint.config.mjs` 的 globals 块配置，禁止在源文件写 `/* global */` 注释
- [ ] `globals` 必须在 `package.json devDependencies` 中声明（不能依赖 monorepo 提升）
- [ ] ESLint 步骤禁用 `continue-on-error`
