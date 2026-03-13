### [2026-03-13] bash-guard.sh 新增 gh pr create title 格式验证

**失败统计**：CI 失败 0 次（本地验证阶段），本地测试失败 2 次

**本地测试失败记录**：

- 失败 #1：DoD 文件 Test 字段格式 — `packages/engine/tests/hooks/bash-guard.test.ts` 路径
  **根本原因**：`check-dod-mapping.cjs` 的 Test 路径正则只匹配 `tests/[^\s]+`（以 `tests/` 开头），不匹配 `packages/engine/tests/...`（从仓库根目录开始）。
  **修复**：改用 `manual:bash -c "grep -c ..."` 格式验证文件存在性。
  **下次预防**：在 DoD 中引用 engine 测试文件时，必须用 `manual:bash -c "grep -c 'keyword' path/to/test.ts"` 格式，而非 `tests/packages/engine/...` 路径。

- 失败 #2：bash-guard.sh 测试在 worktree 中运行，有 engine 变更，触发 [CONFIG] 强制检查
  **根本原因**：bash-guard.test.ts 的 `runHook()` 函数没有设置 `cwd`，所以 bash 脚本继承 vitest 的工作目录（`packages/engine/`），在 cecelia worktree 中发现了 `packages/engine/` 有变更，进而要求 PR title 有 `[CONFIG]` 标签，导致 `feat:` 格式测试失败。
  **修复**：新增 `runHookIsolated()` 函数，指定 `cwd: tmpdir()`，在 `/tmp` 中运行（无 git 仓库），`git diff` 返回空，跳过 engine 变更检查。
  **下次预防**：bash-guard 新增的 git 状态检查类规则，测试中必须隔离 git 上下文，避免测试环境的 git 变更干扰结果。用 `runHookIsolated`（无 git 仓库上下文）测试纯格式规则；用 `runHook`（有 git 上下文）测试需要感知仓库状态的规则。

**错误判断记录**：
- 以为 `packages/engine/tests/hooks/bash-guard.test.ts` 是从仓库根目录开始的有效 Test 路径 → 实际上 check-dod-mapping.cjs 的正则只接受 `tests/` 开头（不含 packages/ 前缀）

#### 根本原因

bash-guard.sh 的 engine 变更检查使用 `git diff --name-only HEAD`，该命令受 bash 执行时的工作目录影响。测试没有隔离 git 上下文，导致 worktree 中已有的 engine 变更污染了测试结果。

#### 下次预防

- [ ] bash-guard 中新增 git 状态检查规则时，必须同步在测试中加入 `runHookIsolated()` 函数（或等效 cwd 隔离机制）
- [ ] DoD 中引用 engine 测试文件时用 `manual:bash -c "grep -c ..."` 而非 `packages/engine/tests/...` 路径
- [ ] check-dod-mapping.cjs 的 Test 路径正则仅支持 `tests/` 开头，未来如需支持 `packages/*/tests/` 需要更新正则

**影响程度**: Low（本地解决，无 CI 失败，逻辑清晰）
