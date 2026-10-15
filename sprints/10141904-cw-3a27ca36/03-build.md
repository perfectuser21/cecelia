---
task_id: 3a27ca36-7be9-4efc-a27f-18361dae6557
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3"]
---

### B-1

- 对应：S-1。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，新增安装前置、Codex/裁判变量、dry-run 与 system LaunchDaemon 安装及禁用门说明。
- 新增测试：按规格采用实际运行的 `node -e` 内容断言；纯文档未新增持久化单元测试或 smoke。
- 红态：新增前运行同类 `node -e` 读取 README，退出码 1，输出 `ENOENT: no such file or directory`。
- 绿态命令：`node -e 'const s=require("fs").readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["CODING_WF_PROVIDER=codex","CODING_WF_CODEX_HOME=/Users/administrator/.codex-team1","CODING_WF_CODEX_MODEL=gpt-6-sol","CODING_WF_JUDGE_PROVIDER=codex","CODING_WF_JUDGE_MODEL=gpt-6-astra","CODING_WF_REPOS=cecelia","runtime_install_disabled"])if(!s.includes(x))throw Error(x);console.log("S-1 PASS")'`；退出码 0，输出 `S-1 PASS`。已只读对照 `install.sh`、`runtime-install.mjs`、`repos.json`。
- 提交 SHA：`dd53189af3ebb942df66edcda936bf34849be346`。

### B-2

- 对应：S-2。
- 改动文件：同上，新增无领单健康检查、system 状态、回执、plist 日志定位和故障保留现场原则。
- 新增测试：实际运行的 `node -e` 内容断言；未新增持久化测试。
- 红态：新增前运行同类 `node -e` 读取 README，退出码 1，输出 `ENOENT: no such file or directory`。
- 绿态命令：`node -e 'const s=require("fs").readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["runtime-health.mjs","Logged in using ChatGPT","launchctl print system/com.cecelia.coding-workflow-runner","StandardOutPath","merge --ff-only",".cecelia/hb.sh"])if(!s.includes(x))throw Error(x);console.log("S-2 PASS")'`；退出码 0，输出 `S-2 PASS`。另运行 `qa_log_dir=$(mktemp -d) && node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_log_dir" --json`，退出码 0，输出 `[]`。已只读对照安装器、plist 模板、健康、自更新、启动与锁源码。
- 提交 SHA：`dd53189af3ebb942df66edcda936bf34849be346`。

### B-3

- 对应：S-3。
- 改动文件：同上，新增 PR/head 预览身份、Unix 桥与隔离浏览器边界、Playwright 核查命令和 ZenithJoy 人工放行说明。
- 新增测试：实际运行的 `node -e` 内容断言；未新增持久化测试。
- 红态：新增前运行同类 `node -e` 读取 README，退出码 1，输出 `ENOENT: no such file or directory`。
- 绿态命令：`node -e 'const s=require("fs").readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["PREVIEW_URL","CURL_HOME","git_sha","CANNOT_VERIFY","playwright-1.62.1","automerge=false","PR #2132"])if(!s.includes(x))throw Error(x);console.log("S-3 PASS")'`；退出码 0，输出 `S-3 PASS`。已只读对照 `activities/evaluate.mjs`、四个预览实现文件、`repos.json` 和合并门；未启动预览或浏览器。
- 提交 SHA：`dd53189af3ebb942df66edcda936bf34849be346`。

提交前 `git diff --cached --check` 退出码 0；提交只含 README。`03-build.md` 按要求留在工作区，未提交。
