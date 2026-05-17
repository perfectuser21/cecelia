# brain-lint-baseline-drop（2026-04-20）

### 根本原因

PR #2444 冻结 brain ESLint 基线在 244，但 90% 是 `no-unused-vars`（机械可修）。ESLint 规则允许 `_` 前缀绕过（`/^_/u`），直接批量加前缀就能降基线，不影响运行时。

写了 `/tmp/prefix-unused-vars.mjs` codemod：读 `eslint --format=json` 输出，按 file+line+column 定位变量名，加 `_` 前缀。对 65 文件改了 198 个变量。

但 ESLint 的"unused"分析有时判错：6 个文件里变量实际被引用但 ESLint 漏看（scope 或闭包），重命名后触发新的 no-undef。策略：回滚这 6 文件，保留其他 53 文件的修复。

最终 **244 → 95**（-61%），剩 70 个 no-unused-vars 是 codemod 无法安全处理的边界。

### 下次预防

- [ ] 任何基于 ESLint 分析的自动重命名，必须在跑完后立即再跑一遍 lint 看新增 no-undef。新增>0 即意味着有误伤，回滚涉及文件
- [ ] codemod 只碰 ESLint 高置信场景（param + 显式 `const/let` decl），跳过复杂 destructuring / closure capture
- [ ] warning 降基线和升基线规则一样严：降后第一次 PR 如果 warning 数又涨回来，说明有人偷偷 allowed，要追查
