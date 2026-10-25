---
task_id: df525426-c735-44d1-abee-82023053fd93
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---

### B-1

对应 S-1。改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，文末新增小节的「草稿 ready 的两条入口与合并门」。验证方式：临时 `/tmp/cw-df525426-assert.mjs` 对 README 只读检查双入口、门槛、失败和并发语义，并在内存中逐词删除关键限定，要求每次触发 `AssertionError`。实际命令：`node /tmp/cw-df525426-assert.mjs S-1`；修改前 exit 1，输出 `AssertionError [ERR_ASSERTION]: 缺少本任务小节`；修改后及提交后均 exit 0、无输出。原任务仅允许改 README，因此脚本放在 `/tmp`，未新增或提交仓库测试。提交 SHA：`4432f485481f2b37f15ea01ba238ca278f90af13`。

### B-2

对应 S-2。改动文件：同一 README，新增小节的「四种 HEAD 身份与固定来源范围」。验证方式：同一临时只读断言核四种身份、固定基线、逐父 DAG 和纯登记例外，并用内存删词反例验证断言可失败。实际命令：`node /tmp/cw-df525426-assert.mjs S-2`；修改前 exit 1，输出 `AssertionError [ERR_ASSERTION]: 缺少本任务小节`；修改后及提交后 exit 0、无输出。另实际运行 `git rev-parse --verify '0bd461e8c80fc5db202e2570eeee77d0c9cdce58^{commit}'`、`git merge-base --is-ancestor 0bd461e8c80fc5db202e2570eeee77d0c9cdce58 HEAD`、`git rev-list --parents 0bd461e8c80fc5db202e2570eeee77d0c9cdce58..HEAD`、`git diff-tree --raw 0bd461e8c80fc5db202e2570eeee77d0c9cdce58 HEAD`、`git diff 0bd461e8c80fc5db202e2570eeee77d0c9cdce58 HEAD --raw`、`git diff --cached --raw`、`git diff --raw`：均 exit 0；rev-list 显示当前提交 `4432f485...` 唯一父为固定 base，raw 全差异仅 README 的 100644 blob `66e0b3055`→`ddeeebc90`，index/worktree 无输出。验证材料未进入仓库。提交 SHA：`4432f485481f2b37f15ea01ba238ca278f90af13`。

### B-3

对应 S-3。改动文件：同一 README，新增小节的「MERGED 后的回执、Learning 与预览回收」。验证方式：临时只读断言核 pending、非幂等 POST、Learning ID、SHA-256、handoff、preview stop 与 next tick；内存逐词删除须失败。实际命令：`node /tmp/cw-df525426-assert.mjs S-3`；修改前 exit 1，输出 `AssertionError [ERR_ASSERTION]: 缺少本任务小节`；修改后及提交后 exit 0、无输出。另运行 `node --input-type=module -e 'import{execFileSync}from"node:child_process";import{readFileSync,statSync}from"node:fs";import{strict as a}from"node:assert";const p="packages/brain/scripts/coding-workflow/runner/README.md",base=execFileSync("git",["show","0bd461e8c80fc5db202e2570eeee77d0c9cdce58:"+p]),now=readFileSync(p);a.ok(now.subarray(0,base.length).equals(base));a.equal(statSync(p).mode&0o777,0o644);a.equal(now.subarray(base.length).toString("utf8").split("## 合并前后 HEAD、草稿 ready 双入口与交接 Learning 核账").length,2);console.log("基线前缀 bytes、mode 100644 和唯一新增小节通过")'`，exit 0，输出 `基线前缀 bytes、mode 100644 和唯一新增小节通过`。断言与基线核验只读，符合文档限定范围。提交 SHA：`4432f485481f2b37f15ea01ba238ca278f90af13`。

### B-4

对应 S-4。改动文件：同一 README，新增小节的「各阶段核账责任」。验证方式：临时只读断言核 build、verify、当前 QA、judge-only 与外层 C01-C12 的职责和禁读边界；每个关键词的内存删词反例须失败。实际命令：`node /tmp/cw-df525426-assert.mjs S-4`；修改前 exit 1，输出 `AssertionError [ERR_ASSERTION]: 缺少本任务小节`；修改后及提交后 exit 0、无输出。实际运行 `git diff --check` 与提交前 `git diff --cached --check`，均 exit 0、无输出；`git diff --cached --name-status` 在提交前仅输出 `M packages/brain/scripts/coding-workflow/runner/README.md`。提交后 `git status --porcelain --untracked-files=all` 只列本轮原有的 sprint 输入文件；README 无未提交差异，`03-build.md` 按要求在提交后单独写入且不提交。所有验证均使用临时 artifact 或只读命令，未扩大原任务范围。提交 SHA：`4432f485481f2b37f15ea01ba238ca278f90af13`。
