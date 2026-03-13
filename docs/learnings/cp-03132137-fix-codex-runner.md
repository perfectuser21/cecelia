---
id: learning-cp-03132137-fix-codex-runner
version: 1.0.0
created: 2026-03-13
branch: cp-03132137-fix-codex-runner
pr: TBD
---

# Learning: 修复 Codex runner — 单次大调用模式

## 根本原因

`codex-bin exec` 是**无状态**调用：每次调用启动新 session，Codex 不记得上一轮做了什么。
旧 runner.sh 第二轮只发 `action`（如"执行 Step 8：创建 PR"），Codex 没有上下文，无法执行。

Claude Code 有 Stop Hook 保活机制（PR 未合并就 exit 2 阻止退出），Codex 没有这个机制。

## 解决方案

### 第一次调用
发送完整工作流 prompt（包含 task-id、分支名、项目路径、/dev 完整指令），
让 Codex 在一次 session 内完成所有步骤。

### 重试调用
发送带完整上下文的恢复 prompt（包含当前状态和未完成原因），
避免 Codex 重复已完成步骤。

### 已知兼容性问题修复
- `--sandbox full-access` → `--sandbox danger-full-access`（正确值）
- `--cwd <path>` 不支持 → `cd <path>` 再执行（正确方式）
- `CODEX_HOME` 环境变量 → 通过 `export CODEX_HOME` 传递

## 下次预防

- [ ] 每次写 runner.sh 类型代码时，先验证 CLI 参数是否有效（`codex --help`）
- [ ] Codex 无状态调用 = 每次都要携带完整上下文
- [ ] Stop Hook 是 Claude Code 特有机制，其他 provider 需要自己的保活策略
- [ ] Coverage Gate 要求 `feat:` PR 必须有 `.test.ts` 文件，写好再提交
