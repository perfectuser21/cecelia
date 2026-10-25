---
task_id: cdb32573-9ece-405a-823e-c6c327765564
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---

### B-1
对应 S-1。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，仅在固定基线原字节后追加同一个小节，说明公共 `sourceFacts` 与 judge-only `historical_execution` 的来源和绑定。验证方式：仓库外 `/tmp/cw-cdb32573-readme-check.mjs` 以 Node 只读比较固定基线 README Buffer、mode 和新增节断言；未修改仓库测试。实际命令 `node /tmp/cw-cdb32573-readme-check.mjs S-1`（初次由 `for id in S-1 S-2 S-3 S-4; do ...; done` 调用）先退出 1，报新增节标题不匹配；追加后退出 0，输出 `S-1 GREEN：固定基线 bytes/mode 及新增节关键职责断言通过`。提交 SHA：`37d827df4efbceb4c308cb3bde58649697b934c8`。

### B-2
对应 S-2。改动文件：同一 README 新增节的原生账说明，涵盖有序失败/重复/零输出、字段、完成条件与失败关闭。验证方式：同一仓库外 Node 只读断言，符合原任务禁止新增或修改仓库测试的范围。实际命令 `node /tmp/cw-cdb32573-readme-check.mjs S-2` 初次退出 1，报新增节标题不匹配；首次追加后仍退出 1，报 `S-2 缺少 turn.failed`；补明终止事件后退出 0，输出 `S-2 GREEN：固定基线 bytes/mode 及新增节关键职责断言通过`。提交 SHA：`37d827df4efbceb4c308cb3bde58649697b934c8`。

### B-3
对应 S-3。改动文件：同一 README 新增节的当前 QA、历史 judge 与 03/04 暂隐藏责任说明。验证方式：同一仓库外 Node 只读断言；文档任务未新增仓库测试，也未触碰受保护历史目录。实际命令 `node /tmp/cw-cdb32573-readme-check.mjs S-3` 初次退出 1，报新增节标题不匹配；追加后退出 0，输出 `S-3 GREEN：固定基线 bytes/mode 及新增节关键职责断言通过`。提交 SHA：`37d827df4efbceb4c308cb3bde58649697b934c8`。

### B-4
对应 S-4。改动文件：同一 README 新增节的发布前/后核验时点说明。验证方式：同一仓库外 Node 只读断言，加 Git 对固定 initial base、提交父边、index/worktree/untracked 和根目录 manifest 的只读核验；无仓库测试或临时材料入提交。实际命令 `node /tmp/cw-cdb32573-readme-check.mjs S-4` 初次退出 1，报新增节标题不匹配；追加后退出 0，输出 `S-4 GREEN：固定基线 bytes/mode 及新增节关键职责断言通过`。`git rev-list --parents 8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d..HEAD` 只列本提交及固定父提交；`git diff-tree --raw --no-commit-id -r 8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d HEAD` 只列 README 的 100644 blob 变化；`git diff --cached --raw` 与 `git diff --raw` 均无输出；`git ls-files --others --exclude-standard` 只列原有 sprint 输入文件，均未暂存。`git diff --check -- packages/brain/scripts/coding-workflow/runner/README.md` 退出 0，无输出。根目录 `.implementation-source-relations.json` 的 Node Buffer 断言输出 `manifest 固定基线至 HEAD 原字节一致`；初次误用子目录路径的命令退出 1，报固定 base 不存在该路径，随后已按根目录真实路径重跑通过。提交 SHA：`37d827df4efbceb4c308cb3bde58649697b934c8`。
