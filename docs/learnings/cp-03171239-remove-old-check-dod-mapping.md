# Learning: 删除根目录旧版 check-dod-mapping.cjs（2026-03-17）

## 任务简述

删除 `scripts/devgate/check-dod-mapping.cjs`（根目录旧版，3.9KB），统一使用 `packages/engine/scripts/devgate/check-dod-mapping.cjs`（26KB，含完整假测试检测）；同时修复使用旧格式（`manual:ls`、`manual:echo`）的测试 fixture。

---

## CI 失败记录

本次 CI 0 次失败（在推送前已全部本地修复）。

---

### 根本原因

**陷阱 1：branch-protect.sh 对 packages/ 子目录只检查 `.prd-{branch}.md`，不检查 `.task-{branch}.md`**

`find_prd_dod_dir()` 函数第 520 行判断时只检查 `.prd-${branch}.md`，但实际上 Task Card 格式（`.task-*.md`）在主逻辑中是优先级更高的格式。导致在 `packages/` 子目录改动时，即使已有 `.task-{branch}.md`，hook 仍然报错要求创建 `.prd-{branch}.md`。

**陷阱 2：测试 fixture `valid-contract.dod.md` 使用了旧格式（manual:ls、manual:echo），与新版 check-dod-mapping.cjs 规则不兼容**

`check-dod-mapping.cjs` 在 `v12.76.0`（PR #963）加入了 `manual:ls` 弱测试拒绝规则和 `manual:echo` 假测试拒绝规则，但 `pr-gate-phase1.test.ts` 的测试 fixture 还在使用旧格式，导致测试一直失败（预先存在的 bug）。这个 bug 随本次删除旧版的任务一并被发现和修复。

**陷阱 3：DoD Test 命令不能以 `echo` 结尾，即使包含 `bash`**

`detectFakeTest` 会检测整个命令字符串中是否有 `\becho\b`，因此 `bash -c "...&& echo PASS"` 也会被拒绝，必须去掉 `echo PASS` 部分。

---

### 下次预防

- [ ] 在 `packages/` 子目录开发时，同时创建 `.prd-{branch}.md` 和 `.task-{branch}.md`（hook 兼容两种格式，但需要 `.prd-` 文件才能通过 packages/ 保护）
- [ ] DoD `Test:` 命令中禁止以任何形式使用 `echo`，包括 `bash -c "... && echo PASS"`；用 `bash -c "grep -q ..."` 或直接省略成功提示
- [ ] 修改测试 fixture 时，先运行 `node packages/engine/scripts/devgate/check-dod-mapping.cjs <fixture-file>` 验证格式，再运行 `npx vitest run <test-file>` 验证逻辑
- [ ] 任务中涉及 `packages/engine/` 文件时，记得同步更新 5 个版本文件（package.json、package-lock.json、VERSION、.hook-core-version、regression-contract.yaml）+ feature-registry.yml changelog + generate-path-views.sh
