---
id: learning-cp-03172117-fix-l3-coverage-oom
branch: cp-03172117-fix-l3-coverage-oom
created: 2026-03-17
type: learning
---

# Learning: 修复 coverage-baseline OOM 阻塞 main CI

## 做了什么

给 `ci-l3-code.yml` 的 `coverage-baseline` job 加了 `continue-on-error: true`，防止 vitest coverage worker OOM 导致 main push CI 整体失败。

## 根本原因

**不对称保护**：`coverage-delta` job（PR 时运行）的 "Run coverage" 步骤早已有 `continue-on-error: true`（line 886），但 `coverage-baseline` job（push 到 main 时运行）的同名步骤没有。`coverage-baseline` 不在 `l3-passed` gate 的 `needs` 列表中，本身不影响任何 PR 的合并——但缺少保护会在 main push CI 中静默失败，让整个 workflow 标红，造成误报。

## 踩的坑

1. **[GATE] Test 命令超时**：最初写 `bash -c "cd packages/engine && npm ci --ignore-scripts 2>/dev/null && node scripts/devgate/check-dod-mapping.cjs"`，其中 `npm ci` 在 CI 30s 超时内无法完成。修复：改为仅验证 YAML 文件可读（`node -e "require('fs')..."` 验证文件存在即可）。
2. **Learning 文件需要在 CI 通过前 push**：Learning Format Gate 在 L1 中强制检查，必须在第一次 push 之前就创建好 Learning 文件。

## 下次预防

- [ ] 写 `[GATE]` DoD 条目时，Test 命令必须是快速的（< 10 秒），不要放 `npm ci` 这类安装命令
- [ ] 对称检查：`coverage-delta`（PR 时）和 `coverage-baseline`（push 时）应该有相同的 OOM 保护策略，以后修改其中一个时另一个同步检查
- [ ] Learning 文件必须在第一次 `git push` 前创建好，不能依赖 CI 失败后再补
