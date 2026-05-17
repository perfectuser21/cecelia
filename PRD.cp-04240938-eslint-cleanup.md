# PRD: Brain ESLint warning 清零

**分支**：cp-04240938-eslint-cleanup
**日期**：2026-04-24

## 背景

`packages/brain` 当前 ESLint 有 **95 个 warning (0 error)**。CI `eslint` job 用 `--max-warnings 95` 冻结基线，任何新增 warning 立刻挂。基线只准下调不准上调。

今晚 PR #2576 卡在此处：合并链路要求 eslint → ci-passed → merge，basel=95 在上调后未回滚。即便基线本身不动，95 个 warning 让每一次动 brain 代码都可能误触新增。

## 修复范围

把 `packages/brain/src` 下所有 ESLint warning（95 条）系统清零，`--max-warnings 0` 通过。

**不允许**：
- 不加 `// eslint-disable-*`
- 不改业务行为
- 不跳过 CI

**允许**：
- `catch (_x)` 未使用的 binding → 改成 optional catch `catch { }`（ES2019+）
- `catch (_)` / `catch (err)` 等未使用 binding → 同上
- 未使用的 imports → 删除（若真没其他引用）
- 未使用的常量 → 删除（若整个文件只定义一次且没别处引用）
- 未使用的 assignment 变量 → 改 `_` 前缀，或直接删（若不是 outer scope 可见副作用）
- `no-case-declarations` → case 块加 `{ }`
- `no-undef`（missing import）→ 补 import

**补 bug 的边界**：
- `routes/execution.js` 中 `findingsValue` 在 try 块内定义，外部多处引用会抛 ReferenceError 被 outer catch 吞。**保持现行行为**：把外部引用改成 `null` 字面值（日志/history 等效），不把 findingsValue 提升作用域（那是功能变更）。
- `tick.js` 中 `pidMap` 引用未定义，同理被外层 try 吞。**保持现行行为**：改为 `action.slot` 单源（历史实际回退路径）。

## 成功标准

1. `cd packages/brain && npx eslint src/ --max-warnings 0` exit 0
2. vitest run 相对 main 无新增失败（已知 pre-existing：`harness-parse-tasks.test.js` 12 failed；本 PR 不该引入其他新 fail）
3. CI workflows `.github/workflows/ci.yml` 中 `Lint Brain` 步骤的 `--max-warnings` 参数从 95 降至 0，永久锁死
