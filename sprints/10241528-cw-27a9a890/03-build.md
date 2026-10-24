---
task_id: 27a9a890-fccc-4874-9655-420030b8587b
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---

# 运行回执判读手册 build

本次唯一产品改动：`packages/brain/scripts/coding-workflow/runner/README.md`。提交 SHA：`e7dd627c310d7f12d02878093252d53aae6e5f8c`。没有新增或修改仓库测试；原任务只允许 README 产品编辑，因此用 `node --input-type=module <<'NODE' ... NODE` 内联断言和 `/tmp` 临时回执目录验证真实 CLI，临时目录在命令结束时删除。没有调用生产、安装服务或创建 PR。

### B-1
对应 S-1；改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。先运行 `node --input-type=module <<'NODE' ... NODE` 的五项 README 内容断言，退出码 1，输出 `S-1 FAIL：README 缺少目标说明`。实现命令用法、默认目录、JSON/文本、mtime 排序和空结果语义后，再运行 `node --input-type=module <<'NODE' ... NODE`：脚本通过 `spawnSync('node',[cli,'--log-dir',d,...])` 真实调用 CLI，在独立临时目录写入新旧回执并设置不同 mtime，同时检查空目录和不存在目录。退出码 0，输出 `S-1 PASS：mtime 倒序；空目录和不存在目录为 []；文本提示无记录`。提交 SHA：`e7dd627c310d7f12d02878093252d53aae6e5f8c`。

### B-2
对应 S-2；改动文件：同上。前述内联红灯命令退出码 1，输出 `S-2 FAIL：README 缺少目标说明`。实现五种状态、扫描边界、ci_fix 摘要及保留现场说明后，运行同一 `node --input-type=module <<'NODE' ... NODE` 真实 CLI 验证：脚本在临时目录创建 running/completed/partial/failed/broken 和 cifix 回执，断言五状态、失败活动与原因、两次修复及文本摘要；另建 qa/commander/pr-sync-pending JSON 并读回原文。退出码 0，输出 `S-2 PASS：五状态、失败活动与原因、ci_fix 摘要；三个非回执 JSON 保留`。提交 SHA：`e7dd627c310d7f12d02878093252d53aae6e5f8c`。

### B-3
对应 S-3；改动文件：同上。前述内联红灯命令退出码 1，输出 `S-3 FAIL：README 缺少目标说明`。实现缺 PR URL 与最终合并的只读诊断说明后，运行同一 `node --input-type=module <<'NODE' ... NODE` 真实 CLI 验证：临时目录中的 `{"status":"completed","outputs":{}}` 在 JSON 中为 completed、`pr_url_missing`、`pr_url:null`，文本不显示该原因；同时断言 README 写有最终 head、Brain merge 和 QA 终态。退出码 0，输出 `S-3 PASS：缺 PR URL 仍 completed，JSON 有原因，文本不显示；终态判据齐全`。提交 SHA：`e7dd627c310d7f12d02878093252d53aae6e5f8c`。

### B-4
对应 S-4；改动文件：同上。前述内联红灯命令退出码 1，输出 `S-4 FAIL：README 缺少目标说明`。提交前执行 `git diff -- packages/brain/scripts/coding-workflow/runner/README.md`、`git diff --check`、固定基线/暂存区/工作区的 `git diff --name-status`、`git ls-files --others --exclude-standard` 及 manifest 三处 diff；结果只有 README 的 17 行新增，全仓未跟踪仅本任务 sprint 原有流水线文件，manifest 无差异。运行 `python3 - <<'PY' ... PY`，从固定基线 `git show 6de9f4e25c0d0b456744a33aeca3fa92498c4138:packages/brain/scripts/coding-workflow/runner/README.md` 读取原字节，移除新小节后逐字节比较，退出码 0，输出 `S-4 PASS：移除新增小节后与固定基线 README 原字节完全一致`。随后只执行 `git add packages/brain/scripts/coding-workflow/runner/README.md && git diff --cached --check && git diff --cached --name-status && git commit -m 'docs: clarify coding workflow receipt status and merge checks'`；输出仅 README 入暂存，提交 `e7dd627c3`。提交后按固定基线执行 `git rev-list --parents --reverse --topo-order 6de9f4e25c0d0b456744a33aeca3fa92498c4138..HEAD`，对唯一提交的父子运行 `git diff --raw --no-renames`、`git diff --binary --no-renames`，再检查最终差异、暂存区、工作区、全仓未跟踪与 manifest；内联 Python 断言退出码 0，输出 `S-4 PASS：完整提交链仅 README；暂存区/工作区为空；全仓未跟踪仅本任务流水线文件；manifest 零差异；原文逐字节保留`。提交 SHA：`e7dd627c310d7f12d02878093252d53aae6e5f8c`。

### B-5
对应 S-5；本阶段改动文件仍只有 README，未改来源清单、后续报告或受保护凭证。前述内联红灯命令退出码 1，输出 `S-5 FAIL：README 缺少目标说明`。提交后同一固定基线完整 DAG/全仓范围命令和内联 Python 断言退出码 0，输出 `S-5 当前阶段 PASS：未编辑/提交 manifest 或后续报告；发布后来源、同步和 QA 恢复须由对应可信控制器另验`。这是当前 build 可验证的范围；发布后来源增量、main 同步、QA 会话隐藏与会话后恢复、正式 CI 和合并尚未发生，不能提前报通过。验证仅使用 Git 只读命令和临时 artifact，遵守仅 README 可作产品编辑且不得新增仓库测试的范围。提交 SHA：`e7dd627c310d7f12d02878093252d53aae6e5f8c`。
