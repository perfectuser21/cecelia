---
task_id: f2980a63-f4cd-4797-a2ab-7c2bd75728d4
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---

### B-1
对应 S-1。改动 `packages/brain/scripts/coding-workflow/runner/README.md`：新增单任务 JSON、`--dry-run` 命令、仓库选择顺序、校验与退出语义。验证方式为 `/tmp/cw-f2980a63-check.mjs` 的只读静态断言，解析实际 JSON 并核对 `new-task.mjs`、`repos.mjs`；临时脚本未入仓，未运行 CLI 或建单，符合仅文档改动范围。命令 `node /tmp/cw-f2980a63-check.mjs S-1`：改前退出 1，报“缺少 单任务示例 JSON”；改后退出 0，输出“S-1 静态断言通过”。提交 SHA：`d908dbd5d22017e2f3b8c31aa1f95853cbb00c51`。

### B-2
对应 S-2。改动同一 README：新增两任务批次 JSON、项目互斥、依赖就绪与字符串依赖缺口说明。验证方式为临时只读静态断言，解析批次并核对 `new-task.mjs`、`deps.mjs`、`plan.mjs`；未新增仓库测试。命令 `node /tmp/cw-f2980a63-check.mjs S-2`：改前退出 1，报“缺少 两任务批次示例 JSON”；改后退出 0，输出“S-2 静态断言通过”。提交 SHA：`d908dbd5d22017e2f3b8c31aa1f95853cbb00c51`。

### B-3
对应 S-3。改动同一 README：写明真实 POST 形状、部分创建、失败对象与已建数组双重查账、无 ID 时只读核账和禁止整批盲重跑；原回执小节保留。验证方式为临时只读静态断言及原文逐字节比对，不调用 Brain。命令 `node /tmp/cw-f2980a63-check.mjs S-3`：改前退出 1，因新增小节不存在而无法匹配内容；改后退出 0，输出“S-3 静态断言通过”。实际字节比对命令：

```bash
node --input-type=module -e 'import fs from "node:fs"; import cp from "node:child_process"; import assert from "node:assert/strict"; const p="packages/brain/scripts/coding-workflow/runner/README.md"; const old=cp.execFileSync("git",["show","16a9032b8aed2ab8dfa65cc80b32f0321a76e9bd:"+p]); const now=fs.readFileSync(p); const start=Buffer.from("## 提交编码任务\n"); const end=Buffer.from("## 运行回执如何判读\n"); const a=now.indexOf(start); const b=now.indexOf(end,a); assert.ok(a>=0&&b>a); const restored=Buffer.concat([now.subarray(0,a),now.subarray(b)]); assert.deepEqual(restored,old); console.log("基线 README 原文字节及顺序完整保留；仅插入提交编码任务小节；基线字节="+old.length)'
```

该命令退出 0，输出“基线 README 原文字节及顺序完整保留；仅插入提交编码任务小节；基线字节=13714”。提交 SHA：`d908dbd5d22017e2f3b8c31aa1f95853cbb00c51`。

### B-4
对应 S-4。产品改动仍仅为同一 README；未编辑或暂存 manifest。验证方式为本 build 的固定基线范围检查；发布前 verify 须独立保留其当时原生命令与结果，本报告不代替它。命令 `node /tmp/cw-f2980a63-check.mjs S-4`：改前退出 1，报“缺少新增小节，无法核产品范围”；改后退出 0。命令 `git diff --name-status 16a9032b8aed2ab8dfa65cc80b32f0321a76e9bd HEAD`：仅 `M packages/brain/scripts/coding-workflow/runner/README.md`；`git diff --cached --name-status`、`git diff --name-status`、`git diff 16a9032b8aed2ab8dfa65cc80b32f0321a76e9bd HEAD -- .implementation-source-relations.json`：均退出 0、零字节输出；`git ls-files --others --exclude-standard`：只列本任务 sprint 下既有九份流水线 Markdown，未见其他未跟踪路径。`git show 16a9032b8aed2ab8dfa65cc80b32f0321a76e9bd:packages/brain/scripts/coding-workflow/runner/README.md | wc -c` 输出 `13714`；上述字节断言核对其原文及顺序。提交 SHA：`d908dbd5d22017e2f3b8c31aa1f95853cbb00c51`。

### B-5
对应 S-5。没有修改 QA、来源门或控制器文件；本 build 只验证当前产品与范围事实，后续每轮完整 DAG、可信同步投影、03/04 隔离及恢复、05 原生全账、正式 CI 与终态须由相应阶段真实核验。验证方式为临时静态断言和当前 HEAD 的 Git 清单，不新增仓库测试、不读取保护凭证根。命令 `node /tmp/cw-f2980a63-check.mjs S-5`：改前退出 1，报“缺少新增小节，无法核产品范围”；改后退出 0。提交后 `for spec in S-1 S-2 S-3 S-4 S-5; do node /tmp/cw-f2980a63-check.mjs "$spec" || exit 1; done` 退出 0，逐行输出五条“静态断言通过”；`git rev-parse HEAD` 输出 `d908dbd5d22017e2f3b8c31aa1f95853cbb00c51`；`git status --short` 仅显示 `?? sprints/10242049-cw-f2980a63/`，无产品未提交改动。提交 SHA：`d908dbd5d22017e2f3b8c31aa1f95853cbb00c51`。
