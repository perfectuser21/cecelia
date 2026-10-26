---
task_id: 8b129e0c-96bc-492a-9d8d-ce04260caa6c
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---

### B-1
对应 S-1。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，只在固定基线原文后追加指定小节，说明早期与批准后两次 ready、前后 GET、人工仓分流和最终合并 CAS。验证方式：允许的 `/tmp/cw-8b129e0c-assert.mjs` 只读 Node 内容断言及内存替换反例；没有新增或修改仓库测试、程序或配置。追加前运行 `node /tmp/cw-8b129e0c-assert.mjs S-1`：exit 1，`new heading count 0 !== 1`。追加后的第一次同命令 exit 1，提示缺少“失败或身份变化”；修正文档后同命令 exit 0，零输出，提交后重复运行仍 exit 0、零输出。`node /tmp/cw-8b129e0c-mutants.mjs` 中删除“非批准、非合并”“ready 前后”“--match-head-commit”的三项反例，各子命令 exit 1，父命令 exit 0。提交 SHA：`3cc668ff4b8c270907894fc245e419ac0280e2bf`。

### B-2
对应 S-2。改动文件：同一 README 新节，区分 tested_head、approved.head、PR headRefOid 与 squash mergeCommit.oid，并写明新 HEAD 重验、纯记录窄例外、固定基线逐父来源审计。验证方式：同一临时只读断言及内存替换，不提交测试文件。追加前 `node /tmp/cw-8b129e0c-assert.mjs S-2`：exit 1，`new heading count 0 !== 1`；追加后及提交后同命令均 exit 0、零输出。`node /tmp/cw-8b129e0c-mutants.mjs` 中删除“mergeCommit.oid”“实际 main ref”“新 HEAD 重新真实 QA、judge、CI、preview”的三项反例，各子命令 exit 1。提交 SHA：`3cc668ff4b8c270907894fc245e419ac0280e2bf`。

### B-3
对应 S-3。改动文件：同一 README 新节，写明 Brain PATCH 与独立读回、Learning ID/全文 SHA-256、preview stopped、下次 tick 和旧失败保留。验证方式：临时只读 Node 断言同时用 `git show 7724d4f246453d6a90b5c451e63d80fbb586628d:packages/brain/scripts/coding-workflow/runner/README.md` 读取固定基线字节，用 `git ls-tree`/索引 mode 核原文精确前缀和 100644 mode；没有改仓库测试。追加前 `node /tmp/cw-8b129e0c-assert.mjs S-3`：exit 1，`new heading count 0 !== 1`；追加后及提交后同命令均 exit 0、零输出。`node /tmp/cw-8b129e0c-mutants.mjs` 中删除“receipt_pending=false”“Learning ID”“历史 FAIL/HUMAN”的三项反例，各子命令 exit 1。提交 SHA：`3cc668ff4b8c270907894fc245e419ac0280e2bf`。

### B-4
对应 S-4。改动文件：同一 README 新节，列清 build、发布前 verify、当前 QA、独立 judge 与后续控制器的证据责任。验证方式：同一临时只读断言及内存替换，不将临时验证材料加入仓库。追加前 `node /tmp/cw-8b129e0c-assert.mjs S-4`：exit 1，`new heading count 0 !== 1`；追加后及提交后同命令均 exit 0、零输出。`node /tmp/cw-8b129e0c-mutants.mjs` 中删除“发布前 verify”“03/04 正文”“judge-only historical_execution”“C01-C12”的四项反例，各子命令 exit 1。`git diff --cached --check`、`git diff --check` 均 exit 0；提交前 `git diff --cached --raw` 仅有 README 100644→100644 一项，`git diff --raw` 空。提交后 `git merge-base --is-ancestor 7724d4f246453d6a90b5c451e63d80fbb586628d HEAD` exit 0；`git rev-list --parents 7724d4f246453d6a90b5c451e63d80fbb586628d..HEAD` 只有本提交及固定基线父提交；`git diff-tree -r --raw --no-abbrev 7724d4f246453d6a90b5c451e63d80fbb586628d HEAD` 和 `git diff --raw 7724d4f246453d6a90b5c451e63d80fbb586628d HEAD` 均仅显示 README 的 100644 blob 修改。`git diff --cached --raw`、`git diff --raw`、`git diff --raw 7724d4f246453d6a90b5c451e63d80fbb586628d HEAD -- .implementation-source-relations.json` 均零输出；`git ls-files --others --exclude-standard` 仅列本轮 sprint 输入文件，未入提交。提交 SHA：`3cc668ff4b8c270907894fc245e419ac0280e2bf`。
