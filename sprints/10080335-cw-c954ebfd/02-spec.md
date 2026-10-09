---
task_id: c954ebfd-469f-4006-a95f-b277fa6564f6
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 规格：install.sh 可选把 CODING_WF_AUTOMERGE 写进 LaunchDaemon plist

### S-1
对应：I-1、I-2

改动文件：
- `packages/brain/scripts/coding-workflow/runner/com.cecelia.coding-workflow-runner.plist.tmpl`：在 `EnvironmentVariables` dict 里 `CODING_WF_MAIN_LOG` 的 `<string>` 之后单独加一行占位 `    __AUTOMERGE_ENV__`。
- `packages/brain/scripts/coding-workflow/runner/install.sh`：
  - 头部「可覆盖」注释补一条 `CODING_WF_AUTOMERGE`（设置后写入 plist，未设置/为空则不写）。
  - 在 `render_plist` 里，`sed` 之后把 `__AUTOMERGE_ENV__` 这一行换成两行 `<key>CODING_WF_AUTOMERGE</key>` / `<string>值</string>`（缩进与相邻键一致：key 与 string 都是 4 空格），或在变量未设置/为空（`${CODING_WF_AUTOMERGE:-}`）时整行删除，不留空行。
  - 实现用 `awk`（值经 `ENVIRON` 传入，避免转义被 awk 解释）或等价的分步 sed，值先做 XML 转义（`& < >`）。
  - 不改 runner 读取逻辑（`runner/lib/config.mjs` 已按 `CODING_WF_AUTOMERGE !== '0'` 处理）。

验证：
- `CODING_WF_AUTOMERGE=0 bash packages/brain/scripts/coding-workflow/runner/install.sh --dry-run`：退出码 0，plist 段含 `<key>CODING_WF_AUTOMERGE</key>\n    <string>0</string>`，且位于 `EnvironmentVariables` dict 内。
- `env -u CODING_WF_AUTOMERGE bash .../install.sh --dry-run`：退出码 0，输出 `grep -c CODING_WF_AUTOMERGE` 为 0，plist 中无 `__AUTOMERGE_ENV__`、无 `__` 残留、无多余空行。
- 两种输出各自经 `plutil -lint` 通过。

### S-2
对应：I-1、I-2、I-3

改动文件：
- `packages/brain/scripts/coding-workflow/runner/__tests__/install.test.mjs`：在 `describe('install.sh')` 内新增两个用例，复用现有 `runInstall` / `plistOf` / `env`：
  1. 设置 `CODING_WF_AUTOMERGE: '0'` 后跑 `--dry-run`：断言退出码 0，`plistOf(stdout)` 含 `<key>CODING_WF_AUTOMERGE</key>\n    <string>0</string>`，且该键位于 `<key>EnvironmentVariables</key>` 与其结束 `</dict>` 之间，`plist` 不含 `__`；并用 `plutil -lint`（无 plutil 时退化为首尾格式正则，写法同现有 lint 用例）校验合法。
  2. 构造 env 时显式删除 `CODING_WF_AUTOMERGE`（`childEnv()` 可能透传宿主变量，需 `delete`），跑 `--dry-run`：断言退出码 0，`plist` 不含字符串 `CODING_WF_AUTOMERGE`，不含 `__`，且不含连续空行（`\n\n\n`）。
- 现有用例不改动其断言。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/install.test.mjs`：新增两用例通过。
- `cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__`：runner 目录下全部用例通过（含 plan / run-once / runner-sh 等现有测试，无回归）。
