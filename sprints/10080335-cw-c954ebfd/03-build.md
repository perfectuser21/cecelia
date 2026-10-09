---
task_id: c954ebfd-469f-4006-a95f-b277fa6564f6
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2"]
---
# 构建总结

### B-1
对应：S-1

改动文件：
- `packages/brain/scripts/coding-workflow/runner/com.cecelia.coding-workflow-runner.plist.tmpl`：`EnvironmentVariables` dict 内 `CODING_WF_MAIN_LOG` 之后加占位行 `    __AUTOMERGE_ENV__`。
- `packages/brain/scripts/coding-workflow/runner/install.sh`：头部「可覆盖」注释补 `CODING_WF_AUTOMERGE`；新增 `fill_automerge()`（值先做 XML 转义 `& < >`，经环境变量传入 awk；非空则把占位行换成 `<key>`/`<string>` 两行，缩进 4 空格，空/未设置则整行删除）；`render_plist` 的 sed 输出管道接 `fill_automerge`。runner 读取逻辑未改。

新增测试：见 B-2（先写测试，实现前运行：新增 4 个用例中 2 个正向用例失败，2 个"未设置/空串"用例本就通过）。

实际运行：
- `cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/install.test.mjs`：实现后 1 文件 9 用例全部通过。
- `CODING_WF_AUTOMERGE=0 bash .../install.sh --dry-run`：退出码 0；抽出的 plist `plutil -lint` 为 OK；第 39–40 行为 `<key>CODING_WF_AUTOMERGE</key>` / `<string>0</string>`，位于 EnvironmentVariables dict 内。
- `env -u CODING_WF_AUTOMERGE bash .../install.sh --dry-run`：退出码 0；`plutil -lint` OK；`grep -c -e CODING_WF_AUTOMERGE -e '__'` 为 0。

提交 SHA：1fdc19f7f571c0d55fea90753607a4a282d6e8cd

### B-2
对应：S-2

改动文件：`packages/brain/scripts/coding-workflow/runner/__tests__/install.test.mjs`（现有用例断言未改）。

新增测试（`describe('install.sh')` 内 4 个用例，规格要求 2 个，额外加 2 个边界）：
1. 设置 `CODING_WF_AUTOMERGE=0`：退出码 0，含键值两行，键位于 `EnvironmentVariables` 与其结束 `</dict>` 之间，无 `__`，`plutil -lint` 通过（无 plutil 时退化为格式正则）。
2. 值为 `a&b<c>`：输出转义为 `a&amp;b&lt;c&gt;`。
3. 显式 `delete` 该变量：不含 `CODING_WF_AUTOMERGE`、无 `__`、无 `\n\n\n`、无空行。
4. 值为空串：等同未设置。

实际运行：
- 实现前：`npx vitest run scripts/coding-workflow/runner/__tests__/install.test.mjs` → 2 failed | 7 passed（失败的是用例 1、2）。
- 实现后同命令 → 9 passed。
- `cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__` → 6 个文件 61 个用例全部通过（run-once / run-once-recovery / install / plan / runner-sh / run-once-retention），无回归。

提交 SHA：1fdc19f7f571c0d55fea90753607a4a282d6e8cd（与 B-1 同一提交）
