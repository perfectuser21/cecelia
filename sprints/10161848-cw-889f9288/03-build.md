---
task_id: 889f9288-5169-4341-acb8-f5cacc330bff
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---

### B-1

- 对应：S-1。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。新增运行回执小节，说明 `--log-dir`、`--json`、默认目录、mtime 排序和空结果的限制，包括漏值参数的实际解析结果。
- 验证方式：先用内联 Node 断言 README 缺少新小节而留红；实现后用 `/tmp/cw-889f9288-verify.mjs` 在系统临时目录自造回执，真实调用仓库 CLI，并断言手册文本。临时脚本和回执均不进入仓库，符合原任务禁止新增测试文件的范围。
- 实际命令与输出摘要：红灯 `node -e 'const fs=require("fs"),a=require("assert");const s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");a.match(s,/## 运行回执如何判读/);a.match(s,/--log-dir <回执目录> --json/);console.log("S-1 PASS")'`，退出码 1，缺少新小节；绿灯 `node /tmp/cw-889f9288-verify.mjs`，退出码 0，JSON 与文本均按 mtime 倒序，空目录、不存在目录、普通文件均返回 `[]`，`--log-dir --json` 输出文本。
- 提交 SHA：`7fabed72c61e3ef500e997db364f9ebbde8577eb`。

### B-2

- 对应：S-2。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。说明五种状态、失败活动与原因、非回执 JSON、`pr-sync-pending.json` 和 `ci_fix` 摘要的判读。
- 验证方式：先用内联 Node 断言缺少待办文件说明而留红；实现后用同一临时脚本自造状态 JSON 和 CI 修复记录，真实调用 CLI 断言输出；没有新增仓库测试。
- 实际命令与输出摘要：红灯 `node -e 'const fs=require("fs"),a=require("assert");const s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");a.match(s,/pr-sync-pending\.json/);a.match(s,/ci_fix\.attempts/);console.log("S-2 PASS")'`，退出码 1，缺少 `pr-sync-pending.json`；绿灯 `node /tmp/cw-889f9288-verify.mjs`，退出码 0，四种有效状态与四种 `unreadable`、`failed_activity=build`、`reason_code=tests_failed`、`ci_fix={attempts:2,last_result:"pushed"}` 均符合断言。
- 提交 SHA：`7fabed72c61e3ef500e997db364f9ebbde8577eb`。

### B-3

- 对应：S-3。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`。区分 completed 回执和最终合并，说明缺 PR URL 时的 JSON 原因及只读核对 PR/head、Brain merge 与 QA 终态的链条。
- 验证方式：先用内联 Node 断言缺少 `pr_url_missing` 而留红；实现后用临时脚本自造有、无 PR URL 的 completed 回执，真实运行 CLI 并断言 JSON 与文本差异；只记录只读诊断方法，未调用 Brain 或 GitHub。
- 实际命令与输出摘要：红灯 `node -e 'const fs=require("fs"),a=require("assert");const s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");a.match(s,/pr_url_missing/);a.match(s,/runner\.phase=merged/);a.match(s,/merge\.merged=true/);console.log("S-3 PASS")'`，退出码 1，缺少 `pr_url_missing`；绿灯 `node /tmp/cw-889f9288-verify.mjs`，退出码 0，缺 PR URL 仍为 completed、JSON 有原因而文本不显示，README 的终态字段断言通过。
- 提交 SHA：`7fabed72c61e3ef500e997db364f9ebbde8577eb`。

### B-4

- 对应：S-4。
- 改动文件：仅 `packages/brain/scripts/coding-workflow/runner/README.md`；本报告为未提交的流水线记录。
- 验证方式：实现前内联 Node 从固定基线读取 README，断言新节存在而留红；实现后临时脚本按字节检查基线全文保序保留，并在提交后逐层核对固定基线到 HEAD、暂存区、工作区、全仓未跟踪文件和 manifest。临时验证材料位于 `/tmp`，没有改仓库测试、程序或 manifest。
- 实际命令与输出摘要：红灯 `node -e 'const fs=require("fs"),a=require("assert"),cp=require("child_process");const p="packages/brain/scripts/coding-workflow/runner/README.md",b=cp.execFileSync("git",["show","6073eac1d35e652e3ea6b71fc040878c95864cd7:"+p]);const n=fs.readFileSync(p);let at=0;for(const c of b){at=n.indexOf(c,at);a.notStrictEqual(at,-1,"baseline byte missing");at++}a.match(n.toString(),/## 运行回执如何判读/);console.log("S-4 PASS")'`，退出码 1，缺少新节；绿灯 `node /tmp/cw-889f9288-verify.mjs`，退出码 0，基线 10889 字节保序保留、README 28 项断言通过。`git diff --check` 与 `git diff --cached --check` 均退出码 0；提交后 `git diff --name-status 6073eac1d35e652e3ea6b71fc040878c95864cd7 HEAD` 只列 README，`git diff --cached --name-status` 和 `git diff --name-status` 均为空；`git ls-files --others --exclude-standard` 仅列本次 sprint 中已存在的流水线 Markdown；`git diff 6073eac1d35e652e3ea6b71fc040878c95864cd7 HEAD -- .implementation-source-relations.json` 为空。
- 提交 SHA：`7fabed72c61e3ef500e997db364f9ebbde8577eb`。
