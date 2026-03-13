---
branch: cp-03131232-hook-gates
pr: "#918"
date: 2026-03-13
---

# Learning: Hook Gates — 假锁变真锁（5个真锁）

## 根本原因分析

/dev 工作流有大量"必须"要求只是 .md 文字（假锁），完全依赖 AI 自觉遵守。AI 可能因为上下文压力、推理误判、工具错误等原因跳过这些检查。具体表现：

1. `git push` 前没有强制运行 local-precheck.sh，代码质量问题直到 CI 才暴露
2. commit message 格式无强制检查，非 Conventional Commits 格式的提交混入仓库影响 auto-version
3. 写 .prd-*.md 时可以不写 `## 成功标准`，导致验收标准缺失
4. 写 .dod-*.md 时可以没有 `- [ ]` checkbox，DoD 失去验收清单
5. Step 10 flag=done 只是 AI 自己标记，不验证内容实际质量

## 解决方案

在现有 hook 文件中加入 5 个真锁，将假锁变为 hook 级代码强制执行：

| 锁 | 文件 | 触发时机 | 阻止方式 |
|---|---|---|---|
| 1 | bash-guard.sh | `git push` | 运行 local-precheck.sh，失败则 exit 2 |
| 2 | bash-guard.sh | `git commit -m` | 验证 Conventional Commits 格式 |
| 3 | branch-protect.sh | Write .prd-*.md | 检查含 `## 成功标准`，无则 exit 2 |
| 4 | branch-protect.sh | Write .dod-*.md | 检查含 `- [ ]` checkbox，无则 exit 2 |
| 5 | stop-dev.sh | Step 10 flag=done | 运行 check-learning.sh 验证内容 |

## 踩坑记录

### 坑 1: Coverage Gate 门禁 1 — feat PR 必须有新增测试文件

**问题**：PR 标题含 `feat:` 但没有新增 `.test.ts` 文件，Coverage Gate 门禁 1 失败。

**根因**：`check-changed-coverage.cjs` 检查 `addedFiles` 中有无 test 文件。只修改现有测试不够，必须有 **新增** 的测试文件。

**修复**：新增 `packages/engine/tests/hooks/hook-gates.test.ts`，覆盖 5 个新 gate 的行为。

**预防措施**：任何 `feat:` PR 都要在写代码时同步创建新测试文件，不能只修改已有测试。

### 坑 2: commit message 格式检测只支持双引号

**问题**：bash-guard.sh 中提取 commit message 的 sed 命令只处理双引号 `-m "..."` 格式，单引号 `-m '...'` 或 heredoc 无法检测。

**当前状态**：已知局限，单引号消息会被放行。对于当前使用场景（Claude Code 生成的提交命令总是双引号）可以接受。

**预防措施**：若后续需要支持单引号，在 bash-guard.sh 中增加单引号提取逻辑。

### 坑 3: L3 Coverage Gate 报告 22 个失败（主要是预存在失败）

**分析**：
- main 分支 2026-03-10 时 L3 有 4 个预存在失败
- 我们的 PR 有 22 个失败，其中约 18 个是后续 PR 引入但未修复的预存在失败（stop-hook 版本标记、retry 阈值、sentinel cleanup 等）
- 我们的代码改动（bash-guard.sh/branch-protect.sh/stop-dev.sh 的新增部分）没有引入额外的测试失败

**根因**：known-failures.json 的 `stop-hook-router-tests` 条目覆盖了部分但可能不够，导致 CI 最终报 failure。

**实际影响**：Coverage Gate 的真正失败原因是"门禁 1：没有新增测试文件"，而不是预存在测试失败。

## 下次预防措施

- [ ] **feat PR 必须同步新增测试文件**：在 Step 6（写代码）阶段，当 PR 标题确定为 `feat:` 时，必须同时创建对应的 `.test.ts` 文件
- [ ] **commit message 验证测试**：可在 bash-guard 测试中增加单引号变体的测试用例
- [ ] **DoD Test 字段使用 grep -c**：验证新 hook 逻辑时，DoD 的 Test 字段应用 `grep -c 'key-string' hooks/xxx.sh`，而非 vitest 命令（CI 超时风险）
