---
task_id: fa872516-0694-46ed-b9f1-ce81763ca9b4
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---

### B-1
对应 S-1。仅在 `packages/brain/scripts/coding-workflow/runner/README.md` 文末追加新节，说明 qaFix 的提示词和 provider 调用关系，以及 INTENT_PATH、SPEC_PATH 的共同授权边界。只读核对了 `runner/lib/qa-gate.mjs`、`lib/claude.mjs`、`prompts/qa-fix.md`。验证使用 `/private/tmp/cw-fa872516-build/expected-section.txt` 中预先独立撰写的完整预期节与临时只读 Node 断言，不新增仓库测试。实际命令 `node /private/tmp/cw-fa872516-build/assert.cjs`：修改前退出 1，输出 `AssertionError [ERR_ASSERTION]: 新增节全文不符`；追加后同命令退出 0、零输出；提交后重跑仍退出 0、零输出。断言逐字比较固定基线 bytes 前缀和整个新增节，标题仅一次；实际 `git ls-tree 5f514a8523ef3f40fb671ff8f3a90947597d0628 packages/brain/scripts/coding-workflow/runner/README.md` 与 `git ls-tree HEAD packages/brain/scripts/coding-workflow/runner/README.md` 均显示 mode `100644`。提交 SHA：`8bd080d6b3e7eae5383d45746c3f946ce3ffd3c6`。

### B-2
对应 S-2。仍仅修改同一 README 新节，写明文档任务的可失败只读断言、内存对抗、真实 RED→GREEN、原生输出与退出码保存、禁止越界测试或产品 CLI。验证使用同一个临时只读断言：修改前 `node /private/tmp/cw-fa872516-build/assert.cjs` 退出 1，输出新增节全文不符的 Node AssertionError；修改后同命令退出 0、零输出。该脚本在内存构造删除新节、反转文档测试限制、插入程序修改授权、插入产品 CLI 授权等变体，先确认变异成功，再确认同一全文断言抛错；没有写入仓库测试或执行产品 CLI。`git diff --check` 退出 0、零输出。提交 SHA：`8bd080d6b3e7eae5383d45746c3f946ce3ffd3c6`。

### B-3
对应 S-3。仍仅修改同一 README 新节，写明代码 bug 的失败测试与永久回归要求，以及冲突时不提交、独立输出 RULING_CONFLICT 并交既有控制器升级。只读核对 `prompts/qa-fix.md` 与 `runner/__tests__/qa-fix-contract-scope.test.mjs`，没有修改它们。实际 `node /private/tmp/cw-fa872516-build/assert.cjs` 在修改前退出 1，追加后退出 0、零输出；脚本在内存反转“永久保留回归”和“冲突不提交”，确认变异成功且同一全文断言均拒绝。验证方式遵守本任务只许文档追加的边界。提交 SHA：`8bd080d6b3e7eae5383d45746c3f946ce3ffd3c6`。

### B-4
对应 S-4。仍仅修改同一 README 新节，分开当前 QA 与 judge-only 历史来源、固定基线逐父审计、暂隐藏与后续恢复及终态门。实际 `node /private/tmp/cw-fa872516-build/assert.cjs` 在修改前退出 1，追加及提交后均退出 0、零输出，全文断言覆盖本节全部文字。`git merge-base --is-ancestor 5f514a8523ef3f40fb671ff8f3a90947597d0628 HEAD` 退出 0；`git rev-list --parents 5f514a8523ef3f40fb671ff8f3a90947597d0628..HEAD` 仅显示本提交及固定基线父节点；`git diff-tree -r --raw --no-abbrev 5f514a8523ef3f40fb671ff8f3a90947597d0628 HEAD` 与 `git diff 5f514a8523ef3f40fb671ff8f3a90947597d0628 HEAD --raw` 均只显示 README 的 `100644` blob 变化。提交后 `git diff --cached --raw`、`git diff --raw` 均零输出；`git ls-files --others --exclude-standard` 只显示本轮原有 sprint 输入文件，未将其暂存或提交。文档任务只做只读 Git 与内容核验，不读 03/04 正文或保护根，不调用产品 CLI。提交 SHA：`8bd080d6b3e7eae5383d45746c3f946ce3ffd3c6`。
