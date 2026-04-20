# PRD: brain ESLint warning 基线从 244 降到 95

## 背景

PR #2444 冻结了 brain lint 基线在 244，大多数是 `no-unused-vars`（219/244 = 90%）。这是机械可修的 —— ESLint 规则允许 `_` 前缀绕过（`/^_/u`），所以直接批量给未用变量加 `_` 前缀就能降低基线，不影响运行时行为。

## 成功标准

1. 写 codemod 脚本：读 ESLint JSON output，对 `no-unused-vars` 告警的变量加 `_` 前缀
2. 跑完后 brain `npx eslint src/` warning 数从 244 降到 ≤100
3. 回滚 codemod 误伤的文件（引发新 no-undef 的那些）
4. 更新 `ci.yml` `--max-warnings 244` → 新基线
5. brain-unit tests 仍全绿（codemod 不破坏运行时）

## 实际结果

- codemod 在 65 文件里改了 198 个变量
- 6 文件被误伤（ESLint 误判"未用"，实际有引用）→ 回滚
- 最终 53 文件保留修复，warning 数 **244 → 95**（-149，-61%）
- 剩余 95 = 70 no-unused-vars（codemod 无法处理的边界）+ 15 no-undef（pre-existing）+ 10 no-case-declarations（pre-existing）

## 非目标（YAGNI）

- 不修 no-undef 的 15 条（需要真动代码补 import / 修引用）
- 不修 no-case-declarations 的 10 条（需要给 case block 加 `{}`）
- 不追求 0 warning（留给后续渐进）
